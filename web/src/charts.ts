// Imported charts (personal use): raw text kept in IndexedDB on the phone only, parsed when shown.
import { Store } from './store';
import * as db from './db';
import { parseChart, matchOutline, type ParsedChart } from './chordpro';
import type { Outline } from './catalog';

export interface ChartRow { id: string; title: string; artist: string | null; ccli: number | null; key: string | null; tempo: number | null; time: string | null; capo: number; source_filename: string; raw_text: string; matched_outline_id: string | null; imported_at: number }
export const charts = new Store<{ ready: boolean; list: ChartRow[] }>({ ready: false, list: [] });

export async function loadCharts() {
  try { const list = await db.getAll<ChartRow>('imported_chart'); charts.set({ ready: true, list: list.sort((a, b) => a.title.localeCompare(b.title)) }); }
  catch { charts.set({ ready: true }); }
}
export function rowFrom(p: ParsedChart, raw: string, fileName: string, outlines: Outline[]): ChartRow {
  return { id: `c${Date.now()}`, title: p.title, artist: p.artist, ccli: p.ccli, key: p.key, tempo: p.tempo, time: p.time, capo: p.capo,
    source_filename: fileName, raw_text: raw, matched_outline_id: matchOutline(p, outlines)?.id ?? null, imported_at: Date.now() };
}
export async function saveChart(row: ChartRow) { await db.put('imported_chart', row); await loadCharts(); }
export async function deleteChart(id: string) { await db.del('imported_chart', id); await loadCharts(); }
export const chartFor = (outlineId: string) => charts.get().list.find(c => c.matched_outline_id === outlineId);
export const parsed = (r: ChartRow) => parseChart(r.raw_text, r.source_filename);
