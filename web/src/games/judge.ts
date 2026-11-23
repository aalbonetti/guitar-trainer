// Play mode (07-games.md §1): decide what a played note means for the question on screen. Pure, so it's
// unit-tested with synthetic notes through the real pitch tracker and onset detector.
//
// The game always knows the answer it expects, so nothing here recognizes notes open-endedly: each heard note is
// checked against the expected notes with the pitch grader's verifySegment (exact octave; YIN's octave slips are
// told apart from a really-wrong octave by the spectrum, as in M7). Games add two things lessons don't need,
// because here a note is played every second or two while the last one still rings:
//  - a ringing note that the onset detector splits (a buzz, a sympathetic string, a recovered misreading) is not
//    a new answer: picking a note again always adds energy;
//  - when YIN can't settle on a note picked over others still ringing (or reads a subharmonic below the guitar's
//    range), the spectrum decides whether the expected note was just played.
// A note that matches none of the expected notes is a wrong answer only when it was picked and YIN's reading is
// steady, so a scrape or the last note ringing never costs a life.
import { verifySegment, midiName, presence, peakDb, type Segment, type PitchFrame } from '../grading/pitch';
import { median } from '../dsp/dsp.js';
import type { Pos } from './core';

const voicedSettled = (s: Segment) => s.settled.filter(f => f.midi !== null).length;
const key = (s: Segment) => Math.round(s.t0 * 1000);
const peak = (fr: { rms: number }[]) => Math.max(0, ...fr.map(f => f.rms));
const frOf = (s: Segment) => (s.settled.length ? s.settled : s.frames);

/** YIN's reading has no spectral peak of its own: a subharmonic of two ringing notes (e.g. 52 Hz, below the
 *  guitar's range, for a D#3 picked over a ringing A2). */
export function phantom(s: Segment): boolean { return s.midi !== null && presence(frOf(s), Math.round(s.midi), -30) < 0.3; }
/** YIN stands behind its reading: not a phantom, and ≥ 70% of the voiced frames agree within 40 cents. */
export function steady(s: Segment): boolean {
  if (s.midi === null) return false;
  const m = s.midi, r = frOf(s).filter(f => f.midi !== null).map(f => f.midi!);
  return r.length >= 3 && !phantom(s) && r.filter(x => Math.abs(x - m) <= 0.4).length >= 0.7 * r.length;
}
/** The note before's last frames that end before `s` starts (an analysis window straddling the new attack
 *  would hide the jump in level). */
const tail = (prev: Segment, s: Segment, n: number) => { const fr = prev.frames.filter(f => f.t <= s.t0 - 0.025); return (fr.length ? fr : prev.frames).slice(-n); };
/** Was `midi` already sounding strongly at the end of the note before? */
function wasRinging(prev: Segment | undefined, midi: number): boolean {
  return !!prev && ((prev.midi !== null && Math.round(prev.midi) === midi) || presence(prev.frames.slice(-3), midi, -10) >= 0.6);
}
/** A piece whose pitch was already ringing just before it, that follows straight on and doesn't get louder, is
 *  that note still ringing (a stray onset, or a misread note splitting off when YIN recovers). */
export function isRinging(prev: Segment | undefined, s: Segment): boolean {
  if (!prev || s.midi === null || s.t0 - prev.t1 >= 0.1) return false;
  return wasRinging(prev, Math.round(s.midi)) && peak(s.frames.slice(0, 3)) < 1.3 * peak(tail(prev, s, 2));
}
/** Absolute level of a note in some frames: frame level × its spectral peak (0 when it has no peak). */
const level = (fr: PitchFrame[], midi: number) => { const v = fr.filter(f => f.peaks.length).map(f => f.rms * 10 ** (peakDb(f.peaks, midi) / 20)); return v.length ? median(v) : 0; };
/** The note got at least twice as loud (6 dB) as at the end of the note before: it was just played, not left ringing. */
const jumped = (s: Segment, prev: Segment | undefined, midi: number) => !prev || level(frOf(s), midi) >= 2 * level(tail(prev, s, 3), midi);
/** Verify one heard note against one expected note.
 *  - YIN reads the expected note and the spectrum backs it: right (unless that note was already ringing and
 *    didn't get louder: the last answer, not a new pick).
 *  - The pitch grader's verifySegment accepts it some other way (an octave slip, an unsure reading, or a reading
 *    with no spectral peak of its own): its evidence (the expected note's fundamental or 3rd harmonic) must be new,
 *    at least twice as loud as at the end of the note before, so a note still ringing can't lend it, and there's
 *    no newly played octave below.
 *  - YIN has no steady reading, or steadily reads a note that was already ringing (E3 picked over a ringing E2
 *    reads as E2): the expected note must be a strong peak that just got twice as loud, with no newly played
 *    octave below (its fundamental, or its 3rd harmonic a fifth above the expected note). */
export function verifyNote(s: Segment, m: number, prev?: Segment): boolean {
  const fr = frOf(s), r = s.midi === null ? null : Math.round(s.midi);
  const fresh = (x: number) => presence(fr, x, -30) >= 0.4 && jumped(s, prev, x);
  const newLow = (x: number) => presence(fr, x, -35) >= 0.2 && jumped(s, prev, x);
  if (verifySegment(s, { midis: [m] }).ok) {
    if (r === m && !phantom(s)) return !wasRinging(prev, m) || jumped(s, prev, m);
    return (fresh(m) || fresh(m + 19)) && !newLow(m - 12) && !newLow(m + 7);
  }
  const readsOld = r !== null && wasRinging(prev, r);
  if (steady(s) && !readsOld) return false;
  if (presence(fr, m, -15) < 0.6 || !jumped(s, prev, m)) return false;
  return !newLow(m - 12) && !newLow(m + 7);
}

/** The note whose level rose most against the note before (for naming what was played when YIN can't). */
function newestPeak(s: Segment, prev: Segment | undefined): number | null {
  const fr = frOf(s), cands = new Set<number>();
  for (const f of fr) for (const p of f.peaks) if (p.db >= -12) cands.add(Math.round(12 * Math.log2(p.f / 440) + 69));
  let best: number | null = null, gain = 1.5;
  for (const m of cands) { const g = level(fr, m) / Math.max(1e-6, prev ? level(tail(prev, s, 3), m) : 0); if (g > gain) { gain = g; best = m; } }
  return best;
}

export interface AnswerCheck {
  /** Notes (MIDI) that answer the question. */
  right: number[];
  /** Notes that are neither right nor wrong (Octave Jump's starting note, places Fret Finder already found). */
  neutral?: number[];
  /** Context time the question was asked: notes that started before it are ignored (the last answer ringing). */
  since: number;
}
export type Heard =
  | { kind: 'right'; midi: number; heard: string; t0: number }
  | { kind: 'wrong'; heard: string; why: 'octave' | 'wrong'; t0: number };

/** Look at the notes that started after the question (`segs` may start earlier: the note before gives context).
 *  The first one that verifies as a right answer wins; a picked note with a steady reading (≥ 6 voiced frames,
 *  ~130 ms) that verifies as nothing expected is wrong. `seen` remembers notes already decided (keyed by start
 *  time) across calls. Returns null while undecided. */
export function judgeAnswer(segs: Segment[], chk: AnswerCheck, now: number, seen: Set<number>): Heard | null {
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    if (s.t0 < chk.since - 0.02 || seen.has(key(s))) continue;
    const ended = s.t1 < now - 0.08, v = voicedSettled(s);
    if (v < 3 && !ended) continue;
    // The note before is done with (an earlier answer, or decided already): what follows it at its pitch is it
    // ringing on. If it's still undecided, a piece split off it is the same pick and is judged on its own.
    const prev = segs[k - 1];
    // A pick whose first ~100 ms read unsteadily splits into a short piece with the onset (which ends undecided)
    // and a steady piece without one: the steady piece is the same pick and inherits the onset.
    const inherits = !s.onset && !!prev && prev.onset && s.t0 - prev.t0 < 0.25 && seen.has(-key(prev));
    const prevDone = !!prev && !inherits && (prev.t0 < chk.since - 0.02 || seen.has(key(prev)));
    if (prevDone && isRinging(prev, s)) { seen.add(key(s)); continue; }
    // A piece without a pick attack (a pitch change, or after a dip) may be a legato or swelled right answer,
    // but not the note that was already ringing.
    const again = prevDone && s.midi !== null && s.t0 - prev.t1 < 0.1 && wasRinging(prev, Math.round(s.midi));
    const hit = s.onset || inherits || !again ? chk.right.find(m => verifyNote(s, m, inherits ? segs[k - 2] : prev)) : undefined;
    if (hit !== undefined) { seen.add(key(s)); return { kind: 'right', midi: hit, heard: midiName(hit), t0: s.t0 }; }
    if ((chk.neutral || []).some(m => verifyNote(s, m, inherits ? segs[k - 2] : prev))) { seen.add(key(s)); continue; }
    // Wrong: a pick (an onset that adds energy) of a note that isn't expected, once it has had ~130 ms to show.
    // YIN may not name it over the last note still ringing; the strongest new peak names it for the read-out.
    const picked = inherits || !prev || peak(s.frames.slice(0, 3)) >= 1.3 * peak(tail(prev, s, 2));
    if ((s.onset || inherits) && v >= 6 && !again && ((s.midi !== null && s.voiced >= 0.6 && steady(s)) || picked)) {
      const heardM = steady(s) ? Math.round(s.midi!) : newestPeak(s, prev);
      if (heardM !== null) {
        seen.add(key(s));
        const pc = ((heardM % 12) + 12) % 12;
        return { kind: 'wrong', heard: midiName(heardM), why: chk.right.some(m => m % 12 === pc) ? 'octave' : 'wrong', t0: s.t0 };
      }
    }
    if (ended) { seen.add(key(s)); seen.add(-key(s)); } // ended undecided
  }
  return null;
}

// ---------- Box Runner: notes to a click ----------
export interface TimedNote { t: number; midi: number; pos: Pos }
export interface NoteVerdict { ok: boolean; offMs: number | null; heard: string | null; why?: 'octave' | 'wrong' | 'early' | 'late' | 'silent' }
/** One expected note: the heard notes starting within ±tolS of it (after the calibrated offset). Right if one
 *  of them verifies as the expected note; else what was heard instead. The window is under half the note
 *  spacing, so each heard note can only belong to one expected note. */
export function gradeTimedNote(segs: Segment[], n: TimedNote, tolS: number, offsetS: number): NoteVerdict {
  const prevOf = (s: Segment) => segs[segs.indexOf(s) - 1];
  const dt = (s: Segment) => s.t0 - offsetS - n.t;
  const near = segs.filter(s => Math.abs(dt(s)) <= tolS).sort((a, b) => Math.abs(dt(a)) - Math.abs(dt(b)));
  for (const s of near) if (verifyNote(s, n.midi, prevOf(s))) return { ok: true, offMs: dt(s) * 1000, heard: midiName(n.midi) };
  if (near.length) {
    const v = verifySegment(near[0], { midis: [n.midi] });
    return { ok: false, offMs: dt(near[0]) * 1000, heard: v.heard, why: v.why === 'octave' ? 'octave' : 'wrong' };
  }
  // the right note, but outside the window?
  const off = segs.filter(s => Math.abs(dt(s)) <= tolS * 2 && verifyNote(s, n.midi, prevOf(s)))[0];
  if (off) return { ok: false, offMs: dt(off) * 1000, heard: midiName(n.midi), why: dt(off) > 0 ? 'late' : 'early' };
  return { ok: false, offMs: null, heard: null, why: 'silent' };
}
