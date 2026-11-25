// Daily Challenge (07-games.md §4): a 10-minute mix built from your weak spots: misses in `quiz_item_stats`,
// hard spots on the fretboard heatmap, your slowest chord changes and lessons whose reviews are due. It's built
// the first time it's opened on a day and stored (IndexedDB `daily_challenge`, day PK), so it stays the same
// all day. Finishing every item gives +30 XP once. `buildDaily` is pure (unit-tested).
import * as db from './db';
import { Store } from './store';
import { addXp } from './xp';
import { XP, rng, shuffle, type Pos } from './games/core';
import { dayHash } from './practice';
import type { Game, GameLevel, Lesson, Quiz } from './catalog';

export type DMode = 'tap' | 'play';
export interface DailyItem { kind: 'game' | 'lesson'; game?: string; level?: string; mode?: DMode; lesson?: string; minutes: number; title: string; why: string; focus?: Pos[] }
export interface DailyInput {
  day: string; games: Game[]; lessons: Lesson[]; quizzes: Quiz[];
  /** the level is open to play (level 1, or ★★ on the one before) */
  open: (g: Game, l: GameLevel) => boolean;
  modeOf: (g: Game) => DMode;
  /** lesson can be attempted (not locked) */
  lessonOpen: (id: string) => boolean;
  quizMisses: { quiz_id: string; item_key: string; seen: number; correct: number }[];
  /** lessons with a review due today (visible tracks), oldest first */
  due: string[];
  /** heatmap hard spots, worst first */
  hard: Pos[];
  /** chord changes: refs of the pair (or cycle) and your best rate ÷ its goal */
  changes: { refs: string[]; ratio: number }[];
  /** best stars per `game|level` (any mode) for the filler pick */
  stars: Record<string, number>;
}
export const DAILY_MINUTES = 10, DAILY_MAX_ITEMS = 4;
/** Song Run is a boss level (up to 3 minutes of one song), so it's never part of the mix. */
const SKIP = new Set(['G_song_run']);
const base = (r: string) => r.split('|')[0];
const inZone = (p: Pos, l: GameLevel) => { const z = l.params.zone; return !!z && z.strings.includes(p.string) && p.fret >= z.frets[0] && p.fret <= z.frets[1]; };

/** Rough minutes for one round: its timer plus a minute to get set; lives/click rounds about 2–3. */
export function itemMinutes(_g: Game, l: GameLevel): number {
  if (l.round_s) return Math.ceil(l.round_s / 60) + 1;
  if (l.lives) return 2;
  return 3;
}

export function buildDaily(q: DailyInput): DailyItem[] {
  const r = rng(dayHash('daily:' + q.day));
  const items: DailyItem[] = [];
  const used = new Set<string>();
  const levelsOf = (g: Game) => g.levels.filter(l => q.open(g, l));
  const add = (g: Game, l: GameLevel, why: string, focus?: Pos[]) => {
    const k = `${g.id}|${l.id}`; if (used.has(k) || SKIP.has(g.id)) return false;
    used.add(k);
    items.push({ kind: 'game', game: g.id, level: l.id, mode: q.modeOf(g), minutes: itemMinutes(g, l), title: `${g.name}: ${l.name}`, why, ...(focus?.length ? { focus } : {}) });
    return true;
  };
  const G = (id: string) => q.games.find(g => g.id === id);

  // 1. Fretboard hard spots (heatmap + the note-name quiz's misses): Note Drop, else Fret Finder, on a level
  //    whose zone holds most of them; those notes come up more often.
  const quizSpots = q.quizMisses.filter(m => m.quiz_id === 'Q_note_names' && m.seen > m.correct)
    .sort((a, b) => (b.seen - b.correct) - (a.seen - a.correct)).map(m => /^s(\d)f(\d+)$/.exec(m.item_key)).filter(Boolean).map(m => ({ string: +m![1], fret: +m![2] }));
  const spots = [...q.hard, ...quizSpots].filter((p, i, a) => a.findIndex(x => x.string === p.string && x.fret === p.fret) === i).slice(0, 8);
  if (spots.length) {
    for (const id of ['G_note_drop', 'G_fret_finder']) {
      const g = G(id); if (!g) continue;
      const l = levelsOf(g).map(l => ({ l, n: spots.filter(p => inZone(p, l)).length })).filter(x => x.n).sort((a, b) => b.n - a.n)[0]?.l;
      if (l && add(g, l, `Hard spots on the neck: ${spots.filter(p => inZone(p, l)).slice(0, 3).map(p => `string ${p.string} fret ${p.fret}`).join(', ')}`, spots.filter(p => inZone(p, l)))) break;
    }
  }
  // 2. Quiz misses: the game that drills that lesson (Call the Number for T.03, Capo Quick for T.04, …)
  const byQuiz = new Map<string, number>();
  for (const m of q.quizMisses) if (m.quiz_id !== 'Q_note_names' && m.quiz_id.startsWith('Q_') && m.seen > m.correct) byQuiz.set(m.quiz_id, (byQuiz.get(m.quiz_id) || 0) + m.seen - m.correct);
  for (const [qid, n] of [...byQuiz.entries()].sort((a, b) => b[1] - a[1])) {
    const lesson = q.quizzes.find(x => x.id === qid)?.lesson; if (!lesson) continue;
    for (const g of q.games) {
      const l = levelsOf(g).filter(l => (l.review_for || []).includes(lesson) || (!l.review_for && g.review_for.includes(lesson))).pop();
      if (l && add(g, l, `${n} miss${n > 1 ? 'es' : ''} in the ${q.lessons.find(x => x.id === lesson)?.title ?? lesson} quiz`)) break;
    }
    if (items.length >= 2) break;
  }
  // 3. Slowest chord changes: the Change Sprint level with those chords
  const cs = G('G_change_sprint');
  if (cs) for (const c of [...q.changes].filter(c => c.ratio < 1).sort((a, b) => a.ratio - b.ratio)) {
    const want = new Set(c.refs.map(base));
    const l = levelsOf(cs).find(l => { const cy = new Set((l.params.cycle as string[]).map(base)); return [...want].every(x => cy.has(x)) && (cy.size === want.size || want.size < 2); });
    if (l && add(cs, l, `Your slowest changes: ${Math.round(c.ratio * 100)}% of the goal`)) break;
  }
  // 4. Reviews due: a game round counts for quiz lessons (★★); others go to the lesson
  for (const id of q.due) {
    if (items.length >= DAILY_MAX_ITEMS) break;
    const lesson = q.lessons.find(x => x.id === id); if (!lesson) continue;
    let done = false;
    if (lesson.pass_criteria.type === 'quiz') for (const g of q.games) {
      const l = levelsOf(g).find(l => (l.review_for || []).includes(id));
      if (l && add(g, l, `Review due: ${lesson.title} (★★ counts as the review)`)) { done = true; break; }
    }
    if (!done && q.lessonOpen(id) && !used.has(`lesson|${id}`)) {
      used.add(`lesson|${id}`);
      items.push({ kind: 'lesson', lesson: id, minutes: 3, title: `Review: ${lesson.title}`, why: 'Review due today' });
    }
  }
  // 5. Fill with open levels you haven't mastered yet (fewest stars first; ties picked by the day)
  const fill = shuffle(r, q.games.filter(g => !SKIP.has(g.id)).flatMap(g => levelsOf(g).map(l => ({ g, l, s: q.stars[`${g.id}|${l.id}`] || 0 }))))
    .filter(x => x.s < 3).sort((a, b) => a.s - b.s);
  for (const x of fill) { if (items.length >= DAILY_MAX_ITEMS || total(items) >= DAILY_MINUTES - 1) break; add(x.g, x.l, x.s ? `Best so far ${'★'.repeat(x.s)}: go for more` : 'Something new to try'); }

  // keep it to 10 minutes: drop items that don't fit, then share out what's left
  const out: DailyItem[] = [];
  for (const it of items) if (out.length < DAILY_MAX_ITEMS && total(out) + it.minutes <= DAILY_MINUTES) out.push(it);
  for (let i = 0; out.length && total(out) < DAILY_MINUTES; i = (i + 1) % out.length) out[i].minutes++;
  return out;
}
const total = (a: DailyItem[]) => a.reduce((s, x) => s + x.minutes, 0);

/** Is each item done? A game item: a round of that level finished since the challenge was made. A lesson item:
 *  an attempt at that lesson since then. */
export function dailyDone(items: DailyItem[], since: number, runs: { game_id: string; level_id: string; at: number }[], attempts: { lesson_id: string; at: number }[]): boolean[] {
  return items.map(it => it.kind === 'game' ? runs.some(r => r.game_id === it.game && r.level_id === it.level && r.at >= since)
    : attempts.some(a => a.lesson_id === it.lesson && a.at >= since));
}

// ---------- stored challenge ----------
export interface DailyRow { day: string; items_json: string; created_at: number; completed_at?: number | null }
/** Today's challenge (day '' = not loaded yet). */
export const daily = new Store<{ day: string; items: DailyItem[]; done: boolean[]; created: number; completed: number | null; justCompleted: boolean }>({ day: '', items: [], done: [], created: 0, completed: null, justCompleted: false });
/** Load today's challenge, building and saving it on the first open of the day. */
let loading: { day: string; p: Promise<void> } | null = null;
export function loadDaily(day: string, build: () => Promise<DailyItem[]>): Promise<void> {
  if (loading?.day === day) return loading.p;
  // a load for another day (opened just before midnight) finishes first, so it can't replace this one
  const before = loading ? loading.p.catch(() => undefined) : Promise.resolve();
  const p: Promise<void> = before.then(() => loadNow(day, build)).finally(() => { if (loading?.p === p) loading = null; });
  loading = { day, p };
  return p;
}
async function loadNow(day: string, build: () => Promise<DailyItem[]>) {
  let row: DailyRow | undefined;
  try { row = await db.get<DailyRow>('daily_challenge', day); } catch { /* storage unavailable */ }
  if (!row) {
    row = { day, items_json: JSON.stringify(await build()), created_at: Date.now(), completed_at: null };
    try { await db.put('daily_challenge', row); } catch { /* ignore */ }
  }
  let items: DailyItem[] = []; try { items = JSON.parse(row.items_json); } catch { /* ignore */ }
  daily.set({ day, items, done: items.map(() => false), created: row.created_at, completed: row.completed_at ?? null, justCompleted: false });
  await refreshDaily();
}
/** Recheck which items are done; on the first time all are, mark it complete and add the XP. Calls run one at a
 *  time (the banner and the page can both ask at once), so the XP is added once. A call queued for a challenge
 *  that has since been replaced by another day's is dropped. */
let chain: Promise<void> = Promise.resolve();
export function refreshDaily(): Promise<void> {
  const day = daily.get().day, run = () => refreshNow(day);
  chain = chain.then(run, run);
  return chain;
}
/** The day whose completion and XP are both known to be saved: nothing left to check. */
let settled = '';
async function refreshNow(day: string) {
  const d = daily.get(); if (!day || d.day !== day || (d.completed && settled === day)) return;
  let row: DailyRow | undefined;
  try { row = await db.get<DailyRow>('daily_challenge', day); } catch { /* storage unavailable */ }
  let completed = row?.completed_at || d.completed, just = false, done = d.items.map(() => true);
  if (!completed) { // a completed challenge needs no scan of every run and attempt
    let runs: { game_id: string; level_id: string; at: number }[] = [], atts: { lesson_id: string; at: number }[] = [];
    try { runs = await db.getAll('game_run'); atts = await db.getAll('attempt'); } catch { /* ignore */ }
    done = dailyDone(d.items, d.created, runs, atts);
  }
  try {
    if (!completed && row && d.items.length && done.every(Boolean)) { completed = Date.now(); just = true; await db.put('daily_challenge', { ...row, completed_at: completed }); }
    // the +30 XP goes with completion; if the app was closed between the two writes, it's added on the next check
    if (completed) {
      if ((await db.getAll<{ source: string; ref_id: string }>('xp_ledger')).some(x => x.source === 'daily' && x.ref_id === day)) settled = day;
      else await addXp('daily', day, XP.daily);
    }
  } catch { /* storage unavailable */ }
  if (daily.get().day !== day) return;
  daily.set({ ...d, done, completed, justCompleted: just || d.justCompleted });
}
