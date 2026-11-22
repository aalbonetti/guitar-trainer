// Daily practice loop (06-app-spec.md §3 Today, §4 Session flow; routines from 01-curriculum.md).
// buildQueue is pure so it's unit-tested; the session store wraps it with persistence.
import type { Catalog, Lesson } from './catalog';
import { isReviewDue, type LessonProgress, type State } from './progress';
import type { SetList } from './setlist';
import { recentSongs } from './setlist';
import { Store, persisted } from './store';
import * as db from './db';

export type Routine = 15 | 30 | 'free';
export type ItemKind = 'warmup' | 'review' | 'lesson' | 'song' | 'ear';
export interface Item { kind: ItemKind; lessonId?: string; songId?: string; title: string; why: string; minutes: number | null }
export interface QueueInput {
  cat: Pick<Catalog, 'lessons' | 'tracks' | 'outlines'>; lp: Record<string, LessonProgress>; states: Record<string, State>;
  day: string; visibleTrack: (id: string) => boolean; setlist: SetList | null; songLast: Record<string, string>;
}

const WARMUP = 'F.05', EAR = ['T.06', 'T.05'];

/** Today's queue: warm-up → up to 3 due reviews → current lesson per track → 1 song (→ ear quiz in 30 min). */
export function buildQueue(q: QueueInput, routine: Routine): Item[] {
  const { cat, lp, states, day } = q;
  const L = (id: string) => cat.lessons.find(l => l.id === id);
  const mins = (m15: number, m30: number) => (routine === 'free' ? null : routine === 15 ? m15 : m30);
  const items: Item[] = [];
  const used = new Set<string>();
  const visible = cat.lessons.filter(l => q.visibleTrack(l.track));

  // warm-up: the spider exercise, once it's unlocked
  const w = L(WARMUP);
  if (w && states[WARMUP] !== 'locked') { items.push({ kind: 'warmup', lessonId: WARMUP, title: 'Warm-up: spider', why: 'Loosen up the fingers with the click', minutes: mins(3, 5) }); used.add(WARMUP); }

  // reviews due (oldest due first)
  const maxReviews = routine === 15 ? 2 : 3;
  const due = visible.filter(l => isReviewDue(lp[l.id], day) && !used.has(l.id))
    .sort((a, b) => (lp[a.id].next_review_day! < lp[b.id].next_review_day! ? -1 : 1)).slice(0, maxReviews);
  for (const l of due) { items.push({ kind: 'review', lessonId: l.id, title: `Review: ${l.title}`, why: 'Quick check so it sticks', minutes: mins(2, 2) }); used.add(l.id); }

  // current lessons: passed-once first (finish what you started), then the next available, by track order
  const maxLessons = routine === 15 ? 1 : routine === 30 ? 2 : 99;
  const tracks = [...cat.tracks].sort((a, b) => a.order - b.order).filter(t => q.visibleTrack(t.id));
  const pick = (t: string): Lesson | undefined => {
    const inTrack = visible.filter(l => l.track === t && !used.has(l.id));
    return inTrack.find(l => states[l.id] === 'in_progress' && lp[l.id]?.first_pass_day) || inTrack.find(l => states[l.id] === 'in_progress') || inTrack.find(l => states[l.id] === 'available');
  };
  const cands = tracks.map(t => pick(t.id)).filter((l): l is Lesson => !!l)
    .sort((a, b) => rank(a) - rank(b));
  function rank(l: Lesson) { return lp[l.id]?.first_pass_day ? 0 : states[l.id] === 'in_progress' ? 1 : 2; }
  const lessonMins = routine === 30 ? [8, 7] : [5];
  cands.slice(0, maxLessons).forEach((l, i) => {
    items.push({ kind: 'lesson', lessonId: l.id, title: l.title, why: lp[l.id]?.first_pass_day ? 'Passed once: pass it again today to finish it' : states[l.id] === 'in_progress' ? 'Keep going' : 'Next up', minutes: routine === 'free' ? null : lessonMins[i] ?? 5 });
    used.add(l.id);
  });

  // one song: this month's set first, least recently practiced; else a song that uses a current lesson
  const song = pickSong(q, [...used]);
  if (song) items.push({ kind: 'song', songId: song.id, title: song.title, why: song.why, minutes: mins(7, 8) });

  // 30 min: ear quiz
  if (routine === 30) {
    const ear = EAR.map(L).find(l => l && states[l.id] !== 'locked' && q.visibleTrack(l.track) && !used.has(l.id));
    if (ear) items.push({ kind: 'ear', lessonId: ear.id, title: `Ear training: ${ear.title}`, why: 'Two minutes of listening', minutes: 2 });
  }
  return items;
}

function pickSong(q: QueueInput, lessonIds: string[]): { id: string; title: string; why: string } | null {
  const byId = (id: string) => q.cat.outlines.find(o => o.id === id);
  const older = (a: string, b: string) => (q.songLast[a] || '') < (q.songLast[b] || '') ? -1 : (q.songLast[a] || '') > (q.songLast[b] || '') ? 1 : 0;
  if (q.setlist) {
    const month = recentSongs(q.setlist, 4).filter(s => s.outlineId && byId(s.outlineId)).map(s => s.outlineId!);
    if (month.length) { const id = [...month].sort(older)[0]; return { id, title: byId(id)!.title, why: 'On this month’s set list' }; }
  }
  const linked = q.cat.outlines.filter(o => o.practice_for.some(id => lessonIds.includes(id))).map(o => o.id);
  const pool = linked.length ? linked : q.cat.outlines.filter(o => o.practice_for.length).map(o => o.id);
  if (!pool.length) return null;
  const id = [...pool].sort(older)[0];
  return { id, title: byId(id)!.title, why: linked.length ? 'Uses what you’re working on' : 'Song practice' };
}

export const totalMinutes = (items: Item[]) => items.reduce((s, i) => s + (i.minutes || 0), 0);
export const itemHref = (i: Item) => (i.songId ? `#/song/${i.songId}` : `#/lesson/${i.lessonId}`);

// ---------- practice session ----------
export const IDLE_MS = 30 * 60 * 1000;
export interface Session { id: string; startedAt: number; lastActive: number; routine: Routine; items: Item[]; idx: number; itemStart: number; done: boolean[]; tunedAt?: number; attempts: number; passes: number }
export interface SessionRow { id: string; started_at: number; ended_at: number; day: string; routine: string; total_s: number; tuned_at?: number; items: number; items_done: number; attempts: number; passes: number }
const saved = persisted<Session | null>('gt_session', null);
export const songLastPref = persisted<Record<string, string>>('gt_song_last', {});
export const session = new Store<{ s: Session | null; summary: SessionRow | null }>({ s: saved.get(), summary: null });
const put = (s: Session | null) => { saved.set(s); session.set({ s }); };

/** Session length: from start to the last activity, so idle time at the end isn't counted. */
export function sessionRow(s: Session, day: string): SessionRow {
  return { id: s.id, started_at: s.startedAt, ended_at: s.lastActive, day, routine: String(s.routine), total_s: Math.round((s.lastActive - s.startedAt) / 1000),
    tuned_at: s.tunedAt, items: s.items.length, items_done: s.done.filter(Boolean).length, attempts: s.attempts, passes: s.passes };
}
const dayStr = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function startSession(items: Item[], routine: Routine, now = Date.now()) {
  const s: Session = { id: `s${now}`, startedAt: now, lastActive: now, routine, items, idx: 0, itemStart: now, done: items.map(() => false), attempts: 0, passes: 0 };
  put(s); session.set({ summary: null });
  return s;
}
/** Close the session if it's been idle 30 minutes (called on app start and when the app comes back). */
export async function expireIdle(now = Date.now()) { const s = session.get().s; if (s && now - s.lastActive > IDLE_MS) await endSession(false); }
export function touch(now = Date.now()) { const s = session.get().s; if (s) put({ ...s, lastActive: now }); }
export function noteTuned(now = Date.now()) { const s = session.get().s; if (s && !s.tunedAt) put({ ...s, tunedAt: now }); }
/** An attempt was recorded: tick the matching queue item, count it. */
export function noteAttempt(lessonId: string, met: boolean, now = Date.now()) {
  const s = session.get().s; if (!s) return;
  const done = s.items.map((it, i) => s.done[i] || it.lessonId === lessonId);
  put({ ...s, done, attempts: s.attempts + 1, passes: s.passes + (met ? 1 : 0), lastActive: now });
}
export function noteSongOpened(songId: string, now = Date.now()) {
  songLastPref.set({ ...songLastPref.get(), [songId]: dayStr(now) });
  const s = session.get().s; if (!s) return;
  put({ ...s, done: s.items.map((it, i) => s.done[i] || it.songId === songId), lastActive: now });
}
export function goTo(idx: number, markDone = false) {
  const s = session.get().s; if (!s) return;
  const done = [...s.done]; if (markDone) done[s.idx] = true;
  const i = Math.max(0, Math.min(s.items.length - 1, idx)), now = Date.now();
  put({ ...s, idx: i, done, lastActive: now, itemStart: i === s.idx ? s.itemStart : now });
}
export async function endSession(showSummary = true) {
  const s = session.get().s; if (!s) return;
  const row = sessionRow(s, dayStr(s.startedAt));
  try { await db.put('practice_session', row); } catch { /* storage unavailable */ }
  put(null); session.set({ summary: showSummary ? row : null });
}
export async function sessionsSince(day: string): Promise<SessionRow[]> {
  try { return (await db.getAll<SessionRow>('practice_session')).filter(r => r.day >= day); } catch { return []; }
}
