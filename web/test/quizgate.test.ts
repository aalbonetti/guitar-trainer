import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { gradesLesson } from '../src/ui/Quiz';
import { tokenRefs } from '../src/tokens';
import type { Lesson, Quiz } from '../src/catalog';

// Quiz.tsx plays ear questions through the audio engine, which needs a browser; the gating rule doesn't.
vi.mock('../src/audio/engine', () => ({ playChords: () => {}, metro: { get: () => ({}) }, capture: { get: () => ({}) } }));

const cat = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const lessons: Lesson[] = cat('lessons.json');
const quizzes: Quiz[] = cat('quizzes.json');
const embedded = (id: string) => tokenRefs(fs.readFileSync(new URL(`../../guitar-kb/content/${id}.md`, import.meta.url), 'utf8'))
  .filter(t => t.kind === 'quiz').map(t => t.arg);

describe('quiz lessons can be passed', () => {
  const quizLessons = lessons.filter(l => l.pass_criteria.type === 'quiz');
  it('every quiz lesson shows a quiz that counts toward it', () => {
    expect(quizLessons.length).toBeGreaterThan(0);
    const stuck = quizLessons.filter(l => !embedded(l.id).some(q => gradesLesson(l, q) && quizzes.some(x => x.id === q))).map(l => l.id);
    expect(stuck).toEqual([]);
  });
  it('EL.09 is graded by the diatonic quiz it shares with T.02', () => {
    for (const id of ['EL.09', 'T.02']) expect(gradesLesson(lessons.find(l => l.id === id), 'Q_diatonic')).toBe(true);
  });
  it('other quizzes and non-quiz lessons stay practice only', () => {
    expect(gradesLesson(lessons.find(l => l.id === 'EL.09'), 'Q_capo')).toBe(false);
    expect(gradesLesson(lessons.find(l => l.id === 'ER.11'), 'Q_nashville')).toBe(false);
    expect(gradesLesson(undefined, 'Q_capo')).toBe(false);
  });
});
