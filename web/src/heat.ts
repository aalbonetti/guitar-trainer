// Fretboard heatmap (07-games.md §4): your own accuracy and speed at each string and fret, from Note Drop and
// Fret Finder answers (tap and play). Rows live in IndexedDB `quiz_item_stats` under quiz_id 'arcade:fretboard'
// with item_key 's5f7' (the same key F.07's quiz uses), plus `ms_sum` (time to each right answer). Hard spots
// feed the Daily Challenge. The grid math is pure (unit-tested).
import * as db from './db';
import type { Pos } from './games/core';

export const HEAT_ID = 'arcade:fretboard';
export interface HeatRow { quiz_id: string; item_key: string; seen: number; correct: number; ms_sum?: number; last_seen_at?: number }
export interface HeatCell { string: number; fret: number; seen: number; correct: number; acc: number; avgMs: number | null }
export const spotKey = (p: Pos) => `s${p.string}f${p.fret}`;
export function parseSpot(k: string): Pos | null { const m = /^s([1-6])f(\d+)$/.exec(k); return m ? { string: +m[1], fret: +m[2] } : null; }

/** Cells with data, keyed 's5f7'. */
export function heatCells(rows: HeatRow[]): Record<string, HeatCell> {
  const out: Record<string, HeatCell> = {};
  for (const r of rows) {
    if (r.quiz_id !== HEAT_ID) continue;
    const p = parseSpot(r.item_key); if (!p || !r.seen) continue;
    out[r.item_key] = { ...p, seen: r.seen, correct: r.correct, acc: r.correct / r.seen, avgMs: r.correct ? (r.ms_sum || 0) / r.correct : null };
  }
  return out;
}
/** Hard spots: seen at least `minSeen` times and under 75% right, or right but slow (over 1.5× your median time).
 *  Worst first (lowest accuracy, then slowest). */
export function hardSpots(cells: Record<string, HeatCell>, n = 6, minSeen = 3): HeatCell[] {
  const cs = Object.values(cells).filter(c => c.seen >= minSeen);
  const times = cs.map(c => c.avgMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const med = times.length ? times[Math.floor(times.length / 2)] : 0;
  const slow = (c: HeatCell) => c.avgMs !== null && med > 0 && c.avgMs > 1.5 * med;
  return cs.filter(c => c.acc < 0.75 || slow(c))
    .sort((a, b) => a.acc - b.acc || (b.avgMs ?? 0) - (a.avgMs ?? 0)).slice(0, n);
}
/** Colour band for a cell: 0 none · 1 weak (< 60%) · 2 so-so (< 85%) · 3 good · 4 good and fast. */
export function band(c: HeatCell | undefined, medianMs: number): number {
  if (!c) return 0;
  if (c.acc < 0.6) return 1;
  if (c.acc < 0.85) return 2;
  return c.avgMs !== null && medianMs > 0 && c.avgMs <= medianMs ? 4 : 3;
}

// ---------- recording (buffered during a round, written at its end) ----------
const pending = new Map<string, { seen: number; correct: number; ms: number }>();
/** One answer at a spot: right (with the time it took) or missed. */
export function noteSpot(p: Pos, ok: boolean, ms = 0) {
  const k = spotKey(p), x = pending.get(k) || { seen: 0, correct: 0, ms: 0 };
  x.seen++; if (ok) { x.correct++; x.ms += Math.max(0, Math.min(20000, ms)); }
  pending.set(k, x);
}
export async function flushHeat() {
  if (!pending.size) return;
  const items = [...pending.entries()]; pending.clear();
  try {
    await db.transact(['quiz_item_stats'], async t => {
      const s = t.objectStore('quiz_item_stats');
      for (const [k, x] of items) {
        const row = (await db.request<HeatRow | undefined>(s.get([HEAT_ID, k]))) || { quiz_id: HEAT_ID, item_key: k, seen: 0, correct: 0, ms_sum: 0 };
        s.put({ ...row, seen: row.seen + x.seen, correct: row.correct + x.correct, ms_sum: (row.ms_sum || 0) + x.ms, last_seen_at: Date.now() });
      }
    });
  } catch { /* storage unavailable */ }
}
export async function loadHeat(): Promise<Record<string, HeatCell>> {
  try { return heatCells(await db.getByFirstKey<HeatRow>('quiz_item_stats', HEAT_ID)); } catch { return {}; }
}
