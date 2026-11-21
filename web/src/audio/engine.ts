// App-wide audio engine. Lives outside UI components so folding/unfolding or changing screens never
// stops the click or the tuner. Clicks are scheduled on the AudioContext clock (never by timers).
import { yin, noteInfo } from '../dsp/dsp.js';
import { Store } from '../store';

export interface MetroState { running: boolean; bpm: number; beats: number; sub: number; volume: number; beat: number; tick: number }
export interface TunerState { on: boolean; note: string | null; cents: number; freq: number; level: number; error: string | null; input: string }

export const metro = new Store<MetroState>({ running: false, bpm: 80, beats: 4, sub: 1, volume: 0.8, beat: -1, tick: -1 });
export const tuner = new Store<TunerState>({ on: false, note: null, cents: 0, freq: 0, level: 0, error: null, input: '' });

let ctx: AudioContext | null = null;
export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

// ---------- wake lock (keep the screen on while the click or tuner runs) ----------
let wake: { release(): Promise<void> } | null = null;
async function updateWakeLock() {
  const want = metro.get().running || tuner.get().on;
  try {
    if (want && !wake && 'wakeLock' in navigator) wake = await (navigator as any).wakeLock.request('screen');
    if (!want && wake) { await wake.release(); wake = null; }
  } catch { /* not fatal */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wake = null; void updateWakeLock(); } });

// ---------- metronome ----------
// Accent 2600 Hz, beat 2000 Hz, subdivision 1500 Hz quieter. 2 ms raised-cosine attack, 6 ms decay.
function click(t: number, kind: 0 | 1 | 2, vol: number) {
  const c = audioContext();
  const o = c.createOscillator(), g = c.createGain();
  o.frequency.value = kind === 0 ? 2600 : kind === 1 ? 2000 : 1500;
  const v = vol * (kind === 2 ? 0.45 : 1);
  g.gain.setValueAtTime(0, t);
  g.gain.setValueCurveAtTime(new Float32Array([0, 0.146, 0.5, 0.854, 1].map(x => x * v)), t, 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, 0.006);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + 0.06);
}
let timer: number | null = null, nextT = 0, tickN = 0;
const queue: { t: number; tick: number }[] = [];
function schedule() {
  const c = audioContext(), s = metro.get();
  while (nextT < c.currentTime + 0.15) {
    const perBeat = s.sub, inBar = s.beats * perBeat, pos = tickN % inBar;
    click(nextT, pos === 0 ? 0 : pos % perBeat === 0 ? 1 : 2, s.volume);
    queue.push({ t: nextT, tick: tickN });
    tickN++;
    nextT += 60 / s.bpm / perBeat;
  }
}
function visual() {
  if (!metro.get().running || !ctx) return;
  const now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  let cur: { t: number; tick: number } | undefined;
  while (queue.length && queue[0].t <= now) cur = queue.shift();
  if (cur) { const s = metro.get(); metro.set({ tick: cur.tick, beat: Math.floor(cur.tick / s.sub) % s.beats }); }
  requestAnimationFrame(visual);
}
export function startMetronome(opts: Partial<Pick<MetroState, 'bpm' | 'beats' | 'sub'>> = {}) {
  const c = audioContext();
  stopMetronome();
  metro.set({ ...opts, running: true, beat: -1, tick: -1 });
  nextT = c.currentTime + 0.08; tickN = 0; queue.length = 0;
  schedule();
  timer = window.setInterval(schedule, 25);
  requestAnimationFrame(visual);
  void updateWakeLock();
}
export function stopMetronome() {
  if (timer !== null) clearInterval(timer);
  timer = null; queue.length = 0;
  if (metro.get().running) metro.set({ running: false, beat: -1, tick: -1 });
  void updateWakeLock();
}
export function setMetro(p: Partial<Pick<MetroState, 'bpm' | 'beats' | 'sub' | 'volume'>>) {
  if (p.bpm !== undefined) p.bpm = Math.max(30, Math.min(300, Math.round(p.bpm)));
  const restart = metro.get().running && (p.beats !== undefined || p.sub !== undefined);
  metro.set(p);
  if (restart) startMetronome();
}
let taps: number[] = [];
export function tapTempo() {
  const now = performance.now();
  taps = taps.filter(t => now - t < 2500); taps.push(now);
  if (taps.length >= 3) {
    const d = taps.slice(1).map((t, i) => t - taps[i]);
    setMetro({ bpm: 60000 / (d.reduce((a, b) => a + b, 0) / d.length) });
  }
}

// ---------- tuner / mic capture ----------
const WORKLET = `class Cap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(512);this.n=0;this.s=0;}
process(i){const c=i[0]&&i[0][0];if(!c)return true;for(let k=0;k<c.length;k++){if(!this.n)this.s=currentFrame+k;this.b[this.n++]=c[k];
if(this.n===512){this.port.postMessage({f:this.s,d:this.b.slice(0)});this.n=0;}}return true;}}registerProcessor('cap',Cap);`;
let stream: MediaStream | null = null, node: AudioWorkletNode | null = null, srcNode: MediaStreamAudioSourceNode | null = null;
let workletReady: Promise<void> | null = null;
const RING = 48000 * 4; const ring = new Float32Array(RING); let wAbs = 0;
let tunerRaf = 0, lastPitchAt = 0;
const smooth: number[] = [];

export async function startTuner(deviceId?: string) {
  const c = audioContext();
  try {
    stopTuner(false);
    const audio: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (deviceId) audio.deviceId = { exact: deviceId };
    stream = await navigator.mediaDevices.getUserMedia({ audio });
    if (!workletReady) workletReady = c.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
    await workletReady;
    srcNode = c.createMediaStreamSource(stream);
    node = new AudioWorkletNode(c, 'cap');
    node.port.onmessage = (e: MessageEvent) => { const { f, d } = e.data; for (let i = 0; i < d.length; i++) ring[(f + i) % RING] = d[i]; wAbs = f + d.length; };
    const sink = c.createGain(); sink.gain.value = 0;
    srcNode.connect(node); node.connect(sink); sink.connect(c.destination);
    tuner.set({ on: true, error: null, input: stream.getAudioTracks()[0]?.label || 'microphone' });
    tunerRaf = requestAnimationFrame(tunerLoop);
    void updateWakeLock();
  } catch (err) {
    tuner.set({ on: false, error: (err as Error).message || 'Microphone not available' });
  }
}
export function stopTuner(update = true) {
  cancelAnimationFrame(tunerRaf);
  try { srcNode?.disconnect(); node?.disconnect(); } catch { /* ignore */ }
  stream?.getTracks().forEach(t => t.stop());
  stream = null; node = null; srcNode = null; smooth.length = 0;
  if (update) { tuner.set({ on: false, note: null, level: 0 }); void updateWakeLock(); }
}
function tunerLoop(ts: number) {
  if (!tuner.get().on) return;
  if (ts - lastPitchAt > 40 && ctx) {
    lastPitchAt = ts;
    const n = 2048, buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = ring[(wAbs - n + i + RING) % RING];
    let pk = 0; for (const x of buf) pk = Math.max(pk, Math.abs(x));
    const r = yin(buf, ctx.sampleRate);
    if (r) {
      smooth.push(r.freq); if (smooth.length > 3) smooth.shift();
      const f = [...smooth].sort((a, b) => a - b)[Math.floor(smooth.length / 2)];
      const info = noteInfo(f);
      tuner.set({ note: info.name, cents: info.cents, freq: f, level: pk });
    } else tuner.set({ level: pk });
  }
  tunerRaf = requestAnimationFrame(tunerLoop);
}

/** Plucked reference tone (for tuning by ear). */
export function playReference(freq: number) {
  const c = audioContext(), t = c.currentTime + 0.02;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle'; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.01); g.gain.setTargetAtTime(0, t + 0.05, 0.6);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 3);
}

export async function listInputs(): Promise<MediaDeviceInfo[]> {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch { return []; }
}

// Diagnostics for tests and troubleshooting (no audio content, just counters).
(globalThis as any).__gtAudio = () => {
  let pk = 0; for (let i = 0; i < 4096; i++) pk = Math.max(pk, Math.abs(ring[(wAbs - 4096 + i + RING) % RING]));
  const buf = new Float32Array(2048); for (let i = 0; i < 2048; i++) buf[i] = ring[(wAbs - 2048 + i + RING) % RING];
  return { ctx: ctx?.state, sr: ctx?.sampleRate, framesIn: wAbs, recentPeak: pk, tunerOn: tuner.get().on, yin: ctx ? yin(buf, ctx.sampleRate) : null, state: tuner.get() };
};
