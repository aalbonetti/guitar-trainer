// Daily Challenge screens (07-games.md §4): the banner (Arcade home and Today) and the challenge page. The mix is
// built once a day from your weak spots (daily.ts) and stays the same all day.
import { useEffect, useState } from 'preact/hooks';
import type { Catalog, Game, GameLevel } from '../catalog';
import { useStore } from '../store';
import * as db from '../db';
import { daily, loadDaily, refreshDaily, buildDaily, DAILY_MINUTES, type DailyItem } from '../daily';
import { progress } from '../progressStore';
import { computeStates, isReviewDue, dayOf } from '../progress';
import { bests, bestStars, loadBests, modeFor, unlocked } from '../arcade';
import { heatCells, hardSpots, type HeatRow } from '../heat';
import type { Pos } from '../games/core';

/** Build (first open of the day) or load today's challenge. `visible`: the tracks shown for your instrument. */
export async function ensureDaily(cat: Catalog, visible: (track: string) => boolean) {
  const day = dayOf();
  if (daily.get().day === day) { await refreshDaily(); return; }
  if (!bests.get().ready) await loadBests();
  await loadDaily(day, async () => {
    const lp = progress.get().lp, states = computeStates(cat.lessons, cat.tracks, lp);
    let quiz: HeatRow[] = [], atts: { lesson_id: string; criterion_type: string; metrics_json: string }[] = [], runs: { game_id: string; extra_json?: string | null }[] = [];
    try { quiz = await db.getAll('quiz_item_stats'); atts = await db.getAll('attempt'); runs = await db.getAll('game_run'); } catch { /* storage unavailable */ }
    // chord changes: one-minute lesson attempts (perMin per pair) and Change Sprint rounds, best rate ÷ goal per pair
    const best = new Map<string, { refs: string[]; ratio: number }>();
    const note = (refs: string[], ratio: number) => { const k = [...refs].map(r => r.split('|')[0]).sort().join('+'); const b = best.get(k); if (!b || ratio > b.ratio) best.set(k, { refs, ratio }); };
    for (const a of atts) if (a.criterion_type === 'changes_per_min') {
      const target = (cat.lessonById[a.lesson_id]?.pass_criteria.target as number) || 30;
      try { for (const c of (JSON.parse(a.metrics_json).changes || []) as { pair: string; perMin: number }[]) note(c.pair.split('↔'), c.perMin / target); } catch { /* ignore */ }
    }
    for (const r of runs) if (r.game_id === 'G_change_sprint' && r.extra_json) try { const x = JSON.parse(r.extra_json); if (x.refs && x.target) note(x.refs, x.perMin / x.target); } catch { /* ignore */ }
    const stars: Record<string, number> = {};
    for (const g of cat.games) for (const l of g.levels) stars[`${g.id}|${l.id}`] = bestStars(g, l);
    return buildDaily({
      day, games: cat.games, lessons: cat.lessons, quizzes: cat.quizzes,
      open: (g, l) => unlocked(cat, g, l), modeOf: g => modeFor(g), lessonOpen: id => states[id] !== 'locked',
      quizMisses: quiz.filter(q => q.quiz_id.startsWith('Q_')),
      due: cat.lessons.filter(l => visible(l.track) && isReviewDue(lp[l.id], day)).sort((a, b) => (lp[a.id].next_review_day! < lp[b.id].next_review_day! ? -1 : 1)).map(l => l.id),
      hard: hardSpots(heatCells(quiz)).map(c => ({ string: c.string, fret: c.fret })),
      changes: [...best.values()], stars,
    });
  });
}
/** Focus spots for a Daily Challenge round (Note Drop / Fret Finder ask those notes more often). */
export function dailyFocus(g: Game, l: GameLevel): Pos[] {
  return daily.get().items.find(i => i.game === g.id && i.level === l.id)?.focus || [];
}
const href = (i: DailyItem) => (i.kind === 'game' ? `#/arcade/${i.game}/${i.level}/daily` : `#/lesson/${i.lesson}`);

/** Today's challenge, kept current: loaded when progress is ready, when the date changes with the screen still
 *  open, and rechecked when the app comes back to the screen. Returns today's date. */
function useDaily(cat: Catalog, visible: (track: string) => boolean): string {
  const ready = useStore(progress).ready;
  const [now, setNow] = useState(() => ({ day: dayOf(), resumed: 0 }));
  useEffect(() => {
    const resume = () => { if (document.visibilityState === 'visible') setNow(n => ({ day: dayOf(), resumed: n.resumed + 1 })); };
    const timer = setInterval(() => setNow(n => (n.day === dayOf() ? n : { ...n, day: dayOf() })), 30_000);
    document.addEventListener('visibilitychange', resume);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, []);
  useEffect(() => { if (ready) void ensureDaily(cat, visible); }, [ready, now.day, now.resumed]);
  return now.day;
}

export function DailyBanner({ cat, visible }: { cat: Catalog; visible: (track: string) => boolean }) {
  const d = useStore(daily), today = useDaily(cat, visible);
  if (d.day < today || !d.items.length) return null;
  const n = d.done.filter(Boolean).length;
  return (
    <a class="card tap-card dailybanner" href="#/daily" aria-label="Daily Challenge">
      <h2>🎯 Daily Challenge <span class="chev" aria-hidden="true">›</span></h2>
      <p>{d.completed ? <b class="okText">Done for today ✓ +30 XP</b> : <><b>{n} of {d.items.length} done</b> <span class="muted">· about {DAILY_MINUTES} minutes from your weak spots</span></>}</p>
      <div class="dailydots">{d.done.map(x => <i class={x ? 'on' : ''} />)}</div>
    </a>
  );
}

export function DailyPage({ cat, visible }: { cat: Catalog; visible: (track: string) => boolean }) {
  const d = useStore(daily), today = useDaily(cat, visible);
  const name = (i: DailyItem) => i.kind === 'game' ? cat.games.find(g => g.id === i.game)?.name : cat.lessonById[i.lesson!]?.title;
  return (
    <div class="page">
      <div class="crumbs"><a href="#/arcade">Arcade</a> › Daily Challenge</div>
      <h1>🎯 Daily Challenge</h1>
      {d.day < today ? <p class="muted">Building today’s mix…</p> : (
        <section class="card">
          <p class="muted">{d.items.length} rounds, about {DAILY_MINUTES} minutes, picked from your weak spots: misses in quizzes and games, hard spots on the neck, your slowest chord changes and reviews due. It stays the same all day. Finish them all for +30 XP.</p>
          {d.completed ? <p class="note">✓ Done for today. +30 XP{d.justCompleted ? ' just added' : ''}.</p> : null}
          <ol class="dailylist">{d.items.map((it, i) => (
            <li class={d.done[i] ? 'done' : ''}>
              <a href={href(it)}><b>{d.done[i] ? '✓ ' : ''}{it.title || name(it)}</b>
                <small class="muted">{it.why} · ~{it.minutes} min{it.mode ? ` · ${it.mode === 'play' ? '🎸 play' : '👆 tap'}` : ''}</small></a>
            </li>))}</ol>
        </section>)}
    </div>
  );
}
