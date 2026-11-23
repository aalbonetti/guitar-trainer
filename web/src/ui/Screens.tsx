// Screens: Today, Path, Lesson, Songs, Song, Tools, Settings.
import { useEffect, useState } from 'preact/hooks';
import type { Catalog, Lesson } from '../catalog';
import { describePass, lessonTempo } from '../catalog';
import type { Shape } from '../music';
import { ChordDiagram, ScaleDiagram, StrumGrid } from './Diagrams';
import { ToolBar, TunerPanel, MetronomePanel, InputPicker } from './Tools';
import { getSetList, clearSetList } from '../setlist';
import { persisted, useStore } from '../store';
import { LessonContent } from './Content';
import { progress, recordAttempt, saveStatus, streakInfo } from '../progressStore';
import { computeStates, isReviewDue, dayOf, EVENT_TEXT, type State } from '../progress';
import { TimingPanel, CalibrationCard, usePracticeTempo } from './Timing';
import { PitchPanel } from './Pitch';
import { ChordPanel } from './Chord';
import { GRADERS, graderMode, setGraderMode, pitchGraderKey, chordGraderKey, isChordLesson, type GraderMode } from '../grading/modes';
import { PracticeCard } from './Practice';
import { xp } from '../xp';
import { levelFor } from '../games/core';
import { SongView, songSettings } from './Song';
import { ChordLibrary, ScaleViewer, CapoCalc } from './ToolsExtra';
import { fitLine } from '../songfit';
import { songPool, songOfWeek } from '../practice';
import { attempt } from '../grading/runner';

export const trackVisibleFor = (cat: Catalog) => (id: string) => trackVisible(cat, id);
export const instrumentPref = persisted<'acoustic' | 'electric' | 'both'>('gt_instruments', 'both');
const go = (h: string) => { location.hash = h; };
const trackVisible = (cat: Catalog, trackId: string) => {
  const t = cat.tracks.find(x => x.id === trackId); const pref = instrumentPref.get();
  return !t || pref === 'both' || t.instrument === 'both' || t.instrument === pref;
};

// ---------- Today ----------
export function Today({ cat }: { cat: Catalog }) {
  const { pr, states } = useStates(cat);
  const day = dayOf();
  const sl = getSetList();
  const streak = streakInfo(day).current;
  const passed = Object.values(states).filter(s => s === 'passed').length;
  const vis = (id: string) => trackVisible(cat, id);
  const x = useStore(xp);
  return (
    <div class="page">
      <h1>Today</h1>
      <a class="card tap-card todaystat" href="#/progress" aria-label="See your progress"><p><span>{streak ? `🔥 ${streak}-day streak · ` : ''}{passed} of {cat.lessons.length} lessons passed · level {levelFor(x.total).level}</span><span class="chev" aria-hidden="true">›</span></p></a>
      <div class="two">
        <div><PracticeCard cat={cat} visibleTrack={vis} /></div>
        <div>
          <section class="card">
            <h2>Quick tools</h2>
            <div class="row">
              <button class="primary" onClick={() => go('#/tools/tuner')}>🎚 Tuner</button>
              <button class="primary" onClick={() => go('#/tools/metronome')}>⏱ Metronome</button>
            </div>
          </section>
          <StorageNote />
          {(() => { const pool = songPool({ cat, setlist: sl }); const id = songOfWeek(pool.ids, new Date()); const o = id ? cat.outlineById[id] : null;
            return o ? <a class="card tap-card" href={`#/song/${o.id}`} aria-label={`Song of the week: ${o.title}`}><h2>Song of the week <span class="chev" aria-hidden="true">›</span></h2><p><span class="big-link">{o.title}</span> <small class="muted">{o.artist}</small></p>
              <p class="small fit">{(() => { const st = songSettings(cat, o, pr.lp); return st.suggested || st.capo === st.fit.capo ? fitLine(st.fit) : `Capo ${st.capo}${st.key !== o.chart_key ? `, key of ${st.key}` : ''} (your choice).`; })()}</p>
              <p class="muted small">Picked at random from {pool.fromList ? 'your church’s song list' : 'the song library'}. A new one every Monday at 12:01 am.</p></a> : null; })()}
        </div>
      </div>
    </div>
  );
}
/** Today: if Chrome won't promise to keep this site's data, say so (there is no backup, so it matters). */
function StorageNote() {
  const [bad, setBad] = useState(false);
  useEffect(() => { void (async () => { try { if (!navigator.storage?.persisted) return; let ok = await navigator.storage.persisted(); if (!ok) ok = await navigator.storage.persist?.() ?? true; setBad(!ok); } catch { /* unknown: stay quiet */ } })(); }, []);
  if (!bad) return null;
  return <section class="card nudge"><h2>⚠ Storage isn’t protected</h2><p class="muted small">Chrome hasn’t marked this app’s data as permanent, so it could be cleared if the phone runs low on space. Adding the app to your home screen and using it regularly usually fixes that.</p></section>;
}

// ---------- Path ----------
const ICON: Record<State, string> = { locked: '🔒', available: '○', in_progress: '◐', passed: '●' };
function useStates(cat: Catalog) { const pr = useStore(progress); return { pr, states: computeStates(cat.lessons, cat.tracks, pr.lp) }; }
function StateBadge({ cat, id }: { cat: Catalog; id: string }) {
  const { pr, states } = useStates(cat);
  const s = states[id], due = isReviewDue(pr.lp[id], dayOf());
  const label = due ? 'review due' : s === 'in_progress' && pr.lp[id]?.first_pass_day ? 'passed once' : s.replace('_', ' ');
  return <small class={`badge b-${due ? 'due' : s}`}>{label}</small>;
}
export function Path({ cat }: { cat: Catalog }) {
  const { pr, states } = useStates(cat);
  const day = dayOf();
  const done = Object.values(states).filter(s => s === 'passed').length;
  return (
    <div class="page">
      <h1>Path <small class="muted">{done}/{cat.lessons.length} passed</small></h1>
      <p class="muted legend">● passed · ◐ in progress · ○ ready · 🔒 needs earlier lessons · ↻ review due</p>
      {cat.tracks.filter(t => trackVisible(cat, t.id)).map(t => (
        <section class="card">
          <h2>{t.name} <small class="muted">{t.instrument === 'both' ? 'acoustic + electric' : t.instrument}</small></h2>
          <ul class="list lessons">
            {cat.lessons.filter(l => l.track === t.id).map(l => (
              <li class={`st-${states[l.id]}`}><a href={`#/lesson/${l.id}`}><i class="sticon">{ICON[states[l.id]]}{isReviewDue(pr.lp[l.id], day) ? '↻' : ''}</i><b>{l.id}</b> {l.title}<small>{describePass(l.pass_criteria)}</small></a></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- Lesson ----------
function triadShape(t: { strings: number[]; frets: number[] }): Shape {
  const frets = [-1, -1, -1, -1, -1, -1];
  t.strings.forEach((s, i) => { frets[6 - s] = t.frets[i]; });
  return { frets };
}
export function LessonView({ cat, id }: { cat: Catalog; id: string }) {
  const l = cat.lessonById[id];
  if (!l) return <div class="page"><p>Lesson {id} not found.</p></div>;
  const a = l.assets;
  const idx = cat.lessons.indexOf(l), prev = cat.lessons[idx - 1], next = cat.lessons[idx + 1];
  const songs = cat.outlines.filter(o => o.practice_for.includes(l.id));
  const chords = (a.chords || []).map(cid => cat.chords.find(c => c.id === cid)).filter(Boolean);
  const scales = (a.scales || []).map(sid => cat.scales.find(s => s.id === sid)).filter(Boolean);
  const strums = [...(a.rhythm || [])].map(rid => cat.strums.find(s => s.id === rid)).filter(Boolean);
  const triads = (a.triads || []).map(tid => cat.shapes.triads.find(t => t.id === tid)).filter(Boolean);
  const exercises = (a.exercises || []).map(eid => cat.exercises.find(e => e.id === eid)).filter(Boolean);
  const base = lessonTempo(l, cat);
  const pt = usePracticeTempo(l);
  const tempo = pt ? { ...base, bpm: pt.bpm } : base;
  const [md, setMd] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setMd(null); // ignore a slower response for a lesson we've already left
    fetch(`./content/${l.id}.md`).then(r => (r.ok ? r.text() : '')).then(t => { if (live) setMd(t.startsWith('<') ? '' : t); }).catch(() => { if (live) setMd(''); });
    return () => { live = false; };
  }, [l.id]);
  return (
    <div class="page lesson">
      <div class="crumbs"><a href="#/path">Path</a> › {cat.tracks.find(t => t.id === l.track)?.name}</div>
      <h1><span class="lid">{l.id}</span> {l.title} <StateBadge cat={cat} id={l.id} /></h1>
      <ToolBar preset={tempo} label={pt && !pt.atGoal ? 'your practice tempo' : pt ? 'goal tempo' : 'lesson tempo'} goal={pt && !pt.atGoal ? pt.goal : undefined} />
      <div class="lessongrid">
        <div class="lmain">
          <section class="card">
            <h2>Lesson</h2>
            {md === null ? <p class="muted">Loading…</p> : md ? <LessonContent md={md} cat={cat} lessonId={l.id} />
              : <p class="muted">The written lesson for {l.id} is being drafted. Use the diagrams, patterns and tools on this page to practice in the meantime.</p>}
          </section>
        </div>
        <aside class="lside">
          <section class="card lgoal">
            <h2>Goal</h2>
            <p>{describePass(l.pass_criteria)}</p>
            {l.prereqs.length ? <p class="muted">After: {l.prereqs.map((p, i) => <span>{i ? ', ' : ''}<a href={`#/lesson/${p}`}>{p} {cat.lessonById[p]?.title}</a></span>)}</p> : null}
          </section>
          <div class="lpass"><PassPanel cat={cat} l={l} /></div>
          {chords.length ? <section class="card"><h2>Chords</h2><div class="chords">{chords.map(c => <ChordDiagram name={c!.name} shape={{ frets: c!.frets, fingers: c!.fingers, barre: c!.barre ? c!.barre.fret : null }} />)}</div></section> : null}
          {triads.length ? <section class="card"><h2>Triads</h2><div class="chords">{triads.map(t => <ChordDiagram name={`${t!.root}${t!.quality === 'minor' ? 'm' : ''} (${t!.strings.join('-')})`} shape={triadShape(t!)} />)}</div></section> : null}
          {scales.length ? <section class="card"><h2>Scales</h2>{scales.map(s => <ScaleDiagram scale={s!} />)}</section> : null}
          {strums.length ? <section class="card"><h2>Rhythm</h2>{strums.map(s => <StrumGrid strum={s!} />)}</section> : null}
          {exercises.length ? <section class="card"><h2>Exercises</h2><ul class="list">{exercises.map(e => <li><b>{e!.name}</b>{e!.tempo ? <small>start {e!.tempo.start} → target {e!.tempo.target} BPM</small> : null}{e!.pairs ? <small>{e!.pairs.map(p => p.map(r => e!.voicings?.[r]?.name ?? r).join(' ↔ ')).join(' · ')}</small> : null}{e!.bpm ? <small>{e!.bpm} BPM</small> : null}</li>)}</ul></section> : null}
          {songs.length ? <section class="card"><h2>Songs that use this</h2><ul class="list">{songs.map(o => <li><a href={`#/song/${o.id}`}>{o.title}</a> <small class="muted">{o.artist}</small></li>)}</ul></section> : null}
        </aside>
      </div>
      <div class="row between nav2">
        {prev ? <a class="btn" href={`#/lesson/${prev.id}`}>← {prev.id}</a> : <span />}
        {next ? <a class="btn" href={`#/lesson/${next.id}`}>{next.id} →</a> : <span />}
      </div>
    </div>
  );
}

function PassPanel({ cat, l }: { cat: Catalog; l: Lesson }) {
  const pr = useStore(progress);
  const [msg, setMsg] = useState('');
  const type = l.pass_criteria.type;
  const p = pr.lp[l.id];
  const due = isReviewDue(p, dayOf());
  const today = dayOf();
  const doneToday = p?.first_pass_day === today && p.state !== 'passed';
  const states = computeStates(cat.lessons, cat.tracks, pr.lp);
  const att = useStore(attempt);
  const mark = async (mode: 'auto' | 'self') => { const ev = await recordAttempt(l, { met: true, atTarget: true, score: 1, mode }); setMsg((EVENT_TEXT[ev] || 'Logged. It counts once per day.') + (saveStatus.get().state === 'saved' ? ' ✓ Saved on this phone.' : '')); };
  if (states[l.id] === 'locked') {
    const need = l.prereqs.filter(id => states[id] !== 'passed');
    const t = cat.tracks.find(x => x.id === l.track);
    const needF = t?.requires?.includes('F') && cat.lessons.some(x => x.track === 'F' && states[x.id] !== 'passed');
    const nextUp = cat.lessons.find(x => states[x.id] === 'in_progress') || cat.lessons.find(x => states[x.id] === 'available');
    return (
      <section class="card"><h2>🔒 Not unlocked yet</h2>
        <p class="muted">Read ahead if you like. Attempts open once you've passed {need.length ? need.map((id, i) => <span>{i ? ', ' : ''}<a href={`#/lesson/${id}`}>{id} {cat.lessonById[id]?.title}</a></span>) : null}{need.length && needF ? ' and ' : ''}{needF ? 'all of Foundations' : ''}.</p>
        {nextUp ? <a class="btn primary" href={`#/lesson/${nextUp.id}`}>Go to your lesson: {nextUp.id} {nextUp.title}</a> : null}
      </section>);
  }
  if (type === 'quiz') return (
    <section class="card"><h2>Pass it</h2>
      {p?.state === 'passed' && !due ? <p class="okText">Passed{p.mastered ? ' and mastered' : ''} ✓</p>
        : doneToday ? <p class="okText">Passed once today ✓ The next lessons are open. Pass the quiz again tomorrow or later to complete this one.</p>
        : p?.first_pass_day ? <p class="note">Passed once on {p.first_pass_day}. Pass the quiz today to complete the lesson.</p> : null}
      <p class="muted">Pass the quiz on this page on two different days. {due ? 'A review is due: take the quiz again today.' : ''}</p>
      {states[l.id] === 'locked' ? <p class="muted">Tip: finish the earlier lessons first ({l.prereqs.join(', ')}).</p> : null}</section>);
  if (type === 'timing') return (
    <section class="card">
      <h2>Pass it {due ? <small class="badge b-due">review due</small> : null}</h2>
      {p?.state === 'passed' && !due ? <p class="okText">Passed{p.mastered ? ' and mastered' : ''}. Practice any time.</p> : null}
      {doneToday && !(att.lessonId === l.id && att.phase === 'result') ? <p class="okText">Passed once today ✓ Pass it again on another day to complete the lesson.</p> : null}
      <TimingPanel cat={cat} l={l} reviewDue={due} passed={p?.state === 'passed'} />
      {msg ? <p class="note">{msg}</p> : null}
      {p?.state !== 'passed' || due ? <details class="selfmark"><summary>Can't use the mic right now?</summary>
        <p class="muted">Mark it yourself when you can play it at the goal. Self-marked passes are recorded as such.</p>
        <button disabled={doneToday} onClick={() => mark('self')}>{doneToday ? 'Marked today ✓' : 'I can do this'}</button></details> : null}
    </section>);
  if (type === 'pitch' && graderMode(pitchGraderKey(l, cat)) !== 'self') return (
    <section class="card">
      <h2>Pass it {due ? <small class="badge b-due">review due</small> : null}</h2>
      {p?.state === 'passed' && !due ? <p class="okText">Passed{p.mastered ? ' and mastered' : ''}. Practice any time.</p> : null}
      {doneToday && !(att.lessonId === l.id && att.phase === 'result') ? <p class="okText">Passed once today ✓ Pass it again on another day to complete the lesson.</p> : null}
      <PitchPanel cat={cat} l={l} reviewDue={due} passed={p?.state === 'passed'} />
      {msg ? <p class="note">{msg}</p> : null}
      {p?.state !== 'passed' || due ? <details class="selfmark"><summary>Can't use the mic right now?</summary>
        <p class="muted">Mark it yourself when you can play it. Self-marked passes are recorded as such.</p>
        <button disabled={doneToday} onClick={() => mark('self')}>{doneToday ? 'Marked today ✓' : 'I can do this'}</button></details> : null}
    </section>);
  if (isChordLesson(l) && graderMode(chordGraderKey(l)) !== 'self') return (
    <section class="card">
      <h2>Pass it {due ? <small class="badge b-due">review due</small> : null}</h2>
      {p?.state === 'passed' && !due ? <p class="okText">Passed{p.mastered ? ' and mastered' : ''}. Practice any time.</p> : null}
      {doneToday && !(att.lessonId === l.id && att.phase === 'result') ? <p class="okText">Passed once today ✓ Pass it again on another day to complete the lesson.</p> : null}
      <ChordPanel cat={cat} l={l} reviewDue={due} passed={p?.state === 'passed'} />
      {msg ? <p class="note">{msg}</p> : null}
      {p?.state !== 'passed' || due ? <details class="selfmark"><summary>Can't use the mic right now?</summary>
        <p class="muted">Mark it yourself when you can play it. Self-marked passes are recorded as such.</p>
        <button disabled={doneToday} onClick={() => mark('self')}>{doneToday ? 'Marked today ✓' : 'I can do this'}</button></details> : null}
    </section>);
  const graded = type !== 'self_check';
  const selfByChoice = type === 'pitch' || isChordLesson(l);
  return (
    <section class="card">
      <h2>Pass it {due ? <small class="badge b-due">review due</small> : null}</h2>
      {selfByChoice ? <p class="muted">{type === 'pitch' ? 'Pitch' : 'Chord'} grading is set to self-mark in <a href="#/settings">Settings</a>. Mark it yourself when you can do it, on two different days.</p>
        : graded ? <p class="muted">Automatic grading for this lesson ({describePass(l.pass_criteria).split(':')[0].toLowerCase()}) arrives in a later update. Until then, mark it yourself when you can do it at the goal above, on two different days.</p>
        : <p class="muted">When it feels solid, mark it. Do that on two different days to pass.</p>}
      {p?.state === 'passed' && !due ? <p class="okText">Passed{p.mastered ? ' and mastered' : ''}.</p>
        : <button class="primary" disabled={doneToday} onClick={() => mark(graded ? 'self' : 'auto')}>{doneToday ? 'Marked today ✓ (come back another day)' : due ? 'Review: I can still do this' : 'I can do this'}</button>}
      {msg ? <p class="note">{msg}</p> : null}
    </section>
  );
}

// ---------- Songs ----------
export function Songs({ cat, selected }: { cat: Catalog; selected?: string; initialTab?: string }) {
  const [q, setQ] = useState('');
  const list = cat.outlines.filter(o => !q || (o.title + ' ' + o.artist + ' ' + (o.ccli || '')).toLowerCase().includes(q.toLowerCase())).map(o => ({ id: o.id, title: o.title, sub: `${o.chart_key}${o.bpm ? ' · ' + o.bpm : ''}` }));
  return (
    <div class={`page songs ${selected ? 'has-sel' : ''}`}>
      <div class="songlist">
        <h1>Songs <small class="muted">({cat.outlines.length})</small></h1>
        <input type="search" placeholder="Search title, artist, CCLI" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} />
        <ul class="list">
          {list.map(s => <li class={s.id === selected ? 'sel' : ''}><a href={`#/song/${s.id}`}>{s.title}<small>{s.sub}</small></a></li>)}
        </ul>
      </div>
      <div class="songdetail">{selected && cat.outlineById[selected] ? <SongView cat={cat} o={cat.outlineById[selected]} /> : <p class="muted hint">Pick a song.</p>}</div>
    </div>
  );
}

// ---------- Tools ----------
const TOOL_TABS = [['tuner', 'Tuner'], ['metronome', 'Metronome'], ['chords', 'Chords'], ['scales', 'Scales'], ['capo', 'Capo']] as const;
export function Tools({ which, cat }: { which?: string; cat: Catalog }) {
  const w = TOOL_TABS.some(t => t[0] === which) ? which! : 'tuner';
  const tm = w === 'tuner' || w === 'metronome';
  return (
    <div class="page tools">
      <h1>Tools</h1>
      <div class="tabs scroll">{TOOL_TABS.map(([id, name]) => <a class={`btn ${w === id ? 'sel' : ''}`} href={`#/tools/${id}`}>{name}</a>)}</div>
      {tm ? <>
        <div class="two">
          <section class={`card ${w === 'metronome' ? 'hide-narrow' : ''}`}><h2>Tuner</h2><TunerPanel /></section>
          <section class={`card ${w !== 'metronome' ? 'hide-narrow' : ''}`}><h2>Metronome</h2><MetronomePanel /></section>
        </div>
        <section class="card"><h2>Dotted-eighth delay</h2><DelayCalc /></section>
      </> : null}
      {w === 'chords' ? <section class="card"><h2>Chord library</h2><ChordLibrary /></section> : null}
      {w === 'scales' ? <section class="card"><h2>Scale viewer</h2><ScaleViewer cat={cat} /></section> : null}
      {w === 'capo' ? <section class="card"><h2>Capo & transpose</h2><CapoCalc cat={cat} /></section> : null}
    </div>
  );
}
function DelayCalc() {
  const [bpm, setBpm] = useState(72);
  const ms = (60000 / bpm) * 0.75;
  return <div class="row wrap"><label class="field inline">BPM <input type="number" min="40" max="220" value={bpm} onInput={e => setBpm(+(e.target as HTMLInputElement).value || 72)} /></label>
    <p>Dotted 8th: <b>{ms.toFixed(0)} ms</b> · quarter: {(60000 / bpm).toFixed(0)} ms · 8th: {(30000 / bpm).toFixed(0)} ms</p></div>;
}

// ---------- Settings ----------
/** §6 fallback flag per grader: auto, assisted (you confirm), or self-mark. */
function GradingModes() {
  const [, bump] = useState(0);
  const label: Record<GraderMode, string> = { auto: 'Automatic', assisted: 'Assisted (I confirm)', self: 'Self-mark (no mic)' };
  return (
    <section class="card"><h2>Grading mode</h2>
      <p class="muted">If a grader gets your playing wrong on this phone, switch it to assisted (it shows what it heard and you confirm) or self-mark. Timing grading is always automatic.</p>
      {GRADERS.map(g => <label class="field">{g.name}
        <select value={graderMode(g.key)} onChange={e => { setGraderMode(g.key, (e.target as HTMLSelectElement).value as GraderMode); bump(x => x + 1); }}>
          {(['auto', 'assisted', 'self'] as GraderMode[]).map(m => <option value={m}>{label[m]}{m === g.def ? ' (default)' : ''}</option>)}
        </select><small>{g.note}</small></label>)}
    </section>
  );
}

export const audioCheckPref = persisted<number | null>('gt_audio_check_done', null);
/** The real-phone audio check (M0 page) hasn't been done yet: graders are only proven on synthetic audio. */
function AudioCheckCard() {
  const [done, setDone] = useState(audioCheckPref.get());
  return (
    <section class={`card ${done ? '' : 'attn'}`}>
      <h2>Phone audio check {done ? <small class="okText">done {new Date(done).toLocaleDateString()} ✓</small> : <small class="badge b-due">to do</small>}</h2>
      {!done ? <>
        <p>The tuner, timing, pitch and chord graders have only been tested on synthetic audio. A 15-minute check with your guitar confirms they work on this phone before more grading is built on them.</p>
        <ol class="small">
          <li>Quiet room, guitar in hand, phone on a stand about an arm's length away.</li>
          <li>Open the check page and run each test, first folded, then unfolded.</li>
          <li>If you have the Kemper's USB cable, plug it in and repeat the input tests.</li>
          <li>Tap <b>Copy results</b> at the end and paste them to Claude.</li>
        </ol>
      </> : <p class="muted small">Run it again after a phone or Chrome update, or with a new input.</p>}
      <div class="row wrap">
        <a class={`btn ${done ? '' : 'primary'}`} href="./m0/">Open the audio check</a>
        {!done ? <button onClick={() => { const t = Date.now(); audioCheckPref.set(t); setDone(t); }}>I've done it</button> : <button class="small" onClick={() => { audioCheckPref.set(null); setDone(null); }}>Mark as not done</button>}
      </div>
    </section>
  );
}

export function Settings({ cat, onChange }: { cat: Catalog; onChange: () => void }) {
  const [msg, setMsg] = useState('');
  const [inst, setInst] = useState(instrumentPref.get());
  const [keepOk, setKeepOk] = useState<boolean | null>(null);
  useEffect(() => { void (async () => { try { let ok = await navigator.storage?.persisted?.(); if (!ok) ok = await navigator.storage?.persist?.(); setKeepOk(!!ok); } catch { setKeepOk(null); } })(); }, []);
  const sl = getSetList();
  return (
    <div class="page">
      <h1>Settings</h1>
      <section class="card">
        <h2>Instrument</h2>
        <div class="row">{(['acoustic', 'electric', 'both'] as const).map(v => <button class={inst === v ? 'sel' : ''} onClick={() => { instrumentPref.set(v); setInst(v); }}>{v}</button>)}</div>
        <p class="muted">Hides the tracks you don't play on the Path. You can switch any time.</p>
      </section>
      <section class="card"><h2>Audio</h2><InputPicker /></section>
      <AudioCheckCard />
      <section class="card"><h2>Timing calibration</h2><CalibrationCard /></section>
      <GradingModes />
      {sl ? <section class="card">
        <h2>Church set list</h2>
        <p>{sl.songs.length} songs saved on this phone from an earlier import; they pick the song of the week. <button class="small" onClick={() => { clearSetList(); setMsg('Set list removed.'); onChange(); }}>Remove</button></p>
        {msg ? <p class="note">{msg}</p> : null}
      </section> : null}
      <section class="card">
        <h2>Saving</h2>
        <p>Progress saves on this phone after every quiz, attempt and game. {keepOk === true ? <span class="okText">Chrome has marked it as permanent storage ✓</span> : keepOk === false ? <span class="muted">Chrome may clear it if the phone runs low on space; installing the app to the home screen helps.</span> : null}</p>
      </section>
      <section class="card">
        <h2>About</h2>
        <p class="muted">Guitar Trainer v{__APP_VERSION__} · personal use. Song outlines are facts only (keys, chords, numbers); no lyrics. Chord library: chords-db, MIT License, Copyright (c) 2016 David Rubert.</p>
      </section>
    </div>
  );
}
