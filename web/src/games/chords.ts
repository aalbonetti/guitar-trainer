// G3 chord games (07-games.md §2): Call the Number and Triad Hunt in play mode, Change Sprint and Song Run.
// Pure: no audio, no DOM, unit-tested with synthetic strums. Every check runs through the M8 chord verifier
// (grading/chord.ts: chordTarget → templates at sounding pitch, verifyChord against the expected chord and the
// alternatives the game offers). Nothing here names chords open-endedly.
import { chordTarget, verifyChord, gradeTimedChords, MIN_SCORE, type ChordTarget, type Strum, type ChordPlan, type ChordGrade } from '../grading/chord';
import { parseChord, pcOf, noteName, keyUsesFlats, transposeChord, keyName } from '../music';
import { pick, timingBonus, type Rng } from './core';

const OPEN = [40, 45, 50, 55, 59, 64];
const M = null;
/** Movable barre shapes (catalog shapes.json E_shape_* / A_shape_*), offsets from the root fret, string 6 → 1. */
const E_MAJ = [0, 2, 2, 1, 0, 0], E_MIN = [0, 2, 2, 0, 0, 0], A_MAJ = [M, 0, 2, 2, 2, 0], A_MIN = [M, 0, 2, 2, 1, 0];
const place = (off: (number | null)[], fret: number) => off.map(o => (o === null ? -1 : o + fret));

// ---------- chord families ----------
/** A chord's family: root and major/minor. G, G2, Gsus, G/B and G7 are all the G family; Em7 is Em. */
export interface Family { pc: number; minor: boolean }
export function familyOf(name: string): Family | null {
  const c = parseChord(name);
  if (!c) return null;
  const pc = pcOf(c.root);
  if (Number.isNaN(pc)) return null;
  return { pc, minor: /^m(?!aj)/.test(c.suffix) };
}
export const familyKey = (f: Family) => `${f.pc}${f.minor ? 'm' : ''}`;
export const familyName = (f: Family, flats: boolean) => noteName(f.pc, flats) + (f.minor ? 'm' : '');

/** Frets to verify a family against (no capo): the open chord when the catalog has one, then the E-shape and
 *  A-shape barres. `open` looks a chord name up in the curated chords (G, Em, …). Any of them counts. */
export function familyFrets(f: Family, open: (name: string) => number[] | null = () => null): number[][] {
  const out: number[][] = [];
  const o = open(noteName(f.pc, false) + (f.minor ? 'm' : '')) || open(noteName(f.pc, true) + (f.minor ? 'm' : ''));
  if (o) out.push(o);
  const e = ((f.pc - 4) % 12 + 12) % 12, a = ((f.pc - 9) % 12 + 12) % 12;
  out.push(place(f.minor ? E_MIN : E_MAJ, e || (o ? 12 : 0)));
  out.push(place(f.minor ? A_MIN : A_MAJ, a || (o ? 12 : 0)));
  return out.filter((x, i) => out.findIndex(y => y.join() === x.join()) === i);
}
/** A target for a family. `extra` adds the chart chord's own shape (G2, Gsus, D/F#), so either form counts. */
export function familyTarget(f: Family, name: string, open?: (name: string) => number[] | null, extra: number[][] = [], capo = 0, id = familyKey(f)): ChordTarget {
  return chordTarget(id, name, [...familyFrets(f, open), ...extra], capo);
}

// ---------- Call the Number, play mode ----------
const DEG: Record<string, number> = { '1': 0, '2': 2, '3': 4, '4': 5, '5': 7, '6': 9, '7': 11 };
/** "6m" in G → the Em family; "5/7" → the D family (slash bass ignored); colour tones keep the family. */
export function numberFamily(num: string, key: string): Family | null {
  const m = /^(b?)(\d)(m(?!aj))?/.exec(num);
  if (!m) return null;
  return { pc: ((pcOf(key) + DEG[m[2]] - (m[1] ? 1 : 0)) % 12 + 12) % 12, minor: !!m[3] };
}
/** Targets for every chord the round can call in this key (the expected one is verified against the rest). */
export function keyTargets(key: string, numbers: string[], open?: (name: string) => number[] | null): Record<string, ChordTarget> {
  const flats = keyUsesFlats(key), out: Record<string, ChordTarget> = {};
  for (const n of numbers) { const f = numberFamily(n, key); if (f && !out[familyKey(f)]) out[familyKey(f)] = familyTarget(f, familyName(f, flats), open); }
  return out;
}

// ---------- Triad Hunt ----------
export interface TriadQ { pc: number; minor: boolean; name: string; strings: number[]; window: [number, number]; placements: number[][]; set: string }
/** Closed triads (one chord tone per string, all three tones) on `strings` (low → high) inside the fret window. */
export function triadPlacements(pc: number, minor: boolean, strings: number[], window: [number, number], width = window[1] - window[0] + 1): number[][] {
  const want = new Set([pc, pc + (minor ? 3 : 4), pc + 7].map(x => x % 12));
  const out: number[][] = [];
  const fr = (s: number) => { const r: number[] = []; for (let f = window[0]; f <= window[1]; f++) if (want.has((OPEN[6 - s] + f) % 12)) r.push(f); return r; };
  const [a, b, c] = strings.map(fr);
  for (const x of a) for (const y of b) for (const z of c) {
    const got = new Set(strings.map((s, i) => (OPEN[6 - s] + [x, y, z][i]) % 12));
    if (got.size === 3 && Math.max(x, y, z) - Math.min(x, y, z) < width) out.push([x, y, z]);
  }
  return out;
}
/** Six-string frets for a triad placement (other strings muted), for templates and diagrams. */
export const triadFrets = (strings: number[], fr: number[]) => { const full = [-1, -1, -1, -1, -1, -1]; strings.forEach((s, i) => { full[6 - s] = fr[i]; }); return full; };
/** Is a tapped set of frets (one per string of the set) that triad, inside the window? Any inversion. */
export function isTriad(q: Pick<TriadQ, 'pc' | 'minor' | 'strings' | 'window'>, fr: number[]): boolean {
  if (fr.length !== 3 || fr.some(f => f < q.window[0] || f > q.window[1])) return false;
  return triadPlacements(q.pc, q.minor, q.strings, q.window).some(p => p.join() === fr.join());
}
/** One Triad Hunt question: a chord from the level's roots and qualities, a string set and a window of `width`
 *  frets that holds at least one placement (placed at random around it, inside frets 0–15). */
export function triadQ(r: Rng, p: { string_sets: string[]; keys: string[]; qualities: string[]; window: number }, prev?: TriadQ): TriadQ {
  for (let i = 0; ; i++) {
    const key = pick(r, p.keys), q = pick(r, p.qualities), set = pick(r, p.string_sets);
    const pc = pcOf(key), minor = q === 'minor', strings = set.split('').map(Number);
    if (i < 30 && prev && prev.pc === pc && prev.minor === minor && prev.set === set) continue;
    const all = triadPlacements(pc, minor, strings, [0, 15], p.window);
    if (!all.length) continue;
    const one = pick(r, all), lo = Math.min(...one), hi = Math.max(...one);
    const from = Math.max(0, hi - p.window + 1), to = Math.min(lo, 15 - p.window + 1);
    const w0 = from + Math.floor(r() * (to - from + 1)), window: [number, number] = [w0, w0 + p.window - 1];
    return { pc, minor, name: noteName(pc, keyUsesFlats(key)) + (minor ? 'm' : ''), strings, window, placements: triadPlacements(pc, minor, strings, window), set };
  }
}
/** Targets for a Triad Hunt question: the asked triad (every placement in the window counts) against the same
 *  root's other quality and the level's other chords on this string set, near the window. */
export function triadTargets(q: TriadQ, p: { keys: string[]; qualities: string[] }): { expected: ChordTarget; others: ChordTarget[] } {
  const tgt = (pc: number, minor: boolean, id: string, win: [number, number]) => {
    let pl = triadPlacements(pc, minor, q.strings, win);
    if (!pl.length) pl = triadPlacements(pc, minor, q.strings, [0, 15], q.window[1] - q.window[0] + 1).slice(0, 3);
    return chordTarget(id, noteName(pc, false) + (minor ? 'm' : ''), pl.map(x => triadFrets(q.strings, x)));
  };
  const near: [number, number] = [Math.max(0, q.window[0] - 2), Math.min(15, q.window[1] + 2)];
  const expected = tgt(q.pc, q.minor, `${q.pc}${q.minor ? 'm' : ''}`, q.window);
  const others: ChordTarget[] = [];
  const seen = new Set([expected.id]);
  const add = (pc: number, minor: boolean) => { const id = `${pc}${minor ? 'm' : ''}`; if (seen.has(id)) return; seen.add(id); others.push(tgt(pc, minor, id, near)); };
  add(q.pc, !q.minor);
  for (const k of p.keys) for (const qq of ['major', 'minor']) add(pcOf(k), qq === 'minor');
  return { expected, others };
}

// ---------- Change Sprint ----------
/** Speed bonus window for a change: 2.0 at one change a second, 1.0 at one every 4 s (mirrored in build_catalog.py). */
export const SPRINT_FAST_MS = 1000, SPRINT_SLOW_MS = 4000;
/** An unclear strum below this share of your recent strums' median level is noise, not a miss. */
export const SPRINT_QUIET = 0.35;
export interface SprintEvent { t: number; kind: 'start' | 'change' | 'same' | 'miss'; heard: string | null; expected: string; ms?: number }
/** Judge strums around a cycle of chords (a pair goes back and forth). Each strum is verified against the next
 *  chord of the cycle, with the cycle's other chords as the alternatives:
 *   - the next chord → a change (scores; `ms` since the last change or the start)
 *   - the chord you're on again → nothing (strumming a chord twice is fine)
 *   - anything else (unclear, a muddy change, or another chord of the cycle) → a miss
 *  The first clear strum of a cycle chord sets where you start. Strums before `t0` or from `t1` are ignored, and so
 *  are unclear ones far quieter than your real strums (SPRINT_QUIET). */
export function judgeSprint(strums: Pick<Strum, 't' | 'chroma' | 'low' | 'level'>[], cycle: ChordTarget[], t0: number, t1: number): SprintEvent[] {
  const out: SprintEvent[] = [];
  let cur = -1, lastT = t0;
  // An unclear "strum" much quieter than your real ones (room noise, a string buzzing as you lift off) isn't a miss.
  const levels: number[] = [];
  const quiet = (lv: number) => { if (levels.length < 2) return false; const m = [...levels].sort((a, b) => a - b)[Math.floor(levels.length / 2)]; return lv < SPRINT_QUIET * m; };
  for (const s of strums) {
    if (s.t < t0 || s.t >= t1) continue;
    if (cur < 0) {
      // where you start: the first strum that verifies as one of the cycle's chords
      const hit = cycle.findIndex(c => verifyChord(s.chroma, c, cycle, MIN_SCORE, undefined, s.low ?? null).ok);
      if (hit >= 0) { cur = hit; lastT = s.t; levels.push(s.level); out.push({ t: s.t, kind: 'start', heard: cycle[hit].id, expected: cycle[hit].id }); }
      continue;
    }
    const next = cycle[(cur + 1) % cycle.length], v = verifyChord(s.chroma, next, cycle, MIN_SCORE, undefined, s.low ?? null);
    if (v.ok) { out.push({ t: s.t, kind: 'change', heard: next.id, expected: next.id, ms: (s.t - lastT) * 1000 }); cur = (cur + 1) % cycle.length; lastT = s.t; levels.push(s.level); }
    else if (v.heard === cycle[cur].id) { out.push({ t: s.t, kind: 'same', heard: v.heard, expected: next.id }); levels.push(s.level); }
    else if (v.heard === null && quiet(s.level)) continue;
    else out.push({ t: s.t, kind: 'miss', heard: v.heard, expected: next.id });
    if (levels.length > 12) levels.shift();
  }
  return out;
}

// ---------- Song Run ----------
export interface SongBox { i: number; ref: string; label: string; section: string; bar: number }
/** Bars per chord the player picks (outlines have no bar lengths, as in the Song view): ½, 1 or 2. */
export type BarsPerChord = '0.5' | '1' | '2';
export interface SongChord { chord: string; shape: string; family: Family; section: string }
/** The song's chords in the chosen key and capo: the sounding chord (in the key) and the shape you play. */
export function songChords(o: { chart_key: string; sections: { name: string; chords_in_chart_key: string[] }[] }, key: string, capo: number): SongChord[] {
  const semis = ((pcOf(key) - pcOf(o.chart_key)) % 12 + 12) % 12, shapeKey = keyName(pcOf(key) - capo);
  const out: SongChord[] = [];
  for (const s of o.sections) for (const c of s.chords_in_chart_key) {
    const chord = transposeChord(c, semis, keyUsesFlats(key)), shape = transposeChord(c, semis - capo, keyUsesFlats(shapeKey));
    const f = familyOf(chord); if (f) out.push({ chord, shape, family: f, section: s.name });
  }
  return out;
}
/** Boxes for a round: one per chord at ½ or 1 bar per chord, two per chord at 2 bars; `passes` times through. */
export function songBoxes(chords: SongChord[], per: BarsPerChord, passes = 1, showShapes = true): SongBox[] {
  const out: SongBox[] = [];
  for (let p = 0; p < passes; p++) chords.forEach(c => { for (let k = 0; k < (per === '2' ? 2 : 1); k++) out.push({ i: out.length, ref: familyKey(c.family), label: showShapes ? c.shape : c.chord, section: c.section, bar: 0 }); });
  return out;
}
/** Click plan: one bar of count-in, then a click on every beat; each box lasts a bar (½ a bar at ½ bar per chord). */
export function songPlan(boxes: SongBox[], bpm: number, beatsPerBar: number, per: BarsPerChord, t0: number): ChordPlan {
  const beat = 60 / bpm, start = t0 + beatsPerBar * beat, boxBeats = per === '0.5' ? beatsPerBar / 2 : beatsPerBar;
  const countIn = Array.from({ length: beatsPerBar }, (_, i) => t0 + i * beat);
  const total = Math.ceil(boxes.length * boxBeats);
  const clicks: ChordPlan['clicks'] = countIn.map((t, i) => ({ t, kind: i === 0 ? 0 : 1 }));
  for (let b = 0; b < total; b++) clicks.push({ t: start + b * beat, kind: b % beatsPerBar === 0 ? 0 : 1 });
  return { bpm, beat, beatsPerBar, countIn, clicks, start, end: start + boxes.length * boxBeats * beat,
    boxes: boxes.map((b, i) => ({ i, ref: b.ref, label: b.label, t0: start + i * boxBeats * beat, t1: start + (i + 1) * boxBeats * beat })) };
}
/** Song Run targets: each family of the song (the chart chord's own shape counts too), at sounding pitch with the
 *  capo; with a capo, the same shapes without it are decoys (a forgotten capo), unless they sound like a real chord. */
export function songTargets(chords: SongChord[], capo: number, open?: (name: string) => number[] | null, shapeOf: (name: string) => number[] | null = () => null): { targets: Record<string, ChordTarget>; decoys: ChordTarget[] } {
  const targets: Record<string, ChordTarget> = {}, extra: Record<string, number[][]> = {}, names: Record<string, string> = {}, shapeFam: Record<string, Family> = {};
  for (const c of chords) {
    const k = familyKey(c.family);
    names[k] ||= (parseChord(c.chord)?.root ?? '') + (c.family.minor ? 'm' : '');
    const s = shapeOf(c.shape); if (s && !(extra[k] ||= []).some(x => x.join() === s.join())) extra[k].push(s);
    const sf = familyOf(c.shape); if (sf) shapeFam[k] = sf;
  }
  // family frets are built at the shape's root (what you finger), then raised by the capo
  for (const k of Object.keys(names)) targets[k] = familyTarget(shapeFam[k], names[k], open, extra[k] || [], capo, k);
  const decoys: ChordTarget[] = [];
  if (capo) for (const k of Object.keys(targets)) {
    const t = chordTarget(`nocapo:${k}`, `${names[k]} without capo`, targets[k].frets.map(f => f.map(x => (x < 0 ? -1 : x - capo))), 0);
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (!Object.values(targets).some(x => same(x.pcs, t.pcs)) && !decoys.some(x => same(x.pcs, t.pcs))) decoys.push(t);
  }
  return { targets, decoys };
}
/** Full bonus within this many ms of the box's start; 1.0 at half a beat late. */
export const SONG_FULL_MS = 60;
export interface BoxVerdict { box: number; ok: boolean; bonus: number; strums: number; heard: string | null; miss?: string }
/** One box's verdict from a graded plan: right when most of its strums are the box's chord (M8 rule); the bonus is
 *  how close the first right strum came to the bar line. `heard` = what most wrong strums sounded like. */
export function boxVerdict(g: ChordGrade, plan: ChordPlan, i: number, offsetS: number, names: Record<string, string>, label: string, where: string): BoxVerdict {
  const b = g.boxes[i], rs = g.strums.filter(r => r.box === i && !r.skipped);
  const ok = b.strums > 0 && b.ok * 2 > b.strums;
  const first = rs.find(r => r.ok);
  const bonus = ok && first ? timingBonus((first.t - offsetS - plan.boxes[i].t0) * 1000, SONG_FULL_MS, Math.max(SONG_FULL_MS + 1, plan.beat * 500)) : 0;
  const wrong = rs.filter(r => !r.ok).map(r => r.heard ?? 'unclear');
  const top = wrong.sort((x, y) => wrong.filter(w => w === y).length - wrong.filter(w => w === x).length)[0] ?? null;
  const heardName = top === null ? null : top === 'unclear' ? 'unclear' : top.startsWith('nocapo:') ? 'the shape without the capo' : names[top] ?? top;
  return { box: i, ok, bonus, strums: b.strums, heard: heardName,
    miss: ok ? undefined : `${label} (${where})${b.strums === 0 ? ': no strum' : heardName && heardName !== 'unclear' ? `: heard ${heardName}` : ': not clear'}` };
}
/** Grade a Song Run so far (the same rule live and at the end). */
export function gradeSong(strums: Strum[], plan: ChordPlan, tg: { targets: Record<string, ChordTarget>; decoys: ChordTarget[] }, offsetS: number): ChordGrade {
  return gradeTimedChords(strums, plan, tg, { offsetS, ratio: 0.85 });
}
