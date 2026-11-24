// Daily practice loop (06-app-spec.md §3 Today, §4 Session flow; routines from 01-curriculum.md).
// buildQueue is pure so it's unit-tested; the session store wraps it with persistence.
import type { Catalog, Lesson } from './catalog';
import { isReviewDue, type LessonProgress, type State } from './progress';
import type { SetList } from './setlist';
import { Store, persisted } from './store';
import * as db from './db';

export type Routine = 10 | 20 | 'free';
/** Older saved choices (15/30) map onto the current routines. */
export const normRoutine = (r: unknown): Routine => (r === 'free' ? 'free' : typeof r === 'number' && r > 15 ? 20 : 10);
export type ItemKind = 'warmup' | 'review' | 'lesson' | 'song' | 'ear';
export interface Item { kind: ItemKind; lessonId?: string; songId?: string; title: string; why: string; minutes: number | null }
export interface QueueInput {
  cat: Pick<Catalog, 'lessons' | 'tracks' | 'outlines'>; lp: Record<string, LessonProgress>; states: Record<string, State>;
  day: string; today?: Date; visibleTrack: (id: string) => boolean; setlist: SetList | null; songLast?: Record<string, string>;
}

const WARMUP = 'F.05', EAR = ['T.06', 'T.05'];

// Minutes per part. Lessons get whatever is left of the routine's total.
const PLAN = {
  10: { total: 10, warmup: 2, review: 2, maxReviews: 1, ear: 0, maxLessons: 1 },
  20: { total: 20, warmup: 3, review: 2, maxReviews: 2, ear: 2, maxLessons: 2 },
  free: { total: 0, warmup: 0, review: 0, maxReviews: 3, ear: 0, maxLessons: 99 },
} as const;

/** Today's queue, in a fixed order: warm-up → due reviews → current lesson(s) (→ ear quiz in 20 min).
 *  The song of the week has its own box on Today (Connor's call), so it isn't a step here; its minutes go to the lessons. */
export function buildQueue(q: QueueInput, routine: Routine): Item[] {
  const { cat, lp, states, day } = q;
  const P = PLAN[routine], timed = routine !== 'free';
  const L = (id: string) => cat.lessons.find(l => l.id === id);
  const items: Item[] = [];
  const used = new Set<string>();
  const visible = cat.lessons.filter(l => q.visibleTrack(l.track));

  // warm-up: the spider exercise, once it's unlocked
  if (L(WARMUP) && states[WARMUP] !== 'locked') { items.push({ kind: 'warmup', lessonId: WARMUP, title: 'Warm-up: spider', why: 'Loosen up the fingers with the click', minutes: timed ? P.warmup : null }); used.add(WARMUP); }

  // reviews due (oldest due first)
  const due = visible.filter(l => isReviewDue(lp[l.id], day) && !used.has(l.id))
    .sort((a, b) => (lp[a.id].next_review_day! < lp[b.id].next_review_day! ? -1 : 1)).slice(0, P.maxReviews);
  for (const l of due) { items.push({ kind: 'review', lessonId: l.id, title: `Review: ${l.title}`, why: 'Quick check so it sticks', minutes: timed ? P.review : null }); used.add(l.id); }

  // current lessons: passed-once first (finish what you started), then in progress, then the next one, by track order
  const tracks = [...cat.tracks].sort((a, b) => a.order - b.order).filter(t => q.visibleTrack(t.id));
  const rank = (l: Lesson) => (lp[l.id]?.first_pass_day ? 0 : states[l.id] === 'in_progress' ? 1 : 2);
  const pick = (t: string): Lesson | undefined => {
    const inTrack = visible.filter(l => l.track === t && !used.has(l.id) && states[l.id] !== 'locked' && states[l.id] !== 'passed' && lp[l.id]?.first_pass_day !== day);
    return inTrack.sort((a, b) => rank(a) - rank(b))[0];
  };
  const cands = tracks.map(t => pick(t.id)).filter((l): l is Lesson => !!l).sort((a, b) => rank(a) - rank(b)).slice(0, P.maxLessons);
  for (const l of cands) used.add(l.id);

  // ear quiz (20 min) when unlocked
  const ear = P.ear ? EAR.map(L).find(l => l && states[l.id] !== 'locked' && q.visibleTrack(l.track) && !used.has(l.id)) : undefined;

  const fixed = items.reduce((a, i) => a + (i.minutes || 0), 0) + (ear ? P.ear : 0);
  const left = Math.max(cands.length * 3, P.total - fixed);
  cands.forEach((l, i) => {
    const m = timed ? Math.floor(left / cands.length) + (i < left % cands.length ? 1 : 0) : null;
    items.push({ kind: 'lesson', lessonId: l.id, title: l.title, why: lp[l.id]?.first_pass_day ? 'Passed once on an earlier day: pass it today to complete it' : states[l.id] === 'in_progress' ? 'Keep going' : 'Next up', minutes: m });
  });
  if (ear) items.push({ kind: 'ear', lessonId: ear.id, title: `Ear training: ${ear.title}`, why: 'Two minutes of listening', minutes: P.ear });
  return items;
}

/** Small deterministic hash, so "random" picks stay put for the whole day. */
export function dayHash(str: string): number { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- song of the week ----------
// One song per week, picked at random from the church song list, rolling over Monday 12:01 am Central.
export const WEEK_TZ = 'America/Chicago';
/** Date (YYYY-MM-DD) of the Monday that starts the song week containing `now`, in Central time. */
export function songWeekStart(now: Date): string {
  const t = new Date(now.getTime() - 60_000); // 12:00–12:00:59 am Monday still belongs to last week
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: WEEK_TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(t).map(x => [x.type, x.value]));
  const back = ({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 } as Record<string, number>)[p.weekday];
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day - back));
  return d.toISOString().slice(0, 10);
}
/** Random but fixed for the week. The list is shuffled into a random order and walked one song per week, so
 *  every song gets a turn before any repeats; each pass reshuffles, and a pass never starts with the song that
 *  ended the previous one. */
export function songOfWeek(pool: string[], now: Date): string | null {
  const ids = [...new Set(pool)].sort(), n = ids.length;
  if (!n) return null;
  const w = Math.round((Date.parse(songWeekStart(now) + 'T12:00:00Z') - Date.parse('2024-01-01T12:00:00Z')) / (7 * 86400000)); // 2024-01-01 is a Monday
  const order = (cycle: number) => {
    const a = [...ids]; let h = dayHash('song-cycle|' + cycle + '|' + ids.join(','));
    for (let i = n - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 13), 1597334677) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const cycle = Math.floor(w / n), o = order(cycle);
  if (n > 1 && cycle > 0 && o[0] === order(cycle - 1)[n - 1]) [o[0], o[1]] = [o[1], o[0]];
  return o[((w % n) + n) % n];
}
/** The pool: songs on a set list saved on this phone (older installs), else the catalog's weekly pool, else all outlines with lessons. */
export function songPool(q: Pick<QueueInput, 'cat' | 'setlist'>): { ids: string[]; fromList: boolean } {
  const has = (id: string | null): id is string => !!id && q.cat.outlines.some(o => o.id === id);
  const list = q.setlist ? q.setlist.songs.map(s => s.outlineId).filter(has) : [];
  if (list.length) return { ids: list, fromList: true };
  const weekly = q.cat.outlines.filter(o => o.weekly_pool).map(o => o.id);
  if (weekly.length) return { ids: weekly, fromList: true };
  return { ids: q.cat.outlines.filter(o => o.practice_for.length).map(o => o.id), fromList: false };
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
