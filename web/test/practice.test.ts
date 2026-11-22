import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildQueue, totalMinutes, sessionRow, normRoutine, type QueueInput } from '../src/practice';
import { weekDate, thisWeekIndex, thisWeekSongs } from '../src/setlist';
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
    const q = buildQueue(input({}), 10);
    expect(q.find(i => i.kind === 'warmup')).toBeUndefined();
    expect(q.filter(i => i.kind === 'lesson').map(i => i.lessonId)).toEqual(['F.01']);
    expect(q.some(i => i.kind === 'song')).toBe(true);
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
  it('song is a random pick from this week’s set, stable for the day', () => {
    const setlist = sl(['Nov 8', 'Nov 15', 'Nov 22'], [['Nov 8'], ['Nov 15'], ['Nov 15'], ['Nov 15'], ['Nov 22']]);
    const at = (day: string) => buildQueue(input({}, { setlist, day, today: new Date(day + 'T12:00') }), 10).find(i => i.kind === 'song')!;
    // Sat Nov 21: this week = Sunday Nov 22
    expect(at('2026-11-21').songId).toBe(ids[4]); expect(at('2026-11-21').why).toMatch(/this week/);
    // a list that ends Nov 15: every day that week picks among the three Nov 15 songs
    const w15 = sl(['Nov 8', 'Nov 15'], [['Nov 8'], ['Nov 15'], ['Nov 15'], ['Nov 15'], []]);
    const picks = new Set(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'].map(d => buildQueue(input({}, { setlist: w15, day: d, today: new Date(d + 'T12:00') }), 10).find(i => i.kind === 'song')!.songId));
    expect([...picks].every(id => [ids[1], ids[2], ids[3]].includes(id!))).toBe(true);
    expect(picks.size).toBeGreaterThan(1);
    const again = buildQueue(input({}, { setlist: w15, day: '2026-11-18', today: new Date('2026-11-18T12:00') }), 10).find(i => i.kind === 'song')!.songId;
    expect(buildQueue(input({}, { setlist: w15, day: '2026-11-18', today: new Date('2026-11-18T18:00') }), 20).find(i => i.kind === 'song')!.songId).toBe(again);
  });
  it('reads week labels and finds this week', () => {
    const t = new Date('2026-11-21T12:00');
    expect(weekDate('Sept 6', t)!.toDateString()).toBe(new Date(2026, 8, 6).toDateString());
    expect(weekDate('Jan 3', new Date('2026-12-28T12:00'))!.getFullYear()).toBe(2027);
    const list = sl(['Aug 23', 'Nov 15', 'Nov 29'], [['Nov 15'], ['Nov 29']]);
    expect(thisWeekIndex(list, t)).toBe(1);                         // Nov 29 is next week, not this one
    expect(thisWeekSongs(list, t).map(s => s.outlineId)).toEqual([ids[0]]);
    expect(thisWeekIndex(list, new Date('2026-11-24T12:00'))).toBe(2);
  });
  it('old 15/30 routine choices map to 10/20', () => { expect(normRoutine(15)).toBe(10); expect(normRoutine(30)).toBe(20); expect(normRoutine('free')).toBe('free'); });
  it('session length runs from start to last activity', () => {
    const r = sessionRow({ id: 's1', startedAt: 0, lastActive: 900_000, routine: 15, items: [], idx: 0, itemStart: 0, done: [], attempts: 3, passes: 1 }, '2026-11-21');
    expect(r.total_s).toBe(900);
  });
});
