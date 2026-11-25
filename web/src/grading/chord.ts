// Chord graders (06-app-spec.md §6 `chord_accuracy`, `changes_per_min`). Pure: no audio, no DOM, so it's
// unit-tested with synthetic strums.
//
// The app always knows which chord you're supposed to play, so nothing here names chords open-endedly:
//  - Each strum (a spectral-flux onset) gets a chroma vector: 12 pitch classes from the spectral peaks of
//    8192-point FFTs, averaged over 60–450 ms after the onset (cut short at the next strum). That's the proven
//    M0 DSP (`chroma` in dsp.js), unchanged.
//  - Templates come from the exact voicing the exercise uses (catalog `voicings`, resolved by build_catalog.py),
//    at sounding pitch: with a capo every fretted and open string sounds `capo` frets higher.
//  - A strum is right when the expected chord's template scores highest (cosine similarity) among the other
//    chords of the exercise, plus any decoys the lesson warns against (Fmaj7 in the barre-F lesson, the same
//    shapes without the capo), and it scores at least MIN_SCORE (a muted scratch or silence isn't any chord).
//
// API for games (G3: Call the Number, Triad Hunt, Change Sprint): `chordTarget` builds a target from frets,
// `StrumAnalyzer` turns capture blocks into strums with chroma, `verifyChord` checks one strum against the
// expected target and the alternatives the game offers.
import DSP, { chordTemplate, normalize, freqToMidi, midiToFreq, OnsetDetector } from '../dsp/dsp.js';

const magSpectrum = (DSP as unknown as { magSpectrum: (f: Float32Array) => Float64Array }).magSpectrum;
/** M0's chroma (dsp.js `chroma`: spectral peaks 75–1500 Hz within 40 dB of the strongest, on the semitone grid,
 *  sqrt-compressed, peaks within ±25 cents of a semitone) computed from a magnitude spectrum, so ringing can be taken out first. */
export function chromaFromMag(mag: ArrayLike<number>, sr: number, n: number, lo = 75, hi = 1500, relDb = 40): number[] {
  const binHz = sr / n, k0 = Math.max(2, Math.ceil(lo / binHz)), k1 = Math.min(mag.length - 2, Math.floor(hi / binHz));
  let mx = 0; for (let k = k0; k <= k1; k++) if (mag[k] > mx) mx = mag[k];
  const ch = new Array(12).fill(0);
  if (mx <= 0) return ch;
  const floor = mx * 10 ** (-relDb / 20);
  for (let k = k0; k <= k1; k++) {
    const m = mag[k];
    if (m < floor || m < mag[k - 1] || m < mag[k + 1]) continue;
    const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(m + 1e-12), g = Math.log(mag[k + 1] + 1e-12), den = a - 2 * b + g;
    const midi = freqToMidi((k + (den !== 0 ? 0.5 * (a - g) / den : 0)) * binHz), rr = Math.round(midi);
    if (Math.abs(midi - rr) > 0.25) continue;
    ch[((rr % 12) + 12) % 12] += Math.sqrt(m / mx);
  }
  return normalize(ch);
}

// ---------- catalog shapes ----------
export interface Voicing { name: string; frets: number[][]; where: string; root: string; quality: string; /** fuller name when the catalog has one: 'Bm (partial)' */ label?: string }
export interface ChordChangesEx { id: string; name: string; type: 'chord_changes'; pairs: string[][]; duration_s: number; target_per_min: number; voicings: Record<string, Voicing> }
export interface ChordVariant { key: string; capo: number; chords: string[]; numbers?: string[]; shapes?: string; label: string; /** names spelled for this key (G#m in B) */ names?: Record<string, string> }
export interface ChordProgEx {
  id: string; name: string; type: 'chord_progression'; meter: string; pace: 'timed' | 'own'; bpm?: number; tempo?: { start: number; target: number; step: number };
  beats_per_chord?: number; strums_per_chord?: number; pick: 'only' | 'random' | 'choose'; show: 'chords' | 'numbers'; variants: ChordVariant[]; decoys?: string[];
  voicings: Record<string, Voicing>; notes?: string;
  /** only these chords' strums are graded, and each must reach the ratio on its own (A.12: F and Bm) */
  focus?: string[];
}

// ---------- templates ----------
const OPEN = [40, 45, 50, 55, 59, 64];
/** Frets as they sound with a capo (open strings sound at the capo). */
export const soundingFrets = (frets: number[], capo = 0): number[] => frets.map(f => (f < 0 ? -1 : f + capo));
export const pcsOf = (frets: number[]): number[] => [...new Set(frets.flatMap((f, i) => (f < 0 ? [] : [(OPEN[i] + f) % 12])))].sort((a, b) => a - b);
/** A chord to verify against: one template per accepted fingering, at sounding pitch. */
export interface ChordTarget { id: string; name: string; templates: number[][]; pcs: number[]; frets: number[][]; decoy?: string; /** lowest sounding MIDI note */ bass: number }
export function chordTarget(id: string, name: string, fretsList: number[][], capo = 0, decoy?: string): ChordTarget {
  const sounding = fretsList.map(f => soundingFrets(f, capo));
  const bass = Math.min(...sounding.map(f => Math.min(...f.flatMap((x, i) => (x < 0 ? [] : [OPEN[i] + x])))));
  return { id, name, templates: sounding.map(f => chordTemplate(f)), pcs: pcsOf(sounding[0]), frets: sounding, bass, ...(decoy ? { decoy } : {}) };
}
/** `big` has every pitch class of `small` and at least one more. */
export const contains = (big: number[], small: number[]) => big.length > small.length && small.every(p => big.includes(p));
const samePcs = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Targets for one variant of a chord_progression (unique chords in order) and the decoys to verify against:
 *  the exercise's decoys, plus, with a capo, the same shapes without it (unless one sounds like a real chord). */
export function progressionTargets(ex: Pick<ChordProgEx, 'voicings' | 'decoys'>, v: ChordVariant): { targets: Record<string, ChordTarget>; order: string[]; decoys: ChordTarget[] } {
  const order = [...new Set(v.chords)];
  const targets = Object.fromEntries(order.map(r => [r, chordTarget(r, ex.voicings[r].name, ex.voicings[r].frets, v.capo)]));
  const real = Object.values(targets);
  const decoys: ChordTarget[] = [];
  for (const d of ex.decoys || []) if (ex.voicings[d]) decoys.push(chordTarget(`decoy:${d}`, ex.voicings[d].name, ex.voicings[d].frets, v.capo, 'stand-in'));
  if (v.capo) for (const r of order) {
    const t = chordTarget(`nocapo:${r}`, `${ex.voicings[r].name} without capo`, ex.voicings[r].frets, 0, 'no capo');
    if (!real.some(x => samePcs(x.pcs, t.pcs)) && !decoys.some(x => samePcs(x.pcs, t.pcs))) decoys.push(t);
  }
  return { targets, order, decoys };
}
export function pairTargets(ex: Pick<ChordChangesEx, 'voicings'>, pair: string[]): [ChordTarget, ChordTarget] {
  const t = (r: string) => chordTarget(r, ex.voicings[r].name, ex.voicings[r].frets);
  return [t(pair[0]), t(pair[1])];
}

// ---------- verifying one strum ----------
/** Below this cosine a strum doesn't sound like any chord offered (muted scratch, noise, silence). Synthetic
 *  strums of the right chord score 0.87–0.95; a first guess to check on the phone. */
export const MIN_SCORE = 0.7;
/** A decoy (a stand-in the lesson warns against, or the shapes without the capo) must beat the expected chord by
 *  this much to count as heard: the expected chord's own overtones can land on the decoy's extra note (a barre F's
 *  A3 and C3 put energy on E, Fmaj7's extra note). Synthetic, 6 seeds: a right F was heard as Fmaj7 on 0/60 lone
 *  strums and 0/24 in the A.12 progression; a played Fmaj7 is caught on 75–100 % of strums (0.04 caught fewer). */
export const DECOY_MARGIN = 0.02;
/** changes_per_min: a strum counts as one chord of the pair only if it beats the other by this much. */
export const MIN_MARGIN = 0.015;
const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < 12; i++) s += a[i] * b[i]; return s; };
/** Best cosine over a target's fingerings. */
export const scoreChord = (ch: number[], t: ChordTarget): number => Math.max(...t.templates.map(tp => dot(ch, tp)));
export interface ChordVerdict { ok: boolean; expected: string; heard: string | null; score: number; best: number; margin: number; why?: 'other' | 'unclear' | 'silent' | 'bass' }
/** Low-root check. Chroma can't tell a barre F from Fmaj7 or a full Bm from the partial one (the same or almost the
 *  same pitch classes); the bass can: the barre's root on string 6/5 (F2, B2) is a fifth or more below anything in
 *  the twin. When a candidate is such a twin (same notes, or all of them plus more) with its lowest note ≥ BASS_GAP
 *  semitones higher, the expected chord's lowest note must show in the strum's spectrum (≥ BASS_DB re the loudest
 *  peak), or the strum counts as the twin. */
export const BASS_GAP = 5, BASS_DB = -40;
/** Strength (dB re the frame's loudest peak, 60–1500 Hz) of the peak at a MIDI note, from a strum's low profile. */
export const LOW_MIN = 36, LOW_MAX = 64;
export const lowDb = (low: number[] | null | undefined, midi: number): number => (low && midi >= LOW_MIN && midi <= LOW_MAX ? low[midi - LOW_MIN] : 0);
/** Does this strum's chroma match the expected chord better than every alternative (and well enough)?
 *  `heard` is the best-scoring chord when it clears MIN_SCORE, else null. */
export function verifyChord(ch: number[] | null, expected: ChordTarget, others: ChordTarget[], minScore = MIN_SCORE, decoyMargin = DECOY_MARGIN, low: number[] | null = null): ChordVerdict {
  if (!ch || !ch.some(x => x > 0)) return { ok: false, expected: expected.id, heard: null, score: 0, best: 0, margin: 0, why: 'silent' };
  const exp = scoreChord(ch, expected);
  if (low && exp >= minScore && lowDb(low, expected.bass) < BASS_DB) {
    const twins = others.filter(o => o.id !== expected.id && o.bass - expected.bass >= BASS_GAP && (samePcs(o.pcs, expected.pcs) || contains(o.pcs, expected.pcs)));
    if (twins.length) {
      const tw = twins.map(o => ({ o, s: scoreChord(ch, o) })).sort((a, b) => b.s - a.s)[0];
      return { ok: false, expected: expected.id, heard: tw.o.id, score: exp, best: Math.max(exp, tw.s), margin: exp - tw.s, why: 'bass' };
    }
  }
  let bestOther = -1, bestId: string | null = null;
  for (const o of others) {
    if (o.id === expected.id) continue;
    // a decoy, or a chord holding every note of the expected one plus more (G7 ⊃ G, Cadd9 ⊃ C, Em7 ⊃ Em), must win
    // by a margin: the expected chord's own overtones can supply the extra note
    const s = scoreChord(ch, o) - (o.decoy || contains(o.pcs, expected.pcs) ? decoyMargin : 0);
    if (s > bestOther) { bestOther = s; bestId = o.id; }
  }
  const top = Math.max(exp, bestOther), margin = exp - Math.max(0, bestOther);
  const heard = top < minScore ? null : exp >= bestOther ? expected.id : bestId;
  const ok = heard === expected.id;
  return { ok, expected: expected.id, heard, score: exp, best: top, margin, ...(ok ? {} : { why: heard === null ? 'unclear' : 'other' }) };
}

// ---------- streaming strum analysis ----------
/** `low[m - LOW_MIN]`: how strongly MIDI note m (C2–E4) shows as a peak, dB re the loudest peak (mean over the window). */
export interface Strum { t: number; chroma: number[] | null; level: number; frames: number; low?: number[] | null }
/** Ringing compensation: how much of the pre-onset spectrum is assumed still ringing, and the share of energy that
 *  must be new for the compensated chroma to be used. */
export const RING_KEEP = 0.9, FRESH_MIN = 0.3;
/** …and only when the chord changed: if what rang before already sounds like what's heard now (the same chord
 *  strummed again), subtracting it would leave a random handful of strings (whichever were hit harder this time),
 *  and three strings of G can look like Bm. */
export const SAME_CHORD_COS = 0.9;
/** A slow strum spreads over 50–150 ms of strings, and the flux detector can fire twice inside it. One strum per
 *  150 ms is still faster than eighths at 200 BPM, so onsets closer than that are one strum (own-pace boxes would
 *  otherwise advance early and every later chord would be checked against the wrong box). */
export const STRUM_MIN_GAP_S = 0.15;
export interface StrumOpts { winStart?: number; winEnd?: number; fftN?: number; stepS?: number; ringS?: number; latencyS?: number }
/** Capture blocks in, strums out. Each onset's chroma is averaged over [onset + 60 ms, min(onset + 450 ms, next
 *  onset)]; when the next strum comes sooner than one 8192-sample frame fits, one frame from onset + 30 ms is
 *  used anyway (fast strumming of the same chord). A strum is emitted once its window has passed. `det` is the
 *  onset detector, so a runner can learn click bleed in a count-in (`learnBleed`, `isNearClick`). */
export class StrumAnalyzer {
  readonly sr: number; readonly det: InstanceType<typeof OnsetDetector>;
  private o: Required<StrumOpts>; private ring: Float32Array; private end = 0; private pending: number[] = [];
  /** Called as soon as a strum's onset is detected (seconds), before its chroma is ready. */
  onOnset: ((t: number) => void) | null = null;
  constructor(sr: number, o: StrumOpts = {}, det?: InstanceType<typeof OnsetDetector>) {
    this.sr = sr; this.det = det ?? new OnsetDetector(sr, { minGap: STRUM_MIN_GAP_S });
    this.o = { winStart: 0.06, winEnd: 0.45, fftN: 8192, stepS: 0.02, ringS: 3, latencyS: 0.03, ...o };
    this.ring = new Float32Array(Math.ceil(this.o.ringS * sr));
  }
  push(d: Float32Array, startFrame: number): Strum[] {
    const R = this.ring.length;
    for (let i = 0; i < d.length; i++) this.ring[(startFrame + i) % R] = d[i];
    this.end = startFrame + d.length;
    for (const f of this.det.push(d, startFrame)) { this.pending.push(f); this.onOnset?.(f / this.sr); }
    return this.drain(false);
  }
  /** Finish every pending strum with the audio there is (end of an attempt). */
  flush(): Strum[] { return this.drain(true); }
  private drain(all: boolean): Strum[] {
    const out: Strum[] = [], sr = this.sr, N = this.o.fftN;
    while (this.pending.length) {
      const on = this.pending[0], next = this.pending[1];
      const a = on + this.o.winStart * sr;
      let b = on + this.o.winEnd * sr;
      if (next !== undefined) b = Math.min(b, next);
      const fits = b - a >= N;
      const need = (fits ? b : on + 0.03 * sr + N) + this.o.latencyS * sr;
      if (!all && this.end < need) break;
      this.pending.shift();
      out.push(this.analyze(on, fits ? a : on + 0.03 * sr, fits ? b : on + 0.03 * sr + N));
    }
    return out;
  }
  private read(s: number, out: Float32Array): boolean {
    const R = this.ring.length;
    if (s < 0 || this.end - s > R || s + out.length > this.end) return false;
    for (let i = 0; i < out.length; i++) out[i] = this.ring[(s + i) % R];
    return true;
  }
  /** Ringing compensation: strings the new chord doesn't strike keep sounding the old chord. The spectrum just
   *  before the onset is that ringing; peaks that didn't get louder after the onset are left out (a string can
   *  only get louder by being struck again). When that leaves little (the same notes struck again, e.g. an
   *  upstrum on the same chord), or the same chord was strummed again, M0's plain chroma is used. */
  private analyze(on: number, a: number, b: number): Strum {
    const sr = this.sr, N = this.o.fftN, step = Math.round(this.o.stepS * sr);
    const acc = new Array(12).fill(0), lowAcc = new Array(LOW_MAX - LOW_MIN + 1).fill(0); let frames = 0, e = 0, n = 0;
    const frame = new Float32Array(N), binHz = sr / N;
    const pre = this.read(Math.round(on - 0.005 * sr) - N, frame) ? magSpectrum(frame) : null;
    const preCh = pre ? chromaFromMag(pre, sr, N) : null;
    for (let s = Math.round(a); s + N <= Math.round(b) + 1 && s + N <= this.end; s += step) {
      if (!this.read(s, frame)) continue;
      if (frames === 0) { for (let i = 0; i < N; i++) e += frame[i] * frame[i]; n = N; }
      let ch: number[] | null = null;
      const post = magSpectrum(frame), plain = chromaFromMag(post, sr, N); // = dsp.js chroma(frame)
      let mx = 0; for (let k = Math.ceil(60 / binHz); k <= Math.floor(1500 / binHz); k++) if (post[k] > mx) mx = post[k];
      for (let m = LOW_MIN; m <= LOW_MAX; m++) {
        const f = midiToFreq(m), k0 = Math.floor(f * 2 ** (-0.4 / 12) / binHz), k1 = Math.ceil(f * 2 ** (0.4 / 12) / binHz);
        let pk = 0; for (let k = k0; k <= k1; k++) if (post[k] > pk) pk = post[k];
        lowAcc[m - LOW_MIN] += mx > 0 ? pk / mx : 0;
      }
      if (pre && preCh && dot(preCh, plain) < SAME_CHORD_COS) {
        const fresh = new Float64Array(post.length);
        let ep = 0, ef = 0;
        for (let k = 0; k < post.length; k++) { const d = post[k] - RING_KEEP * pre[k]; fresh[k] = d > 0 ? d : 0; ep += post[k] * post[k]; ef += fresh[k] * fresh[k]; }
        if (ef >= FRESH_MIN * ep) ch = chromaFromMag(fresh, sr, N);
      }
      (ch ?? plain).forEach((v, i) => { acc[i] += v; });
      frames++;
    }
    return { t: on / sr, chroma: frames ? normalize(acc) : null, level: n ? Math.sqrt(e / n) : 0, frames, low: frames ? lowAcc.map(x => 20 * Math.log10(x / frames + 1e-9)) : null };
  }
}

// ---------- chord_accuracy: plan and grading ----------
export interface ChordBox { i: number; ref: string; label: string; number?: string; t0: number; t1: number }
export interface ChordPlan { bpm: number; beat: number; beatsPerBar: number; countIn: number[]; clicks: { t: number; kind: 0 | 1 | 2 }[]; boxes: ChordBox[]; start: number; end: number }
/** Box label as the player should see it: the chord name, or only the number on a number chart. */
export function boxLabel(ex: Pick<ChordProgEx, 'voicings' | 'show'>, v: ChordVariant, i: number): string {
  return ex.show === 'numbers' && v.numbers ? v.numbers[i] : v.names?.[v.chords[i]] ?? ex.voicings[v.chords[i]].name;
}
/** Timed: one bar of count-in clicks, then a click on every beat; each chord lasts `beats_per_chord`. */
export function buildChordPlan(ex: Pick<ChordProgEx, 'voicings' | 'show' | 'beats_per_chord'>, v: ChordVariant, bpm: number, beatsPerBar: number, t0: number): ChordPlan {
  const beat = 60 / bpm, start = t0 + beatsPerBar * beat, per = ex.beats_per_chord || beatsPerBar;
  const countIn = Array.from({ length: beatsPerBar }, (_, i) => t0 + i * beat);
  const total = v.chords.length * per;
  const clicks: ChordPlan['clicks'] = countIn.map((t, i) => ({ t, kind: i === 0 ? 0 : 1 }));
  for (let b = 0; b < total; b++) clicks.push({ t: start + b * beat, kind: b % beatsPerBar === 0 ? 0 : 1 });
  const boxes = v.chords.map((ref, i) => ({ i, ref, label: boxLabel(ex, v, i), number: v.numbers?.[i], t0: start + i * per * beat, t1: start + (i + 1) * per * beat }));
  return { bpm, beat, beatsPerBar, countIn, clicks, boxes, start, end: start + total * beat };
}

export interface StrumResult { t: number; box: number; expected: string; heard: string | null; ok: boolean; score: number; margin: number; skipped?: 'change' }
export interface BoxResult { ref: string; label: string; strums: number; ok: number }
export interface FocusResult { ref: string; correct: number; graded: number; ratio: number; met: boolean }
export interface ChordGrade {
  strums: StrumResult[]; boxes: BoxResult[];
  /** what `correct`/`graded` count: chord boxes (timed: a bar is right when most of its strums are) or strums (own pace) */
  unit: 'bars' | 'strums'; graded: number; correct: number;
  /** timed: chord boxes with no strum at all · own pace: strums never played (misses) */
  missedBoxes: number; owed: number; ratio: number; target: number;
  /** exercises with `focus`: each focus chord on its own (all must reach the target) */
  focus: FocusResult[];
  met: boolean; clean: boolean; sloppy: boolean; great: boolean;
  /** expected chord id → heard chord id (or 'unclear' / 'none') → strums */
  confusion: Record<string, Record<string, number>>;
}
/** How close to a chord change a strum may land before it's left ungraded (a strum on the old chord just before
 *  the bar line, or the change itself): the last half beat of a box when the next chord differs. A strum up to
 *  80 ms early (after the latency offset) counts for the coming chord. */
export const CHANGE_GUARD_BEATS = 0.5, EARLY_S = 0.08;
type Tg = { targets: Record<string, ChordTarget>; decoys: ChordTarget[] };
/** Grade strums against a click plan, bar by bar: a chord box is right when more than half of its strums sound
 *  like its chord, so strumming more doesn't dilute a bar you didn't get (spec: ratio of strums → here ratio of
 *  chord boxes, which can't be gamed by strum count). A box with no strum is wrong. `offsetS` = calibrated input
 *  latency, subtracted from onset times. */
export function gradeTimedChords(strums: Strum[], plan: ChordPlan, tg: Tg, o: { offsetS: number; ratio: number; minScore?: number; focus?: string[] }): ChordGrade {
  const all = [...Object.values(tg.targets), ...tg.decoys];
  const guard = CHANGE_GUARD_BEATS * plan.beat;
  const res: StrumResult[] = [];
  for (const s of strums) {
    const tt = s.t - o.offsetS;
    const bi = plan.boxes.findIndex(b => tt >= b.t0 - EARLY_S && tt < b.t1 - EARLY_S);
    if (bi < 0) continue;
    const b = plan.boxes[bi], next = plan.boxes[bi + 1];
    const v = verifyChord(s.chroma, tg.targets[b.ref], all, o.minScore, DECOY_MARGIN, s.low ?? null);
    const r: StrumResult = { t: s.t, box: bi, expected: b.ref, heard: v.heard, ok: v.ok, score: v.score, margin: v.margin };
    if (next && next.ref !== b.ref && tt >= b.t1 - guard - EARLY_S && !v.ok) r.skipped = 'change';
    res.push(r);
  }
  return summarize(res, plan.boxes.map(b => ({ ref: b.ref, label: b.label })), o.ratio, 'bars', 0, o.focus);
}
/** Own pace: strums were assigned to boxes in order (`strums_per_chord` each) as they came in. Strums the player
 *  never got to (finished early or ran out of time) count as misses. */
export function gradeOwnChords(res: StrumResult[], boxes: { ref: string; label: string }[], perBox: number, ratio: number, focus?: string[]): ChordGrade {
  const owedBy = boxes.map((_, i) => Math.max(0, perBox - res.filter(r => r.box === i).length));
  return summarize(res, boxes, ratio, 'strums', owedBy, focus);
}
function summarize(res: StrumResult[], boxes: { ref: string; label: string }[], target: number, unit: 'bars' | 'strums', owedBy: number[] | 0, focus?: string[]): ChordGrade {
  const br: BoxResult[] = boxes.map(b => ({ ref: b.ref, label: b.label, strums: 0, ok: 0 }));
  const confusion: ChordGrade['confusion'] = {};
  for (const r of res) {
    if (r.skipped) continue;
    br[r.box].strums++; if (r.ok) br[r.box].ok++;
    const h = r.heard ?? 'unclear';
    (confusion[r.expected] ||= {})[h] = (confusion[r.expected][h] || 0) + 1;
  }
  const owed = (i: number) => (owedBy ? owedBy[i] : 0);
  if (!owedBy) for (const b of br) if (b.strums === 0) (confusion[b.ref] ||= {}).none = (confusion[b.ref].none || 0) + 1;
  const boxOk = (b: BoxResult) => b.strums > 0 && b.ok * 2 > b.strums;
  /** correct / graded over the boxes whose chord is in `refs` */
  const tally = (idx: number[]) => unit === 'bars'
    ? { correct: idx.filter(i => boxOk(br[i])).length, graded: idx.length }
    : { correct: idx.reduce((a, i) => a + br[i].ok, 0), graded: idx.reduce((a, i) => a + br[i].strums + owed(i), 0) };
  const counted = br.map((_, i) => i).filter(i => !focus?.length || focus.includes(br[i].ref));
  const { correct, graded } = tally(counted);
  const ratio = graded ? correct / graded : 0;
  const fr: FocusResult[] = (focus || []).map(f => { const t = tally(br.map((_, i) => i).filter(i => br[i].ref === f)); const rr = t.graded ? t.correct / t.graded : 0; return { ref: f, ...t, ratio: rr, met: rr >= target - 1e-9 }; });
  const met = correct > 0 && ratio >= target - 1e-9 && fr.every(x => x.met);
  const missedBoxes = owedBy ? 0 : br.filter(b => b.strums === 0).length;
  const owedTotal = owedBy ? counted.reduce((a, i) => a + owed(i), 0) : 0;
  return { strums: res, boxes: br, unit, graded, correct, missedBoxes, owed: owedTotal, ratio, target, focus: fr, met, clean: met,
    sloppy: ratio < Math.max(0.5, target - 0.2), great: met && ratio >= 0.97, confusion };
}

// ---------- changes_per_min ----------
export interface ChangeStrum { t: number; heard: string | null; score: number; margin: number; counted: boolean }
export interface ChangesResult { pair: [string, string]; names: [string, string]; strums: ChangeStrum[]; changes: number; windowS: number; perMin: number; target: number; met: boolean; unclear: number }
/** Classify a strum as one chord of the pair (the expected set is just these two), or null when it's neither
 *  clearly: below MIN_SCORE, or too close to call. */
export function classifyPair(ch: number[] | null, a: ChordTarget, b: ChordTarget, minScore = MIN_SCORE, minMargin = MIN_MARGIN): { heard: string | null; score: number; margin: number } {
  if (!ch || !ch.some(x => x > 0)) return { heard: null, score: 0, margin: 0 };
  const sa = scoreChord(ch, a), sb = scoreChord(ch, b), top = Math.max(sa, sb), margin = Math.abs(sa - sb);
  return { heard: top < minScore || margin < minMargin ? null : sa > sb ? a.id : b.id, score: top, margin };
}
/** Count correct strums that follow a strum of the other chord (the last clearly heard one), within [t0, t1). */
export function countChanges(strums: Strum[], a: ChordTarget, b: ChordTarget, t0: number, t1: number, target: number, o: { minScore?: number; minMargin?: number } = {}): ChangesResult {
  const out: ChangeStrum[] = [];
  let prev: string | null = null, changes = 0, unclear = 0;
  for (const s of strums) {
    if (s.t < t0 || s.t >= t1) continue;
    const c = classifyPair(s.chroma, a, b, o.minScore, o.minMargin);
    const counted = c.heard !== null && prev !== null && c.heard !== prev;
    if (counted) changes++;
    if (c.heard === null) unclear++; else prev = c.heard;
    out.push({ t: s.t, heard: c.heard, score: c.score, margin: c.margin, counted });
  }
  const windowS = t1 - t0, perMin = windowS > 0 ? (changes * 60) / windowS : 0;
  return { pair: [a.id, b.id], names: [a.name, b.name], strums: out, changes, windowS, perMin, target, met: perMin >= target - 1e-9, unclear };
}

// ---------- what the lesson expects ----------
export type ChordSetup =
  | { kind: 'changes'; ex: ChordChangesEx; pairs: string[][]; target: number }
  | { kind: 'accuracy'; ex: ChordProgEx; ratio: number; bpm: number | null; ladder: boolean };
interface LessonLike { id: string; pass_criteria: { type: string; [k: string]: unknown }; assets: Record<string, string[]> }
/** The exercise a chord lesson is graded on (build_catalog.py guarantees exactly one of the right type). */
export function chordSetup(l: LessonLike, cat: { exercises: { id: string; type: string }[] }): ChordSetup | null {
  const p = l.pass_criteria;
  const kind = p.type === 'changes_per_min' ? 'chord_changes' : p.type === 'chord_accuracy' ? 'chord_progression' : null;
  if (!kind) return null;
  const ex = (l.assets.exercises || []).map(id => cat.exercises.find(e => e.id === id)).find(e => e?.type === kind);
  if (!ex) return null;
  if (kind === 'chord_changes') {
    const x = ex as unknown as ChordChangesEx, pair = p.pair as string[] | undefined;
    const pairs = pair ? x.pairs.filter(pp => pp.map(r => r.split('|')[0]).join() === pair.join()) : x.pairs;
    return { kind: 'changes', ex: x, pairs, target: p.target as number };
  }
  const x = ex as unknown as ChordProgEx;
  const ladder = typeof p.bpm === 'number';
  return { kind: 'accuracy', ex: x, ratio: p.ratio as number, bpm: x.pace === 'timed' ? (ladder ? (p.bpm as number) : x.bpm ?? null) : null, ladder };
}
/** Which variant this attempt plays: the only one, the player's choice, or a key "named on the spot". */
export function pickVariant(ex: ChordProgEx, choice?: number, rnd: () => number = Math.random): number {
  if (ex.pick === 'random') return Math.floor(rnd() * ex.variants.length) % ex.variants.length;
  if (ex.pick === 'choose') return Math.max(0, Math.min(ex.variants.length - 1, choice ?? 0));
  return 0;
}

/** Plain-language summary for the result card. */
export function chordCoach(g: ChordGrade, names: Record<string, string>): string {
  const n = (id: string) => names[id] ?? (id.startsWith('nocapo:') ? 'the shape without the capo' : id.startsWith('decoy:') ? names[id.slice(6)] ?? id.slice(6) : id);
  if (g.graded === 0 || g.strums.length === 0) return 'I didn’t hear any strums. Strum a bit harder, or move the phone closer to the guitar.';
  const wrong: [string, string, number][] = [];
  for (const [e, row] of Object.entries(g.confusion)) for (const [h, c] of Object.entries(row)) if (h !== e) wrong.push([e, h, c]);
  wrong.sort((a, b) => b[2] - a[2]);
  if (!wrong.length) return 'Every strum sounded like the right chord.';
  const [e, h] = wrong[0];
  // a forgotten (or misplaced) capo also makes some shapes sound like other chords of the key, so look at the
  // share of wrong strums that match a shape without the capo, not just the most common confusion
  const total = wrong.reduce((a, w) => a + w[2], 0), noCapo = wrong.filter(w => w[1].startsWith('nocapo:')).reduce((a, w) => a + w[2], 0);
  if (noCapo >= total / 3 || h.startsWith('nocapo:')) return 'Some chords sounded as if the capo wasn’t on (or was on the wrong fret). Check the capo, then play the same shapes.';
  const unmet = g.focus.filter(f => !f.met);
  const twin = wrong.find(w => w[1].startsWith('decoy:') && g.focus.some(f => f.ref === w[0]));
  if (twin) return `Some ${n(twin[0])} strums sounded like ${n(twin[1])}: for the barre, keep the index flat across ${/^B/.test(n(twin[0])) ? 'strings 5 to 1 so the low root on string 5' : 'all six strings so the low root on string 6'} rings.`;
  if (unmet.length) return `${unmet.map(f => n(f.ref)).join(' and ')} need${unmet.length === 1 ? 's' : ''} ${Math.round(g.target * 100)}% on ${unmet.length === 1 ? 'its' : 'their'} own. Check each string of the barre, one at a time.`;
  if (h === 'none') return `No strums were heard on ${n(e)}. Keep strumming through the changes, even if the chord isn't ready yet.`;
  if (h === 'unclear') return `Some ${n(e)} strums didn't sound like any of the chords. Check that every string in the shape rings (a muted or buzzing string blurs the chord).`;
  return g.met ? `Nearly all right. A few ${n(e)} strums sounded more like ${n(h)}.` : `Several ${n(e)} strums sounded like ${n(h)}. Check the fingers that differ between them, and let the chord ring before changing.`;
}
