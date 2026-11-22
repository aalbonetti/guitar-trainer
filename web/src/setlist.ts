// The church set list is personal: it's imported on the phone from the CSV and stored only there.
// Format: Name,new,total,<week 1>,<week 2>,...  with ✓ (or any text) in the weeks a song was played.
import type { Outline } from './catalog';
import { persisted } from './store';

export interface SetSong { name: string; plays: number; isNew: boolean; weeks: string[]; last: string | null; lastIndex: number; outlineId: string | null }
export interface SetList { weeks: string[]; songs: SetSong[]; importedAt: string }

const store = persisted<SetList | null>('gt_setlist_v1', null);
export const getSetList = () => store.get();
export const clearSetList = () => store.set(null);

// Set-list title -> outline title (lowercase). Mirrors ALIAS in guitar-kb/catalog/build_setlist.py.
const ALIAS: Record<string, string> = {
  'glorious day (passion)': 'glorious day',
  'in christ alone (with the solid rock) / medley': 'in christ alone',
  'o praise the name (anástasis)': 'o praise the name (anastasis)',
  'here i am lord': 'here i am, lord',
  'come thou fount come thou king': 'come thou fount, come thou king',
  'shine jesus shine': 'shine, jesus, shine',
  'the potters hand': "the potter's hand",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

export function importSetList(text: string, outlines: Outline[]): SetList {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2 || rows[0].length < 4) throw new Error('That doesn’t look like the set-list CSV (Name, new, total, then one column per week).');
  const weeks = rows[0].slice(3).map(w => w.trim());
  const byTitle: Record<string, string> = {};
  for (const o of outlines) byTitle[o.title.toLowerCase()] = o.id;
  const songs: SetSong[] = rows.slice(1).filter(r => r[0] && r[0].trim()).map(r => {
    const name = r[0].trim(), key = name.toLowerCase();
    const marks = r.slice(3);
    const played = weeks.filter((_, i) => (marks[i] || '').trim());
    const lastIndex = marks.map((m, i) => ((m || '').trim() ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    return { name, plays: parseInt(r[2], 10) || played.length, isNew: !!(r[1] || '').trim(), weeks: played,
      last: lastIndex >= 0 ? weeks[lastIndex] : null, lastIndex, outlineId: byTitle[ALIAS[key] || key] || null };
  });
  const list = { weeks, songs, importedAt: new Date().toISOString() };
  store.set(list);
  return list;
}

// ---------- "this week" ----------
const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** Week label ("Aug 23", "Sept 6", "11/15", "2026-11-15") → date, choosing the year closest to `today`. */
export function weekDate(label: string, today: Date): Date | null {
  let m: number, d: number, y: number | null = null;
  const iso = label.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/), num = label.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/), txt = label.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2})/);
  if (iso) { y = +iso[1]; m = +iso[2] - 1; d = +iso[3]; }
  else if (num) { m = +num[1] - 1; d = +num[2]; if (num[3]) y = +num[3] < 100 ? 2000 + +num[3] : +num[3]; }
  else if (txt && MON[txt[1].toLowerCase()] !== undefined) { m = MON[txt[1].toLowerCase()]; d = +txt[2]; }
  else return null;
  if (y !== null) return new Date(y, m, d);
  const Y = today.getFullYear();
  return [Y - 1, Y, Y + 1].map(yy => new Date(yy, m, d)).sort((a, b) => Math.abs(a.getTime() - today.getTime()) - Math.abs(b.getTime() - today.getTime()))[0];
}
/** Index of this week's column: the newest week on or before the coming Sunday (or the last column if labels can't be read). */
export function thisWeekIndex(list: SetList, today = new Date()): number {
  const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((7 - today.getDay()) % 7), 23, 59);
  let best = -1, bestT = -Infinity;
  list.weeks.forEach((w, i) => { const t = weekDate(w, today)?.getTime(); if (t !== undefined && t <= limit.getTime() && t > bestT) { best = i; bestT = t; } });
  return best >= 0 ? best : list.weeks.length - 1;
}
/** Songs on this week's set. */
export function thisWeekSongs(list: SetList, today = new Date()): SetSong[] {
  const i = thisWeekIndex(list, today), w = list.weeks[i];
  return list.songs.filter(s => s.weeks.includes(w));
}

/** Songs played in the most recent `n` weeks of the imported list, newest first. */
export function recentSongs(list: SetList, n = 4): SetSong[] {
  const from = list.weeks.length - n;
  return list.songs.filter(s => s.lastIndex >= from).sort((a, b) => b.lastIndex - a.lastIndex || b.plays - a.plays);
}
