// Arcade (07-games.md): home, shared game frame (score, combo, ghost, timer/lives, results) and the six G1 tap games.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Catalog, Game, GameLevel } from '../catalog';
import { useStore } from '../store';
import { progress } from '../progressStore';
import { xp } from '../xp';
import { bests, bestKey, loadBests, unlocked, finishRun, markService, type RunOutcome } from '../arcade';
import { levelFor, comboMult, points, rng, pick, shuffle, positionsOf, pcAt, noteLabel, pretty, callNumberQ, capoQ, hearQ, delayQ, DELAY_NOTES, type Pos, type Zone, type ChoiceQ, type DelayQ, type Rng } from '../games/core';
import { playChords } from '../audio/engine';
import { dayOf } from '../progress';
import { getSetList, thisWeekSongs } from '../setlist';

const PLAYABLE = new Set(['G_note_drop', 'G_fret_finder', 'G_call_the_number', 'G_hear_the_change', 'G_capo_quick', 'G_delay_math']);
const ICON: Record<string, string> = { G_note_drop: '⬇', G_fret_finder: '🔎', G_call_the_number: '📣', G_hear_the_change: '👂', G_capo_quick: '🎚', G_delay_math: '⏱', G_triad_hunt: '△', G_octave_jump: '⇅', G_box_runner: '▦', G_in_the_pocket: '◎', G_change_sprint: '⚡', G_song_run: '★' };
const Stars = ({ n }: { n: number }) => <span class="stars">{[1, 2, 3].map(i => <i class={i <= n ? 'on' : ''}>★</i>)}</span>;

// ---------- home ----------
export function ArcadeHome({ cat }: { cat: Catalog }) {
  const x = useStore(xp), b = useStore(bests), pr = useStore(progress);
  useEffect(() => { if (!b.ready) void loadBests(); }, []);
  const lv = levelFor(x.total), today = dayOf();
  const sunday = new Date().getDay() === 0, practicedToday = pr.days.includes(today);
  return (
    <div class="page arcade">
      <h1>Arcade</h1>
      <section class="card xpcard">
        <div class="row between"><b>Level {lv.level}</b><span class="muted">{x.total} XP · {lv.need - lv.into} to level {lv.level + 1}</span></div>
        <div class="xpbar"><i style={{ width: `${(lv.into / lv.need) * 100}%` }} /></div>
        <p class="muted small">XP comes from games, lesson passes (+50) and reviews (+20). Levels are just for fun; lessons still unlock in order.</p>
        {sunday || !practicedToday ? <button class="small" disabled={practicedToday} onClick={() => void markService()}>{practicedToday ? 'Today counts ✓' : '⛪ Played a service today'}</button> : null}
      </section>
      <div class="tiles">
        {cat.games.map(g => {
          const open = unlocked(cat, g), playable = PLAYABLE.has(g.id);
          const lesson = cat.lessonById[g.unlock_lesson];
          return (
            <section class={`card tile ${open && playable ? '' : 'dim'}`}>
              <h2><span class="gicon">{ICON[g.id]}</span> {g.name}</h2>
              <p class="muted small">{g.blurb}</p>
              {!playable ? <p class="muted small">Coming later{g.modes.includes('play') && !g.modes.includes('tap') ? ': you play it on the guitar' : ''}.</p>
                : !open ? <p class="muted small">🔒 Opens with <a href={`#/lesson/${g.unlock_lesson}`}>{g.unlock_lesson} {lesson?.title}</a></p>
                  : <ul class="levels">{g.levels.map(l => {
                    const lo = unlocked(cat, g, l), best = b.map[bestKey(g.id, l.id)];
                    return <li>{lo ? <a href={`#/arcade/${g.id}/${l.id}`}><span>{l.name}</span><Stars n={best?.best_stars || 0} />{best ? <small>{best.best_score}</small> : null}</a>
                      : <span class="muted">🔒 {l.name} <small>after {l.unlock_lesson}</small></span>}</li>;
                  })}</ul>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------- shared round state ----------
interface Round {
  score: number; streak: number; maxCombo: number; correct: number; total: number; lives: number; misses: string[];
  answer: (ok: boolean, miss?: string, fastMs?: number, slowMs?: number) => void; addMisses: (n: number, miss: string) => void;
  askedAt: { current: number }; elapsed: number; flash: 'ok' | 'bad' | null;
}
function useRound(l: GameLevel, onEnd: (finished: boolean) => void, running: boolean, finishedRule: (correct: number, timeUp: boolean) => boolean) {
  const [st, setSt] = useState({ score: 0, streak: 0, maxCombo: 1, correct: 0, total: 0, lives: l.lives || 0, misses: [] as string[], flash: null as 'ok' | 'bad' | null });
  const [elapsed, setElapsed] = useState(0);
  const askedAt = useRef(performance.now()), t0 = useRef(performance.now()), ended = useRef(false), ghost = useRef<[number, number][]>([]);
  const stRef = useRef(st); stRef.current = st;
  const end = (timeUp: boolean) => { if (ended.current) return; ended.current = true; onEnd(finishedRule(stRef.current.correct, timeUp)); };
  useEffect(() => {
    if (!running) return;
    t0.current = performance.now(); askedAt.current = performance.now(); ended.current = false;
    const t = setInterval(() => {
      const e = (performance.now() - t0.current) / 1000; setElapsed(e);
      const sec = Math.floor(e); if (!ghost.current.length || ghost.current[ghost.current.length - 1][0] < sec) ghost.current.push([sec, stRef.current.score]);
      if (l.round_s && e >= l.round_s) end(true);
    }, 100);
    return () => clearInterval(t);
  }, [running]);
  const flashT = useRef(0);
  const answer: Round['answer'] = (ok, miss, fastMs, slowMs) => {
    if (ended.current) return;
    const ms = performance.now() - askedAt.current;
    setSt(s => {
      const streak = ok ? s.streak + 1 : 0;
      const n = { ...s, total: s.total + 1, correct: s.correct + (ok ? 1 : 0), streak, maxCombo: Math.max(s.maxCombo, comboMult(streak)),
        score: s.score + (ok ? points(ms, s.streak, fastMs, slowMs) : 0), lives: ok || !l.lives ? s.lives : s.lives - 1,
        misses: ok || !miss ? s.misses : [...s.misses, miss], flash: (ok ? 'ok' : 'bad') as 'ok' | 'bad' };
      stRef.current = n;
      if (l.lives && n.lives <= 0) setTimeout(() => end(false), 350);
      return n;
    });
    clearTimeout(flashT.current); flashT.current = window.setTimeout(() => setSt(s => ({ ...s, flash: null })), 250);
    askedAt.current = performance.now();
  };
  const addMisses = (n: number, miss: string) => { if (n > 0) setSt(s => { const x = { ...s, total: s.total + n, streak: 0, misses: [...s.misses, ...Array(n).fill(miss)] }; stRef.current = x; return x; }); };
  return { round: { ...st, answer, addMisses, askedAt, elapsed } as Round, ghost, end, durationS: () => (performance.now() - t0.current) / 1000, stRef };
}

// ---------- game screen ----------
export function GameScreen({ cat, gameId, levelId }: { cat: Catalog; gameId: string; levelId: string }) {
  const g = cat.games.find(x => x.id === gameId), l = g?.levels.find(x => x.id === levelId);
  useStore(progress); const b = useStore(bests);
  useEffect(() => { if (!b.ready) void loadBests(); }, []);
  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<'ready' | 'play' | 'done'>('ready');
  const [outcome, setOutcome] = useState<(RunOutcome & { score: number; misses: string[] }) | null>(null);
  useEffect(() => { setPhase('ready'); setOutcome(null); }, [gameId, levelId]);
  if (!g || !l) return <div class="page"><p>Game not found. <a href="#/arcade">Arcade</a></p></div>;
  if (!unlocked(cat, g, l) || !PLAYABLE.has(g.id)) return <div class="page"><p>This level isn't open yet. <a href="#/arcade">Back to the Arcade</a></p></div>;
  const best = b.map[bestKey(g.id, l.id)];
  const next = g.levels[g.levels.indexOf(l) + 1];
  return (
    <div class="page game">
      <div class="crumbs"><a href="#/arcade">Arcade</a> › {g.name}</div>
      <h1>{ICON[g.id]} {g.name} <small class="muted">{l.name}</small></h1>
      {phase === 'ready' ? (
        <section class="card">
          <p>{g.blurb}</p>
          <p class="muted">{l.round_s ? `${l.round_s} seconds.` : l.lives ? `${l.lives} lives.` : ''} Faster answers score more; 8 in a row raises the combo. ★★★ = 95% right and {l.target_score} points.{best ? ` Your best: ${best.best_score}.` : ''}</p>
          {(l.review_for || []).length ? <p class="muted small">★★ here counts as the review for {l.review_for!.join(', ')} when it's due.</p> : null}
          <p class="muted small">Tap mode. Playing answers on the guitar arrives with the pitch grader.</p>
          <button class="primary big" onClick={() => { setRunId(x => x + 1); setPhase('play'); }}>▶ Start</button>
        </section>
      ) : phase === 'play' ? (
        <Play key={runId} cat={cat} g={g} l={l} ghost={best?.ghost || []} onDone={async (res) => { const o = await finishRun(cat, g, l, res); setOutcome({ ...o, score: res.score, misses: res.misses }); setPhase('done'); }} onQuit={() => setPhase('ready')} />
      ) : outcome ? (
        <section class="card result pass">
          <h3><Stars n={outcome.stars} /> {outcome.stars === 3 ? 'Perfect!' : outcome.stars === 2 ? 'Great round' : outcome.stars === 1 ? 'Round complete' : 'Round over'}</h3>
          <div class="stats">
            <div><b>{outcome.score}</b><span>{outcome.pb ? (outcome.prevBest ? `new best! (was ${outcome.prevBest})` : 'first score') : `best ${best?.best_score ?? outcome.score}`}</span></div>
            <div><b>{Math.round(outcome.accuracy * 100)}%</b><span>right</span></div>
            <div><b>+{outcome.xp}</b><span>XP</span></div>
          </div>
          {outcome.reviewed.length ? <p class="note">That counted as your review for {outcome.reviewed.join(', ')}.</p> : null}
          {outcome.misses.length ? <><h3>To work on</h3><ul class="misses">{tally(outcome.misses).map(([m, n]) => <li>{m}{n > 1 ? ` ×${n}` : ''}</li>)}</ul></> : null}
          <div class="row">
            <button class="primary" onClick={() => { setRunId(x => x + 1); setPhase('play'); }}>Replay</button>
            {next && unlocked(cat, g, next) ? <a class="btn" href={`#/arcade/${g.id}/${next.id}`}>Next level ›</a> : null}
            <a class="btn" href="#/arcade">Arcade</a>
          </div>
        </section>
      ) : <p class="muted">Saving…</p>}
    </div>
  );
}
function tally(a: string[]): [string, number][] { const m = new Map<string, number>(); a.forEach(x => m.set(x, (m.get(x) || 0) + 1)); return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8); }

function Play({ cat, g, l, ghost, onDone, onQuit }: { cat: Catalog; g: Game; l: GameLevel; ghost: [number, number][]; onDone: (r: import('../arcade').RunResult) => void; onQuit: () => void }) {
  const r = useMemo(() => rng(Date.now() & 0xffffffff), []);
  const finishedRule = (correct: number, timeUp: boolean) => (g.id === 'G_note_drop' ? correct >= 20 : timeUp);
  const { round, ghost: gh, durationS, stRef } = useRound(l, finished => {
    const s = stRef.current;
    onDone({ score: s.score, correct: s.correct, total: s.total, maxCombo: s.maxCombo, finished, durationS: durationS(), misses: s.misses, ghost: gh.current });
  }, true, finishedRule);
  const ghostScore = (() => { let v = 0; for (const [t, sc] of ghost) if (t <= round.elapsed) v = sc; return v; })();
  const ghostMax = Math.max(1, ghost.length ? ghost[ghost.length - 1][1] : 0, round.score);
  return (
    <div class={`playarea flash-${round.flash || 'none'}`}>
      <div class="hud">
        <div><b>{round.score}</b><span>score</span></div>
        <div><b>×{comboMult(round.streak)}</b><span>combo</span></div>
        <div>{l.round_s ? <><b>{Math.max(0, Math.ceil(l.round_s - round.elapsed))}</b><span>sec</span></> : <><b>{'♥'.repeat(Math.max(0, round.lives))}<span class="lost">{'♥'.repeat(Math.max(0, (l.lives || 0) - round.lives))}</span></b><span>lives</span></>}</div>
        <button class="small" onClick={onQuit} aria-label="Quit">✕</button>
      </div>
      {ghost.length ? <div class="ghost"><i class="me" style={{ width: `${(round.score / ghostMax) * 100}%` }} /><i class="gh" style={{ left: `${(ghostScore / ghostMax) * 100}%` }} /><small>best run</small></div> : null}
      {g.id === 'G_note_drop' ? <NoteDrop l={l} round={round} r={r} />
        : g.id === 'G_fret_finder' ? <FretFinder l={l} round={round} r={r} />
          : g.id === 'G_delay_math' ? <DelayMath l={l} round={round} r={r} />
            : <ChoiceGame cat={cat} g={g} l={l} round={round} r={r} />}
    </div>
  );
}

// ---------- fretboard ----------
function Fretboard({ zone, onTap, marks = [], frets }: { zone: Zone; onTap: (p: Pos) => void; marks?: { p: Pos; cls: string }[]; frets?: [number, number] }) {
  const [f0, f1] = frets || zone.frets;
  const n = f1 - f0 + 1, W = 340, H = 186, left = 6, cw = (W - left - 4) / n, rh = H / 6;
  const x = (f: number) => left + (f - f0) * cw, y = (s: number) => (s - 1) * rh + rh / 2;
  const inZone = (p: Pos) => zone.strings.includes(p.string) && p.fret >= zone.frets[0] && p.fret <= zone.frets[1];
  const cells: Pos[] = []; for (let s = 1; s <= 6; s++) for (let f = f0; f <= f1; f++) cells.push({ string: s, fret: f });
  return (
    <svg class="fretboard" viewBox={`0 0 ${W} ${H + 18}`} width="100%" role="group" aria-label="Fretboard: tap a string and fret">
      {cells.filter(inZone).map(p => <rect x={x(p.fret)} y={(p.string - 1) * rh} width={cw} height={rh} class="zone" />)}
      {Array.from({ length: n + 1 }, (_, i) => <line x1={left + i * cw} x2={left + i * cw} y1={rh / 2} y2={H - rh / 2} class={i === 1 && f0 === 0 ? 'nut' : 'fret'} />)}
      {[1, 2, 3, 4, 5, 6].map(s => <line x1={left} x2={W - 4} y1={y(s)} y2={y(s)} class={`str ${zone.strings.includes(s) ? '' : 'off'}`} style={{ strokeWidth: 0.6 + (s - 1) * 0.35 }} />)}
      {[3, 5, 7, 9, 12, 15].filter(f => f >= f0 && f <= f1 && f > 0).map(f => <text x={x(f) + cw / 2} y={H + 13} class="fno">{f}</text>)}
      {f0 === 0 ? <text x={x(0) + cw / 2} y={H + 13} class="fno">0</text> : null}
      {marks.map(m => <circle cx={x(m.p.fret) + cw / 2} cy={y(m.p.string)} r={Math.min(cw, rh) * 0.36} class={`mark ${m.cls}`} />)}
      {cells.filter(inZone).map(p => <rect x={x(p.fret)} y={(p.string - 1) * rh} width={cw} height={rh} class="hit" data-s={p.string} data-f={p.fret} onPointerDown={e => { e.preventDefault(); onTap(p); }} />)}
    </svg>
  );
}
const zoneOf = (l: GameLevel): Zone => ({ strings: l.params.zone.strings, frets: l.params.zone.frets });
const posText = (p: Pos) => `string ${p.string}, fret ${p.fret}`;

// ---------- Note Drop ----------
function NoteDrop({ l, round, r }: { l: GameLevel; round: Round; r: Rng }) {
  const zone = zoneOf(l);
  const pcs = useMemo(() => Array.from({ length: 12 }, (_, pc) => pc).filter(pc => positionsOf(pc, zone).length), []);
  const [q, setQ] = useState(() => ({ pc: pick(r, pcs), start: performance.now(), id: 0 }));
  const [marks, setMarks] = useState<{ p: Pos; cls: string }[]>([]);
  const [now, setNow] = useState(performance.now());
  const speed = (l.params.speed || 1) * Math.pow(1.15, Math.floor(round.correct / 10));
  const fallMs = 6000 / speed;
  const next = () => setQ(o => { let pc = pick(r, pcs); if (pc === o.pc) pc = pick(r, pcs); round.askedAt.current = performance.now(); return { pc, start: performance.now(), id: o.id + 1 }; });
  useEffect(() => { let raf = 0; const f = () => { setNow(performance.now()); raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); return () => cancelAnimationFrame(raf); }, []);
  useEffect(() => { if (now - q.start > fallMs && round.lives > 0) { const where = positionsOf(q.pc, zone); setMarks(where.map(p => ({ p, cls: 'show' }))); round.answer(false, `${noteLabel(q.pc)} (${where.map(posText).join(' or ')})`); next(); } }, [now]);
  const tap = (p: Pos) => {
    if (pcAt(p) === q.pc) { setMarks([{ p, cls: 'ok' }]); round.answer(true, undefined, 900, fallMs); }
    else { setMarks([{ p, cls: 'bad' }, ...positionsOf(q.pc, zone).map(x => ({ p: x, cls: 'show' }))]); round.answer(false, `${noteLabel(q.pc)} (you tapped ${noteLabel(pcAt(p))} at ${posText(p)})`); }
    next();
  };
  const frac = Math.min(1, (now - q.start) / fallMs);
  return (
    <div class="board">
      <div class="sky"><b class="drop" style={{ top: `${frac * 82}%` }}>{noteLabel(q.pc)}</b><div class="landing" /></div>
      <Fretboard zone={zone} onTap={tap} marks={marks} />
      <p class="muted small center">{round.correct < 20 ? `${20 - round.correct} more to finish the round` : 'Round finished: keep going for points!'} · speed ×{speed.toFixed(2)}</p>
    </div>
  );
}

// ---------- Fret Finder ----------
function FretFinder({ l, round, r }: { l: GameLevel; round: Round; r: Rng }) {
  const zone = zoneOf(l);
  const newNote = (prev?: number) => { let pc = Math.floor(r() * 12); while (pc === prev || !positionsOf(pc, zone).length) pc = Math.floor(r() * 12); return { pc, start: performance.now(), found: [] as Pos[] }; };
  const [q, setQ] = useState(() => newNote());
  const [bad, setBad] = useState<Pos | null>(null);
  const [left, setLeft] = useState(20);
  const targets = positionsOf(q.pc, zone);
  useEffect(() => { const t = setInterval(() => {
    const s = 20 - (performance.now() - q.start) / 1000; setLeft(Math.max(0, Math.ceil(s)));
    if (s <= 0) { const missing = targets.filter(t => !q.found.some(f => f.string === t.string && f.fret === t.fret)); round.addMisses(missing.length, `${noteLabel(q.pc)} at ${missing.map(posText).join(', ')}`); setQ(newNote(q.pc)); round.askedAt.current = performance.now(); }
  }, 200); return () => clearInterval(t); }, [q]);
  const tap = (p: Pos) => {
    if (q.found.some(f => f.string === p.string && f.fret === p.fret)) return;
    if (pcAt(p) === q.pc) {
      round.answer(true, undefined, 1200, 5000);
      const found = [...q.found, p];
      if (found.length === targets.length) { setQ(newNote(q.pc)); } else setQ({ ...q, found });
    } else { setBad(p); setTimeout(() => setBad(null), 300); round.answer(false, `${noteLabel(q.pc)}: ${posText(p)} is ${noteLabel(pcAt(p))}`); }
  };
  return (
    <div class="board">
      <div class="target"><b>{noteLabel(q.pc)}</b><span>{q.found.length}/{targets.length} found · {left}s</span></div>
      <Fretboard zone={zone} onTap={tap} marks={[...q.found.map(p => ({ p, cls: 'ok' })), ...(bad ? [{ p: bad, cls: 'bad' }] : [])]} />
    </div>
  );
}

// ---------- choice games: Call the Number, Capo Quick, Hear the Change ----------
function songCalls(cat: Catalog, r: Rng): { prompts: { num: string; chord: string }[]; title: string; key: string; choices: string[] } {
  const sl = getSetList();
  const week = sl ? thisWeekSongs(sl).map(s => s.outlineId).filter((x): x is string => !!x && !!cat.outlineById[x]) : [];
  const pool = week.length ? week : cat.outlines.map(o => o.id);
  const o = cat.outlineById[pick(r, pool)];
  const prompts = o.sections.flatMap(s => s.chords_in_chart_key.map((c, i) => ({ num: s.numbers[i], chord: c })));
  return { prompts, title: o.title, key: o.chart_key, choices: [...new Set(prompts.map(p => p.chord))].slice(0, 9) };
}
function ChoiceGame({ cat, g, l, round, r }: { cat: Catalog; g: Game; l: GameLevel; round: Round; r: Rng }) {
  const p = l.params;
  const song = useRef<ReturnType<typeof songCalls> | null>(null), idx = useRef(0);
  const gen = (prev?: ChoiceQ): ChoiceQ => {
    if (g.id === 'G_capo_quick') return capoQ(r, p.ask, p.keys, p.shapes);
    if (g.id === 'G_hear_the_change') return hearQ(r, p.numbers);
    if (p.songs) {
      if (!song.current || idx.current >= song.current.prompts.length) { song.current = songCalls(cat, r); idx.current = 0; }
      const s = song.current, c = s.prompts[idx.current++];
      return { prompt: c.num, sub: `${s.title} · key of ${pretty(s.key)}`, choices: s.choices, answer: c.chord, key: s.key, miss: `${c.num} in ${s.key} (${s.title}) is ${c.chord}` };
    }
    return callNumberQ(r, p.keys, p.numbers, prev);
  };
  const [q, setQ] = useState<ChoiceQ>(() => gen());
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { if (q.audio) playChords(q.audio, 0.9); }, [q]);
  const choose = (c: string) => {
    if (picked) return;
    const ok = c === q.answer; setPicked(c);
    round.answer(ok, ok ? undefined : q.miss, g.id === 'G_hear_the_change' ? 2200 : 1200, g.id === 'G_hear_the_change' ? 7000 : 5000);
    setTimeout(() => { setPicked(null); setQ(gen(q)); round.askedAt.current = performance.now(); }, ok ? 220 : 900);
  };
  const isNum = g.id === 'G_call_the_number';
  return (
    <div class="board">
      <div class="target"><b class={isNum ? 'num' : 'q'}>{q.prompt}</b>{q.sub ? <span>{q.sub}</span> : null}
        {q.audio ? <button class="small" onClick={() => playChords(q.audio!, 0.9)}>🔊 Again</button> : null}</div>
      <div class={`choices n${q.choices.length > 7 ? 'many' : q.choices.length}`}>
        {q.choices.map(c => <button class={picked ? (c === q.answer ? 'right' : c === picked ? 'wrong' : '') : ''} onClick={() => choose(c)}>{pretty(c)}</button>)}
      </div>
    </div>
  );
}

// ---------- Delay Math ----------
function DelayMath({ l, round, r }: { l: GameLevel; round: Round; r: Rng }) {
  const gen = () => delayQ(r, l.params.bpm, l.params.notes);
  const [q, setQ] = useState<DelayQ>(gen);
  const [v, setV] = useState('');
  const [fb, setFb] = useState<string | null>(null);
  const submit = () => {
    if (!v) return;
    const ok = Math.abs(+v - q.ms) <= 10;
    round.answer(ok, ok ? undefined : `${q.bpm} BPM ${DELAY_NOTES[q.note].label} = ${Math.round(q.ms)} ms`, 3000, 12000);
    setFb(ok ? `✓ ${Math.round(q.ms)} ms` : `✗ ${Math.round(q.ms)} ms`);
    setTimeout(() => { setFb(null); setV(''); setQ(gen()); round.askedAt.current = performance.now(); }, ok ? 400 : 1300);
  };
  const key = (k: string) => { if (fb) return; if (k === '⌫') setV(v.slice(0, -1)); else if (k === '✓') submit(); else if (v.length < 4) setV(v + k); };
  return (
    <div class="board">
      <div class="target"><b class="q">{q.bpm} BPM</b><span>{DELAY_NOTES[q.note].label} delay, in ms (±10)</span></div>
      <div class="readout">{fb || v || ' '}<small>ms</small></div>
      <div class="keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map(k => <button class={k === '✓' ? 'primary' : ''} onClick={() => key(k)}>{k}</button>)}</div>
      <p class="muted small center">Quarter = 60000 ÷ BPM · dotted eighth = ¾ of that</p>
    </div>
  );
}
