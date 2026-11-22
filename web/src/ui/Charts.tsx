// Chart import (file or paste → preview → save) and the chart view (key, capo, numbers, chords over words).
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Catalog } from '../catalog';
import { useStore, persisted } from '../store';
import { parseChart, type ParsedChart, type ChartLine } from '../chordpro';
import { charts, rowFrom, saveChart, deleteChart, parsed, loadCharts } from '../charts';
import { transposeChord, keyUsesFlats, pcOf, keyName, KEY_NAMES, capoOptions, shapeFor } from '../music';
import { ChordDiagram } from './Diagrams';
import { ToolBar } from './Tools';
import { toNumber } from '../chordpro';

export function ImportView({ cat }: { cat: Catalog }) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const p: ParsedChart | null = useMemo(() => (text.trim() ? parseChart(text, name) : null), [text, name]);
  const match = useMemo(() => (p ? rowFrom(p, text, name, cat.outlines).matched_outline_id : null), [p]);
  const onFile = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    if (f.size > 500_000) { setErr('That file is too big to be a chart.'); return; }
    setErr(''); setName(f.name); setText(await f.text());
  };
  const save = async () => {
    if (!p) return;
    const row = rowFrom(p, text, name || 'pasted.txt', cat.outlines);
    try { await saveChart(row); location.hash = `#/chart/${row.id}`; } catch (e) { setErr('Could not save: ' + (e as Error).message); }
  };
  return (
    <div class="page">
      <div class="crumbs"><a href="#/songs">Songs</a> › Import</div>
      <h1>Import a chart</h1>
      <div class="two">
        <div>
          <section class="card">
            <h2>From a file</h2>
            <p class="muted">ChordPro (.cho, .chordpro, .pro) or a .txt chart, e.g. downloaded from SongSelect.</p>
            <input type="file" accept=".cho,.chordpro,.pro,.crd,.txt,text/plain" onChange={onFile} />
          </section>
          <section class="card">
            <h2>Or paste it</h2>
            <textarea class="paste" value={text} placeholder={'{title: …}\n{key: G}\n[G]words [C]words\n\nor chords above the words'} onInput={e => { setName(''); setText((e.target as HTMLTextAreaElement).value); }} />
            <p class="muted small">Charts you import stay on this phone. They're never uploaded or added to the app's public files.</p>
          </section>
          {err ? <p class="error">{err}</p> : null}
        </div>
        <div>
          {p ? (
            <section class="card">
              <h2>Preview</h2>
              <p><b>{p.title}</b>{p.artist ? <span class="muted"> · {p.artist}</span> : null}</p>
              <p class="muted">Key {p.key || '?'}{p.tempo ? ` · ${p.tempo} BPM` : ''}{p.time ? ` · ${p.time}` : ''}{p.capo ? ` · capo ${p.capo}` : ''}{p.ccli ? ` · CCLI ${p.ccli}` : ''} · {p.format === 'chordpro' ? 'ChordPro' : 'plain text'}</p>
              <p>{match ? <span class="okText">Matches “{cat.outlineById[match]?.title}”: it'll link to that song's lessons.</span> : <span class="muted">No matching song outline (that's fine).</span>}</p>
              {p.sections.map(s => <div class="prevsec"><b>{s.name}</b> <span class="muted">{s.numbers.slice(0, 12).join(' ')}{s.numbers.length > 12 ? ' …' : ''}</span></div>)}
              {p.warnings.length || p.unknown.length ? <p class="note">{[...p.warnings, ...(p.unknown.length ? [`Ignored: {${p.unknown.join('}, {')}}`] : [])].join(' · ')}</p> : null}
              <button class="primary" disabled={!p.sections.some(s => s.chords.length)} onClick={save}>Save to My charts</button>
            </section>
          ) : <section class="card"><p class="muted">Pick a file or paste a chart to see a preview.</p></section>}
        </div>
      </div>
    </div>
  );
}

export function MyCharts() {
  const c = useStore(charts);
  useEffect(() => { if (!c.ready) void loadCharts(); }, []);
  return (
    <div>
      <a class="btn primary" href="#/import">＋ Import a chart</a>
      {c.list.length ? <ul class="list">{c.list.map(r => <li><a href={`#/chart/${r.id}`}>{r.title}<small>{r.artist ? r.artist + ' · ' : ''}key {r.key || '?'}{r.tempo ? ` · ${r.tempo} BPM` : ''}</small></a></li>)}</ul>
        : <p class="muted">No charts yet. Import the ChordPro or text charts you have from SongSelect or your worship leader.</p>}
    </div>
  );
}

const lyricsPref = persisted<boolean>('gt_chart_words', true);

/** One line: chords sit above the syllable they start on. */
function Line({ l, show, words }: { l: ChartLine; show: (c: string) => string; words: boolean }) {
  if (!words || !l.lyric.trim()) return l.chords.length ? <div class="cline chordsonly">{l.chords.map(c => <b>{show(c.chord)}</b>)}</div> : <div class="cline lyriconly">{words ? l.lyric : ''}</div>;
  const segs: { chord: string | null; text: string }[] = [];
  const cs = [...l.chords].sort((a, b) => a.at - b.at);
  if (!cs.length || cs[0].at > 0) segs.push({ chord: null, text: l.lyric.slice(0, cs.length ? cs[0].at : undefined) });
  cs.forEach((c, i) => segs.push({ chord: show(c.chord), text: l.lyric.slice(c.at, cs[i + 1]?.at ?? undefined) }));
  return <div class="cline">{segs.map(s => <span class="seg"><b>{s.chord ?? ' '}</b><span>{s.text || ' '}</span></span>)}</div>;
}

export function ChartView({ cat, id }: { cat: Catalog; id: string }) {
  const c = useStore(charts);
  useEffect(() => { if (!c.ready) void loadCharts(); }, []);
  const row = c.list.find(r => r.id === id);
  const p = useMemo(() => (row ? parsed(row) : null), [row?.raw_text]);
  const [key, setKey] = useState<string | null>(null);
  const [capo, setCapo] = useState<number | null>(null);
  const [nash, setNash] = useState(false);
  const [words, setWords] = useState(lyricsPref.get());
  if (!c.ready) return <div class="page"><p class="muted">Loading…</p></div>;
  if (!row || !p) return <div class="page"><p>Chart not found. <a href="#/songs">Back to Songs</a></p></div>;
  const chartKey = p.key || 'C', k = key || chartKey, cp = capo ?? (key ? 0 : p.capo);
  const semis = ((pcOf(k) - pcOf(chartKey)) % 12 + 12) % 12;
  const shapeKey = keyName(pcOf(k) - cp), flats = keyUsesFlats(shapeKey);
  const show = (ch: string) => (nash ? toNumber(ch, chartKey) : transposeChord(ch, semis - cp, flats));
  const used = [...new Set(p.sections.flatMap(s => s.chords))].map(ch => transposeChord(ch, semis - cp, flats));
  const o = row.matched_outline_id ? cat.outlineById[row.matched_outline_id] : null;
  const meter = p.time || o?.meter || '4/4';
  const beats = meter.startsWith('3') ? 3 : meter === '6/8' ? 2 : 4, sub = meter === '6/8' ? 3 : 1;
  return (
    <div class="page chartpage">
      <div class="crumbs"><a href="#/songs/mine">My charts</a></div>
      <h1>{p.title}</h1>
      <p class="muted">{p.artist ? p.artist + ' · ' : ''}chart key {chartKey}{p.tempo ? ` · ${p.tempo} BPM` : ''} · {meter}{p.ccli ? ` · CCLI ${p.ccli}` : ''}</p>
      <ToolBar preset={{ bpm: Math.round(p.tempo || o?.bpm || 72), beats, sub }} label={p.tempo || o?.bpm ? 'song tempo' : 'tap to set'} />
      <div class="row wrap">
        <label class="field inline">Key <select value={k} onChange={e => { setKey((e.target as HTMLSelectElement).value); setCapo(0); }}>{KEY_NAMES.map(x => <option value={x}>{x}{x === chartKey ? ' (chart)' : ''}</option>)}</select></label>
        <label class="field inline">Capo <select value={cp} onChange={e => setCapo(+(e.target as HTMLSelectElement).value)}>
          <option value={0}>none</option>{capoOptions(k).filter(x => x.capo > 0).map(x => <option value={x.capo}>{x.capo} → {x.shapes} shapes</option>)}
          {cp && !capoOptions(k).some(x => x.capo === cp) ? <option value={cp}>{cp}</option> : null}
        </select></label>
        <button class={nash ? 'sel' : ''} onClick={() => setNash(!nash)}>{nash ? 'Numbers' : 'Chords'}</button>
        <button class={words ? 'sel' : ''} onClick={() => { setWords(!words); lyricsPref.set(!words); }}>{words ? 'Words on' : 'Chords only'}</button>
      </div>
      {cp ? <p class="note">Capo {cp}, play <b>{shapeKey}</b> shapes; it sounds in <b>{k}</b>.</p> : null}
      <div class="two">
        <div class="chart">
          {p.sections.map(s => <section class="section"><h3>{s.name}</h3>{s.lines.map(l => <Line l={l} show={show} words={words} />)}</section>)}
        </div>
        <div>
          <section class="card"><h2>Chords{cp ? ` (capo ${cp} shapes)` : ''}</h2><div class="chords">{used.map(ch => <ChordDiagram name={ch} shape={shapeFor(ch)} size={0.9} />)}</div></section>
          {o ? <section class="card"><h2>Linked song</h2><p><a href={`#/song/${o.id}`}>{o.title}</a> outline{o.practice_for.length ? <span class="muted"> · practices {o.practice_for.map((l, i) => <span>{i ? ', ' : ''}<a href={`#/lesson/${l}`}>{l}</a></span>)}</span> : null}</p></section> : null}
          <section class="card"><p class="muted small">Imported {new Date(row.imported_at).toLocaleDateString()}{row.source_filename ? ` from ${row.source_filename}` : ''}. Stored on this phone only.</p>
            <button class="small" onClick={async () => { if (confirm(`Delete “${p.title}” from My charts?`)) { await deleteChart(row.id); location.hash = '#/songs/mine'; } }}>Delete chart</button></section>
        </div>
      </div>
    </div>
  );
}
