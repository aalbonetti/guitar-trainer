// Runs graded timing attempts and strum calibration. Lives outside UI components (a fold is a resize,
// so the attempt must survive re-renders). UI reads the `attempt` store and calls start/cancel.
import { Store } from '../store';
import * as db from '../db';
import { OnsetDetector, BandOnsetDetector } from '../dsp/dsp.js';
import { acquireCapture, releaseCapture, onBlock, playClickPlan, cancelClickPlan, ctxNow, waitUntil, sampleRate, capture, audioContext } from '../audio/engine';
import { buildPlan, gradeTiming, lessonFeel, calibrationOffset, bleedDelay, ladderStart, ladderStep, type Plan, type TimingResult, type Ladder, type TimingCriteria } from './timing';
import { recordAttempt } from '../progressStore';
import type { Catalog, Lesson } from '../catalog';
import type { Event } from '../progress';

export type Phase = 'idle' | 'starting' | 'countin' | 'playing' | 'result' | 'error';
export interface AttemptState {
  phase: Phase; kind: 'timing' | 'calibration' | null; lessonId: string | null;
  heard: number; expected: number; beat: number; step: number; bpm: number;
  result: TimingResult | null; event: Event | null; ladder: Ladder | null; message: string;
  cal: { offsetMs: number; spreadMs: number; matched: number } | null;
  prevLadderBpm?: number;
}
export const attempt = new Store<AttemptState>({ phase: 'idle', kind: null, lessonId: null, heard: 0, expected: 0, beat: -1, step: -1, bpm: 0, result: null, event: null, ladder: null, message: '', cal: null });

// ---------- calibration storage (per input route and fold posture, §7) ----------
export const posture = () => (window.innerWidth >= 600 ? 'unfolded' : 'folded');
export interface Calibration { key: string; input_route: string; posture: string; offset_ms: number; spread_ms: number; method: 'strum'; measured_at: number }
const calKey = (route: string, p = posture()) => `${route}|${p}`;
export async function getCalibration(route: string): Promise<Calibration | undefined> {
  try { return await db.get<Calibration>('calibration', calKey(route)); } catch { return undefined; }
}
export async function allCalibrations(): Promise<Calibration[]> { try { return await db.getAll<Calibration>('calibration'); } catch { return []; } }
/** The route name used for calibration: the input's label once the mic is open, else the chosen device. */
export function routeName(): string { return capture.get().label || 'microphone'; }

// ---------- tempo ladder storage ----------
export async function getLadder(l: Lesson): Promise<Ladder> {
  const target = (l.pass_criteria as unknown as TimingCriteria).bpm;
  try { const row = await db.get<{ key: string; v: Ladder }>('kv', `ladder:${l.id}`); if (row) return row.v; } catch { /* ignore */ }
  return ladderStart(target);
}
async function saveLadder(l: Lesson, v: Ladder) { try { await db.put('kv', { key: `ladder:${l.id}`, v }); } catch { /* ignore */ } }

// ---------- shared listening ----------
let cancelled = { cancelled: false };
let unsub: (() => void) | null = null;
const WHO = 'grader';

function finish() { unsub?.(); unsub = null; cancelClickPlan(); releaseCapture(WHO); }
export function cancelAttempt() {
  cancelled.cancelled = true; finish();
  attempt.set({ phase: 'idle', kind: null, beat: -1, message: '' });
}

/** Count-in learns the click-bleed level (and when bleed arrives); then collect onsets until `end`. */
async function listen(plan: { countIn: number[]; clicks: { t: number }[]; end: number }, onOnset: (t: number) => void, sig: { cancelled: boolean }, beatTimes: number[], steps?: { t0: number; dur: number; grid: number }) {
  const sr = sampleRate();
  const det = new OnsetDetector(sr), band = new BandOnsetDetector(sr, 1800, 3200);
  const clickOn: number[] = [];
  let counting = true;
  unsub = onBlock((d, f) => {
    if (counting) band.push(d, f).forEach(fr => clickOn.push(fr / sr));
    det.push(d, f).forEach(fr => { if (!counting) onOnset(fr / sr); });
  });
  const firstPlayed = plan.clicks[plan.countIn.length]?.t ?? plan.end;
  // visuals follow what you hear: lag the clock by the output latency
  const lag = (() => { const c = audioContext(); return c.outputLatency || c.baseLatency || 0; })();
  const beatTimer = window.setInterval(() => {
    const now = ctxNow() - lag; let b = -1; beatTimes.forEach((t, i) => { if (t <= now) b = i; });
    const st = steps && now >= steps.t0 && now < plan.end ? Math.floor((now - steps.t0) / steps.dur) % steps.grid : -1;
    if (b !== attempt.get().beat || st !== attempt.get().step) attempt.set({ beat: b, step: st });
  }, 20);
  try {
    await waitUntil(firstPlayed - 0.08, sig);
    counting = false;
    det.learnBleed();
    const arrive = bleedDelay(clickOn, plan.countIn);
    const clickTimes = plan.clicks.map(c => c.t);
    det.isNearClick = arrive === null ? null : (fr: number) => clickTimes.some(t => Math.abs(fr / sr - (t + arrive)) < 0.03);
    attempt.set({ phase: 'playing' });
    await waitUntil(plan.end + 0.45, sig);
  } finally { clearInterval(beatTimer); }
}

/** Test-only hook: lets the headless test play strums into the simulated input. */
const simAuto = (kind: string, times: number[]) => (globalThis as any).__gtSimAuto?.(kind, times);

// ---------- strum calibration ----------
export async function runCalibration(deviceId?: string) {
  cancelled = { cancelled: false }; const sig = cancelled;
  attempt.set({ phase: 'starting', kind: 'calibration', lessonId: null, heard: 0, expected: 16, beat: -1, bpm: 80, result: null, event: null, cal: null, message: '' });
  try {
    await acquireCapture(WHO, deviceId);
    const beat = 0.75, t0 = ctxNow() + 0.5;
    const countIn = [0, 1, 2, 3].map(i => t0 + i * beat), targets = Array.from({ length: 16 }, (_, i) => t0 + (4 + i) * beat);
    const clicks = [...countIn, ...targets].map((t, i) => ({ t, kind: (i % 4 === 0 ? 0 : 1) as 0 | 1 }));
    playClickPlan(clicks);
    attempt.set({ phase: 'countin' });
    simAuto('calibration', targets);
    const on: number[] = [];
    await listen({ countIn, clicks, end: targets[15] }, t => { on.push(t); attempt.set({ heard: on.length }); }, sig, [...countIn, ...targets]);
    if (sig.cancelled) return;
    finish();
    const c = calibrationOffset(on, targets);
    if (!c) { attempt.set({ phase: 'error', message: `Only heard ${on.length} strums. Strum the muted strings a bit harder, close to the phone, and try again.` }); return; }
    const route = routeName();
    await db.put('calibration', { key: calKey(route), input_route: route, posture: posture(), offset_ms: Math.round(c.offsetMs * 10) / 10, spread_ms: Math.round(c.spreadMs * 10) / 10, method: 'strum', measured_at: Date.now() } satisfies Calibration).catch(() => undefined);
    attempt.set({ phase: 'result', cal: c, message: c.spreadMs > 25 ? 'That was a bit uneven. It’s saved, but running it again will make grades fairer.' : 'Saved for this input and posture.' });
  } catch (err) {
    finish(); if (!sig.cancelled) attempt.set({ phase: 'error', message: (err as Error).message || 'Microphone not available' });
  }
}

// ---------- graded timing attempt ----------
export async function runTimingAttempt(l: Lesson, cat: Catalog, opts: { bpm?: number; deviceId?: string } = {}) {
  cancelled = { cancelled: false }; const sig = cancelled;
  const crit = l.pass_criteria as unknown as TimingCriteria;
  const ladder = await getLadder(l);
  const bpm = opts.bpm ?? ladder.bpm;
  attempt.set({ phase: 'starting', kind: 'timing', lessonId: l.id, heard: 0, expected: 0, beat: -1, bpm, result: null, event: null, ladder, cal: null, message: '' });
  try {
    await acquireCapture(WHO, opts.deviceId);
    const cal = await getCalibration(routeName());
    if (!cal) { finish(); attempt.set({ phase: 'error', message: 'needs-calibration' }); return; }
    const feel = lessonFeel(l, cat);
    const accents = feel.patternId ? (cat.strums.find(s => s.id === feel.patternId)?.accents || []) : [];
    const plan: Plan = buildPlan(feel, bpm, crit.bars, ctxNow() + 0.5, accents);
    (globalThis as any).__gtLastPlan = { plan, offsetMs: cal.offset_ms };
    attempt.set({ expected: plan.slots.filter(s => s.expected).length });
    playClickPlan(plan.clicks);
    attempt.set({ phase: 'countin' });
    simAuto('timing', plan.slots.filter(s => s.expected).map(s => s.t));
    const on: number[] = [];
    await listen(plan, t => { on.push(t); attempt.set({ heard: on.length }); }, sig, plan.clicks.map(c => c.t), { t0: plan.slots[0].t, dur: plan.slotDur, grid: feel.grid });
    if (sig.cancelled) return;
    finish();
    const r = gradeTiming(on, plan, cal.offset_ms, crit.max_err_ms);
    const atTarget = bpm >= crit.bpm;
    // The ladder moves only on attempts at its own tempo; a clean try above it lifts it to that tempo.
    const next = bpm === ladder.bpm ? ladderStep(ladder, crit.bpm, r) : r.clean && bpm > ladder.bpm ? { bpm: Math.min(bpm, crit.bpm), clean: 0, sloppy: 0 } : ladder;
    await saveLadder(l, next);
    const event = await recordAttempt(l, { met: r.met, atTarget, score: Math.round(r.slotsRight * 100) / 100, mode: 'auto',
      metrics: { bpm, maeMs: +r.maeMs.toFixed(1), biasMs: +r.biasMs.toFixed(1), hitRatio: +r.hitRatio.toFixed(3), extras: r.extras, offsetMs: cal.offset_ms, route: cal.input_route, posture: cal.posture } });
    attempt.set({ phase: 'result', result: r, event, ladder: next, prevLadderBpm: ladder.bpm, beat: -1, step: -1 });
  } catch (err) {
    finish(); if (!sig.cancelled) attempt.set({ phase: 'error', message: (err as Error).message || 'Microphone not available' });
  }
}
