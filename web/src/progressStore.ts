// App-level progress state: loads from IndexedDB once, keeps an in-memory copy for the UI.
import { Store } from './store';
import * as db from './db';
import { applyAttempt, dayOf, type AttemptResult, type LessonProgress, type Event } from './progress';
import type { Lesson } from './catalog';
import { session, noteAttempt } from './practice';

export const progress = new Store<{ ready: boolean; lp: Record<string, LessonProgress>; days: string[] }>({ ready: false, lp: {}, days: [] });

export async function loadProgress() {
  try {
    const rows = await db.getAll<LessonProgress>('lesson_progress');
    const days = (await db.getAll<{ day: string }>('practice_day')).map(d => d.day).sort();
    progress.set({ ready: true, lp: Object.fromEntries(rows.map(r => [r.lesson_id, r])), days });
  } catch { progress.set({ ready: true }); }
}

export async function recordAttempt(lesson: Lesson, r: AttemptResult): Promise<Event> {
  const day = dayOf();
  const prev = progress.get().lp[lesson.id];
  const { lp, event } = applyAttempt(prev, lesson, r, day);
  try {
    await db.put('lesson_progress', lp);
    await db.put('attempt', { session_id: session.get().s?.id ?? null, lesson_id: lesson.id, criterion_type: lesson.pass_criteria.type, grader_mode: r.mode, score: r.score, met_target: r.met, at_target_tempo: r.atTarget, metrics_json: JSON.stringify(r.metrics || {}), event, day, at: Date.now() });
    await markPracticed(day);
  } catch { /* storage unavailable: progress still updates for this visit */ }
  progress.set({ lp: { ...progress.get().lp, [lesson.id]: lp } });
  noteAttempt(lesson.id, r.met);
  return event;
}

export async function markPracticed(day = dayOf()) {
  if (progress.get().days.includes(day)) return;
  try { await db.put('practice_day', { day }); } catch { /* ignore */ }
  progress.set({ days: [...progress.get().days, day].sort() });
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
