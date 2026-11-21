import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { applyAttempt, computeStates, isReviewDue, addDays, type LessonProgress } from '../src/progress';
import { makeQuestion, rng } from '../src/quiz';
import { tokenRefs } from '../src/tokens';

const cat = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const lessons = cat('lessons.json'), tracks = cat('tracks.json');
const L = (id: string) => lessons.find((l: any) => l.id === id);
const ok = { met: true, atTarget: true, score: 1, mode: 'auto' as const };
const fail = { met: false, atTarget: true, score: 0.5, mode: 'auto' as const };

describe('progress rules', () => {
  it('passes only on a second, different day', () => {
    let r = applyAttempt(undefined, L('F.01'), ok, '2026-11-21');
    expect(r.event).toBe('first_pass'); expect(r.lp.state).toBe('in_progress');
    r = applyAttempt(r.lp, L('F.01'), ok, '2026-11-21');
    expect(r.event).toBe('none');
    r = applyAttempt(r.lp, L('F.01'), ok, '2026-11-23');
    expect(r.event).toBe('passed'); expect(r.lp.next_review_day).toBe('2026-11-24');
  });
  it('reviews advance through 1/3/7/14/30, a miss restarts at 1 day, then mastery', () => {
    let lp: LessonProgress = applyAttempt(applyAttempt(undefined, L('F.01'), ok, '2026-11-01').lp, L('F.01'), ok, '2026-11-02').lp;
    expect(isReviewDue(lp, '2026-11-02')).toBe(false);
    let r = applyAttempt(lp, L('F.01'), ok, '2026-11-03'); expect(r.event).toBe('review_passed'); expect(r.lp.next_review_day).toBe(addDays('2026-11-03', 2));
    r = applyAttempt(r.lp, L('F.01'), fail, r.lp.next_review_day!); expect(r.event).toBe('review_failed'); expect(r.lp.review_index).toBe(0);
    lp = r.lp;
    for (let i = 0; i < 5; i++) { r = applyAttempt(lp, L('F.01'), ok, lp.next_review_day!); lp = r.lp; }
    expect(r.event).toBe('mastered'); expect(lp.mastered).toBe(true);
  });
  it('unlocks by prereqs, and instrument tracks only after all of Foundations', () => {
    let s = computeStates(lessons, tracks, {});
    expect(s['F.01']).toBe('available'); expect(s['F.02']).toBe('locked'); expect(s['A.01']).toBe('locked'); expect(s['T.05']).toBe('locked');
    const lp: Record<string, LessonProgress> = {};
    for (const l of lessons.filter((x: any) => x.track === 'F')) lp[l.id] = { lesson_id: l.id, state: 'passed', review_index: 0, mastered: false, updated_at: 0 };
    s = computeStates(lessons, tracks, lp);
    expect(s['A.01']).toBe('available'); expect(s['ER.01']).toBe('available'); expect(s['EL.01']).toBe('available'); expect(s['A.02']).toBe('locked');
  });
});

describe('quiz generators', () => {
  const quizzes = cat('quizzes.json');
  it('every quiz makes valid questions whose answer is among the choices', () => {
    for (const q of quizzes) {
      const r = rng(42);
      for (let i = 0; i < 200; i++) {
        const x = makeQuestion(q.id, q.params, r);
        expect(x.choices).toContain(x.answer);
        expect(new Set(x.choices).size).toBe(x.choices.length);
      }
    }
  });
  it('gets the music right', () => {
    const r = rng(7);
    for (let i = 0; i < 100; i++) {
      const n = makeQuestion('Q_note_names', { strings: [6, 5], frets: [0, 12] }, r);
      const [, s, f] = /s(\d)f(\d+)/.exec(n.key)!.map(Number);
      const names = ['C', 'C#/Db', 'D', 'D#/Eb', 'E', 'F', 'F#/Gb', 'G', 'G#/Ab', 'A', 'A#/Bb', 'B'];
      expect(n.answer).toBe(names[((s === 6 ? 40 : 45) + f) % 12]);
    }
    const c = makeQuestion('Q_capo', { keys: ['Bb'], shapes: ['G'] }, rng(1)); expect(c.answer).toBe('Fret 3');
    const d = makeQuestion('Q_delay', { bpm: [120, 120] }, rng(1)); expect(d.answer).toBe('375 ms');
    const n = makeQuestion('Q_nashville', { keys: ['G'], progressions: ['1 5 6m 4'] }, rng(1)); expect(n.answer).toBe('G D Em C');
  });
});

describe('lesson content', () => {
  const dir = new URL('../../guitar-kb/content/', import.meta.url);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')) : [];
  const ids = {
    chord: new Set(cat('chords.json').map((c: any) => c.id)), scale: new Set(cat('scales.json').map((s: any) => s.id)),
    rhythm: new Set([...cat('rhythm.json').strumming, ...cat('rhythm.json').picking].map((s: any) => s.id)),
    exercise: new Set(cat('exercises.json').map((e: any) => e.id)), song: new Set(cat('songs.json').map((s: any) => s.id)),
    outline: new Set(cat('song_outlines.json').map((s: any) => s.id)), quiz: new Set(cat('quizzes.json').map((q: any) => q.id)),
    triad: new Set(cat('shapes.json').triads.map((t: any) => t.id)), shape: new Set(cat('shapes.json').movable_chords.map((t: any) => t.id)),
  } as Record<string, Set<string>>;
  it('every lesson file matches a lesson id', () => { for (const f of files) expect(L(f.replace(/\.md$/, ''))).toBeTruthy(); });
  it('every embed token points at a real catalog id', () => {
    const bad: string[] = [];
    for (const f of files) for (const { kind, arg } of tokenRefs(fs.readFileSync(new URL(f, dir), 'utf8'))) {
      const list = kind === 'chords' ? arg.split(',').map(s => s.trim()) : [arg.split('@')[0].split(':')[0]];
      const set = ids[kind === 'chords' ? 'chord' : kind];
      if (kind === 'tool') { if (!['tuner', 'metronome', 'delay'].includes(list[0])) bad.push(`${f}: tool ${arg}`); continue; }
      if (!set) { bad.push(`${f}: unknown kind ${kind}`); continue; }
      for (const id of list) if (!set.has(id)) bad.push(`${f}: ${kind} ${id}`);
    }
    expect(bad).toEqual([]);
  });
});
