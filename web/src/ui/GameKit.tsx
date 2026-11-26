// Pieces shared by every Arcade game (07-games.md §3, §6): the round (score, combo, lives, timer, misses,
// pause-aware clock), the tap fretboard, and the play-mode hooks that open the mic and check what you play.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { GameLevel } from '../catalog';
import { points, pointsWith, newTally, scoreStep, type Pos, type Zone } from '../games/core';
import { openEars, closeEars, ears, heardSince, strumsSince, now as ctxNowS, publishExpect, publishChordExpect } from '../games/listen';
import { verifyChord, type ChordTarget, type ChordVerdict } from '../grading/chord';
import { judgeAnswer, type AnswerCheck, type Heard } from '../games/judge';
import { useStore } from '../store';
import { audioContext, isSim } from '../audio/engine';
import type { Mode } from '../arcade';

export const Stars = ({ n }: { n: number }) => <span class="stars">{[1, 2, 3].map(i => <i class={i <= n ? 'on' : ''}>★</i>)}</span>;

// ---------- small hooks ----------
/** Re-render every `ms` while `on` (question timeouts). */
export function useTick(on: boolean, ms: number) { const [, set] = useState(0); useEffect(() => { if (!on) return; const t = setInterval(() => set(x => x + 1), ms); return () => clearInterval(t); }, [on]); }
/** Output latency: how long after its scheduled time a click is heard (beat lights). */
export const lagS = () => { const c = audioContext(); return c.outputLatency || c.baseLatency || 0; };

// ---------- the round ----------
export interface Round {
  score: number; streak: number; maxCombo: number; correct: number; total: number; lives: number; misses: string[];
  flash: 'ok' | 'bad' | null; elapsed: number; paused: boolean; mode: Mode;
  /** A right/wrong answer; points from the response time (fast…slow ms → bonus 2.0…1.0). */
  answer: (ok: boolean, miss?: string, fastMs?: number, slowMs?: number) => void;
  /** A right/wrong answer with an explicit bonus (click-timed games: how close to the beat). */
  answerWith: (ok: boolean, bonus: number, miss?: string) => void;
  addMisses: (n: number, miss: string) => void;
  /** Game clock (ms): stops while paused and, in play mode, until the mic is open. Question timers use it. */
  now: () => number;
  askedAt: { current: number };
  /** Click-timed games end the round themselves (finished = played to the end). */
  finish: (finished: boolean) => void;
  /** Longest run of right answers so far. */
  bestStreak: number;
  /** Game-specific detail saved with the run (keys called, box position, Gap Click landings). */
  extra: { current: Record<string, any> };
  /** Assisted mode (chord games): the last answer was marked wrong but you played it right: count it. */
  overrideLast: () => boolean;
  /** Can the last answer be overridden (it was a miss and nothing came after it)? */
  canOverride: boolean;
}
/** Test-only: shorter rounds for headless tests (`__gtGameShortS`). */
export const shortRound = (s?: number) => { const x = isSim() ? (globalThis as any).__gtGameShortS as number | undefined : undefined; return s && x ? Math.min(s, x) : s; };
/** Test-only (`?sim`): fewer bars in click-timed rounds (`__gtGameShortBars`). */
export const shortBars = (): number | undefined => (isSim() ? (globalThis as any).__gtGameShortBars : undefined);

/** `hold`: the round isn't running yet (play mode waiting for the mic), so the clock stands still. */
export function useRound(l: GameLevel, mode: Mode, base: number, paused: boolean, onEnd: (finished: boolean) => void, finishedRule: (correct: number, timeUp: boolean) => boolean, hold = false) {
  const [st, setSt] = useState(() => ({ ...newTally(), lives: l.lives || 0 }));
  const [flash, setFlash] = useState<'ok' | 'bad' | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const roundS = shortRound(l.round_s);
  // game clock: wall time minus time spent stopped (paused, or on hold)
  const stopped = paused || hold;
  const pausedMs = useRef(0), pausedAt = useRef<number | null>(null), t0 = useRef(performance.now());
  const now = () => performance.now() - t0.current - pausedMs.current - (pausedAt.current !== null ? performance.now() - pausedAt.current : 0);
  if (stopped && pausedAt.current === null) pausedAt.current = performance.now();
  if (!stopped && pausedAt.current !== null) { pausedMs.current += performance.now() - pausedAt.current; pausedAt.current = null; }
  const askedAt = useRef(0), ended = useRef(false), ghost = useRef<[number, number][]>([]);
  // The round's numbers live in a ref and change synchronously, so several answers in one tick (notes settling in
  // a click-timed game) each see the combo the one before left; the state copy is just for rendering.
  const stRef = useRef(st);
  const extra = useRef<Record<string, any>>({});
  // the state before the last answer and how that answer would have scored if right (assisted override)
  const undo = useRef<{ before: typeof st; pts: (streak: number) => number } | null>(null);
  const [canOverride, setCanOverride] = useState(false);
  const stoppedRef = useRef(stopped); stoppedRef.current = stopped;
  const end = (finished: boolean) => { if (ended.current) return; ended.current = true; onEnd(finished); };
  useEffect(() => {
    const t = setInterval(() => {
      if (stoppedRef.current) return;
      // whole seconds are all the HUD and ghost show, so the frame re-renders once a second, not ten times
      const e = now() / 1000; setElapsed(Math.floor(e));
      const sec = Math.floor(e); if (!ghost.current.length || ghost.current[ghost.current.length - 1][0] < sec) ghost.current.push([sec, stRef.current.score]);
      if (roundS && e >= roundS) end(finishedRule(stRef.current.correct, true));
    }, 100);
    return () => clearInterval(t);
  }, []);
  const flashT = useRef(0);
  const apply = (ok: boolean, pts: (streak: number) => number, miss?: string) => {
    if (ended.current) return;
    const s = stRef.current;
    const n = { ...scoreStep(s, ok, pts, miss), lives: ok || !l.lives ? s.lives : s.lives - 1 };
    undo.current = ok ? null : { before: s, pts }; setCanOverride(!ok);
    stRef.current = n; setSt(n);
    if (l.lives && n.lives <= 0) setTimeout(() => end(finishedRule(n.correct, false)), 350);
    setFlash(ok ? 'ok' : 'bad'); clearTimeout(flashT.current); flashT.current = window.setTimeout(() => setFlash(null), 250);
    askedAt.current = now();
  };
  const answer: Round['answer'] = (ok, miss, fastMs, slowMs) => { const ms = now() - askedAt.current; apply(ok, k => points(ms, k, fastMs, slowMs), miss); };
  const answerWith: Round['answerWith'] = (ok, bonus, miss) => apply(ok, k => pointsWith(bonus, k, base), miss);
  const overrideLast = () => {
    const u = undo.current; if (!u || ended.current) return false;
    undo.current = null; setCanOverride(false);
    const n = scoreStep(u.before, true, u.pts); // lives too are as before the miss
    stRef.current = n; setSt(n); setFlash('ok');
    return true;
  };
  const addMisses = (n: number, miss: string) => { if (n <= 0 || ended.current) return; undo.current = null; setCanOverride(false); let x = stRef.current; for (let i = 0; i < n; i++) x = scoreStep(x, false, () => 0, miss); stRef.current = x; setSt(x); };
  const round: Round = { ...st, flash, elapsed, paused, mode, answer, answerWith, addMisses, now, askedAt, finish: end, extra, overrideLast, canOverride };
  return { round, ghost, durationS: () => now() / 1000, stRef, roundS, extra };
}

// ---------- fretboard ----------
export function Fretboard({ zone, onTap, marks = [], frets, tappable = true }: { zone: Zone; onTap?: (p: Pos) => void; marks?: { p: Pos; cls: string }[]; frets?: [number, number]; tappable?: boolean }) {
  const [f0, f1] = frets || zone.frets;
  const n = f1 - f0 + 1, W = 340, H = 186, left = 6, cw = (W - left - 4) / n, rh = H / 6;
  const x = (f: number) => left + (f - f0) * cw, y = (s: number) => (s - 1) * rh + rh / 2;
  const inZone = (p: Pos) => zone.strings.includes(p.string) && p.fret >= zone.frets[0] && p.fret <= zone.frets[1];
  const cells: Pos[] = []; for (let s = 1; s <= 6; s++) for (let f = f0; f <= f1; f++) cells.push({ string: s, fret: f });
  return (
    <svg class="fretboard" viewBox={`0 0 ${W} ${H + 18}`} width="100%" role="group" aria-label={tappable ? 'Fretboard: tap a string and fret' : 'Fretboard'}>
      {cells.filter(inZone).map(p => <rect x={x(p.fret)} y={(p.string - 1) * rh} width={cw} height={rh} class="zone" />)}
      {Array.from({ length: n + 1 }, (_, i) => <line x1={left + i * cw} x2={left + i * cw} y1={rh / 2} y2={H - rh / 2} class={i === 1 && f0 === 0 ? 'nut' : 'fret'} />)}
      {[1, 2, 3, 4, 5, 6].map(s => <line x1={left} x2={W - 4} y1={y(s)} y2={y(s)} class={`str ${zone.strings.includes(s) ? '' : 'off'}`} style={{ strokeWidth: 0.6 + (s - 1) * 0.35 }} />)}
      {[3, 5, 7, 9, 12, 15].filter(f => f >= f0 && f <= f1 && f > 0).map(f => <text x={x(f) + cw / 2} y={H + 13} class="fno">{f}</text>)}
      {f0 === 0 ? <text x={x(0) + cw / 2} y={H + 13} class="fno">0</text> : null}
      {marks.map(m => <circle key={`${m.p.string}:${m.p.fret}:${m.cls}`} cx={x(m.p.fret) + cw / 2} cy={y(m.p.string)} r={Math.min(cw, rh) * 0.36} class={`mark ${m.cls}`} />)}
      {tappable && onTap ? cells.filter(inZone).map(p => <rect x={x(p.fret)} y={(p.string - 1) * rh} width={cw} height={rh} class="hit" data-s={p.string} data-f={p.fret} onPointerDown={e => { e.preventDefault(); onTap(p); }} />) : null}
    </svg>
  );
}
export const zoneOf = (l: GameLevel): Zone => ({ strings: l.params.zone.strings, frets: l.params.zone.frets });
export const posText = (p: Pos) => `string ${p.string}, fret ${p.fret}`;

// ---------- play mode ----------
/** Open the mic while `active` (play mode and not paused); close it on pause, quit and the end of the round. */
export function useEars(active: boolean, midis: number[]) {
  const e = useStore(ears);
  const openedAt = useRef(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void openEars(midis).then(ok => { if (ok && live) openedAt.current = ctxNowS(); });
    return () => { live = false; closeEars(); };
  }, [active]);
  return { ...e, openedAt };
}
/** Poll what you play against the question's expected answer. `check()` returns the current question's
 *  expected notes (or null between questions); `onHeard` gets each decision once. */
export function useHeard(active: boolean, openedAt: { current: number }, check: () => AnswerCheck | null, onHeard: (h: Heard) => void) {
  const seen = useRef(new Set<number>()), lastSince = useRef(-1);
  const cb = useRef(onHeard); cb.current = onHeard;
  const ck = useRef(check); ck.current = check;
  useEffect(() => {
    if (!active) { publishExpect(null); return; }
    const t = setInterval(() => {
      const c = ck.current();
      publishExpect(c ? { right: c.right, neutral: c.neutral } : null);
      if (!c || !openedAt.current) return;
      if (c.since !== lastSince.current) { lastSince.current = c.since; seen.current = new Set(); }
      const since = Math.max(c.since, openedAt.current);
      const h = judgeAnswer(heardSince(since), { ...c, since }, ctxNowS(), seen.current);
      if (h) {
        if (isSim()) { const log = ((globalThis as any).__gtHeardLog ||= []) as unknown[]; // test diagnostics: what was decided against what
        log.push({ at: +ctxNowS().toFixed(3), since: +since.toFixed(3), right: c.right, kind: h.kind, heard: h.heard, t0: +h.t0.toFixed(3) }); if (log.length > 50) log.shift(); }
        cb.current(h);
      }
    }, 60);
    return () => { clearInterval(t); publishExpect(null); };
  }, [active]);
}
/** "Hearing D3 +4¢" read-out for play mode. */
export function Hearing({ e }: { e: { on: boolean; opening: boolean; hearing: string | null; cents: number | null; error: string | null } }) {
  if (e.error) return <p class="error small">Microphone: {e.error}</p>;
  if (!e.on) return <p class="readline muted">{e.opening ? 'Opening the mic…' : 'Mic off'}</p>;
  const c = e.cents === null ? null : Math.round(e.cents);
  return <p class="readline">Hearing <b>{e.hearing ? e.hearing : '–'}</b>{e.hearing && c !== null ? <small> {c === 0 ? '±0' : (c > 0 ? '+' : '') + c}¢</small> : null}</p>;
}
/** Ask the question at context time "now" (play mode ignores notes that started earlier). */
export const askNow = () => ctxNowS();

// ---------- chord play mode (G3) ----------
/** Open the mic for strums while `active` (play mode and not paused); closed on pause, quit and the end. */
export function useChordEars(active: boolean) {
  const e = useStore(ears);
  const openedAt = useRef(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void openEars([], { chords: true }).then(ok => { if (ok && live) openedAt.current = ctxNowS(); });
    return () => { live = false; closeEars(); };
  }, [active]);
  return { ...e, openedAt };
}
/** After a decided strum, wrong-sounding strums are ignored for this long (the last chord still rings). */
export const CHORD_SETTLE_S = 0.6;
/** …and a strum of the previous answer's chord within this long isn't a wrong answer to the new question. */
export const CHORD_REPEAT_S = 2;
export interface ChordCheck { since: number; expected: ChordTarget; others: ChordTarget[]; sim?: { right: number[]; wrong: number[][]; capo?: number } }
export type StrumHeard = ChordVerdict & { t: number };
/** Verify each new strum against the question's expected chord. Like single notes, a strum is a wrong answer only
 *  when it clearly sounds like another chord the game offers; a muted scrape or an unclear strum is ignored. */
export function useStrumHeard(active: boolean, openedAt: { current: number }, check: () => ChordCheck | null, onHeard: (h: StrumHeard) => void) {
  const seen = useRef(new Set<number>()), lastSince = useRef(-1), lastDecided = useRef(-1e9), prevTarget = useRef<ChordTarget | null>(null);
  const cb = useRef(onHeard); cb.current = onHeard;
  const ck = useRef(check); ck.current = check;
  useEffect(() => {
    if (!active) { publishChordExpect(null); return; }
    const t = setInterval(() => {
      const c = ck.current();
      publishChordExpect(c?.sim ?? null);
      if (!c || !openedAt.current) return;
      if (c.since !== lastSince.current) { lastSince.current = c.since; seen.current = new Set(); }
      for (const s of strumsSince(Math.max(c.since, openedAt.current))) {
        if (seen.current.has(s.t)) continue;
        seen.current.add(s.t);
        const v = verifyChord(s.chroma, c.expected, c.others, undefined, undefined, s.low ?? null);
        if (isSim()) { const log = ((globalThis as any).__gtStrumLog ||= []) as unknown[]; log.push({ t: +s.t.toFixed(3), exp: c.expected.id, heard: v.heard, ok: v.ok, score: +v.score.toFixed(3) }); if (log.length > 50) log.shift(); }
        // Just after a decision, the last chord is still ringing and a second onset inside it (or a slow strum's
        // tail) can show up: within SETTLE_S only a right answer counts, nothing there is a wrong one.
        if (!v.ok && s.t - lastDecided.current < CHORD_SETTLE_S) continue;
        // the chord just heard (right or wrong) again soon after (still ringing, or strummed once more) isn't a new answer
        if (!v.ok && prevTarget.current && s.t - lastDecided.current < CHORD_REPEAT_S && verifyChord(s.chroma, prevTarget.current, c.others, undefined, undefined, s.low ?? null).ok) continue;
        if (v.ok || v.heard !== null) { lastDecided.current = s.t; prevTarget.current = v.ok ? c.expected : c.others.find(o => o.id === v.heard) ?? null; cb.current({ ...v, t: s.t }); return; } // one decision per poll: the question changes after it
      }
    }, 80);
    return () => { clearInterval(t); publishChordExpect(null); };
  }, [active]);
}
/** "Heard: Em ✓" read-out for chord play mode. */
export function HeardChord({ e, last }: { e: { on: boolean; opening: boolean; error: string | null }; last: string | null }) {
  if (e.error) return <p class="error small">Microphone: {e.error}</p>;
  if (!e.on) return <p class="readline muted">{e.opening ? 'Opening the mic…' : 'Mic off'}</p>;
  return <p class="readline">{last ? <b>{last}</b> : <span class="muted">Listening for a strum…</span>}</p>;
}
/** Assisted mode: the app marked the last strum wrong; one tap counts it as right (07-games.md §1, proposed). */
export function OverrideButton({ round, assisted, onOverride }: { round: Round; assisted: boolean; onOverride?: () => void }) {
  if (!assisted || !round.canOverride) return null;
  return <button class="small override" onClick={() => { if (round.overrideLast()) onOverride?.(); }}>✓ I played it right</button>;
}
