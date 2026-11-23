// Pitch grader (06-app-spec.md §6 `pitch`). Pure: no audio, no DOM, so it's unit-tested with synthetic notes.
//
// The app always knows what you're supposed to play, so nothing here recognizes music open-endedly:
//  - `cents` lessons hold expected targets (F.02 the six open strings, EL.05 bends) within ±cents for 0.5 s.
//  - `note_accuracy` lessons play an exercise; each expected note is checked against what was heard, in order.
//
// Pipeline: PitchTracker (YIN from the engine's DSP + spectral peaks, every 1024 samples) → segmentNotes
// (spectral-flux onsets, sustained pitch changes and silence split the audio into notes) → gradeNotes
// (in-order alignment of expected notes to heard notes; with a click, each note must also land within
// about half a beat of where it belongs).
//
// Octaves: a note counts only in its written octave, unless the lesson says `any_octave` (EL.07: a melody
// is right in any octave, and the lesson suggests playing it as octaves). YIN sometimes reports the octave
// above a note whose 2nd harmonic is strong (or, rarely, the one below); those slips are told apart from a
// really-wrong octave by checking the spectrum for the expected note's own fundamental or its 3rd harmonic,
// which an octave-higher note doesn't have. Octave shapes (EL.04) are graded on the low note: the high note
// is an exact harmonic of it, so it can't be heard separately. Tuning (F.02) accepts an octave slip, since
// the needle reading is the same and phone mics often hear a low string's octave.
import DSP, { yin, freqToMidi, midiToFreq, mean, median } from '../dsp/dsp.js';
import type { Catalog, Lesson } from '../catalog';

const magSpectrum = (DSP as unknown as { magSpectrum: (f: Float32Array) => Float64Array }).magSpectrum;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = (m: number): string => NAMES[((Math.round(m) % 12) + 12) % 12] + (Math.floor(Math.round(m) / 12) - 1);

export interface PitchCriteria { type: 'pitch'; cents?: number; note_accuracy?: number; scope?: string; bpm?: number; any_octave?: boolean }
export interface TabEvent { beat: number; string: number; fret: number; dur: number; tech?: string; bend?: number }

// ---------- what the lesson expects ----------
const OPEN = [40, 45, 50, 55, 59, 64]; // MIDI of open strings 6 → 1
const HARMONIC_UP: Record<number, number> = { 12: 12, 7: 19, 5: 24 };
/** Sounding MIDI note of a tab event (same rule as build_catalog.py `ev_midi`). */
export function eventMidi(e: TabEvent): number {
  const o = OPEN[6 - e.string];
  if (e.tech === 'harmonic') return o + (HARMONIC_UP[e.fret] ?? e.fret);
  return o + e.fret + (e.bend || 0);
}
const place = (e: TabEvent) => (e.tech === 'harmonic' ? `str ${e.string}, harmonic at ${e.fret}` : `str ${e.string} fr ${e.fret}${e.tech === 'swell' ? ', swell' : ''}`);

/** One expected note (or octave / double stop). `t`, `dur` in beats from an exercise, or context seconds in a plan. */
export interface Expected { t: number; dur: number; midis: number[]; label: string; where: string; tech?: string }
export function expectedFromEvents(events: TabEvent[]): Expected[] {
  const byBeat = new Map<number, TabEvent[]>();
  for (const e of [...events].sort((a, b) => a.beat - b.beat || b.string - a.string)) byBeat.set(e.beat, [...(byBeat.get(e.beat) || []), e]);
  return [...byBeat.entries()].map(([beat, evs]) => {
    const midis = evs.map(eventMidi).sort((a, b) => a - b);
    return { t: beat, dur: Math.max(...evs.map(e => e.dur)), midis, label: midis.map(midiName).join('+'), where: evs.map(place).join(' + '), tech: evs[0].tech };
  });
}
/** single note, an octave shape (graded on its low note), or a double stop (both notes checked in the spectrum). */
export function noteKind(e: Pick<Expected, 'midis'>): 'single' | 'octave' | 'dyad' {
  if (e.midis.length === 1) return 'single';
  const lo = Math.min(...e.midis);
  return e.midis.every(m => (m - lo) % 12 === 0) ? 'octave' : 'dyad';
}

export interface HoldTarget { midi: number; from?: number; label: string; where: string; octaveSlack: boolean }
export type PitchMode = 'hold' | 'timed' | 'free';
export interface PitchSetup { mode: PitchMode; crit: PitchCriteria; exerciseId: string | null; expected: Expected[]; targets: HoldTarget[]; meter: string; dyads: boolean }
/** How a pitch lesson is graded and against what. Hold = cents lessons; timed = exercise with a click (bpm);
 *  free = exercise at your own pace. */
export function pitchSetup(l: Lesson, cat: Pick<Catalog, 'exercises'>): PitchSetup {
  const crit = l.pass_criteria as unknown as PitchCriteria;
  const ex = (l.assets.exercises || []).map(id => cat.exercises.find(e => e.id === id)).find(e => e && (e as { events?: unknown[] }).events) as
    (Catalog['exercises'][number] & { events: TabEvent[] }) | undefined;
  const meter = ex?.meter || '4/4';
  if (crit.cents !== undefined) {
    const targets: HoldTarget[] = crit.scope === 'all_strings' || !ex
      ? OPEN.map((m, i) => ({ midi: m, label: midiName(m), where: `open string ${6 - i}`, octaveSlack: true }))
      : ex.events.map(e => { const to = eventMidi(e), from = to - (e.bend || 0);
        return { midi: to, from: e.bend ? from : undefined, label: e.bend ? `${midiName(from)} → ${midiName(to)}` : midiName(to), where: `str ${e.string} fr ${e.fret}${e.bend ? `, bend a ${e.bend === 2 ? 'whole' : 'half'} step` : ''}`, octaveSlack: false }; });
    return { mode: 'hold', crit, exerciseId: ex?.id ?? null, expected: [], targets, meter, dyads: false };
  }
  const expected = ex ? expectedFromEvents(ex.events) : [];
  return { mode: crit.bpm ? 'timed' : 'free', crit, exerciseId: ex?.id ?? null, expected, targets: [], meter, dyads: expected.some(e => noteKind(e) === 'dyad') };
}

// ---------- frame analysis ----------
export interface Peak { f: number; db: number }
/** One analysis frame. `t` = centre of the YIN window (context seconds). `midi` is fractional (cents = fraction × 100). */
export interface PitchFrame { t: number; rms: number; midi: number | null; clarity: number; peaks: Peak[]; click: boolean }
export interface TrackerOpts { hop?: number; win?: number; fftN?: number; minFreq?: number; maxFreq?: number; minClarity?: number }

/** Spectral peaks 60–1750 Hz (below the click band), interpolated, in dB relative to the strongest. */
export function spectralPeaks(frame: Float32Array, sr: number, lo = 60, hi = 1750, maxN = 24, floorDb = -50): Peak[] {
  const mag = magSpectrum(frame), binHz = sr / frame.length;
  const k0 = Math.max(2, Math.ceil(lo / binHz)), k1 = Math.min(mag.length - 2, Math.floor(hi / binHz));
  let mx = 0;
  for (let k = k0; k <= k1; k++) if (mag[k] > mx) mx = mag[k];
  if (mx <= 1e-9) return [];
  const out: Peak[] = [];
  for (let k = k0; k <= k1; k++) {
    const m = mag[k];
    if (m < mag[k - 1] || m < mag[k + 1]) continue;
    const db = 20 * Math.log10(m / mx);
    if (db < floorDb) continue;
    const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(m + 1e-12), g = Math.log(mag[k + 1] + 1e-12);
    const den = a - 2 * b + g;
    out.push({ f: (k + (den !== 0 ? 0.5 * (a - g) / den : 0)) * binHz, db });
  }
  return out.sort((x, y) => y.db - x.db).slice(0, maxN);
}

/** Streaming pitch analysis: feed capture blocks (absolute start frame), get a frame every `hop` samples. */
export class PitchTracker {
  readonly sr: number; readonly hop: number; readonly win: number; readonly fftN: number;
  private minFreq: number; private maxFreq: number; private minClarity: number;
  private ring: Float32Array; private w = 0; private filled = 0; private since = 0; private frameEnd = 0;
  private buf: Float32Array;
  /** Set during click-accompanied attempts: true when [t0, t1] (window bounds, seconds) overlaps click bleed. */
  isNearClick: ((t0: number, t1: number) => boolean) | null = null;
  constructor(sr: number, o: TrackerOpts = {}) {
    this.sr = sr; this.hop = o.hop ?? 1024; this.win = o.win ?? 2048; this.fftN = o.fftN ?? 4096;
    this.minFreq = o.minFreq ?? 60; this.maxFreq = o.maxFreq ?? 1400; this.minClarity = o.minClarity ?? 0.75;
    this.ring = new Float32Array(this.fftN); this.buf = new Float32Array(this.fftN);
  }
  push(d: Float32Array, startFrame: number): PitchFrame[] {
    const out: PitchFrame[] = [];
    for (let i = 0; i < d.length; i++) {
      this.ring[this.w] = d[i]; this.w = (this.w + 1) % this.fftN;
      this.filled = Math.min(this.fftN, this.filled + 1); this.frameEnd = startFrame + i + 1;
      if (++this.since >= this.hop && this.filled >= this.win) { this.since = 0; out.push(this.analyze()); }
    }
    return out;
  }
  private analyze(): PitchFrame {
    const n = this.fftN, tail = n - this.w;
    this.buf.set(this.ring.subarray(this.w), 0); this.buf.set(this.ring.subarray(0, this.w), tail);
    const yb = this.buf.subarray(n - this.win);
    let s = 0; for (let i = 0; i < yb.length; i++) s += yb[i] * yb[i];
    const rms = Math.sqrt(s / yb.length);
    const t = (this.frameEnd - this.win / 2) / this.sr;
    const click = this.isNearClick ? this.isNearClick((this.frameEnd - this.win) / this.sr, this.frameEnd / this.sr) : false;
    const r = yin(yb, this.sr, { minFreq: this.minFreq, maxFreq: this.maxFreq, minRms: 0.002 });
    const ok = !!r && r.clarity >= this.minClarity;
    return { t, rms, midi: ok ? freqToMidi(r!.freq) : null, clarity: r ? r.clarity : 0, peaks: this.filled >= n ? spectralPeaks(this.buf, this.sr) : [], click };
  }
}
/** YIN range for a set of expected notes: room for the octave below and above (so slips can be checked). */
export function trackerRange(midis: number[]): { minFreq: number; maxFreq: number } {
  if (!midis.length) return { minFreq: 60, maxFreq: 1400 };
  const lo = midiToFreq(Math.min(...midis)), hi = midiToFreq(Math.max(...midis));
  return { minFreq: Math.max(50, lo * 0.45), maxFreq: Math.min(1750, Math.max(600, hi * 2.1)) };
}

// ---------- spectral evidence ----------
/** Loudest peak (dB re the frame's strongest) within ±tol cents of a note, or -Infinity. */
export function peakDb(peaks: Peak[], midi: number, tolCents = 40): number {
  let best = -Infinity;
  for (const p of peaks) if (Math.abs(freqToMidi(p.f) - midi) * 100 <= tolCents && p.db > best) best = p.db;
  return best;
}
/** Fraction of frames in which `midi` shows as a spectral peak at least `minDb`. */
export function presence(frames: PitchFrame[], midi: number, minDb = -30): number {
  const fr = frames.filter(f => f.peaks.length);
  return fr.length ? fr.filter(f => peakDb(f.peaks, midi) >= minDb).length / fr.length : 0;
}

// ---------- notes from frames ----------
export interface Segment { t0: number; t1: number; onset: boolean; frames: PitchFrame[]; settled: PitchFrame[]; midi: number | null; voiced: number }
/** Split frames into played notes. A note starts at a spectral-flux onset (pick attack), at a sustained
 *  change of pitch (legato, slides, swells without an attack) or after silence; it ends at the next start or
 *  when it fades out. Frames overlapping click bleed are skipped. Ringing from the previous note right after
 *  an onset is dropped, not counted as a note. */
export function segmentNotes(frames: PitchFrame[], onsets: number[], o: { floorRms?: number; hopS?: number } = {}): Segment[] {
  const fr = frames.filter(f => !f.click);
  const loudRms = fr.map(f => f.rms).sort((a, b) => a - b);
  const p95 = loudRms.length ? loudRms[Math.floor(loudRms.length * 0.95)] : 0;
  const floor = o.floorRms ?? Math.max(0.002, p95 * 0.06);
  const ons = [...onsets].sort((a, b) => a - b);
  const segs: Segment[] = [];
  let oi = 0, cur: Segment | null = null, quiet = 0, pend: PitchFrame[] = [], pendOnset: number | null = null;
  const start = (t0: number, onset: boolean): Segment => ({ t0, t1: t0, onset, frames: [], settled: [], midi: null, voiced: 0 });
  const close = () => { if (cur) { cur.frames.push(...pend); finalize(cur); if (cur.frames.length >= 3) segs.push(cur); } cur = null; pend = []; };
  const voicedOf = (a: PitchFrame[]) => a.filter(f => f.midi !== null).map(f => f.midi!);
  for (const f of fr) {
    while (oi < ons.length && ons[oi] <= f.t) pendOnset = ons[oi++];
    const loud = f.rms >= floor;
    if (!loud) { if (++quiet >= 3) close(); continue; }
    quiet = 0;
    if (pendOnset !== null) {
      if (f.t - pendOnset < 0.1) { close(); cur = start(pendOnset, true); }
      pendOnset = null;
    }
    if (!cur) cur = start(f.t, false);
    if (f.midi !== null) {
      const recent = voicedOf(cur.frames).slice(-7);
      const ref = recent.length >= 3 ? median(recent) : null;
      if (ref !== null && Math.abs(f.midi - ref) >= 0.7) {
        pend.push(f);
        let pv = voicedOf(pend);
        while (pv.length >= 3 && Math.max(...pv) - Math.min(...pv) > 0.5) { cur.frames.push(pend.shift()!); pv = voicedOf(pend); }
        if (pv.length >= 3) {
          // a new, steady pitch. Right after an onset it's the new note and the old pitch was ringing.
          if (cur.onset && pend[0].t - cur.t0 < 0.09) { cur.frames = pend; pend = []; }
          else { const p = pend; pend = []; close(); cur = start(p[0].t, false); cur.frames = p; }
        }
        continue;
      }
      if (pend.length) { cur.frames.push(...pend); pend = []; }
    } else if (pend.length) { pend.push(f); continue; }
    cur.frames.push(f);
  }
  close();
  return segs;
}
function finalize(s: Segment) {
  s.frames.sort((a, b) => a.t - b.t);
  s.t1 = s.frames.length ? s.frames[s.frames.length - 1].t : s.t0;
  let settled = s.frames.filter(f => f.t >= s.t0 + (s.onset ? 0.035 : 0));
  if (settled.filter(f => f.midi !== null).length < 2) settled = s.frames;
  s.settled = settled;
  const v = settled.filter(f => f.midi !== null).map(f => f.midi!);
  s.midi = v.length ? median(v) : null;
  s.voiced = settled.length ? v.length / settled.length : 0;
}

// ---------- verifying one heard note against one expected note ----------
export interface Verify { ok: boolean; heard: string | null; cents: number | null; why?: 'octave' | 'wrong' | 'silent' | 'extra' | 'missing' }
export function verifySegment(seg: Segment, e: Pick<Expected, 'midis'>, anyOctave = false): Verify {
  const fr = seg.settled.length ? seg.settled : seg.frames;
  const kind = noteKind(e);
  if (kind !== 'dyad') {
    const m = Math.min(...e.midis);
    // YIN is unsure when an earlier note is still ringing about as loud as the new one (it lands between
    // them). Then the spectrum decides: the expected note must be a strong peak through most of the note.
    const unsure = seg.midi === null || seg.voiced < 0.5 || Math.abs(seg.midi - Math.round(seg.midi)) > 0.3;
    if (unsure && presence(fr, m, -10) >= 0.6) return { ok: true, heard: midiName(m), cents: null };
    if (seg.midi === null) return { ok: false, heard: null, cents: null, why: 'silent' };
    const r = Math.round(seg.midi), d = r - m, cents = (seg.midi - r) * 100;
    if (d === 0) return { ok: true, heard: midiName(r), cents };
    if (anyOctave && d % 12 === 0) return { ok: true, heard: midiName(r), cents };
    // YIN heard the octave above: the expected note is really there if its fundamental or 3rd harmonic shows
    if (d === 12 && (presence(fr, m, -30) >= 0.4 || presence(fr, m + 19, -30) >= 0.4)) return { ok: true, heard: midiName(m), cents };
    // YIN heard the octave below: only if the expected note is strong and nothing sits an octave under it
    if (d === -12 && presence(fr, m, -20) >= 0.6 && presence(fr, m - 12, -35) < 0.2 && presence(fr, m + 7, -35) < 0.2) return { ok: true, heard: midiName(m), cents };
    return { ok: false, heard: midiName(r), cents, why: d % 12 === 0 ? 'octave' : 'wrong' };
  }
  // double stop: both notes ring (a note an octave above another can't be told from its harmonic, so it's
  // implied), nothing else rings strongly, and it isn't the same shape an octave down
  const need = e.midis.filter(x => !e.midis.some(y => y < x && (x - y) % 12 === 0));
  const pres = need.map(x => presence(fr, x, -30));
  const harmonics = e.midis.flatMap(m => [1, 2, 3, 4, 5, 6, 7, 8].map(h => freqToMidi(midiToFreq(m) * h)));
  const withPeaks = fr.filter(f => f.peaks.length);
  const unexplained = withPeaks.length ? withPeaks.filter(f => f.peaks.some(p => p.db >= -10 && !harmonics.some(h => Math.abs(freqToMidi(p.f) - h) * 100 <= 45))).length / withPeaks.length : 1;
  const low = presence(fr, Math.min(...e.midis) - 12, -15) >= 0.5;
  const present = need.filter((_, i) => pres[i] >= 0.5);
  const ok = withPeaks.length > 0 && present.length === need.length && unexplained < 0.5 && !low;
  const heard = present.length ? present.map(midiName).join('+') + (present.length < need.length ? ' only' : '') : seg.midi !== null ? midiName(seg.midi) : null;
  return { ok, heard, cents: null, why: ok ? undefined : low ? 'octave' : present.length < need.length ? 'missing' : 'extra' };
}

// ---------- note_accuracy ----------
export interface NoteResult { label: string; where: string; t: number; ok: boolean; heard: string | null; cents: number | null; offMs: number | null; why?: Verify['why'] }
export interface NotesGrade {
  mode: 'timed' | 'free'; notes: NoteResult[]; matched: number; expected: number; accuracy: number; extras: number; tooManyExtras: boolean;
  met: boolean; clean: boolean; sloppy: boolean; great: boolean; meanOffMs: number | null; heardNotes: number;
}
/** At your own pace there's no clock to rule notes out, so spraying notes could match everything in order.
 *  A free-mode attempt fails with more extra notes than this. First guess: tune it after the real-phone test
 *  (slides and swells may split into a few extra pieces on a real guitar). */
export const FREE_EXTRAS_MIN = 3, FREE_EXTRAS_RATIO = 0.5;
export const freeExtrasCap = (expected: number) => Math.max(FREE_EXTRAS_MIN, Math.ceil(expected * FREE_EXTRAS_RATIO));
/** Window (s) within which a timed note must start: half a beat, between 150 and 450 ms. */
export const noteTolerance = (beatS: number) => Math.min(0.45, Math.max(0.15, 0.5 * beatS));
/** Match expected notes to heard notes in order (an alignment, so one missed or extra note doesn't shift the rest).
 *  Timed: `exp[].t` are context seconds and a heard note must start within `tolS` (after subtracting `offsetS`,
 *  the calibrated latency). Score = matched / expected. */
export function gradeNotes(segs: Segment[], exp: Expected[], o: { target: number; timed: boolean; anyOctave?: boolean; tolS?: number; offsetS?: number }): NotesGrade {
  const E = exp.length, S = segs.length, tol = o.tolS ?? 0.3, off = o.offsetS ?? 0;
  const V = exp.map(e => segs.map(s => verifySegment(s, e, o.anyOctave)));
  const dt = (i: number, j: number) => segs[j].t0 - off - exp[i].t;
  const w = (i: number, j: number) => (!V[i][j].ok ? 0 : !o.timed ? 1 : Math.abs(dt(i, j)) > tol ? 0 : 1 + 0.01 * (1 - Math.abs(dt(i, j)) / tol));
  const dp = Array.from({ length: E + 1 }, () => new Float64Array(S + 1));
  for (let i = 1; i <= E; i++) for (let j = 1; j <= S; j++) {
    const m = w(i - 1, j - 1);
    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], m > 0 ? dp[i - 1][j - 1] + m : -1);
  }
  const pair: number[] = new Array(E).fill(-1);
  for (let i = E, j = S; i > 0 && j > 0;) {
    const m = w(i - 1, j - 1);
    if (m > 0 && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + m)) < 1e-9) { pair[i - 1] = j - 1; i--; j--; }
    else if (dp[i][j] === dp[i - 1][j]) i--;
    else j--;
  }
  const used = new Set(pair.filter(j => j >= 0));
  const notes: NoteResult[] = exp.map((e, i) => {
    const j = pair[i];
    if (j >= 0) return { label: e.label, where: e.where, t: e.t, ok: true, heard: V[i][j].heard, cents: V[i][j].cents, offMs: o.timed ? dt(i, j) * 1000 : null };
    // what was heard instead: the unmatched note nearest in time (timed) or in the gap between its neighbours (free)
    const prev = Math.max(-1, ...pair.slice(0, i).filter(x => x >= 0)), nextList = pair.slice(i + 1).filter(x => x >= 0), next = nextList.length ? nextList[0] : S;
    let cand = -1;
    for (let k = prev + 1; k < next; k++) {
      if (used.has(k)) continue;
      if (o.timed ? Math.abs(dt(i, k)) <= tol * 1.5 && (cand < 0 || Math.abs(dt(i, k)) < Math.abs(dt(i, cand))) : cand < 0) cand = k;
    }
    if (cand >= 0) used.add(cand);
    return { label: e.label, where: e.where, t: e.t, ok: false, heard: cand >= 0 ? V[i][cand].heard : null, cents: cand >= 0 ? V[i][cand].cents : null, offMs: null, why: cand >= 0 ? V[i][cand].why : 'silent' };
  });
  const matched = notes.filter(n => n.ok).length;
  const extras = segs.filter((s, j) => !used.has(j) && s.t1 - s.t0 >= 0.08 && s.voiced >= 0.5).length; // `used` has matched and heard-instead notes
  const accuracy = E ? matched / E : 0;
  const offs = notes.filter(n => n.offMs !== null).map(n => n.offMs!);
  const tooManyExtras = !o.timed && extras > freeExtrasCap(E);
  const met = E > 0 && accuracy >= o.target - 1e-9 && !tooManyExtras;
  return { mode: o.timed ? 'timed' : 'free', notes, matched, expected: E, accuracy, extras, tooManyExtras, met, clean: met, sloppy: accuracy < 0.8, great: E > 0 && matched === E,
    meanOffMs: offs.length ? mean(offs) : null, heardNotes: segs.length };
}

// ---------- cents: hold a target ----------
/** Largest pitch step (cents) between 21 ms frames that still counts as one gliding note. A bend moves about
 *  25–50 cents per frame; a newly fretted note a semitone away shows as ≥ 80 even with an in-between frame. */
const GLIDE = 60;
export interface HoldStatus { progress: number; done: boolean; cents: number | null; heard: string | null; rose: boolean }
/** Held pitch for `holdS`: ≥ 80 % of the last 0.5 s near the target, its average within ±cents and not
 *  drifting by more than ±cents (so a slow sweep through the target doesn't count; vibrato centred on it does).
 *  A bend target also needs the pitch to have risen from at least half the bend below it since the pick. */
export class HoldTracker {
  private win: { t: number; d: number | null }[] = [];
  private minRel = Infinity; private quiet = 0; private lastRaw: number | null = null; private jump: number[] | null = null;
  constructor(readonly target: HoldTarget, readonly cents: number, readonly holdS = 0.5, readonly floorRms = 0.003) {}
  restart() { this.win = []; this.minRel = Infinity; this.jump = null; }
  push(f: PitchFrame, onset = false): HoldStatus {
    const raw = f.midi === null ? null : (f.midi - this.target.midi) * 100;
    // A new pick restarts the note. The flux detector can also fire while a bend glides (new energy in new
    // bins); a glide is continuous, a new note jumps, so only a jump (or an unclear pitch) restarts.
    if (onset && !(raw !== null && this.lastRaw !== null && Math.abs(raw - this.lastRaw) <= GLIDE)) this.restart();
    // A jump that sticks (fretting or hammering a new note) is a new note too; a lone glitch or an octave slip isn't.
    if (raw !== null && this.lastRaw !== null) {
      const step = Math.abs(raw - this.lastRaw);
      if (this.jump) {
        if (Math.abs(raw - this.jump[0]) <= 50) { this.jump.push(raw); if (this.jump.length >= 3) { const j = this.jump; this.restart(); this.minRel = Math.min(...j); this.jump = null; } }
        else this.jump = null;
      }
      if (!this.jump && step > GLIDE && step < 1100) this.jump = [raw];
    }
    if (raw !== null) this.lastRaw = raw;
    if (f.rms < this.floorRms) { if (++this.quiet >= 3) { this.restart(); this.lastRaw = null; } return { progress: 0, done: false, cents: null, heard: null, rose: false }; }
    this.quiet = 0;
    let d = raw;
    // tuning: accept only the one slip YIN makes on a low string (reading its octave above), not any octave
    if (d !== null && this.target.octaveSlack && Math.abs(d - 1200) <= this.cents + 25) d -= 1200;
    if (raw !== null) this.minRel = Math.min(this.minRel, raw);
    this.win.push({ t: f.t, d });
    while (this.win.length && this.win[0].t < f.t - this.holdS - 1e-6) this.win.shift();
    const lim = this.cents + 25;
    const isNear = (x: { d: number | null }) => x.d !== null && Math.abs(x.d) <= lim;
    let runStart = f.t;
    for (let i = this.win.length - 1; i >= 0 && isNear(this.win[i]); i--) runStart = this.win[i].t;
    const near = this.win.filter(isNear);
    const span = f.t - this.win[0].t;
    const rose = this.target.from === undefined || this.minRel <= -(this.target.midi - this.target.from) * 50;
    let done = false;
    if (span >= this.holdS - 0.03 && near.length >= 0.8 * this.win.length && near.length >= 3) {
      const ds = near.map(x => x.d!), avg = mean(ds);
      const tm = mean(near.map(x => x.t)), num = near.reduce((s, x) => s + (x.t - tm) * (x.d! - avg), 0), den = near.reduce((s, x) => s + (x.t - tm) ** 2, 0);
      const drift = den > 0 ? Math.abs(num / den) * this.holdS : 0;
      done = Math.abs(avg) <= this.cents && drift <= this.cents && rose;
    }
    const progress = done ? 1 : Math.min(0.95, isNear({ d }) ? (f.t - runStart) / this.holdS : 0);
    return { progress, done, cents: d, heard: f.midi === null ? null : midiName(f.midi), rose };
  }
}

// ---------- timed plan ----------
export interface NotePlan { bpm: number; beat: number; beatsPerBar: number; countIn: number[]; clicks: { t: number; kind: 0 | 1 | 2 }[]; expected: Expected[]; start: number; end: number }
/** Click plan for an exercise played to a click: one bar of count-in, then a click on every beat until the
 *  last bar ends. `exp` in beats; the plan's expected notes are in context seconds. */
export function buildNotePlan(exp: Expected[], bpm: number, beatsPerBar: number, t0: number): NotePlan {
  const beat = 60 / bpm, start = t0 + beatsPerBar * beat;
  const lastBeat = Math.max(0, ...exp.map(e => e.t + e.dur));
  const total = Math.max(beatsPerBar, Math.ceil(lastBeat / beatsPerBar - 1e-9) * beatsPerBar);
  const countIn = Array.from({ length: beatsPerBar }, (_, i) => t0 + i * beat);
  const clicks: NotePlan['clicks'] = countIn.map((t, i) => ({ t, kind: i === 0 ? 0 : 1 }));
  for (let b = 0; b < total; b++) clicks.push({ t: start + b * beat, kind: b % beatsPerBar === 0 ? 0 : 1 });
  return { bpm, beat, beatsPerBar, countIn, clicks, start, end: start + total * beat, expected: exp.map(e => ({ ...e, t: start + e.t * beat, dur: e.dur * beat })) };
}

/** Plain-language summary for the result card. */
export function pitchCoach(g: NotesGrade): string {
  if (g.tooManyExtras) return `I heard ${g.extras} notes that aren't in the exercise. Play just these notes, one at a time, and let each ring.`;
  if (g.heardNotes < g.expected * 0.4) return 'I heard very few notes. Pick a bit harder, or move the phone closer to the amp or guitar.';
  const misses = g.notes.filter(n => !n.ok);
  if (!misses.length) return g.mode === 'timed' ? 'Every note right and in its place.' : 'Every note right.';
  const oct = misses.filter(n => n.why === 'octave').length, missing = misses.filter(n => n.why === 'missing').length;
  if (oct >= Math.max(2, misses.length / 2)) return 'Several notes were in the wrong octave. Check which string and fret each one is on.';
  if (missing >= Math.max(2, misses.length / 2)) return 'Some double stops only had one note ringing. Pluck both strings together and let them ring.';
  if (g.mode === 'timed' && misses.filter(n => n.heard === null).length >= misses.length / 2) return 'Some notes came too early or late, or weren’t heard. Keep each note in its beat.';
  return g.met ? 'Nearly all right. Clean up the red ones next time.' : 'Slow down and aim for every note; the red ones show what was heard instead.';
}
