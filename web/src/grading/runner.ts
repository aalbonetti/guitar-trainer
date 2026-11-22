// Runs graded timing attempts and strum calibration. Lives outside UI components (a fold is a resize,
// so the attempt must survive re-renders). UI reads the `attempt` store and calls start/cancel.
import { Store } from '../store';
import * as db from '../db';
import { OnsetDetector, BandOnsetDetector } from '../dsp/dsp.js';
import { acquireCapture, releaseCapture, onBlock, playClickPlan, cancelClickPlan, ctxNow, waitUntil, sampleRate, capture, audioContext, routeLabel } from '../audio/engine';
import { buildPlan, gradeTiming, lessonFeel, calibrationOffset, bleedDelay, ladderStart, ladderStep, type Plan, type TimingResult, type Ladder, type TimingCriteria } from './timing';
import { PitchTracker, HoldTracker, segmentNotes, gradeNotes, buildNotePlan, noteTolerance, trackerRange, pitchSetup, midiName, type PitchFrame, type NotesGrade, type PitchSetup } from './pitch';
import { meterInfo } from '../audio/meter';
import type { GraderMode } from './modes';
import { recordAttempt } from '../progressStore';
import type { Catalog, Lesson } from '../catalog';
import type { Event } from '../progress';

export type Phase = 'idle' | 'starting' | 'countin' | 'playing' | 'result' | 'error';
/** Live view of a pitch attempt: one chip per expected note/target, what's heard now and what's expected. */
export interface PitchLive {
  mode: PitchSetup['mode']; labels: string[]; wheres: string[]; status: ('todo' | 'ok' | 'miss')[]; idx: number;
  hearing: string | null; cents: number | null; progress: number; ends: number | null;
  /** timed: 'count' until half a beat before the first note (a pickup comes in mid-bar), then 'play' */
  cue?: 'count' | 'play'; firstBeat?: number;
}
export interface PitchOutcome {
  mode: PitchSetup['mode']; met: boolean; score: number; matched: number; total: number; grade: NotesGrade | null;
  held: { label: string; where: string; ok: boolean; cents: number | null; secs: number | null }[]; graderMode: GraderMode; bpm: number | null;
}
export interface AttemptState {
  phase: Phase; kind: 'timing' | 'calibration' | 'pitch' | null; lessonId: string | null;
  heard: number; expected: number; beat: number; step: number; bpm: number;
  result: TimingResult | null; event: Event | null; ladder: Ladder | null; message: string;
  cal: { offsetMs: number; spreadMs: number; matched: number } | null;
  prevLadderBpm?: number;
  pitch?: PitchLive | null; pitchResult?: PitchOutcome | null;
  /** assisted mode: the result is shown but not saved until you confirm or override it */
  pending?: boolean;
}
export const attempt = new Store<AttemptState>({ phase: 'idle', kind: null, lessonId: null, heard: 0, expected: 0, beat: -1, step: -1, bpm: 0, result: null, event: null, ladder: null, message: '', cal: null, pitch: null, pitchResult: null, pending: false });

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
  const target = (l.pass_criteria as unknown as TimingCriteria).bpm; // timing lessons, and pitch lessons played to a click
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
  cancelled.cancelled = true; finish(); pendingConfirm = null;
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
      metrics: { bpm, maeMs: +r.maeMs.toFixed(1), biasMs: +r.biasMs.toFixed(1), hitRatio: +r.hitRatio.toFixed(3), extras: r.extras, offsetMs: cal.offset_ms, route: cal.input_route, ch: capture.get().channel, posture: cal.posture } });
    attempt.set({ phase: 'result', result: r, event, ladder: next, prevLadderBpm: ladder.bpm, beat: -1, step: -1 });
  } catch (err) {
    finish(); if (!sig.cancelled) attempt.set({ phase: 'error', message: (err as Error).message || 'Microphone not available' });
  }
}

// ---------- graded pitch attempt (M7) ----------
let skipFlag = false, doneFlag = false;
/** Hold mode: give up on the current target and move on (it counts as missed). */
export function skipPitchTarget() { skipFlag = true; }
/** Free mode: you've played everything; grade now. */
export function finishPitchNow() { doneFlag = true; }
const simTimeout = (): number | undefined => (globalThis as any).__gtPitchTimeoutS; // test-only: shorter hold timeout
const setLive = (p: Partial<PitchLive>) => { const cur = attempt.get().pitch; if (cur) attempt.set({ pitch: { ...cur, ...p } }); };

/** Run one pitch attempt. Hold: each target in turn (25 s each). Timed: the exercise to a click at the ladder
 *  tempo. Free: the exercise at your own pace (finishes when every note is heard, or on "I'm done"). */
export async function runPitchAttempt(l: Lesson, cat: Catalog, opts: { bpm?: number; deviceId?: string; mode?: GraderMode } = {}) {
  cancelled = { cancelled: false }; const sig = cancelled;
  skipFlag = false; doneFlag = false; pendingConfirm = null;
  const setup = pitchSetup(l, cat), crit = setup.crit, gm: GraderMode = opts.mode ?? 'auto';
  (globalThis as any).__gtLastPitchSetup = setup; // test-only: ?sim plays notes against it
  const ladder = setup.mode === 'timed' ? await getLadder(l) : null;
  const bpm = setup.mode === 'timed' ? opts.bpm ?? ladder!.bpm : null;
  const items = setup.mode === 'hold' ? setup.targets.map(t => ({ label: t.label, where: t.where })) : setup.expected.map(e => ({ label: e.label, where: e.where }));
  attempt.set({ phase: 'starting', kind: 'pitch', lessonId: l.id, heard: 0, expected: items.length, beat: -1, step: -1, bpm: bpm ?? 0, result: null, event: null, ladder, cal: null, message: '', pending: false, pitchResult: null,
    pitch: { mode: setup.mode, labels: items.map(i => i.label), wheres: items.map(i => i.where), status: items.map(() => 'todo'), idx: 0, hearing: null, cents: null, progress: 0, ends: null } });
  try {
    await acquireCapture(WHO, opts.deviceId);
    const sr = sampleRate();
    const midis = setup.mode === 'hold' ? setup.targets.flatMap(t => [t.midi, t.from ?? t.midi]) : setup.expected.flatMap(e => e.midis);
    const tracker = new PitchTracker(sr, trackerRange(midis)), det = new OnsetDetector(sr);
    const frames: PitchFrame[] = [], onsets: number[] = [];
    (globalThis as any).__gtLastPitchFrames = { frames, onsets }; // test-only diagnostics
    let frameHook: ((f: PitchFrame, onset: boolean) => void) | null = null, oi = 0, liveAt = 0;
    unsub = onBlock((d, f) => {
      det.push(d, f).forEach(x => onsets.push(x / sr));
      for (const fr of tracker.push(d, f)) {
        frames.push(fr);
        let on = false; while (oi < onsets.length && onsets[oi] <= fr.t) { on = true; oi++; }
        frameHook?.(fr, on);
        const now = performance.now();
        if (now - liveAt > 60) { liveAt = now; setLive({ hearing: fr.midi === null || fr.click ? null : midiName(fr.midi), cents: fr.midi === null ? null : (fr.midi - Math.round(fr.midi)) * 100 }); }
      }
    });
    let out: PitchOutcome;
    if (setup.mode === 'hold') out = await holdTargets(setup, sig, h => { frameHook = h; }, gm);
    else if (setup.mode === 'timed') out = await timedNotes(setup, bpm!, sig, frames, onsets, tracker, det, gm);
    else out = await freeNotes(setup, sig, frames, onsets, gm);
    if (sig.cancelled) return;
    finish();
    const route = routeLabel(), cal = await getCalibration(routeName());
    const save = async (accept: boolean) => {
      const met = gm === 'assisted' ? accept : out.met;
      let next = ladder;
      if (setup.mode === 'timed' && ladder && bpm !== null) {
        const g = out.grade!, r = { clean: met, sloppy: !met && g.sloppy, great: met && g.great };
        next = bpm === ladder.bpm ? ladderStep(ladder, crit.bpm!, r) : met && bpm > ladder.bpm ? { bpm: Math.min(bpm, crit.bpm!), clean: 0, sloppy: 0 } : ladder;
        await saveLadder(l, next);
      }
      const atTarget = setup.mode !== 'timed' || (bpm ?? 0) >= crit.bpm!;
      const g = out.grade;
      const event = await recordAttempt(l, { met, atTarget, score: Math.round(out.score * 100) / 100, mode: gm,
        metrics: { mode: setup.mode, bpm, matched: out.matched, total: out.total, detected_met: out.met, route, ch: capture.get().channel, posture: posture(), offsetMs: cal?.offset_ms ?? null,
          ...(g ? { missed: g.notes.filter(n => !n.ok).map(n => `${n.label}${n.heard ? '>' + n.heard : ''}`), meanOffMs: g.meanOffMs === null ? null : Math.round(g.meanOffMs), extras: g.extras } : {}),
          ...(out.held.length ? { cents_dev: out.held.map(h => (h.cents === null ? null : Math.round(h.cents * 10) / 10)) } : {}) } });
      attempt.set({ phase: 'result', event, ladder: next, prevLadderBpm: ladder?.bpm, pending: false, pitchResult: { ...out, met } });
    };
    attempt.set({ phase: 'result', pitchResult: out, beat: -1, step: -1, pending: gm === 'assisted', event: null });
    if (gm === 'assisted') pendingConfirm = save; else await save(out.met);
  } catch (err) {
    finish(); if (!sig.cancelled) attempt.set({ phase: 'error', message: (err as Error).message || 'Microphone not available' });
  }
}
let pendingConfirm: ((accept: boolean) => Promise<void>) | null = null;
/** Assisted mode: count the attempt (accept) or not, after seeing what was detected. Saves it either way. */
export async function confirmPitch(accept: boolean) { const f = pendingConfirm; pendingConfirm = null; if (f) await f(accept); }

async function holdTargets(setup: PitchSetup, sig: { cancelled: boolean }, hook: (h: ((f: PitchFrame, on: boolean) => void) | null) => void, gm: GraderMode): Promise<PitchOutcome> {
  const cents = setup.crit.cents!, per = simTimeout() ?? 25;
  attempt.set({ phase: 'playing' });
  const held: PitchOutcome['held'] = [];
  for (let i = 0; i < setup.targets.length && !sig.cancelled; i++) {
    const tg = setup.targets[i], ht = new HoldTracker(tg, cents);
    let doneAt: number | null = null, last: number | null = null, start = ctxNow();
    const devs: number[] = [];
    hook((f, on) => {
      const st = ht.push(f, on);
      if (st.cents !== null && Math.abs(st.cents) <= cents + 25) { devs.push(st.cents); if (devs.length > 30) devs.shift(); }
      setLive({ progress: st.progress });
      if (st.done && doneAt === null) { doneAt = f.t; last = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : 0; }
    });
    skipFlag = false;
    setLive({ idx: i, progress: 0, ends: start + per });
    simAuto('pitch-hold', [i, start] as unknown as number[]);
    await new Promise<void>(res => { const f = () => (sig.cancelled || doneAt !== null || skipFlag || ctxNow() > start + per ? res() : setTimeout(f, 30)); f(); });
    hook(null);
    const ok = doneAt !== null;
    held.push({ label: tg.label, where: tg.where, ok, cents: ok ? last : null, secs: ok ? doneAt! - start : null });
    const status = [...(attempt.get().pitch?.status || [])]; status[i] = ok ? 'ok' : 'miss';
    setLive({ status, progress: ok ? 1 : 0 });
    if (ok) await new Promise(r => setTimeout(r, 500)); // a beat to see the tick before the next string
  }
  const n = held.filter(h => h.ok).length;
  return { mode: 'hold', met: n === setup.targets.length, score: setup.targets.length ? n / setup.targets.length : 0, matched: n, total: setup.targets.length, grade: null, held, graderMode: gm, bpm: null };
}

function liveGrade(setup: PitchSetup, frames: PitchFrame[], onsets: number[], exp: PitchSetup['expected'], timed: boolean, tolS: number, offsetS: number) {
  return gradeNotes(segmentNotes(frames, onsets), exp, { target: setup.crit.note_accuracy ?? 0.9, timed, anyOctave: !!setup.crit.any_octave, tolS, offsetS });
}

async function timedNotes(setup: PitchSetup, bpm: number, sig: { cancelled: boolean }, frames: PitchFrame[], onsets: number[], tracker: PitchTracker, det: InstanceType<typeof OnsetDetector>, gm: GraderMode): Promise<PitchOutcome> {
  const sr = sampleRate();
  const cal = await getCalibration(routeName()); // read first: the click plan starts 0.5 s from now
  const plan = buildNotePlan(setup.expected, bpm, meterInfo(setup.meter).beats, ctxNow() + 0.5);
  (globalThis as any).__gtLastPitchPlan = plan;
  const band = new BandOnsetDetector(sr, 1800, 3200), clickOn: number[] = [];
  const off = onBlock((d, f) => { if (ctxNow() < plan.start) band.push(d, f).forEach(x => clickOn.push(x / sr)); });
  playClickPlan(plan.clicks);
  attempt.set({ phase: 'countin', bpm });
  simAuto('pitch-timed', plan.expected.map(e => e.t));
  const lag = (() => { const c = audioContext(); return c.outputLatency || c.baseLatency || 0; })();
  const tol = noteTolerance(plan.beat);
  const firstT = plan.expected[0]?.t ?? plan.start;
  setLive({ cue: 'count', firstBeat: Math.round((firstT - plan.start) / plan.beat) % plan.beatsPerBar + 1 });
  let offsetS = (cal?.offset_ms ?? 0) / 1000, gradedAt = 0;
  const beatTimer = window.setInterval(() => {
    const now = ctxNow() - lag; let b = -1; plan.clicks.forEach((c, i) => { if (c.t <= now) b = i; });
    if (b !== attempt.get().beat) attempt.set({ beat: b });
    let idx = 0; plan.expected.forEach((e, i) => { if (e.t <= now + 0.05) idx = i; });
    if (attempt.get().pitch?.idx !== idx) setLive({ idx });
    const cue = now >= firstT - plan.beat / 2 ? 'play' : 'count';
    if (attempt.get().pitch?.cue !== cue) setLive({ cue });
    if (now - gradedAt > 0.3 && now > plan.start) {
      gradedAt = now;
      const g = liveGrade(setup, frames.filter(f => f.t > plan.start - tol), onsets, plan.expected, true, tol, offsetS);
      // a note is settled once its window has passed
      setLive({ status: g.notes.map((n, i) => (n.ok ? 'ok' : plan.expected[i].t + tol + offsetS + 0.1 < ctxNow() ? 'miss' : 'todo')) });
    }
  }, 40);
  try {
    await waitUntil(plan.start - 0.08, sig);
    off();
    det.learnBleed();
    const arrive = bleedDelay(clickOn, plan.countIn);
    if (!cal && arrive !== null) offsetS = arrive; // no strum calibration: the measured click round trip is close enough here
    if (arrive !== null) {
      const arr = plan.clicks.map(c => c.t + arrive);
      det.isNearClick = (fr: number) => arr.some(a => Math.abs(fr / sr - a) < 0.03);
      tracker.isNearClick = (t0, t1) => arr.some(a => a >= t0 - 0.03 && a <= t1 + 0.005);
    }
    attempt.set({ phase: 'playing' });
    await waitUntil(plan.end + 0.6, sig);
  } finally { clearInterval(beatTimer); off(); }
  const fr = frames.filter(f => f.t > plan.start - tol && f.t < plan.end + 0.6);
  const g = liveGrade(setup, fr, onsets.filter(t => t > plan.start - tol), plan.expected, true, tol, offsetS);
  setLive({ status: g.notes.map(n => (n.ok ? 'ok' : 'miss')) });
  return { mode: 'timed', met: g.met, score: g.accuracy, matched: g.matched, total: g.expected, grade: g, held: [], graderMode: gm, bpm };
}

async function freeNotes(setup: PitchSetup, sig: { cancelled: boolean }, frames: PitchFrame[], onsets: number[], gm: GraderMode): Promise<PitchOutcome> {
  const t0 = ctxNow() + 0.2, limit = 10 + 5 * setup.expected.length;
  attempt.set({ phase: 'playing' });
  setLive({ ends: t0 + limit });
  simAuto('pitch-free', [t0]);
  let allAt: number | null = null, g = liveGrade(setup, [], [], setup.expected, false, 0, 0);
  await new Promise<void>(res => {
    const tick = () => {
      if (sig.cancelled) return res();
      g = liveGrade(setup, frames.filter(f => f.t > t0), onsets.filter(t => t > t0), setup.expected, false, 0, 0);
      const lastOk = g.notes.map(n => n.ok).lastIndexOf(true);
      setLive({ status: g.notes.map((n, i) => (n.ok ? 'ok' : i < lastOk ? 'miss' : 'todo')), idx: Math.min(setup.expected.length - 1, lastOk + 1) });
      if (g.matched === g.expected && allAt === null) allAt = ctxNow();
      if (doneFlag || ctxNow() > t0 + limit || (allAt !== null && ctxNow() > allAt + 0.6)) return res();
      setTimeout(tick, 300);
    };
    tick();
  });
  setLive({ status: g.notes.map(n => (n.ok ? 'ok' : 'miss')) });
  return { mode: 'free', met: g.met, score: g.accuracy, matched: g.matched, total: g.expected, grade: g, held: [], graderMode: gm, bpm: null };
}
