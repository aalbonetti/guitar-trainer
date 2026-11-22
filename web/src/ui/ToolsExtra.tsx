// Tools: chord library (every chords-db voicing, with "hear it"), scale viewer (any key for movable shapes),
// and the capo / transpose calculator.
import { useMemo, useState } from 'preact/hooks';
import type { Catalog, Scale } from '../catalog';
import { KEY_NAMES, pcOf, keyName, keyUsesFlats, capoOptions, transposeChord, parseChord, libSuffixes, voicings, shapeMidi, shapeFor } from '../music';
import { ChordDiagram, ScaleDiagram } from './Diagrams';
import { playChords } from '../audio/engine';
import { useStore, persisted } from '../store';
import { progress } from '../progressStore';
import { knownChords } from '../songfit';

// ---------- chord library ----------
const COMMON = ['major', 'minor', '7', 'maj7', 'm7', 'sus2', 'sus4', 'add9', '7sus4', '6', 'm6', '9', 'dim', 'aug', 'm7b5', 'madd9'];
const SHOWN: Record<string, string> = { major: '', minor: 'm' };
const label = (root: string, suffix: string) => root + (suffix in SHOWN ? SHOWN[suffix] : suffix);
const libPref = persisted<{ root: string; suffix: string }>('gt_chordlib', { root: 'G', suffix: 'major' });

export function ChordLibrary() {
  const [sel, setSelState] = useState(libPref.get());
  const setSel = (v: { root: string; suffix: string }) => { setSelState(v); libPref.set(v); };
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const all = libSuffixes(sel.root).filter(s => !s.startsWith('/') && !s.startsWith('m/'));
  const list = more ? all : COMMON.filter(s => all.includes(s));
  const vs = voicings(sel.root, sel.suffix);
  const search = (text: string) => {
    setQ(text);
    const c = parseChord(text.trim().replace(/^([a-g])/, m => m.toUpperCase()));
    if (!c || Number.isNaN(pcOf(c.root))) return;
    const map: Record<string, string> = { '': 'major', m: 'minor', min: 'minor', sus: 'sus4', '2': 'add9', m2: 'madd9' };
    const suffix = map[c.suffix] ?? c.suffix;
    const root = keyName(pcOf(c.root));
    if (libSuffixes(root).includes(suffix)) setSel({ root, suffix });
  };
  const curated = shapeFor(label(sel.root, sel.suffix));
  return (
    <div class="chordlib">
      <input type="search" placeholder="Type a chord: F#m7, Cadd9, Dsus4…" value={q} onInput={e => search((e.target as HTMLInputElement).value)} />
      <div class="keys">{KEY_NAMES.map(k => <button class={`small ${sel.root === k ? 'sel' : ''}`} onClick={() => setSel({ ...sel, root: k })}>{k}</button>)}</div>
      <div class="keys">{list.map(s => <button class={`small ${sel.suffix === s ? 'sel' : ''}`} onClick={() => setSel({ ...sel, suffix: s })}>{label('', s) || 'major'}</button>)}
        <button class="small ghost" onClick={() => setMore(!more)}>{more ? 'fewer' : 'more…'}</button></div>
      <p class="chordtitle"><b>{label(sel.root, sel.suffix)}</b> <small class="muted">{vs.length} voicing{vs.length === 1 ? '' : 's'}</small></p>
      <div class="chords">
        {(curated && !vs.some(v => v.frets.join() === curated.frets.join()) ? [curated, ...vs] : vs).map((v, i) => (
          <button class="chordbtn" onClick={() => playChords([shapeMidi(v)], 0)} aria-label={`Play ${label(sel.root, sel.suffix)} voicing ${i + 1}`}>
            <ChordDiagram name={i === 0 ? label(sel.root, sel.suffix) : `${label(sel.root, sel.suffix)} · ${i + 1}`} shape={v} size={0.9} />
          </button>
        ))}
      </div>
      <p class="muted small">Tap a diagram to hear it. Voicings from chords-db (MIT).</p>
    </div>
  );
}

// ---------- scale viewer ----------
function shifted(s: Scale, key: string): Scale {
  if (!s.movable) return s;
  let d = ((pcOf(key) - pcOf(s.root)) % 12 + 12) % 12;
  const lo = Math.min(...s.frets.flat());
  if (lo + d - 12 >= 0) d -= 12; // lowest position on the neck (open strings count)
  const name = s.name.replace(new RegExp(`^${s.root}\\b`), key);
  return { ...s, root: key, name, frets: s.frets.map(fs => fs.map(f => f + d)) };
}
export function ScaleViewer({ cat }: { cat: Catalog }) {
  const [id, setId] = useState(cat.scales[0]?.id || '');
  const base = cat.scales.find(s => s.id === id) || cat.scales[0];
  const [key, setKey] = useState(base?.root || 'A');
  if (!base) return <p class="muted">No scales in the catalog.</p>;
  const sc = shifted(base, base.movable ? key : base.root);
  return (
    <div>
      <div class="row wrap">
        <label class="field inline">Scale <select value={id} onChange={e => { const v = (e.target as HTMLSelectElement).value; setId(v); const s = cat.scales.find(x => x.id === v); if (s && !s.movable) setKey(s.root); }}>
          {cat.scales.map(s => <option value={s.id}>{s.name.replace(/^[A-G][#b]? /, '')}</option>)}</select></label>
        <label class="field inline">Key <select value={base.movable ? key : base.root} disabled={!base.movable} onChange={e => setKey((e.target as HTMLSelectElement).value)}>
          {KEY_NAMES.map(k => <option value={k}>{k}</option>)}</select></label>
      </div>
      <ScaleDiagram scale={sc} />
      {!base.movable ? <p class="muted small">This shape uses open strings, so it stays in {base.root}.</p> : null}
    </div>
  );
}

// ---------- capo + transpose ----------
export function CapoCalc({ cat }: { cat: Catalog }) {
  const pr = useStore(progress);
  const known = useMemo(() => knownChords(cat, pr.lp), [pr.lp]);
  const [key, setKey] = useState('Ab');
  const [capo, setCapo] = useState(2);
  const [shapes, setShapes] = useState('G');
  const [text, setText] = useState('G C D Em');
  const [from, setFrom] = useState('G');
  const [to, setTo] = useState('A');
  const spots = [{ capo: 0, shapes: key }, ...capoOptions(key).filter(c => c.capo > 0)];
  const fam: Record<string, string[]> = { G: ['G', 'C', 'D', 'Em'], C: ['C', 'F', 'G', 'Am'], D: ['D', 'G', 'A', 'Bm'], E: ['E', 'A', 'B', 'C#m'], A: ['A', 'D', 'E', 'F#m'] };
  const knowsFamily = (sh: string) => (fam[sh] ? fam[sh].every(c => known.has(c)) : false);
  const semis = (pcOf(to) - pcOf(from) + 12) % 12, flats = keyUsesFlats(to);
  const out = text.split(/(\s+|\||-)/).map(t => (t.trim() && parseChord(t) ? transposeChord(t, semis, flats) : t)).join('');
  return (
    <div class="capocalc">
      <h3>Song key → capo</h3>
      <label class="field inline">The song is in <select value={key} onChange={e => setKey((e.target as HTMLSelectElement).value)}>{KEY_NAMES.map(k => <option value={k}>{k}</option>)}</select></label>
      <ul class="list">{spots.map(sp => <li><div class="spot"><span><b>{sp.capo ? `Capo ${sp.capo}` : 'No capo'}</b> → play <b>{sp.shapes}</b> shapes</span>{fam[sp.shapes] ? <small>{fam[sp.shapes].join(' ')}{knowsFamily(sp.shapes) ? ' · you know these ✓' : ''}</small> : <small>barre or less common shapes</small>}</div></li>)}</ul>
      <h3>Capo → real key</h3>
      <div class="row wrap">
        <label class="field inline">Capo <select value={capo} onChange={e => setCapo(+(e.target as HTMLSelectElement).value)}>{Array.from({ length: 10 }, (_, i) => <option value={i}>{i}</option>)}</select></label>
        <label class="field inline">playing <select value={shapes} onChange={e => setShapes((e.target as HTMLSelectElement).value)}>{KEY_NAMES.map(k => <option value={k}>{k}</option>)}</select> shapes</label>
      </div>
      <p>Sounds in <b class="big">{keyName(pcOf(shapes) + capo)}</b></p>
      <h3>Transpose chords</h3>
      <textarea class="transin" value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)} rows={2} />
      <div class="row wrap">
        <label class="field inline">from <select value={from} onChange={e => setFrom((e.target as HTMLSelectElement).value)}>{KEY_NAMES.map(k => <option value={k}>{k}</option>)}</select></label>
        <label class="field inline">to <select value={to} onChange={e => setTo((e.target as HTMLSelectElement).value)}>{KEY_NAMES.map(k => <option value={k}>{k}</option>)}</select></label>
      </div>
      <p class="transout">{out}</p>
      {known.size ? <p class="muted small">Chords you've learned: {[...known].sort().join(' ')}</p> : null}
    </div>
  );
}
