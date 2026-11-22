// Today's practice: routine picker + queue, the session bar that follows you across screens, and the summary.
import { useEffect, useRef, useState } from 'preact/hooks';
import { chime, capture } from '../audio/engine';
import type { Catalog } from '../catalog';
import { useStore } from '../store';
import { progress, markPracticed } from '../progressStore';
import { computeStates, dayOf, isReviewDue } from '../progress';
import { getSetList } from '../setlist';
import { buildQueue, totalMinutes, itemHref, session, startSession, endSession, goTo, songLastPref, normRoutine, type Routine, type Item } from '../practice';
import { persisted } from '../store';

const routinePref = persisted<Routine>('gt_routine', 10);
const KIND_ICON: Record<Item['kind'], string> = { warmup: '🔥', review: '↻', lesson: '🎸', song: '♪', ear: '👂' };

export function useQueue(cat: Catalog, routine: Routine, visibleTrack: (id: string) => boolean) {
  const pr = useStore(progress);
  const states = computeStates(cat.lessons, cat.tracks, pr.lp);
  return buildQueue({ cat, lp: pr.lp, states, day: dayOf(), today: new Date(), visibleTrack, setlist: getSetList(), songLast: songLastPref.get() }, routine);
}

/** Number of reviews due today (for the nav badge). */
export function useDueCount(cat: Catalog | null, visibleTrack: (id: string) => boolean) {
  const pr = useStore(progress);
  if (!cat) return 0;
  const day = dayOf();
  return cat.lessons.filter(l => visibleTrack(l.track) && isReviewDue(pr.lp[l.id], day)).length;
}

function QueueList({ items, done, idx }: { items: Item[]; done?: boolean[]; idx?: number }) {
  return (
    <ol class="queue">
      {items.map((it, i) => (
        <li class={`${done?.[i] ? 'done' : ''} ${idx === i ? 'cur' : ''}`}>
          <a href={itemHref(it)} onClick={() => { if (idx !== undefined) goTo(i); }}>
            <i>{done?.[i] ? '✓' : KIND_ICON[it.kind]}</i>
            <span><b>{it.lessonId && it.kind !== 'warmup' ? <span class="lid">{it.lessonId} </span> : null}{it.title}</b>
              <small>{it.why}</small></span>
            {it.minutes ? <em>{it.minutes} min</em> : null}
          </a>
        </li>
      ))}
    </ol>
  );
}

export function PracticeCard({ cat, visibleTrack }: { cat: Catalog; visibleTrack: (id: string) => boolean }) {
  const ss = useStore(session);
  const [routine, setRoutineState] = useState<Routine>(normRoutine(routinePref.get()));
  const setRoutine = (r: Routine) => { setRoutineState(r); routinePref.set(r); };
  const queue = useQueue(cat, routine, visibleTrack);
  const s = ss.s;
  if (s) {
    const left = s.done.filter(d => !d).length;
    return (
      <section class="card practice">
        <h2>Practice in progress <small class="muted">{left ? `${left} to go` : 'all done'}</small></h2>
        <QueueList items={s.items} done={s.done} idx={s.idx}  />
        <div class="row">
          <a class="btn primary" href={itemHref(s.items[s.idx])}>Resume: {s.items[s.idx].title}</a>
          <button onClick={() => void endSession()}>Finish</button>
        </div>
      </section>
    );
  }
  return (
    <section class="card practice">
      {ss.summary ? <Summary /> : null}
      <h2>Today's practice</h2>
      <p class="muted small">Your guided plan for today. Pick how long you have; the app sets the order and the tempo.</p>
      <div class="tabs">
        {([10, 20, 'free'] as Routine[]).map(r => <button class={routine === r ? 'sel' : ''} onClick={() => setRoutine(r)}>{r === 'free' ? 'Free' : `${r} min`}</button>)}
      </div>
      <QueueList items={queue}  />
      {queue.length ? (
        <div class="row between">
          <button class="primary big" onClick={() => { const st = startSession(queue, routine); location.hash = itemHref(st.items[0]); }}>▶ Start practice</button>
          {routine !== 'free' ? <span class="muted">about {totalMinutes(queue)} min</span> : <span class="muted">no timer</span>}
        </div>
      ) : <p class="muted">Nothing queued. Everything visible is passed and no reviews are due: pick anything from the Path.</p>}
    </section>
  );
}

function Summary() {
  const ss = useStore(session);
  const r = ss.summary; if (!r) return null;
  const m = Math.max(1, Math.round(r.total_s / 60));
  return (
    <div class="result pass summary">
      <h3>Nice work: {m} minute{m === 1 ? '' : 's'} today</h3>
      <p>{r.items_done} of {r.items} items · {r.attempts} graded attempt{r.attempts === 1 ? '' : 's'}{r.passes ? ` · ${r.passes} hit the target` : ''}{r.tuned_at ? ' · tuned ✓' : ''}</p>
      <button class="small" onClick={() => session.set({ summary: null })}>Close</button>
    </div>
  );
}

/** Pinned bar while a session runs: where you are, time left on this item, next / end. */
export function SessionBar() {
  const ss = useStore(session);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const cap = useStore(capture);
  const alerted = useRef('');
  const s = ss.s;
  const it = s ? s.items[s.idx] : null;
  const secs = s && it && it.minutes ? it.minutes * 60 - Math.floor((Date.now() - s.itemStart) / 1000) : null;
  // Time's up on this item: chime + buzz once, so you don't have to watch the screen while playing.
  // Never while the mic is open (a graded attempt or the tuner would hear it); it waits until the mic closes.
  const mark = s ? `${s.id}|${s.idx}|${s.itemStart}` : '';
  useEffect(() => {
    if (secs === null || secs > 0 || alerted.current === mark || cap.on) return;
    alerted.current = mark;
    if (secs < -120) return; // came back long after: no point ringing now
    try { chime(); } catch { /* audio not started yet */ }
    try { navigator.vibrate?.([180, 90, 180]); } catch { /* not supported */ }
  }, [secs !== null && secs <= 0, mark, cap.on]);
  if (!s || !it) return null;
  const last = s.idx >= s.items.length - 1;
  const fmt = (x: number) => `${x < 0 ? '+' : ''}${Math.floor(Math.abs(x) / 60)}:${String(Math.abs(x) % 60).padStart(2, '0')}`;
  const next = () => { void markPracticed(); if (last) { goTo(s.idx, true); void endSession(); location.hash = '#/today'; } else { goTo(s.idx + 1, true); location.hash = itemHref(s.items[s.idx + 1]); } };
  return (
    <div class="sessionbar">
      <a href={itemHref(it)} class="where"><small>{s.idx + 1}/{s.items.length}</small> {it.title}</a>
      {secs !== null ? <span class={`timer ${secs <= 0 ? 'over' : ''}`}>{secs <= 0 ? 'time ✓' : fmt(secs)}</span> : null}
      <button class="small" disabled={s.idx === 0} onClick={() => { goTo(s.idx - 1); location.hash = itemHref(s.items[s.idx - 1]); }} aria-label="Previous">‹</button>
      <button class={`small ${secs !== null && secs <= 0 ? 'primary' : ''}`} onClick={next}>{last ? 'Finish' : 'Next ›'}</button>
    </div>
  );
}
