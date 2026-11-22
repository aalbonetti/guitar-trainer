// App-wide audio engine. Lives outside UI components so folding/unfolding or changing screens never
// stops the click or the tuner. Clicks are scheduled on the AudioContext clock (never by timers).
import { yin, noteInfo } from '../dsp/dsp.js';
import { Store, persisted } from '../store';
import { meterInfo, meterFrom, fitSub, defaultAccents, clickKind, lightOf, isMeter, type Meter } from './meter';

/** `beats` = pulses per bar (2 in 6/8), `sub` = clicks per pulse, `light` = the lit beat (or eighth in 6/8). */
export interface MetroState { running: boolean; bpm: number; beats: number; sub: number; volume: number; beat: number; tick: number; meter: Meter; accents: number[]; light: number }
export interface TunerState { on: boolean; note: string | null; cents: number; freq: number; level: number; error: string | null; input: string }

export const metro = new Store<MetroState>({ running: false, bpm: 80, beats: 4, sub: 1, volume: 0.8, beat: -1, tick: -1, meter: '4/4', accents: [0], light: -1 });
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
const queue: { t: number; tick: number; light: number | null }[] = [];
function schedule() {
  const c = audioContext(), s = metro.get();
  while (nextT < c.currentTime + 0.15) {
    const perBeat = s.sub, inBar = s.beats * perBeat, pos = tickN % inBar;
    click(nextT, clickKind(pos, perBeat, s.meter, s.accents), s.volume);
    queue.push({ t: nextT, tick: tickN, light: lightOf(pos, perBeat, s.meter) });
    tickN++;
    nextT += 60 / s.bpm / perBeat;
  }
}
function visual() {
  if (!metro.get().running || !ctx) return;
  const now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  let cur: { t: number; tick: number; light: number | null } | undefined;
  while (queue.length && queue[0].t <= now) cur = queue.shift();
  if (cur) { const s = metro.get(); metro.set({ tick: cur.tick, beat: Math.floor(cur.tick / s.sub) % s.beats, ...(cur.light !== null ? { light: cur.light } : {}) }); }
  requestAnimationFrame(visual);
}
export type MetroPreset = Partial<Pick<MetroState, 'bpm' | 'beats' | 'sub' | 'volume' | 'accents'>> & { meter?: string };
/** Resolve meter/beats/sub/accents so they always agree. A preset with only beats + sub gets its meter from them. */
function resolve(p: MetroPreset): Partial<MetroState> {
  const cur = metro.get(), out: Partial<MetroState> = { ...p } as Partial<MetroState>;
  if (p.bpm !== undefined) out.bpm = Math.max(30, Math.min(300, Math.round(p.bpm)));
  const meterGiven = isMeter(p.meter), shapeGiven = meterGiven || p.beats !== undefined;
  if (shapeGiven) {
    const m: Meter = meterGiven ? p.meter as Meter : meterFrom(p.beats!, p.sub ?? cur.sub);
    out.meter = m; out.beats = meterInfo(m).beats;
    // switching between simple and compound starts from that meter's default subdivision (eighths in 6/8)
    const kindChanged = meterInfo(m).compound !== meterInfo(cur.meter).compound;
    out.sub = p.sub !== undefined ? fitSub(m, p.sub) : kindChanged ? fitSub(m, 0) : fitSub(m, cur.sub);
    if (m !== cur.meter && p.accents === undefined) out.accents = defaultAccents(m);
  } else {
    delete out.meter;
    if (p.sub !== undefined) out.sub = fitSub(cur.meter, p.sub);
  }
  if (out.accents) out.accents = out.accents.filter(i => i >= 0 && i < meterInfo(out.meter || cur.meter).lights);
  return out;
}
export function startMetronome(opts: MetroPreset = {}) {
  const c = audioContext();
  stopMetronome();
  metro.set({ ...resolve(opts), running: true, beat: -1, tick: -1, light: -1 });
  nextT = c.currentTime + 0.08; tickN = 0; queue.length = 0;
  schedule();
  timer = window.setInterval(schedule, 25);
  requestAnimationFrame(visual);
  void updateWakeLock();
}
export function stopMetronome() {
  if (timer !== null) clearInterval(timer);
  timer = null; queue.length = 0;
  if (metro.get().running) metro.set({ running: false, beat: -1, tick: -1, light: -1 });
  void updateWakeLock();
}
/** Change settings. A new meter or subdivision restarts a running click at bar 1; accents apply from the next click. */
export function setMetro(p: MetroPreset) {
  const cur = metro.get(), r = resolve(p);
  const restart = cur.running && ((r.meter !== undefined && r.meter !== cur.meter) || (r.sub !== undefined && r.sub !== cur.sub));
  metro.set(r);
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
// Multichannel inputs (the Kemper over USB can show up with several channels): the worklet reports the
// channel count, forwards only the chosen channel to the analyzers, and sends per-channel peaks so the
// Settings picker can show which channel carries the guitar.
const WORKLET = `class Cap extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(512);this.n=0;this.s=0;this.ch=0;this.nc=-1;this.pk=new Float32Array(1);
this.port.onmessage=e=>{if(e.data&&e.data.ch!=null)this.ch=e.data.ch|0;};}
process(i){const inp=i[0];if(!inp||!inp.length)return true;
if(inp.length!==this.nc){this.nc=inp.length;this.pk=new Float32Array(inp.length);this.port.postMessage({chs:inp.length});}
for(let q=0;q<inp.length;q++){const x=inp[q];let m=this.pk[q];for(let k=0;k<x.length;k++){const a=x[k]<0?-x[k]:x[k];if(a>m)m=a;}this.pk[q]=m;}
const c=inp[Math.min(this.ch,inp.length-1)];
for(let k=0;k<c.length;k++){if(!this.n)this.s=currentFrame+k;this.b[this.n++]=c[k];
if(this.n===512){this.port.postMessage({f:this.s,d:this.b.slice(0),pk:this.pk.slice(0)});this.pk.fill(0);this.n=0;}}return true;}}registerProcessor('cap',Cap);`;
/** `channels`: how many the input delivers; `channel`: the one analyzed (0-based). */
export interface CaptureState { on: boolean; label: string; error: string | null; gaps: number; channels: number; channel: number }
export const capture = new Store<CaptureState>({ on: false, label: '', error: null, gaps: 0, channels: 1, channel: 0 });
/** Channel to analyze, per input route (track label). Default channel 1 (index 0). */
export const channelPref = persisted<Record<string, number>>('gt_input_channel', {});
export function channelFor(label: string): number { return channelPref.get()[label] ?? 0; }
/** Pick the channel to grade from, for the input that's open now. Remembered for that input. */
export function setInputChannel(ch: number) {
  const label = capture.get().label;
  if (label) channelPref.set({ ...channelPref.get(), [label]: ch });
  node?.port.postMessage({ ch });
  capture.set({ channel: Math.min(ch, Math.max(0, capture.get().channels - 1)) });
}
/** Input route for display: the input's label, plus the channel when the input has more than one. */
export function routeLabel(): string {
  const c = capture.get();
  return (c.label || 'microphone') + (c.channels > 1 ? ` · ch ${c.channel + 1}` : '');
}
/** Live per-channel input peaks (about 10 updates a second), only while someone watches. */
export const levels = new Store<{ peaks: number[] }>({ peaks: [] });
let levelWatchers = 0, levelAcc: number[] = [], levelAt = 0;
export function watchLevels(): () => void { levelWatchers++; return () => { levelWatchers = Math.max(0, levelWatchers - 1); }; }
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
// ?sim&simchs=4&simch=3 makes it a 4-channel input with the guitar on channel 3 and a steady 440 Hz
// decoy tone on the others, to check that only the chosen channel reaches the analyzers.
const SIM = typeof location !== 'undefined' && /[?&]sim\b/.test(location.search);
const simQ = (k: string, d: number) => { const m = typeof location !== 'undefined' ? new RegExp(`[?&]${k}=(\\d+)`).exec(location.search) : null; return m ? +m[1] : d; };
const SIM_CHS = SIM ? Math.max(1, Math.min(8, simQ('simchs', 1))) : 1, SIM_CH = Math.min(SIM_CHS, Math.max(1, simQ('simch', 1))) - 1;
let simBus: GainNode | null = null, simMerge: ChannelMergerNode | null = null;
function simSource(c: AudioContext): AudioNode {
  simBus = simBus || c.createGain();
  if (!simMerge) {
    simMerge = c.createChannelMerger(SIM_CHS);
    simBus.connect(simMerge, 0, SIM_CH);
    for (let i = 0; i < SIM_CHS; i++) if (i !== SIM_CH) {
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 440; g.gain.value = 0.3;
      o.connect(g); g.connect(simMerge, 0, i); o.start();
    }
  }
  return simMerge;
}

/** Open the mic (or keep it open) for `who`. Reopens if a different input is asked for. */
export async function acquireCapture(who: string, deviceId?: string): Promise<void> {
  const c = audioContext();
  users.add(who);
  if (node && openDevice === deviceId) return;
  closeStream();
  try {
    if (!workletReady) workletReady = c.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
    let label = 'simulated input';
    if (SIM) srcNode = simSource(c);
    else {
      // up to 8 channels, as in the M0 page (a USB interface may offer several; a phone mic gives 1 or 2)
      const audio: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 8 } };
      if (deviceId) audio.deviceId = { exact: deviceId };
      stream = await navigator.mediaDevices.getUserMedia({ audio });
      srcNode = c.createMediaStreamSource(stream);
      label = stream.getAudioTracks()[0]?.label || 'microphone';
    }
    await workletReady;
    node = new AudioWorkletNode(c, 'cap', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max' }); wAbs = 0;
    const want = channelFor(label);
    node.port.postMessage({ ch: want });
    node.port.onmessage = (e: MessageEvent) => {
      if (e.data.chs != null) { const n = e.data.chs as number; capture.set({ channels: n, channel: Math.min(channelFor(capture.get().label), n - 1) }); return; }
      const { f, d, pk } = e.data as { f: number; d: Float32Array; pk?: Float32Array };
      if (levelWatchers && pk) {
        pk.forEach((v, i) => { levelAcc[i] = Math.max(levelAcc[i] || 0, v); });
        const now = performance.now();
        if (now - levelAt > 100) { levels.set({ peaks: levelAcc.slice(0, pk.length) }); levelAcc = []; levelAt = now; }
      }
      if (wAbs && f > wAbs) capture.set({ gaps: capture.get().gaps + 1 });
      for (let i = 0; i < d.length; i++) ring[(f + i) % RING] = d[i];
      wAbs = f + d.length;
      blockSubs.forEach(fn => fn(d, f));
    };
    const sink = c.createGain(); sink.gain.value = 0;
    srcNode.connect(node); node.connect(sink); sink.connect(c.destination);
    openDevice = deviceId;
    capture.set({ on: true, label, error: null, channel: want, channels: 1 });
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
  try { srcNode?.disconnect(); node?.disconnect(); } catch { /* ignore */ }
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
    tuner.set({ on: true, error: null, input: routeLabel() });
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
capture.subscribe(() => { if (tuner.get().on && tuner.get().input !== routeLabel()) tuner.set({ input: routeLabel() }); });
/** Has the tuner been used since the app was opened? (The attempt runner offers a quick tune if not.) */
export let tunedThisSession = false;
tuner.subscribe(t => { if (t.note && !tunedThisSession) { tunedThisSession = true; tunedHook?.(); } });
let tunedHook: (() => void) | null = null;
/** Lets the practice session note when you tuned, without the engine importing it. */
export function onFirstTune(f: () => void) { tunedHook = f; }

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
/** Test-only: one synthesized note into the simulated input. Sine + decaying harmonics, with optional
 *  detune (cents), vibrato (depth in cents, rate in Hz), a bend (semitones, starting `bendAt` s in, taking
 *  `bendDur` s), a slow attack (volume swell) and `pure` for a near-sine harmonic. Times are context seconds. */
export interface SimNote { midi: number; t: number; dur?: number; cents?: number; gain?: number; vib?: number; vibHz?: number; bend?: number; bendAt?: number; bendDur?: number; attack?: number; pure?: boolean }
(globalThis as any).__gtSimNotes = (notes: SimNote[]) => {
  if (!SIM) return false;
  const c = audioContext(); simBus = simBus || c.createGain();
  for (const n of notes) {
    const s = c.createBufferSource(); s.buffer = simNoteBuffer(c, n);
    s.connect(simBus); s.start(Math.max(c.currentTime, n.t));
  }
  return true;
};
function simNoteBuffer(c: AudioContext, n: SimNote): AudioBuffer {
  const sr = c.sampleRate, dur = n.dur ?? 0.8, len = Math.floor(sr * (dur + 0.05));
  const buf = c.createBuffer(1, len, sr), out = buf.getChannelData(0);
  const f0 = 440 * Math.pow(2, (n.midi - 69 + (n.cents || 0) / 100) / 12);
  const amps = n.pure ? [1, 0.04] : [1, 0.6, 0.35, 0.22, 0.12, 0.07];
  const ph = amps.map(() => Math.random() * Math.PI * 2);
  const att = Math.max(0.002, n.attack ?? 0.004), g = n.gain ?? 0.5;
  const bend = n.bend || 0, bAt = n.bendAt ?? 0.08, bDur = n.bendDur ?? 0.15;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let semis = 0;
    if (bend) semis += bend * Math.min(1, Math.max(0, (t - bAt) / bDur));
    if (n.vib) semis += (n.vib / 100) * Math.sin(2 * Math.PI * (n.vibHz || 5.5) * t);
    const f = f0 * Math.pow(2, semis / 12);
    const env = Math.min(1, t / att) * (n.attack && n.attack > 0.05 ? 1 : Math.exp(-t * 1.8)) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.05) : 1);
    let v = 0;
    for (let h = 0; h < amps.length; h++) {
      if (f * (h + 1) > sr / 2.2) break;
      ph[h] += 2 * Math.PI * f * (h + 1) / sr;
      v += amps[h] * Math.exp(-t * h * 0.9) * Math.sin(ph[h]);
    }
    out[i] = g * env * v * 0.5;
  }
  return buf;
}
/** Soft two-note bell for "time's up" on a practice item. Quiet enough not to startle, clear over a strummed guitar. */
export function chime() {
  const c = audioContext(), t0 = c.currentTime + 0.02;
  [[1046.5, 0], [1568, 0.16]].forEach(([f, dt]) => {
    const o = c.createOscillator(), g = c.createGain(), t = t0 + dt;
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35 * metro.get().volume, t + 0.01); g.gain.setTargetAtTime(0, t + 0.03, 0.35);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 2);
  });
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

(globalThis as any).__gtCtxNow = () => audioContext().currentTime;
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
