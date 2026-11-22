// Progress rules (06-app-spec.md §5), pure where possible so they can be unit-tested.
import type { Lesson, Track } from './catalog';

export type State = 'locked' | 'available' | 'in_progress' | 'passed';
export interface LessonProgress {
  lesson_id: string; state: State; first_pass_day?: string; passed_day?: string;
  review_index: number; next_review_day?: string; mastered: boolean; updated_at: number;
}
export interface AttemptResult { met: boolean; atTarget: boolean; score: number; mode: 'auto' | 'self'; metrics?: Record<string, unknown> }
export type Event = 'none' | 'first_pass' | 'passed' | 'review_passed' | 'review_failed' | 'mastered';

export function dayOf(d = new Date()): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function addDays(day: string, n: number): string { const [y, m, d] = day.split('-').map(Number); return dayOf(new Date(y, m - 1, d + n)); }

/** Locked/available from prereqs (passed, or passed once). Tracks A/ER/EL also need every Foundations lesson passed once. */
export function computeStates(lessons: Lesson[], tracks: Track[], lp: Record<string, LessonProgress>): Record<string, State> {
  // A first pass is enough to move on; the second-day pass completes the lesson and starts its reviews.
  const passed = (id: string) => lp[id]?.state === 'passed' || !!lp[id]?.first_pass_day;
  const allF = lessons.filter(l => l.track === 'F').every(l => passed(l.id));
  const out: Record<string, State> = {};
  for (const l of lessons) {
    const p = lp[l.id];
    if (p && (p.state === 'passed' || p.state === 'in_progress')) { out[l.id] = p.state; continue; }
    const t = tracks.find(x => x.id === l.track);
    const trackOk = !t?.requires?.includes('F') || allF;
    out[l.id] = l.prereqs.every(passed) && trackOk ? 'available' : 'locked';
  }
  return out;
}

export function isReviewDue(p: LessonProgress | undefined, day: string): boolean {
  return !!p && p.state === 'passed' && !p.mastered && !!p.next_review_day && p.next_review_day <= day;
}

/** Apply one attempt's result. Returns the new progress row and what happened. */
export function applyAttempt(prev: LessonProgress | undefined, lesson: Lesson, r: AttemptResult, day: string, now = Date.now()): { lp: LessonProgress; event: Event } {
  const p: LessonProgress = prev ? { ...prev } : { lesson_id: lesson.id, state: 'available', review_index: 0, mastered: false, updated_at: now };
  p.updated_at = now;
  const rd = lesson.review_days;
  if (isReviewDue(prev, day)) {
    if (r.met) {
      p.review_index += 1;
      if (p.review_index >= rd.length) { p.mastered = true; p.next_review_day = undefined; return { lp: p, event: 'mastered' }; }
      p.next_review_day = addDays(day, rd[p.review_index] - rd[p.review_index - 1]);
      return { lp: p, event: 'review_passed' };
    }
    p.review_index = 0; p.next_review_day = addDays(day, 1);
    return { lp: p, event: 'review_failed' };
  }
  if (p.state === 'passed') return { lp: p, event: 'none' };
  if (r.met && r.atTarget) {
    if (!p.first_pass_day) { p.first_pass_day = day; p.state = 'in_progress'; return { lp: p, event: 'first_pass' }; }
    if (p.first_pass_day !== day) {
      p.state = 'passed'; p.passed_day = day; p.review_index = 0; p.next_review_day = addDays(day, rd[0] ?? 1);
      return { lp: p, event: 'passed' };
    }
    return { lp: p, event: 'none' };
  }
  if (p.state !== 'in_progress') p.state = 'in_progress';
  return { lp: p, event: 'none' };
}

export const EVENT_TEXT: Record<Event, string> = {
  none: '',
  first_pass: 'First pass! The next lessons are open. Pass this one again on another day (tomorrow or later) to complete it.',
  passed: 'Lesson passed. A quick review is scheduled so it sticks.',
  review_passed: 'Review passed. The next one is further out.',
  review_failed: 'Not quite this time; we’ll review it again tomorrow.',
  mastered: 'Mastered. No more reviews for this one.',
};
