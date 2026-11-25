import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { simplify, knownChords, bestCapo, fitLine } from '../src/songfit';
import type { LessonProgress } from '../src/progress';

const cat = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const lessons = cat('lessons.json'), chords = cat('chords.json'), outlines = cat('song_outlines.json');
const gog = outlines.find((o: { id: string }) => o.id === 'MS_goodness_of_god');
const passed = (...ids: string[]) => Object.fromEntries(ids.map(id => [id, { lesson_id: id, state: 'passed', review_index: 0, mastered: false, updated_at: 0 } as LessonProgress]));

describe('song fit', () => {
  it('simplifies chords to what a beginner plays', () => {
    expect(['Cadd9', 'Dsus4', 'Em7', 'D/F#', 'Fmaj7', 'G (4-finger)', 'Bm (partial, F# in bass)', 'C#m7'].map(simplify))
      .toEqual(['C', 'D', 'Em', 'D', 'F', 'G', 'Bm', 'C#m']);
  });
  it('collects chords from passed and passed-once lessons only', () => {
    const lp = { ...passed('A.01'), 'A.02': { lesson_id: 'A.02', state: 'in_progress', first_pass_day: '2026-11-20', review_index: 0, mastered: false, updated_at: 0 } as LessonProgress };
    expect([...knownChords({ lessons, chords }, lp)].sort()).toEqual(['C', 'D', 'Em', 'G']);
    expect(knownChords({ lessons, chords }, {}).size).toBe(0);
  });
  it('Goodness of God (Ab) goes to capo 1, G shapes, for a G-family player', () => {
    const f = bestCapo(gog, 'Ab', knownChords({ lessons, chords }, passed('A.01', 'A.02')));
    expect(f).toMatchObject({ capo: 1, shapes: 'G', beginner: false });
    expect(f.missing).toEqual([]);   // G C D Em (+ D/F#, G/B) all simplify to known chords
    expect(fitLine(f)).toBe('Capo 1, G shapes: you know every chord.');
    expect(fitLine(f, false)).toBe('You know every chord.');
  });
  it('a beginner gets the easiest spot and a listen-along note', () => {
    const f = bestCapo(gog, 'Ab', new Set());
    expect(f.beginner).toBe(true);
    expect(f.capo).toBe(1);
    expect(fitLine(f)).toMatch(/^Capo 1, G shapes\. You haven't learned chords yet: listen along/);
    expect(fitLine(f, false)).toMatch(/^You haven't learned/);
  });
  it('lists the chords you still need', () => {
    const f = bestCapo(gog, 'Ab', new Set(['G', 'C']));
    expect(f.known).toBeLessThan(f.total);
    expect(fitLine(f)).toMatch(/you know \d of \d chords\. New: /);
  });
  it('every outline gets a fit in its chart key', () => {
    for (const o of outlines) { const f = bestCapo(o, o.chart_key, new Set(['G', 'C', 'D', 'Em'])); expect(f.total).toBeGreaterThan(0); expect(f.capo).toBeLessThanOrEqual(7); }
  });
});
