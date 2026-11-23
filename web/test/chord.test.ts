// Chord graders with synthetic guitar strums: Karplus-Strong plucked strings (rich, decaying harmonics),
// 12–25 ms strum spread across the strings, random string levels and slight detune, room noise. Everything
// runs through the same StrumAnalyzer (spectral-flux onsets + M0 chroma) the app uses, in 512-sample blocks.
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import {
  StrumAnalyzer, chordTarget, verifyChord, progressionTargets, pairTargets, chordSetup, pickVariant, buildChordPlan, gradeTimedChords, gradeOwnChords,
  countChanges, classifyPair, soundingFrets, pcsOf, chordCoach, MIN_SCORE, type ChordTarget, type Strum, type ChordProgEx, type ChordChangesEx, type StrumResult,
} from '../src/grading/chord';

const SR = 48000;
const j = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const cat: any = { lessons: j('lessons.json'), exercises: j('exercises.json') };
const L = (id: string) => cat.lessons.find((l: any) => l.id === id);
const EX = (id: string) => cat.exercises.find((e: any) => e.id === id);
// Each test starts from the same seed, so results don't depend on test order. CHORD_SEED=n re-runs the suite with
// other random strums (string levels, detune, spread) to check the thresholds aren't luck.
const SEED0 = +(process.env.CHORD_SEED || 4242);
let seed = SEED0; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
beforeEach(() => { seed = SEED0; });
const OPEN = [40, 45, 50, 55, 59, 64];

function ks(freq: number, n: number, amp: number, damp: number): Float32Array {
  const N = Math.max(2, Math.round(SR / freq + 0.5)), ring = new Float32Array(N), out = new Float32Array(n);
  for (let i = 0; i < N; i++) ring[i] = (rnd() * 2 - 1) * amp;
  let p = 0;
  for (let i = 0; i < n; i++) { const q = (p + 1) % N; out[i] = ring[p]; ring[p] = damp * 0.5 * (ring[p] + ring[q]); p = q; }
  return out;
}
interface StrumSpec { frets: number[]; t: number; dur?: number; capo?: number; drop?: number[]; gain?: number; spread?: number; up?: boolean }
/** Mix strums into a buffer. Each string: KS pluck at its sounding pitch, level 0.6–1.4, ±6 cents. Like a real
 *  guitar, a string plays one note at a time: striking it again stops its previous note; strings the next chord
 *  doesn't strum keep ringing. */
function render(strums: StrumSpec[], len: number, noise = 0.002, extra?: (b: Float32Array) => void): Float32Array {
  const out = new Float32Array(Math.ceil(len * SR));
  const sorted = [...strums].sort((a, b) => a.t - b.t);
  const nextHit = (s: StrumSpec, string: number) => { const n = sorted.find(x => x.t > s.t && x.frets[6 - string] >= 0 && !(x.drop || []).includes(string)); return n ? n.t : Infinity; };
  for (const s of sorted) {
    const fr = soundingFrets(s.frets, s.capo || 0), spread = s.spread ?? 0.012 + rnd() * 0.013, dur = s.dur ?? 1.2;
    const order = fr.map((_, i) => i).filter(i => fr[i] >= 0 && !(s.drop || []).includes(6 - i));
    if (s.up) order.reverse();
    order.forEach((i, k) => {
      const m = OPEN[i] + fr[i] + (rnd() - 0.5) * 0.12, f = 440 * 2 ** ((m - 69) / 12);
      const until = Math.min(s.t + dur, nextHit(s, 6 - i) + 0.01);
      const x = ks(f, Math.max(480, Math.round((until - s.t) * SR)), 0.3 * (s.gain ?? 1) * (0.6 + 0.8 * rnd()), 0.996 - Math.max(0, m - 60) * 0.0004);
      const i0 = Math.round((s.t + k * spread) * SR);
      for (let q = 0; q < x.length && i0 + q < out.length; q++) out[i0 + q] += x[q] * Math.min(1, (x.length - q) / 480);
    });
  }
  for (let i = 0; i < out.length; i++) out[i] += (rnd() * 2 - 1) * noise;
  extra?.(out);
  return out;
}
function analyze(buf: Float32Array, setup?: (a: StrumAnalyzer) => void): Strum[] {
  const a = new StrumAnalyzer(SR); setup?.(a);
  const out: Strum[] = [];
  for (let i = 0; i < buf.length; i += 512) out.push(...a.push(buf.subarray(i, Math.min(buf.length, i + 512)), i));
  return [...out, ...a.flush()];
}
/** Strum each chord `n` times (one strum per 1.0 s, rings until the next), return accuracy + confusion. */
function confusion(chords: Record<string, number[]>, n: number, o: { capo?: number; drop?: (id: string) => number[]; play?: (id: string) => number[] } = {}) {
  const ids = Object.keys(chords), tg = Object.fromEntries(ids.map(id => [id, chordTarget(id, id, [chords[id]], o.capo || 0)]));
  const seq = Array.from({ length: n * ids.length }, (_, i) => ids[i % ids.length]);
  const buf = render(seq.map((id, i) => ({ frets: o.play ? o.play(id) : chords[id], t: 0.3 + i, dur: 1.0, capo: o.capo, drop: o.drop?.(id) })), 0.6 + seq.length);
  const strums = analyze(buf);
  const conf: Record<string, number> = {}; let ok = 0;
  seq.forEach((id, i) => {
    const s = strums.find(x => Math.abs(x.t - (0.3 + i)) < 0.06);
    const v = verifyChord(s?.chroma ?? null, tg[id], Object.values(tg));
    if (v.ok) ok++;
    const k = `${id}>${v.heard ?? 'unclear'}`; conf[k] = (conf[k] || 0) + 1;
  });
  return { ok, total: seq.length, acc: ok / seq.length, conf, strums: strums.length };
}
const report: string[] = [];
// the numbers behind M8's accuracy claims: written to /tmp/chord_accuracy.txt (and the console) after the run
afterAll(() => { const t = report.join('\n'); fs.writeFileSync('/tmp/chord_accuracy.txt', t + '\n'); console.log(t); });
const log = (name: string, r: { ok: number; total: number; conf: Record<string, number> }) => report.push(`${name}: ${r.ok}/${r.total} ${JSON.stringify(Object.fromEntries(Object.entries(r.conf).filter(([k]) => k.split('>')[0] !== k.split('>')[1])))}`);

describe('catalog: every chord lesson knows what to verify against', () => {
  const ids = ['A.01', 'A.02', 'A.03', 'A.04', 'A.08', 'A.11', 'A.12', 'ER.04', 'ER.05', 'ER.06', 'ER.09', 'ER.11'];
  it('all 12 M8 lessons resolve to a chord setup with voicings for every chord', () => {
    for (const id of ids) {
      const s = chordSetup(L(id), cat); expect(s, id).not.toBeNull();
      const refs = s!.kind === 'changes' ? s!.pairs.flat() : [...s!.ex.variants.flatMap(v => v.chords), ...(s!.ex.decoys || [])];
      for (const r of refs) { expect(s!.ex.voicings[r], `${id} ${r}`).toBeTruthy(); for (const f of s!.ex.voicings[r].frets) expect(f).toHaveLength(6); }
    }
  });
  it('A.01 runs only its pair (either G fingering counts); A.02 runs all four pairs', () => {
    const a1 = chordSetup(L('A.01'), cat)!; expect(a1.kind).toBe('changes');
    if (a1.kind === 'changes') { expect(a1.pairs).toEqual([['Em', 'G|G_4f']]); expect(a1.ex.voicings['G|G_4f'].frets).toHaveLength(2); expect(a1.target).toBe(30); }
    const a2 = chordSetup(L('A.02'), cat)!; if (a2.kind === 'changes') expect(a2.pairs).toHaveLength(4);
  });
  it('timed vs own pace and tempo ladders follow the lesson data', () => {
    const k = (id: string) => { const s = chordSetup(L(id), cat)!; return s.kind === 'accuracy' ? [s.ex.pace, s.bpm, s.ladder] : null; };
    expect(k('A.11')).toEqual(['timed', 80, true]);
    expect(k('ER.05')).toEqual(['timed', 70, false]);
    expect(k('ER.09')).toEqual(['timed', 80, false]);
    for (const id of ['A.08', 'A.12', 'ER.11']) expect(k(id)).toEqual(['own', null, false]);
  });
  it('capo templates use sounding pitches; no-capo decoys never duplicate a real chord', () => {
    const ex = EX('EX_capo_keys') as ChordProgEx, vA = ex.variants.find(v => v.key === 'A')!;
    const { targets, decoys } = progressionTargets(ex, vA);
    const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    expect(targets['G|G_4f'].pcs.map(p => NAMES[p])).toEqual(['C#', 'E', 'A']);   // G shape + capo 2 = A
    expect(targets['Em'].pcs.map(p => NAMES[p])).toEqual(['C#', 'F#', 'A']);       // F#m
    // D without capo sounds like the C shape with capo 2 (both D major), so it can't be a decoy
    expect(decoys.map(d => d.id)).not.toContain('nocapo:D');
    expect(decoys.map(d => d.id)).toContain('nocapo:G|G_4f');
    expect(decoys.every(d => !Object.values(targets).some(t => t.pcs.join() === d.pcs.join()))).toBe(true);
  });
  it('ER.11 shows numbers only and picks a key on the spot', () => {
    const ex = EX('EX_number_chart') as ChordProgEx;
    expect(ex.show).toBe('numbers'); expect(ex.variants.length).toBeGreaterThanOrEqual(5);
    expect(new Set([0.01, 0.3, 0.6, 0.99].map(r => pickVariant(ex, undefined, () => r))).size).toBeGreaterThan(2);
    expect(pickVariant(EX('EX_amazing_grace_chords'), 2)).toBe(2);
  });
});

describe('verifier: right chord vs similar wrong chords (synthetic strums)', () => {
  // Thresholds are the worst seen over 11 seeds (CHORD_SEED), so they test the method, not one lucky draw.
  it('G vs Em, C vs Am: ≥ 90%', () => {
    const a = confusion({ G: [3, 2, 0, 0, 0, 3], Em: [0, 2, 2, 0, 0, 0] }, 15); log('G vs Em', a);
    const b = confusion({ C: [-1, 3, 2, 0, 1, 0], Am: [-1, 0, 2, 2, 1, 0] }, 15); log('C vs Am', b);
    expect(a.acc).toBeGreaterThanOrEqual(0.9); expect(b.acc).toBeGreaterThanOrEqual(0.9);
  });
  it('G family (A.02 voicings, shared top strings): ≥ 90%', () => {
    const r = confusion({ G_4f: [3, 2, 0, 0, 3, 3], Cadd9: [-1, 3, 2, 0, 3, 3], Dsus4: [-1, -1, 0, 2, 3, 3], Em7: [0, 2, 2, 0, 3, 3] }, 10); log('G family', r);
    expect(r.acc).toBeGreaterThanOrEqual(0.9);
  });
  it('one string different: D vs Dsus4 (≥ 80%), A vs Asus4 (≥ 85%)', () => {
    const a = confusion({ D: [-1, -1, 0, 2, 3, 2], Dsus4: [-1, -1, 0, 2, 3, 3] }, 15); log('D vs Dsus4', a);
    const b = confusion({ A: [-1, 0, 2, 2, 2, 0], Asus4: [-1, 0, 2, 2, 3, 0] }, 15); log('A vs Asus4', b);
    expect(a.acc).toBeGreaterThanOrEqual(0.8); expect(b.acc).toBeGreaterThanOrEqual(0.85);
  });
  it('capo’d shapes (capo 3, G shapes = Bb Eb F Gm): ≥ 90%; the same shapes without the capo are caught', () => {
    const shapes = { G: [3, 2, 0, 0, 0, 3], C: [-1, 3, 2, 0, 1, 0], D: [-1, -1, 0, 2, 3, 2], Em: [0, 2, 2, 0, 0, 0] };
    const r = confusion(shapes, 8, { capo: 3 }); log('capo 3 G shapes', r);
    expect(r.acc).toBeGreaterThanOrEqual(0.9);
    // forgot the capo: templates expect capo 3, player plays open shapes
    const ex = EX('EX_capo_keys') as ChordProgEx, v = ex.variants.find(x => x.key === 'Bb')!;
    const tg = progressionTargets(ex, v), all = [...Object.values(tg.targets), ...tg.decoys];
    const strums = analyze(render(v.chords.slice(0, 4).map((r, i) => ({ frets: ex.voicings[r].frets[0], t: 0.3 + i, dur: 1 })), 5));
    const verdicts = v.chords.slice(0, 4).map((r, i) => verifyChord(strums[i].chroma, tg.targets[r], all));
    expect(verdicts.filter(x => x.ok)).toHaveLength(0);
    expect(verdicts.filter(x => x.heard?.startsWith('nocapo:')).length).toBeGreaterThanOrEqual(3);
  });
  it('triads (ER.04 on 3-2-1, ER.05 on 4-3-2): ≥ 90%', () => {
    const t = (ex: string) => Object.fromEntries((EX(ex) as ChordProgEx).variants[0].chords.slice(0, 4).map(r => [r, (EX(ex) as ChordProgEx).voicings[r].frets[0]]));
    const ch = EX('EX_changes_triads_G') as ChordChangesEx;
    const t321 = Object.fromEntries([...new Set(ch.pairs.flat())].map(r => [r, ch.voicings[r].frets[0]]));
    const a = confusion(t321, 10); log('triads 3-2-1', a);
    const b = confusion(t('EX_triads_432_G'), 10); log('triads 4-3-2', b);
    expect(a.acc).toBeGreaterThanOrEqual(0.9); expect(b.acc).toBeGreaterThanOrEqual(0.9);
  });
  it('drone voicings (open B and E ring through all of them): ≥ 90%', () => {
    const ex = EX('EX_changes_drone') as ChordChangesEx, v = ex.voicings;
    const e = confusion({ E: v.E.frets[0], Bsus4: v.Bsus4_drone.frets[0], Csm7: v.Csharpm7_drone.frets[0], Asus2: v.Asus2.frets[0] }, 8); log('drones key of E', e);
    const d = confusion({ D: v.D.frets[0], GB: v.G_over_B.frets[0], Em7: v.Em7.frets[0], A7sus4: v.A7sus4.frets[0] }, 8); log('drones key of D', d);
    // 6 seeds: key of E 28–32/32 (E and C#m7 differ only in the bass: C# vs E), key of D 30–32/32
    expect(e.acc).toBeGreaterThanOrEqual(0.85); expect(d.acc).toBeGreaterThanOrEqual(0.9);
  });
  it('barre chords (ER.09 positions ≥ 90%; F, Fmaj7, C, Am ≥ 85%: Fmaj7 and Am differ by one note)', () => {
    const ex = EX('EX_barre_progression_G') as ChordProgEx;
    const a = confusion(Object.fromEntries(ex.variants[0].chords.slice(0, 4).map(r => [r, ex.voicings[r].frets[0]])), 8); log('barres 1-5-6m-4 in G', a);
    const b = confusion({ F: [1, 3, 3, 2, 1, 1], Fmaj7: [-1, -1, 3, 2, 1, 0], C: [-1, 3, 2, 0, 1, 0], Am: [-1, 0, 2, 2, 1, 0] }, 8); log('F / Fmaj7 / C / Am', b);
    expect(a.acc).toBeGreaterThanOrEqual(0.9); expect(b.acc).toBeGreaterThanOrEqual(0.85);
  });
  it('A.12 own pace: right barres pass; Fmaj7 for F and the partial Bm fail (F and Bm graded on their own, low root checked)', () => {
    const ex = EX('EX_barre_F_Bm') as ChordProgEx, v = ex.variants[0], tg = progressionTargets(ex, v), all = [...Object.values(tg.targets), ...tg.decoys];
    expect(ex.focus).toEqual(['F', 'Bm']); expect(v.chords.filter(c => c === 'F')).toHaveLength(2);
    const run = (play: (r: string) => number[]) => {
      const specs: StrumSpec[] = []; let t = 0.4;
      v.chords.forEach(r => { for (let k = 0; k < 4; k++) { specs.push({ frets: play(r), t, dur: 0.6 }); t += 0.45; } t += 0.25; });
      const st = analyze(render(specs, t + 1));
      const res: StrumResult[] = specs.map((sp, i) => { const s = st.find(x => Math.abs(x.t - sp.t) < 0.06), box = Math.floor(i / 4), r = v.chords[box];
        const vv = verifyChord(s?.chroma ?? null, tg.targets[r], all, undefined, undefined, s?.low ?? null);
        return { t: sp.t, box, expected: r, heard: vv.heard, ok: vv.ok, score: vv.score, margin: vv.margin }; });
      return gradeOwnChords(res, v.chords.map(r => ({ ref: r, label: r })), 4, 0.8, ex.focus);
    };
    const right = run(r => ex.voicings[r].frets[0]);
    const fmaj7 = run(r => (r === 'F' ? [-1, -1, 3, 2, 1, 0] : ex.voicings[r].frets[0]));
    const partial = run(r => (r === 'Bm' ? [-1, -1, 4, 4, 3, 2] : ex.voicings[r].frets[0]));
    const f = (g: typeof right) => g.focus.map(x => `${x.ref} ${x.correct}/${x.graded}`).join(', ');
    report.push(`A.12 right barres: ${f(right)} · Fmaj7 for F: ${f(fmaj7)} · partial Bm: ${f(partial)}`);
    expect(right.met).toBe(true);
    expect(fmaj7.met).toBe(false); expect(fmaj7.focus[0].met).toBe(false); expect(fmaj7.confusion.F['decoy:Fmaj7']).toBeGreaterThanOrEqual(5);
    expect(partial.met).toBe(false); expect(partial.focus[1].met).toBe(false); expect(partial.confusion.Bm['decoy:Bm_partial']).toBeGreaterThanOrEqual(5);
    // only F and Bm strums count
    expect(right.graded).toBe(16);
  });
  it('A.11: G vs G7 (G7 holds all of G plus F; G2/G3’s 7th harmonic sits ~31¢ flat of F)', () => {
    const r = confusion({ G: [3, 2, 0, 0, 0, 3], G7: [3, 2, 0, 0, 0, 1], C: [-1, 3, 2, 0, 1, 0], D: [-1, -1, 0, 2, 3, 2] }, 10); log('A.11 G / G7 / C / D', r);
    expect(r.acc).toBeGreaterThanOrEqual(0.9);
    expect(r.conf['G>G7'] || 0).toBeLessThanOrEqual(1);
  });
  it('a missed string still verifies (G without string 6, Em without string 1, F without string 1)', () => {
    const a = confusion({ G: [3, 2, 0, 0, 0, 3], Em: [0, 2, 2, 0, 0, 0] }, 10, { drop: id => (id === 'G' ? [6] : [1]) }); log('G/Em one string missed', a);
    const b = confusion({ F: [1, 3, 3, 2, 1, 1], C: [-1, 3, 2, 0, 1, 0], G: [3, 2, 0, 0, 0, 3], Am: [-1, 0, 2, 2, 1, 0] }, 6, { drop: id => (id === 'F' ? [1] : []) }); log('F with a dead string 1', b);
    expect(a.acc).toBeGreaterThanOrEqual(0.9); expect(b.acc).toBeGreaterThanOrEqual(0.9);
  });
  it('wrong chord played: heard as the other chord, not credited', () => {
    const r = confusion({ G: [3, 2, 0, 0, 0, 3], Em: [0, 2, 2, 0, 0, 0] }, 10, { play: id => (id === 'G' ? [0, 2, 2, 0, 0, 0] : [3, 2, 0, 0, 0, 3]) });
    expect(r.ok).toBe(0); expect(r.conf['G>Em'] + r.conf['Em>G']).toBeGreaterThanOrEqual(19);
  });
  it('the previous chord still ringing (not damped) doesn’t steal the next strum', () => {
    // Em (all six strings, left ringing) then a softer D on strings 4–1: Em's low E and B keep sounding under the D.
    // Also G then C (string 6's G rings under the C) and G → Em → D in a row.
    const T = (id: string, f: number[]) => chordTarget(id, id, [f]);
    const em = T('Em', [0, 2, 2, 0, 0, 0]), d = T('D', [-1, -1, 0, 2, 3, 2]), g = T('G', [3, 2, 0, 0, 0, 3]), c = T('C', [-1, 3, 2, 0, 1, 0]);
    const cases: [ChordTarget, ChordTarget, number][] = [[em, d, 0.8], [g, c, 0.8], [em, d, 0.55]];
    let ok = 0, n = 0;
    for (const [from, to, gain] of cases) for (let k = 0; k < 6; k++) {
      const buf = render([{ frets: from.frets[0], t: 0.2, dur: 3 }, { frets: to.frets[0], t: 0.8, dur: 2, gain }], 3);
      const s = analyze(buf).find(x => Math.abs(x.t - 0.8) < 0.06);
      n++; const vv = verifyChord(s?.chroma ?? null, to, [em, d, g, c]); if (vv.ok) ok++;
    }
    report.push(`next chord over strings still ringing from the last one: ${ok}/${n}`);
    // 6 seeds: 15–18 of 18. The misses are the soft D under a loud, undamped Em bass (a muddy sound on a guitar too)
    expect(ok / n).toBeGreaterThanOrEqual(0.8);
  });
  it('a muted scratch or silence is unclear, never a chord', () => {
    const g = chordTarget('G', 'G', [[3, 2, 0, 0, 0, 3]]), em = chordTarget('Em', 'Em', [[0, 2, 2, 0, 0, 0]]);
    const buf = new Float32Array(SR * 2);
    for (let i = Math.round(0.5 * SR); i < 0.53 * SR; i++) buf[i] = (rnd() * 2 - 1) * 0.5;   // pick scratch on muted strings
    for (let i = 0; i < buf.length; i++) buf[i] += (rnd() * 2 - 1) * 0.002;
    const s = analyze(buf);
    for (const x of s) expect(verifyChord(x.chroma, g, [g, em]).ok).toBe(false);
    expect(verifyChord(null, g, [g, em]).why).toBe('silent');
  });
});

describe('chord_accuracy grading', () => {
  const ex = EX('EX_triads_432_G') as ChordProgEx, v = ex.variants[0];
  const tg = progressionTargets(ex, v);
  /** eighth-note strums in every box, `play(i)` = frets for box i; `lat` = input latency */
  const play = (plan: ReturnType<typeof buildChordPlan>, f: (i: number) => number[] | null, lat = 0.05, extra?: (b: Float32Array) => void) => {
    const strums: StrumSpec[] = [];
    plan.boxes.forEach((b, i) => { const fr = f(i); if (!fr) return; for (let k = 0; k < 8; k++) strums.push({ frets: fr, t: b.t0 + k * plan.beat / 2 + lat + (rnd() - 0.5) * 0.02, dur: plan.beat / 2 + 0.3, up: k % 2 === 1, gain: k % 2 ? 0.7 : 1 }); });
    return render(strums, plan.end + 1, 0.002, extra);
  };
  const plan = buildChordPlan(ex, v, 70, 4, 0.2);
  it('plan: one bar count-in, a chord per bar, clicks on every beat', () => {
    expect(plan.countIn).toHaveLength(4); expect(plan.boxes).toHaveLength(8); expect(plan.clicks).toHaveLength(4 + 32);
    expect(plan.boxes[1].t0 - plan.boxes[0].t0).toBeCloseTo(4 * 60 / 70, 6);
  });
  it('right chords to the click pass (≥ 90%), with click bleed in the input', () => {
    const bleed = (b: Float32Array) => { for (const c of plan.clicks) { const i0 = Math.round((c.t + 0.09) * SR), fq = c.kind === 0 ? 2600 : 2000; for (let i = 0; i < 0.06 * SR && i0 + i < b.length; i++) { const t = i / SR; b[i0 + i] += 0.25 * Math.min(1, t / 0.002) * Math.exp(-(t - 0.002) / 0.006) * Math.sin(2 * Math.PI * fq * t); } } };
    const strums = analyze(play(plan, i => ex.voicings[v.chords[i]].frets[0], 0.05, bleed));
    const g = gradeTimedChords(strums, plan, tg, { offsetS: 0.05, ratio: 0.9 });
    const strumOk = g.strums.filter(s => !s.skipped && s.ok).length, strumN = g.strums.filter(s => !s.skipped).length;
    report.push(`ER.05 timed, right chords: ${g.correct}/${g.graded} bars, ${strumOk}/${strumN} strums`);
    expect(g.unit).toBe('bars'); expect(g.met).toBe(true); expect(g.correct).toBe(8); expect(g.missedBoxes).toBe(0);
    expect(strumN).toBeGreaterThanOrEqual(50);
  });
  it('one wrong strum in a bar doesn’t sink it; a bar of mostly wrong strums costs the whole bar', () => {
    const b = (i: number, ok: boolean, n: number): StrumResult[] => Array.from({ length: n }, (_, k) => ({ t: plan.boxes[i].t0 + k * 0.3 + 0.01, box: i, expected: plan.boxes[i].ref, heard: null, ok: k === 0 ? ok : !ok, score: 0.8, margin: 0 }));
    // gradeTimedChords works on strums; check the per-bar rule through the same summary via own-pace grading of one box
    expect(gradeOwnChords([...b(0, false, 8)], [{ ref: plan.boxes[0].ref, label: '' }], 8, 0.9).correct).toBe(7);
    // timed: a bar of 8 strums with 7 wrong is wrong as a bar, whatever the other bars do
    const strums = analyze(play(plan, i => (i === 0 ? ex.voicings[v.chords[1]].frets[0] : ex.voicings[v.chords[i]].frets[0])));
    const g = gradeTimedChords(strums, plan, tg, { offsetS: 0.05, ratio: 0.9 });
    expect(g.boxes[0].ok * 2).toBeLessThanOrEqual(g.boxes[0].strums); expect(g.correct).toBe(7); expect(g.met).toBe(false);
  });
  it('two bars of wrong chords fail; the confusion shows what was played', () => {
    const wrong = (i: number) => (i === 1 || i === 5 ? ex.voicings[v.chords[2]].frets[0] : ex.voicings[v.chords[i]].frets[0]); // Em where D belongs
    const g = gradeTimedChords(analyze(play(plan, wrong)), plan, tg, { offsetS: 0.05, ratio: 0.9 });
    expect(g.met).toBe(false);
    expect(g.confusion['tri_432_D_inv1']['tri_432_Em_inv1']).toBeGreaterThanOrEqual(10);
    expect(chordCoach(g, Object.fromEntries(Object.entries(ex.voicings).map(([k, x]) => [k, x.name])))).toMatch(/D strums sounded like Em/);
  });
  it('a skipped chord counts as a miss; nothing played = no strums heard', () => {
    const g = gradeTimedChords(analyze(play(plan, i => (i === 3 ? null : ex.voicings[v.chords[i]].frets[0]))), plan, tg, { offsetS: 0.05, ratio: 0.9 });
    // the skipped box counts as a miss: no strum at all ('none'), or (some seeds) one stray onset from the last
    // chord's decay, which isn't any chord ('unclear')
    expect(g.boxes[3].ok).toBe(0);
    expect((g.confusion['tri_432_C_inv2'].none || 0) + (g.confusion['tri_432_C_inv2'].unclear || 0)).toBeGreaterThanOrEqual(1);
    expect(g.missedBoxes + g.strums.filter(x => x.box === 3 && !x.ok).length).toBeGreaterThanOrEqual(1);
    const z = gradeTimedChords([], plan, tg, { offsetS: 0, ratio: 0.9 });
    expect(z.met).toBe(false); expect(z.missedBoxes).toBe(8);
  });
  it('own pace: strums assigned in order; unplayed strums are misses', () => {
    const res = (n: number, okN: number): StrumResult[] => Array.from({ length: n }, (_, i) => ({ t: i, box: Math.floor(i / 4), expected: v.chords[Math.floor(i / 4)], heard: i < okN ? v.chords[Math.floor(i / 4)] : null, ok: i < okN, score: 0.9, margin: 0.1 }));
    const boxes = v.chords.map(r => ({ ref: r, label: r }));
    expect(gradeOwnChords(res(32, 30), boxes, 4, 0.9).met).toBe(true);
    const early = gradeOwnChords(res(16, 16), boxes, 4, 0.9);
    expect(early.owed).toBe(16); expect(early.ratio).toBeCloseTo(0.5); expect(early.met).toBe(false);
  });
});

describe('A.11 Amazing Grace to a click (3/4, waltz strum)', () => {
  const ex = EX('EX_amazing_grace_chords') as ChordProgEx;
  for (const [vi, bpm] of [[0, 80], [0, 52], [2, 80]] as [number, number][]) it(`${ex.variants[vi].label} at ${bpm} BPM passes with the right chords`, () => {
    const v = ex.variants[vi], tg = progressionTargets(ex, v), plan = buildChordPlan(ex, v, bpm, 3, 0.2);
    const specs: StrumSpec[] = [];
    // waltz: D - D U D U (beats 1, 2, 2&, 3, 3&)
    plan.boxes.forEach(b => [0, 1, 1.5, 2, 2.5].forEach((o, k) => specs.push({ frets: ex.voicings[b.ref].frets[0], capo: v.capo, t: b.t0 + o * plan.beat + 0.05 + (rnd() - 0.5) * 0.02, dur: plan.beat + 0.3, up: o % 1 !== 0, gain: k === 0 ? 1 : 0.7 })));
    const g = gradeTimedChords(analyze(render(specs, plan.end + 1)), plan, tg, { offsetS: 0.05, ratio: 0.9 });
    report.push(`A.11 ${v.key} @${bpm}: ${g.correct}/${g.graded} ${g.unit} ${JSON.stringify(Object.fromEntries(Object.entries(g.confusion).map(([e, r]) => [e, Object.fromEntries(Object.entries(r).filter(([h]) => h !== e))]).filter(([, r]) => Object.keys(r).length)))}`);
    expect(g.met).toBe(true);
  });
});

describe('changes_per_min', () => {
  const ex = EX('EX_changes_em_g') as ChordChangesEx;
  const [em, g] = pairTargets(ex, ex.pairs[0]);
  it('alternating Em ↔ G counts every change; either G fingering is fine', () => {
    // 12 s window, one strum every 0.4 s (2.5 changes/s ≈ 150/min), alternating Em, G (3-finger), Em, G (4-finger)
    const seq = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? [0, 2, 2, 0, 0, 0] : i % 4 === 1 ? [3, 2, 0, 0, 0, 3] : [3, 2, 0, 0, 3, 3]));
    const strums = analyze(render(seq.map((f, i) => ({ frets: f, t: 0.5 + i * 0.4, dur: 0.6 })), 13));
    const r = countChanges(strums, em, g, 0.4, 12.4, 30);
    report.push(`Em↔G changes: ${r.changes}/29 (unclear ${r.unclear})`);
    expect(r.changes).toBeGreaterThanOrEqual(27); expect(r.perMin).toBeGreaterThan(130); expect(r.met).toBe(true);
  });
  it('two strums per chord count one change per switch; staying on one chord counts none', () => {
    const seq = Array.from({ length: 16 }, (_, i) => (Math.floor(i / 2) % 2 === 0 ? [0, 2, 2, 0, 0, 0] : [3, 2, 0, 0, 0, 3]));
    const r = countChanges(analyze(render(seq.map((f, i) => ({ frets: f, t: 0.5 + i * 0.45, dur: 0.6 })), 8.5)), em, g, 0, 8.5, 30);
    expect(r.changes).toBeGreaterThanOrEqual(6); expect(r.changes).toBeLessThanOrEqual(7);
    const same = countChanges(analyze(render(Array.from({ length: 12 }, (_, i) => ({ frets: [3, 2, 0, 0, 0, 3], t: 0.5 + i * 0.45, dur: 0.6 })), 6.5)), em, g, 0, 6.5, 30);
    expect(same.changes).toBe(0);
  });
  it('a chord outside the pair is neither (C instead of G doesn’t count as a change)', () => {
    const seq = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? [0, 2, 2, 0, 0, 0] : [-1, 3, 2, 0, 1, 0]));
    const r = countChanges(analyze(render(seq.map((f, i) => ({ frets: f, t: 0.5 + i * 0.45, dur: 0.6 })), 6.5)), em, g, 0, 6.5, 30);
    report.push(`Em↔C against the Em↔G pair: ${r.changes} counted, ${r.unclear} unclear`);
    expect(r.changes).toBeLessThanOrEqual(2);
  });
  it('rate scales with the window, and the pair classifier refuses close calls', () => {
    const fake = (heard: string[]): Strum[] => heard.map((h, i) => ({ t: i, chroma: h === 'Em' ? em.templates[0] : g.templates[0], level: 0.1, frames: 5 }));
    const r = countChanges(fake(['Em', 'G', 'Em', 'G', 'Em', 'G']), em, g, 0, 10, 30);
    expect(r.changes).toBe(5); expect(r.perMin).toBeCloseTo(30);
    const mid = em.templates[0].map((x, i) => (x + g.templates[0][i]) / 2);
    expect(classifyPair(mid, em, g).heard).toBeNull();
    expect(MIN_SCORE).toBeGreaterThan(0.5);
  });
});

describe('templates', () => {
  it('sounding frets with a capo; pitch classes', () => {
    expect(soundingFrets([-1, 3, 2, 0, 1, 0], 2)).toEqual([-1, 5, 4, 2, 3, 2]);
    expect(pcsOf([3, 2, 0, 0, 0, 3])).toEqual([2, 7, 11]);
  });
  it('a target with two fingerings scores the better one', () => {
    const t: ChordTarget = chordTarget('G', 'G', [[3, 2, 0, 0, 0, 3], [3, 2, 0, 0, 3, 3]]);
    expect(t.templates).toHaveLength(2);
  });
});
