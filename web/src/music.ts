// Music helpers: note names, chord parsing/transposition, capo options, chord-shape lookup.
export const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Key names as worship charts usually spell them. */
export const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // string 6 -> 1

const PC: Record<string, number> = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};
export const pcOf = (note: string): number => PC[note] ?? NaN;
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']);
export const keyUsesFlats = (key: string) => FLAT_KEYS.has(key);
export const noteName = (pc: number, flats: boolean) => (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12];

export interface Chord { root: string; suffix: string; bass: string | null }
export function parseChord(s: string): Chord | null {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(s.trim());
  return m ? { root: m[1], suffix: m[2], bass: m[3] || null } : null;
}
export function chordToString(c: Chord) { return c.root + c.suffix + (c.bass ? '/' + c.bass : ''); }

export function transposeChord(s: string, semis: number, flats: boolean): string {
  const c = parseChord(s);
  if (!c || !semis) return s;
  return chordToString({
    root: noteName(pcOf(c.root) + semis, flats),
    suffix: c.suffix,
    bass: c.bass ? noteName(pcOf(c.bass) + semis, flats) : null,
  });
}
export function keyName(pc: number) { return KEY_NAMES[((pc % 12) + 12) % 12]; }

/** Capo positions that let you play key `key` with open G/C/D/E/A shapes (capo 0-7). */
export function capoOptions(key: string): { shapes: string; capo: number }[] {
  const k = pcOf(key);
  return ['G', 'C', 'D', 'E', 'A']
    .map(shapes => ({ shapes, capo: (k - pcOf(shapes) + 12) % 12 }))
    .filter(o => o.capo <= 7)
    .sort((a, b) => a.capo - b.capo);
}

// ---------- chord shapes ----------
export interface Shape { frets: number[]; fingers?: number[]; barre?: number | null; note?: string }
type Lib = Record<string, Record<string, Shape[]>>;
interface Curated { id: string; name: string; frets: number[]; fingers: number[]; barre?: { fret: number } | null }

let LIB: Lib = {};
let CURATED: Record<string, Shape> = {};
export function setChordData(lib: Lib, curated: Curated[]) {
  LIB = lib;
  CURATED = {};
  for (const c of curated) {
    const name = c.name.replace(/\s*\(.*\)$/, ''); // "G (4-finger)" -> "G"
    if (!CURATED[name] || c.id === name) CURATED[name] = { frets: c.frets, fingers: c.fingers, barre: c.barre ? c.barre.fret : null };
  }
}
const DB_KEY: Record<string, string> = { Db: 'C#', 'D#': 'Eb', Gb: 'F#', 'G#': 'Ab', 'A#': 'Bb', Cb: 'B', Fb: 'E', 'E#': 'F', 'B#': 'C' };
const SUFFIX: Record<string, string[]> = {
  '': ['major'], m: ['minor'], min: ['minor'], '7': ['7'], maj7: ['maj7'], m7: ['m7'], '6': ['6'], m6: ['m6'],
  '9': ['9'], maj9: ['maj9'], m9: ['m9'], '11': ['11'], '13': ['13'], dim: ['dim'], dim7: ['dim7'], aug: ['aug'],
  sus: ['sus4'], sus4: ['sus4'], sus2: ['sus2'], '2': ['add9', 'sus2'], add9: ['add9'], '(add9)': ['add9'],
  m2: ['madd9'], madd9: ['madd9'], '7sus': ['7sus4'], '7sus4': ['7sus4'], mmaj7: ['mmaj7'], m7b5: ['m7b5'],
};
function powerChord(rootPc: number): Shape {
  const f6 = (rootPc - 4 + 12) % 12;
  if (f6 <= 7) return { frets: [f6, f6 + 2, f6 + 2, -1, -1, -1], note: 'power chord' };
  const f5 = (rootPc - 9 + 12) % 12;
  return { frets: [-1, f5, f5 + 2, f5 + 2, -1, -1], note: 'power chord' };
}
const lowestPc = (s: Shape) => { const i = s.frets.findIndex(f => f >= 0); return i < 0 ? -1 : (OPEN_MIDI[i] + s.frets[i]) % 12; };

/** Chord library browsing (Tools → Chords): every chords-db voicing for a root + chords-db suffix. */
export const libRoot = (root: string) => DB_KEY[root] || root;
export function libSuffixes(root: string): string[] { return Object.keys(LIB[libRoot(root)] || {}); }
export function voicings(root: string, suffix: string): Shape[] { return (LIB[libRoot(root)] || {})[suffix] || []; }
/** MIDI notes a shape sounds (for "hear it"), low string first. */
export const shapeMidi = (s: Shape, capo = 0) => s.frets.map((f, i) => (f < 0 ? -1 : OPEN_MIDI[i] + f + capo)).filter(m => m >= 0);

/** Best diagram for a chord name, or null. Curated voicings win; then chords-db; slash chords prefer a voicing with that bass. */
export function shapeFor(name: string): Shape | null {
  if (CURATED[name]) return CURATED[name];
  const c = parseChord(name);
  if (!c) return null;
  const key = DB_KEY[c.root] || c.root;
  const byKey = LIB[key];
  const rootPc = pcOf(c.root);
  if (c.suffix === '5' || c.suffix === '(no3)') return powerChord(rootPc);
  let suffix = c.suffix, note: string | undefined;
  if (/\(?add4\)?/.test(suffix)) { suffix = suffix.replace(/\(?add4\)?/, ''); note = 'add 4 on top'; }
  const cands = SUFFIX[suffix] || [suffix];
  if (!byKey) return null;
  if (c.bass) {
    const bassKey = DB_KEY[c.bass] || c.bass;
    const minor = cands[0] === 'minor';
    const direct = byKey[(minor ? 'm/' : '/') + bassKey];
    if (direct && direct.length) return { ...direct[0], note };
  }
  for (const s of cands) {
    const list = byKey[s];
    if (!list || !list.length) continue;
    if (c.bass) {
      const want = pcOf(c.bass);
      const hit = list.find(v => lowestPc(v) === want);
      if (hit) return { ...hit, note };
      return { ...list[0], note: `play ${c.bass} in the bass` };
    }
    return { ...list[0], note };
  }
  return null;
}
