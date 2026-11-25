// Practice session idle close (06-app-spec.md §4: closes after 30 minutes of inactivity or in the background).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ puts: [] as { store: string; row: any }[], audio: { running: false } }));
vi.mock('../src/db', () => ({ onBlocked() {}, put: async (store: string, row: any) => { h.puts.push({ store, row }); } }));
vi.mock('../src/audio/engine', () => ({
  metro: { get: () => ({ running: h.audio.running }) }, capture: { get: () => ({ on: false }) }, audioProgress: () => ({ clickT: null, micS: 0 }),
}));

import { session, startSession, touch, noteAttempt, goTo, expireIdle, endSession, IDLE_MS, type Item } from '../src/practice';
import { progress } from '../src/progressStore';
import { startActivityClock } from '../src/activity';

const items: Item[] = [{ kind: 'lesson', lessonId: 'F.01', title: 'a', why: '', minutes: 5 }, { kind: 'lesson', lessonId: 'F.02', title: 'b', why: '', minutes: 5 }];
const T0 = new Date(2026, 10, 21, 18, 0).getTime();
const rows = () => h.puts.filter(p => p.store === 'practice_session').map(p => p.row);

beforeEach(async () => { await endSession(false); h.puts.length = 0; });

describe('30-minute idle close', () => {
  const stale: [string, (now: number) => unknown][] = [
    ['touch', now => touch(now)], ['noteAttempt', now => noteAttempt('F.01', true, now)],
    ['goTo', now => goTo(1, true, now)], ['expireIdle', now => expireIdle(now)],
  ];
  for (const [name, act] of stale) it(`${name} closes a stale session at once and does not revive it`, () => {
    startSession(items, 10, T0); touch(T0 + 60_000);
    act(T0 + 60_000 + IDLE_MS + 1);
    expect(session.get().s).toBeNull();                       // synchronous: no await needed
    expect(session.get().summary).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ ended_at: T0 + 60_000, total_s: 60, attempts: 0, items_done: 0, day: '2026-11-21' });
  });
  it('exactly 30 minutes is still the same session', () => {
    startSession(items, 10, T0); noteAttempt('F.01', true, T0 + IDLE_MS);
    expect(session.get().s).toMatchObject({ attempts: 1, passes: 1, lastActive: T0 + IDLE_MS });
    expect(rows()).toHaveLength(0);
  });
  it('a session left over midnight keeps the day it started', () => {
    const late = new Date(2026, 10, 21, 23, 50).getTime();
    startSession(items, 10, late); touch(late + IDLE_MS + 1);
    expect(rows()[0].day).toBe('2026-11-21');
  });
  it('repeated checks write the row once', async () => {
    startSession(items, 10, T0);
    await Promise.all([expireIdle(T0 + IDLE_MS + 1), expireIdle(T0 + IDLE_MS + 2)]); touch(T0 + IDLE_MS + 3);
    expect(rows()).toHaveLength(1);
  });
});

describe('activity clock keeps the session open', () => {
  const vis = { visibilityState: 'visible', addEventListener() {} };
  let poke = () => {};
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(T0);
    vi.stubGlobal('document', vis); vi.stubGlobal('addEventListener', (_: string, f: () => void) => { poke = f; }); vi.stubGlobal('window', globalThis);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('counted ticks touch the session; uncounted ones do not; a stale one is closed', async () => {
    progress.set({ ready: true });
    startActivityClock(); poke();                             // last input = T0
    startSession(items, 10, T0);
    h.audio.running = true;
    await vi.advanceTimersByTimeAsync(45 * 60_000);           // click running, no taps
    expect(session.get().s?.lastActive).toBe(T0 + 45 * 60_000);
    h.audio.running = false;
    await vi.advanceTimersByTimeAsync(10 * 60_000);           // phone left on the stand
    expect(session.get().s?.lastActive).toBe(T0 + 45 * 60_000);
    vi.setSystemTime(T0 + 3 * 3600_000); h.audio.running = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.get().s).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].ended_at).toBe(T0 + 45 * 60_000);
  });
});
