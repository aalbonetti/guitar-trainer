// Arcade (07-games.md): home, the shared game frame (score, combo, ghost, timer/lives, mode, pause menu with the
// tuner and metronome sheets, results) and the game registry. The games are in ArcadeGames.tsx (untimed, tap or
// play) and ArcadeTimed.tsx (click-timed, play).
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Catalog, Game, GameLevel } from '../catalog';
import { useStore } from '../store';
import { progress, streakInfo } from '../progressStore';
import { xp } from '../xp';
import { bests, bestKey, bestStars, loadBests, unlocked, finishRun, markService, modeFor, setModeFor, type RunOutcome, type RunResult, type Mode } from '../arcade';
import { levelFor, comboMult, rng } from '../games/core';
import { dayOf, computeStates } from '../progress';
import { metro, tuner, stopMetronome, stopTuner, bluetoothOutputLikely, acquireCapture, releaseCapture, capture, routeLabel } from '../audio/engine';
import { getCalibration, routeName, posture, attempt } from '../grading/runner';
import { patternFeel } from '../grading/timing';
import { closeEars } from '../games/listen';
import { inputPref, TunerPanel, MetronomePanel } from './Tools';
import { CalibrationCard } from './Timing';
import { useRound, Stars } from './GameKit';
import { NoteDrop, FretFinder, OctaveJump, ChoiceGame, DelayMath } from './ArcadeGames';
import { BoxRunner, InThePocket } from './ArcadeTimed';

/** Games built so far (G1 + G2); the rest fold into "Coming later". */
const BUILT = new Set(['G_note_drop', 'G_fret_finder', 'G_call_the_number', 'G_hear_the_change', 'G_capo_quick', 'G_delay_math', 'G_octave_jump', 'G_box_runner', 'G_in_the_pocket']);
/** Click-timed games: the round can't pause mid-click (pause stops it), Bluetooth output blocks them, points per beat. */
const TIMED = new Set(['G_box_runner', 'G_in_the_pocket']);
const ICON: Record<string, string> = { G_note_drop: '⬇', G_fret_finder: '🔎', G_call_the_number: '📣', G_hear_the_change: '👂', G_capo_quick: '🎚', G_delay_math: '⏱', G_triad_hunt: '△', G_octave_jump: '⇅', G_box_runner: '▦', G_in_the_pocket: '◎', G_change_sprint: '⚡', G_song_run: '★' };
const MODE_LABEL: Record<Mode, string> = { tap: '👆 Tap', play: '🎸 Play' };

// ---------- home ----------
export function ArcadeHome({ cat }: { cat: Catalog }) {
  const x = useStore(xp), b = useStore(bests), pr = useStore(progress);
  useEffect(() => { if (!b.ready) void loadBests(); }, []);
  const lv = levelFor(x.total), today = dayOf();
  const sk = streakInfo(today);
  const sunday = new Date().getDay() === 0;
  const mins = Math.floor(sk.todayS / 60);
  return (
    <div class="page arcade">
      <h1>Arcade</h1>
      <section class="card xpcard">
        <div class="row between"><b>Level {lv.level}</b><span class="muted">{x.total} XP · {lv.need - lv.into} to level {lv.level + 1}</span></div>
        <div class="xpbar"><i style={{ width: `${(lv.into / lv.need) * 100}%` }} /></div>
        <a class="streaklink" href="#/progress" aria-label="Streak: see your progress"><p class="streakline"><b>{sk.current ? `🔥 ${sk.current}-day streak` : 'No streak yet'}</b>{sk.freezes ? <span class="muted"> · ❄ {sk.freezes} freeze{sk.freezes > 1 ? 's' : ''}</span> : null}
          <span class="muted"> · today {sk.todayDone ? 'counts ✓' : `${mins} of 5 min`}</span> <span class="chev" aria-hidden="true">›</span></p></a>
        <p class="muted small">XP comes from games, lesson passes (+50) and reviews (+20). Levels are just for fun; lessons still unlock in order. A day counts for the streak with 5 minutes of practice, games included; every 7 days earns a streak freeze (up to 2) that covers a missed day.</p>
        {sunday || !sk.todayDone ? <button class="small" disabled={pr.services.includes(today)} onClick={() => void markService()}>{pr.services.includes(today) ? 'Today counts ✓' : '⛪ Played a service today'}</button> : null}
      </section>
      <div class="tiles">
        {cat.games.filter(g => BUILT.has(g.id)).map(g => {
          const lesson = cat.lessonById[g.unlock_lesson];
          const st = computeStates(cat.lessons, cat.tracks, pr.lp)[g.unlock_lesson];
          const m = modeFor(g);
          return (
            <section class="card tile">
              <h2><span class="gicon">{ICON[g.id]}</span> {g.name} <small class="modes muted">{g.modes.map(x => MODE_LABEL[x as Mode]).join(' · ')}</small></h2>
              <p class="muted small">{g.blurb}</p>
              {st === 'locked' || st === 'available' ? <p class="muted small">Taught in <a href={`#/lesson/${g.unlock_lesson}`}>{g.unlock_lesson} {lesson?.title}</a></p> : null}
              <ul class="levels">{g.levels.map((l, i) => {
                const lo = unlocked(cat, g, l), best = b.map[bestKey(g.id, l.id, m)];
                return <li>{lo ? <a href={`#/arcade/${g.id}/${l.id}`}><span>{l.name}</span><Stars n={bestStars(g, l)} />{best ? <small>{g.modes.length > 1 ? (m === 'play' ? '🎸 ' : '👆 ') : ''}{best.best_score}</small> : null}</a>
                  : <span class="muted">🔒 {l.name} <small>★★ on level {i} opens it</small></span>}</li>;
              })}</ul>
            </section>
          );
        })}
      </div>
      {(() => { const later = cat.games.filter(g => !BUILT.has(g.id)); return later.length ? (
        <details class="card later">
          <summary><b>Coming later</b> <span class="muted small">{later.length} chord games, after the chord graders</span></summary>
          <ul class="list">{later.map(g => <li><span><span class="gicon">{ICON[g.id]}</span> <b>{g.name}</b><small class="muted"> · {g.blurb}</small></span></li>)}</ul>
        </details>) : null; })()}
    </div>
  );
}

// ---------- game screen ----------
function ModeToggle({ g, mode, set }: { g: Game; mode: Mode; set: (m: Mode) => void }) {
  if (g.modes.length < 2) return <p class="muted small">{mode === 'play' ? '🎸 Play mode: you answer on the guitar.' : '👆 Tap mode.'}</p>;
  return (
    <div class="segmented" role="radiogroup" aria-label="How you answer">
      {(['tap', 'play'] as Mode[]).filter(m => g.modes.includes(m)).map(m => <button role="radio" aria-checked={mode === m} class={mode === m ? 'sel' : ''} onClick={() => set(m)}>{MODE_LABEL[m]}</button>)}
    </div>
  );
}
const dev = () => inputPref.get() || undefined;

export function GameScreen({ cat, gameId, levelId }: { cat: Catalog; gameId: string; levelId: string }) {
  const g = cat.games.find(x => x.id === gameId), l = g?.levels.find(x => x.id === levelId);
  useStore(progress); const b = useStore(bests);
  useStore(capture);
  useEffect(() => { if (!b.ready) void loadBests(); }, []);
  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<'ready' | 'play' | 'done'>('ready');
  const [mode, setMode] = useState<Mode>(g ? modeFor(g) : 'tap');
  const [outcome, setOutcome] = useState<(RunOutcome & { score: number; misses: string[]; mode: Mode }) | null>(null);
  const [bt, setBt] = useState(false);
  const [needCal, setNeedCal] = useState(false);
  const [checking, setChecking] = useState(false);
  const [calMsg, setCalMsg] = useState('');
  useEffect(() => { setPhase('ready'); setOutcome(null); setNeedCal(false); if (g) setMode(modeFor(g)); }, [gameId, levelId]);
  const timed = !!g && TIMED.has(g.id);
  useEffect(() => { if (timed) void bluetoothOutputLikely().then(setBt); }, [gameId]);
  useEffect(() => () => closeEars(), []);
  if (!g || !l) return <div class="page"><p>Game not found. <a href="#/arcade">Arcade</a></p></div>;
  if (!BUILT.has(g.id)) return <div class="page"><p>This game isn't ready yet. <a href="#/arcade">Back to the Arcade</a></p></div>;
  if (!unlocked(cat, g, l)) return <div class="page"><p>Get ★★ on the previous level to open this one. <a href="#/arcade">Back to the Arcade</a></p></div>;
  const best = b.map[bestKey(g.id, l.id, mode)];
  const next = g.levels[g.levels.indexOf(l) + 1];
  const pick = (m: Mode) => { setMode(m); setModeFor(g, m); };
  const go = async () => {
    if (mode === 'play' && g.id === 'G_in_the_pocket') {
      // strums are graded against the click, so this input + posture needs a strum calibration first
      setChecking(true);
      try { await acquireCapture('game-check', dev()); const c = await getCalibration(routeName()); releaseCapture('game-check'); setChecking(false); if (!c) { setCalMsg(''); setNeedCal(true); return; } }
      catch { releaseCapture('game-check'); setChecking(false); }
    }
    setNeedCal(false); setRunId(x => x + 1); setPhase('play');
  };
  const btBlock = timed && mode === 'play' && bt;
  const calibrated = () => { const c = attempt.get().cal; setNeedCal(false); setCalMsg(c ? `Calibrated ✓ (${Math.round(c.offsetMs)} ms offset, saved for this input and posture). Ready when you are.` : 'Calibrated ✓'); };
  const roundText = l.round_s ? `${l.round_s} seconds.` : l.lives ? `${l.lives} lives.`
    : g.id === 'G_in_the_pocket' ? `${l.params.bars} bars${l.params.gap_bars ? `; the click drops out for ${l.params.gap_bars.join(', then ')} bars and you keep going` : ''}.`
      : g.id === 'G_box_runner' ? `The path ${l.params.passes} times through, to the click.` : '';
  const ready = (
    <section class="card">
      <p>{g.blurb}</p>
      <ModeToggle g={g} mode={mode} set={pick} />
      <p class="muted">{roundText} {timed ? 'Closer to the beat scores more' : 'Faster answers score more'}; 8 in a row raises the combo. ★★ = 85% right, ★★★ = 95% right and {l.target_score} points.{best ? ` Your best (${mode}): ${best.best_score}.` : ''}</p>
      {mode === 'play' ? <p class="muted small">Prop the phone near the guitar or amp. The app listens {capture.get().label ? `with ${routeLabel()}` : 'with the input chosen in Settings'} and checks each note against the answer it expects.{timed ? ' One bar of count-in; the game runs the click.' : ''} Tap and play scores are kept apart. <a href="#/settings">Input</a></p> : null}
      {(l.review_for || []).length ? <p class="muted small">★★ here counts as the review for {l.review_for!.join(', ')} when it's due.</p> : null}
      {btBlock ? <><p class="error">Bluetooth audio looks active. Its delay (150–300 ms) puts the click out of step with your playing, so click-timed games are off.</p>
        <p class="muted">Switch to the phone speaker or wired headphones, then <button class="small" onClick={() => void bluetoothOutputLikely().then(setBt)}>check again</button>.</p></> : null}
      {needCal ? <div><p><b>First, a 30-second strum calibration</b> for {capture.get().label || 'this input'} ({posture()}), so strums are graded fairly.</p><CalibrationCard compact onDone={calibrated} /></div> : null}
      {calMsg && !needCal ? <p class="okText">{calMsg}</p> : null}
      {!needCal ? <button class="primary big" disabled={btBlock || checking} onClick={() => void go()}>{checking ? 'Checking the input…' : '▶ Start'}</button> : null}
    </section>
  );
  return (
    <div class="page game">
      <div class="crumbs"><a href="#/arcade">Arcade</a> › {g.name}</div>
      <h1>{ICON[g.id]} {g.name} <small class="muted">{l.name}</small></h1>
      {phase === 'ready' ? ready : phase === 'play' ? (
        <Play key={runId} cat={cat} g={g} l={l} mode={mode} ghost={best?.ghost || []}
          onDone={async res => { const o = await finishRun(cat, g, l, res, mode); setOutcome({ ...o, score: res.score, misses: res.misses, mode }); setPhase('done'); }}
          onQuit={() => setPhase('ready')} onRestart={() => setRunId(x => x + 1)} />
      ) : outcome ? (
        <section class="card result pass">
          <h3><Stars n={outcome.stars} /> {outcome.stars === 3 ? 'Perfect!' : outcome.stars === 2 ? 'Great round' : outcome.stars === 1 ? 'Round complete' : 'Round over'} <small class="muted">{MODE_LABEL[outcome.mode]}</small></h3>
          <div class="stats">
            <div><b>{outcome.score}</b><span>{outcome.pb ? (outcome.prevBest ? `new best! (was ${outcome.prevBest})` : 'first score') : `best ${best?.best_score ?? outcome.score}`}</span></div>
            <div><b>{Math.round(outcome.accuracy * 100)}%</b><span>right</span></div>
            <div><b>+{outcome.xp}</b><span>XP</span></div>
          </div>
          {outcome.reviewed.length ? <p class="note">That counted as your review for {outcome.reviewed.join(', ')}.</p> : null}
          {outcome.misses.length ? <><h3>To work on</h3><ul class="misses">{tally(outcome.misses).map(([m, n]) => <li>{m}{n === 2 ? ', twice' : n > 2 ? `, ${n} times` : ''}</li>)}</ul></> : null}
          <ModeToggle g={g} mode={mode} set={pick} />
          <div class="row">
            <button class="primary" onClick={() => void go()}>Replay</button>
            {next && unlocked(cat, g, next) ? <a class="btn" href={`#/arcade/${g.id}/${next.id}`}>Next level ›</a> : null}
            <a class="btn" href="#/arcade">Arcade</a>
          </div>
          {needCal ? <div><p><b>First, a strum calibration</b> for this input.</p><CalibrationCard compact onDone={calibrated} /></div> : null}
        </section>
      ) : <p class="muted">Saving…</p>}
    </div>
  );
}
function tally(a: string[]): [string, number][] { const m = new Map<string, number>(); a.forEach(x => m.set(x, (m.get(x) || 0) + 1)); return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8); }

// ---------- the shared frame ----------
function Play({ cat, g, l, mode, ghost, onDone, onQuit, onRestart }: { cat: Catalog; g: Game; l: GameLevel; mode: Mode; ghost: [number, number][]; onDone: (r: RunResult) => void; onQuit: () => void; onRestart: () => void }) {
  const r = useMemo(() => rng(Date.now() & 0xffffffff), []);
  const [paused, setPaused] = useState(false);
  const [sheet, setSheet] = useState<'tuner' | 'metro' | null>(null);
  const timed = TIMED.has(g.id);
  // click-timed games score 100 per beat, so an eighth note is worth 50 and a sixteenth 25
  const base = g.id === 'G_box_runner' ? 100 / l.params.sub : g.id === 'G_in_the_pocket' ? 100 / patternFeel(cat.strums.find(s => s.id === l.params.pattern)!).sub : 100;
  const finishedRule = (correct: number, timeUp: boolean) => (g.id === 'G_note_drop' ? correct >= 20 : timeUp);
  const { round, ghost: gh, durationS, stRef, roundS } = useRound(l, mode, base, paused, finished => {
    const s = stRef.current;
    onDone({ score: s.score, correct: s.correct, total: s.total, maxCombo: s.maxCombo, finished, durationS: durationS(), misses: s.misses, ghost: gh.current });
  }, finishedRule);
  // The game owns the click while a round runs: no metronome or tuner from the sheets once you resume.
  useEffect(() => { if (!paused) { setSheet(null); if (metro.get().running) stopMetronome(); if (tuner.get().on) stopTuner(); } }, [paused]);
  // Locking the phone or switching apps pauses the round (and closes the mic).
  useEffect(() => { const f = () => { if (document.visibilityState === 'hidden') setPaused(true); }; document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, []);
  const ghostScore = (() => { let v = 0; for (const [t, sc] of ghost) if (t <= round.elapsed) v = sc; return v; })();
  const ghostMax = Math.max(1, ghost.length ? ghost[ghost.length - 1][1] : 0, round.score);
  return (
    <div class={`playarea ${timed ? 'timed' : ''} mode-${mode} flash-${round.flash || 'none'}`}>
      <div class="ghud">
        <div class="hud">
          <div><b>{round.score}</b><span>score</span></div>
          <div><b>×{comboMult(round.streak)}</b><span>combo</span></div>
          <div>{roundS ? <><b>{Math.max(0, Math.ceil(roundS - round.elapsed))}</b><span>sec</span></> : l.lives ? <><b>{'♥'.repeat(Math.max(0, round.lives))}<span class="lost">{'♥'.repeat(Math.max(0, (l.lives || 0) - round.lives))}</span></b><span>lives</span></>
            : <><b>{round.correct}/{round.total}</b><span>right</span></>}</div>
          <button class="small" onClick={() => setPaused(true)} aria-label="Pause">⏸</button>
        </div>
        {ghost.length ? <div class="ghost"><i class="me" style={{ width: `${(round.score / ghostMax) * 100}%` }} /><i class="gh" style={{ left: `${(ghostScore / ghostMax) * 100}%` }} /><small>best run</small></div> : null}
      </div>
      {g.id === 'G_note_drop' ? <NoteDrop l={l} round={round} r={r} />
        : g.id === 'G_fret_finder' ? <FretFinder l={l} round={round} r={r} />
          : g.id === 'G_octave_jump' ? <OctaveJump l={l} round={round} r={r} />
            : g.id === 'G_box_runner' ? <BoxRunner cat={cat} l={l} round={round} r={r} />
              : g.id === 'G_in_the_pocket' ? <InThePocket cat={cat} l={l} round={round} />
                : g.id === 'G_delay_math' ? <DelayMath l={l} round={round} r={r} />
                  : <ChoiceGame cat={cat} g={g} l={l} round={round} r={r} />}
      {paused ? (
        <div class="pausemenu" role="dialog" aria-label="Paused">
          <div class="card">
            <h2>{timed ? 'Round stopped' : 'Paused'}</h2>
            {timed ? <p class="muted small">A click-timed round can't pick up mid-bar; restart it when you're ready.</p> : null}
            <div class="row wrap">
              {!timed ? <button class="primary" onClick={() => setPaused(false)}>▶ Resume</button> : null}
              <button class={timed ? 'primary' : ''} onClick={onRestart}>↻ Restart</button>
              <button onClick={onQuit}>✕ Quit</button>
            </div>
            <div class="row">
              <button class={sheet === 'tuner' ? 'sel' : ''} onClick={() => setSheet(sheet === 'tuner' ? null : 'tuner')}>🎚 Tuner</button>
              <button class={sheet === 'metro' ? 'sel' : ''} onClick={() => setSheet(sheet === 'metro' ? null : 'metro')}>⏱ Metronome</button>
            </div>
            {sheet === 'tuner' ? <div class="sheet"><TunerPanel compact /></div> : sheet === 'metro' ? <div class="sheet"><MetronomePanel compact /></div> : null}
            <p class="muted small">{mode === 'play' ? 'The mic is off while paused. ' : ''}The tuner and metronome stop when the round goes on: the game runs its own click.</p>
          </div>
        </div>) : null}
    </div>
  );
}
