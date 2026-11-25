import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { transposeChord, capoOptions, parseChord, shapeFor, setChordData, keyUsesFlats, OPEN_MIDI } from '../src/music';

const cat = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
beforeAll(() => setChordData(cat('chords-lib.json'), cat('chords.json')));

describe('chords', () => {
  it('parses and transposes, keeping slash basses', () => {
    expect(parseChord('F#m7/C#')).toEqual({ root: 'F#', suffix: 'm7', bass: 'C#' });
    expect(transposeChord('G/B', 2, false)).toBe('A/C#');
    expect(transposeChord('Eb2', -1, false)).toBe('D2');
    expect(transposeChord('C', 1, true)).toBe('Db');
    expect(keyUsesFlats('Bb')).toBe(true);
  });
  it('capo options cover the common shapes', () => {
    expect(capoOptions('Ab')).toEqual(expect.arrayContaining([{ shapes: 'G', capo: 1 }, { shapes: 'E', capo: 4 }]));
    expect(capoOptions('G')[0]).toEqual({ shapes: 'G', capo: 0 });
  });
  it('has a diagram for every chord in every song outline (chart key and all 12 keys)', () => {
    const outlines = cat('song_outlines.json');
    const missing = new Set<string>();
    for (const o of outlines) for (const s of o.sections) for (const ch of s.chords_in_chart_key)
      for (let k = 0; k < 12; k++) { const c = transposeChord(ch, k, k % 2 === 1); if (!shapeFor(c)) missing.add(c); }
    expect([...missing]).toEqual([]);
  });
  it('slash-chord diagrams put the named bass lowest when a voicing exists', () => {
    const s = shapeFor('D/F#')!;
    const i = s.frets.findIndex(f => f >= 0);
    expect((OPEN_MIDI[i] + s.frets[i]) % 12).toBe(6);
  });
});
