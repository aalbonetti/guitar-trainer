// Pitch attempt runner (M7): tuning and bends (hold a target), note matching to a click or at your own pace.
// Live "hearing X / expected Y", then a result card that shows which notes were missed and what was heard.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Catalog, Lesson } from '../catalog';
import { useStore } from '../store';
import { attempt, runPitchAttempt, cancelAttempt, confirmPitch, skipPitchTarget, finishPitchNow, getLadder, posture } from '../grading/runner';
import { pitchSetup, pitchCoach } from '../grading/pitch';
import { graderMode, pitchGraderKey } from '../grading/modes';
import type { Ladder } from '../grading/timing';
import { bluetoothOutputLikely, tunedThisSession, capture, routeLabel } from '../audio/engine';
import { meterInfo } from '../audio/meter';
import { inputPref, TunerPanel } from './Tools';
import { EVENT_TEXT } from '../progress';
import { saveStatus } from '../progressStore';
import { Beats } from './Timing';

const dev = () => inputPref.get() || undefined;

function Chips({ labels, wheres, status, idx, live, notes }: { labels: string[]; wheres: string[]; status: string[]; idx: number; live: boolean; notes?: { heard: string | null; ok: boolean }[] }) {
  return (
    <ol class="notechips">
      {labels.map((lb, i) => (
        <li class={`${status[i] || 'todo'} ${live && i === idx ? 'cur' : ''}`} title={wheres[i]}>
          <b>{lb}</b>{notes && !notes[i].ok ? <small>{notes[i].heard ? `heard ${notes[i].heard}` : 'not heard'}</small> : null}
        </li>
      ))}
    </ol>
  );
}

export function PitchPanel({ cat, l, reviewDue, passed }: { cat: Catalog; l: Lesson; reviewDue: boolean; passed: boolean }) {
  const a = useStore(attempt);
  const cap = useStore(capture);
  const save = useStore(saveStatus);
  const setup = useMemo(() => pitchSetup(l, cat), [l.id]);
  const gm = graderMode(pitchGraderKey(l, cat));
  const crit = setup.crit;
  const [ladder, setLadder] = useState<Ladder | null>(null);
  const [bt, setBt] = useState(false);
  const [tune, setTune] = useState(false);
  const [skipTune, setSkipTune] = useState(false);
  const mine = a.lessonId === l.id && a.kind === 'pitch';
  const busy = mine && (a.phase === 'starting' || a.phase === 'countin' || a.phase === 'playing');
  useEffect(() => { if (setup.mode === 'timed') void getLadder(l).then(setLadder); }, [l.id, a.phase]);
  useEffect(() => { void bluetoothOutputLikely().then(setBt); }, []);
  useEffect(() => () => { const s = attempt.get(); if (s.kind === 'pitch' && (s.phase === 'starting' || s.phase === 'countin' || s.phase === 'playing')) cancelAttempt(); }, []);
  const goalOnly = reviewDue || passed;
  const tempo = setup.mode === 'timed' ? (goalOnly ? crit.bpm! : ladder?.bpm ?? Math.round(crit.bpm! * 0.65)) : null;
  const start = () => { setTune(false); void runPitchAttempt(l, cat, { bpm: tempo ?? undefined, deviceId: dev(), mode: gm }); };
  const items = setup.mode === 'hold' ? setup.targets : setup.expected;

  if (bt && setup.mode === 'timed' && !busy) return (
    <div><p class="error">Bluetooth audio looks active. Its delay (150–300 ms) puts the click out of step with your playing, so graded attempts with a click are off.</p>
      <p class="muted">Switch to the phone speaker or wired headphones, then <button class="small" onClick={() => void bluetoothOutputLikely().then(setBt)}>check again</button>.</p></div>);

  const p = mine ? a.pitch : null;
  if (busy && p) {
    const cur = p.idx, label = p.labels[cur], where = p.wheres[cur];
    const c = p.cents === null ? null : Math.round(p.cents);
    const hear = p.hearing ? `${p.hearing}${c !== null ? ` ${c === 0 ? '±0' : (c > 0 ? '+' : '') + c}¢` : ''}` : '–';
    const onTarget = !!p.hearing && !!label && label.split(' → ').pop()!.split('+').includes(p.hearing); // a bend's target, any note of a shape
    return (
      <div class="running pitchrun">
        {setup.mode === 'timed' ? <>
          <p class="muted">{a.bpm} BPM · {setup.meter}</p>
          <Beats n={meterInfo(setup.meter).beats} on={a.beat < 0 ? -1 : a.beat % meterInfo(setup.meter).beats} count={a.phase !== 'playing'} />
        </> : null}
        <p class="nowline"><span>Expected <b class="exp">{label}</b> <small>{where}</small></span><span>Hearing <b class={`hear ${onTarget ? 'ok' : ''}`}>{hear}</b></span></p>
        {setup.mode === 'hold' ? <>
          <div class="holdbar" role="progressbar" aria-valuenow={Math.round(p.progress * 100)}><i style={{ width: `${Math.round(p.progress * 100)}%` }} /></div>
          <p class="muted small">{setup.targets[cur]?.from !== undefined ? 'Pick the starting note, bend up to the target and hold it.' : 'Pluck the string and let it ring.'} Hold within ±{crit.cents}¢ for half a second.</p>
        </> : setup.mode === 'timed' ? <p>{a.phase === 'playing' ? <b>Play!</b> : a.phase === 'countin' ? 'Count-in: 1 bar, then play' : 'Opening the mic…'}</p>
          : <p><b>Play the notes in order, at your own pace.</b></p>}
        <Chips labels={p.labels} wheres={p.wheres} status={p.status} idx={cur} live />
        <div class="row">
          {setup.mode === 'hold' ? <button onClick={skipPitchTarget}>Skip this one</button> : null}
          {setup.mode === 'free' ? <button class="primary" onClick={finishPitchNow}>I'm done</button> : null}
          <button onClick={cancelAttempt}>Cancel</button>
        </div>
      </div>);
  }

  const r = mine && a.phase === 'result' ? a.pitchResult : null;
  const atGoal = r && setup.mode === 'timed' ? (r.bpm ?? 0) >= crit.bpm! : true;
  const pct = Math.round((crit.note_accuracy ?? 1) * 100);
  return (
    <div>
      {r ? (
        <div class={`result ${r.met ? 'pass' : 'fail'}`}>
          <h3>{a.pending ? 'Check this attempt' : r.met ? (atGoal ? '✓ Passed this attempt' : `✓ Clean at ${r.bpm} BPM`) : 'Not yet'}</h3>
          <div class="stats">
            <div><b>{r.matched}/{r.total}</b><span>{setup.mode === 'hold' ? `held within ±${crit.cents}¢ (goal: all)` : `notes right (goal ${pct}%)`}</span></div>
            {r.grade && r.grade.mode === 'timed' && r.grade.meanOffMs !== null ? <div><b>{Math.abs(r.grade.meanOffMs).toFixed(0)} ms</b><span>{Math.abs(r.grade.meanOffMs) < 15 ? 'on the beat' : r.grade.meanOffMs > 0 ? 'behind the click on average' : 'ahead of the click on average'}</span></div> : null}
            {r.grade && r.grade.extras ? <div><b>{r.grade.extras}</b><span>extra notes</span></div> : null}
          </div>
          {r.grade ? <Chips labels={r.grade.notes.map(n => n.label)} wheres={r.grade.notes.map(n => n.where)} status={r.grade.notes.map(n => (n.ok ? 'ok' : 'miss'))} idx={-1} live={false} notes={r.grade.notes} />
            : <ul class="list heldlist">{r.held.map(h => <li class={h.ok ? 'okText' : 'error'}>{h.ok ? '✓' : '✗'} {h.label} <small>{h.where}{h.ok && h.cents !== null ? ` · ${h.cents >= 0 ? '+' : ''}${h.cents.toFixed(1)}¢ · ${h.secs!.toFixed(1)} s` : h.ok ? '' : ' · not held in time'}</small></li>)}</ul>}
          {r.grade ? <p>{pitchCoach(r.grade)}</p> : <p>{r.met ? 'All in tune.' : 'Try the missed ones again; the tuner shows how close you are.'}</p>}
          {a.pending ? <div class="assist">
            <p class="note">Assisted mode: the app thinks this {r.met ? 'meets' : 'misses'} the goal. Does that match what you played?</p>
            <div class="row"><button class="primary" onClick={() => void confirmPitch(true)}>Count it ✓</button><button onClick={() => void confirmPitch(false)}>Doesn't count</button></div>
          </div> : null}
          {!a.pending && r.met && !atGoal ? <p class="muted">Practice tempo builds you up to {crit.bpm} BPM; only attempts at {crit.bpm} count toward passing.</p> : null}
          {!a.pending && a.event && EVENT_TEXT[a.event] ? <p class="note">{EVENT_TEXT[a.event]}</p> : null}
          {!a.pending && save.state === 'saved' ? <p class="savedtick">✓ Saved on this phone</p> : null}
          {!a.pending && a.ladder && !goalOnly && a.prevLadderBpm !== undefined && a.ladder.bpm !== a.prevLadderBpm ? <p class="note">{a.ladder.bpm > a.prevLadderBpm ? 'Practice tempo up: ' : 'Practice tempo down: '}next attempt at {a.ladder.bpm} BPM.</p> : null}
        </div>
      ) : mine && a.phase === 'error' ? <p class="error">{a.message}</p> : null}

      {l.id !== 'F.02' && !tunedThisSession && !skipTune && !r ? (
        <div class="quicktune">{tune ? <TunerPanel compact /> : <p class="muted">Not tuned yet this session. <button class="small" onClick={() => setTune(true)}>Quick tune</button> <button class="small" onClick={() => setSkipTune(true)}>Skip</button></p>}</div>
      ) : null}
      {!r || !a.pending ? <>
        <p class="muted">{setup.mode === 'hold' ? `${items.length} targets, one at a time: ${items.map(t => t.label).join(', ')}. Hold each within ±${crit.cents}¢ for half a second.`
          : setup.mode === 'timed' ? `${items.length} notes to a click, ${goalOnly || tempo! >= crit.bpm! ? `at the goal tempo, ${crit.bpm} BPM` : `at ${tempo} BPM, working up to ${crit.bpm}`}. One bar of count-in.${crit.any_octave ? ' Any octave counts.' : ''}`
          : `${items.length} notes at your own pace, in order.`} {gm === 'assisted' ? 'Assisted mode: you confirm each result.' : ''}</p>
        <div class="row wrap"><button class="primary" onClick={start}>{r ? 'Go again' : 'Start'}{tempo ? ` at ${tempo} BPM` : ''}</button></div>
        <p class="muted small">Listening {cap.label ? `with ${routeLabel()}` : 'with the selected input'} · {posture()} · <a href="#/settings">input & grading</a></p>
      </> : null}
    </div>
  );
}
