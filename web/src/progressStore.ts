// App-level progress state: loads from IndexedDB once, keeps an in-memory copy for the UI.
import { Store } from './store';
import * as db from './db';
import { applyAttempt, dayOf, type AttemptResult, type LessonProgress, type Event } from './progress';
import type { Lesson } from './catalog';
import { session, noteAttempt } from './practice';
import { addXp } from './xp';
import { XP } from './games/core';
import { computeStreak, type DayRow, type StreakInfo } from './streak';

/** Did the last save reach the phone's storage? Shown to the user, never silent. */
export const saveStatus = new Store<{ state: 'idle' | 'saved' | 'error' | 'blocked'; at: number; msg: string }>({ state: 'idle', at: 0, msg: '' });
db.onBlocked(() => saveStatus.set({ state: 'blocked', at: Date.now(), msg: 'Another copy of Guitar Trainer is open (an older tab or the home-screen app). Close it so your progress can be saved.' }));
/** `days`: every day with any practice logged. `active`: practice seconds per day (the streak needs 5 minutes;
 *  days from before minutes were tracked have no entry). `services`: "Played a service today" days. */
export const progress = new Store<{ ready: boolean; lp: Record<string, LessonProgress>; days: string[]; active: Record<string, number>; services: string[] }>({ ready: false, lp: {}, days: [], active: {}, services: [] });

export async function loadProgress() {
  try {
    const rows = await db.getAll<LessonProgress>('lesson_progress');
    const pd = await db.getAll<DayRow>('practice_day');
    const days = pd.map(d => d.day).sort();
    const active = Object.fromEntries(pd.filter(d => d.active_s !== undefined).map(d => [d.day, d.active_s!]));
    const services = (await db.getAll<{ day: string }>('service_day').catch(() => [])).map(d => d.day).sort();
    progress.set({ ready: true, lp: Object.fromEntries(rows.map(r => [r.lesson_id, r])), days, active, services });
  } catch (e) { progress.set({ ready: true }); saveStatus.set({ state: 'error', at: Date.now(), msg: `Couldn't open saved progress (${(e as Error)?.message || 'storage unavailable'}).` }); }
}

export async function recordAttempt(lesson: Lesson, r: AttemptResult): Promise<Event> {
  const day = dayOf();
  const prev = progress.get().lp[lesson.id];
  const { lp, event } = applyAttempt(prev, lesson, r, day);
  try {
    await db.put('lesson_progress', lp);
    await db.put('attempt', { session_id: session.get().s?.id ?? null, lesson_id: lesson.id, criterion_type: lesson.pass_criteria.type, grader_mode: r.mode, score: r.score, met_target: r.met, at_target_tempo: r.atTarget, metrics_json: JSON.stringify(r.metrics || {}), event, day, at: Date.now() });
    await markPracticed(day);
    saveStatus.set({ state: 'saved', at: Date.now(), msg: '' });
  } catch (e) { saveStatus.set({ state: 'error', at: Date.now(), msg: `Couldn't save to this phone (${(e as Error)?.message || 'storage unavailable'}). Progress will be lost when you leave. Check that you're not in Incognito, then save a backup in Settings.` }); }
  progress.set({ lp: { ...progress.get().lp, [lesson.id]: lp } });
  noteAttempt(lesson.id, r.met);
  if (event === 'passed') void addXp('lesson_pass', lesson.id, XP.lessonPass);
  if (event === 'review_passed' || event === 'mastered') void addXp('review', lesson.id, XP.review);
  return event;
}

/** Log that you practiced today (an attempt, a finished item, a game round). Rows written now always carry
 *  `active_s`, so only days from before minutes were tracked count without 5 minutes. */
export async function markPracticed(day = dayOf()) {
  if (progress.get().days.includes(day)) return;
  const active_s = progress.get().active[day] ?? 0;
  progress.set({ days: [...progress.get().days, day].sort(), active: { ...progress.get().active, [day]: active_s } });
  try { await db.put('practice_day', { day, active_s }); } catch { /* ignore */ }
}
/** Add practice seconds to today (the activity clock in activity.ts). */
export async function addActive(seconds: number, day = dayOf()) {
  const pr = progress.get(), active_s = (pr.active[day] ?? 0) + seconds;
  progress.set({ active: { ...pr.active, [day]: active_s }, days: pr.days.includes(day) ? pr.days : [...pr.days, day].sort() });
  try { await db.put('practice_day', { day, active_s }); } catch { /* ignore */ }
}
export async function addServiceDay(day = dayOf()) {
  try { await db.put('service_day', { day }); } catch { /* ignore */ }
  if (!progress.get().services.includes(day)) progress.set({ services: [...progress.get().services, day].sort() });
  await markPracticed(day);
}
/** Streak with the 5-minute rule, service days and freezes (streak.ts). */
export function streakInfo(today = dayOf()): StreakInfo {
  const pr = progress.get();
  return computeStreak(pr.days.map(day => (pr.active[day] === undefined ? { day } : { day, active_s: pr.active[day] })), pr.services, today);
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
    const rows = (await db.getAll<{ quiz_id: string; item_key: string; seen: number; correct: number }>('quiz_item_stats')).filter(r => r.quiz_id === quiz_id);
    return Object.fromEntries(rows.map(r => [r.item_key, Math.max(0, (r.seen - r.correct) * 2 - r.correct * 0.2)]));
  } catch { return {}; }
}
