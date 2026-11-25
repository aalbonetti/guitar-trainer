// Arcade (07-games.md): home, the shared game frame (score, combo, ghost, timer/lives, mode, pause menu with the
// tuner and metronome sheets, results) and the game registry. The games are in ArcadeGames.tsx (untimed, tap or
// play), ArcadeTimed.tsx (click-timed, play) and ArcadeChord.tsx (G3 chord games and Song Run). Daily Challenge
// screens are in Daily.tsx; badges and Set Ready progress are on the home screen.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Catalog, Game, GameLevel } from '../catalog';
import { useStore, useSelect } from '../store';
import { progress, streakInfo } from '../progressStore';
import { xp } from '../xp';
import { bests, bestKey, bestStars, loadBests, unlocked, finishRun, markService, modeFor, setModeFor, churchSongs, checkAllBadges, type RunOutcome, type RunResult, type Mode } from '../arcade';
import { badges, badgeProgress, loadBadges, type BadgeData } from '../badges';
import { graderMode } from '../grading/modes';
import { capoOptions, KEY_NAMES } from '../music';
import { daily } from '../daily';
import { flushHeat } from '../heat';
import { CallNumberPlay, TriadHunt, ChangeSprint, SongRun, type SongSetup } from './ArcadeChord';
import { DailyBanner, dailyFocus, ensureDaily } from './Daily';
import { songSettings, songViewPref } from './Song';
import { trackVisibleFor } from './Screens';
import type { BarsPerChord } from '../games/chords';
import * as dbm from '../db';
import { levelFor, comboMult, rng } from '../games/core';
import { dayOf, computeStates } from '../progress';
import { metro, tuner, stopMetronome, stopTuner, bluetoothOutputLikely, acquireCapture, releaseCapture, capture, routeLabel } from '../audio/engine';
import { getCalibration, routeName, posture, attempt } from '../grading/runner';
import { patternFeel } from '../grading/timing';
import { closeEars, ears } from '../games/listen';
import { inputPref, TunerPanel, MetronomePanel } from './Tools';
import { CalibrationCard } from './Timing';
import { useRound, Stars } from './GameKit';
import { NoteDrop, FretFinder, OctaveJump, ChoiceGame, DelayMath } from './ArcadeGames';
import { BoxRunner, InThePocket } from './ArcadeTimed';

/** Click-timed games: the round can't pause mid-click (pause stops it), Bluetooth output blocks them, points per beat. */
const TIMED = new Set(['G_box_runner', 'G_in_the_pocket', 'G_song_run']);
/** Rounds that can't resume after a pause (the click or the minute keeps going): pause stops them. */
const NO_RESUME = new Set([...TIMED, 'G_change_sprint']);
/** Chord games in play mode follow Settings → Grading mode (assisted by default until the phone check is done). */
const CHORD_GRADER: Record<string, string> = { G_call_the_number: 'chord_accuracy', G_triad_hunt: 'chord_accuracy', G_song_run: 'chord_accuracy', G_change_sprint: 'changes_per_min' };
const assistedFor = (g: Game, mode: Mode) => mode === 'play' && !!CHORD_GRADER[g.id] && graderMode(CHORD_GRADER[g.id]) !== 'auto';
/** Continuous chord rounds (no per-answer override): assisted mode asks at the end whether the round counts. */
const CONFIRM_AT_END = new Set(['G_change_sprint', 'G_song_run']);
const ICON: Record<string, string> = { G_note_drop: '⬇', G_fret_finder: '🔎', G_call_the_number: '📣', G_hear_the_change: '👂', G_capo_quick: '🎚', G_delay_math: '⏱', G_triad_hunt: '△', G_octave_jump: '⇅', G_box_runner: '▦', G_in_the_pocket: '◎', G_change_sprint: '⚡', G_song_run: '★' };
const MODE_LABEL: Record<Mode, string> = { tap: '👆 Tap', play: '🎸 Play' };

// ---------- home ----------
export function ArcadeHome({ cat }: { cat: Catalog }) {
  const x = useStore(xp), b = useStore(bests), pr = useStore(progress), bd = useStore(badges);
  useEffect(() => { if (!b.ready) void loadBests(); if (!bd.ready) void loadBadges(); }, []);
  // badges earned outside a round (a 30-day streak, a set list saved later) are picked up when the Arcade opens
  useEffect(() => { if (b.ready && pr.ready) void checkAllBadges(cat); }, [b.ready, pr.ready]);
  const visible = trackVisibleFor(cat);
  const lv = levelFor(x.total), today = dayOf();
  const sk = streakInfo(today);
  const sunday = new Date().getDay() === 0;
  const mins = Math.floor(sk.todayS / 60);
  const states = computeStates(cat.lessons, cat.tracks, pr.lp);
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
      <DailyBanner cat={cat} visible={visible} />
      <div class="tiles">
        {cat.games.map(g => {
          if (g.id === 'G_song_run') return <SongRunTile cat={cat} g={g} />;
          const lesson = cat.lessonById[g.unlock_lesson];
          const st = states[g.unlock_lesson];
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
      <BadgesCard cat={cat} />
    </div>
  );
}

/** Song Run: every song is a boss level. Church-list songs first, with Set Ready progress; the rest folded. */
function SongRunTile({ cat, g }: { cat: Catalog; g: Game }) {
  const b = useStore(bests);
  const church = new Set(churchSongs(cat));
  const st = (id: string) => b.map[bestKey(g.id, id, 'play')]?.best_stars || 0;
  const row = (l: GameLevel) => <li><a href={`#/arcade/${g.id}/${l.id}`}><span>{l.name}</span><Stars n={st(l.id)} />{b.map[bestKey(g.id, l.id, 'play')] ? <small>{b.map[bestKey(g.id, l.id, 'play')].best_score}</small> : <small>{l.params.bpm} BPM</small>}</a></li>;
  const mine = g.levels.filter(l => church.has(l.id)), rest = g.levels.filter(l => !church.has(l.id));
  const three = mine.filter(l => st(l.id) >= 3).length;
  return (
    <section class="card tile songrun">
      <h2><span class="gicon">{ICON[g.id]}</span> {g.name} <small class="modes muted">{MODE_LABEL.play}</small></h2>
      <p class="muted small">{g.blurb}</p>
      <p class="small"><b>Set Ready:</b> {three} of {mine.length} church songs at ★★★</p>
      <ul class="levels">{mine.map(row)}</ul>
      {rest.length ? <details><summary class="muted small">{mine.length ? 'Other songs' : 'Songs'} ({rest.length})</summary><ul class="levels">{rest.map(row)}</ul></details> : null}
    </section>
  );
}

function BadgesCard({ cat }: { cat: Catalog }) {
  const bd = useStore(badges), b = useStore(bests); useStore(progress);
  const runs = useRuns();
  if (!cat.badges?.length) return null;
  const data: Omit<BadgeData, 'runs'> = { bests: b.map, churchSongs: churchSongs(cat), longestStreak: streakInfo().longest };
  return (
    <section class="card badges">
      <h2>Badges <small class="muted">{Object.keys(bd.earned).length} of {cat.badges.length}</small></h2>
      <ul class="badgelist">{cat.badges.map(x => { const got = bd.earned[x.id]; const pg = badgeProgress(x, { ...data, runs });
        return <li class={got ? 'got' : ''}><b>{got ? '🏅' : '○'} {x.name}</b><small class="muted">{x.blurb}{got ? ` · earned ${new Date(got).toLocaleDateString()}` : pg.text ? ` · ${pg.text}` : ''}</small></li>; })}</ul>
    </section>
  );
}
function useRuns() {
  const [runs, setRuns] = useState<any[]>([]);
  useEffect(() => { void dbm.getAll('game_run').then(r => setRuns(r as any[])).catch(() => undefined); }, []);
  return runs;
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
// The input's name changes while a round runs (capture opens and closes), so only these ready-card lines subscribe.
function ListenNote({ chords, timed }: { chords: boolean; timed: boolean }) {
  const c = useStore(capture);
  return <p class="muted small">Prop the phone near the guitar or amp. The app listens {c.label ? `with ${routeLabel()}` : 'with the input chosen in Settings'} and checks each {chords ? 'strum against the chord' : 'note against the answer'} it expects.{timed ? ' One bar of count-in; the game runs the click.' : ''} Tap and play scores are kept apart. <a href="#/settings">Input</a></p>;
}
function CalNeeded({ onDone }: { onDone: () => void }) {
  const c = useStore(capture);
  return <div><p><b>First, a 30-second strum calibration</b> for {c.label || 'this input'} ({posture()}), so strums are graded fairly.</p><CalibrationCard compact onDone={onDone} /></div>;
}

export function GameScreen({ cat, gameId, levelId, fromDaily = false }: { cat: Catalog; gameId: string; levelId: string; fromDaily?: boolean }) {
  const g = cat.games.find(x => x.id === gameId), l = g?.levels.find(x => x.id === levelId);
  useStore(progress); const b = useStore(bests); const dd = useStore(daily);
  useEffect(() => { if (!b.ready) void loadBests(); }, []);
  useEffect(() => { if (fromDaily) void ensureDaily(cat, trackVisibleFor(cat)); }, [fromDaily]);
  const [runId, setRunId] = useState(0);
  const [phase, setPhase] = useState<'ready' | 'play' | 'confirm' | 'done'>('ready');
  const [mode, setMode] = useState<Mode>(g ? modeFor(g) : 'tap');
  const [outcome, setOutcome] = useState<(RunOutcome & { score: number; misses: string[]; mode: Mode }) | null>(null);
  const [pending, setPending] = useState<RunResult | null>(null);
  const [bt, setBt] = useState(false);
  const [needCal, setNeedCal] = useState(false);
  const [checking, setChecking] = useState(false);
  const [calMsg, setCalMsg] = useState('');
  const starting = useRef(false);
  // Song Run: key, capo and bars per chord, chosen by the player (key + capo shared with the Song view)
  const songDefault = (): SongSetup => {
    const o = l && g?.id === 'G_song_run' ? cat.outlineById[l.params.outline] : null;
    if (!o) return { key: 'G', capo: 0, per: '1' };
    const st = songSettings(cat, o, progress.get().lp);
    return { key: st.key, capo: st.capo, per: '1' };
  };
  const [song, setSong] = useState<SongSetup>(songDefault);
  useEffect(() => { setPhase('ready'); setOutcome(null); setPending(null); setNeedCal(false); if (g) setMode(modeFor(g)); setSong(songDefault()); }, [gameId, levelId]);
  const timed = !!g && TIMED.has(g.id);
  useEffect(() => { if (timed) void bluetoothOutputLikely().then(setBt); }, [gameId]);
  useEffect(() => () => closeEars(), []);
  if (!g || !l) return <div class="page"><p>Game not found. <a href="#/arcade">Arcade</a></p></div>;
  if (!unlocked(cat, g, l)) return <div class="page"><p>Get ★★ on the previous level to open this one. <a href="#/arcade">Back to the Arcade</a></p></div>;
  const best = b.map[bestKey(g.id, l.id, mode)];
  const next = g.id === 'G_song_run' ? undefined : g.levels[g.levels.indexOf(l) + 1];
  // Song Run's ★★★ score depends on the bars per chord (2 bars = twice the bars)
  const lv: GameLevel = g.id === 'G_song_run' ? { ...l, target_score: l.params.targets?.[song.per] ?? l.target_score } : l;
  const assisted = assistedFor(g, mode);
  const pick = (m: Mode) => { setMode(m); setModeFor(g, m); };
  const go = async () => {
    if (starting.current) return; // a double tap on Start / Replay
    starting.current = true;
    try {
      if (timed && mode === 'play') {
        // Checked on every Start, Replay and Restart: headphones can be connected between rounds, and calibration is
        // per input and posture. The ready card shows while checking, with any blocker.
        setPhase('ready'); setChecking(true); setNeedCal(false);
        const blocked = await bluetoothOutputLikely();
        setBt(blocked);
        if (blocked) return;
        if (g.id === 'G_in_the_pocket') {
          // strums are graded against the click, so this input + posture needs a strum calibration first
          try { await acquireCapture('game-check', dev()); const c = await getCalibration(routeName()); if (!c) { setCalMsg(''); setNeedCal(true); return; } }
          catch { /* the round reports the mic error */ }
          finally { releaseCapture('game-check'); }
        }
      }
      setNeedCal(false); setPending(null); setRunId(x => x + 1); setPhase('play');
    } finally { setChecking(false); setTimeout(() => { starting.current = false; }, 400); }
  };
  const save = async (res: RunResult) => { const o = await finishRun(cat, g, lv, res, mode); setOutcome({ ...o, score: res.score, misses: res.misses, mode }); setPhase('done'); };
  const btBlock = timed && mode === 'play' && bt;
  const calibrated = () => { const c = attempt.get().cal; setNeedCal(false); setCalMsg(c ? `Calibrated ✓ (${Math.round(c.offsetMs)} ms offset, saved for this input and posture). Ready when you are.` : 'Calibrated ✓'); };
  const roundText = l.round_s ? `${l.round_s} seconds.` : l.lives ? `${l.lives} lives.`
    : g.id === 'G_in_the_pocket' ? `${l.params.bars} bars${l.params.gap_bars ? `; the click drops out for ${l.params.gap_bars.join(', then ')} bars and you keep going` : ''}.`
      : g.id === 'G_box_runner' ? `The path ${l.params.passes} times through, to the click.`
        : g.id === 'G_song_run' ? `The whole song${l.params.passes > 1 ? ` ${l.params.passes} times through` : ''} at ${l.params.bpm} BPM${l.params.bpm_known ? '' : ' (the outline has no tempo, so 72)'}, one bar of count-in.` : '';
  const dItem = fromDaily && dd.day ? dd.items.find(i => i.game === g.id && i.level === l.id) : undefined;
  const dIdx = dItem ? dd.items.indexOf(dItem) : -1;
  const dNext = dIdx >= 0 ? dd.items.find((_, i) => i !== dIdx && !dd.done[i]) : undefined;
  const ready = (
    <section class="card">
      {dItem ? <p class="note small">🎯 Daily Challenge: {dItem.why}</p> : null}
      <p>{g.blurb}</p>
      <ModeToggle g={g} mode={mode} set={pick} />
      {g.id === 'G_song_run' ? <SongRunSetup cat={cat} l={l} setup={song} set={v => { setSong(v); const all = { ...songViewPref.get() }; all[l.id] = { key: v.key, capo: v.capo }; songViewPref.set(all); }} /> : null}
      <p class="muted">{roundText} {timed ? 'Closer to the beat scores more' : g.id === 'G_change_sprint' ? 'Faster changes score more' : 'Faster answers score more'}; 8 in a row raises the combo. ★★ = 85% right, ★★★ = 95% right and {lv.target_score} points.{best ? ` Your best (${mode}): ${best.best_score}.` : ''}</p>
      {mode === 'play' ? <ListenNote chords={!!CHORD_GRADER[g.id]} timed={timed} /> : null}
      {assisted ? <p class="muted small">Chord checking is in <b>assisted</b> mode (Settings → Grading mode) until the phone audio check is done: {CONFIRM_AT_END.has(g.id) ? 'at the end you decide whether the round counts.' : 'if a right chord is marked wrong, tap “I played it right”.'}</p> : null}
      {(l.review_for || []).length ? <p class="muted small">★★ here counts as the review for {l.review_for!.join(', ')} when it's due.</p> : null}
      {btBlock ? <><p class="error">Bluetooth audio looks active. Its delay (150–300 ms) puts the click out of step with your playing, so click-timed games are off.</p>
        <p class="muted">Switch to the phone speaker or wired headphones, then <button class="small" onClick={() => void bluetoothOutputLikely().then(setBt)}>check again</button>.</p></> : null}
      {needCal ? <CalNeeded onDone={calibrated} /> : null}
      {calMsg && !needCal ? <p class="okText">{calMsg}</p> : null}
      {!needCal ? <button class="primary big" disabled={btBlock || checking} onClick={() => void go()}>{checking ? 'Checking the input…' : '▶ Start'}</button> : null}
    </section>
  );
  return (
    <div class="page game">
      <div class="crumbs"><a href="#/arcade">Arcade</a> › {fromDaily ? <><a href="#/daily">Daily Challenge</a> › </> : null}{g.name}</div>
      <h1>{ICON[g.id]} {g.name} <small class="muted">{l.name}</small></h1>
      {phase === 'ready' ? ready : phase === 'play' ? (
        <Play key={runId} cat={cat} g={g} l={lv} mode={mode} ghost={best?.ghost || []} assisted={assisted} song={song} focus={fromDaily ? dailyFocus(g, l) : []}
          onDone={async res => { res.graderMode = CHORD_GRADER[g.id] && mode === 'play' ? (assisted ? 'assisted' : 'auto') : undefined;
            if (assisted && CONFIRM_AT_END.has(g.id)) { setPending(res); setPhase('confirm'); } else await save(res); }}
          onQuit={() => setPhase('ready')} onRestart={() => void go()} />
      ) : phase === 'confirm' && pending ? (
        <section class="card result">
          <h3>Check this round</h3>
          <p>The app heard <b>{pending.correct} of {pending.total}</b> {g.id === 'G_song_run' ? 'bars' : 'answers'} right ({pending.total ? Math.round(pending.correct / pending.total * 100) : 0}%), {pending.score} points.</p>
          {pending.misses.length ? <><h3>It marked these wrong</h3><ul class="misses">{tally(pending.misses).map(([m, n]) => <li>{m}{n > 1 ? `, ${n} times` : ''}</li>)}</ul></> : null}
          <p class="muted small">Assisted mode: chord checking hasn’t been confirmed on this phone yet. If that matches what you played, count it; if the app clearly misheard, don’t, and the round isn’t saved.</p>
          <div class="row"><button class="primary" onClick={() => { const r = pending; setPending(null); void save(r); }}>Count it ✓</button><button onClick={() => { setPending(null); setPhase('ready'); }}>Doesn't count</button></div>
        </section>
      ) : outcome ? (
        <section class="card result pass">
          <h3><Stars n={outcome.stars} /> {outcome.stars === 3 ? 'Perfect!' : outcome.stars === 2 ? 'Great round' : outcome.stars === 1 ? 'Round complete' : 'Round over'} <small class="muted">{MODE_LABEL[outcome.mode]}</small></h3>
          <div class="stats">
            <div><b>{outcome.score}</b><span>{outcome.pb ? (outcome.prevBest ? `new best! (was ${outcome.prevBest})` : 'first score') : `best ${best?.best_score ?? outcome.score}`}</span></div>
            <div><b>{Math.round(outcome.accuracy * 100)}%</b><span>right</span></div>
            <div><b>+{outcome.xp}</b><span>XP</span></div>
          </div>
          {outcome.badges.length ? <p class="note badgenote">🏅 New badge{outcome.badges.length > 1 ? 's' : ''}: {outcome.badges.map(x => x.name).join(', ')}</p> : null}
          {outcome.reviewed.length ? <p class="note">That counted as your review for {outcome.reviewed.join(', ')}.</p> : null}
          {dIdx >= 0 ? <p class="note">🎯 Daily Challenge: {dd.done.filter(Boolean).length} of {dd.items.length} done{dd.completed ? ' · complete, +30 XP ✓' : ''}.</p> : null}
          {outcome.misses.length ? <><h3>To work on</h3><ul class="misses">{tally(outcome.misses).map(([m, n]) => <li>{m}{n === 2 ? ', twice' : n > 2 ? `, ${n} times` : ''}</li>)}</ul></> : null}
          <ModeToggle g={g} mode={mode} set={pick} />
          <div class="row">
            <button class="primary" onClick={() => void go()}>Replay</button>
            {dNext ? <a class="btn" href={dNext.kind === 'game' ? `#/arcade/${dNext.game}/${dNext.level}/daily` : `#/lesson/${dNext.lesson}`}>Next challenge ›</a>
              : next && unlocked(cat, g, next) ? <a class="btn" href={`#/arcade/${g.id}/${next.id}`}>Next level ›</a> : null}
            <a class="btn" href={fromDaily ? '#/daily' : '#/arcade'}>{fromDaily ? 'Daily Challenge' : 'Arcade'}</a>
          </div>
        </section>
      ) : <p class="muted">Saving…</p>}
    </div>
  );
}
/** Song Run setup: key (any of 12), capo (0–7, the shapes shown), bars per chord (outlines have no bar lengths). */
function SongRunSetup({ cat, l, setup, set }: { cat: Catalog; l: GameLevel; setup: SongSetup; set: (s: SongSetup) => void }) {
  const o = cat.outlineById[l.params.outline];
  const opts = capoOptions(setup.key);
  const per: BarsPerChord[] = l.params.bars_per_chord || ['1'];
  return (
    <div class="songsetup">
      <label class="field">Key <select value={setup.key} onChange={e => { const k = (e.target as HTMLSelectElement).value; set({ ...setup, key: k, capo: 0 }); }}>{KEY_NAMES.map(k => <option value={k}>{k}{k === o.chart_key ? ' (chart)' : ''}</option>)}</select></label>
      <label class="field">Capo <select value={String(setup.capo)} onChange={e => set({ ...setup, capo: +(e.target as HTMLSelectElement).value })}>{[0, 1, 2, 3, 4, 5, 6, 7].map(c => { const sh = opts.find(x => x.capo === c); return <option value={String(c)}>{c ? `Capo ${c}` : 'No capo'}{sh ? ` (${sh.shapes} shapes)` : ''}</option>; })}</select></label>
      <label class="field">Bars per chord <select value={setup.per} onChange={e => set({ ...setup, per: (e.target as HTMLSelectElement).value as BarsPerChord })}>{per.map(p => <option value={p}>{p === '0.5' ? '½ bar' : p === '1' ? '1 bar' : '2 bars'}</option>)}</select></label>
      <p class="muted small">The outline lists each chord once without bar lengths, so pick how long each lasts. Chords are checked by family: G2, Gsus and G/B all count as G.{o.practice_for.length ? <> Taught in {o.practice_for.map((id, i) => <>{i ? ', ' : ''}<a href={`#/lesson/${id}`}>{id}</a></>)}.</> : null} <a href={`#/song/${o.id}`}>See the chart</a></p>
    </div>
  );
}
function tally(a: string[]): [string, number][] { const m = new Map<string, number>(); a.forEach(x => m.set(x, (m.get(x) || 0) + 1)); return [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8); }

// ---------- the shared frame ----------
function Play({ cat, g, l, mode, ghost, assisted, song, focus, onDone, onQuit, onRestart }: { cat: Catalog; g: Game; l: GameLevel; mode: Mode; ghost: [number, number][]; assisted: boolean; song: SongSetup; focus: { string: number; fret: number }[]; onDone: (r: RunResult) => void; onQuit: () => void; onRestart: () => void }) {
  const r = useMemo(() => rng(Date.now() & 0xffffffff), []);
  const [paused, setPaused] = useState(false);
  const [sheet, setSheet] = useState<'tuner' | 'metro' | null>(null);
  const timed = NO_RESUME.has(g.id);
  // Change Sprint keeps its own minute (after a 3-2-1), so the shared timer doesn't run for it
  const lr = useMemo(() => (g.id === 'G_change_sprint' ? { ...l, round_s: undefined } : l), [l]);
  // Play mode: the round and question clocks wait for the mic. If it can't be opened the round stops here, with
  // nothing saved and no misses recorded. (The game below clears any old error as it asks for the mic.)
  const earsOn = useSelect(ears, e => e.on);
  const [micError, setMicError] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'play') return;
    const check = (e: { error: string | null }) => { if (e.error) setMicError(e.error); };
    const off = ears.subscribe(check); check(ears.get());
    return off;
  }, []);
  // heatmap answers are written when the round ends (or is left)
  useEffect(() => () => { void flushHeat(); }, []);
  // click-timed games score 100 per beat, so an eighth note is worth 50 and a sixteenth 25
  const base = g.id === 'G_box_runner' ? 100 / l.params.sub : g.id === 'G_in_the_pocket' ? 100 / patternFeel(cat.strums.find(s => s.id === l.params.pattern)!).sub : 100;
  const finishedRule = (correct: number, timeUp: boolean) => (g.id === 'G_note_drop' ? correct >= 20 : timeUp);
  const { round, ghost: gh, durationS, stRef, roundS, extra } = useRound(lr, mode, base, paused, finished => {
    const s = stRef.current;
    onDone({ score: s.score, correct: s.correct, total: s.total, maxCombo: s.maxCombo, finished, durationS: durationS(), misses: s.misses, ghost: gh.current, maxStreak: s.bestStreak, extra: Object.keys(extra.current).length ? extra.current : undefined });
  }, finishedRule, mode === 'play' && !earsOn);
  // The game owns the click while a round runs: no metronome or tuner from the sheets once you resume.
  useEffect(() => { if (!paused) { setSheet(null); if (metro.get().running) stopMetronome(); if (tuner.get().on) stopTuner(); } }, [paused]);
  // Locking the phone or switching apps pauses the round (and closes the mic).
  useEffect(() => { const f = () => { if (document.visibilityState === 'hidden') setPaused(true); }; document.addEventListener('visibilitychange', f); return () => document.removeEventListener('visibilitychange', f); }, []);
  const ghostScore = (() => { let v = 0; for (const [t, sc] of ghost) if (t <= round.elapsed) v = sc; return v; })();
  const ghostMax = Math.max(1, ghost.length ? ghost[ghost.length - 1][1] : 0, round.score);
  if (micError) return (
    <section class="card micerror" role="alert">
      <h3>The microphone could not be opened</h3>
      <p class="error">{micError}</p>
      <p class="muted small">The round stopped. Nothing was saved and nothing counts as a miss.</p>
      <div class="row"><button class="primary" onClick={onRestart}>↻ Try again</button><button onClick={onQuit}>✕ Quit</button></div>
    </section>
  );
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
      {g.id === 'G_note_drop' ? <NoteDrop l={l} round={round} r={r} focus={focus} />
        : g.id === 'G_fret_finder' ? <FretFinder l={l} round={round} r={r} focus={focus} />
        : g.id === 'G_call_the_number' && mode === 'play' ? <CallNumberPlay cat={cat} l={l} round={round} r={r} assisted={assisted} />
        : g.id === 'G_triad_hunt' ? <TriadHunt l={l} round={round} r={r} assisted={assisted} />
        : g.id === 'G_change_sprint' ? <ChangeSprint l={l} round={round} />
        : g.id === 'G_song_run' ? <SongRun cat={cat} l={l} round={round} setup={song} />
          : g.id === 'G_octave_jump' ? <OctaveJump l={l} round={round} r={r} />
            : g.id === 'G_box_runner' ? <BoxRunner cat={cat} l={l} round={round} r={r} />
              : g.id === 'G_in_the_pocket' ? <InThePocket cat={cat} l={l} round={round} />
                : g.id === 'G_delay_math' ? <DelayMath l={l} round={round} r={r} />
                  : <ChoiceGame cat={cat} g={g} l={l} round={round} r={r} />}
      {paused ? (
        <div class="pausemenu" role="dialog" aria-label="Paused">
          <div class="card">
            <h2>{timed ? 'Round stopped' : 'Paused'}</h2>
            {timed ? <p class="muted small">{g.id === 'G_change_sprint' ? 'The minute can’t pick up where it stopped' : 'A click-timed round can’t pick up mid-bar'}; restart it when you’re ready.</p> : null}
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
