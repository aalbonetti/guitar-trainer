import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { parseChart, toNumber, matchOutline, isChordLine } from '../src/chordpro';

const outlines = JSON.parse(fs.readFileSync(new URL('../public/catalog/song_outlines.json', import.meta.url), 'utf8'));
// Synthetic charts from the outlines: real chords, placeholder words only (no lyrics in the repo).
function fixture(o: any, opts: { ccli?: boolean; unknown?: boolean } = {}) {
  const head = [`{title: ${o.title}}`, `{artist: ${o.artist}}`, `{key: ${o.chart_key}}`, o.bpm ? `{tempo: ${o.bpm}}` : '', o.meter ? `{time: ${o.meter}}` : '', '{capo: 0}',
    opts.ccli && o.ccli ? `{ccli: ${o.ccli}}` : '', opts.unknown ? '{x_custom_thing: whatever}' : ''].filter(Boolean);
  const body = o.sections.flatMap((s: any) => [`{start_of_verse: ${s.name}}`, s.chords_in_chart_key.map((c: string) => `[${c}]la la`).join(' '), '{end_of_verse}', '']);
  return [...head, '', ...body].join('\n');
}

describe('Nashville numbers', () => {
  it('match the catalog build for every outline chord', () => {
    let n = 0;
    for (const o of outlines) for (const s of o.sections) s.chords_in_chart_key.forEach((c: string, i: number) => { expect(toNumber(c, o.chart_key)).toBe(s.numbers[i]); n++; });
    expect(n).toBeGreaterThan(500);
  });
});

describe('ChordPro', () => {
  it('round-trips every outline: chords, numbers, key, tempo, meter', () => {
    for (const o of outlines) {
      const c = parseChart(fixture(o), 'x.cho');
      expect(c.format).toBe('chordpro'); expect(c.title).toBe(o.title); expect(c.key).toBe(o.chart_key);
      expect(c.sections.map(s => s.name)).toEqual(o.sections.map((s: any) => s.name));
      expect(c.sections.map(s => s.numbers)).toEqual(o.sections.map((s: any) => s.numbers));
      if (o.bpm) expect(c.tempo).toBe(o.bpm);
    }
  });
  it('slash chords, chorus/bridge sections, capo, unknown directives, comments', () => {
    const c = parseChart(`{t: Test Song}\n{st: Somebody}\n{key: D}\n{capo: 2}\n{time: 6/8}\n{mystery: 1}\n# a comment\n{soc}\n[D]la la [A/C#]la [Bm7]la [G2]la\n{eoc}\n{c: Bridge}\n[Em7]la [Dsus]la\n{start_of_bridge}\n[N.C.]la [F#m]la\n{end_of_bridge}`);
    expect(c.artist).toBe('Somebody'); expect(c.capo).toBe(2); expect(c.time).toBe('6/8'); expect(c.unknown).toEqual(['mystery']);
    expect(c.sections.map(s => s.name)).toEqual(['Chorus', 'Bridge', 'Bridge']);
    expect(c.sections[0].numbers).toEqual(['1', '5/7', '6m7', '4(2)']);
    expect(c.sections[2].chords).toEqual(['F#m']);
    expect(c.sections[0].lines[0].lyric).toBe('la la la la la');
    expect(c.sections[0].lines[0].chords[1]).toEqual({ at: 6, chord: 'A/C#' });
  });
  it('minor key numbers from the relative major', () => {
    expect(parseChart('{key: Em}\n[Em]la [C]la [G]la [D]la').sections[0].numbers).toEqual(['6m', '4', '1', '5']);
  });
  it('no key: assumes the first chord and warns', () => {
    const c = parseChart('[G]la la [C]la');
    expect(c.key).toBe('G'); expect(c.warnings.join()).toMatch(/assuming G/);
  });
});

describe('plain chords-over-lyrics paste', () => {
  const paste = `Placeholder Song\nSome Artist\nKey - A\nTempo - 74\nCCLI Song # 1234567\n\nVerse 1\nA        E/G#     F#m7   D\nla la la la la la la la la\nA    E\nla la la\n\n[Chorus]\nD   A/C#  Bm7  E\nla  la    la   la\n\nInstrumental\n| A  E | F#m D |\n`;
  it('reads header, sections, chord rows over word rows', () => {
    const c = parseChart(paste);
    expect(c.format).toBe('plain'); expect(c.title).toBe('Placeholder Song'); expect(c.artist).toBe('Some Artist');
    expect(c.key).toBe('A'); expect(c.tempo).toBe(74); expect(c.ccli).toBe(1234567);
    expect(c.sections.map(s => s.name)).toEqual(['Verse 1', 'Chorus', 'Instrumental']);
    expect(c.sections[0].numbers).toEqual(['1', '5/7', '6m7', '4', '1', '5']);
    expect(c.sections[0].lines[0].chords[1]).toEqual({ at: 9, chord: 'E/G#' });
    expect(c.sections[2].chords).toEqual(['A', 'E', 'F#m', 'D']);
  });
  it('tells chord rows from word rows', () => {
    expect(isChordLine('G  D/F#  Em7  Cadd9')).toBe(true);
    expect(isChordLine('A great big God')).toBe(false);
    expect(isChordLine('Am I the one')).toBe(false);
  });
});

describe('matching', () => {
  it('CCLI first, then title (case, accents and brackets ignored)', () => {
    const o = outlines.find((x: any) => x.ccli);
    expect(matchOutline(parseChart(fixture({ ...o, title: 'Something Else' }, { ccli: true })), outlines)!.id).toBe(o.id);
    expect(matchOutline({ ccli: null, title: o.title.toUpperCase() + ' (Live)' }, outlines)!.id).toBe(o.id);
    expect(matchOutline({ ccli: null, title: 'zzz not a song' }, outlines)).toBeNull();
  });
});
