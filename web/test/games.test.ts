import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { speedBonus, comboMult, points, stars, levelFor, rng, positionsOf, pcAt, noteLabel, chordOf, capoFor, keyFrom, callNumberQ, capoQ, hearQ, delayQ, delayMs } from '../src/games/core';

const games = JSON.parse(fs.readFileSync(new URL('../public/catalog/games.json', import.meta.url), 'utf8'));

describe('scoring', () => {
  it('speed bonus 2.0 → 1.0, combo ×1..×4 every 8, points', () => {
    expect(speedBonus(500)).toBe(2); expect(speedBonus(9000)).toBe(1); expect(speedBonus(3750)).toBeCloseTo(1.5);
    expect([0, 7, 8, 16, 24, 99].map(comboMult)).toEqual([1, 1, 2, 3, 4, 4]);
    expect(points(500, 8)).toBe(400);
  });
  it('stars', () => {
    expect(stars(false, 1, 9999, 100)).toBe(0); expect(stars(true, 0.8, 0, 100)).toBe(1);
    expect(stars(true, 0.9, 9999, 100)).toBe(2); expect(stars(true, 0.96, 50, 100)).toBe(2); expect(stars(true, 0.96, 150, 100)).toBe(3);
  });
  it('player level: 100, then +25 per level', () => {
    expect(levelFor(0)).toEqual({ level: 1, into: 0, need: 100 });
    expect(levelFor(99).level).toBe(1); expect(levelFor(100)).toEqual({ level: 2, into: 0, need: 125 });
    expect(levelFor(100 + 125 + 150).level).toBe(4);
  });
});

describe('fretboard + theory', () => {
  it('note positions', () => {
    expect(pcAt({ string: 6, fret: 3 })).toBe(7); // G
    expect(positionsOf(7, { strings: [6, 5], frets: [0, 12] })).toEqual([{ string: 6, fret: 3 }, { string: 5, fret: 10 }]);
    expect(positionsOf(4, { strings: [6, 5, 4, 3, 2, 1], frets: [0, 5] }).length).toBe(4); // E: 6/0, 4/2, 2/5, 1/0
    expect(noteLabel(6)).toBe('F♯/G♭'); expect(noteLabel(0)).toBe('C');
  });
  it('Nashville chords and capo math', () => {
    expect(chordOf('6m', 'G')).toBe('Em'); expect(chordOf('4', 'Bb')).toBe('Eb'); expect(chordOf('3m', 'E')).toBe('G#m');
    expect(capoFor('Bb', 'G')).toBe(3); expect(keyFrom('C', 3)).toBe('Eb'); expect(keyFrom('D', 4)).toBe('F#');
    expect(delayMs(120, 'dotted8')).toBe(375); expect(delayMs(60, 'quarter')).toBe(1000);
  });
});

describe('question generators', () => {
  const r = rng(42);
  it('call the number: answer is among the choices and right', () => {
    for (let i = 0; i < 200; i++) { const q = callNumberQ(r, ['G', 'D', 'Bb', 'F#'], ['1', '2m', '3m', '4', '5', '6m']); expect(q.choices).toContain(q.answer); expect(q.answer).toBe(chordOf(q.prompt, q.key!)); }
  });
  it('capo quick: capo 1–7, both directions consistent', () => {
    for (let i = 0; i < 200; i++) {
      const q = capoQ(r, 'mixed', ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], ['G', 'D', 'C', 'E', 'A']);
      expect(q.choices).toContain(q.answer);
      const sh = /(\w) shapes/.exec(q.prompt)![1];
      if (q.sub === 'Real key?') { const c = +/Capo (\d)/.exec(q.prompt)![1]; expect(capoFor(q.answer, sh)).toBe(c); }
      else { expect(+q.answer).toBeGreaterThanOrEqual(1); expect(+q.answer).toBeLessThanOrEqual(7); }
    }
  });
  it('hear the change plays 1 then the target; major/minor plays one chord', () => {
    const q = hearQ(r, ['1', '4', '5', '6m']); expect(q.audio!.length).toBe(2); expect(q.answer).not.toBe('1');
    const mm = hearQ(r, ['major', 'minor']); expect(mm.audio!.length).toBe(1); expect(mm.audio![0][1] - mm.audio![0][0]).toBe(mm.answer === 'minor' ? 3 : 4);
  });
  it('delay questions stay in range', () => {
    for (let i = 0; i < 100; i++) { const q = delayQ(r, [60, 90], ['dotted8']); expect(q.bpm).toBeGreaterThanOrEqual(60); expect(q.bpm).toBeLessThanOrEqual(90); expect(q.ms).toBeCloseTo(45000 / q.bpm); }
  });
  it('every G1 level has a zone with notes, or a generator that runs', () => {
    const g1 = games.filter((g: any) => g.milestone === 'G1');
    expect(g1.map((g: any) => g.id).sort()).toEqual(['G_call_the_number', 'G_capo_quick', 'G_delay_math', 'G_fret_finder', 'G_hear_the_change', 'G_note_drop']);
    for (const g of g1) for (const l of g.levels) {
      if (l.params.zone) { const n = Array.from({ length: 12 }, (_, pc) => positionsOf(pc, { strings: l.params.zone.strings, frets: l.params.zone.frets }).length).filter(x => x > 0).length; expect(n).toBeGreaterThanOrEqual(11); }
    }
  });
});
