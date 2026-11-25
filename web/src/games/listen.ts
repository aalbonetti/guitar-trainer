// Play mode's ears (07-games.md §1): the shared mic capture, the M7 pitch tracker and the spectral-flux onset
// detector, for games. Lives outside UI components, so folding the phone (a resize) never drops the audio.
// Games open it only in play mode and close it on pause, quit and the end of a round.
//
// Untimed games (Note Drop, Fret Finder, Octave Jump) read `heardSince(t)`: notes segmented with the pitch
// grader's segmentNotes, then checked against the expected answer by games/judge.ts.
// Click-timed games (Box Runner, In the Pocket) call `startTimed`: the click plan plays on the AudioContext
// clock, the one-bar count-in learns the click bleed (level and arrival) exactly as graded attempts do, and the
// offset comes from strum calibration (else the count-in's measured click round trip).
import { Store, persisted } from '../store';
import { OnsetDetector, BandOnsetDetector } from '../dsp/dsp.js';
import { acquireCapture, releaseCapture, onBlock, playClickPlan, cancelClickPlan, ctxNow, waitUntil, sampleRate, routeLabel, metro, stopMetronome, isSim, type PlannedClick } from '../audio/engine';
import { PitchTracker, segmentNotes, trackerRange, midiName, type PitchFrame, type Segment } from '../grading/pitch';
import { StrumAnalyzer, type Strum } from '../grading/chord';
import { bleedDelay } from '../grading/timing';
import { getCalibration, routeName } from '../grading/runner';

const WHO = 'game';
const inputPref = persisted<string>('gt_input', ''); // same setting as Settings → Audio input
export const ears = new Store<{ on: boolean; opening: boolean; hearing: string | null; cents: number | null; error: string | null; route: string }>({ on: false, opening: false, hearing: null, cents: null, error: null, route: '' });

/** Single-note games run the pitch tracker + onset detector; chord games (G3) run the M8 StrumAnalyzer instead
 *  (its own onset detector, so the count-in's bleed learning works the same way). */
interface Session { tracker: PitchTracker | null; det: InstanceType<typeof OnsetDetector>; an: StrumAnalyzer | null; frames: PitchFrame[]; onsets: number[]; strums: Strum[]; unsub: () => void; liveAt: number; gen: number }
let S: Session | null = null, gen = 0, clicking = false, opening = 0;

/** Open the mic for a game. `midis`: every note the round can ask for (sizes the tracker, with an octave of slack).
 *  `chords`: listen for strums (chord games) instead of single notes. */
export async function openEars(midis: number[], o: { chords?: boolean } = {}): Promise<boolean> {
  closeEars();
  const my = ++gen;
  ears.set({ opening: true, error: null });
  opening++;
  try {
    await acquireCapture(WHO, inputPref.get() || undefined);
    opening--;
    if (my !== gen) {
      // closed (paused, quit) while the mic was opening: let go of it unless a newer round is opening or holds it
      if (!S && !opening) releaseCapture(WHO);
      return false;
    }
    const sr = sampleRate();
    const an = o.chords ? new StrumAnalyzer(sr) : null;
    const s: Session = { tracker: an ? null : new PitchTracker(sr, trackerRange(midis)), det: an ? an.det : new OnsetDetector(sr), an, frames: [], onsets: [], strums: [], unsub: () => undefined, liveAt: 0, gen: my };
    if (an) an.onOnset = t => { s.onsets.push(t); };
    s.unsub = onBlock((d, f) => {
      if (an) {
        for (const st of an.push(d, f)) s.strums.push(st);
        if (s.strums.length > 600) s.strums.splice(0, 200);
        if (s.onsets.length > 3000) s.onsets.splice(0, 600);
        return;
      }
      s.det.push(d, f).forEach(x => s.onsets.push(x / sr));
      for (const fr of s.tracker!.push(d, f)) {
        s.frames.push(fr);
        const now = performance.now();
        if (now - s.liveAt > 70) { s.liveAt = now; ears.set({ hearing: fr.midi === null || fr.click ? null : midiName(fr.midi), cents: fr.midi === null ? null : (fr.midi - Math.round(fr.midi)) * 100 }); }
      }
      // keep the last ~90 s (a round is 1–3 minutes of listening at most between questions)
      if (s.frames.length > 5000) s.frames.splice(0, 1000);
      if (s.onsets.length > 3000) s.onsets.splice(0, 600);
    });
    S = s;
    ears.set({ on: true, opening: false, route: routeLabel() });
    if (isSim()) (globalThis as any).__gtGameEars = s; // test-only diagnostics (?sim)
    return true;
  } catch (e) {
    opening = Math.max(0, opening - 1);
    if (!S && !opening) releaseCapture(WHO);
    if (my === gen) ears.set({ on: false, opening: false, error: (e as Error).message || 'Microphone not available' });
    return false;
  }
}
export function closeEars() {
  gen++;
  if (S) { S.unsub(); S = null; }
  if (clicking) { cancelClickPlan(); clicking = false; }
  releaseCapture(WHO);
  if (ears.get().on || ears.get().opening) ears.set({ on: false, opening: false, hearing: null, cents: null });
}
export const now = () => ctxNow();
/** Notes heard since context time `t`, plus ~0.4 s before it: the note before the question gives context (a
 *  ringing note split by a stray onset is told apart from a new pick by comparing with it). */
export function heardSince(t: number): Segment[] {
  if (!S) return [];
  const from = t - 0.4;
  return segmentNotes(S.frames.filter(f => f.t >= from), S.onsets.filter(o => o >= from));
}
/** Chord games: strums (onset + chroma) since context time `t`. A strum appears once its chroma window has passed
 *  (≈ 0.45 s after the onset, sooner when the next strum comes first). */
export const strumsSince = (t: number): Strum[] => (S ? S.strums.filter(x => x.t >= t) : []);
/** Finish strums still waiting for their chroma window (end of a round). */
export function flushStrums(): Strum[] { if (!S?.an) return []; const got = S.an.flush(); S.strums.push(...got); return got; }
/** Raw onsets (context seconds) since `t`: In the Pocket grades strums from these. */
export const onsetsSince = (t: number) => (S ? S.onsets.filter(o => o >= t) : []);

// ---------- click-timed rounds ----------
export interface TimedPlan { countIn: number[]; clicks: PlannedClick[]; start: number; end: number }
export interface TimedStart { offsetS: number; calibrated: boolean; arriveS: number | null }
/** Play the plan's clicks (the game owns the click: the metronome stops), learn the click bleed during the
 *  count-in, then resolve at the first played beat with the latency offset to subtract. */
export async function startTimed(plan: TimedPlan, sig: { cancelled: boolean }): Promise<TimedStart | null> {
  const s = S; if (!s) return null;
  const sr = sampleRate();
  const cal = await getCalibration(routeName());
  if (sig.cancelled || s !== S) return null; // quit or paused meanwhile: no listener, no click
  if (metro.get().running) stopMetronome();
  const band = new BandOnsetDetector(sr, 1800, 3200), clickOn: number[] = [];
  const off = onBlock((d, f) => { if (ctxNow() < plan.start) band.push(d, f).forEach(x => clickOn.push(x / sr)); });
  playClickPlan(plan.clicks); clicking = true;
  try { await waitUntil(plan.start - 0.08, sig); } finally { off(); }
  if (sig.cancelled || s !== S) return null;
  s.det.learnBleed();
  const arrive = bleedDelay(clickOn, plan.countIn);
  if (arrive !== null) {
    const arr = plan.clicks.map(c => c.t + arrive);
    s.det.isNearClick = (fr: number) => arr.some(a => Math.abs(fr / sr - a) < 0.03);
    if (s.tracker) s.tracker.isNearClick = (t0, t1) => arr.some(a => a >= t0 - 0.03 && a <= t1 + 0.005);
  }
  return { offsetS: cal ? cal.offset_ms / 1000 : arrive ?? 0, calibrated: !!cal, arriveS: arrive };
}

// ---------- test-only (?sim): play right and wrong answers into the simulated input ----------
/** The answer the game on screen expects, for headless tests. */
export function publishExpect(x: { right: number[]; neutral?: number[] } | null) { if (isSim()) (globalThis as any).__gtGameExpect = x; }
/** Test-only: publish a click-timed round's plan (?sim only). */
export function publishPlan(p: unknown) { if (isSim()) (globalThis as any).__gtGamePlan = p; }
/** `__gtSimAnswer('right' | 'wrong' | 'octave' | 'neutral')` plays a note for the question on screen. A wrong
 *  note is a fourth or fifth off the answer and never the note just played (re-picking the last note while it
 *  rings is deliberately not counted as wrong). */
let lastSim = -1;
if (isSim()) (globalThis as any).__gtSimAnswer = (kind = 'right', o: { dur?: number; gain?: number; delay?: number } = {}) => {
  const x = (globalThis as any).__gtGameExpect as { right: number[]; neutral?: number[] } | null;
  if (!x) return false;
  const r = x.right[0], taken = new Set([...x.right, ...(x.neutral || []), lastSim]);
  const m = kind === 'neutral' ? (x.neutral || [])[0] : kind === 'octave' ? r + (r < 60 ? 12 : -12)
    : kind === 'wrong' ? [5, -5, 7, -7].map(d => r + d).find(v => v >= 40 && v <= 76 && !taken.has(v)) : r;
  if (m === undefined) return false;
  lastSim = m;
  return (globalThis as any).__gtSimNotes?.([{ midi: m, t: ctxNow() + (o.delay ?? 0.05), dur: o.dur ?? 0.7, gain: o.gain ?? 0.5 }]);
};
export const simAuto = (kind: string, arg: unknown) => { if (isSim()) (globalThis as any).__gtSimAuto?.(kind, arg); };
/** Chord games: the chord the question on screen expects and clearly wrong ones (frets, string 6 → 1). */
export function publishChordExpect(x: { right: number[]; wrong: number[][]; capo?: number } | null) { if (isSim()) (globalThis as any).__gtChordExpect = x; }
/** `__gtSimChordAnswer('right' | 'wrong' | 'mute')` strums for the chord question on screen (test-only, ?sim). A wrong
 *  chord is never the one just played (playing the last chord again while it rings is deliberately not a wrong answer). */
let lastSimChord = '';
if (isSim()) (globalThis as any).__gtSimChordAnswer = (kind = 'right', o: { delay?: number } = {}) => {
  const x = (globalThis as any).__gtChordExpect as { right: number[]; wrong: number[][]; capo?: number } | null;
  if (!x) return false;
  const frets = kind === 'wrong' ? x.wrong.find(w => w.join() !== lastSimChord) ?? x.wrong[0] : kind === 'mute' ? [-1, -1, -1, -1, -1, -1] : x.right;
  lastSimChord = frets.join();
  // long notes: a simulated note's abrupt end would read as an onset
  return (globalThis as any).__gtSimChords?.([{ frets, capo: x.capo || 0, t: ctxNow() + (o.delay ?? 0.05), dur: 2.5 }]);
};
