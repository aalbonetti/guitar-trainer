import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildQueue, totalMinutes, sessionRow, normRoutine, songWeekStart, songOfWeek, songPool, type QueueInput } from '../src/practice';
import { computeStates, type LessonProgress } from '../src/progress';

const j = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const lessons = j('lessons.json'), tracks = j('tracks.json'), outlines = j('song_outlines.json');
const cat = { lessons, tracks, outlines };
const passed = (id: string, extra: Partial<LessonProgress> = {}): LessonProgress => ({ lesson_id: id, state: 'passed', first_pass_day: '2026-11-01', passed_day: '2026-11-02', review_index: 0, next_review_day: '2026-12-31', mastered: false, updated_at: 0, ...extra });
const input = (lp: Record<string, LessonProgress>, over: Partial<QueueInput> = {}): QueueInput =>
  ({ cat, lp, states: computeStates(lessons, tracks, lp), day: '2026-11-21', visibleTrack: () => true, setlist: null, songLast: {}, ...over });
const allF = Object.fromEntries(lessons.filter((l: any) => l.track === 'F').map((l: any) => [l.id, passed(l.id)]));

describe('practice queue', () => {
  it('brand new player: next Foundations lesson gets the whole 10 min; no warm-up yet (spider still locked), no song step', () => {
    const q = buildQueue(input({}), 10);
    expect(q.find(i => i.kind === 'warmup')).toBeUndefined();
    expect(q.filter(i => i.kind === 'lesson').map(i => i.lessonId)).toEqual(['F.01']);
    expect(q.some(i => i.kind === 'song')).toBe(false);
    expect(q[0].minutes).toBe(10);
  });
  it('after passing F.01 today the plan moves on to the next lesson, not F.01 again', () => {
    const lp = { 'F.01': { lesson_id: 'F.01', state: 'in_progress', first_pass_day: '2026-11-21', review_index: 0, mastered: false, updated_at: 0 } as LessonProgress };
    const q = buildQueue(input(lp), 10);
    expect(q.some(i => i.lessonId === 'F.01')).toBe(false);
    expect(q.find(i => i.kind === 'lesson')!.lessonId).toBe('F.02');
    const tomorrow = buildQueue(input(lp, { day: '2026-11-22' }), 10).find(i => i.kind === 'lesson')!;
    expect(tomorrow.lessonId).toBe('F.01'); expect(tomorrow.why).toMatch(/earlier day/);
  });
  it('reviews come first (oldest due first): 1 in 10 min, 2 in 20, 3 in free', () => {
    const lp = { ...allF, 'F.01': passed('F.01', { next_review_day: '2026-11-20' }), 'F.02': passed('F.02', { next_review_day: '2026-11-18' }), 'F.03': passed('F.03', { next_review_day: '2026-11-21' }), 'F.04': passed('F.04', { next_review_day: '2026-11-19' }) };
    const q10 = buildQueue(input(lp), 10);
    expect(q10[0].kind).toBe('warmup');
    expect(q10.filter(i => i.kind === 'review').map(i => i.lessonId)).toEqual(['F.02']);
    expect(buildQueue(input(lp), 20).filter(i => i.kind === 'review').map(i => i.lessonId)).toEqual(['F.02', 'F.04']);
    expect(buildQueue(input(lp), 'free').filter(i => i.kind === 'review').length).toBe(3);
  });
  it('a lesson passed once comes before a fresh one; 20 min has two lessons and an ear quiz when unlocked', () => {
    const lp = { ...allF, 'T.01': passed('T.01'), 'T.02': passed('T.02'), 'T.03': passed('T.03'), 'T.04': passed('T.04'),
      'ER.01': { lesson_id: 'ER.01', state: 'in_progress', first_pass_day: '2026-11-20', review_index: 0, mastered: false, updated_at: 0 } as LessonProgress };
    const q = buildQueue(input(lp), 20);
    const ls = q.filter(i => i.kind === 'lesson');
    expect(ls[0].lessonId).toBe('ER.01'); expect(ls.length).toBe(2);
    expect(q.some(i => i.kind === 'ear')).toBe(true);
    expect(totalMinutes(q)).toBe(20);
    expect(totalMinutes(buildQueue(input(lp), 10))).toBe(10);
    expect(totalMinutes(buildQueue(input({}), 10))).toBe(10);
  });
  it('hidden tracks stay out; free practice has no minutes', () => {
    const q = buildQueue(input(allF, { visibleTrack: t => t !== 'ER' && t !== 'EL' }), 'free');
    expect(q.every(i => i.minutes === null)).toBe(true);
    expect(q.some(i => i.lessonId?.startsWith('E'))).toBe(false);
  });
  const ids = outlines.slice(0, 5).map((o: any) => o.id);
  const sl = (weeks: string[], played: string[][]) => ({ weeks, importedAt: '', songs: ids.map((id: string, i: number) => ({ name: 'x' + i, plays: 1, isNew: false, weeks: played[i] || [], last: null, lastIndex: -1, outlineId: id })) });
  it('song pool without a saved set list: the catalog weekly pool, else all outlines with lessons', () => {
    const flagged = outlines.map((o: any, i: number) => ({ ...o, weekly_pool: i % 2 === 0 }));
    const pool = songPool({ cat: { lessons, tracks, outlines: flagged }, setlist: null });
    expect(pool.fromList).toBe(true);
    expect(pool.ids).toEqual(flagged.filter((o: any) => o.weekly_pool).map((o: any) => o.id));
    const plain = songPool({ cat: { lessons, tracks, outlines: outlines.map((o: any) => ({ ...o, weekly_pool: false })) }, setlist: null });
    expect(plain.fromList).toBe(false);
  });
  it('song of the week: from the whole church list, fixed all week, rolls over Monday 12:01 am Central', () => {
    const setlist = sl(['Nov 8', 'Nov 15'], [['Nov 8'], ['Nov 15'], [], [], []]);
    const pool = songPool({ cat: { lessons, tracks, outlines }, setlist });
    expect(pool.fromList).toBe(true);
    const song = (iso: string) => ({ songId: songOfWeek(pool.ids, new Date(iso))! });
    // Mon Nov 23 12:01 am CST = 06:01 UTC
    const week = ['2026-11-23T06:01:00Z', '2026-11-25T18:00:00Z', '2026-11-29T23:00:00Z', '2026-11-30T06:00:30Z'].map(t => song(t).songId);
    expect(new Set(week).size).toBe(1);                                   // same song Mon 12:01 am → Mon 12:00 am next week
    expect(song('2026-11-30T06:01:00Z').songId).not.toBe(week[0]);        // new pick at 12:01 am, never a repeat
    expect(song('2026-11-23T06:00:30Z').songId).toBe(song('2026-11-21T12:00:00Z').songId); // 12:00 am Monday is still last week
    expect(ids).toContain(week[0]);
  });
  it('week start is the Monday in Central time, across DST', () => {
    expect(songWeekStart(new Date('2026-11-23T06:01:00Z'))).toBe('2026-11-23');
    expect(songWeekStart(new Date('2026-11-23T05:59:00Z'))).toBe('2026-11-16');
    expect(songWeekStart(new Date('2026-03-09T05:01:00Z'))).toBe('2026-03-09'); // CDT: 12:01 am = 05:01 UTC
    expect(songWeekStart(new Date('2026-03-09T04:59:00Z'))).toBe('2026-03-02');
  });
  it('picks vary across weeks and never repeat back to back', () => {
    const pool = outlines.slice(0, 50).map((o: any) => o.id);
    const picks: string[] = []; for (let w = 0; w < 52; w++) picks.push(songOfWeek(pool, new Date(Date.UTC(2026, 0, 6 + 7 * w, 18)))!);
    expect(new Set(picks).size).toBeGreaterThan(25);
    picks.forEach((p, i) => { if (i) expect(p).not.toBe(picks[i - 1]); });
    const five = outlines.slice(0, 5).map((o: any) => o.id), seq: string[] = [];
    for (let w = 0; w < 40; w++) seq.push(songOfWeek(five, new Date(Date.UTC(2026, 0, 6 + 7 * w, 18)))!);
    seq.forEach((p, i) => { if (i) expect(p).not.toBe(seq[i - 1]); });
    expect(new Set(seq.slice(0, 10)).size).toBe(5);               // everyone gets a turn
  });
  it('old 15/30 routine choices map to 10/20', () => { expect(normRoutine(15)).toBe(10); expect(normRoutine(30)).toBe(20); expect(normRoutine('free')).toBe('free'); });
  it('session length runs from start to last activity', () => {
    const r = sessionRow({ id: 's1', startedAt: 0, lastActive: 900_000, routine: 15, items: [], idx: 0, itemStart: 0, done: [], attempts: 3, passes: 1 }, '2026-11-21');
    expect(r.total_s).toBe(900);
  });
});
