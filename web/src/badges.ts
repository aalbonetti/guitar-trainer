// Badges (07-games.md §5). The rules are catalog data (badges.json, checked by build_catalog.py); this module
// checks them against the player's own records. `badgeProgress` is pure (unit-tested); earned badges are kept in
// IndexedDB `badge` (badge_id PK, earned_at) and never taken away.
import * as db from './db';
import { Store } from './store';
import type { BadgeDef, Catalog } from './catalog';

export interface RunRow { game_id: string; level_id: string; mode: string; stars: number; accuracy: number; max_streak?: number; extra_json?: string | null; at: number }
export interface BestRow { key: string; game_id: string; level_id: string; mode: string; best_stars: number }
export interface BadgeData {
  bests: Record<string, BestRow>; runs: RunRow[];
  /** Outline ids of the church list (the set list on this phone, else the song library: songPool) */
  churchSongs: string[];
  longestStreak: number;
}
export interface BadgeProgress { earned: boolean; have: number; need: number; text: string }
const extra = (r: RunRow): Record<string, any> => { try { return JSON.parse(r.extra_json || '{}'); } catch { return {}; } };

export function badgeProgress(b: BadgeDef, d: BadgeData): BadgeProgress {
  const r = b.rule, out = (have: number, need: number, text: string): BadgeProgress => ({ earned: have >= need, have: Math.min(have, need), need, text });
  const runs = d.runs.filter(x => !r.game || x.game_id === r.game);
  switch (r.kind) {
    case 'song_run_all': {
      const need = d.churchSongs.length;
      const have = d.churchSongs.filter(id => Object.values(d.bests).some(x => x.game_id === r.game && x.level_id === id && x.best_stars >= (r.stars ?? 3))).length;
      return need ? out(have, need, `${have} of ${need} songs at ★★★`) : { earned: false, have: 0, need: 1, text: 'No church songs yet' };
    }
    case 'keys_all': {
      // a key counts once a ★★-or-better round had at least min_calls calls in it with ≥ accuracy right
      const got = new Set<string>();
      for (const x of runs) if (x.stars >= 2) for (const [k, v] of Object.entries((extra(x).keys || {}) as Record<string, [number, number]>))
        if (v[1] >= (r.min_calls ?? 3) && v[0] / v[1] >= (r.accuracy ?? 0.85) - 1e-9) got.add(k);
      const keys = r.keys || [], have = keys.filter(k => got.has(k)).length;
      return out(have, keys.length, `${have} of ${keys.length} keys`);
    }
    case 'level_stars': {
      const best = Object.values(d.bests).find(x => x.game_id === r.game && x.level_id === r.level && (!r.mode || x.mode === r.mode));
      const s = best?.best_stars ?? 0;
      return out(s, r.stars ?? 3, `best ${'★'.repeat(s) || 'none yet'}`);
    }
    case 'positions_all': {
      const got = new Set<number>();
      for (const x of runs) if (x.stars >= (r.stars ?? 2)) { const p = extra(x).pos; if (typeof p === 'number') got.add(p); }
      const ps = r.positions || [], have = ps.filter(p => got.has(p)).length;
      return out(have, ps.length, `${have} of ${ps.length} positions`);
    }
    case 'gap_landing': {
      // rounds of the level that reached the gap's return, newest last; count the run of landings within the window
      const rows = runs.filter(x => x.level_id === r.level).sort((a, b) => a.at - b.at)
        .map(x => (extra(x).landings || {})[String(r.gap_bars)]).filter(v => v !== undefined) as (number | null)[];
      let streak = 0, best = 0;
      for (const v of rows) { streak = v !== null && Math.abs(v) <= (r.within_ms ?? 20) ? streak + 1 : 0; best = Math.max(best, streak); }
      return { earned: best >= (r.in_a_row ?? 5), have: Math.min(streak, r.in_a_row ?? 5), need: r.in_a_row ?? 5, text: `${streak} in a row now` };
    }
    case 'streak_in_round': {
      const best = Math.max(0, ...runs.map(x => x.max_streak || 0));
      return out(best, r.streak ?? 30, `best run ${best} in a row`);
    }
    case 'streak_days': return out(d.longestStreak, r.days ?? 30, `longest streak ${d.longestStreak} days`);
    default: return { earned: false, have: 0, need: 1, text: '' };
  }
}

export const badges = new Store<{ ready: boolean; earned: Record<string, number> }>({ ready: false, earned: {} });
export async function loadBadges() {
  try { const rows = await db.getAll<{ badge_id: string; earned_at: number }>('badge'); badges.set({ ready: true, earned: Object.fromEntries(rows.map(r => [r.badge_id, r.earned_at])) }); }
  catch { badges.set({ ready: true }); }
}
/** Check every badge; save the newly earned ones and return them. */
export async function checkBadges(cat: Pick<Catalog, 'badges'>, d: Omit<BadgeData, 'runs'> & { runs?: RunRow[] }): Promise<BadgeDef[]> {
  if (!badges.get().ready) await loadBadges();
  const todo = (cat.badges || []).filter(b => !badges.get().earned[b.id]);
  if (!todo.length) return []; // all earned: no need to read every run
  let runs = d.runs;
  if (!runs) try { runs = await db.getAll<RunRow>('game_run'); } catch { runs = []; }
  const fresh: BadgeDef[] = [];
  for (const b of todo) {
    if (badges.get().earned[b.id]) continue; // another check may have saved it meanwhile
    if (badgeProgress(b, { ...d, runs }).earned) {
      const at = Date.now();
      try { await db.put('badge', { badge_id: b.id, earned_at: at }); } catch { /* storage unavailable */ }
      badges.set({ earned: { ...badges.get().earned, [b.id]: at } });
      fresh.push(b);
    }
  }
  return fresh;
}
