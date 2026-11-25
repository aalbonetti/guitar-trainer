// The G3 chord games (07-games.md §2): Call the Number in play mode, Triad Hunt (tap or play), Change Sprint and
// Song Run (play). Every strum is checked against the chord the game expects with the M8 verifier
// (grading/chord.ts), never named open-endedly. Own-pace games (Call the Number, Triad Hunt) move on when a
// strum verifies or clearly sounds like another chord the game offers; scrapes and unclear strums are ignored.
// Change Sprint counts changes for 60 s; Song Run is click-timed, scored per bar like the M8 timed grader.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Catalog, GameLevel } from '../catalog';
import { pretty, speedBonus, type ChoiceQ, type Rng, type Pos } from '../games/core';
import { familyFrets, familyKey, callTargets, triadQ, triadTargets, triadFrets, isTriad, judgeSprint, SPRINT_FAST_MS, SPRINT_SLOW_MS,
  songChords, songBoxes, songPlan, songTargets, boxVerdict, gradeSong, type TriadQ, type BarsPerChord, type SongChord } from '../games/chords';
import { chordTarget, type ChordTarget } from '../grading/chord';
import { openEars, closeEars, startTimed, strumsSince, flushStrums, now, ears, simAuto, publishPlan } from '../games/listen';
import { shapeFor } from '../music';
import { useStore } from '../store';
import { Fretboard, useChordEars, useStrumHeard, useTick, lagS, shortRound, shortBars, HeardChord, OverrideButton, askNow, type Round } from './GameKit';
import { useCallNumber } from './ArcadeGames';
import { Beats } from './Timing';
import { ChordDiagram } from './Diagrams';

/** Curated open chords by name (G, Em, C…), so a family's first template is the open voicing beginners play. */
export function openLookup(cat: Pick<Catalog, 'chords'>) {
  const m = new Map(cat.chords.filter(c => c.tags.includes('open') && !c.name.includes('(')).map(c => [c.name, c.frets]));
  return (name: string) => m.get(name) ?? null;
}
const shapeOf = (name: string) => shapeFor(name)?.frets ?? null;

// ---------- Call the Number (play) ----------
// A key and a number; strum that chord, any voicing (open, barre or capo'd shape). The chord's family counts
// (root + major/minor), checked against the other chords the round could call in this key.
const CN_TIMEOUT_MS = 12000;
export function CallNumberPlay({ cat, l, round, r, assisted }: { cat: Catalog; l: GameLevel; round: Round; r: Rng; assisted: boolean }) {
  const p = l.params, open = useMemo(() => openLookup(cat), []);
  const ids = useRef(0), calls = useCallNumber(cat, p, r, round);
  const gen = (prev?: ChoiceQ): ChoiceQ & { id: number; since: number; start: number } => ({ ...calls.gen(prev), id: ++ids.current, since: askNow(), start: round.now() });
  const [q, setQ] = useState(() => gen());
  const [said, setSaid] = useState<string | null>(null);
  const timedOut = useRef(0);
  const ear = useChordEars(!round.paused);
  // targets: the expected chord's family against the other choices' families
  const tg = useMemo(() => callTargets(q, open), [q.id]);
  const lastKey = useRef('?');
  const tally = (ok: boolean) => { lastKey.current = q.key || '?'; calls.tally(lastKey.current, ok); };
  const next = (cur: typeof q) => { setQ(gen(cur)); round.askedAt.current = round.now(); };
  useTick(!round.paused, 300);
  useEffect(() => { if (!round.paused && timedOut.current !== q.id && round.now() - q.start > CN_TIMEOUT_MS) { timedOut.current = q.id; tally(false); setSaid(`Too slow: ${q.prompt} is ${q.answer}`); round.answer(false, q.miss); next(q); } });
  const qRef = useRef(q); qRef.current = q;
  const tgRef = useRef(tg); tgRef.current = tg;
  useStrumHeard(!round.paused, ear.openedAt, () => {
    const t = tgRef.current, wrongs = t.fams.filter(f => familyKey(f) !== familyKey(t.ef)).map(f => familyFrets(f, open)[0]);
    return { since: qRef.current.since, expected: t.expected, others: t.others, sim: { right: familyFrets(t.ef, open)[0], wrong: wrongs } };
  }, h => {
    const cur = qRef.current, name = (id: string | null) => tgRef.current.others.find(o => o.id === id)?.name ?? id;
    lastKey.current = cur.key || '?'; calls.tally(lastKey.current, h.ok);
    if (h.ok) { setSaid(`✓ ${cur.answer}`); round.answer(true, undefined, 2000, 7000); }
    else { setSaid(`✗ heard ${name(h.heard)}: ${cur.prompt} is ${cur.answer}`); round.answer(false, `${cur.miss} (heard ${name(h.heard)})`); }
    next(cur);
  });
  const overridden = () => { calls.tally(lastKey.current, true, true); setSaid('Counted as right'); };
  return (
    <>
      <div class="gside">
        <div class="target"><b class="num">{q.prompt}</b>{q.sub ? <span>{q.sub}</span> : null}</div>
        <HeardChord e={ear} last={said} />
        <OverrideButton round={round} assisted={assisted} onOverride={overridden} />
        <p class="muted small center">Strum the chord: open, barre or with a capo, any voicing. The app checks it against the other chords of the key.</p>
      </div>
      <div class="gboard"><div class="choices hint">{q.choices.map(c => <span>{pretty(c)}</span>)}</div></div>
    </>
  );
}

// ---------- Triad Hunt (tap or play) ----------
// A chord, a string set and a fret window: find the triad there, any inversion (one note per string).
// Tap: one fret on each string of the set. Play: strum those three strings; the app checks the chord (it can't
// tell which inversion, so the window is your guide).
const TH_TIMEOUT_MS = 20000;
const WINDOWS_TH = { tap: [2500, 9000], play: [3000, 10000] } as const;
export function TriadHunt({ l, round, r, assisted }: { l: GameLevel; round: Round; r: Rng; assisted: boolean }) {
  const p = l.params as { string_sets: string[]; keys: string[]; qualities: string[]; window: number }, play = round.mode === 'play';
  const ids = useRef(0);
  const mk = (prev?: TriadQ) => ({ ...triadQ(r, p, prev), id: ++ids.current, since: play ? askNow() : 0, start: round.now() });
  const [q, setQ] = useState(() => mk());
  const [sel, setSel] = useState<Record<number, number>>({});
  const [marks, setMarks] = useState<{ p: Pos; cls: string }[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const timedOut = useRef(0);
  const [fast, slow] = WINDOWS_TH[round.mode];
  const ear = useChordEars(play && !round.paused);
  const tg = useMemo(() => triadTargets(q, p), [q.id]);
  const show = (x: typeof q, cls = 'show') => (x.placements[0] || []).map((f, i) => ({ p: { string: x.strings[i], fret: f }, cls }));
  const where = (x: typeof q) => `${x.name} on strings ${x.set.split('').join('-')}, frets ${x.window[0]}–${x.window[1]}${x.placements[0] ? ` (e.g. ${x.placements[0].join('-')})` : ''}`;
  const next = (cur: typeof q) => { setQ(mk(cur)); setSel({}); round.askedAt.current = round.now(); };
  useTick(!round.paused, 300);
  useEffect(() => { if (!round.paused && timedOut.current !== q.id && round.now() - q.start > TH_TIMEOUT_MS) { timedOut.current = q.id; setMarks(show(q)); setSaid('Too slow'); round.answer(false, where(q)); next(q); } });
  const tap = (pos: Pos) => {
    if (play || round.paused) return;
    const s = { ...sel, [pos.string]: pos.fret }; setSel(s);
    if (q.strings.every(x => s[x] !== undefined)) {
      const fr = q.strings.map(x => s[x]);
      if (isTriad(q, fr)) { setMarks(q.strings.map((x, i) => ({ p: { string: x, fret: fr[i] }, cls: 'ok' }))); setSaid(`✓ ${q.name}`); round.answer(true, undefined, fast, slow); }
      else { setMarks([...q.strings.map((x, i) => ({ p: { string: x, fret: fr[i] }, cls: 'bad' })), ...show(q)]); setSaid(`✗ not ${q.name}`); round.answer(false, where(q)); }
      next(q);
    }
  };
  const qRef = useRef(q); qRef.current = q;
  const tgRef = useRef(tg); tgRef.current = tg;
  useStrumHeard(play && !round.paused, ear.openedAt, () => {
    const cur = qRef.current, t = tgRef.current;
    return { since: cur.since, expected: t.expected, others: t.others, sim: { right: triadFrets(cur.strings, cur.placements[0]), wrong: t.others.map(o => o.frets[0]) } };
  }, h => {
    const cur = qRef.current, nm = tgRef.current.others.find(o => o.id === h.heard)?.name ?? h.heard;
    if (h.ok) { setMarks(show(cur, 'ok')); setSaid(`✓ ${cur.name}`); round.answer(true, undefined, fast, slow); }
    else { setMarks(show(cur)); setSaid(`✗ heard ${nm}`); round.answer(false, `${where(cur)} (heard ${nm})`); }
    next(cur);
  });
  const zone = { strings: q.strings, frets: q.window };
  const board: [number, number] = [Math.max(0, q.window[0] - 1), Math.min(15, q.window[1] + 1)];
  const selMarks = Object.entries(sel).map(([s, f]) => ({ p: { string: +s, fret: f }, cls: 'from' }));
  return (
    <>
      <div class="gside">
        <div class="target"><b class="q">{q.name}</b><span>strings {q.set.split('').join('-')} · frets {q.window[0]}–{q.window[1]} · any inversion</span></div>
        {play ? <HeardChord e={ear} last={said} /> : <p class="muted small center">{said || 'Tap one fret on each lit string.'}</p>}
        {play ? <OverrideButton round={round} assisted={assisted} /> : null}
        {play ? <p class="muted small center">Strum just those three strings, inside the window.</p> : null}
      </div>
      <div class="gboard"><Fretboard zone={zone} frets={board} onTap={tap} tappable={!play} marks={[...selMarks, ...marks]} /></div>
    </>
  );
}

// ---------- Change Sprint (play) ----------
// 60 s of changes around the level's cycle. A change counts when a strum verifies as the next chord; strumming
// the chord you're on again doesn't count either way; a strum heard as neither (a muddy change) is a miss.
type SPhase = 'opening' | 'countdown' | 'playing' | 'done' | 'stopped' | 'error';
export function ChangeSprint({ l, round }: { l: GameLevel; round: Round }) {
  const p = l.params as { cycle: string[]; voicings: Record<string, { name: string; frets: number[][] }>; target_per_min: number };
  const cycle = useMemo<ChordTarget[]>(() => p.cycle.map(ref => chordTarget(ref, p.voicings[ref].name, p.voicings[ref].frets)), []);
  const ear = useStore(ears);
  const [phase, setPhase] = useState<SPhase>('opening');
  const [view, setView] = useState({ left: 0, count: 3, cur: -1, changes: 0, last: null as string | null });
  const sig = useRef({ cancelled: false });
  const windowS = shortRound(60)!;
  useEffect(() => {
    const g = sig.current;
    void (async () => {
      if (!(await openEars([], { chords: true }))) { if (!g.cancelled) setPhase('error'); return; }
      if (g.cancelled) return;
      const t0 = now() + 3, t1 = t0 + windowS;
      publishPlan({ kind: 'sprint', t0, t1, cycle: p.cycle.map(ref => p.voicings[ref].frets[0]) });
      simAuto('game-sprint', { t0, t1, cycle: p.cycle.map(ref => p.voicings[ref].frets[0]) });
      setPhase('countdown');
      let done = 0, cur = -1, changes = 0;
      await new Promise<void>(res => {
        const tick = () => {
          if (g.cancelled) return res();
          const t = now();
          if (t >= t0 && phase !== 'playing') setPhase('playing');
          const evs = judgeSprint(strumsSince(t0), cycle, t0, Math.min(t, t1));
          let last: string | null = null;
          for (; done < evs.length; done++) {
            const e = evs[done], nm = (id: string | null) => cycle.find(c => c.id === id)?.name ?? (id === null ? 'not clear' : id);
            if (e.kind === 'start') { cur = cycle.findIndex(c => c.id === e.heard); last = `Start: ${nm(e.heard)}`; }
            else if (e.kind === 'change') { cur = (cur + 1) % cycle.length; changes++; last = `✓ ${nm(e.heard)}`; round.answerWith(true, speedBonus(e.ms!, SPRINT_FAST_MS, SPRINT_SLOW_MS)); }
            else if (e.kind === 'miss') { last = `✗ heard ${nm(e.heard)}`; round.answerWith(false, 0, `change to ${nm(e.expected)}: heard ${nm(e.heard)}`); }
          }
          setView(v => ({ left: Math.max(0, Math.ceil(t1 - t)), count: Math.max(0, Math.ceil(t0 - t)), cur, changes, last: last ?? v.last }));
          if (t > t1 + 0.6) return res();
          setTimeout(tick, 120);
        };
        tick();
      });
      if (g.cancelled) return;
      // strums still in their analysis window at the end
      flushStrums();
      const evs = judgeSprint(strumsSince(t0), cycle, t0, t1);
      for (; done < evs.length; done++) { const e = evs[done]; if (e.kind === 'change') round.answerWith(true, speedBonus(e.ms!, SPRINT_FAST_MS, SPRINT_SLOW_MS)); else if (e.kind === 'miss') round.answerWith(false, 0, `change to ${cycle.find(c => c.id === e.expected)?.name}: heard ${cycle.find(c => c.id === e.heard)?.name ?? 'not clear'}`); }
      round.extra.current = { changes: evs.filter(e => e.kind === 'change').length, perMin: +(evs.filter(e => e.kind === 'change').length * 60 / windowS).toFixed(1), target: p.target_per_min, refs: p.cycle };
      closeEars(); setPhase('done'); round.finish(true);
    })();
    return () => { g.cancelled = true; closeEars(); };
  }, []);
  useEffect(() => { if (round.paused && phase !== 'done') { sig.current.cancelled = true; closeEars(); setPhase('stopped'); } }, [round.paused]);
  const nextI = view.cur < 0 ? 0 : (view.cur + 1) % cycle.length;
  const rate = phase === 'playing' || phase === 'done' ? Math.round(view.changes * 60 / Math.max(1, windowS - view.left)) : 0;
  return (
    <>
      <div class="gside">
        <div class="target"><b class="q">{phase === 'countdown' ? view.count || 'Go!' : phase === 'playing' ? `${view.left}s` : phase === 'opening' ? '…' : phase === 'done' ? 'Done' : ''}</b>
          <span>{phase === 'stopped' ? 'Stopped. Restart from the menu.' : phase === 'error' ? 'The microphone could not be opened.' : `${view.changes} changes${rate ? ` · ${rate}/min` : ''} · goal ${p.target_per_min}/min`}</span></div>
        <p class="center sprintchords">{cycle.map((c, i) => <span class={i === view.cur ? 'cur' : i === nextI ? 'next' : ''}>{c.name}</span>)}</p>
        <p class="readline">{view.last ?? (ear.on ? <span class="muted">Strum the first chord when it says Go</span> : ear.error ? <span class="error">Microphone: {ear.error}</span> : <span class="muted">Opening the mic…</span>)}</p>
        <p class="muted small center">One clean strum per chord, as fast as you can change. Strumming a chord again is fine; a muddy strum while changing is a miss.</p>
      </div>
      <div class="gboard"><div class="diagrams row wrap">{p.cycle.map((ref, i) => <div class={i === nextI ? 'next' : ''}><ChordDiagram name={p.voicings[ref].name} shape={{ frets: p.voicings[ref].frets[0] }} /></div>)}</div></div>
    </>
  );
}

// ---------- Song Run (play, click-timed) ----------
// The song's chords scroll at its tempo in your key and capo; each bar is graded like the M8 timed grader: right
// when most of its strums sound like the chord's family; points by how close the first right strum came to the 1.
export interface SongSetup { key: string; capo: number; per: BarsPerChord }
export function SongRun({ cat, l, round, setup }: { cat: Catalog; l: GameLevel; round: Round; setup: SongSetup }) {
  const o = cat.outlineById[l.params.outline];
  const open = useMemo(() => openLookup(cat), []);
  const chords = useMemo<SongChord[]>(() => songChords(o, setup.key, setup.capo), []);
  const boxes = useMemo(() => songBoxes(chords, setup.per, l.params.passes || 1), []);
  const tg = useMemo(() => songTargets(chords, setup.capo, open, shapeOf), []);
  const beats = l.params.meter === '3/4' ? 3 : l.params.meter === '6/8' ? 2 : 4;
  const ear = useStore(ears);
  const [phase, setPhase] = useState<SPhase | 'countin'>('opening');
  const [live, setLive] = useState({ idx: 0, beat: -1, status: boxes.map(() => 'todo') as string[], last: null as string | null });
  const sig = useRef({ cancelled: false });
  const names = useMemo(() => Object.fromEntries(Object.entries(tg.targets).map(([k, t]) => [k, t.name])), []);
  useEffect(() => {
    const g = sig.current;
    void (async () => {
      if (!(await openEars([], { chords: true }))) { if (!g.cancelled) setPhase('error'); return; }
      if (g.cancelled) return;
      const short = shortBars();
      const bx = short ? boxes.slice(0, short) : boxes;
      const plan = songPlan(bx, l.params.bpm, beats, setup.per, now() + 0.6);
      const pub = { kind: 'song', beat: plan.beat, capo: setup.capo, boxes: plan.boxes.map(b => ({ t0: b.t0, t1: b.t1, frets: tg.targets[b.ref].frets[0].map(f => (f < 0 ? -1 : f - setup.capo)) })) };
      publishPlan(pub); simAuto('game-song', pub);
      setPhase('countin');
      const ticker = window.setInterval(() => {
        const t = now() - lagS(); let b = -1; plan.clicks.forEach((c, i) => { if (c.t <= t) b = i; });
        let idx = 0; plan.boxes.forEach((x, i) => { if (x.t0 <= t + 0.05) idx = i; });
        setLive(v => (v.beat === b && v.idx === idx ? v : { ...v, beat: b, idx }));
      }, 40);
      try {
        const st = await startTimed(plan, g);
        if (!st || g.cancelled) return;
        setPhase('playing');
        let i = 0;
        const settle = (final: boolean) => {
          const t = now(), due = (k: number) => k < plan.boxes.length && (final || plan.boxes[k].t1 + st.offsetS + 0.55 < t);
          if (!due(i)) return;
          const gr = gradeSong(strumsSince(plan.start - 1), plan, tg, st.offsetS);
          const status = [...live.status];
          while (due(i)) {
            const b = plan.boxes[i], v = boxVerdict(gr, plan, i, st.offsetS, names, b.label, `${bx[i].section}, bar ${i + 1}`);
            round.answerWith(v.ok, v.bonus, v.miss);
            status[i] = v.ok ? 'ok' : v.strums ? 'mixed' : 'miss';
            setLive(x => { const s2 = [...x.status]; s2[i] = status[i]; return { ...x, status: s2, last: v.ok ? `✓ ${b.label}` : v.heard ? `✗ ${b.label}: heard ${v.heard}` : `✗ ${b.label}: no strum` }; });
            i++;
          }
        };
        await new Promise<void>(res => {
          const tick = () => {
            if (g.cancelled) return res();
            settle(false);
            if (i >= plan.boxes.length || now() > plan.end + st.offsetS + 1.2) return res();
            setTimeout(tick, 100);
          };
          tick();
        });
        if (g.cancelled) return;
        flushStrums(); settle(true);
      } finally { clearInterval(ticker); }
      if (g.cancelled) return;
      round.extra.current = { key: setup.key, capo: setup.capo, per: setup.per };
      closeEars(); setPhase('done'); round.finish(true);
    })();
    return () => { g.cancelled = true; closeEars(); };
  }, []);
  useEffect(() => { if (round.paused && phase !== 'done') { sig.current.cancelled = true; closeEars(); setPhase('stopped'); } }, [round.paused]);
  const cur = boxes[Math.min(live.idx, boxes.length - 1)], nxt = boxes[live.idx + 1];
  const from = Math.max(0, live.idx - 3);
  return (
    <>
      <div class="gside">
        <div class="target"><b class="q">{cur.label}</b><span>{cur.section}{nxt ? ` · next ${nxt.label}` : ''} · {l.params.bpm} BPM{setup.capo ? ` · capo ${setup.capo}` : ''}</span></div>
        <Beats n={beats} on={live.beat < 0 ? -1 : live.beat % beats} count={phase !== 'playing'} />
        <p class="center"><b>{phase === 'countin' ? 'Count-in: one bar, then play' : phase === 'playing' ? 'Play!' : phase === 'opening' ? 'Opening the mic…' : phase === 'stopped' ? 'Stopped. Restart from the menu.' : phase === 'error' ? 'The microphone could not be opened.' : 'Song over'}</b></p>
        <p class="readline">{live.last ?? <span class="muted">{ear.on ? 'Strum each chord on its bar' : ''}</span>}</p>
      </div>
      <div class="gboard"><div class="songboxes">{boxes.slice(from, from + 12).map((b, k) => <span class={`${live.status[from + k]} ${from + k === live.idx ? 'cur' : ''}`}>{b.label}</span>)}</div></div>
    </>
  );
}
