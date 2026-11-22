// Song view: chords in any key or as numbers, a capo spot picked for the chords you know (remembered per song),
// chord diagrams, and play-along (the current chord lights up on the click). Two panes when there's room.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Catalog, Outline } from '../catalog';
import { shapeFor, transposeChord, keyUsesFlats, pcOf, keyName, KEY_NAMES, capoOptions } from '../music';
import { ChordDiagram } from './Diagrams';
import { ToolBar } from './Tools';
import { persisted, useStore } from '../store';
import { progress } from '../progressStore';
import { charts, chartFor } from '../charts';
import { noteSongOpened } from '../practice';
import { knownChords, bestCapo, fitLine, type Fit } from '../songfit';
import { metro, startMetronome, stopMetronome } from '../audio/engine';

/** Per-song key and capo. A song without a saved capo uses the suggested one for the chords you know. */
export const songViewPref = persisted<Record<string, { key?: string; capo?: number }>>('gt_song_view', {});
const oldKeyPref = persisted<Record<string, string>>('gt_song_keys', {}); // before per-song capo existed

export function songSettings(cat: Catalog, o: Outline, lp: Parameters<typeof knownChords>[1]): { key: string; capo: number; fit: Fit; suggested: boolean } {
  const saved = songViewPref.get()[o.id] || {};
  const key = saved.key || oldKeyPref.get()[o.id] || o.chart_key;
  const fit = bestCapo(o, key, knownChords(cat, lp));
  const suggested = saved.capo === undefined;
  return { key, capo: suggested ? fit.capo : saved.capo!, fit, suggested };
}

export function SongView({ cat, o }: { cat: Catalog; o: Outline }) {
  const pr = useStore(progress);
  const [, bump] = useState(0);
  useEffect(() => { noteSongOpened(o.id); }, [o.id]);
  useStore(charts); const myChart = chartFor(o.id);
  const [nash, setNash] = useState(false);
  const st = songSettings(cat, o, pr.lp);
  const { key, capo } = st;
  const save = (v: { key?: string; capo?: number }) => { const all = { ...songViewPref.get() }; all[o.id] = { ...all[o.id], ...v }; songViewPref.set(all); bump(x => x + 1); };
  const setKey = (k: string) => { const all = { ...songViewPref.get() }; all[o.id] = { key: k }; songViewPref.set(all); bump(x => x + 1); }; // new key: capo goes back to the suggestion
  const semis = (pcOf(key) - pcOf(o.chart_key) + 12) % 12;
  const shapeKey = keyName(pcOf(key) - capo);
  const flats = keyUsesFlats(shapeKey);
  const show = (ch: string) => transposeChord(ch, semis - capo, flats);
  const used = useMemo(() => [...new Set(o.sections.flatMap(s => s.chords_in_chart_key))].map(show), [o.id, key, capo]);
  const beats = o.meter && o.meter.startsWith('3') ? 3 : o.meter === '6/8' ? 2 : 4;
  const sub = o.meter === '6/8' ? 3 : 1;
  const fitHere = st.suggested || capo === st.fit.capo ? st.fit : null;
  const pa = usePlayAlong(o, beats);
  return (
    <div class="song">
      <a class="back-narrow" href="#/songs">‹ Songs</a>
      <h2 class="title">{o.title}</h2>
      <p class="muted">{o.artist}{o.ccli ? ` · CCLI ${o.ccli}` : ''} · original key {o.original_key}{o.bpm ? ` · ${o.bpm} BPM` : ''}{o.meter ? ` · ${o.meter}` : ''}</p>
      <ToolBar preset={{ bpm: o.bpm || 72, beats, sub, meter: o.meter || '4/4' }} label={o.bpm ? 'song tempo' : 'tap to set'} />
      <div class="row wrap">
        <label class="field inline">Key <select value={key} onChange={e => setKey((e.target as HTMLSelectElement).value)}>{KEY_NAMES.map(k => <option value={k}>{k}{k === o.chart_key ? ' (chart)' : ''}</option>)}</select></label>
        <label class="field inline">Capo <select value={capo} onChange={e => save({ capo: +(e.target as HTMLSelectElement).value })}>
          <option value={0}>none{st.fit.capo === 0 ? ' (suggested)' : ''}</option>{capoOptions(key).filter(c => c.capo > 0).map(c => <option value={c.capo}>{c.capo} → {c.shapes} shapes{c.capo === st.fit.capo ? ' (suggested)' : ''}</option>)}
        </select></label>
        <button class={nash ? 'sel' : ''} onClick={() => setNash(!nash)}>{nash ? 'Numbers' : 'Chords'}</button>
      </div>
      {capo ? <p class="note">Capo {capo}, play <b>{shapeKey}</b> shapes; it sounds in <b>{key}</b>.</p> : null}
      {fitHere ? <p class="muted small fit">{fitLine(fitHere, false)}</p>
        : <p class="muted small fit">The suggested spot for the chords you know is {st.fit.capo ? `capo ${st.fit.capo}` : 'no capo'}. <button class="small" onClick={() => { const all = { ...songViewPref.get() }; delete all[o.id]?.capo; songViewPref.set(all); bump(x => x + 1); }}>Use it</button></p>}
      <div class="songcols">
        <div class="songmain">
          <div class="playalong">
            {pa.on ? <>
              <div class="now">{pa.countIn ? <span class="count">{pa.countIn}</span> : <><b>{nash ? o.sections[pa.cur!.si].numbers[pa.cur!.ci] : show(o.sections[pa.cur!.si].chords_in_chart_key[pa.cur!.ci])}</b>
                <small>{o.sections[pa.cur!.si].name} · next {nash ? o.sections[pa.next!.si].numbers[pa.next!.ci] : show(o.sections[pa.next!.si].chords_in_chart_key[pa.next!.ci])}</small></>}</div>
              <button onClick={pa.stop}>■ Stop</button>
            </> : <>
              <button class="primary" onClick={() => pa.start(o.bpm || metro.get().bpm || 72, sub)}>▶ Play along</button>
              <label class="field inline">Each chord <select value={pa.bars} onChange={e => pa.setBars(+(e.target as HTMLSelectElement).value)}>
                <option value={0.5}>½ bar</option><option value={1}>1 bar</option><option value={2}>2 bars</option></select></label>
            </>}
          </div>
          {!pa.on ? <p class="muted small">Play-along clicks at {o.bpm || 'the metronome'} BPM after a one-bar count-in and lights up each chord. Song outlines don't store bar lengths, so pick how long each chord lasts.</p> : null}
          {o.sections.map((s, si) => (
            <section class="section">
              <h3>{s.name}</h3>
              <div class="chordline">{(nash ? s.numbers : s.chords_in_chart_key.map(show)).map((c, ci) => <span class={pa.cur && pa.cur.si === si && pa.cur.ci === ci ? 'now' : ''} data-now={pa.cur && pa.cur.si === si && pa.cur.ci === ci ? '1' : undefined}>{c}</span>)}</div>
            </section>
          ))}
          {myChart ? <p><a class="btn primary" href={`#/chart/${myChart.id}`}>Open your full chart</a></p>
            : o.chords_verified !== 'full' ? <p class="muted">Main sections only. <a href="#/import">Import your SongSelect chart</a> for the full song with words.</p> : <p class="muted small"><a href="#/import">Import your chart</a> to see the words with the chords.</p>}
          {o.notes ? <p class="note">{o.notes}</p> : null}
        </div>
        <aside class="songside">
          <h3>Chords{capo ? ` (shapes with capo ${capo})` : ''}</h3>
          <div class="chords">{used.map(c => <ChordDiagram name={c} shape={shapeFor(c)} size={0.9} />)}</div>
          {o.practice_for.length ? <p class="muted">Practices: {o.practice_for.map((id, i) => <span>{i ? ' · ' : ''}<a href={`#/lesson/${id}`}>{id} {cat.lessonById[id]?.title}</a></span>)}</p> : null}
          {o.links.songselect ? <p><a href={o.links.songselect} target="_blank" rel="noopener">Open in SongSelect ↗</a></p> : null}
        </aside>
      </div>
    </div>
  );
}

type Pos = { si: number; ci: number };
/** Play-along: one bar of count-in, then the chords in order, each `bars` long, looping at the end. */
function usePlayAlong(o: Outline, beats: number) {
  const m = useStore(metro);
  const [on, setOn] = useState(false);
  const [bars, setBars] = useState(1);
  const seq = useMemo(() => o.sections.flatMap((s, si) => s.chords_in_chart_key.map((_, ci) => ({ si, ci }))), [o.id]);
  const scrolled = useRef(-1);
  const started = useRef(false);
  useEffect(() => { if (!m.running && started.current) { started.current = false; setOn(false); } }, [m.running]); // stopped from the click strip
  useEffect(() => () => { if (started.current) stopMetronome(); }, [o.id]);
  const beatNo = m.running && m.tick >= 0 ? Math.floor(m.tick / m.sub) : -1;
  const per = Math.max(1, Math.round(beats * bars));
  let cur: Pos | null = null, next: Pos | null = null, countIn = 0;
  if (on) {
    if (beatNo < beats) countIn = beatNo < 0 ? beats : beats - beatNo;
    else { const i = Math.floor((beatNo - beats) / per) % seq.length; cur = seq[i]; next = seq[(i + 1) % seq.length]; }
  }
  const idx = cur ? seq.indexOf(cur) : -1;
  useEffect(() => {
    if (idx < 0 || idx === scrolled.current) return; scrolled.current = idx;
    document.querySelector('.chordline span[data-now="1"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [idx]);
  return {
    on: on && m.running, cur, next, countIn, bars, setBars,
    start: (bpm: number, sub: number) => { started.current = true; scrolled.current = -1; setOn(true); startMetronome({ bpm, beats, sub }); },
    stop: () => { started.current = false; setOn(false); stopMetronome(); },
  };
}
