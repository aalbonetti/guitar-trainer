import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildQueue, totalMinutes, sessionRow, type QueueInput } from '../src/practice';
import { computeStates, type LessonProgress } from '../src/progress';

const j = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const lessons = j('lessons.json'), tracks = j('tracks.json'), outlines = j('song_outlines.json');
const cat = { lessons, tracks, outlines };
const passed = (id: string, extra: Partial<LessonProgress> = {}): LessonProgress => ({ lesson_id: id, state: 'passed', first_pass_day: '2026-11-01', passed_day: '2026-11-02', review_index: 0, next_review_day: '2026-12-31', mastered: false, updated_at: 0, ...extra });
const input = (lp: Record<string, LessonProgress>, over: Partial<QueueInput> = {}): QueueInput =>
  ({ cat, lp, states: computeStates(lessons, tracks, lp), day: '2026-11-21', visibleTrack: () => true, setlist: null, songLast: {}, ...over });
const allF = Object.fromEntries(lessons.filter((l: any) => l.track === 'F').map((l: any) => [l.id, passed(l.id)]));

describe('practice queue', () => {
  it('brand new player: next Foundations lesson + a song, no warm-up yet (spider still locked)', () => {
    const q = buildQueue(input({}), 15);
    expect(q.find(i => i.kind === 'warmup')).toBeUndefined();
    expect(q.filter(i => i.kind === 'lesson').map(i => i.lessonId)).toEqual(['F.01']);
    expect(q.some(i => i.kind === 'song')).toBe(true);
  });
  it('reviews come first (oldest due first), capped at 2 in 15 min and 3 in 30', () => {
    const lp = { ...allF, 'F.01': passed('F.01', { next_review_day: '2026-11-20' }), 'F.02': passed('F.02', { next_review_day: '2026-11-18' }), 'F.03': passed('F.03', { next_review_day: '2026-11-21' }), 'F.04': passed('F.04', { next_review_day: '2026-11-19' }) };
    const q15 = buildQueue(input(lp), 15);
    expect(q15[0].kind).toBe('warmup');
    expect(q15.filter(i => i.kind === 'review').map(i => i.lessonId)).toEqual(['F.02', 'F.04']);
    expect(buildQueue(input(lp), 30).filter(i => i.kind === 'review').length).toBe(3);
  });
  it('a lesson passed once comes before a fresh one; 30 min has two lessons and an ear quiz when unlocked', () => {
    const lp = { ...allF, 'T.01': passed('T.01'), 'T.02': passed('T.02'), 'T.03': passed('T.03'), 'T.04': passed('T.04'),
      'ER.01': { lesson_id: 'ER.01', state: 'in_progress', first_pass_day: '2026-11-20', review_index: 0, mastered: false, updated_at: 0 } as LessonProgress };
    const q = buildQueue(input(lp), 30);
    const ls = q.filter(i => i.kind === 'lesson');
    expect(ls[0].lessonId).toBe('ER.01'); expect(ls.length).toBe(2);
    expect(q.some(i => i.kind === 'ear')).toBe(true);
    expect(totalMinutes(q)).toBeGreaterThanOrEqual(28); expect(totalMinutes(q)).toBeLessThanOrEqual(32);
  });
  it('hidden tracks stay out; free practice has no minutes', () => {
    const q = buildQueue(input(allF, { visibleTrack: t => t !== 'ER' && t !== 'EL' }), 'free');
    expect(q.every(i => i.minutes === null)).toBe(true);
    expect(q.some(i => i.lessonId?.startsWith('E'))).toBe(false);
  });
  it('song comes from this month’s set list, least recently practiced first', () => {
    const ids = outlines.slice(0, 3).map((o: any) => o.id);
    const setlist = { weeks: ['w1', 'w2', 'w3', 'w4'], importedAt: '', songs: ids.map((id: string, i: number) => ({ name: 'x' + i, plays: 1, isNew: false, weeks: ['w4'], last: 'w4', lastIndex: 3, outlineId: id })) };
    const q = buildQueue(input({}, { setlist, songLast: { [ids[0]]: '2026-11-20', [ids[1]]: '2026-11-10' } }), 15);
    expect(q.find(i => i.kind === 'song')!.songId).toBe(ids[2]);
  });
  it('session length runs from start to last activity', () => {
    const r = sessionRow({ id: 's1', startedAt: 0, lastActive: 900_000, routine: 15, items: [], idx: 0, itemStart: 0, done: [], attempts: 3, passes: 1 }, '2026-11-21');
    expect(r.total_s).toBe(900);
  });
});
