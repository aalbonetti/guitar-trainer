// Lesson text renderer: a small, safe markdown subset plus block-level embed tokens on their own line.
//   {{chord:G_4f}}  {{chords:G_4f,Cadd9,Dsus4}}  {{shape:E_shape_major@3}}  {{triad:tri_321_G_root}}
//   {{scale:Am_pent_pos1}}  {{rhythm:S3_worship}}  {{exercise:EX_spider}}  {{song:SONG_amazing_grace}}
//   {{outline:MS_goodness_of_god}}  {{tool:tuner}}  {{tool:metronome:bpm=80,beats=4,sub=2}}  {{tool:delay}}  {{quiz:Q_note_names}}
import type { ComponentChildren } from 'preact';
import type { Catalog, Exercise } from '../catalog';
import { shapeFor, type Shape } from '../music';
import { ChordDiagram, ScaleDiagram, StrumGrid } from './Diagrams';
import { startMetronome, setMetro } from '../audio/engine';
import { QuizCard } from './Quiz';
import { TOKEN_RE } from '../tokens';
import { usePracticeTempo } from './Timing';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((#\/[^)\s]+|https:\/\/[^)\s]+)\)/g, (_m, t, h) => `<a href="${h}"${h.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`);
}

/** Markdown subset: ## headings, paragraphs, - / 1. lists, | tables |, > tips. */
export function mdToHtml(md: string): string {
  const out: string[] = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { const n = Math.min(4, m[1].length + 1); out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*]\s+/, ''))}</li>`);
      out.push(`<ul>${items.join('')}</ul>`); continue;
    }
    if (/^\s*\d+\.\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*\d+\.\s+/, ''))}</li>`);
      out.push(`<ol>${items.join('')}</ol>`); continue;
    }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i++].trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        if (!cells.every(c => /^:?-+:?$/.test(c))) rows.push(cells);
      }
      const [head, ...body] = rows;
      out.push(`<div class="tablewrap"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (l.startsWith('>')) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) parts.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<div class="tip">${inline(parts.join(' '))}</div>`); continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\s*[-*]\s|\s*\d+\.\s|\||>|\{\{)/.test(lines[i])) para.push(lines[i++]);
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); else i++;
  }
  return out.join('\n');
}


export function LessonContent({ md, cat, lessonId }: { md: string; cat: Catalog; lessonId: string }) {
  const blocks: ComponentChildren[] = [];
  let buf: string[] = [];
  const flush = () => { if (buf.length) { blocks.push(<div class="md" dangerouslySetInnerHTML={{ __html: mdToHtml(buf.join('\n')) }} />); buf = []; } };
  for (const line of md.split('\n')) {
    const m = TOKEN_RE.exec(line.trim());
    if (m) { flush(); blocks.push(<Embed kind={m[1]} arg={m[2]} cat={cat} lessonId={lessonId} />); } else buf.push(line);
  }
  flush();
  return <div class="content">{blocks}</div>;
}

function curated(cat: Catalog, id: string): { name: string; shape: Shape } | null {
  const c = cat.chords.find(x => x.id === id);
  if (c) return { name: c.name, shape: { frets: c.frets, fingers: c.fingers, barre: c.barre ? c.barre.fret : null } };
  const s = shapeFor(id);
  return s ? { name: id, shape: s } : null;
}

const SUBS = ['', '', 'eighths', 'triplets', 'sixteenths'];
function ClickButton({ preset, note }: { preset: { bpm: number; beats: number; sub: number }; note?: string }) {
  return <p><button class="chip" onClick={() => { setMetro(preset); startMetronome(preset); }}>▶ Click at {preset.bpm} BPM{preset.sub > 1 ? ` (${SUBS[preset.sub]})` : ''}{note ? ` · ${note}` : ''}</button></p>;
}
/** {{tool:metronome:bpm=ladder}}: clicks at the lesson's current practice tempo. */
function LadderClick({ l, base }: { l: import('../catalog').Lesson; base: { bpm: number; beats: number; sub: number } }) {
  const t = usePracticeTempo(l);
  return <ClickButton preset={{ ...base, bpm: t ? t.bpm : base.bpm }} note={t ? (t.atGoal ? 'goal tempo' : 'your practice tempo') : undefined} />;
}

function Embed({ kind, arg, cat, lessonId }: { kind: string; arg: string; cat: Catalog; lessonId: string }) {
  switch (kind) {
    case 'chord': case 'chords': {
      const list = arg.split(',').map(s => s.trim()).map(id => curated(cat, id) || { name: id, shape: null as Shape | null });
      return <div class="chords embed">{list.map(c => <ChordDiagram name={c.name} shape={c.shape} />)}</div>;
    }
    case 'shape': {
      const [id, at] = arg.split('@');
      const s = cat.shapes.movable_chords.find(x => x.id === id) as unknown as { id: string; quality: string; root_string: number; offsets: (number | null)[] } | undefined;
      if (!s) return <p class="error">Unknown shape {id}</p>;
      const n = +(at || 1);
      const frets = s.offsets.map(o => (o === null ? -1 : o + n));
      const names = ['E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C', 'C#', 'D', 'D#'];
      const root = s.root_string === 6 ? names[n % 12] : names[(n + 5) % 12];
      const q = s.quality === 'major' ? '' : s.quality === 'minor' ? 'm' : s.quality;
      return <div class="chords embed"><ChordDiagram name={`${root}${q} (${id.replace(/_/g, ' ')}, fret ${n})`} shape={{ frets, barre: frets.filter(f => f === n).length > 2 ? n : null }} /></div>;
    }
    case 'triad': {
      const t = cat.shapes.triads.find(x => x.id === arg);
      if (!t) return <p class="error">Unknown triad {arg}</p>;
      const frets = [-1, -1, -1, -1, -1, -1]; t.strings.forEach((s, i) => { frets[6 - s] = t.frets[i]; });
      return <div class="chords embed"><ChordDiagram name={`${t.root}${t.quality === 'minor' ? 'm' : ''} · ${arg.split('_').slice(-1)[0].replace('inv', 'inversion ').replace('root', 'root position')}`} shape={{ frets }} /></div>;
    }
    case 'scale': { const s = cat.scales.find(x => x.id === arg); return s ? <ScaleDiagram scale={s} /> : <p class="error">Unknown scale {arg}</p>; }
    case 'rhythm': {
      const s = cat.strums.find(x => x.id === arg);
      if (s) return <StrumGrid strum={s} />;
      const p = cat.picking.find(x => x.id === arg);
      return p ? <PickGrid p={p} /> : <p class="error">Unknown pattern {arg}</p>;
    }
    case 'exercise': { const e = cat.exercises.find(x => x.id === arg); return e ? <ExerciseView e={e} cat={cat} /> : <p class="error">Unknown exercise {arg}</p>; }
    case 'song': { const s = cat.songs.find(x => x.id === arg); return s ? <PdSong s={s} /> : <p class="error">Unknown song {arg}</p>; }
    case 'outline': { const o = cat.outlineById[arg]; return o ? <p><a class="btn" href={`#/song/${o.id}`}>♪ {o.title} · {o.chart_key}</a></p> : <p class="error">Unknown song {arg}</p>; }
    case 'tool': {
      const [name, params] = arg.split(':');
      if (name === 'metronome') {
        const raw: Record<string, string> = Object.fromEntries((params || '').split(',').filter(Boolean).map(kv => kv.split('=').map(x => x.trim())));
        const p = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, +v]));
        const base = { bpm: p.bpm || 80, beats: p.beats || 4, sub: p.sub || 1 };
        return raw.bpm === 'ladder' && cat.lessonById[lessonId] ? <LadderClick l={cat.lessonById[lessonId]} base={base} /> : <ClickButton preset={base} />;
      }
      if (name === 'tuner') return <p><a class="btn" href="#/tools/tuner">🎚 Open the tuner</a> <small class="muted">or use the Tuner button at the top of this lesson</small></p>;
      if (name === 'delay') return <p><a class="btn" href="#/tools/metronome">⏱ Delay calculator (Tools)</a></p>;
      return null;
    }
    case 'quiz': return <QuizCard id={arg} lessonId={lessonId} cat={cat} />;
    default: return <p class="error">Unknown embed {kind}</p>;
  }
}

function PickGrid({ p }: { p: { id: string; name?: string; meter: string; grid: number; steps: Record<string, string | number>[] } }) {
  return (
    <figure class="strum"><figcaption>{p.name || p.id} <small>{p.meter} · p = thumb, i m a = fingers</small></figcaption>
      <div class="grid" style={{ gridTemplateColumns: `repeat(${p.steps.length}, 1fr)` }}>
        {p.steps.map(st => { const [f, s] = Object.entries(st)[0]; return <div class="cell"><b>{f}</b><span>{s === 'root' ? 'bass' : s === 'alt_bass' ? 'alt' : `str ${s}`}</span></div>; })}
      </div>
    </figure>
  );
}

/** Tab for `tab` exercises (one column per eighth or sixteenth), chord pairs for `chord_changes`. */
function ExerciseView({ e, cat }: { e: Exercise & { events?: { beat: number; string: number; fret: number; dur: number; tech?: string }[] }; cat: Catalog }) {
  if (e.type === 'chord_changes' && e.pairs) {
    const name = (id: string) => cat.chords.find(c => c.id === id)?.name.replace(/\s*\(.*\)$/, '') || id;
    return <div class="card inset"><b>{e.name}</b><p class="muted">60 seconds per pair, as many clean changes as you can:</p><div class="chordline">{e.pairs.map(p => <span>{p.map(name).join(' ↔ ')}</span>)}</div></div>;
  }
  const ev = e.events || [];
  if (!ev.length) return <div class="card inset"><b>{e.name}</b></div>;
  const beatsPerBar = +(e.meter || '4/4').split('/')[0];
  const steps = ev.map(x => x.beat % 1).some(f => Math.abs(f * 4 - Math.round(f * 4)) < 1e-6 && Math.round(f * 4) % 2 === 1) ? 4 : 2;
  const totalBeats = Math.ceil(Math.max(...ev.map(x => x.beat + x.dur)) / beatsPerBar) * beatsPerBar;
  const bars = Math.min(4, totalBeats / beatsPerBar);
  const cols = bars * beatsPerBar * steps;
  const names = ['e', 'B', 'G', 'D', 'A', 'E'];
  const lines = names.map((n, idx) => {
    const string = idx + 1;
    const cells = Array.from({ length: cols }, () => '--');
    for (const x of ev) { const c = Math.round(x.beat * steps); if (x.string === string && c < cols) cells[c] = String(x.fret).padEnd(2, '-'); }
    const withBars = cells.map((c, i) => (i % (beatsPerBar * steps) === 0 ? '|' : '') + c).join('');
    return `${n}${withBars}|`;
  });
  const more = totalBeats / beatsPerBar > bars;
  return (
    <div class="card inset"><b>{e.name}</b>
      {e.tempo ? <p class="muted">Start at {e.tempo.start} BPM, add {e.tempo.step} BPM after 3 clean runs, target {e.tempo.target}.</p> : null}
      <pre class="tab">{lines.join('\n')}</pre>
      {more ? <small class="muted">First {bars} bars shown; the pattern continues the same way.</small> : null}
      {ev.some(x => x.tech) ? <small class="muted">{[...new Set(ev.map(x => x.tech).filter(Boolean))].map(t => t!.replace(/_/g, ' ')).join(', ')}</small> : null}
    </div>
  );
}

function PdSong({ s }: { s: { title: string; words: string; tune: string; key: string; meter: string; tempo: number; sections: { name: string; bars: string[]; lyrics: string[] }[] } }) {
  return (
    <div class="card inset pdsong">
      <b>{s.title}</b> <small class="muted">{s.words} · {s.tune} · key {s.key} · {s.meter} · {s.tempo} BPM · public domain</small>
      {s.sections.map(sec => (
        <div><h4>{sec.name}</h4>
          <div class="chordline">{sec.bars.map(b => <span>{b}</span>)}</div>
          <p class="lyrics">{sec.lyrics.map(l => <span>{l}<br /></span>)}</p>
        </div>
      ))}
    </div>
  );
}
