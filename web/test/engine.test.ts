// Engine lifecycle: mic opening/closing, tuner, metronome catch-up and cancelling a run, against a fake
// AudioContext whose clock the test moves.
import { describe, it, expect, vi, beforeEach } from 'vitest';

class Param { value = 0; setValueAtTime() {} setValueCurveAtTime() {} setTargetAtTime() {} linearRampToValueAtTime() {} }
const clicks: number[] = [];
const worklets: FakeWorklet[] = [];
let moduleLoads: (() => Promise<void>)[] = [];
const node = () => ({ connect() {}, disconnect: vi.fn() });
class FakeCtx {
  static now = 0;
  state = 'running'; sampleRate = 48000; destination = {}; outputLatency = 0; baseLatency = 0;
  get currentTime() { return FakeCtx.now; }
  audioWorklet = { addModule: vi.fn(() => (moduleLoads.shift() ?? (() => Promise.resolve()))()) };
  createOscillator() { return { ...node(), frequency: new Param(), start: (t: number) => { clicks.push(t); }, stop() {} }; }
  createGain() { return { ...node(), gain: new Param() }; }
  createMediaStreamSource() { return node(); }
  resume() { return Promise.resolve(); }
}
class FakeWorklet {
  posted: any[] = []; disconnect = vi.fn(); connect() {}
  port = { onmessage: null as unknown, postMessage: (m: unknown) => { this.posted.push(m); } };
  constructor() { worklets.push(this); }
}
interface Stream { stopped: boolean; resolve(): void; reject(e: Error): void }
const streams: Stream[] = [];
let autoMic = true;
function getUserMedia() {
  return new Promise((res, rej) => {
    const s: Stream = { stopped: false, resolve: () => res({ getTracks: () => [track], getAudioTracks: () => [track] }), reject: rej };
    const track = { label: 'fake mic', stop: () => { s.stopped = true; } };
    streams.push(s);
    if (autoMic) s.resolve();
  });
}
const rafs = new Map<number, () => void>(); let rafId = 0;
const intervals = new Map<number, () => void>(); let intId = 0;
let onVisibility: () => void = () => undefined;
const doc = { visibilityState: 'visible', addEventListener: (_: string, f: () => void) => { onVisibility = f; } };
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const open = () => streams.filter(s => !s.stopped).length;

async function load() {
  vi.resetModules();
  const engine = await import('../src/audio/engine');
  const runner = await import('../src/grading/runner');
  const listen = await import('../src/games/listen');
  return { engine, runner, listen };
}
beforeEach(() => {
  FakeCtx.now = 0; autoMic = true; moduleLoads = []; doc.visibilityState = 'visible';
  clicks.length = 0; worklets.length = 0; streams.length = 0; rafs.clear(); intervals.clear();
  vi.stubGlobal('AudioContext', FakeCtx);
  vi.stubGlobal('AudioWorkletNode', FakeWorklet);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, enumerateDevices: async () => [] } });
  vi.stubGlobal('window', { innerWidth: 400, setInterval: (f: () => void) => { intervals.set(++intId, f); return intId; } });
  vi.stubGlobal('clearInterval', (id: number) => { intervals.delete(id); });
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => { rafs.set(++rafId, f); return rafId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafs.delete(id); });
});

describe('mic capture', () => {
  it('overlapping requests leave no orphaned stream', async () => {
    const { engine } = await load(); autoMic = false;
    const a = engine.acquireCapture('a', 'one'), b = engine.acquireCapture('b', 'two');
    await tick(); streams[0].resolve(); await tick(); streams[1].resolve(); await Promise.all([a, b]);
    expect(open()).toBe(1);
    engine.releaseCapture('a'); engine.releaseCapture('b');
    expect(open()).toBe(0);
  });
  it('same input requested twice opens one stream', async () => {
    const { engine } = await load();
    await Promise.all([engine.acquireCapture('a'), engine.acquireCapture('b')]);
    expect(streams.length).toBe(1);
  });
  it('letting go while opening closes the stream', async () => {
    const { engine } = await load(); autoMic = false;
    const a = engine.acquireCapture('a'); await tick();
    engine.releaseCapture('a'); streams[0].resolve(); await a;
    expect(open()).toBe(0); expect(worklets.length).toBe(0);
  });
  it('a failed request does not drop a newer one from the same user', async () => {
    const { engine } = await load(); autoMic = false;
    const a = engine.acquireCapture('a'), b = engine.acquireCapture('a');
    a.catch(() => undefined); await tick(); streams[0].reject(new Error('no')); await tick(); streams[1].resolve(); await b;
    await expect(a).rejects.toThrow('no');
    expect(engine.capture.get().on).toBe(true);
  });
  it('retries the worklet after a failed load, and stops that stream', async () => {
    const { engine } = await load(); moduleLoads = [() => Promise.reject(new Error('blocked'))];
    await expect(engine.acquireCapture('a')).rejects.toThrow('blocked');
    expect(open()).toBe(0);
    await engine.acquireCapture('a');
    expect(engine.capture.get().on).toBe(true);
  });
  it('closing tells the processor to stop and drops its listener', async () => {
    const { engine } = await load();
    await engine.acquireCapture('a'); engine.releaseCapture('a');
    expect(worklets[0].posted).toContainEqual({ stop: true });
    expect(worklets[0].port.onmessage).toBeNull();
    expect(worklets[0].disconnect).toHaveBeenCalled();
  });
});

describe('tuner', () => {
  it('stopping a pending start leaves it off', async () => {
    const { engine } = await load(); autoMic = false;
    const p = engine.startTuner(); await tick(); engine.stopTuner(); streams[0].resolve(); await p;
    expect(engine.tuner.get()).toMatchObject({ on: false, error: null });
    expect(open()).toBe(0); expect(rafs.size).toBe(0);
  });
  it('two starts run one loop', async () => {
    const { engine } = await load();
    await Promise.all([engine.startTuner(), engine.startTuner()]);
    expect(engine.tuner.get().on).toBe(true); expect(rafs.size).toBe(1);
  });
  it('stops when the page is hidden, and then counts as tuned', async () => {
    const { engine } = await load();
    await engine.startTuner(); engine.tuner.set({ note: 'E2' });
    expect(engine.tunedThisSession).toBe(false);
    doc.visibilityState = 'hidden'; onVisibility();
    expect(engine.tuner.get().on).toBe(false); expect(open()).toBe(0);
    expect(engine.tunedThisSession).toBe(true);
  });
});

describe('metronome', () => {
  it('keeps one animation frame loop across restarts', async () => {
    const { engine } = await load();
    engine.startMetronome(); engine.startMetronome(); expect(rafs.size).toBe(1);
    engine.stopMetronome(); expect(rafs.size).toBe(0);
  });
  it('skips missed ticks and keeps their numbers', async () => {
    const { engine } = await load();
    engine.startMetronome({ bpm: 60 }); // first tick at 0.08 s, one a second
    clicks.length = 0; FakeCtx.now = 10.5; [...intervals.values()][0]();
    expect(clicks).toEqual([]); // the next one is at 11.08, beyond the look-ahead
    FakeCtx.now = 11; [...intervals.values()][0]();
    expect(clicks.length).toBe(1); expect(clicks[0]).toBeCloseTo(11.08);
    FakeCtx.now = 11.2; [...rafs.values()].at(-1)!();
    expect(engine.metro.get()).toMatchObject({ tick: 11, beat: 3 });
  });
});

describe('cancelling a run', () => {
  const untilPhase = async (get: () => string, p: string) => { for (let i = 0; i < 100 && get() !== p; i++) await tick(); expect(get()).toBe(p); };
  it('while the mic is opening: stays idle, no clicks', async () => {
    const { runner } = await load(); autoMic = false;
    const p = runner.runCalibration(); await tick(); runner.cancelAttempt(); streams[0].resolve(); await p;
    expect(runner.attempt.get().phase).toBe('idle'); expect(clicks.length).toBe(0); expect(open()).toBe(0);
  });
  it('during the count-in: stays idle', async () => {
    const { runner } = await load();
    const p = runner.runCalibration(); await untilPhase(() => runner.attempt.get().phase, 'countin');
    runner.cancelAttempt(); await p;
    expect(runner.attempt.get().phase).toBe('idle'); expect(intervals.size).toBe(0); expect(open()).toBe(0);
  });
  it('a cancelled run does not close the next one', async () => {
    const { runner } = await load(); autoMic = false;
    const first = runner.runCalibration(); await tick(); runner.cancelAttempt();
    const second = runner.runCalibration(); await tick(); streams[0].resolve(); await first; await tick();
    streams[1]?.resolve(); await untilPhase(() => runner.attempt.get().phase, 'countin');
    expect(open()).toBe(1);
    runner.cancelAttempt(); await second;
  });
  it('startTimed: cancelled while reading calibration plays nothing', async () => {
    const { listen } = await load();
    await listen.openEars([40, 64]);
    const sig = { cancelled: false };
    const p = listen.startTimed({ countIn: [1], clicks: [{ t: 0.05, kind: 0 }], start: 2, end: 3 }, sig);
    sig.cancelled = true; listen.closeEars();
    expect(await p).toBeNull(); expect(clicks.length).toBe(0);
  });
});
