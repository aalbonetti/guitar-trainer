// Arcade persistence: runs, personal bests (with ghost), XP, review credit, "played a service" days.
import * as db from './db';
import { Store } from './store';
import { addXp } from './xp';
import { XP, xpForScore, stars as starsFor } from './games/core';
import { progress, recordAttempt, markPracticed } from './progressStore';
import { isReviewDue, dayOf } from './progress';
import { session, touch } from './practice';
import type { Catalog, Game, GameLevel } from './catalog';

export interface Best { key: string; game_id: string; level_id: string; mode: string; best_score: number; best_stars: number; ghost: [number, number][]; at: number }
export const bests = new Store<{ ready: boolean; map: Record<string, Best> }>({ ready: false, map: {} });
export const bestKey = (g: string, l: string, mode = 'tap') => `${g}|${l}|${mode}`;
export async function loadBests() {
  try { const rows = await db.getAll<Best>('game_best'); bests.set({ ready: true, map: Object.fromEntries(rows.map(r => [r.key, r])) }); } catch { bests.set({ ready: true }); }
}

/** Every G1 game's first level is open from the start; each next level opens with ★★ on the one before it. */
export function unlocked(_cat: Catalog, g: Game, l?: GameLevel): boolean {
  if (!l) return true;
  const i = g.levels.indexOf(l);
  if (i <= 0) return true;
  return (bests.get().map[bestKey(g.id, g.levels[i - 1].id)]?.best_stars || 0) >= 2;
}
/** Lesson that teaches this game's skill (shown as a tip, not a lock). */
export const lessonFor = (g: Game, l?: GameLevel) => l?.unlock_lesson || g.unlock_lesson;

export interface RunResult { score: number; correct: number; total: number; maxCombo: number; finished: boolean; durationS: number; misses: string[]; ghost: [number, number][] }
export interface RunOutcome { stars: number; accuracy: number; xp: number; pb: boolean; prevBest: number; reviewed: string[] }

export async function finishRun(cat: Catalog, g: Game, l: GameLevel, r: RunResult, mode = 'tap'): Promise<RunOutcome> {
  const accuracy = r.total ? r.correct / r.total : 0;
  const stars = starsFor(r.finished, accuracy, r.score, l.target_score);
  const key = bestKey(g.id, l.id, mode), prev = bests.get().map[key];
  const pb = r.score > 0 && (!prev || r.score > prev.best_score);
  // Review credit (§4): ★★ or better on a matching level counts as that quiz lesson's due review.
  const reviewed: string[] = [];
  if (stars >= 2) for (const id of l.review_for || []) {
    const lesson = cat.lessonById[id];
    if (lesson && lesson.pass_criteria.type === 'quiz' && isReviewDue(progress.get().lp[id], dayOf())) {
      await recordAttempt(lesson, { met: true, atTarget: true, score: accuracy, mode: 'auto', metrics: { via: g.id, level: l.id, stars } });
      reviewed.push(id);
    }
  }
  try {
    await db.add('game_run', { session_id: session.get().s?.id ?? null, game_id: g.id, level_id: l.id, mode, score: r.score, accuracy, max_combo: r.maxCombo, stars, duration_s: Math.round(r.durationS), misses_json: JSON.stringify(r.misses.slice(0, 20)), counted_review_for: reviewed.join(',') || null, at: Date.now() });
    if (pb || (prev && stars > prev.best_stars)) {
      const row: Best = { key, game_id: g.id, level_id: l.id, mode, best_score: Math.max(r.score, prev?.best_score || 0), best_stars: Math.max(stars, prev?.best_stars || 0), ghost: pb ? r.ghost : prev!.ghost, at: Date.now() };
      await db.put('game_best', row); bests.set({ map: { ...bests.get().map, [key]: row } });
    }
  } catch { /* storage unavailable */ }
  const gained = xpForScore(r.score) + (pb && prev ? XP.pb : 0);
  await addXp('game', g.id, xpForScore(r.score));
  if (pb && prev) await addXp('pb', key, XP.pb);
  await markPracticed(); touch();
  return { stars, accuracy, xp: gained, pb, prevBest: prev?.best_score || 0, reviewed };
}

// ---------- "Played a service today" keeps the streak ----------
export async function markService(day = dayOf()) { try { await db.put('service_day', { day }); } catch { /* ignore */ } await markPracticed(day); }
export async function serviceDays(): Promise<string[]> { try { return (await db.getAll<{ day: string }>('service_day')).map(r => r.day); } catch { return []; } }
