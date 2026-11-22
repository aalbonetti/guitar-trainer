// Arcade rules (07-games.md §3–§4) and question generators for the G1 tap games. Pure: unit-tested.
import { SHARP, FLAT, pcOf, keyUsesFlats, noteName, OPEN_MIDI, keyName, KEY_NAMES } from '../music';

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
export const xpForScore = (score: number) => Math.floor(score / 100);
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
