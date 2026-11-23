// Chord attempt runner (M8): chord_accuracy (a progression, to a click or at your own pace) and changes_per_min
// (60 s per pair). Live "expected X · heard ✓/✗", then a result card with what was heard on each chord.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Catalog, Lesson } from '../catalog';
import { useStore } from '../store';
import { attempt, runChordAttempt, cancelAttempt, confirmAttempt, startNextPair, finishPitchNow, getLadder, posture, type ChordOutcome, type ChordLive } from '../grading/runner';
import { chordSetup, chordCoach, type ChordSetup, type ChordVariant } from '../grading/chord';
import { graderMode, chordGraderKey } from '../grading/modes';
import type { Ladder } from '../grading/timing';
import { bluetoothOutputLikely, tunedThisSession, capture, routeLabel, ctxNow } from '../audio/engine';
import { meterInfo } from '../audio/meter';
import { inputPref, TunerPanel } from './Tools';
import { EVENT_TEXT } from '../progress';
import { saveStatus } from '../progressStore';
import { Beats } from './Timing';
import { ChordDiagram } from './Diagrams';

const dev = () => inputPref.get() || undefined;
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Name for a heard chord id in results (decoys and no-capo shapes get plain words). */
const heardName = (id: string, names: Record<string, string>) =>
  id === 'unclear' ? 'not clear' : id === 'none' ? 'no strum' : id.startsWith('nocapo:') ? `${names[id.slice(7)] ?? '?'} without capo` : id.startsWith('decoy:') ? names[id.slice(6)] ?? id.slice(6) : names[id] ?? id;

/** Diagrams of the shapes to play (as fretted, the capo is shown separately). Hidden on a number chart. */
function Shapes({ setup, v }: { setup: ChordSetup; v: ChordVariant | null }) {
  const refs = setup.kind === 'changes' ? [...new Set(setup.pairs.flat())] : setup.ex.pick === 'random' ? [...new Set(setup.ex.variants.flatMap(x => x.chords))] : [...new Set(v!.chords)];
  return <div class="chords">{refs.map(r => { const vo = setup.ex.voicings[r]; return vo.frets.map((f, i) => <ChordDiagram name={vo.frets.length > 1 ? `${vo.name} (${i + 1})` : vo.name} shape={{ frets: f }} />); })}</div>;
}

function Countdown({ at }: { at: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 100); return () => clearInterval(t); }, []);
  const left = at - ctxNow();
  return <span>{left > 0 ? Math.ceil(left) : 0}</span>;
}

export function ChordPanel({ cat, l, reviewDue, passed }: { cat: Catalog; l: Lesson; reviewDue: boolean; passed: boolean }) {
  const a = useStore(attempt);
  const cap = useStore(capture);
  const save = useStore(saveStatus);
  const setup = useMemo(() => chordSetup(l, cat), [l.id]);
  const gm = graderMode(chordGraderKey(l));
  const [ladder, setLadder] = useState<Ladder | null>(null);
  const [bt, setBt] = useState(false);
  const [tune, setTune] = useState(false);
  const [skipTune, setSkipTune] = useState(false);
  const [choice, setChoice] = useState(0);
  const mine = a.lessonId === l.id && a.kind === 'chord';
  const busy = mine && (a.phase === 'starting' || a.phase === 'countin' || a.phase === 'playing');
  const timed = setup?.kind === 'accuracy' && setup.ex.pace === 'timed';
  useEffect(() => { if (setup?.kind === 'accuracy' && setup.ladder) void getLadder(l).then(setLadder); }, [l.id, a.phase]);
  useEffect(() => { void bluetoothOutputLikely().then(setBt); }, []);
  useEffect(() => () => { const s = attempt.get(); if (s.kind === 'chord' && (s.phase === 'starting' || s.phase === 'countin' || s.phase === 'playing')) cancelAttempt(); }, []);
  if (!setup) return <p class="error">This lesson has no chord exercise to grade.</p>;
  const goalOnly = reviewDue || passed;
  const goalBpm = setup.kind === 'accuracy' ? setup.bpm : null;
  const tempo = timed ? (setup.kind === 'accuracy' && setup.ladder && !goalOnly ? ladder?.bpm ?? Math.round(goalBpm! * 0.65) : goalBpm) : null;
  const start = () => { setTune(false); void runChordAttempt(l, cat, { bpm: tempo ?? undefined, deviceId: dev(), mode: gm, variant: choice }); };

  if (bt && timed && !busy) return (
    <div><p class="error">Bluetooth audio looks active. Its delay (150–300 ms) puts the click out of step with your strumming, so graded attempts with a click are off.</p>
      <p class="muted">Switch to the phone speaker or wired headphones, then <button class="small" onClick={() => void bluetoothOutputLikely().then(setBt)}>check again</button>.</p></div>);

  const c = mine ? a.chord : null;
  if (busy && c) {
    if (c.kind === 'changes') return <ChangesRun c={c} target={setup.kind === 'changes' ? setup.target : 0} />;
    const cur = c.idx;
    return (
      <div class="running chordrun">
        {c.label ? <p class="keyline"><b>{c.label}</b></p> : null}
        {c.pace === 'timed' && setup.kind === 'accuracy' ? <>
          <p class="muted">{a.bpm} BPM · {setup.ex.meter} · {setup.ex.beats_per_chord === meterInfo(setup.ex.meter).beats ? 'one bar per chord' : `${setup.ex.beats_per_chord} beats per chord`}</p>
          <Beats n={meterInfo(setup.ex.meter).beats} on={a.beat < 0 ? -1 : a.beat % meterInfo(setup.ex.meter).beats} count={a.phase !== 'playing'} />
          <p>{a.phase === 'starting' ? 'Opening the mic…' : c.cue === 'play' ? <b>Strum!</b> : 'Count-in: 1 bar, then strum'}</p>
        </> : <p><b>Strum each chord {c.perBox} times, then move on.</b> <span class="strumdots">{Array.from({ length: c.perBox || 0 }, (_, i) => <i class={i < c.inBox ? 'on' : ''} />)}</span></p>}
        <p class="nowline"><span>Expected <b class="exp">{c.boxes[cur]}</b></span><span>Heard <b class={`hear ${c.last ? (c.last.ok ? 'ok' : 'bad') : ''}`}>{c.last ? (c.last.ok ? '✓' : `✗ ${c.last.heard ?? '?'}`) : '–'}</b></span></p>
        <ol class="notechips chordchips">{c.boxes.map((b, i) => <li class={`${c.status[i]} ${i === cur ? 'cur' : ''}`}><b>{b}</b></li>)}</ol>
        <div class="row">{c.pace === 'own' ? <button class="primary" onClick={finishPitchNow}>I'm done</button> : null}<button onClick={cancelAttempt}>Cancel</button></div>
      </div>);
  }

  const r = mine && a.phase === 'result' ? a.chordResult : null;
  const ex = setup.ex;
  const v = setup.kind === 'accuracy' ? (ex as typeof setup.ex).variants[setup.ex.pick === 'choose' ? choice : 0] : null;
  const atGoal = r && r.bpm !== null && goalBpm !== null && setup.kind === 'accuracy' && setup.ladder ? r.bpm >= goalBpm : true;
  const desc = setup.kind === 'changes'
    ? `${setup.pairs.length === 1 ? 'One minute' : `${setup.pairs.length} minutes, one per pair`}: switch back and forth as fast as you can while every strum rings as the chord. Goal: ${setup.target} changes a minute${setup.pairs.length > 1 ? ' on every pair' : ''}.`
    : setup.ex.pace === 'timed'
      ? `${setup.ex.variants[0].chords.length} chords to a click, ${goalOnly || !setup.ladder || (tempo ?? 0) >= goalBpm! ? `at ${goalBpm} BPM` : `at ${tempo} BPM, working up to ${goalBpm}`}. Strum any pattern; one bar of count-in. Goal: ${pct(setup.ratio)} of the bars right (a bar is right when most of its strums sound like its chord).`
      : `${setup.ex.variants[0].chords.length} chords at your own pace, ${setup.ex.strums_per_chord} strums each. Goal: ${pct(setup.ratio)} of ${setup.ex.focus?.length ? `the ${setup.ex.focus.map(f => setup.ex.voicings[f].name).join(' and ')} strums, each chord on its own` : 'strums'} sound like the right chord.`;
  return (
    <div>
      {r ? <ChordResult r={r} setup={setup} pending={!!a.pending} atGoal={atGoal} /> : mine && a.phase === 'error' ? <p class="error">{a.message}</p> : null}
      {r && !a.pending ? <>
        {a.event && EVENT_TEXT[a.event] ? <p class="note">{EVENT_TEXT[a.event]}</p> : null}
        {save.state === 'saved' ? <p class="savedtick">✓ Saved on this phone</p> : null}
        {a.ladder && !goalOnly && a.prevLadderBpm !== undefined && a.ladder.bpm !== a.prevLadderBpm ? <p class="note">{a.ladder.bpm > a.prevLadderBpm ? 'Practice tempo up: ' : 'Practice tempo down: '}next attempt at {a.ladder.bpm} BPM.</p> : null}
      </> : null}
      {!tunedThisSession && !skipTune && !r ? (
        <div class="quicktune">{tune ? <TunerPanel compact /> : <p class="muted">Not tuned yet this session (chords are checked against exact pitches). <button class="small" onClick={() => setTune(true)}>Quick tune</button> <button class="small" onClick={() => setSkipTune(true)}>Skip</button></p>}</div>
      ) : null}
      {!r || !a.pending ? <>
        <p class="muted">{desc} {gm === 'assisted' ? 'Assisted mode: the app shows what it heard and you confirm.' : ''}</p>
        {setup.kind === 'accuracy' && setup.ex.notes ? <p class="muted small">{setup.ex.notes}</p> : null}
        {setup.kind === 'accuracy' && setup.ex.pick === 'choose' ? <label class="field inline">Play it <select value={choice} onChange={e => setChoice(+(e.target as HTMLSelectElement).value)}>
          {setup.ex.variants.map((x, i) => <option value={i}>{x.capo ? `${x.label}` : `${x.label} (no capo)`}</option>)}</select></label> : null}
        {setup.kind === 'accuracy' && setup.ex.pick === 'random' ? <p class="muted small">When you start, the app names a key ({setup.ex.variants.map(x => x.key).join(', ')}){setup.ex.show === 'numbers' ? ' and shows the numbers' : ' and the capo and shapes for it'}.</p> : null}
        {setup.kind === 'changes' ? <p class="chordline">{setup.pairs.map(p => <span>{p.map(x => setup.ex.voicings[x].name).join(' ↔ ')}</span>)}</p>
          : setup.ex.show === 'chords' && v && setup.ex.pick !== 'random' ? <p class="chordline">{v.capo ? <span class="capo">capo {v.capo}</span> : null}{v.chords.map(x => <span>{setup.ex.voicings[x].name}</span>)}</p> : null}
        {setup.kind === 'changes' || setup.ex.show === 'chords' ? <details class="shapes"><summary>Shapes</summary><Shapes setup={setup} v={v} /></details> : null}
        <div class="row wrap"><button class="primary" onClick={start}>{r ? 'Go again' : 'Start'}{tempo ? ` at ${tempo} BPM` : ''}</button></div>
        <p class="muted small">Listening {cap.label ? `with ${routeLabel()}` : 'with the selected input'} · {posture()} · <a href="#/settings">input & grading</a></p>
      </> : null}
    </div>
  );
}

/** One-minute changes, live: 3-2-1 (silent: the mic is open), the count, the chord to change to, time left. */
function ChangesRun({ c, target }: { c: ChordLive; target: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 100); return () => clearInterval(t); }, []);
  const [x, y] = c.pairs[c.pairIdx] || ['', ''];
  const counting = c.startsAt !== null && ctxNow() < c.startsAt;
  return (
    <div class="running chordrun">
      <p class="muted">Pair {c.pairIdx + 1} of {c.pairs.length} · goal {target} a minute</p>
      <p class="pairname"><b>{x} ↔ {y}</b></p>
      {c.waiting ? <>
        <p>Rest your hand. Next pair starts in <Countdown at={c.ends!} /> s.</p>
        <div class="row"><button class="primary" onClick={startNextPair}>Start now</button><button onClick={cancelAttempt}>Cancel</button></div>
      </> : <>
        {counting ? <p class="bigcount">Fingers on {x}… <Countdown at={c.startsAt!} /></p> : <>
          <div class="changecount"><b>{c.count}</b><span>changes</span></div>
          <p class="nowline"><span>Next <b class="exp">{c.nextUp}</b></span><span>Heard <b class={`hear ${c.last?.heard ? 'ok' : ''}`}>{c.last ? (c.last.heard ?? '?') : '–'}</b></span></p>
          <p class="muted">Time left <Countdown at={c.ends!} /> s</p>
        </>}
        <button onClick={cancelAttempt}>Cancel</button>
      </>}
    </div>);
}

function ChordResult({ r, setup, pending, atGoal }: { r: ChordOutcome; setup: ChordSetup; pending: boolean; atGoal: boolean }) {
  const names = r.names;
  const head = pending ? 'Check this attempt' : r.met ? (atGoal ? '✓ Passed this attempt' : `✓ Clean at ${r.bpm} BPM`) : 'Not yet';
  if (r.kind === 'changes') return (
    <div class={`result ${r.met ? 'pass' : 'fail'}`}>
      <h3>{head}</h3>
      <ul class="list changelist">{r.changes.map(c => <li class={c.met ? 'okText' : 'error'}>{c.met ? '✓' : '✗'} {c.names.join(' ↔ ')} <b>{Math.round(c.perMin)}</b> a minute <small>{c.changes} changes in {Math.round(c.windowS)} s · goal {c.target}{c.unclear ? ` · ${c.unclear} strum${c.unclear > 1 ? 's' : ''} not clearly either chord` : ''}</small></li>)}</ul>
      <p>{r.met ? 'Every pair at the goal.' : r.changes.some(c => c.unclear > c.changes / 3) ? 'Many strums weren’t clearly either chord: let each chord ring for a moment before you change.' : 'Keep at it: smaller finger movements, and keep strumming even when the chord isn’t ready yet.'}</p>
      {pending ? <Assist met={r.met} /> : null}
    </div>);
  const g = r.grade!;
  const rows = Object.entries(g.confusion);
  return (
    <div class={`result ${r.met ? 'pass' : 'fail'}`}>
      <h3>{head}</h3>
      {r.label ? <p class="muted">{r.label}</p> : null}
      <div class="stats">
        <div><b>{g.correct}/{g.graded}</b><span>{g.unit === 'bars' ? 'bars right' : g.focus.length ? `${g.focus.map(f => names[f.ref]).join(' + ')} strums right` : 'strums right'} (goal {pct(g.target)})</span></div>
        {g.focus.length ? g.focus.map(f => <div class={f.met ? '' : 'missed'}><b>{pct(f.ratio)}</b><span>{names[f.ref]}: {f.correct}/{f.graded} {f.met ? '✓' : `(needs ${pct(g.target)})`}</span></div>)
          : <div><b>{pct(g.ratio)}</b><span>{g.unit === 'bars' ? 'a bar is right when most of its strums are' : 'right chord'}</span></div>}
        {g.focus.length ? null : g.missedBoxes || g.owed ? <div><b>{g.missedBoxes || g.owed}</b><span>{g.owed ? 'strums not played' : 'chords with no strum'}</span></div> : <div><b>{g.boxes.filter(b => b.strums && b.ok === b.strums).length}/{g.boxes.length}</b><span>chords all right</span></div>}
      </div>
      <ol class="notechips chordchips">{g.boxes.map((b, i) => {
        const wrong = g.strums.filter(s => s.box === i && !s.skipped && !s.ok).map(s => heardName(s.heard ?? 'unclear', names));
        const top = wrong.length ? Object.entries(wrong.reduce<Record<string, number>>((m, w) => ({ ...m, [w]: (m[w] || 0) + 1 }), {})).sort((x, y) => y[1] - x[1])[0][0] : null;
        return <li class={!b.strums ? 'miss' : b.ok === b.strums ? 'ok' : b.ok >= b.strums / 2 ? 'mixed' : 'miss'} title={setup.ex.voicings[b.ref]?.where}>
          <b>{b.label}</b><small>{b.strums ? `${b.ok}/${b.strums}` : 'no strum'}{top ? ` · ${top}` : ''}</small></li>;
      })}</ol>
      <table class="confusion"><thead><tr><th>Expected</th><th>Right</th><th>Heard instead</th></tr></thead>
        <tbody>{rows.map(([e, row]) => {
          const ok = row[e] || 0, other = Object.entries(row).filter(([h]) => h !== e);
          return <tr><td>{names[e]}{r.show === 'numbers' ? <small> ({setup.ex.voicings[e]?.where})</small> : null}</td><td>{ok}</td><td>{other.length ? other.map(([h, n]) => `${heardName(h, names)} ×${n}`).join(', ') : '–'}</td></tr>;
        })}</tbody></table>
      <p>{chordCoach(g, names)}</p>
      {r.met && !atGoal ? <p class="muted">Practice tempo builds you up to the goal; only attempts at the goal tempo count toward passing.</p> : null}
      {pending ? <Assist met={r.met} /> : null}
    </div>);
}

function Assist({ met }: { met: boolean }) {
  return <div class="assist">
    <p class="note">Assisted mode: the app thinks this {met ? 'meets' : 'misses'} the goal. Does that match what you played?</p>
    <div class="row"><button class="primary" onClick={() => void confirmAttempt(true)}>Count it ✓</button><button onClick={() => void confirmAttempt(false)}>Doesn't count</button></div>
  </div>;
}
