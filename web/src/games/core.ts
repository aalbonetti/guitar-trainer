// Arcade rules (07-games.md §3–§4) and question generators for the G1 tap games. Pure: unit-tested.
import { SHARP, FLAT, pcOf, keyUsesFlats, noteName, OPEN_MIDI, keyName, KEY_NAMES } from '../music';
import { matchOnsets } from '../dsp/dsp.js';

// ---------- scoring ----------
/** Speed bonus 2.0 (fast) → 1.0 (slow), linear between `fastMs` and `slowMs`. */
export function speedBonus(ms: number, fastMs = 1500, slowMs = 6000): number {
  return 2 - Math.max(0, Math.min(1, (ms - fastMs) / (slowMs - fastMs)));
}
/** Combo multiplier ×1…×4: steps up after every 8 correct in a row. */
export const comboMult = (streak: number) => Math.min(4, 1 + Math.floor(streak / 8));
export const points = (ms: number, streak: number, fastMs?: number, slowMs?: number) => Math.round(100 * speedBonus(ms, fastMs, slowMs) * comboMult(streak));
/** ★ finish · ★★ 85% accuracy · ★★★ 95% accuracy and the level's target score. */
export function stars(finished: boolean, accuracy: number, score: number, target: number): number {
  if (!finished) return 0;
  if (accuracy >= 0.95 && score >= target) return 3;
  return accuracy >= 0.85 ? 2 : 1;
}

// ---------- XP + player level ----------
export const XP = { lessonPass: 50, review: 20, daily: 30, pb: 10 } as const;
/** XP for a round: score ÷ 500, at most 30 (07-games §4, rebalanced in G2 so one round can't outweigh a lesson
 *  pass (+50); a long click-timed round scores 20–45k). */
export const XP_PER_ROUND_MAX = 30;
export const xpForScore = (score: number) => Math.min(XP_PER_ROUND_MAX, Math.floor(score / 500));
/** Level n needs 100 + 25·(n−1) XP to reach level n+1. */
export function levelFor(totalXp: number): { level: number; into: number; need: number } {
  let level = 1, left = totalXp;
  while (left >= 100 + 25 * (level - 1)) { left -= 100 + 25 * (level - 1); level++; }
  return { level, into: left, need: 100 + 25 * (level - 1) };
}

// ---------- seeded randomness ----------
export type Rng = () => number;
export function rng(seed: number): Rng { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }
export const pick = <T,>(r: Rng, a: readonly T[]): T => a[Math.floor(r() * a.length)];
export function shuffle<T>(r: Rng, a: T[]): T[] { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

// ---------- fretboard ----------
export interface Zone { strings: number[]; frets: [number, number] }
export interface Pos { string: number; fret: number }
export const pcAt = (p: Pos) => (OPEN_MIDI[6 - p.string] + p.fret) % 12;
export function positionsOf(pc: number, z: Zone): Pos[] {
  const out: Pos[] = [];
  for (const s of z.strings) for (let f = z.frets[0]; f <= z.frets[1]; f++) if (pcAt({ string: s, fret: f }) === pc) out.push({ string: s, fret: f });
  return out;
}
/** Note name for display: naturals plain, accidentals as "F♯/G♭". */
export function noteLabel(pc: number): string {
  const s = SHARP[pc], f = FLAT[pc];
  return s === f ? s : `${s.replace('#', '♯')}/${f.replace('b', '♭')}`;
}
export const pretty = (name: string) => name.replace(/#/g, '♯').replace(/(?<=[A-G])b/g, '♭');

// ---------- Nashville ----------
const DEG_SEMIS: Record<string, number> = { '1': 0, '2': 2, '3': 4, '4': 5, '5': 7, '6': 9, '7': 11 };
/** "6m" in G → "Em"; "4" in Bb → "Eb". */
export function chordOf(num: string, key: string): string {
  const m = /^(\d)(m?)$/.exec(num); if (!m) return num;
  return noteName(pcOf(key) + DEG_SEMIS[m[1]], keyUsesFlats(key)) + m[2];
}
export const DIATONIC = ['1', '2m', '3m', '4', '5', '6m'];

// ---------- capo ----------
/** Capo fret for playing `shapes` and sounding in `key` (0–11). */
export const capoFor = (key: string, shapes: string) => ((pcOf(key) - pcOf(shapes)) % 12 + 12) % 12;
export const keyFrom = (shapes: string, capo: number) => keyName(pcOf(shapes) + capo);

// ---------- delay ----------
export const DELAY_NOTES: Record<string, { label: string; beats: number }> = { quarter: { label: 'quarter note', beats: 1 }, eighth: { label: 'eighth note', beats: 0.5 }, dotted8: { label: 'dotted eighth', beats: 0.75 } };
export const delayMs = (bpm: number, note: string) => (60000 / bpm) * DELAY_NOTES[note].beats;

// ---------- question generators (one question per call) ----------
export interface ChoiceQ { prompt: string; sub?: string; choices: string[]; answer: string; key?: string; audio?: number[][]; miss: string }
/** Call the Number: a key and a number; tap the chord. */
export function callNumberQ(r: Rng, keys: string[], numbers: string[], prev?: ChoiceQ): ChoiceQ {
  let key = prev?.key && r() < 0.8 ? prev.key : pick(r, keys), num = pick(r, numbers);
  if (prev && prev.key === key && prev.prompt === num) num = pick(r, numbers.filter(n => n !== num)) || num;
  const choices = DIATONIC.map(n => chordOf(n, key));
  return { prompt: num, sub: `Key of ${pretty(key)}`, choices, answer: chordOf(num, key), key, miss: `${num} in ${key} is ${chordOf(num, key)}` };
}
/** Call the Number, songs mode: a song's chart as calls. `choices` holds every chord the song calls, so each
 *  question's answer is always among them. */
export interface SongCalls { prompts: { num: string; chord: string }[]; title: string; key: string; choices: string[] }
export function songCallsOf(o: { title: string; chart_key: string; sections: { chords_in_chart_key: string[]; numbers: string[] }[] }): SongCalls {
  const prompts = o.sections.flatMap(s => s.chords_in_chart_key.map((c, i) => ({ num: s.numbers[i], chord: c })));
  return { prompts, title: o.title, key: o.chart_key, choices: [...new Set(prompts.map(p => p.chord))] };
}
export function songCallQ(s: SongCalls, i: number): ChoiceQ {
  const c = s.prompts[i];
  return { prompt: c.num, sub: `${s.title} · key of ${pretty(s.key)}`, choices: s.choices, answer: c.chord, key: s.key, miss: `${c.num} in ${s.key} (${s.title}) is ${c.chord}` };
}
/** Capo Quick. */
export function capoQ(r: Rng, ask: string, keys: string[], shapes: string[]): ChoiceQ {
  const a = ask === 'mixed' ? (r() < 0.5 ? 'capo' : 'key') : ask;
  for (;;) {
    const sh = pick(r, shapes), k = pick(r, keys), c = capoFor(k, sh);
    if (c < 1 || c > 7) continue;
    if (a === 'capo') return { prompt: `Song in ${pretty(k)}. You want ${sh} shapes.`, sub: 'Capo on fret…', choices: ['1', '2', '3', '4', '5', '6', '7'], answer: String(c), miss: `${k} with ${sh} shapes → capo ${c}` };
    const real = keyFrom(sh, c);
    return { prompt: `Capo ${c}, playing ${sh} shapes.`, sub: 'Real key?', choices: KEY_NAMES, answer: real, miss: `capo ${c} + ${sh} shapes = ${real}` };
  }
}
/** Triad voicing (MIDI) for a chord root pc, around the guitar's middle register. */
export function triad(pc: number, minor: boolean): number[] { const root = 48 + ((pc % 12) + 12) % 12; return [root, root + (minor ? 3 : 4), root + 7, root + 12]; }
/** Hear the Change: plays 1 then the target (or, for major/minor, a single chord). */
export function hearQ(r: Rng, numbers: string[]): ChoiceQ {
  if (numbers.includes('major')) {
    const pc = Math.floor(r() * 12), minor = r() < 0.5;
    return { prompt: 'Major or minor?', choices: ['major', 'minor'], answer: minor ? 'minor' : 'major', audio: [triad(pc, minor)], miss: `that was ${noteName(pc, false)}${minor ? 'm' : ''} (${minor ? 'minor' : 'major'})` };
  }
  const key = Math.floor(r() * 12), num = pick(r, numbers.filter(n => n !== '1'));
  const m = /^(\d)(m?)$/.exec(num)!;
  return { prompt: 'What number?', sub: 'You hear 1, then…', choices: numbers, answer: num, audio: [triad(key, false), triad(key + DEG_SEMIS[m[1]], !!m[2])], miss: `that was the ${num}` };
}
/** Delay Math: answer is a number of ms, ±10. */
export interface DelayQ { bpm: number; note: string; ms: number }
export function delayQ(r: Rng, range: [number, number], notes: string[]): DelayQ {
  const bpm = range[0] + Math.floor(r() * (range[1] - range[0] + 1)), note = pick(r, notes);
  return { bpm, note, ms: delayMs(bpm, note) };
}

// ================= G2: play mode, Octave Jump, Box Runner, In the Pocket =================
export const midiAt = (p: Pos) => OPEN_MIDI[6 - p.string] + p.fret;
/** Distinct sounding notes (MIDI) of a pitch class inside a zone, low to high. */
export const zoneMidis = (pc: number, z: Zone) => [...new Set(positionsOf(pc, z).map(midiAt))].sort((a, b) => a - b);
/** Every MIDI note a zone can sound (sizes the pitch tracker's range). */
export function zoneRange(z: Zone): number[] { const out: number[] = []; for (const s of z.strings) out.push(midiAt({ string: s, fret: z.frets[0] }), midiAt({ string: s, fret: z.frets[1] })); return out; }

// ---------- points with a given bonus ----------
/** Points for a right answer with an explicit bonus (1.0–2.0) × combo. `base` is 100 per answer; click-timed
 *  games use 100 per beat (an eighth note is worth 50, a sixteenth 25) so subdivision doesn't inflate scores. */
export const pointsWith = (bonus: number, streak: number, base = 100) => Math.round(base * Math.max(1, Math.min(2, bonus)) * comboMult(streak));
/** Click-timed games: bonus 2.0 within `fullMs` of the beat, falling to 1.0 at the window's edge. */
export function timingBonus(errMs: number, fullMs: number, edgeMs: number): number {
  return 2 - Math.max(0, Math.min(1, (Math.abs(errMs) - fullMs) / Math.max(1, edgeMs - fullMs)));
}
export interface Verdict { ok: boolean; bonus: number; miss?: string }
export interface Tally { score: number; correct: number; total: number; streak: number; maxCombo: number; bestStreak: number; misses: string[] }
export const newTally = (): Tally => ({ score: 0, correct: 0, total: 0, streak: 0, maxCombo: 1, bestStreak: 0, misses: [] });
/** The one scoring step: the live HUD (`useRound`) and `scoreRun` both go through it. `pts` gets the streak
 *  before this answer; a right answer adds those points, a miss resets the streak and records `miss`. */
export function scoreStep<T extends Tally>(s: T, ok: boolean, pts: (streak: number) => number, miss?: string): T {
  const streak = ok ? s.streak + 1 : 0;
  return { ...s, total: s.total + 1, correct: s.correct + (ok ? 1 : 0), streak, maxCombo: Math.max(s.maxCombo, comboMult(streak)), bestStreak: Math.max(s.bestStreak, streak),
    score: s.score + (ok ? pts(s.streak) : 0), misses: ok || !miss ? s.misses : [...s.misses, miss] };
}
/** Score answers in order. */
export const scoreRun = (vs: Verdict[], base = 100): Tally => vs.reduce((s, v) => scoreStep(s, v.ok, k => pointsWith(v.bonus, k, base), v.miss), newTally());

// ---------- Octave Jump ----------
/** Octave shapes from catalog shapes.json: low string → high string, frets up. */
const OCTAVE_UP: Record<number, { string: number; frets: number }> = { 6: { string: 4, frets: 2 }, 5: { string: 3, frets: 2 }, 4: { string: 2, frets: 3 }, 3: { string: 1, frets: 3 } };
export const octaveShape = (p: Pos): Pos => ({ string: OCTAVE_UP[p.string].string, fret: p.fret + OCTAVE_UP[p.string].frets });
export interface OctaveQ { from: Pos; low: number; high: number; shape: Pos }
/** A note on string 6 or 5 in the zone; the answer is the note an octave up (exact octave). */
export function octaveQ(r: Rng, z: Zone, prev?: OctaveQ): OctaveQ {
  for (let i = 0; ; i++) {
    const from = { string: pick(r, z.strings), fret: z.frets[0] + Math.floor(r() * (z.frets[1] - z.frets[0] + 1)) };
    if (i < 20 && prev && prev.from.string === from.string && prev.from.fret === from.fret) continue;
    const low = midiAt(from);
    return { from, low, high: low + 12, shape: octaveShape(from) };
  }
}

// ---------- Box Runner ----------
export interface BoxScale { id?: string; root: string; kind: string; position: number; frets: number[][] }
/** The box moved to `key`: the lowest placement that keeps every note within frets 0–15
 *  (mirrors the check in build_catalog.py). */
export function boxFrets(sc: BoxScale, key: string): number[][] {
  const base = ((pcOf(key) - pcOf(sc.root)) % 12 + 12) % 12;
  const lo = Math.min(...sc.frets.flat()), hi = Math.max(...sc.frets.flat());
  const s = [base - 12, base, base + 12].find(x => lo + x >= 0 && hi + x <= 15);
  if (s === undefined) throw new Error(`${sc.id} doesn't fit in ${key}`);
  return sc.frets.map(fl => fl.map(f => f + s));
}
/** The box's notes, low to high (string 6 first, frets ascending). */
export const boxNotes = (frets: number[][]): Pos[] => frets.flatMap((fl, i) => [...fl].sort((a, b) => a - b).map(f => ({ string: 6 - i, fret: f })));
/** The path through the box for a round. updown = up then back down; threes = 3-note groups up, then down.
 *  The same note is never asked twice in a row (a junction that would repeat it is skipped). */
export function boxPath(notes: Pos[], path: string, passes: number): Pos[] {
  const groups: Pos[][] = [];
  const down = [...notes].reverse();
  for (let p = 0; p < passes; p++) {
    if (path === 'threes') {
      for (const run of [notes, down]) for (let i = 0; i + 2 < run.length; i++) groups.push(run.slice(i, i + 3));
    } else if (path === 'up') groups.push(notes);
    else if (path === 'down') groups.push(down);
    else groups.push(notes, down);
  }
  const out: Pos[] = [];
  const same = (a?: Pos, b?: Pos) => !!a && !!b && a.string === b.string && a.fret === b.fret;
  for (const g of groups) {
    if (path === 'threes') { if (!same(out[out.length - 1], g[0])) out.push(...g); }
    else out.push(...(same(out[out.length - 1], g[0]) ? g.slice(1) : g));
  }
  return out;
}
/** Timing window for a note in Box Runner: 40% of the note spacing, 100–220 ms. */
export const boxWindowS = (spacingS: number) => Math.min(0.22, Math.max(0.1, 0.4 * spacingS));

// ---------- In the Pocket ----------
export interface PocketParams { bars: number; gap_bars?: number[]; click_bars?: number; window_ms: number }
/** Bar layout: which bars are silent (Gap Click). Bars are 0-based after the count-in; returns the gap index
 *  per bar (-1 = click plays) and, for each gap, the bar where the click comes back. */
export function pocketLayout(p: PocketParams): { bars: number; gapOf: number[]; returns: { gap: number; bars: number; bar: number }[] } {
  if (!p.gap_bars?.length) return { bars: p.bars, gapOf: Array(p.bars).fill(-1), returns: [] };
  const cb = p.click_bars || 2, gapOf: number[] = [], returns: { gap: number; bars: number; bar: number }[] = [];
  p.gap_bars.forEach((g, i) => { for (let b = 0; b < cb; b++) gapOf.push(-1); for (let b = 0; b < g; b++) gapOf.push(i); returns.push({ gap: i, bars: g, bar: gapOf.length }); });
  for (let b = 0; b < cb; b++) gapOf.push(-1);
  return { bars: gapOf.length, gapOf, returns };
}
export interface PocketSlot { t: number; expected: boolean; bar: number }
export interface PocketVerdict { slot: number; expected: boolean; ok: boolean; errMs: number | null; bonus: number; miss?: string; counted: boolean }
/** Grade strums (context seconds) against the slots: an expected slot is right when a strum lands within
 *  ±window_ms (after the calibrated offset); a strum in a rest is a miss; an empty rest isn't an answer.
 *  `returnBars` labels the first strum after each gap. */
export function pocketVerdicts(onsets: number[], slots: PocketSlot[], slotDur: number, offsetMs: number, windowMs: number, returnBars: Map<number, number> = new Map()): PocketVerdict[] {
  const off = offsetMs / 1000;
  const adj = onsets.map(o => o - off);
  const m = matchOnsets(adj, slots.map(s => s.t), slotDur / 2).map(r => r.onset);
  const seenBar = new Set<number>();
  return slots.map((s, i) => {
    const err = m[i] === null ? null : (m[i]! - s.t) * 1000;
    if (!s.expected) return err === null ? { slot: i, expected: false, ok: true, errMs: null, bonus: 0, counted: false } : { slot: i, expected: false, ok: false, errMs: err, bonus: 0, miss: 'strums in the rests', counted: true };
    const back = returnBars.has(s.bar) && !seenBar.has(s.bar) ? returnBars.get(s.bar)! : null; seenBar.add(s.bar);
    if (err === null) return { slot: i, expected: true, ok: false, errMs: null, bonus: 0, miss: back !== null ? `after the ${back}-bar gap: no strum on the 1` : 'missed strums', counted: true };
    const ok = Math.abs(err) <= windowMs;
    const lab = `${Math.round(Math.abs(err))} ms ${err > 0 ? 'late' : 'early'}`;
    return { slot: i, expected: true, ok, errMs: err, bonus: ok ? timingBonus(err, windowMs / 6, windowMs) : 0, counted: true,
      miss: ok ? undefined : back !== null ? `after the ${back}-bar gap: ${lab}` : err > 0 ? `late strums (over ${windowMs} ms behind)` : `early strums (over ${windowMs} ms ahead)` };
  });
}
