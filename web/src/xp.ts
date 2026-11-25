// XP ledger (07-games.md §4). Small module so lessons and games can both award XP without import cycles.
import { Store } from './store';
import * as db from './db';

export const xp = new Store<{ total: number; last: number }>({ total: 0, last: 0 });
export async function loadXp() {
  try { const rows = await db.getAll<{ xp: number }>('xp_ledger'); xp.set({ total: rows.reduce((a, r) => a + r.xp, 0) }); } catch { /* ignore */ }
}
export async function addXp(source: 'game' | 'lesson_pass' | 'review' | 'daily' | 'pb', ref_id: string, amount: number) {
  if (amount <= 0) return;
  try { await db.add('xp_ledger', { at: Date.now(), source, ref_id, xp: amount }); } catch { /* ignore */ }
  xp.set({ total: xp.get().total + amount, last: amount });
}
