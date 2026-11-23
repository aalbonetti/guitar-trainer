// Timing attempt runner (count-in → play → result card) and strum calibration UI.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Catalog, Lesson } from '../catalog';
import { useStore } from '../store';
import { attempt, runCalibration, runTimingAttempt, cancelAttempt, getCalibration, getLadder, allCalibrations, posture, routeName, type Calibration } from '../grading/runner';
import { lessonFeel, coachLine, type TimingCriteria, type TimingResult } from '../grading/timing';
import type { Ladder } from '../grading/timing';
import { bluetoothOutputLikely, tunedThisSession, capture, routeLabel } from '../audio/engine';
import { inputPref, TunerPanel } from './Tools';
import { EVENT_TEXT } from '../progress';
import { saveStatus, progress } from '../progressStore';
import { isReviewDue, dayOf } from '../progress';
import { StrumGrid } from './Diagrams';

const dev = () => inputPref.get() || undefined;

/** The tempo a timing lesson is practiced at right now: the tempo-ladder BPM, or the goal once passed or when a review is due.
 *  Null for lessons without a tempo ladder. Used by the lesson tool bar and the lesson's click buttons, so every number agrees. */
export function usePracticeTempo(l: Lesson): { bpm: number; goal: number; atGoal: boolean } | null {
  const a = useStore(attempt); const pr = useStore(progress);
  const [ladder, setLadder] = useState<Ladder | null>(null);
  // timing lessons, and pitch/chord lessons played to a click (they have a bpm and a tempo ladder)
  const timing = l.pass_criteria.type === 'timing' || ((l.pass_criteria.type === 'pitch' || l.pass_criteria.type === 'chord_accuracy') && !!l.pass_criteria.bpm);
  useEffect(() => { if (timing) void getLadder(l).then(setLadder); }, [l.id, a.phase]);
  if (!timing) return null;
  const goal = (l.pass_criteria as unknown as TimingCriteria).bpm;
  const p = pr.lp[l.id];
  const atGoal = p?.state === 'passed' || isReviewDue(p, dayOf());
  const bpm = atGoal ? goal : Math.min(goal, ladder?.bpm ?? Math.round(goal * 0.65));
  return { bpm, goal, atGoal: atGoal || bpm >= goal };
}

export function Beats({ n, on, count }: { n: number; on: number; count: boolean }) {
  return <div class={`attbeats ${count ? 'count' : ''}`}>{Array.from({ length: n }, (_, i) => <i class={`${on === i ? 'on' : ''} ${i === 0 ? 'one' : ''}`} />)}</div>;
}

/** Shown in Settings and inside a lesson when this input + posture has no calibration yet. */
export function CalibrationCard({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const a = useStore(attempt);
  const [list, setList] = useState<Calibration[]>([]);
  const refresh = () => void allCalibrations().then(setList);
  useEffect(refresh, [a.phase]);
  // Only a calibration that finished after this card appeared counts: an old result left in the shared attempt
  // store (another input, the other fold posture) must not look like "calibrated" here.
  const stale = useRef(a.kind === 'calibration' && a.phase === 'result' ? a.calAt : undefined);
  useEffect(() => { if (a.kind === 'calibration' && a.phase === 'result' && a.calAt !== stale.current) onDone?.(); }, [a.phase, a.calAt]);
  const mine = a.kind === 'calibration';
  const busy = mine && (a.phase === 'starting' || a.phase === 'countin' || a.phase === 'playing');
  return (
    <div class="calib">
      {!compact ? <p class="muted">Every phone and input hears your guitar a little late. Calibration measures that delay so timing grades are fair. Do it once per input (phone mic, USB interface…) and per posture (folded or unfolded).</p> : null}
      <ol class="steps muted">
        <li>Lay your fretting hand lightly across the strings so they don't ring.</li>
        <li>Listen to 4 count-in clicks, then strum <b>on every click</b>: 16 strums.</li>
      </ol>
      {busy ? (
        <div class="running">
          <Beats n={4} on={a.beat < 0 ? -1 : a.beat % 4} count={a.phase !== 'playing'} />
          <p>{a.phase === 'playing' ? <b>Strum on each click · heard {a.heard}/16</b> : 'Count-in… get ready'}</p>
          <button onClick={cancelAttempt}>Cancel</button>
        </div>
      ) : <button class="primary" onClick={() => runCalibration(dev())}>{list.length ? 'Calibrate this input' : 'Calibrate (30 seconds)'}</button>}
      {mine && a.phase === 'result' && a.cal && a.calAt !== stale.current ? <p class="okText">Offset {a.cal.offsetMs.toFixed(0)} ms · spread {a.cal.spreadMs.toFixed(0)} ms · {a.cal.matched}/16 strums. {a.message}</p> : null}
      {mine && a.phase === 'error' ? <p class="error">{a.message}</p> : null}
      {!compact && list.length ? (
        <ul class="list callist">{list.map(c => <li>{c.input_route} · {c.posture}<small>{c.offset_ms.toFixed(0)} ms (±{c.spread_ms.toFixed(0)}) · {new Date(c.measured_at).toLocaleDateString()}</small></li>)}</ul>
      ) : null}
    </div>
  );
}

/** Per-strum timing chart: each expected strum is a bar, up = late, down = early. */
export function TimingChart({ r, maxErrMs, slotMs }: { r: TimingResult; maxErrMs: number; slotMs: number }) {
  const W = 320, H = 90, mid = H / 2, n = r.slots.length, dx = W / n, lim = Math.min(slotMs / 2, Math.max(maxErrMs * 2.5, 60));
  const y = (e: number) => mid - Math.max(-1, Math.min(1, e / lim)) * (mid - 4);
  const band = (maxErrMs / lim) * (mid - 4);
  return (
    <svg class="tchart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Timing of each strum: above the line is late, below is early">
      <rect x="0" y={mid - band} width={W} height={band * 2} class="okband" />
      <line x1="0" x2={W} y1={mid} y2={mid} class="axis" />
      {r.slots.map((s, i) => {
        const x = i * dx + dx / 2;
        if (!s.expected) return s.onset !== null ? <circle cx={x} cy={mid} r={Math.min(3, dx / 2)} class="extra" /> : null;
        if (s.errMs === null) return <line x1={x} x2={x} y1={mid - 3} y2={mid + 3} class="miss" />;
        return <line x1={x} x2={x} y1={mid} y2={y(s.errMs)} class={Math.abs(s.errMs) <= maxErrMs ? 'hit' : 'off'} style={{ strokeWidth: Math.max(1.5, dx * 0.6) }} />;
      })}
      <text x="2" y="10" class="lbl">late</text><text x="2" y={H - 3} class="lbl">early</text>
    </svg>
  );
}

export function TimingPanel({ cat, l, reviewDue, passed }: { cat: Catalog; l: Lesson; reviewDue: boolean; passed: boolean }) {
  const a = useStore(attempt);
  const cap = useStore(capture);
  const save = useStore(saveStatus);
  const crit = l.pass_criteria as unknown as TimingCriteria;
  const feel = lessonFeel(l, cat);
  const [ladder, setLadder] = useState<Ladder | null>(null);
  const [hasCal, setHasCal] = useState<boolean | null>(null);
  const [bt, setBt] = useState(false);
  const [tune, setTune] = useState(false);
  const [skipTune, setSkipTune] = useState(false);
  const mine = a.lessonId === l.id && a.kind === 'timing';
  useEffect(() => { void getLadder(l).then(setLadder); }, [l.id, a.phase]);
  useEffect(() => { void getCalibration(routeName()).then(c => setHasCal(cap.label ? !!c : null)); }, [cap.label, a.phase]);
  useEffect(() => { void bluetoothOutputLikely().then(setBt); }, []);
  useEffect(() => () => { if (attempt.get().phase === 'countin' || attempt.get().phase === 'playing') cancelAttempt(); }, []);
  const goalOnly = reviewDue || passed; // reviews and practice after passing run at goal tempo
  const ladderBpm = goalOnly ? crit.bpm : ladder?.bpm ?? Math.round(crit.bpm * 0.65);
  const busy = (a.phase === 'starting' || a.phase === 'countin' || a.phase === 'playing') && a.kind !== null;
  const needCal = mine && a.phase === 'error' && a.message === 'needs-calibration';
  const start = (bpm: number) => { setTune(false); void runTimingAttempt(l, cat, { bpm, deviceId: dev() }); };
  const pattern = feel.patternId ? cat.strums.find(s => s.id === feel.patternId) : null;

  if (bt) return (
    <div><p class="error">Bluetooth audio looks active. Its delay (150–300 ms) makes timing grades meaningless, so graded attempts are off.</p>
      <p class="muted">Switch to the phone speaker or wired headphones, then <button class="small" onClick={() => void bluetoothOutputLikely().then(setBt)}>check again</button>.</p></div>);

  const showingResult = mine && a.phase === 'result'; // a finished result wins, even if the posture changed mid-attempt
  if (needCal || hasCal === false && !busy && !showingResult && !(a.kind === 'calibration')) return (
    <div><p><b>First, a 30-second calibration</b> for {cap.label || 'this input'} ({posture()}).</p><CalibrationCard compact onDone={() => { setHasCal(true); }} /></div>);
  if (a.kind === 'calibration' && (busy || a.phase === 'error')) return <CalibrationCard compact onDone={() => setHasCal(true)} />;

  if (mine && busy) return (
    <div class="running">
      <p class="muted">{a.bpm} BPM · {crit.bars} bars{pattern ? ` · ${pattern.name}` : ''}</p>
      <Beats n={feel.beats} on={a.beat < 0 ? -1 : a.beat % feel.beats} count={a.phase !== 'playing'} />
      <p>{a.phase === 'playing' ? <b>Play! · heard {a.heard}/{a.expected}</b> : a.phase === 'countin' ? 'Count-in: 1 bar, then play' : 'Opening the mic…'}</p>
      {pattern ? <StrumGrid strum={pattern} active={a.step} /> : null}
      <button onClick={cancelAttempt}>Cancel</button>
    </div>);

  const r = mine && a.phase === 'result' ? a.result : null;
  const atGoal = r ? a.bpm >= crit.bpm : false;
  return (
    <div>
      {r ? (
        <div class={`result ${r.met ? 'pass' : 'fail'}`}>
          <h3>{r.met ? (atGoal ? '✓ Passed this attempt' : `✓ Clean at ${a.bpm} BPM`) : 'Not yet'}</h3>
          <div class="stats">
            <div><b>{isFinite(r.maeMs) ? r.maeMs.toFixed(0) : '–'} ms</b><span>avg error (goal ≤ {crit.max_err_ms})</span></div>
            <div><b>{Math.round(r.slotsRight * 100)}%</b><span>{feel.steps?.includes('-') ? 'strums + rests right' : 'strums heard on time'} (goal 90)</span></div>
            <div><b>{Math.abs(r.biasMs).toFixed(0)} ms</b><span>{Math.abs(r.biasMs) < 3 ? 'right on the beat' : r.biasMs > 0 ? 'behind on average' : 'ahead on average'}</span></div>
          </div>
          <TimingChart r={r} maxErrMs={crit.max_err_ms} slotMs={(60000 / a.bpm) / feel.sub} />
          <p>{coachLine(r, crit.max_err_ms)}</p>
          {r.met && !atGoal ? <p class="muted">Practice tempo builds you up to {crit.bpm} BPM; only attempts at {crit.bpm} count toward passing.</p> : null}
          {a.event && EVENT_TEXT[a.event] ? <p class="note">{EVENT_TEXT[a.event]}</p> : null}
          {save.state === 'saved' ? <p class="savedtick">✓ Saved on this phone</p> : null}
          {a.ladder && !goalOnly && a.prevLadderBpm !== undefined && a.ladder.bpm !== a.prevLadderBpm ? <p class="note">{a.ladder.bpm > a.prevLadderBpm ? (r.great ? 'Really tight! Fast track: ' : 'Practice tempo up: ') : 'Practice tempo down: '}next attempt at {a.ladder.bpm} BPM.</p> : null}
        </div>
      ) : mine && a.phase === 'error' ? <p class="error">{a.message}</p> : null}

      {!tunedThisSession && !skipTune && !r ? (
        <div class="quicktune">{tune ? <TunerPanel compact /> : <p class="muted">Not tuned yet this session. <button class="small" onClick={() => setTune(true)}>Quick tune</button> <button class="small" onClick={() => setSkipTune(true)}>Skip</button></p>}</div>
      ) : null}
      {a.kind === 'calibration' && a.phase === 'result' && a.cal ? <p class="okText">Calibrated: {a.cal.offsetMs.toFixed(0)} ms offset. Ready when you are.</p> : null}
      <p class="muted">{goalOnly || ladderBpm >= crit.bpm ? `${reviewDue ? 'Review' : 'Play'} at the goal tempo, ${crit.bpm} BPM.` : `Practice tempo ${ladderBpm} BPM, working up to ${crit.bpm}. It goes up after 3 clean attempts in a row, or straight away after a really tight one.`} Prop the phone near the guitar; one bar of count-in.</p>
      <div class="row wrap">
        <button class="primary" onClick={() => start(ladderBpm)}>{r ? 'Go again' : 'Start'} at {ladderBpm} BPM</button>
      </div>
      <p class="muted small">Grading {cap.label ? `with ${routeLabel()}` : 'with the selected input'} · {posture()} · <a href="#/settings">calibration</a></p>
    </div>
  );
}
