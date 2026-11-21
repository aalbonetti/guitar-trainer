// Question generators for quizzes.json. Pure functions (seeded RNG) so they can be unit-tested.
import { FLAT, SHARP, pcOf, noteName, capoOptions, OPEN_MIDI } from './music';

export interface Question { key: string; prompt: string; choices: string[]; answer: string; audio?: { midi: number[][]; gapS: number }; diagram?: string }
type Rng = () => number;
export function rng(seed: number): Rng { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const pick = <T,>(r: Rng, a: T[]) => a[Math.floor(r() * a.length)];
function shuffle<T>(r: Rng, a: T[]): T[] { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
function choicesWith(r: Rng, answer: string, pool: string[], n = 4): string[] {
  const others = shuffle(r, [...new Set(pool.filter(p => p !== answer))]).slice(0, n - 1);
  return shuffle(r, [answer, ...others]);
}
const noteLabel = (pc: number) => (SHARP[pc] === FLAT[pc] ? SHARP[pc] : `${SHARP[pc]}/${FLAT[pc]}`);
const ALL_NOTES = Array.from({ length: 12 }, (_, i) => noteLabel(i));

const INTERVALS: Record<string, [number, string]> = { m2: [1, 'minor 2nd'], M2: [2, 'major 2nd'], m3: [3, 'minor 3rd'], M3: [4, 'major 3rd'], P4: [5, 'perfect 4th'], TT: [6, 'tritone'], P5: [7, 'perfect 5th'], m6: [8, 'minor 6th'], M6: [9, 'major 6th'], m7: [10, 'minor 7th'], M7: [11, 'major 7th'], P8: [12, 'octave'] };
const DEGREES: Record<string, [number, string]> = { I: [0, ''], ii: [2, 'm'], iii: [4, 'm'], IV: [5, ''], V: [7, ''], vi: [9, 'm'] };
const NUM: Record<string, [number, string]> = { '1': [0, ''], '2m': [2, 'm'], '3m': [4, 'm'], '4': [5, ''], '5': [7, ''], '6m': [9, 'm'] };
function chordIn(key: string, num: string) { const [semi, q] = NUM[num]; const flats = ['F', 'Bb', 'Eb', 'Ab', 'Db'].includes(key); return noteName(pcOf(key) + semi, flats) + q; }

/** One question for the given quiz id. `weights` (item key -> weight) biases toward past misses. */
export function makeQuestion(id: string, params: Record<string, any>, r: Rng, weights: Record<string, number> = {}): Question {
  switch (id) {
    case 'Q_open_strings': {
      const names = ['E', 'B', 'G', 'D', 'A', 'E']; // string 1..6
      const n = pick(r, params.strings as number[]);
      if (r() < 0.5) return { key: `s${n}`, prompt: `Open string ${n} is which note?`, answer: names[n - 1], choices: choicesWith(r, names[n - 1], ['E', 'A', 'D', 'G', 'B', 'C', 'F']) };
      const target = pick(r, [2, 3, 4, 5]); // unambiguous notes (not E)
      const label = (k: number) => `String ${k}`;
      return { key: `n${target}`, prompt: `Which string is the open ${names[target - 1]}?`, answer: label(target), choices: choicesWith(r, label(target), [1, 2, 3, 4, 5, 6].map(label)) };
    }
    case 'Q_read_diagram': {
      const id = pick(r, params.chords as string[]);
      return { key: id, prompt: 'Which chord is this?', answer: id, choices: choicesWith(r, id, params.chords as string[]), diagram: id };
    }
    case 'Q_note_names': {
      const cands: [number, number][] = [];
      for (const s of params.strings) for (let f = params.frets[0]; f <= params.frets[1]; f++) cands.push([s, f]);
      const w = cands.map(([s, f]) => 1 + (weights[`s${s}f${f}`] || 0));
      let t = r() * w.reduce((a, b) => a + b, 0), k = 0; while ((t -= w[k]) > 0) k++;
      const [s, f] = cands[Math.min(k, cands.length - 1)];
      const pc = (OPEN_MIDI[6 - s] + f) % 12;
      return { key: `s${s}f${f}`, prompt: `Name the note: string ${s}, fret ${f}`, answer: noteLabel(pc), choices: choicesWith(r, noteLabel(pc), ALL_NOTES) };
    }
    case 'Q_intervals': {
      const iv = pick(r, params.intervals as string[]); const [semi, name] = INTERVALS[iv];
      return { key: iv, prompt: `How many frets (semitones) is a ${name}?`, answer: String(semi), choices: choicesWith(r, String(semi), Array.from({ length: 12 }, (_, i) => String(i + 1))) };
    }
    case 'Q_diatonic': {
      const key = pick(r, params.keys as string[]), deg = pick(r, params.degrees as string[]);
      const flats = ['F', 'Bb', 'Eb', 'Ab', 'Db'].includes(key);
      const chord = (d: string) => noteName(pcOf(key) + DEGREES[d][0], flats) + DEGREES[d][1];
      const pool = Object.keys(DEGREES).map(chord).concat([noteName(pcOf(key) + 2, flats), noteName(pcOf(key) + 9, flats), noteName(pcOf(key) + 4, flats)]);
      return { key: `${key}-${deg}`, prompt: `In the key of ${key}, what is the ${deg} chord?`, answer: chord(deg), choices: choicesWith(r, chord(deg), pool) };
    }
    case 'Q_nashville': {
      const key = pick(r, params.keys as string[]), prog = pick(r, params.progressions as string[]);
      const render = (k: string) => prog.split(' ').map(n => chordIn(k, n)).join(' ');
      const pool = (params.keys as string[]).filter(k => k !== key).map(render);
      return { key: `${key}-${prog}`, prompt: `Play “${prog}” in ${key}: which chords?`, answer: render(key), choices: choicesWith(r, render(key), pool) };
    }
    case 'Q_capo': {
      let key = '', shapes = '', capo = -1;
      for (let tries = 0; tries < 50 && (capo < 0 || capo > 7); tries++) {
        key = pick(r, params.keys as string[]); shapes = pick(r, params.shapes as string[]);
        capo = (pcOf(key) - pcOf(shapes) + 12) % 12;
      }
      const ans = capo === 0 ? 'No capo' : `Fret ${capo}`;
      const pool = ['No capo', ...Array.from({ length: 9 }, (_, i) => `Fret ${i + 1}`)];
      return { key: `${key}-${shapes}`, prompt: `Song is in ${key}. Using ${shapes} shapes, where does the capo go?`, answer: ans, choices: choicesWith(r, ans, pool) };
    }
    case 'Q_delay': {
      const bpm = Math.round((params.bpm[0] + r() * (params.bpm[1] - params.bpm[0])) / 2) * 2;
      const ms = Math.round(60000 / bpm * 0.75);
      const pool = [Math.round(60000 / bpm), Math.round(30000 / bpm), Math.round(60000 / bpm * 0.5 * 0.75 * 2 / 1.5), ms + 40, ms - 40, Math.round(60000 / bpm * 1.5)].map(String);
      return { key: `bpm${bpm}`, prompt: `Dotted-eighth delay at ${bpm} BPM, in ms?`, answer: `${ms} ms`, choices: choicesWith(r, `${ms} ms`, pool.map(p => `${p} ms`)) };
    }
    case 'Q_ear_quality': {
      const q = pick(r, params.qualities as string[]); const root = 52 + Math.floor(r() * 10);
      const notes = q === 'major' ? [root, root + 4, root + 7, root + 12] : [root, root + 3, root + 7, root + 12];
      return { key: q, prompt: 'Major or minor?', answer: q === 'major' ? 'Major' : 'Minor', choices: ['Major', 'Minor'], audio: { midi: [notes], gapS: 0 } };
    }
    case 'Q_ear_numbers': {
      const target = pick(r, params.choices as string[]); const k = 48 + Math.floor(r() * 7);
      const triad = (semi: number, minor: boolean) => [k + semi, k + semi + (minor ? 3 : 4), k + semi + 7, k + semi + 12];
      const [semi, q] = NUM[target];
      return { key: target, prompt: 'Chord 1, then… which number?', answer: target, choices: params.choices as string[], audio: { midi: [triad(0, false), triad(semi, q === 'm')], gapS: 1.1 } };
    }
    default: return { key: 'x', prompt: 'Unknown quiz', answer: 'ok', choices: ['ok'] };
  }
}
export { capoOptions };
