// The click-timed Arcade games (play mode only): Box Runner (pentatonic box notes, pitch + timing) and In the
// Pocket (strums, timing; Gap Click). The game owns the click: a fixed click plan on the AudioContext clock with
// a one-bar count-in that learns the click bleed, as graded lesson attempts do. Answers settle in order once
// each note's window has passed; points use 100 per beat × how close to the beat (bonus 1.0–2.0) × combo.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Catalog, GameLevel } from '../catalog';
import { boxWindowS, midiAt, timingBonus, pocketVerdicts, type Rng } from '../games/core';
import { boxSetup, pocketSetup, type PocketSetup } from '../games/rounds';
import { gradeTimedNote, type NoteVerdict } from '../games/judge';
import { openEars, closeEars, startTimed, heardSince, onsetsSince, now, ears, simAuto, publishPlan } from '../games/listen';
import { buildNotePlan, midiName, type NotePlan } from '../grading/pitch';
import { audioContext } from '../audio/engine';
import { useStore } from '../store';
import { Fretboard, posText, Hearing, type Round } from './GameKit';
import { Beats } from './Timing';
import { StrumGrid } from './Diagrams';

type Phase = 'opening' | 'countin' | 'playing' | 'done' | 'stopped' | 'error';
const lagS = () => { const c = audioContext(); return c.outputLatency || c.baseLatency || 0; };
const PHASE_TEXT: Record<Phase, string> = { opening: 'Opening the mic…', countin: 'Count-in: one bar, then play', playing: 'Play!', done: 'Round over', stopped: 'Stopped. Restart the round from the menu.', error: 'The microphone could not be opened.' };

// ---------- Box Runner ----------
export function BoxRunner({ cat, l, round, r }: { cat: Catalog; l: GameLevel; round: Round; r: Rng }) {
  const p = l.params;
  const S = useMemo(() => boxSetup(cat, p, r), []);
  const ear = useStore(ears);
  const [phase, setPhase] = useState<Phase>('opening');
  const [idx, setIdx] = useState(0), [beat, setBeat] = useState(-1);
  const [vs, setVs] = useState<NoteVerdict[]>([]);
  const sig = useRef({ cancelled: false });
  const spacing = 60 / p.bpm / p.sub, tol = boxWindowS(spacing);
  useEffect(() => {
    const g = sig.current;
    void (async () => {
      if (!(await openEars(S.path.map(midiAt)))) { if (!g.cancelled) setPhase('error'); return; }
      const exp = S.path.map((q, i) => ({ t: i / p.sub, dur: 1 / p.sub, midis: [midiAt(q)], label: midiName(midiAt(q)), where: posText(q) }));
      const plan: NotePlan = buildNotePlan(exp, p.bpm, 4, now() + 0.6);
      const pub = { kind: 'box', expected: plan.expected.map(e => ({ t: e.t, midi: e.midis[0] })) };
      publishPlan(pub); simAuto('game-box', pub);
      setPhase('countin');
      const ticker = window.setInterval(() => { const t = now() - lagS(); let b = -1; plan.clicks.forEach((c, i) => { if (c.t <= t) b = i; }); setBeat(b); }, 40);
      try {
        const st = await startTimed(plan, g);
        if (!st || g.cancelled) return;
        setPhase('playing');
        let i = 0; const out: NoteVerdict[] = [];
        await new Promise<void>(res => {
          const tick = () => {
            if (g.cancelled) return res();
            const t = now(), due = (k: number) => k < plan.expected.length && plan.expected[k].t + tol + st.offsetS + 0.15 < t;
            if (due(i)) {
              const segs = heardSince(plan.start - tol);
              while (due(i)) {
                const e = plan.expected[i], pos = S.path[i];
                const v = gradeTimedNote(segs, { t: e.t, midi: e.midis[0], pos }, tol, st.offsetS);
                out.push(v);
                round.answerWith(v.ok, v.ok ? timingBonus(v.offMs!, 25, tol * 1000) : 0, v.ok ? undefined
                  : `${midiName(e.midis[0])} on ${posText(pos)}${v.why === 'octave' ? ' (octave off)' : v.why === 'late' ? ' (late)' : v.why === 'early' ? ' (early)' : v.why === 'silent' ? ' (not heard)' : ''}`);
                i++;
              }
              setVs([...out]); setIdx(i);
            }
            if (i >= plan.expected.length && t > plan.end + 0.2) return res();
            setTimeout(tick, 100);
          };
          tick();
        });
      } finally { clearInterval(ticker); }
      if (g.cancelled) return;
      closeEars(); setPhase('done'); round.finish(true);
    })();
    return () => { g.cancelled = true; closeEars(); };
  }, []);
  useEffect(() => { if (round.paused && phase !== 'done') { sig.current.cancelled = true; closeEars(); setPhase('stopped'); } }, [round.paused]);
  const cur = S.path[Math.min(idx, S.path.length - 1)], last = vs[vs.length - 1];
  const zone = { strings: [6, 5, 4, 3, 2, 1], frets: S.window };
  const marks = [...S.notes.map(q => ({ p: q, cls: 'box' })), ...(phase === 'playing' || phase === 'countin' ? [{ p: cur, cls: 'next' }] : []),
    ...(last && idx > 0 ? [{ p: S.path[idx - 1], cls: last.ok ? 'ok' : 'bad' }] : [])];
  const barsLeft = Math.max(0, Math.ceil((S.path.length - idx) / p.sub / 4));
  return (
    <>
      <div class="gside">
        <div class="target"><b class="q">{S.name}</b><span>{p.path === 'threes' ? 'Three-note groups up, then down' : p.path === 'updown' ? 'Up the box and back down' : p.path === 'up' ? 'Up the box' : 'Down the box'} · {p.sub === 1 ? 'quarter notes' : 'eighth notes'} · {p.bpm} BPM</span></div>
        <Beats n={4} on={beat < 0 ? -1 : beat % 4} count={phase !== 'playing'} />
        <p class="center"><b>{PHASE_TEXT[phase]}</b>{phase === 'playing' ? <small class="muted"> · next {midiName(midiAt(cur))} ({posText(cur)}) · {barsLeft} bars left</small> : null}</p>
        <Hearing e={ear} />
        {last && !last.ok ? <p class="muted small center">✗ {last.why === 'silent' ? 'not heard' : last.why === 'late' || last.why === 'early' ? `right note, ${last.why}` : `heard ${last.heard}`}</p> : last ? <p class="muted small center">✓ {Math.abs(Math.round(last.offMs!))} ms {last.offMs! > 0 ? 'late' : 'early'}</p> : null}
      </div>
      <div class="gboard"><Fretboard zone={zone} frets={S.window} tappable={false} marks={marks} /></div>
    </>
  );
}

// ---------- In the Pocket ----------
export function InThePocket({ cat, l, round }: { cat: Catalog; l: GameLevel; round: Round }) {
  const p = l.params;
  const pat = cat.strums.find(s => s.id === p.pattern)!;
  const ear = useStore(ears);
  const [phase, setPhase] = useState<Phase>('opening');
  const [live, setLive] = useState({ beat: -1, step: -1, bar: -1, last: null as number | null, bias: null as number | null, landing: null as string | null, gap: -1 });
  const sig = useRef({ cancelled: false });
  const setupRef = useRef<PocketSetup | null>(null);
  useEffect(() => {
    const g = sig.current;
    void (async () => {
      if (!(await openEars([40, 64]))) { if (!g.cancelled) setPhase('error'); return; }
      const S = pocketSetup(cat, p, now() + 0.6); setupRef.current = S;
      const { plan, slots } = S, slotDur = plan.slotDur;
      publishPlan({ kind: 'pocket', slots: slots.map(s => ({ t: s.t, expected: s.expected })), clicks: plan.clicks.map(c => c.t) });
      simAuto('game-pocket', slots.filter(s => s.expected).map(s => s.t));
      setPhase('countin');
      let offMs = 0, settled = 0; const recent: number[] = [];
      const ticker = window.setInterval(() => {
        const t = now() - lagS(); let b = -1; plan.clicks.forEach((c, i) => { if (c.t <= t) b = i; });
        const bar = t >= plan.start ? Math.floor((t - plan.start) / (S.feel.beats * plan.beat)) : -1;
        const beatIdx = t >= plan.start ? Math.floor((t - plan.start) / plan.beat) % S.feel.beats : b < 0 ? -1 : b % S.feel.beats;
        const step = t >= plan.start && t < plan.end ? Math.floor((t - plan.start) / slotDur) % S.feel.grid : -1;
        setLive(x => (x.beat === beatIdx && x.step === step && x.bar === bar ? x : { ...x, beat: beatIdx, step, bar, gap: bar >= 0 ? S.gapOf[bar] ?? -1 : -1 }));
      }, 30);
      try {
        const st = await startTimed(plan, g);
        if (!st || g.cancelled) return;
        offMs = st.offsetS * 1000;
        setPhase('playing');
        await new Promise<void>(res => {
          const tick = () => {
            if (g.cancelled) return res();
            const t = now(), due = (k: number) => k < slots.length && slots[k].t + slotDur / 2 + st.offsetS + 0.05 < t;
            if (due(settled)) {
              const vs = pocketVerdicts(onsetsSince(plan.start - slotDur), slots, slotDur, offMs, p.window_ms, S.returnBars);
              let landing: string | null = null, last: number | null = null;
              while (due(settled)) {
                const v = vs[settled];
                if (v.counted) round.answerWith(v.ok, v.bonus, v.miss);
                if (v.errMs !== null && v.expected) { last = v.errMs; recent.push(v.errMs); if (recent.length > 8) recent.shift(); }
                const sl = slots[settled];
                if (S.returnBars.has(sl.bar) && settled % S.feel.grid === 0) landing = v.errMs === null ? `Back from the ${S.returnBars.get(sl.bar)}-bar gap: no strum on the 1` : `Back from the ${S.returnBars.get(sl.bar)}-bar gap: ${Math.round(Math.abs(v.errMs))} ms ${v.errMs > 0 ? 'late' : 'early'}${v.ok ? ' ✓' : ''}`;
                settled++;
              }
              setLive(x => ({ ...x, ...(last !== null ? { last, bias: recent.reduce((a, b) => a + b, 0) / recent.length } : {}), ...(landing ? { landing } : {}) }));
            }
            if (settled >= slots.length && t > plan.end + 0.3) return res();
            setTimeout(tick, 80);
          };
          tick();
        });
      } finally { clearInterval(ticker); }
      if (g.cancelled) return;
      closeEars(); setPhase('done'); round.finish(true);
    })();
    return () => { g.cancelled = true; closeEars(); };
  }, []);
  useEffect(() => { if (round.paused && phase !== 'done') { sig.current.cancelled = true; closeEars(); setPhase('stopped'); } }, [round.paused]);
  const S = setupRef.current, w = p.window_ms as number, lim = w * 2;
  const needle = live.last === null ? 50 : 50 + Math.max(-1, Math.min(1, live.last / lim)) * 50;
  const inGap = live.gap >= 0 && phase === 'playing';
  const barsLeft = S ? Math.max(0, S.gapOf.length - Math.max(0, live.bar)) : null;
  return (
    <>
      <div class="gside">
        <div class="target"><b class="q">{pat.name}</b><span>{p.bpm} BPM · ±{w} ms counts{p.gap_bars ? ` · Gap Click: ${p.gap_bars.join(', ')} bars` : ''}</span></div>
        <Beats n={S?.feel.beats ?? 4} on={live.beat} count={phase !== 'playing' || inGap} />
        <p class="center"><b>{inGap ? '🔇 Click off: keep strumming' : PHASE_TEXT[phase]}</b>{barsLeft !== null && phase === 'playing' ? <small class="muted"> · {barsLeft} bars left</small> : null}</p>
        <div class="pocketmeter" role="img" aria-label={live.last === null ? 'Timing meter' : `Last strum ${Math.round(Math.abs(live.last))} ms ${live.last > 0 ? 'late' : 'early'}`}>
          <i class="okzone" style={{ left: `${50 - (w / lim) * 50}%`, width: `${(w / lim) * 100}%` }} />
          <i class="mid" />
          {live.last !== null ? <i class={`needle ${Math.abs(live.last) <= w ? 'ok' : 'off'}`} style={{ left: `${needle}%` }} /> : null}
          <small class="l">ahead</small><small class="r">behind</small>
        </div>
        <p class="muted small center">{live.last === null ? 'The meter shows how far ahead of or behind the beat each strum lands.' : `Last ${Math.round(Math.abs(live.last))} ms ${live.last > 0 ? 'behind' : 'ahead'} · last 8 average ${Math.round(Math.abs(live.bias!))} ms ${live.bias! > 0 ? 'behind' : 'ahead'}`}</p>
        {live.landing ? <p class="note small center">{live.landing}</p> : null}
        {ear.error ? <Hearing e={ear} /> : null}
      </div>
      <div class="gboard"><StrumGrid strum={pat} active={live.step} /></div>
    </>
  );
}
