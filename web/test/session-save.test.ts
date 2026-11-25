// Saving: attempts, heatmap, Daily Challenge across midnight, badges. The database is an in-memory stand-in
// whose transact() commits all writes or none, like the real one.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

const h = vi.hoisted(() => {
  const keys: Record<string, string[]> = { lesson_progress: ['lesson_id'], daily_challenge: ['day'], badge: ['badge_id'], practice_session: ['id'], quiz_item_stats: ['quiz_id', 'item_key'], practice_day: ['day'] };
  const data = new Map<string, Map<string, any>>();
  const s = (n: string) => data.get(n) ?? data.set(n, new Map()).get(n)!;
  let auto = 0;
  const keyOf = (n: string, row: any) => JSON.stringify(keys[n] ? keys[n].map(k => row[k]) : [++auto]);
  const st = { fail: false, failLoad: false, reads: [] as string[], txs: 0, gate: null as null | Promise<void> };
  const db = {
    onBlocked() {},
    async getAll(n: string) { st.reads.push(n); if (st.failLoad) throw new Error('load failed'); return [...s(n).values()]; },
    async getByFirstKey(n: string, first: string) { st.reads.push(`${n}:${first}`); return [...s(n).values()].filter(r => r.quiz_id === first); },
    async get(n: string, key: any) { if (st.gate && n === 'daily_challenge') await st.gate; return s(n).get(JSON.stringify([key].flat())); },
    async put(n: string, row: any) { if (st.fail) throw new Error('disk full'); s(n).set(keyOf(n, row), row); },
    async add(n: string, row: any) { await db.put(n, row); },
    request: async (v: any) => v,
    async transact(_names: string[], run: (t: any) => Promise<any>) {
      st.txs++;
      const staged: [string, any][] = [];
      const t = { objectStore: (n: string) => ({ get: (k: any) => s(n).get(JSON.stringify([k].flat())), put: (r: any) => staged.push([n, r]), add: (r: any) => staged.push([n, r]) }) };
      const out = await run(t);
      if (st.fail) throw new Error('disk full');
      for (const [n, r] of staged) s(n).set(keyOf(n, r), r);
      return out;
    },
  };
  return { db, st, s, data };
});
vi.mock('../src/db', () => h.db);

import { recordAttempt, progress, loadProgress, saveStatus, quizWeights } from '../src/progressStore';
import { session, startSession, endSession, IDLE_MS } from '../src/practice';
import { noteSpot, flushHeat, loadHeat, HEAT_ID } from '../src/heat';
import { daily, loadDaily, refreshDaily, type DailyItem } from '../src/daily';
import { badges, checkBadges } from '../src/badges';

const lessons = JSON.parse(fs.readFileSync(new URL('../public/catalog/lessons.json', import.meta.url), 'utf8'));
const L = lessons.find((l: any) => l.id === 'F.01');
const ok = { met: true, atTarget: true, score: 1, mode: 'auto' as const };
const rows = (n: string) => [...h.s(n).values()];
const xpRows = (source: string) => rows('xp_ledger').filter(r => r.source === source);
const flush = () => new Promise<void>(r => setImmediate(r));
const passedRow = { lesson_id: 'F.01', state: 'passed', first_pass_day: '2026-10-01', passed_day: '2026-10-02', review_index: 3, next_review_day: '2026-12-31', mastered: false, updated_at: 0 };

beforeEach(async () => {
  await endSession(false);
  Object.assign(h.st, { fail: false, failLoad: false, txs: 0, gate: null }); h.st.reads.length = 0; h.data.clear();
  progress.set({ ready: false, lp: {} }); saveStatus.set({ state: 'idle', msg: '' });
});
afterEach(() => vi.useRealTimers());

describe('recordAttempt', () => {
  const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };
  it('saves the lesson row and the attempt in one transaction, XP once, across midnight', async () => {
    at('2026-11-21T23:59:00');
    expect(await recordAttempt(L, ok)).toBe('first_pass');
    expect(await recordAttempt(L, ok)).toBe('none');
    at('2026-11-22T00:01:00');
    expect(await recordAttempt(L, ok)).toBe('passed');
    await flush();
    expect(h.st.txs).toBe(3);
    expect(rows('attempt').map(a => [a.day, a.event])).toEqual([['2026-11-21', 'first_pass'], ['2026-11-21', 'none'], ['2026-11-22', 'passed']]);
    expect(rows('lesson_progress')[0]).toMatchObject({ state: 'passed', next_review_day: '2026-11-23' });
    expect(xpRows('lesson_pass')).toHaveLength(1);
    expect(saveStatus.get().state).toBe('saved');
  });
  it('a failed save writes neither row, earns no XP and says so', async () => {
    h.s('lesson_progress').set('["F.01"]', { lesson_id: 'F.01', state: 'in_progress', first_pass_day: '2000-01-01', review_index: 0, mastered: false, updated_at: 0 });
    await loadProgress(); h.st.fail = true;
    expect(await recordAttempt(L, ok)).toBe('passed');
    await flush();
    expect(rows('attempt')).toHaveLength(0);
    expect(rows('lesson_progress')[0].state).toBe('in_progress');
    expect(rows('xp_ledger')).toHaveLength(0);
    expect(saveStatus.get().state).toBe('error');
  });
  it('after a failed load, a saved passed row is read back, not overwritten', async () => {
    h.s('lesson_progress').set('["F.01"]', passedRow); h.st.failLoad = true;
    await loadProgress();
    expect(progress.get().lp).toEqual({});
    expect(await recordAttempt(L, ok)).toBe('none');
    expect(rows('lesson_progress')[0]).toMatchObject({ state: 'passed', passed_day: '2026-10-02', review_index: 3, next_review_day: '2026-12-31' });
    expect(progress.get().lp['F.01'].state).toBe('passed');
  });
  it('a stale session is closed before the attempt takes its id', async () => {
    startSession([], 10, Date.now() - IDLE_MS - 1000);
    await recordAttempt(L, ok);
    expect(session.get().s).toBeNull();
    expect(rows('attempt')[0].session_id).toBeNull();
    expect(rows('practice_session')[0].attempts).toBe(0);
    const s = startSession([], 10);
    await recordAttempt(L, ok);
    expect(rows('attempt')[1].session_id).toBe(s.id);
  });
});

describe('heatmap and quiz stats', () => {
  it('flushes all spots in one transaction and reads only its own quiz', async () => {
    h.s('quiz_item_stats').set('["Q_x","a"]', { quiz_id: 'Q_x', item_key: 'a', seen: 4, correct: 1 });
    noteSpot({ string: 5, fret: 3 }, true, 900); noteSpot({ string: 5, fret: 3 }, false); noteSpot({ string: 6, fret: 1 }, false);
    await flushHeat();
    expect(h.st.txs).toBe(1);
    expect((await loadHeat()).s5f3).toMatchObject({ seen: 2, correct: 1, avgMs: 900 });
    expect(Object.keys(await quizWeights('Q_x'))).toEqual(['a']);
    expect(h.st.reads).toEqual([`quiz_item_stats:${HEAT_ID}`, 'quiz_item_stats:Q_x']);
  });
});

describe('Daily Challenge', () => {
  const item: DailyItem = { kind: 'lesson', lesson: 'F.01', minutes: 10, title: 't', why: '' };
  const build = async () => [item];
  it('a load for the next day is not swallowed by one still running for the old day', async () => {
    let open!: () => void; h.st.gate = new Promise<void>(r => { open = r; });
    const a = loadDaily('2027-01-01', build), same = loadDaily('2027-01-01', build), b = loadDaily('2027-01-02', build);
    expect(same).toBe(a); expect(b).not.toBe(a);
    open(); await Promise.all([a, b]);
    expect(daily.get().day).toBe('2027-01-02');
    expect(rows('daily_challenge').map(r => r.day)).toEqual(['2027-01-01', '2027-01-02']);
  });
  it('a refresh queued for a replaced day leaves the new day alone', async () => {
    await loadDaily('2027-02-01', build);
    let open!: () => void; h.st.gate = new Promise<void>(r => { open = r; });
    const old = refreshDaily(); await flush();                  // reading the old day's row
    daily.set({ day: '2027-02-02', items: [], done: [], completed: null });
    const queued = refreshDaily();
    open(); h.st.gate = null; await Promise.all([old, queued]);
    expect(daily.get()).toMatchObject({ day: '2027-02-02', items: [], done: [] });
  });
  it('XP once; a completed challenge stops scanning; missing XP is repaired', async () => {
    await loadDaily('2027-03-01', build);
    await h.db.add('attempt', { lesson_id: 'F.01', at: Date.now() + 1 });
    await refreshDaily(); await refreshDaily();
    expect(daily.get()).toMatchObject({ done: [true], justCompleted: true });
    expect(xpRows('daily')).toHaveLength(1);
    h.st.reads.length = 0; await refreshDaily();
    expect(h.st.reads).toEqual([]);
    h.s('daily_challenge').set('["2027-03-02"]', { day: '2027-03-02', items_json: JSON.stringify([item]), created_at: 1, completed_at: 2 });
    await loadDaily('2027-03-02', build);
    expect(daily.get().done).toEqual([true]);
    expect(h.st.reads).not.toContain('attempt');
    expect(xpRows('daily').map(r => r.ref_id)).toEqual(['2027-03-01', '2027-03-02']);
  });
});

describe('badges', () => {
  it('does not read the runs once every badge is earned', async () => {
    badges.set({ ready: true, earned: { B: 1 } });
    expect(await checkBadges({ badges: [{ id: 'B', rule: { kind: 'streak_days' } } as any] }, { bests: {}, churchSongs: [], longestStreak: 99 })).toEqual([]);
    expect(h.st.reads).toEqual([]);
  });
});
