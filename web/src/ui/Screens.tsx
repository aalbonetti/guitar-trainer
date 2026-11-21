// Screens: Today, Path, Lesson, Songs, Song, Tools, Settings.
import { useMemo, useState } from 'preact/hooks';
import type { Catalog, Lesson, Outline } from '../catalog';
import { describePass, lessonTempo } from '../catalog';
import { shapeFor, transposeChord, keyUsesFlats, pcOf, keyName, KEY_NAMES, capoOptions, type Shape } from '../music';
import { ChordDiagram, ScaleDiagram, StrumGrid } from './Diagrams';
import { ToolBar, TunerPanel, MetronomePanel, InputPicker } from './Tools';
import { getSetList, importSetList, clearSetList, recentSongs } from '../setlist';
import { persisted } from '../store';

export const instrumentPref = persisted<'acoustic' | 'electric' | 'both'>('gt_instruments', 'both');
const go = (h: string) => { location.hash = h; };
const trackVisible = (cat: Catalog, trackId: string) => {
  const t = cat.tracks.find(x => x.id === trackId); const pref = instrumentPref.get();
  return !t || pref === 'both' || t.instrument === 'both' || t.instrument === pref;
};

// ---------- Today ----------
export function Today({ cat }: { cat: Catalog }) {
  const sl = getSetList();
  const recent = sl ? recentSongs(sl, 4) : [];
  const start = cat.lessons.filter(l => l.track === 'F').slice(0, 3);
  return (
    <div class="page">
      <h1>Today</h1>
      <section class="card">
        <h2>Quick tools</h2>
        <div class="row">
          <button class="primary" onClick={() => go('#/tools/tuner')}>🎚 Tuner</button>
          <button class="primary" onClick={() => go('#/tools/metronome')}>⏱ Metronome</button>
        </div>
      </section>
      <section class="card">
        <h2>Start here</h2>
        <p class="muted">Progress tracking and daily reviews arrive in the next update. For now, work through Foundations in order.</p>
        <ul class="list">{start.map(l => <li><a href={`#/lesson/${l.id}`}><b>{l.id}</b> {l.title}</a></li>)}</ul>
      </section>
      <section class="card">
        <h2>This month's songs</h2>
        {sl ? (recent.length ? (
          <ul class="list">{recent.map(s => <li>{s.outlineId ? <a href={`#/song/${s.outlineId}`}>{s.name}</a> : <span class="muted">{s.name} (no outline)</span>} <small class="muted">{s.last}</small></li>)}</ul>
        ) : <p class="muted">No songs in the last 4 weeks of your imported list.</p>)
          : <p class="muted">Import your set-list CSV in <a href="#/settings">Settings</a> to see what you're playing this month. It stays on this phone.</p>}
      </section>
    </div>
  );
}

// ---------- Path ----------
export function Path({ cat }: { cat: Catalog }) {
  return (
    <div class="page">
      <h1>Path</h1>
      {cat.tracks.filter(t => trackVisible(cat, t.id)).map(t => (
        <section class="card">
          <h2>{t.name} <small class="muted">{t.instrument === 'both' ? 'acoustic + electric' : t.instrument}</small></h2>
          <ul class="list lessons">
            {cat.lessons.filter(l => l.track === t.id).map(l => (
              <li><a href={`#/lesson/${l.id}`}><b>{l.id}</b> {l.title}<small>{describePass(l.pass_criteria)}</small></a></li>
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
  const tempo = lessonTempo(l, cat);
  return (
    <div class="page lesson">
      <div class="crumbs"><a href="#/path">Path</a> › {cat.tracks.find(t => t.id === l.track)?.name}</div>
      <h1><span class="lid">{l.id}</span> {l.title}</h1>
      <ToolBar preset={tempo} label="lesson tempo" />
      <div class="two">
        <div>
          <section class="card">
            <h2>Goal</h2>
            <p>{describePass(l.pass_criteria)}</p>
            {l.prereqs.length ? <p class="muted">After: {l.prereqs.map((p, i) => <span>{i ? ', ' : ''}<a href={`#/lesson/${p}`}>{p} {cat.lessonById[p]?.title}</a></span>)}</p> : null}
          </section>
          <section class="card">
            <h2>Lesson</h2>
            <p class="muted">The written lesson for {l.id} is being drafted and will appear here. Use the diagrams, patterns and tools on this page to practice in the meantime.</p>
          </section>
          {exercises.length ? <section class="card"><h2>Exercises</h2><ul class="list">{exercises.map(e => <li><b>{e!.name}</b>{e!.tempo ? <small>start {e!.tempo.start} → target {e!.tempo.target} BPM</small> : null}{e!.pairs ? <small>{e!.pairs.map(p => p.join(' ↔ ')).join(' · ')}</small> : null}</li>)}</ul></section> : null}
          {songs.length ? <section class="card"><h2>Songs that use this</h2><ul class="list">{songs.map(o => <li><a href={`#/song/${o.id}`}>{o.title}</a> <small class="muted">{o.artist}</small></li>)}</ul></section> : null}
        </div>
        <div>
          {chords.length ? <section class="card"><h2>Chords</h2><div class="chords">{chords.map(c => <ChordDiagram name={c!.name} shape={{ frets: c!.frets, fingers: c!.fingers, barre: c!.barre ? c!.barre.fret : null }} />)}</div></section> : null}
          {triads.length ? <section class="card"><h2>Triads</h2><div class="chords">{triads.map(t => <ChordDiagram name={`${t!.root}${t!.quality === 'minor' ? 'm' : ''} (${t!.strings.join('-')})`} shape={triadShape(t!)} />)}</div></section> : null}
          {scales.length ? <section class="card"><h2>Scales</h2>{scales.map(s => <ScaleDiagram scale={s!} />)}</section> : null}
          {strums.length ? <section class="card"><h2>Rhythm</h2>{strums.map(s => <StrumGrid strum={s!} />)}</section> : null}
        </div>
      </div>
      <div class="row between nav2">
        {prev ? <a class="btn" href={`#/lesson/${prev.id}`}>← {prev.id}</a> : <span />}
        {next ? <a class="btn" href={`#/lesson/${next.id}`}>{next.id} →</a> : <span />}
      </div>
    </div>
  );
}

// ---------- Songs ----------
export function Songs({ cat, selected }: { cat: Catalog; selected?: string }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'month' | 'all'>(getSetList() ? 'month' : 'all');
  const sl = getSetList();
  const month = sl ? recentSongs(sl, 4) : [];
  const list = tab === 'month'
    ? month.map(s => ({ id: s.outlineId, title: s.name, sub: s.last || '' }))
    : cat.outlines.filter(o => !q || (o.title + ' ' + o.artist + ' ' + (o.ccli || '')).toLowerCase().includes(q.toLowerCase())).map(o => ({ id: o.id, title: o.title, sub: `${o.chart_key}${o.bpm ? ' · ' + o.bpm : ''}` }));
  return (
    <div class={`page songs ${selected ? 'has-sel' : ''}`}>
      <div class="songlist">
        <h1>Songs</h1>
        <div class="tabs">
          <button class={tab === 'month' ? 'sel' : ''} onClick={() => setTab('month')}>This month</button>
          <button class={tab === 'all' ? 'sel' : ''} onClick={() => setTab('all')}>All ({cat.outlines.length})</button>
        </div>
        {tab === 'all' ? <input type="search" placeholder="Search title, artist, CCLI" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} /> : null}
        {tab === 'month' && !sl ? <p class="muted">Import your set-list CSV in <a href="#/settings">Settings</a>.</p> : null}
        <ul class="list">
          {list.map(s => <li class={s.id === selected ? 'sel' : ''}>{s.id ? <a href={`#/song/${s.id}`}>{s.title}<small>{s.sub}</small></a> : <span class="muted">{s.title} <small>no outline yet</small></span>}</li>)}
        </ul>
      </div>
      <div class="songdetail">{selected && cat.outlineById[selected] ? <SongView cat={cat} o={cat.outlineById[selected]} /> : <p class="muted hint">Pick a song.</p>}</div>
    </div>
  );
}

const songKeyPref = persisted<Record<string, string>>('gt_song_keys', {});
export function SongView({ cat, o }: { cat: Catalog; o: Outline }) {
  const [key, setKeyState] = useState(songKeyPref.get()[o.id] || o.chart_key);
  const [nash, setNash] = useState(false);
  const [capo, setCapo] = useState(0);
  const setKey = (k: string) => { setKeyState(k); setCapo(0); const all = songKeyPref.get(); all[o.id] = k; songKeyPref.set(all); };
  const semis = (pcOf(key) - pcOf(o.chart_key) + 12) % 12;
  const shapeKey = keyName(pcOf(key) - capo);
  const flats = keyUsesFlats(shapeKey);
  const show = (ch: string) => transposeChord(ch, semis - capo, flats);
  const used = useMemo(() => [...new Set(o.sections.flatMap(s => s.chords_in_chart_key))].map(show), [o.id, key, capo]);
  const beats = o.meter && o.meter.startsWith('3') ? 3 : o.meter === '6/8' ? 2 : 4;
  const sub = o.meter === '6/8' ? 3 : 1;
  return (
    <div class="song">
      <h2 class="title">{o.title}</h2>
      <p class="muted">{o.artist}{o.ccli ? ` · CCLI ${o.ccli}` : ''} · original key {o.original_key}{o.bpm ? ` · ${o.bpm} BPM` : ''}{o.meter ? ` · ${o.meter}` : ''}</p>
      <ToolBar preset={{ bpm: o.bpm || 72, beats, sub }} label={o.bpm ? 'song tempo' : 'tap to set'} />
      <div class="row wrap">
        <label class="field inline">Key <select value={key} onChange={e => setKey((e.target as HTMLSelectElement).value)}>{KEY_NAMES.map(k => <option value={k}>{k}{k === o.chart_key ? ' (chart)' : ''}</option>)}</select></label>
        <label class="field inline">Capo <select value={capo} onChange={e => setCapo(+(e.target as HTMLSelectElement).value)}>
          <option value={0}>none</option>{capoOptions(key).filter(c => c.capo > 0).map(c => <option value={c.capo}>{c.capo} → {c.shapes} shapes</option>)}
        </select></label>
        <button class={nash ? 'sel' : ''} onClick={() => setNash(!nash)}>{nash ? 'Numbers' : 'Chords'}</button>
      </div>
      {capo ? <p class="note">Capo {capo}, play <b>{shapeKey}</b> shapes; it sounds in <b>{key}</b>.</p> : null}
      {o.sections.map(s => (
        <section class="section">
          <h3>{s.name}</h3>
          <div class="chordline">{(nash ? s.numbers : s.chords_in_chart_key.map(show)).map(c => <span>{c}</span>)}</div>
        </section>
      ))}
      {o.chords_verified !== 'full' ? <p class="muted">Main sections only. Import your SongSelect chart for the full song (coming in a later update).</p> : null}
      {o.notes ? <p class="note">{o.notes}</p> : null}
      <h3>Chords{capo ? ` (shapes with capo ${capo})` : ''}</h3>
      <div class="chords">{used.map(c => <ChordDiagram name={c} shape={shapeFor(c)} size={0.9} />)}</div>
      {o.practice_for.length ? <p class="muted">Practices: {o.practice_for.map((id, i) => <span>{i ? ' · ' : ''}<a href={`#/lesson/${id}`}>{id} {cat.lessonById[id]?.title}</a></span>)}</p> : null}
      {o.links.songselect ? <p><a href={o.links.songselect} target="_blank" rel="noopener">Open in SongSelect ↗</a></p> : null}
    </div>
  );
}

// ---------- Tools ----------
export function Tools({ which }: { which?: string }) {
  return (
    <div class="page tools">
      <h1>Tools</h1>
      <div class="tabs">
        <a class={`btn ${which !== 'metronome' ? 'sel' : ''}`} href="#/tools/tuner">Tuner</a>
        <a class={`btn ${which === 'metronome' ? 'sel' : ''}`} href="#/tools/metronome">Metronome</a>
      </div>
      <div class="two">
        <section class={`card ${which === 'metronome' ? 'hide-narrow' : ''}`}><h2>Tuner</h2><TunerPanel /></section>
        <section class={`card ${which !== 'metronome' ? 'hide-narrow' : ''}`}><h2>Metronome</h2><MetronomePanel /></section>
      </div>
      <section class="card"><h2>Dotted-eighth delay</h2><DelayCalc /></section>
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
export function Settings({ cat, onChange }: { cat: Catalog; onChange: () => void }) {
  const [msg, setMsg] = useState('');
  const [inst, setInst] = useState(instrumentPref.get());
  const sl = getSetList();
  const onFile = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { const l = importSetList(await f.text(), cat.outlines); setMsg(`Imported ${l.songs.length} songs (${l.songs.filter(s => s.outlineId).length} with outlines), weeks ${l.weeks[0]} – ${l.weeks[l.weeks.length - 1]}.`); onChange(); }
    catch (err) { setMsg((err as Error).message); }
  };
  return (
    <div class="page">
      <h1>Settings</h1>
      <section class="card">
        <h2>Instrument</h2>
        <div class="row">{(['acoustic', 'electric', 'both'] as const).map(v => <button class={inst === v ? 'sel' : ''} onClick={() => { instrumentPref.set(v); setInst(v); }}>{v}</button>)}</div>
        <p class="muted">Hides the tracks you don't play on the Path. You can switch any time.</p>
      </section>
      <section class="card"><h2>Audio</h2><InputPicker /></section>
      <section class="card">
        <h2>Church set list</h2>
        <p class="muted">Import the set-list CSV (Name, new, total, then one column per week). It's stored only on this phone and never uploaded.</p>
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
        {sl ? <p>Current: {sl.songs.length} songs, imported {new Date(sl.importedAt).toLocaleDateString()}. <button class="small" onClick={() => { clearSetList(); setMsg('Set list removed.'); onChange(); }}>Remove</button></p> : null}
        {msg ? <p class="note">{msg}</p> : null}
      </section>
      <section class="card">
        <h2>About</h2>
        <p class="muted">Guitar Trainer v{__APP_VERSION__} · personal use. Song outlines are facts only (keys, chords, numbers); no lyrics. Chord library: chords-db, MIT License, Copyright (c) 2016 David Rubert.</p>
        <p><a href="./m0/">Audio test (M0)</a></p>
      </section>
    </div>
  );
}
