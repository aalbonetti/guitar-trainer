// Streak rules (07-games.md §4). Pure, so they're unit-tested.
//  - A day counts with ≥ 5 minutes of practice, games included (`practice_day.active_s`, from the activity clock).
//  - "Played a service today" makes a day count on its own (Sunday at church without opening the app).
//  - Days logged before minutes were tracked (rows without `active_s`) still count, so an existing streak survives.
//  - One streak freeze is earned per 7 days of streak, holding at most 2. A missed day uses a freeze
//    automatically: the streak carries on, but the frozen day doesn't add to it.
// Everything is recomputed from the day rows, so there's no streak row to drift or to lose in a restore.
import { addDays } from './progress';

export const STREAK_MIN_S = 5 * 60;
export const FREEZE_EVERY = 7, FREEZE_MAX = 2;
export interface DayRow { day: string; active_s?: number }

export function qualifies(row: DayRow | undefined, service: boolean): boolean {
  if (service) return true;
  if (!row) return false;
  return row.active_s === undefined || row.active_s >= STREAK_MIN_S;
}

export interface StreakInfo {
  current: number; longest: number; freezes: number;
  /** Days a freeze covered. */
  frozen: string[];
  /** Today already counts. */
  todayDone: boolean;
  /** Practice seconds logged today. */
  todayS: number;
}
export function computeStreak(rows: DayRow[], serviceDays: string[], today: string): StreakInfo {
  const byDay = new Map(rows.map(r => [r.day, r])), svc = new Set(serviceDays);
  const ok = (d: string) => qualifies(byDay.get(d), svc.has(d));
  const days = [...rows.map(r => r.day), ...serviceDays].filter(d => d <= today && ok(d)).sort();
  const todayS = byDay.get(today)?.active_s ?? 0;
  if (!days.length) return { current: 0, longest: 0, freezes: 0, frozen: [], todayDone: false, todayS };
  let current = 0, longest = 0, freezes = 0;
  const frozen: string[] = [];
  for (let d = days[0]; d <= today; d = addDays(d, 1)) {
    if (ok(d)) {
      current++; longest = Math.max(longest, current);
      if (current % FREEZE_EVERY === 0) freezes = Math.min(FREEZE_MAX, freezes + 1);
    } else if (d === today) {
      // today isn't over yet
    } else if (current > 0 && freezes > 0) { freezes--; frozen.push(d); }
    else { current = 0; freezes = 0; }
  }
  return { current, longest, freezes, frozen, todayDone: ok(today), todayS };
}

/** Activity clock rule (activity.ts): a 10 s tick counts as practice when the app is on screen and you touched it
 *  in the last minute, or the click, tuner or mic is running. */
export const TICK_S = 10, IDLE_MS = 60_000;
export function counts(o: { visible: boolean; sinceInputMs: number; audio: boolean }): boolean {
  return o.visible && (o.sinceInputMs < IDLE_MS || o.audio);
}
