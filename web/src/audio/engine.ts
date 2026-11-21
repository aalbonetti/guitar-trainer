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
async function updateWakeLock(attempt = false) {
  const want = attempt || metro.get().running || tuner.get().on || planTimer !== null;
  try {
    if (want && !wake && 'wakeLock' in navigator) wake = await (navigator as any).wakeLock.request('screen');
    if (!want && wake) { await wake.release(); wake = null; }
  } catch { /* not fatal */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wake = null; void updateWakeLock(); } });

// ---------- metronome ----------
// Accent 2600 Hz, beat 2000 Hz, subdivision 1500 Hz quieter. 2 ms raised-cosine attack, 6 ms decay.
function click(t: number, kind: 0 | 1 | 2, vol: number): OscillatorNode {
  const c = audioContext();
  const o = c.createOscillator(), g = c.createGain();
  o.frequency.value = kind === 0 ? 2600 : kind === 1 ? 2000 : 1500;
  const v = vol * (kind === 2 ? 0.45 : 1);
  g.gain.setValueAtTime(0, t);
  g.gain.setValueCurveAtTime(new Float32Array([0, 0.146, 0.5, 0.854, 1].map(x => x * v)), t, 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, 0.006);
  o.connect(g); g.connect(c.destination);
  if (SIM && simBus) { const d = c.createDelay(0.5); d.delayTime.value = 0.09; const b = c.createGain(); b.gain.value = 0.25; g.connect(d); d.connect(b); b.connect(simBus); }
  o.start(t); o.stop(t + 0.06);
  return o;
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

// ---------- mic capture (shared by the tuner and the graders) ----------
// The worklet posts 512-sample blocks tagged with the context frame of their first sample, so every
// input sample has an exact AudioContext time. Subscribers get every block; the ring feeds the tuner.
const WORKLET = `class Cap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(512);this.n=0;this.s=0;}
process(i){const c=i[0]&&i[0][0];if(!c)return true;for(let k=0;k<c.length;k++){if(!this.n)this.s=currentFrame+k;this.b[this.n++]=c[k];
if(this.n===512){this.port.postMessage({f:this.s,d:this.b.slice(0)});this.n=0;}}return true;}}registerProcessor('cap',Cap);`;
export interface CaptureState { on: boolean; label: string; error: string | null; gaps: number }
export const capture = new Store<CaptureState>({ on: false, label: '', error: null, gaps: 0 });
type BlockFn = (d: Float32Array, frame: number) => void;
const blockSubs = new Set<BlockFn>();
/** Subscribe to raw input blocks (Float32Array of 512 samples, absolute context frame of sample 0). */
export function onBlock(fn: BlockFn): () => void { blockSubs.add(fn); return () => { blockSubs.delete(fn); }; }
let stream: MediaStream | null = null, node: AudioWorkletNode | null = null, srcNode: AudioNode | null = null;
let workletReady: Promise<void> | null = null, openDevice: string | undefined;
const users = new Set<string>();
const RING = 48000 * 4; const ring = new Float32Array(RING); let wAbs = 0;

// Test-only simulated input (?sim in the URL): strums synthesized on the same AudioContext and fed to the
// capture worklet instead of the mic, so the full DSP path can be checked in headless Chrome.
const SIM = typeof location !== 'undefined' && /[?&]sim\b/.test(location.search);
let simBus: GainNode | null = null;

/** Open the mic (or keep it open) for `who`. Reopens if a different input is asked for. */
export async function acquireCapture(who: string, deviceId?: string): Promise<void> {
  const c = audioContext();
  users.add(who);
  if (node && openDevice === deviceId) return;
  closeStream();
  try {
    if (!workletReady) workletReady = c.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
    let label = 'simulated input';
    if (SIM) { simBus = simBus || c.createGain(); srcNode = simBus; }
    else {
      const audio: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      if (deviceId) audio.deviceId = { exact: deviceId };
      stream = await navigator.mediaDevices.getUserMedia({ audio });
      srcNode = c.createMediaStreamSource(stream);
      label = stream.getAudioTracks()[0]?.label || 'microphone';
    }
    await workletReady;
    node = new AudioWorkletNode(c, 'cap'); wAbs = 0;
    node.port.onmessage = (e: MessageEvent) => {
      const { f, d } = e.data as { f: number; d: Float32Array };
      if (wAbs && f > wAbs) capture.set({ gaps: capture.get().gaps + 1 });
      for (let i = 0; i < d.length; i++) ring[(f + i) % RING] = d[i];
      wAbs = f + d.length;
      blockSubs.forEach(fn => fn(d, f));
    };
    const sink = c.createGain(); sink.gain.value = 0;
    srcNode.connect(node); node.connect(sink); sink.connect(c.destination);
    openDevice = deviceId;
    capture.set({ on: true, label, error: null });
  } catch (err) {
    users.delete(who);
    capture.set({ on: false, error: (err as Error).message || 'Microphone not available' });
    throw err;
  }
}
/** Release `who`'s hold on the mic; it closes when nobody needs it. */
export function releaseCapture(who: string) {
  users.delete(who);
  if (!users.size) closeStream();
}
function closeStream() {
  try { if (srcNode && srcNode !== simBus) srcNode.disconnect(); else if (srcNode && node) srcNode.disconnect(node); node?.disconnect(); } catch { /* ignore */ }
  stream?.getTracks().forEach(t => t.stop());
  stream = null; node = null; srcNode = null; openDevice = undefined;
  if (capture.get().on) capture.set({ on: false });
}
/** Copy `n` samples starting at absolute frame `from` out of the ring buffer (last ~4 s only). */
export function grab(from: number, n: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ring[((from + i) % RING + RING) % RING];
  return out;
}

// ---------- tuner ----------
let tunerRaf = 0, lastPitchAt = 0;
const smooth: number[] = [];
export async function startTuner(deviceId?: string) {
  try {
    if (tuner.get().on) stopTuner(false);
    await acquireCapture('tuner', deviceId);
    tuner.set({ on: true, error: null, input: capture.get().label });
    tunerRaf = requestAnimationFrame(tunerLoop);
    void updateWakeLock();
  } catch (err) {
    tuner.set({ on: false, error: (err as Error).message || 'Microphone not available' });
  }
}
export function stopTuner(update = true) {
  cancelAnimationFrame(tunerRaf);
  releaseCapture('tuner'); smooth.length = 0;
  if (update) { tuner.set({ on: false, note: null, level: 0 }); void updateWakeLock(); }
}
function tunerLoop(ts: number) {
  if (!tuner.get().on) return;
  if (ts - lastPitchAt > 40 && ctx) {
    lastPitchAt = ts;
    const n = 2048, buf = grab(wAbs - n, n);
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
/** Has the tuner been used since the app was opened? (The attempt runner offers a quick tune if not.) */
export let tunedThisSession = false;
tuner.subscribe(t => { if (t.note) tunedThisSession = true; });

// ---------- click plans (graded attempts) ----------
// A fixed list of clicks at exact context times, scheduled by the same ~200 ms look-ahead loop as the
// metronome. Cancel stops anything already scheduled.
export interface PlannedClick { t: number; kind: 0 | 1 | 2 }
let planTimer: number | null = null; const planNodes: OscillatorNode[] = [];
export function playClickPlan(clicks: PlannedClick[], vol = metro.get().volume) {
  cancelClickPlan();
  stopMetronome();
  const c = audioContext(); let i = 0;
  const tick = () => {
    while (i < clicks.length && clicks[i].t < c.currentTime + 0.2) { planNodes.push(click(clicks[i].t, clicks[i].kind, vol)); i++; }
    while (planNodes.length > 64) planNodes.shift();
    if (i >= clicks.length && planTimer !== null) { clearInterval(planTimer); planTimer = null; }
  };
  tick(); planTimer = window.setInterval(tick, 25);
  void updateWakeLock(true);
}
export function cancelClickPlan() {
  if (planTimer !== null) clearInterval(planTimer);
  planTimer = null;
  const now = ctx?.currentTime ?? 0;
  planNodes.splice(0).forEach(o => { try { o.stop(now); } catch { /* already stopped */ } });
  void updateWakeLock();
}
export function ctxNow(): number { return audioContext().currentTime; }
/** Resolve when the AudioContext clock reaches `t` (polls; only for waiting, never for timing sound). */
export function waitUntil(t: number, signal?: { cancelled: boolean }): Promise<void> {
  return new Promise(res => { const f = () => { if (signal?.cancelled || audioContext().currentTime >= t) res(); else setTimeout(f, 20); }; f(); });
}
export function sampleRate(): number { return audioContext().sampleRate; }
/** Bluetooth output adds 150–300 ms; timing grades are blocked while it's active. Best guess from labels + latency. */
export async function bluetoothOutputLikely(): Promise<boolean> {
  try {
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput');
    const def = outs.find(d => d.deviceId === 'default') || outs[0];
    if (def && /bluetooth|airpods|buds|headset \(bt\)|a2dp/i.test(def.label)) return true;
  } catch { /* ignore */ }
  const c = audioContext();
  return (c.outputLatency || 0) > 0.12;
}
/** Test-only: play synthetic strums (context times) into the simulated input. */
(globalThis as any).__gtSimStrums = (times: number[], gain = 0.8) => {
  if (!SIM) return false;
  const c = audioContext(); simBus = simBus || c.createGain();
  for (const t of times) [43, 47, 50, 55, 59, 67].forEach((m, ni) => {
    const s = c.createBufferSource(); s.buffer = pluckBuffer(c, m, 0.6);
    const g = c.createGain(); g.gain.value = gain;
    s.connect(g); g.connect(simBus!); s.start(Math.max(c.currentTime, t + ni * 0.004));
  });
  return true;
};
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
  let pk = 0; for (const x of grab(wAbs - 4096, 4096)) pk = Math.max(pk, Math.abs(x));
  const buf = grab(wAbs - 2048, 2048);
  return { ctx: ctx?.state, sr: ctx?.sampleRate, framesIn: wAbs, recentPeak: pk, tunerOn: tuner.get().on, capture: capture.get(), sim: SIM, yin: ctx ? yin(buf, ctx.sampleRate) : null, state: tuner.get() };
};

// ---------- plucked-string synth (Karplus-Strong) for ear training and "hear this chord" ----------
function pluckBuffer(c: AudioContext, midi: number, dur = 2.2): AudioBuffer {
  const sr = c.sampleRate, n = Math.floor(sr * dur), f = 440 * Math.pow(2, (midi - 69) / 12);
  const N = Math.max(2, Math.round(sr / f + 0.5)); // this KS variant sounds at sr/(N-0.5)
  const buf = c.createBuffer(1, n, sr), out = buf.getChannelData(0), ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
  let p = 0; const damp = 0.996 - Math.max(0, midi - 60) * 0.0004;
  for (let i = 0; i < n; i++) { const q = (p + 1) % N; out[i] = ring[p] * 0.35; ring[p] = damp * 0.5 * (ring[p] + ring[q]); p = q; }
  return buf;
}
/** Strum chords (arrays of MIDI notes), one after another, `gapS` apart. */
export function playChords(chords: number[][], gapS = 1.1) {
  const c = audioContext(); const t0 = c.currentTime + 0.05;
  chords.forEach((notes, ci) => notes.forEach((m, ni) => {
    const s = c.createBufferSource(); s.buffer = pluckBuffer(c, m);
    const g = c.createGain(); g.gain.value = 0.6;
    s.connect(g); g.connect(c.destination); s.start(t0 + ci * gapS + ni * 0.018);
  }));
}
