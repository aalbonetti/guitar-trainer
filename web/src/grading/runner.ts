// Runs graded timing attempts and strum calibration. Lives outside UI components (a fold is a resize,
// so the attempt must survive re-renders). UI reads the `attempt` store and calls start/cancel.
import { Store } from '../store';
import * as db from '../db';
import { OnsetDetector, BandOnsetDetector } from '../dsp/dsp.js';
import { stopSimAudio, acquireCapture, releaseCapture, onBlock, playClickPlan, cancelClickPlan, ctxNow, waitUntil, sampleRate, capture, audioContext, routeLabel } from '../audio/engine';
import { buildPlan, gradeTiming, lessonFeel, calibrationOffset, bleedDelay, ladderStart, ladderStep, type Plan, type TimingResult, type Ladder, type TimingCriteria } from './timing';
import { PitchTracker, HoldTracker, segmentNotes, gradeNotes, buildNotePlan, noteTolerance, trackerRange, pitchSetup, midiName, type PitchFrame, type NotesGrade, type PitchSetup } from './pitch';
import { meterInfo } from '../audio/meter';
import { StrumAnalyzer, chordSetup, progressionTargets, pairTargets, buildChordPlan, gradeTimedChords, gradeOwnChords, countChanges, verifyChord, pickVariant, boxLabel,
  type ChordGrade, type ChangesResult, type ChordSetup, type Strum, type StrumResult, type ChordPlan, type ChordVariant } from './chord';
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
/** Live view of a chord attempt (M8). accuracy: one box per chord of the progression; changes: one pair at a time. */
export interface ChordLive {
  kind: 'changes' | 'accuracy'; pace: 'timed' | 'own' | 'minute'; label: string; capo: number;
  boxes: string[]; idx: number; status: ('todo' | 'ok' | 'mixed' | 'miss')[]; inBox: number; perBox: number | null;
  last: { expected: string; heard: string | null; ok: boolean } | null;
  pairs: [string, string][]; pairIdx: number; count: number; ends: number | null; startsAt: number | null; waiting: boolean; nextUp: string | null;
  cue?: 'count' | 'play';
}
export interface ChordOutcome {
  kind: 'changes' | 'accuracy'; met: boolean; score: number; graderMode: GraderMode; bpm: number | null;
  grade: ChordGrade | null; changes: ChangesResult[]; names: Record<string, string>; label: string; capo: number; show: 'chords' | 'numbers';
}
export interface AttemptState {
  phase: Phase; kind: 'timing' | 'calibration' | 'pitch' | 'chord' | null; lessonId: string | null;
  heard: number; expected: number; beat: number; step: number; bpm: number;
  result: TimingResult | null; event: Event | null; ladder: Ladder | null; message: string;
  cal: { offsetMs: number; spreadMs: number; matched: number } | null;
  prevLadderBpm?: number;
  pitch?: PitchLive | null; pitchResult?: PitchOutcome | null;
  chord?: ChordLive | null; chordResult?: ChordOutcome | null;
  /** assisted mode: the result is shown but not saved until you confirm or override it */
  pending?: boolean;
  /** when the current/last calibration run started (tells a fresh result from an old one left in the store) */
  calAt?: number;
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
/** An attempt or calibration is under way (opening the mic, count-in or playing). */
const running = () => { const p = attempt.get().phase; return p === 'starting' || p === 'countin' || p === 'playing'; };
export function cancelAttempt() {
  stopSimAudio(); // ?sim only: strums already scheduled for this attempt mustn't sound in the next one
  cancelled.cancelled = true; finish(); pendingConfirm = null;
  attempt.set({ phase: 'idle', kind: null, beat: -1, message: '' });
}

// Cancel can land during any await. After each one, a cancelled run must stop before it registers listeners,
// plays clicks or touches the store (a newer run may own them by then).
const CANCELLED = new Error('cancelled');
function alive(sig: { cancelled: boolean }) { if (sig.cancelled) throw CANCELLED; }
/** Cancelled, or replaced by a newer run. */
const stale = (sig: { cancelled: boolean }) => sig.cancelled || sig !== cancelled;

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
    if (sig.cancelled) return;
    const now = ctxNow() - lag; let b = -1; beatTimes.forEach((t, i) => { if (t <= now) b = i; });
    const st = steps && now >= steps.t0 && now < plan.end ? Math.floor((now - steps.t0) / steps.dur) % steps.grid : -1;
    if (b !== attempt.get().beat || st !== attempt.get().step) attempt.set({ beat: b, step: st });
  }, 20);
  try {
    await waitUntil(firstPlayed - 0.08, sig);
    alive(sig);
    counting = false;
    det.learnBleed();
    const arrive = bleedDelay(clickOn, plan.countIn);
    const clickTimes = plan.clicks.map(c => c.t);
    det.isNearClick = arrive === null ? null : (fr: number) => clickTimes.some(t => Math.abs(fr / sr - (t + arrive)) < 0.03);
    attempt.set({ phase: 'playing' });
    await waitUntil(plan.end + 0.45, sig);
    alive(sig);
  } finally { clearInterval(beatTimer); }
}

/** Test-only hook: lets the headless test play strums into the simulated input. */
const simAuto = (kind: string, times: number[]) => (globalThis as any).__gtSimAuto?.(kind, times);

// ---------- strum calibration ----------
export async function runCalibration(deviceId?: string) {
  if (running()) return;
  cancelled = { cancelled: false }; const sig = cancelled;
  attempt.set({ phase: 'starting', kind: 'calibration', lessonId: null, heard: 0, expected: 16, beat: -1, bpm: 80, result: null, event: null, cal: null, message: '', calAt: Date.now() });
  try {
    await acquireCapture(WHO, deviceId);
    alive(sig);
    const beat = 0.75, t0 = ctxNow() + 0.5;
    const countIn = [0, 1, 2, 3].map(i => t0 + i * beat), targets = Array.from({ length: 16 }, (_, i) => t0 + (4 + i) * beat);
    const clicks = [...countIn, ...targets].map((t, i) => ({ t, kind: (i % 4 === 0 ? 0 : 1) as 0 | 1 }));
    playClickPlan(clicks);
    attempt.set({ phase: 'countin' });
    simAuto('calibration', targets);
    const on: number[] = [];
    await listen({ countIn, clicks, end: targets[15] }, t => { on.push(t); attempt.set({ heard: on.length }); }, sig, [...countIn, ...targets]);
    finish();
    const c = calibrationOffset(on, targets);
    if (!c) { attempt.set({ phase: 'error', message: `Only heard ${on.length} strums. Strum the muted strings a bit harder, close to the phone, and try again.` }); return; }
    const route = routeName();
    await db.put('calibration', { key: calKey(route), input_route: route, posture: posture(), offset_ms: Math.round(c.offsetMs * 10) / 10, spread_ms: Math.round(c.spreadMs * 10) / 10, method: 'strum', measured_at: Date.now() } satisfies Calibration).catch(() => undefined);
    if (stale(sig)) return;
    attempt.set({ phase: 'result', cal: c, message: c.spreadMs > 25 ? 'That was a bit uneven. It’s saved, but running it again will make grades fairer.' : 'Saved for this input and posture.' });
  } catch (err) {
    if (stale(sig)) return; // cancelAttempt already cleaned up
    finish(); attempt.set({ phase: 'error', message: (err as Error).message || 'Microphone not available' });
  }
}

// ---------- graded timing attempt ----------
export async function runTimingAttempt(l: Lesson, cat: Catalog, opts: { bpm?: number; deviceId?: string } = {}) {
  if (running()) return; // a double tap on Start / Go again
  cancelled = { cancelled: false }; const sig = cancelled;
  attempt.set({ phase: 'starting', kind: 'timing', lessonId: l.id, result: null, message: '' }); // before any await
  const crit = l.pass_criteria as unknown as TimingCriteria;
  const ladder = await getLadder(l);
  if (stale(sig)) return;
  const bpm = opts.bpm ?? ladder.bpm;
  attempt.set({ phase: 'starting', kind: 'timing', lessonId: l.id, heard: 0, expected: 0, beat: -1, bpm, result: null, event: null, ladder, cal: null, message: '' });
  try {
    await acquireCapture(WHO, opts.deviceId);
    alive(sig);
    const cal = await getCalibration(routeName());
    alive(sig);
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
    finish();
    const r = gradeTiming(on, plan, cal.offset_ms, crit.max_err_ms);
    const atTarget = bpm >= crit.bpm;
    // The ladder moves only on attempts at its own tempo; a clean try above it lifts it to that tempo.
    const next = bpm === ladder.bpm ? ladderStep(ladder, crit.bpm, r) : r.clean && bpm > ladder.bpm ? { bpm: Math.min(bpm, crit.bpm), clean: 0, sloppy: 0 } : ladder;
    await saveLadder(l, next);
    const event = await recordAttempt(l, { met: r.met, atTarget, score: Math.round(r.slotsRight * 100) / 100, mode: 'auto',
      metrics: { bpm, maeMs: +r.maeMs.toFixed(1), biasMs: +r.biasMs.toFixed(1), hitRatio: +r.hitRatio.toFixed(3), extras: r.extras, offsetMs: cal.offset_ms, route: cal.input_route, ch: capture.get().channel, posture: cal.posture } });
    if (stale(sig)) return;
    attempt.set({ phase: 'result', result: r, event, ladder: next, prevLadderBpm: ladder.bpm, beat: -1, step: -1 });
  } catch (err) {
    if (stale(sig)) return; // cancelAttempt already cleaned up
    finish(); attempt.set({ phase: 'error', message: (err as Error).message || 'Microphone not available' });
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
  if (running()) return; // a double tap on Start / Go again
  cancelled = { cancelled: false }; const sig = cancelled;
  attempt.set({ phase: 'starting', kind: 'pitch', lessonId: l.id, pitchResult: null, pending: false, message: '' }); // before any await
  skipFlag = false; doneFlag = false; pendingConfirm = null;
  const setup = pitchSetup(l, cat), crit = setup.crit, gm: GraderMode = opts.mode ?? 'auto';
  (globalThis as any).__gtLastPitchSetup = setup; // test-only: ?sim plays notes against it
  const ladder = setup.mode === 'timed' ? await getLadder(l) : null;
  if (stale(sig)) return;
  const bpm = setup.mode === 'timed' ? opts.bpm ?? ladder!.bpm : null;
  const items = setup.mode === 'hold' ? setup.targets.map(t => ({ label: t.label, where: t.where })) : setup.expected.map(e => ({ label: e.label, where: e.where }));
  attempt.set({ phase: 'starting', kind: 'pitch', lessonId: l.id, heard: 0, expected: items.length, beat: -1, step: -1, bpm: bpm ?? 0, result: null, event: null, ladder, cal: null, message: '', pending: false, pitchResult: null,
    pitch: { mode: setup.mode, labels: items.map(i => i.label), wheres: items.map(i => i.where), status: items.map(() => 'todo'), idx: 0, hearing: null, cents: null, progress: 0, ends: null } });
  try {
    await acquireCapture(WHO, opts.deviceId);
    alive(sig);
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
    alive(sig);
    finish();
    const route = routeLabel(), cal = await getCalibration(routeName());
    alive(sig);
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
      if (stale(sig)) return;
      attempt.set({ phase: 'result', event, ladder: next, prevLadderBpm: ladder?.bpm, pending: false, pitchResult: { ...out, met } });
    };
    attempt.set({ phase: 'result', pitchResult: out, beat: -1, step: -1, pending: gm === 'assisted', event: null });
    if (gm === 'assisted') pendingConfirm = save; else await save(out.met);
  } catch (err) {
    if (stale(sig)) return; // cancelAttempt already cleaned up
    finish(); attempt.set({ phase: 'error', message: (err as Error).message || 'Microphone not available' });
  }
}
let pendingConfirm: ((accept: boolean) => Promise<void>) | null = null;
/** Assisted mode: count the attempt (accept) or not, after seeing what was detected. Saves it either way. */
export async function confirmPitch(accept: boolean) { const f = pendingConfirm; pendingConfirm = null; if (f) await f(accept); }
export const confirmAttempt = confirmPitch;

async function holdTargets(setup: PitchSetup, sig: { cancelled: boolean }, hook: (h: ((f: PitchFrame, on: boolean) => void) | null) => void, gm: GraderMode): Promise<PitchOutcome> {
  const cents = setup.crit.cents!, per = simTimeout() ?? 25;
  attempt.set({ phase: 'playing' });
  const held: PitchOutcome['held'] = [];
  for (let i = 0; i < setup.targets.length && !sig.cancelled; i++) {
    const tg = setup.targets[i], ht = new HoldTracker(tg, cents);
    let doneAt: number | null = null, last: number | null = null, start = ctxNow(), shownAt = 0;
    const devs: number[] = [];
    hook((f, on) => {
      const st = ht.push(f, on);
      if (st.cents !== null && Math.abs(st.cents) <= cents + 25) { devs.push(st.cents); if (devs.length > 30) devs.shift(); }
      const now = performance.now(); // the hold bar redraws about every 60 ms; grading sees every frame
      if (st.done || now - shownAt >= 60) { shownAt = now; setLive({ progress: st.progress }); }
      if (st.done && doneAt === null) { doneAt = f.t; last = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : 0; }
    });
    skipFlag = false;
    setLive({ idx: i, progress: 0, ends: start + per });
    simAuto('pitch-hold', [i, start] as unknown as number[]);
    await new Promise<void>(res => { const f = () => (sig.cancelled || doneAt !== null || skipFlag || ctxNow() > start + per ? res() : setTimeout(f, 30)); f(); });
    hook(null);
    if (sig.cancelled) break;
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
  alive(sig);
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
  let offsetS = (cal?.offset_ms ?? 0) / 1000, gradedAt = 0, liveKey = '', liveG: ReturnType<typeof liveGrade> | null = null;
  const beatTimer = window.setInterval(() => {
    if (sig.cancelled) return;
    const now = ctxNow() - lag; let b = -1; plan.clicks.forEach((c, i) => { if (c.t <= now) b = i; });
    if (b !== attempt.get().beat) attempt.set({ beat: b });
    let idx = 0; plan.expected.forEach((e, i) => { if (e.t <= now + 0.05) idx = i; });
    if (attempt.get().pitch?.idx !== idx) setLive({ idx });
    const cue = now >= firstT - plan.beat / 2 ? 'play' : 'count';
    if (attempt.get().pitch?.cue !== cue) setLive({ cue });
    if (now - gradedAt > 0.3 && now > plan.start) {
      gradedAt = now;
      // regrade only when something new was heard (or the offset changed); the misses below still follow the clock
      const key = `${frames.length}|${onsets.length}|${offsetS}`;
      if (key !== liveKey || !liveG) { liveKey = key; liveG = liveGrade(setup, frames.filter(f => f.t > plan.start - tol), onsets, plan.expected, true, tol, offsetS); }
      const g = liveG;
      // a note is settled once its window has passed
      setLive({ status: g.notes.map((n, i) => (n.ok ? 'ok' : plan.expected[i].t + tol + offsetS + 0.1 < ctxNow() ? 'miss' : 'todo')) });
    }
  }, 40);
  try {
    await waitUntil(plan.start - 0.08, sig);
    alive(sig);
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
    alive(sig);
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
  let allAt: number | null = null, g = liveGrade(setup, [], [], setup.expected, false, 0, 0), seen = '';
  await new Promise<void>(res => {
    const tick = () => {
      if (sig.cancelled) return res();
      const key = `${frames.length}|${onsets.length}`; // regrade only when something new was heard
      if (key !== seen) { seen = key; g = liveGrade(setup, frames.filter(f => f.t > t0), onsets.filter(t => t > t0), setup.expected, false, 0, 0); }
      const lastOk = g.notes.map(n => n.ok).lastIndexOf(true);
      setLive({ status: g.notes.map((n, i) => (n.ok ? 'ok' : i < lastOk ? 'miss' : 'todo')), idx: Math.min(setup.expected.length - 1, lastOk + 1) });
      if (g.matched === g.expected && allAt === null) allAt = ctxNow();
      if (doneFlag || ctxNow() > t0 + limit || (allAt !== null && ctxNow() > allAt + 0.6)) return res();
      setTimeout(tick, 300);
    };
    tick();
  });
  alive(sig);
  setLive({ status: g.notes.map(n => (n.ok ? 'ok' : 'miss')) });
  return { mode: 'free', met: g.met, score: g.accuracy, matched: g.matched, total: g.expected, grade: g, held: [], graderMode: gm, bpm: null };
}

// ---------- graded chord attempt (M8) ----------
let nextPairFlag = false;
/** changes_per_min: start the next pair now instead of waiting out the rest. */
export function startNextPair() { nextPairFlag = true; }
const setChord = (p: Partial<ChordLive>) => { const cur = attempt.get().chord; if (cur) attempt.set({ chord: { ...cur, ...p } }); };
const simWindow = (): number | undefined => (globalThis as any).__gtChangesWindowS; // test-only: shorter changes window
// decoys show their longer label ('Bm (partial)'), so they aren't confused with the chord they imitate
const nameOf = (s: ChordSetup) => Object.fromEntries(Object.entries(s.ex.voicings).map(([k, v]) => [k, s.kind === 'accuracy' && s.ex.decoys?.includes(k) ? v.label ?? v.name : v.name]));
const boxState = (rs: StrumResult[]): 'ok' | 'mixed' | 'miss' => { const g = rs.filter(r => !r.skipped); const ok = g.filter(r => r.ok).length; return !g.length ? 'miss' : ok === g.length ? 'ok' : ok >= g.length / 2 ? 'mixed' : 'miss'; };

/** Run one chord attempt. accuracy + timed: the progression to a click (tempo ladder when the lesson has a bpm).
 *  accuracy + own pace: `strums_per_chord` strums per chord box, moving on as you strum. changes: 60 s per pair,
 *  counting changes; every pair must reach the target. `variant` = the player's choice when the exercise lets
 *  them choose (capo for Amazing Grace); keys "named on the spot" are picked here. */
export async function runChordAttempt(l: Lesson, cat: Catalog, opts: { bpm?: number; deviceId?: string; mode?: GraderMode; variant?: number } = {}) {
  if (running()) return; // a double tap on Start / Go again
  cancelled = { cancelled: false }; const sig = cancelled;
  attempt.set({ phase: 'starting', kind: 'chord', lessonId: l.id, chordResult: null, pending: false, message: '' }); // before any await
  nextPairFlag = false; doneFlag = false; pendingConfirm = null;
  const setup = chordSetup(l, cat);
  if (!setup) { attempt.set({ phase: 'error', kind: 'chord', lessonId: l.id, message: 'This lesson has no chord exercise to grade.' }); return; }
  const vi = setup.kind === 'accuracy' ? pickVariant(setup.ex, opts.variant) : 0;
  const v = setup.kind === 'accuracy' ? setup.ex.variants[vi] : null;
  const gm: GraderMode = opts.mode ?? 'assisted', names = { ...nameOf(setup), ...(v?.names || {}) };
  const timed = setup.kind === 'accuracy' && setup.ex.pace === 'timed';
  const ladder = setup.kind === 'accuracy' && setup.ladder ? await getLadder(l) : null;
  if (stale(sig)) return;
  const bpm = timed ? opts.bpm ?? ladder?.bpm ?? (setup as Extract<ChordSetup, { kind: 'accuracy' }>).bpm! : null;
  (globalThis as any).__gtLastChordSetup = { setup, variant: v, vi }; // test-only: ?sim plays chords against it
  const pairs = setup.kind === 'changes' ? setup.pairs.map(p => [names[p[0]], names[p[1]]] as [string, string]) : [];
  const boxes = v ? v.chords.map((_, i) => boxLabel(setup.ex as never, v, i)) : [];
  attempt.set({ phase: 'starting', kind: 'chord', lessonId: l.id, heard: 0, expected: 0, beat: -1, step: -1, bpm: bpm ?? 0, result: null, event: null, ladder, cal: null, message: '', pending: false, chordResult: null, pitch: null,
    chord: { kind: setup.kind, pace: setup.kind === 'changes' ? 'minute' : timed ? 'timed' : 'own', label: v?.label ?? '', capo: v?.capo ?? 0, boxes, idx: 0, status: boxes.map(() => 'todo'), inBox: 0,
      perBox: setup.kind === 'accuracy' && !timed ? setup.ex.strums_per_chord ?? 4 : null, last: null, pairs, pairIdx: 0, count: 0, ends: null, startsAt: null, waiting: false, nextUp: null } });
  try {
    await acquireCapture(WHO, opts.deviceId);
    alive(sig);
    const sr = sampleRate(), an = new StrumAnalyzer(sr), strums: Strum[] = [];
    (globalThis as any).__gtLastStrums = strums; // test-only diagnostics
    let onStrum: ((s: Strum) => void) | null = null;
    unsub = onBlock((d, f) => { const got = an.push(d, f); for (const s of got) { strums.push(s); onStrum?.(s); } if (got.length) attempt.set({ heard: strums.length }); });
    let out: ChordOutcome;
    if (setup.kind === 'changes') out = await chordChanges(setup, an, strums, sig, gm, names);
    else if (timed) out = await chordTimed(setup, v!, bpm!, an, strums, sig, gm, names, h => { onStrum = h; });
    else out = await chordOwn(setup, v!, an, strums, sig, gm, names, h => { onStrum = h; });
    alive(sig);
    finish();
    const cal = await getCalibration(routeName());
    alive(sig);
    const save = async (accept: boolean) => {
      const met = gm === 'assisted' ? accept : out.met;
      let next = ladder;
      if (ladder && bpm !== null && out.grade) {
        const g = out.grade, rr = { clean: met, sloppy: !met && g.sloppy, great: met && g.great };
        const goal = (l.pass_criteria as { bpm?: number }).bpm!;
        next = bpm === ladder.bpm ? ladderStep(ladder, goal, rr) : met && bpm > ladder.bpm ? { bpm: Math.min(bpm, goal), clean: 0, sloppy: 0 } : ladder;
        await saveLadder(l, next);
      }
      const atTarget = !ladder || (bpm ?? 0) >= ((l.pass_criteria as { bpm?: number }).bpm ?? 0);
      const g = out.grade;
      const event = await recordAttempt(l, { met, atTarget, score: Math.round(out.score * 100) / 100, mode: gm,
        metrics: { kind: out.kind, detected_met: out.met, bpm, route: routeLabel(), ch: capture.get().channel, posture: posture(), offsetMs: cal?.offset_ms ?? null,
          ...(g ? { variant: out.label, capo: out.capo, correct: g.correct, total: g.graded, ratio: +g.ratio.toFixed(3), missedBoxes: g.missedBoxes, owed: g.owed, confusion: g.confusion } : {}),
          ...(out.changes.length ? { changes: out.changes.map(c => ({ pair: c.pair.join('↔'), changes: c.changes, perMin: Math.round(c.perMin * 10) / 10, unclear: c.unclear, windowS: Math.round(c.windowS) })) } : {}) } });
      if (stale(sig)) return;
      attempt.set({ phase: 'result', event, ladder: next, prevLadderBpm: ladder?.bpm, pending: false, chordResult: { ...out, met } });
    };
    attempt.set({ phase: 'result', chordResult: out, beat: -1, step: -1, pending: gm === 'assisted', event: null });
    if (gm === 'assisted') pendingConfirm = save; else await save(out.met);
  } catch (err) {
    if (stale(sig)) return; // cancelAttempt already cleaned up
    finish(); attempt.set({ phase: 'error', message: (err as Error).message || 'Microphone not available' });
  }
}

async function chordTimed(setup: Extract<ChordSetup, { kind: 'accuracy' }>, v: ChordVariant, bpm: number, an: StrumAnalyzer, strums: Strum[], sig: { cancelled: boolean }, gm: GraderMode, names: Record<string, string>, hook: (h: ((s: Strum) => void) | null) => void): Promise<ChordOutcome> {
  const sr = sampleRate(), ex = setup.ex;
  const cal = await getCalibration(routeName()); // read first: the click plan starts 0.5 s from now
  alive(sig);
  const plan: ChordPlan = buildChordPlan(ex, v, bpm, meterInfo(ex.meter).beats, ctxNow() + 0.5);
  (globalThis as any).__gtLastChordPlan = plan;
  const tg = progressionTargets(ex, v), all = [...Object.values(tg.targets), ...tg.decoys];
  const band = new BandOnsetDetector(sr, 1800, 3200), clickOn: number[] = [];
  const off = onBlock((d, f) => { if (ctxNow() < plan.start) band.push(d, f).forEach(x => clickOn.push(x / sr)); });
  playClickPlan(plan.clicks);
  attempt.set({ phase: 'countin', bpm });
  simAuto('chord-timed', plan.boxes.map(b => b.t0));
  const lag = (() => { const c = audioContext(); return c.outputLatency || c.baseLatency || 0; })();
  let offsetS = (cal?.offset_ms ?? 0) / 1000;
  const live: StrumResult[] = [];
  hook(s => {
    const tt = s.t - offsetS, bi = plan.boxes.findIndex(b => tt >= b.t0 - 0.08 && tt < b.t1 - 0.08);
    if (bi < 0) return;
    const b = plan.boxes[bi], vv = verifyChord(s.chroma, tg.targets[b.ref], all, undefined, undefined, s.low ?? null);
    live.push({ t: s.t, box: bi, expected: b.ref, heard: vv.heard, ok: vv.ok, score: vv.score, margin: vv.margin });
    const status = [...(attempt.get().chord?.status || [])]; status[bi] = boxState(live.filter(r => r.box === bi));
    setChord({ last: { expected: names[b.ref], heard: vv.heard ? names[vv.heard] ?? (vv.heard.startsWith('nocapo:') ? 'no capo' : vv.heard.replace(/^decoy:/, '')) : null, ok: vv.ok }, status });
  });
  setChord({ cue: 'count' });
  const beatTimer = window.setInterval(() => {
    if (sig.cancelled) return;
    const now = ctxNow() - lag; let bt = -1; plan.clicks.forEach((c, i) => { if (c.t <= now) bt = i; });
    if (bt !== attempt.get().beat) attempt.set({ beat: bt });
    let idx = 0; plan.boxes.forEach((b, i) => { if (b.t0 <= now + 0.05) idx = i; });
    const cue = now >= plan.start - plan.beat / 2 ? 'play' : 'count';
    const c = attempt.get().chord;
    if (c && (c.idx !== idx || c.cue !== cue)) setChord({ idx, cue });
  }, 40);
  try {
    await waitUntil(plan.start - 0.08, sig);
    alive(sig);
    off();
    an.det.learnBleed();
    const arrive = bleedDelay(clickOn, plan.countIn);
    if (!cal && arrive !== null) offsetS = arrive; // no strum calibration: the measured click round trip is close enough for bar-long windows
    if (arrive !== null) { const arr = plan.clicks.map(c => c.t + arrive); an.det.isNearClick = (fr: number) => arr.some(a => Math.abs(fr / sr - a) < 0.03); }
    attempt.set({ phase: 'playing' });
    await waitUntil(plan.end + 0.6, sig);
    alive(sig);
  } finally { clearInterval(beatTimer); off(); hook(null); }
  strums.push(...an.flush());
  const g = gradeTimedChords(strums.filter(s => s.t < plan.end + 0.3 + offsetS), plan, tg, { offsetS, ratio: setup.ratio, focus: ex.focus });
  setChord({ status: plan.boxes.map((_, i) => (g.boxes[i].strums === 0 ? 'miss' : boxState(g.strums.filter(r => r.box === i)))) });
  return { kind: 'accuracy', met: g.met, score: g.ratio, graderMode: gm, bpm, grade: g, changes: [], names, label: v.label, capo: v.capo, show: setup.ex.show };
}

async function chordOwn(setup: Extract<ChordSetup, { kind: 'accuracy' }>, v: ChordVariant, an: StrumAnalyzer, strums: Strum[], sig: { cancelled: boolean }, gm: GraderMode, names: Record<string, string>, hook: (h: ((s: Strum) => void) | null) => void): Promise<ChordOutcome> {
  const ex = setup.ex, per = ex.strums_per_chord ?? 4, nBox = v.chords.length, total = nBox * per;
  const tg = progressionTargets(ex, v), all = [...Object.values(tg.targets), ...tg.decoys];
  const t0 = ctxNow() + 0.2, limit = 15 + 8 * nBox;
  const boxOf = new Map<number, number>(); let n = 0;
  const res: StrumResult[] = [];
  an.onOnset = t => {
    if (t < t0 || n >= total) return;
    const bi = Math.floor(n / per); boxOf.set(t, bi); n++;
    setChord({ idx: Math.min(nBox - 1, Math.floor(n / per)), inBox: n >= total ? per : n % per });
  };
  hook(s => {
    const bi = boxOf.get(s.t); if (bi === undefined) return;
    const ref = v.chords[bi], vv = verifyChord(s.chroma, tg.targets[ref], all, undefined, undefined, s.low ?? null);
    res.push({ t: s.t, box: bi, expected: ref, heard: vv.heard, ok: vv.ok, score: vv.score, margin: vv.margin });
    const status = [...(attempt.get().chord?.status || [])]; status[bi] = boxState(res.filter(r => r.box === bi));
    setChord({ last: { expected: names[ref], heard: vv.heard ? names[vv.heard] ?? (vv.heard.startsWith('nocapo:') ? 'no capo' : vv.heard.replace(/^decoy:/, '')) : null, ok: vv.ok }, status });
  });
  attempt.set({ phase: 'playing' });
  setChord({ ends: t0 + limit });
  simAuto('chord-own', [t0]);
  await new Promise<void>(res2 => {
    const tick = () => {
      if (sig.cancelled) return res2();
      if (doneFlag || ctxNow() > t0 + limit || (n >= total && res.length >= total)) return res2();
      setTimeout(tick, 100);
    };
    tick();
  });
  an.onOnset = null;
  alive(sig);
  for (const s of an.flush()) { strums.push(s); const bi = boxOf.get(s.t); if (bi !== undefined && !res.some(r => r.t === s.t)) { const vv = verifyChord(s.chroma, tg.targets[v.chords[bi]], all, undefined, undefined, s.low ?? null); res.push({ t: s.t, box: bi, expected: v.chords[bi], heard: vv.heard, ok: vv.ok, score: vv.score, margin: vv.margin }); } }
  hook(null);
  const boxes = v.chords.map((ref, i) => ({ ref, label: boxLabel(ex, v, i) }));
  const g = gradeOwnChords(res.sort((a, b) => a.t - b.t), boxes, per, setup.ratio, ex.focus);
  setChord({ status: boxes.map((_, i) => { const rs = res.filter(r => r.box === i); return rs.length ? boxState(rs) : 'miss'; }) });
  return { kind: 'accuracy', met: g.met, score: g.ratio, graderMode: gm, bpm: null, grade: g, changes: [], names, label: v.label, capo: v.capo, show: ex.show };
}

async function chordChanges(setup: Extract<ChordSetup, { kind: 'changes' }>, an: StrumAnalyzer, strums: Strum[], sig: { cancelled: boolean }, gm: GraderMode, names: Record<string, string>): Promise<ChordOutcome> {
  const windowS = simWindow() ?? setup.ex.duration_s, results: ChangesResult[] = [];
  attempt.set({ phase: 'playing' });
  for (let i = 0; i < setup.pairs.length && !sig.cancelled; i++) {
    const [a, b] = pairTargets(setup.ex, setup.pairs[i]);
    if (i > 0) {
      // rest between pairs: start when ready, or after 10 s
      nextPairFlag = false;
      const until = ctxNow() + 10;
      setChord({ waiting: true, pairIdx: i, count: 0, ends: until, startsAt: null, last: null });
      await new Promise<void>(res => { const f = () => (sig.cancelled || nextPairFlag || ctxNow() >= until ? res() : setTimeout(f, 50)); f(); });
      if (sig.cancelled) break;
    }
    const t0 = ctxNow() + 3, t1 = t0 + windowS; // 3-2-1 on screen, no sound (the mic is open)
    setChord({ waiting: false, pairIdx: i, count: 0, startsAt: t0, ends: t1, last: null, nextUp: a.name });
    simAuto('chord-changes', [i, t0, t1]);
    let counted = -1; // strums already counted: the count can only change when a new strum arrives
    const timer = window.setInterval(() => {
      if (sig.cancelled || strums.length === counted) return;
      counted = strums.length;
      const r = countChanges(strums, a, b, t0, Math.min(ctxNow(), t1), setup.target);
      const lastS = r.strums[r.strums.length - 1];
      const heard = lastS?.heard ?? null, prev = [...r.strums].reverse().find(x => x.heard)?.heard ?? null;
      const c = attempt.get().chord;
      if (c && (c.count !== r.changes || (lastS && c.last?.heard !== (heard ? names[heard] : null)))) setChord({ count: r.changes, last: lastS ? { expected: '', heard: heard ? names[heard] : null, ok: !!lastS.counted } : null, nextUp: prev === a.id ? b.name : a.name });
    }, 100);
    try { await waitUntil(t1 + 0.55, sig); } finally { clearInterval(timer); }
    alive(sig);
    strums.push(...an.flush());
    results.push(countChanges(strums, a, b, t0, t1, setup.target));
  }
  const met = results.length === setup.pairs.length && results.every(r => r.met);
  const score = results.length ? Math.min(1, Math.min(...results.map(r => r.perMin / r.target))) : 0;
  return { kind: 'changes', met, score, graderMode: gm, bpm: null, grade: null, changes: results, names, label: '', capo: 0, show: 'chords' };
}
