// The untimed Arcade games: Note Drop, Fret Finder and Octave Jump (tap or play) plus the G1 choice games and
// Delay Math (tap). Each renders a `gside` (target, read-out) and a `gboard` (fretboard / answer pad); the
// shared frame in Arcade.tsx lays them out for the cover screen, the inner screen and tabletop.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Catalog, Game, GameLevel } from '../catalog';
import { pick, positionsOf, pcAt, noteLabel, pretty, callNumberQ, capoQ, hearQ, delayQ, DELAY_NOTES, zoneMidis, zoneRange, midiAt, octaveQ, type Pos, type ChoiceQ, type DelayQ, type Rng, type OctaveQ } from '../games/core';
import { midiName } from '../grading/pitch';
import { playChords } from '../audio/engine';
import { getSetList } from '../setlist';
import { songPool } from '../practice';
import { Fretboard, zoneOf, posText, useEars, useHeard, Hearing, askNow, type Round } from './GameKit';
import type { Heard } from '../games/judge';
import { noteSpot } from '../heat';

/** Daily Challenge focus: the pitch classes of the hard spots come up about half the time. */
const focusPc = (r: Rng, focus: Pos[], pcs: number[]): number | null => { const f = focus.map(pcAt).filter(pc => pcs.includes(pc)); return f.length && r() < 0.5 ? pick(r, f) : null; };

/** Play mode is slower than tapping (find it on the neck, then the app hears it), so its speed-bonus windows are wider. */
const WINDOWS = { note_drop: { tap: [900, 0], play: [1500, 0] }, fret_finder: { tap: [1200, 5000], play: [2000, 7000] }, octave_jump: { tap: [1200, 5000], play: [2000, 8000] } } as const;
const fmtPlaces = (ps: Pos[]) => ps.map(posText).join(' or ');
const useTick = (on: boolean, ms: number) => { const [, set] = useState(0); useEffect(() => { if (!on) return; const t = setInterval(() => set(x => x + 1), ms); return () => clearInterval(t); }, [on]); };

// ---------- Note Drop ----------
// Play mode: a note name falls; play that note somewhere in the highlighted zone. Any octave the zone holds is
// right (it's a note-names game); an octave outside the zone, or another note, is a miss.
export function NoteDrop({ l, round, r, focus = [] }: { l: GameLevel; round: Round; r: Rng; focus?: Pos[] }) {
  const zone = zoneOf(l), play = round.mode === 'play';
  const pcs = useMemo(() => Array.from({ length: 12 }, (_, pc) => pc).filter(pc => positionsOf(pc, zone).length), []);
  const mk = (pc: number, id: number) => ({ pc, start: round.now(), since: play ? askNow() : 0, id });
  const [q, setQ] = useState(() => mk(focusPc(r, focus, pcs) ?? pick(r, pcs), 0));
  const [marks, setMarks] = useState<{ p: Pos; cls: string }[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const speed = (l.params.speed || 1) * Math.pow(1.15, Math.floor(round.correct / 10));
  const fallMs = 6000 / speed;
  const [fast] = WINDOWS.note_drop[round.mode];
  const next = () => setQ(o => { let pc = focusPc(r, focus, pcs) ?? pick(r, pcs); if (pc === o.pc) pc = pick(r, pcs); round.askedAt.current = round.now(); return mk(pc, o.id + 1); });
  const ear = useEars(play && !round.paused, zoneRange(zone));
  useEffect(() => { let raf = 0; const f = () => { setT(round.now()); raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); return () => cancelAnimationFrame(raf); }, []);
  useEffect(() => {
    if (round.paused || t - q.start <= fallMs || round.lives <= 0) return;
    const where = positionsOf(q.pc, zone); setMarks(where.map(p => ({ p, cls: 'show' })));
    where.forEach(p => noteSpot(p, false));
    round.answer(false, `${noteLabel(q.pc)} on ${fmtPlaces(where)}`); setSaid('Too slow'); next();
  }, [t]);
  const tap = (p: Pos) => {
    if (play || round.paused) return;
    if (pcAt(p) === q.pc) { setMarks([{ p, cls: 'ok' }]); noteSpot(p, true, round.now() - q.start); round.answer(true, undefined, fast, fallMs); }
    else { setMarks([{ p, cls: 'bad' }, ...positionsOf(q.pc, zone).map(x => ({ p: x, cls: 'show' }))]); noteSpot(p, false); round.answer(false, `${noteLabel(q.pc)} (you tapped ${noteLabel(pcAt(p))} at ${posText(p)})`); }
    next();
  };
  const qRef = useRef(q); qRef.current = q;
  useHeard(play && !round.paused, ear.openedAt, () => ({ right: zoneMidis(qRef.current.pc, zone), since: qRef.current.since }), (h: Heard) => {
    const cur = qRef.current, where = positionsOf(cur.pc, zone);
    if (h.kind === 'right') { const at = where.filter(p => midiAt(p) === h.midi); setMarks(at.map(p => ({ p, cls: 'ok' }))); at.forEach(p => noteSpot(p, true, round.now() - cur.start)); setSaid(`✓ ${h.heard}`); round.answer(true, undefined, fast, fallMs); }
    else { setMarks(where.map(p => ({ p, cls: 'show' }))); where.forEach(p => noteSpot(p, false)); setSaid(`✗ heard ${h.heard}${h.why === 'octave' ? ': an octave outside the zone' : ''}`); round.answer(false, `${noteLabel(cur.pc)} on ${fmtPlaces(where)}${h.why === 'octave' ? ' (octave off)' : ''}`); }
    next();
  });
  const frac = Math.min(1, (t - q.start) / fallMs);
  return (
    <>
      <div class="gside">
        <div class="sky"><b class="drop" style={{ top: `${frac * 82}%` }}>{noteLabel(q.pc)}</b><div class="landing" /></div>
        {play ? <><Hearing e={ear} /><p class="muted small center">{said || 'Play the falling note in the lit zone, any octave the zone holds.'}</p></> : null}
        <p class="muted small center">{round.correct < 20 ? `${20 - round.correct} more to finish the round` : 'Round finished: keep going for points!'} · speed ×{speed.toFixed(2)}</p>
      </div>
      <div class="gboard"><Fretboard zone={zone} onTap={tap} marks={marks} tappable={!play} /></div>
    </>
  );
}

// ---------- Fret Finder ----------
// Play mode: the app can hear the pitch but not the string, so it walks the strings (6 → 1) and you play every
// place the note sits on the lit string. Exact octave: on one string, each place is a different octave.
export function FretFinder({ l, round, r, focus = [] }: { l: GameLevel; round: Round; r: Rng; focus?: Pos[] }) {
  const zone = zoneOf(l), play = round.mode === 'play';
  const [fast, slow] = WINDOWS.fret_finder[round.mode];
  const zonePcs = Array.from({ length: 12 }, (_, pc) => pc).filter(pc => positionsOf(pc, zone).length);
  const newNote = (prev?: number) => { let pc = focusPc(r, focus, zonePcs.filter(x => x !== prev)) ?? Math.floor(r() * 12); while (pc === prev || !positionsOf(pc, zone).length) pc = Math.floor(r() * 12); return { pc, start: round.now(), since: play ? askNow() : 0, found: [] as Pos[], lastAt: round.now() }; };
  const [q, setQ] = useState(() => newNote());
  const [bad, setBad] = useState<Pos | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [left, setLeft] = useState(20);
  const targets = positionsOf(q.pc, zone);
  const isFound = (p: Pos, f = q.found) => f.some(x => x.string === p.string && x.fret === p.fret);
  const curString = (qq = q) => { const ts = positionsOf(qq.pc, zone); return zone.strings.find(s => ts.some(p => p.string === s && !isFound(p, qq.found))) ?? null; };
  const ear = useEars(play && !round.paused, zoneRange(zone));
  useEffect(() => { const t = setInterval(() => {
    if (round.paused) return;
    const s = 20 - (round.now() - q.start) / 1000; setLeft(Math.max(0, Math.ceil(s)));
    if (s <= 0) { const missing = targets.filter(t => !isFound(t)); missing.forEach(p => noteSpot(p, false)); round.addMisses(missing.length, `${noteLabel(q.pc)} at ${missing.map(posText).join(', ')}`); setQ(newNote(q.pc)); round.askedAt.current = round.now(); }
  }, 200); return () => clearInterval(t); }, [q, round.paused]);
  const found = (p: Pos) => {
    noteSpot(p, true, round.now() - q.lastAt);
    round.answer(true, undefined, fast, slow);
    const f = [...q.found, p];
    if (f.length === targets.length) setQ(newNote(q.pc)); else setQ({ ...q, found: f, lastAt: round.now() });
  };
  const tap = (p: Pos) => {
    if (play || round.paused || isFound(p)) return;
    if (pcAt(p) === q.pc) found(p);
    else { setBad(p); setTimeout(() => setBad(null), 300); noteSpot(p, false); round.answer(false, `${noteLabel(q.pc)}: ${posText(p)} is ${noteLabel(pcAt(p))}`); }
  };
  const qRef = useRef(q); qRef.current = q;
  useHeard(play && !round.paused, ear.openedAt, () => {
    const cur = qRef.current, s = curString(cur); if (s === null) return null;
    const onS = positionsOf(cur.pc, zone).filter(p => p.string === s);
    return { right: onS.filter(p => !isFound(p, cur.found)).map(midiAt), neutral: onS.filter(p => isFound(p, cur.found)).map(midiAt), since: cur.since };
  }, h => {
    const cur = qRef.current, s = curString(cur); if (s === null) return;
    const onS = positionsOf(cur.pc, zone).filter(p => p.string === s && !isFound(p, cur.found));
    if (h.kind === 'right') { const p = onS.find(x => midiAt(x) === h.midi)!; setSaid(`✓ ${h.heard} · ${posText(p)}`); found(p); }
    else { setSaid(`✗ heard ${h.heard}${h.why === 'octave' ? ' (octave off)' : ''}`); round.answer(false, `${noteLabel(cur.pc)} on string ${s}: fret ${onS.map(p => p.fret).join(' and ')}${h.why === 'octave' ? ' (octave off)' : ''}`); }
  });
  const cs = curString();
  return (
    <>
      <div class="gside">
        <div class="target"><b>{noteLabel(q.pc)}</b><span>{q.found.length}/{targets.length} found · {left}s{play && cs !== null ? ` · now on string ${cs}` : ''}</span></div>
        {play ? <><Hearing e={ear} /><p class="muted small center">{said || 'Play every place on the lit string; the app checks the pitch, so play it on that string.'}</p></> : null}
      </div>
      <div class="gboard"><Fretboard zone={play && cs !== null ? { strings: [cs], frets: zone.frets } : zone} frets={zone.frets} onTap={tap} tappable={!play} marks={[...q.found.map(p => ({ p, cls: 'ok' })), ...(bad ? [{ p: bad, cls: 'bad' }] : [])]} /></div>
    </>
  );
}

// ---------- Octave Jump ----------
// A note on string 6 or 5; answer with the note an octave up (the shape's high note: 2 strings over, 2 frets up).
// Play mode hears one note at a time and checks the exact octave. It can't check the high note while the low one
// rings with it (the high note sits on the low note's overtone, as in EL.04), so you jump: the low note is
// allowed as a starting point, then play the octave on its own.
const OJ_TIMEOUT_MS = 10000;
export function OctaveJump({ l, round, r }: { l: GameLevel; round: Round; r: Rng }) {
  const zone = zoneOf(l), play = round.mode === 'play', show = !!l.params.show_fret;
  const [fast, slow] = WINDOWS.octave_jump[round.mode];
  const ids = useRef(0);
  const mk = (prev?: OctaveQ) => ({ ...octaveQ(r, zone, prev), start: round.now(), since: play ? askNow() : 0, id: ++ids.current });
  const timedOut = useRef(0);
  const [q, setQ] = useState(() => mk());
  const [marks, setMarks] = useState<{ p: Pos; cls: string }[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const board = { strings: [6, 5, 4, 3, 2, 1], frets: [zone.frets[0], Math.min(15, zone.frets[1] + 2)] as [number, number] };
  const zr = zoneRange(zone), ear = useEars(play && !round.paused, [Math.min(...zr), Math.max(...zr) + 12]);
  const next = (prev: OctaveQ) => { setQ(mk(prev)); round.askedAt.current = round.now(); };
  const label = (x: OctaveQ) => `${midiName(x.low).replace(/\d+$/, '')} on ${posText(x.from)}`;
  const miss = (x: OctaveQ, why = '') => `octave of ${label(x)}: ${posText(x.shape)}${why}`;
  useTick(!round.paused, 250);
  useEffect(() => { if (!round.paused && timedOut.current !== q.id && round.now() - q.start > OJ_TIMEOUT_MS) { timedOut.current = q.id; setMarks([{ p: q.shape, cls: 'show' }]); setSaid('Too slow'); round.answer(false, miss(q)); next(q); } });
  const tap = (p: Pos) => {
    if (play || round.paused) return;
    if (midiAt(p) === q.high) { setMarks([{ p, cls: 'ok' }, { p: q.from, cls: 'show' }]); setSaid(null); round.answer(true, undefined, fast, slow); }
    else { setMarks([{ p, cls: 'bad' }, { p: q.shape, cls: 'show' }]); setSaid(`That's ${midiName(midiAt(p))}`); round.answer(false, miss(q, midiAt(p) === q.low ? ' (that was the same note)' : '')); }
    next(q);
  };
  const qRef = useRef(q); qRef.current = q;
  useHeard(play && !round.paused, ear.openedAt, () => ({ right: [qRef.current.high], neutral: [qRef.current.low], since: qRef.current.since }), h => {
    const cur = qRef.current;
    if (h.kind === 'right') { setMarks([{ p: cur.shape, cls: 'ok' }, { p: cur.from, cls: 'show' }]); setSaid(`✓ ${h.heard}`); round.answer(true, undefined, fast, slow); }
    else { setMarks([{ p: cur.shape, cls: 'show' }]); setSaid(`✗ heard ${h.heard}${h.why === 'octave' ? ' (wrong octave)' : ''}`); round.answer(false, miss(cur, h.why === 'octave' ? ' (wrong octave)' : '')); }
    next(cur);
  });
  const name = midiName(q.low).replace(/\d+$/, '');
  return (
    <>
      <div class="gside">
        <div class="target"><b>{pretty(name)}</b><span>{show ? `string ${q.from.string}, fret ${q.from.fret}` : `on string ${q.from.string}`} → play its octave</span></div>
        {play ? <Hearing e={ear} /> : null}
        <p class="muted small center">{said || (play ? 'Jump to the octave: 2 strings over, 2 frets up. Let the low note go and play the octave on its own.' : 'Tap the octave: 2 strings over, 2 frets up.')}</p>
      </div>
      <div class="gboard"><Fretboard zone={board} frets={board.frets} onTap={tap} tappable={!play} marks={[...(show ? [{ p: q.from, cls: 'from' }] : []), ...marks]} /></div>
    </>
  );
}

// ---------- choice games: Call the Number, Capo Quick, Hear the Change ----------
export function songCalls(cat: Catalog, r: Rng): { prompts: { num: string; chord: string }[]; title: string; key: string; choices: string[] } {
  const pool = songPool({ cat, setlist: getSetList() }).ids;
  const o = cat.outlineById[pick(r, pool)];
  const prompts = o.sections.flatMap(s => s.chords_in_chart_key.map((c, i) => ({ num: s.numbers[i], chord: c })));
  return { prompts, title: o.title, key: o.chart_key, choices: [...new Set(prompts.map(p => p.chord))].slice(0, 9) };
}
export function ChoiceGame({ cat, g, l, round, r }: { cat: Catalog; g: Game; l: GameLevel; round: Round; r: Rng }) {
  const p = l.params;
  const song = useRef<ReturnType<typeof songCalls> | null>(null), idx = useRef(0);
  const gen = (prev?: ChoiceQ): ChoiceQ => {
    if (g.id === 'G_capo_quick') return capoQ(r, p.ask, p.keys, p.shapes);
    if (g.id === 'G_hear_the_change') return hearQ(r, p.numbers);
    if (p.songs) {
      if (!song.current || idx.current >= song.current.prompts.length) { song.current = songCalls(cat, r); idx.current = 0; }
      const s = song.current, c = s.prompts[idx.current++];
      return { prompt: c.num, sub: `${s.title} · key of ${pretty(s.key)}`, choices: s.choices, answer: c.chord, key: s.key, miss: `${c.num} in ${s.key} (${s.title}) is ${c.chord}` };
    }
    return callNumberQ(r, p.keys, p.numbers, prev);
  };
  const [q, setQ] = useState<ChoiceQ>(() => gen());
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { if (q.audio) playChords(q.audio, 0.9); }, [q]);
  const choose = (c: string) => {
    if (picked || round.paused) return;
    const ok = c === q.answer; setPicked(c);
    if (g.id === 'G_call_the_number' && q.key) { const t = (round.extra.current.keys ||= {}) as Record<string, [number, number]>; t[q.key] = [(t[q.key]?.[0] || 0) + (ok ? 1 : 0), (t[q.key]?.[1] || 0) + 1]; }
    round.answer(ok, ok ? undefined : q.miss, g.id === 'G_hear_the_change' ? 2200 : 1200, g.id === 'G_hear_the_change' ? 7000 : 5000);
    setTimeout(() => { setPicked(null); setQ(gen(q)); round.askedAt.current = round.now(); }, ok ? 220 : 900);
  };
  const isNum = g.id === 'G_call_the_number';
  return (
    <>
      <div class="gside"><div class="target"><b class={isNum ? 'num' : 'q'}>{q.prompt}</b>{q.sub ? <span>{q.sub}</span> : null}
        {q.audio ? <button class="small" onClick={() => playChords(q.audio!, 0.9)}>🔊 Again</button> : null}</div></div>
      <div class="gboard"><div class={`choices n${q.choices.length > 7 ? 'many' : q.choices.length}`}>
        {q.choices.map(c => <button class={picked ? (c === q.answer ? 'right' : c === picked ? 'wrong' : '') : ''} onClick={() => choose(c)}>{pretty(c)}</button>)}
      </div></div>
    </>
  );
}

// ---------- Delay Math ----------
export function DelayMath({ l, round, r }: { l: GameLevel; round: Round; r: Rng }) {
  const gen = () => delayQ(r, l.params.bpm, l.params.notes);
  const [q, setQ] = useState<DelayQ>(gen);
  const [v, setV] = useState('');
  const [fb, setFb] = useState<string | null>(null);
  const submit = () => {
    if (!v) return;
    const ok = Math.abs(+v - q.ms) <= 10;
    round.answer(ok, ok ? undefined : `${q.bpm} BPM ${DELAY_NOTES[q.note].label} = ${Math.round(q.ms)} ms`, 3000, 12000);
    setFb(ok ? `✓ ${Math.round(q.ms)} ms` : `✗ ${Math.round(q.ms)} ms`);
    setTimeout(() => { setFb(null); setV(''); setQ(gen()); round.askedAt.current = round.now(); }, ok ? 400 : 1300);
  };
  const key = (k: string) => { if (fb || round.paused) return; if (k === '⌫') setV(v.slice(0, -1)); else if (k === '✓') submit(); else if (v.length < 4) setV(v + k); };
  return (
    <>
      <div class="gside">
        <div class="target"><b class="q">{q.bpm} BPM</b><span>{DELAY_NOTES[q.note].label} delay, in ms (±10)</span></div>
        <div class="readout">{fb || v || ' '}<small>ms</small></div>
      </div>
      <div class="gboard">
        <div class="keypad">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map(k => <button class={k === '✓' ? 'primary' : ''} onClick={() => key(k)}>{k}</button>)}</div>
        <p class="muted small center">Quarter = 60000 ÷ BPM · dotted eighth = ¾ of that</p>
      </div>
    </>
  );
}
