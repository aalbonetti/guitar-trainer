// App-level progress state: loads from IndexedDB once, keeps an in-memory copy for the UI.
import { Store } from './store';
import * as db from './db';
import { applyAttempt, dayOf, type AttemptResult, type LessonProgress, type Event } from './progress';
import type { Lesson } from './catalog';
import { session, noteAttempt, expireIdle } from './practice';
import { addXp } from './xp';
import { XP } from './games/core';
import { computeStreak, qualifies, type DayRow, type StreakInfo } from './streak';

/** Did the last save reach the phone's storage? Shown to the user, never silent. */
export const saveStatus = new Store<{ state: 'idle' | 'saved' | 'error' | 'blocked'; at: number; msg: string }>({ state: 'idle', at: 0, msg: '' });
db.onBlocked(() => saveStatus.set({ state: 'blocked', at: Date.now(), msg: 'Another copy of Guitar Trainer is open (an older tab or the home-screen app). Close it so your progress can be saved.' }));
/** `days`: days that count as practiced (07-games §4: ≥ 5 minutes, a "Played a service" day, or a day logged
 *  before minutes were tracked). `active`: practice seconds per day (no entry for those older days).
 *  `services`: "Played a service today" days. */
export const progress = new Store<{ ready: boolean; lp: Record<string, LessonProgress>; days: string[]; active: Record<string, number>; services: string[] }>({ ready: false, lp: {}, days: [], active: {}, services: [] });

export async function loadProgress() {
  try {
    const rows = await db.getAll<LessonProgress>('lesson_progress');
    const pd = await db.getAll<DayRow>('practice_day');
    const active = Object.fromEntries(pd.filter(d => d.active_s !== undefined).map(d => [d.day, d.active_s!]));
    const services = (await db.getAll<{ day: string }>('service_day').catch(() => [])).map(d => d.day).sort();
    const days = [...new Set([...pd.filter(d => qualifies(d, false)).map(d => d.day), ...services])].sort();
    progress.set({ ready: true, lp: Object.fromEntries(rows.map(r => [r.lesson_id, r])), days, active, services });
  } catch (e) { progress.set({ ready: true }); saveStatus.set({ state: 'error', at: Date.now(), msg: `Couldn't open saved progress (${(e as Error)?.message || 'storage unavailable'}).` }); }
}

/** Save one attempt. The stored lesson row is read and written in the same transaction as the attempt, so a
 *  failed or unfinished load can't overwrite saved progress. If the save fails, the result is only kept on screen
 *  (with the red banner) and earns no XP. */
export async function recordAttempt(lesson: Lesson, r: AttemptResult): Promise<Event> {
  void expireIdle(); // a stale session must not claim this attempt
  const day = dayOf(), session_id = session.get().s?.id ?? null;
  let result: { lp: LessonProgress; event: Event }, saved = false;
  try {
    result = await db.transact(['lesson_progress', 'attempt'], async t => {
      const rows = t.objectStore('lesson_progress');
      const out = applyAttempt(await db.request<LessonProgress | undefined>(rows.get(lesson.id)), lesson, r, day);
      rows.put(out.lp);
      t.objectStore('attempt').add({ session_id, lesson_id: lesson.id, criterion_type: lesson.pass_criteria.type, grader_mode: r.mode, score: r.score, met_target: r.met, at_target_tempo: r.atTarget, metrics_json: JSON.stringify(r.metrics || {}), event: out.event, day, at: Date.now() });
      return out;
    });
    saved = true;
    saveStatus.set({ state: 'saved', at: Date.now(), msg: '' });
  } catch (e) {
    result = applyAttempt(progress.get().lp[lesson.id], lesson, r, day);
    saveStatus.set({ state: 'error', at: Date.now(), msg: `Couldn't save to this phone (${(e as Error)?.message || 'storage unavailable'}). Progress will be lost when you leave. Check that you're not in Incognito and that the phone has free space, then reload the app.` });
  }
  const { lp, event } = result;
  progress.set({ lp: { ...progress.get().lp, [lesson.id]: lp } });
  noteAttempt(lesson.id, r.met);
  if (saved && event === 'passed') void addXp('lesson_pass', lesson.id, XP.lessonPass);
  if (saved && (event === 'review_passed' || event === 'mastered')) void addXp('review', lesson.id, XP.review);
  return event;
}

/** Add practice seconds to today (the activity clock in activity.ts). */
export async function addActive(seconds: number, day = dayOf()) {
  const pr = progress.get(), active_s = (pr.active[day] ?? 0) + Math.round(seconds);
  const counts = qualifies({ day, active_s }, false) && !pr.days.includes(day);
  progress.set({ active: { ...pr.active, [day]: active_s }, ...(counts ? { days: [...pr.days, day].sort() } : {}) });
  try { await db.put('practice_day', { day, active_s }); } catch { /* ignore */ }
}
export async function addServiceDay(day = dayOf()) {
  try { await db.put('service_day', { day }); } catch { /* ignore */ }
  const pr = progress.get();
  if (!pr.services.includes(day)) progress.set({ services: [...pr.services, day].sort(), days: pr.days.includes(day) ? pr.days : [...pr.days, day].sort() });
}
/** Streak with the 5-minute rule, service days and freezes (streak.ts). */
export function streakInfo(today = dayOf()): StreakInfo {
  const pr = progress.get();
  const all = [...new Set([...pr.days, ...Object.keys(pr.active)])];
  return computeStreak(all.map(day => (pr.active[day] === undefined ? { day } : { day, active_s: pr.active[day] })), pr.services, today);
}

export async function bumpQuizItem(quiz_id: string, item_key: string, correct: boolean) {
  try {
    const row = (await db.get<{ quiz_id: string; item_key: string; seen: number; correct: number }>('quiz_item_stats', [quiz_id, item_key])) || { quiz_id, item_key, seen: 0, correct: 0 };
    row.seen++; if (correct) row.correct++;
    await db.put('quiz_item_stats', { ...row, last_seen_at: Date.now() });
  } catch { /* ignore */ }
}
export async function quizWeights(quiz_id: string): Promise<Record<string, number>> {
  try {
    const rows = await db.getByFirstKey<{ item_key: string; seen: number; correct: number }>('quiz_item_stats', quiz_id);
    return Object.fromEntries(rows.map(r => [r.item_key, Math.max(0, (r.seen - r.correct) * 2 - r.correct * 0.2)]));
  } catch { return {}; }
}
