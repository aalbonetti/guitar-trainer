// G2: play mode, Octave Jump, Box Runner, In the Pocket, and the streak rules (07-games.md §1–§4).
// Play-mode judging runs synthetic guitar-like notes through the same PitchTracker + OnsetDetector as the app.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { OnsetDetector } from '../src/dsp/dsp.js';
import { PitchTracker, segmentNotes, trackerRange, type PitchFrame } from '../src/grading/pitch';
import {
  pointsWith, points, timingBonus, scoreRun, comboMult, octaveQ, octaveShape, midiAt, zoneMidis, rng, boxFrets, boxNotes, boxPath, boxWindowS,
  pocketLayout, pocketVerdicts, stars, type Pos, type Verdict,
} from '../src/games/core';
import { judgeAnswer, gradeTimedNote } from '../src/games/judge';
import { boxSetup, pocketSetup } from '../src/games/rounds';
import { computeStreak, qualifies, counts, STREAK_MIN_S } from '../src/streak';
import { addDays } from '../src/progress';
import { bests, bestKey, unlocked, bestStars, modeFor, setModeFor } from '../src/arcade';

const j = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const games = j('games.json'), scales = j('scales.json'), rhythm = j('rhythm.json');
const cat: any = { scales, strums: rhythm.strumming, games };
const G = (id: string) => games.find((g: any) => g.id === id);
const OPEN = [40, 45, 50, 55, 59, 64];

// ---------- synthetic audio (as in pitch.test.ts) ----------
const SR = 48000;
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
function render(notes: { midi: number; t: number; dur: number; gain?: number }[], len: number): Float32Array {
  const out = new Float32Array(Math.ceil(len * SR));
  for (const n of notes) {
    const amps = [1, 0.6, 0.35, 0.22, 0.12, 0.07], ph = amps.map(() => rnd() * 6), f0 = 440 * 2 ** ((n.midi - 69) / 12);
    const i0 = Math.round(n.t * SR), N = Math.round(n.dur * SR);
    for (let i = 0; i < N && i0 + i < out.length; i++) {
      const t = i / SR, env = Math.min(1, t / 0.004) * Math.exp(-t * 1.5) * Math.min(1, (N - i) / (0.01 * SR));
      let v = 0; for (let h = 0; h < amps.length; h++) { if (f0 * (h + 1) > SR / 2.2) break; ph[h] += 2 * Math.PI * f0 * (h + 1) / SR; v += amps[h] * Math.exp(-t * h * 0.8) * Math.sin(ph[h]); }
      out[i0 + i] += (n.gain ?? 0.4) * env * v * 0.5;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += rnd() * 0.0006;
  return out;
}
function analyze(buf: Float32Array, midis: number[]) {
  const tr = new PitchTracker(SR, trackerRange(midis)), det = new OnsetDetector(SR);
  const frames: PitchFrame[] = [], onsets: number[] = [];
  for (let i = 0; i < buf.length; i += 512) { const d = buf.subarray(i, Math.min(buf.length, i + 512)); frames.push(...tr.push(d, i)); det.push(d, i).forEach(f => onsets.push(f / SR)); }
  return { frames, onsets };
}
/** What the game would have heard by context time `now`, from the question's `since`. */
const segsSince = (a: { frames: PitchFrame[]; onsets: number[] }, t: number, now = Infinity) => segmentNotes(a.frames.filter(f => f.t >= t - 0.05 && f.t <= now), a.onsets.filter(o => o >= t - 0.05 && o <= now));

describe('scoring (07 §3)', () => {
  it('points with an explicit bonus: 100 × bonus × combo; click-timed games use 100 per beat', () => {
    expect(pointsWith(2, 0)).toBe(200); expect(pointsWith(1.5, 8)).toBe(300); expect(pointsWith(2, 24)).toBe(800);
    expect(pointsWith(2, 0, 50)).toBe(100); expect(pointsWith(3, 0)).toBe(200); expect(pointsWith(0.2, 0)).toBe(100); // bonus clamped 1–2
    expect(points(500, 8)).toBe(pointsWith(2, 8));
  });
  it('timing bonus: 2.0 near the beat, 1.0 at the window edge', () => {
    expect(timingBonus(5, 10, 60)).toBe(2); expect(timingBonus(-10, 10, 60)).toBe(2); expect(timingBonus(35, 10, 60)).toBeCloseTo(1.5); expect(timingBonus(-60, 10, 60)).toBe(1); expect(timingBonus(90, 10, 60)).toBe(1);
  });
  it('scoreRun: combo steps every 8 in a row, a miss resets it to ×1', () => {
    const ok = (n: number): Verdict[] => Array.from({ length: n }, () => ({ ok: true, bonus: 1 }));
    expect(scoreRun(ok(8)).score).toBe(800);
    expect(scoreRun(ok(9)).score).toBe(1000);                      // 9th at ×2
    expect(scoreRun(ok(33)).maxCombo).toBe(4);
    const r = scoreRun([...ok(9), { ok: false, bonus: 0, miss: 'x' }, ...ok(1)]);
    expect(r.score).toBe(1100); expect(r.correct).toBe(10); expect(r.total).toBe(11); expect(r.misses).toEqual(['x']); expect(r.streak).toBe(1);
    expect(scoreRun(ok(8), 50).score).toBe(400);
    expect(comboMult(scoreRun(ok(16)).streak)).toBe(3);
  });
  it('stars: ★ finish, ★★ 85%, ★★★ 95% + target', () => {
    expect(stars(true, 0.85, 0, 1)).toBe(2); expect(stars(true, 0.84, 9e9, 1)).toBe(1); expect(stars(true, 0.95, 100, 100)).toBe(3); expect(stars(true, 0.95, 99, 100)).toBe(2); expect(stars(false, 1, 9e9, 1)).toBe(0);
  });
});

describe('Octave Jump', () => {
  it('asks a note on the level strings; the answer is exactly an octave up, at the octave shape', () => {
    const r = rng(3);
    for (const l of G('G_octave_jump').levels) {
      const z = l.params.zone;
      for (let i = 0; i < 200; i++) {
        const q = octaveQ(r, z);
        expect(z.strings).toContain(q.from.string);
        expect(q.from.fret).toBeGreaterThanOrEqual(z.frets[0]); expect(q.from.fret).toBeLessThanOrEqual(z.frets[1]);
        expect(q.high - q.low).toBe(12); expect(midiAt(q.shape)).toBe(q.high);
        expect(q.shape.string).toBe(q.from.string - 2); expect(q.shape.fret).toBe(q.from.fret + 2);
      }
    }
    expect(octaveShape({ string: 4, fret: 2 })).toEqual({ string: 2, fret: 5 });
  });
  it('never repeats the same spot twice in a row', () => {
    const r = rng(9), z = { strings: [6], frets: [0, 1] as [number, number] }; let prev;
    for (let i = 0; i < 50; i++) { const q = octaveQ(r, z, prev); if (prev) expect(q.from).not.toEqual(prev.from); prev = q; }
  });
});

describe('Note Drop / Fret Finder play mode targets', () => {
  it('Note Drop accepts any octave the zone holds, and only those', () => {
    expect(zoneMidis(7, { strings: [6, 5], frets: [0, 5] })).toEqual([43]);               // G: string 6 fret 3 only
    expect(zoneMidis(4, { strings: [6, 5, 4, 3, 2, 1], frets: [0, 12] })).toEqual([40, 52, 64, 76]);
    expect(zoneMidis(9, { strings: [6, 5], frets: [0, 5] })).toEqual([45]);               // A on 6/5 and 5/0: one pitch
  });
  it('on one string, every place of a note is a different octave (so Fret Finder can check the exact octave)', () => {
    for (let s = 1; s <= 6; s++) for (let pc = 0; pc < 12; pc++) {
      const ms = Array.from({ length: 13 }, (_, f) => ({ string: s, fret: f })).filter(p => (OPEN[6 - s] + p.fret) % 12 === pc).map(midiAt);
      expect(new Set(ms).size).toBe(ms.length);
    }
  });
});

describe('Box Runner', () => {
  const gPent2 = scales.find((s: any) => s.id === 'G_major_pent_pos2');
  it('moves the box to a key: the lowest placement within frets 0–15', () => {
    expect(boxFrets(gPent2, 'G')).toEqual([[3, 5], [2, 5], [2, 5], [2, 4], [3, 5], [3, 5]]);
    expect(Math.min(...boxFrets(gPent2, 'E').flat())).toBe(11);                           // E: up 9, not down 3 (below the nut)
    expect(Math.min(...boxFrets(scales.find((s: any) => s.id === 'Am_pent_pos5'), 'A').flat())).toBe(2); // 14–17 → an octave down
  });
  it('box notes run low to high; the path never asks the same note twice in a row', () => {
    const notes = boxNotes(boxFrets(gPent2, 'G'));
    const m = notes.map(midiAt); expect(m).toEqual([...m].sort((a, b) => a - b)); expect(notes.length).toBe(12);
    expect(notes.map(midiAt).map(x => x % 12).every(pc => [7, 9, 11, 2, 4].includes(pc))).toBe(true);
    for (const [path, passes, len] of [['updown', 1, 23], ['updown', 2, 45], ['up', 1, 12], ['threes', 1, 57], ['threes', 2, 111]] as const) {
      const p = boxPath(notes, path, passes);
      expect(p.length).toBe(len);
      for (let i = 1; i < p.length; i++) expect(midiAt(p[i])).not.toBe(midiAt(p[i - 1]));
    }
    expect(boxPath(notes, 'threes', 1).slice(0, 6).map(midiAt)).toEqual([43, 45, 47, 45, 47, 50]);
  });
  it('every level, key and position builds a box with the scale\'s notes on frets 0–15', () => {
    for (const l of G('G_box_runner').levels) for (const key of l.params.keys) for (const pos of l.params.positions) {
      const S = boxSetup(cat, { ...l.params, keys: [key], positions: [pos] }, rng(1));
      expect(S.path.length).toBeGreaterThan(20);
      for (const q of S.path) { expect(q.fret).toBeGreaterThanOrEqual(0); expect(q.fret).toBeLessThanOrEqual(15); }
      const beats = S.path.length / l.params.sub, secs = (beats * 60) / l.params.bpm;
      expect(secs).toBeGreaterThan(20); expect(secs).toBeLessThan(180);                    // 1–3 minute rounds
    }
  });
  it('timing window: 40% of the note spacing, 100–220 ms', () => {
    expect(boxWindowS(0.375)).toBeCloseTo(0.15); expect(boxWindowS(0.857)).toBe(0.22); expect(boxWindowS(0.1)).toBe(0.1);
  });
});

describe('In the Pocket', () => {
  it('Gap Click layout: click, gap, click…; bars match games.json', () => {
    const pk3 = G('G_in_the_pocket').levels.find((l: any) => l.id === 'pk3').params;
    const lay = pocketLayout(pk3);
    expect(lay.bars).toBe(15); expect(pk3.bars).toBe(15);
    expect(lay.gapOf).toEqual([-1, -1, 0, -1, -1, 1, 1, -1, -1, 2, 2, 2, 2, -1, -1]);
    expect(lay.returns.map(r => [r.bars, r.bar])).toEqual([[1, 3], [2, 7], [4, 13]]);
    expect(pocketLayout({ bars: 16, window_ms: 60 }).gapOf.every(x => x === -1)).toBe(true);
  });
  it('the click drops out in gap bars; the count-in always plays; strums are expected through the gaps', () => {
    const pk3 = G('G_in_the_pocket').levels.find((l: any) => l.id === 'pk3').params;
    const S = pocketSetup(cat, pk3, 10);
    const beat = 60 / pk3.bpm;
    expect(S.plan.clicks.length).toBe(4 + (15 - 7) * 4);
    expect(S.plan.clicks.slice(0, 4).map(c => +(c.t - 10).toFixed(6))).toEqual([0, beat, 2 * beat, 3 * beat].map(x => +x.toFixed(6)));
    const inGap = S.plan.clicks.filter(c => c.t >= S.plan.start + 2 * 4 * beat - 1e-6 && c.t < S.plan.start + 3 * 4 * beat - 1e-6);
    expect(inGap.length).toBe(0);
    expect(S.slots.length).toBe(15 * 8); expect(S.slots.every(s => s.expected)).toBe(true);
    expect([...S.returnBars.entries()]).toEqual([[3, 1], [7, 2], [13, 4]]);
  });
  it('every level is a 20 s – 3 min round; base points per strum = 100 ÷ strums per beat', () => {
    for (const l of G('G_in_the_pocket').levels) {
      const S = pocketSetup(cat, l.params, 0), secs = S.plan.end - S.plan.start;
      expect(secs).toBeGreaterThan(20); expect(secs).toBeLessThan(180);
      expect(S.feel.sub).toBe({ S1_quarters: 1, S2_eighths: 2, S3_worship: 2, S8_sixteenths: 4 }[l.params.pattern as string]);
    }
  });
  it('grades strums: on time right, outside ±window a miss (late/early), none = missed, rests', () => {
    const S = pocketSetup(cat, { pattern: 'S3_worship', bpm: 90, bars: 2, window_ms: 60 }, 0);
    const exp = S.slots.filter(s => s.expected), off = 30;
    const ons = exp.map((s, i) => s.t + off / 1000 + (i === 2 ? 0.1 : i === 3 ? -0.08 : i === 4 ? 0.035 : 0)).filter((_, i) => i !== 5);
    ons.push(S.slots[1].t + off / 1000); // a strum in the rest (step 2 of the worship pattern is '-')
    const vs = pocketVerdicts(ons.sort((a, b) => a - b), S.slots, S.plan.slotDur, off, 60);
    const e = vs.filter(v => v.expected);
    expect(e[0].ok && e[0].bonus === 2).toBe(true);
    expect(e[2].ok).toBe(false); expect(e[2].miss).toBe('late strums (over 60 ms behind)');
    expect(e[3].miss).toBe('early strums (over 60 ms ahead)');
    expect(e[4].ok).toBe(true); expect(e[4].bonus).toBeCloseTo(1.5);
    expect(e[5].miss).toBe('missed strums');
    expect(vs[1]).toMatchObject({ expected: false, counted: true, ok: false, miss: 'strums in the rests' });
    expect(vs.filter(v => !v.expected && v.slot !== 1).every(v => !v.counted)).toBe(true);
  });
  it('names the landing after a gap', () => {
    const S = pocketSetup(cat, { pattern: 'S1_quarters', bpm: 60, gap_bars: [2], click_bars: 1, window_ms: 60, bars: 4 }, 0);
    const ons = S.slots.map(s => s.t + (s.bar === 3 ? 0.07 : 0));
    const vs = pocketVerdicts(ons, S.slots, S.plan.slotDur, 0, 60, S.returnBars);
    expect(vs[12].miss).toBe('after the 2-bar gap: 70 ms late'); expect(vs[13].miss).toBe('late strums (over 60 ms behind)');
  });
});

describe('play mode: judging what you play (synthetic notes, real tracker + onsets)', () => {
  it('a right note answers; a wrong note and a wrong octave are misses; the starting note of Octave Jump is neutral', () => {
    const a = analyze(render([{ midi: 45, t: 0.3, dur: 0.7 }, { midi: 57, t: 1.2, dur: 0.7 }, { midi: 46, t: 2.1, dur: 0.7 }, { midi: 69, t: 3.0, dur: 0.7 }], 4), [45, 69]);
    const seen = new Set<number>();
    // Octave Jump: string 6 fret 5 (A2) → A3. A2 first (neutral), then A3 (right)
    expect(judgeAnswer(segsSince(a, 0.2, 1.1), { right: [57], neutral: [45], since: 0.2 }, 1.1, seen)).toBeNull();
    const h = judgeAnswer(segsSince(a, 0.2, 2.0), { right: [57], neutral: [45], since: 0.2 }, 2.0, seen);
    expect(h).toMatchObject({ kind: 'right', midi: 57 });
    // next question asked at 2.0: A# is wrong; A4 is the right note in the wrong octave
    const s2 = new Set<number>();
    expect(judgeAnswer(segsSince(a, 2.0, 2.9), { right: [57], since: 2.0 }, 2.9, s2)).toMatchObject({ kind: 'wrong', heard: 'A#2', why: 'wrong' });
    expect(judgeAnswer(segsSince(a, 2.0, 3.9), { right: [57], since: 2.0 }, 3.9, s2)).toMatchObject({ kind: 'wrong', heard: 'A4', why: 'octave' });
    expect(judgeAnswer(segsSince(a, 2.0, 3.95), { right: [57], since: 2.0 }, 3.95, s2)).toBeNull(); // each note decided once
  });
  it('a note still ringing from the last answer is ignored; silence decides nothing', () => {
    const a = analyze(render([{ midi: 52, t: 0.2, dur: 1.5 }], 2.2), [52]);
    expect(judgeAnswer(segsSince(a, 0.6, 2.1), { right: [55], since: 0.6 }, 2.1, new Set())).toBeNull();
    const q = analyze(render([], 1), [52]);
    expect(judgeAnswer(segsSince(q, 0), { right: [52], since: 0 }, 1, new Set())).toBeNull();
  });
  it('decides quickly: a right note is heard within ~0.2 s of the pick', () => {
    const a = analyze(render([{ midi: 50, t: 0.3, dur: 0.8 }], 1.2), [50]);
    const cut = (t: number) => ({ frames: a.frames.filter(f => f.t <= t), onsets: a.onsets.filter(o => o <= t) });
    let at = -1;
    for (let t = 0.3; t < 1; t += 0.02) if (judgeAnswer(segsSince(cut(t), 0.1), { right: [50], since: 0.1 }, t, new Set())?.kind === 'right') { at = t; break; }
    expect(at).toBeGreaterThan(0.3); expect(at - 0.3).toBeLessThan(0.25);
  });
  it('Box Runner notes: on time and right; wrong pitch; right note but late; nothing played', () => {
    const sp = 0.375, ts = [0.5, 0.875, 1.25, 1.625], tol = boxWindowS(sp);
    const a = analyze(render([{ midi: 43, t: 0.52, dur: 0.35 }, { midi: 46, t: 0.88, dur: 0.35 }, { midi: 47, t: 1.25 + 0.2, dur: 0.3 }], 2.2), [43, 50]);
    const segs = segmentNotes(a.frames, a.onsets);
    const pos: Pos = { string: 6, fret: 3 };
    const v = ts.map((t, i) => gradeTimedNote(segs, { t, midi: [43, 45, 47, 50][i], pos }, tol, 0));
    expect(v[0].ok).toBe(true); expect(Math.abs(v[0].offMs!)).toBeLessThan(40);
    expect(v[1]).toMatchObject({ ok: false, heard: 'A#2', why: 'wrong' });
    expect(v[2]).toMatchObject({ ok: false, why: 'late' });
    expect(v[3]).toMatchObject({ ok: false, why: 'silent', heard: null });
  });
});

// A run of questions answered the way a player does: each note picked ~0.35 s after the last answer, so the last
// note is still ringing (mixtures make YIN misread: subharmonics, the louder old note, stray onsets).
function session(seedN: number, trials: number, wrong: boolean) {
  let sd = seedN; const R = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const OFFS = [1, -1, 2, -2, 5, -5, 7, -7, 12, -12];
  let falseWrong = 0, uncredited = 0, falseRight = 0, answers = 0, caught = 0, plays = 0;
  for (let trial = 0; trial < trials; trial++) {
    const N = 12, out = new Float32Array(SR * 30);
    const tr = new PitchTracker(SR, trackerRange([40, 64])), det = new OnsetDetector(SR);
    const frames: PitchFrame[] = [], onsets: number[] = [];
    let k = 0, since = 0, seen = new Set<number>(), want = -1, prevM = -1, at = 0;
    const note = (m: number, t0: number) => {
      const f0 = 440 * 2 ** ((m - 69) / 12), amps = [1, 0.6, 0.35, 0.22, 0.12, 0.07], ph = amps.map(() => R() * 6.28), i0 = Math.round(t0 * SR);
      for (let i = 0; i < SR * 0.75 && i0 + i < out.length; i++) { const t = i / SR, env = Math.min(1, t / 0.004) * Math.exp(-t * 1.8) * (t > 0.7 ? Math.max(0, 1 - (t - 0.7) / 0.05) : 1);
        let v = 0; for (let h = 0; h < amps.length; h++) { ph[h] += 2 * Math.PI * f0 * (h + 1) / SR; v += amps[h] * Math.exp(-t * h * 0.9) * Math.sin(ph[h]); } out[i0 + i] += 0.25 * env * v; }
    };
    const ask = (now: number) => {
      do { want = 40 + Math.floor(R() * 25); } while (want === prevM);
      let m = want; if (wrong) do { m = want + OFFS[Math.floor(R() * OFFS.length)]; } while (m < 40 || m > 76);
      prevM = m; since = now; seen = new Set(); at = now + 0.35; note(m, at);
    };
    ask(0.2);
    for (let i = 0; i < out.length && k < N; i += 512) {
      const d = out.subarray(i, i + 512); det.push(d, i).forEach(f => onsets.push(f / SR)); frames.push(...tr.push(d, i));
      const now = (i + 512) / SR;
      if (i % 2880 >= 512) continue; // poll every 60 ms, like the game
      const h = judgeAnswer(segmentNotes(frames.filter(f => f.t >= since - 0.4), onsets.filter(o => o >= since - 0.4)), { right: [want], since }, now, seen);
      if (h) { answers++; plays++; if (wrong && h.kind === 'right') falseRight++; if (wrong && h.kind === 'wrong') caught++; if (!wrong && h.kind !== 'right') falseWrong++; k++; ask(now); }
      else if (now - at > (wrong ? 1.5 : 2.5)) { plays++; if (!wrong) uncredited++; k++; ask(now); }
    }
  }
  return { falseWrong, uncredited, falseRight, answers, caught, plays };
}

describe('play mode under realistic overlap (each note picked while the last still rings)', () => {
  it('right notes: no false "wrong", nearly all credited', () => {
    const r = session(17, +(process.env.G2_TRIALS || 6), false);
    if (process.env.G2_TRIALS) console.log(r);
    expect(r.falseWrong).toBe(0); expect(r.uncredited).toBeLessThanOrEqual(Math.ceil(r.answers / 70));
  }, 120000);
  it('wrong notes (a semitone, a tone, a fourth, a fifth, an octave off) are never credited, and nearly all are caught', () => {
    const r = session(29, +(process.env.G2_TRIALS || 6), true);
    if (process.env.G2_TRIALS) console.log(r);
    expect(r.falseRight).toBe(0); expect(r.caught / r.plays).toBeGreaterThan(0.9);
  }, 120000);
});

describe('streak (07 §4): 5 minutes, service days, freezes', () => {
  const T = '2026-11-22';
  const run = (n: number, end: string, s = STREAK_MIN_S) => Array.from({ length: n }, (_, i) => ({ day: addDays(end, -i), active_s: s }));
  it('a day counts with ≥ 5 minutes; less doesn\'t; old rows without minutes still count', () => {
    expect(qualifies({ day: T, active_s: 299 }, false)).toBe(false); expect(qualifies({ day: T, active_s: 300 }, false)).toBe(true);
    expect(qualifies({ day: T }, false)).toBe(true); expect(qualifies(undefined, true)).toBe(true); expect(qualifies(undefined, false)).toBe(false);
    expect(computeStreak(run(3, T, 299), [], T).current).toBe(0);
    expect(computeStreak([{ day: addDays(T, -2) }, { day: addDays(T, -1) }, { day: T, active_s: 400 }], [], T).current).toBe(3);
  });
  it('today not done yet doesn\'t break the streak; "Played a service" counts on its own', () => {
    const r = computeStreak([...run(3, addDays(T, -1)), { day: T, active_s: 60 }], [], T);
    expect(r.current).toBe(3); expect(r.todayDone).toBe(false); expect(r.todayS).toBe(60);
    expect(computeStreak(run(3, addDays(T, -1)), [T], T)).toMatchObject({ current: 4, todayDone: true });
    expect(computeStreak([...run(2, addDays(T, -2))], [addDays(T, -1)], T).current).toBe(3);
  });
  it('one freeze per 7-day streak, at most 2; a freeze covers a missed day but doesn\'t add to the streak', () => {
    expect(computeStreak(run(6, T), [], T).freezes).toBe(0);
    expect(computeStreak(run(7, T), [], T).freezes).toBe(1);
    expect(computeStreak(run(21, T), [], T).freezes).toBe(2);              // capped at 2
    // 7 days, a miss, 2 more days: the freeze is used, the streak is 9
    const r = computeStreak([...run(2, T), ...run(7, addDays(T, -3))], [], T);
    expect(r).toMatchObject({ current: 9, freezes: 0, frozen: [addDays(T, -2)], longest: 9 });
    // 6 days and a miss: no freeze yet, so it breaks
    expect(computeStreak([...run(2, T), ...run(6, addDays(T, -3))], [], T).current).toBe(2);
    // two misses in a row with 2 freezes: both used
    const two = computeStreak([...run(1, T), ...run(14, addDays(T, -3))], [], T);
    expect(two).toMatchObject({ current: 15, freezes: 0 }); expect(two.frozen.length).toBe(2);
    // three misses with 2 freezes: broken
    expect(computeStreak([...run(1, T), ...run(14, addDays(T, -4))], [], T)).toMatchObject({ current: 1, longest: 14 });
  });
  it('the activity clock counts visible time you\'re using, or with audio running', () => {
    expect(counts({ visible: true, sinceInputMs: 5000, audio: false })).toBe(true);
    expect(counts({ visible: true, sinceInputMs: 120000, audio: false })).toBe(false);
    expect(counts({ visible: true, sinceInputMs: 120000, audio: true })).toBe(true);
    expect(counts({ visible: false, sinceInputMs: 0, audio: true })).toBe(false);
  });
});

describe('level unlocks and modes', () => {
  beforeEach(() => bests.set({ ready: true, map: {} }));
  const g = G('G_note_drop'), [l1, l2, l3] = g.levels;
  const best = (lv: string, mode: string, s: number) => ({ [bestKey(g.id, lv, mode)]: { key: bestKey(g.id, lv, mode), game_id: g.id, level_id: lv, mode, best_score: 1, best_stars: s, ghost: [], at: 0 } });
  it('level 1 open; next level opens with ★★ on the previous one, in either mode', () => {
    expect(unlocked(cat, g, l1)).toBe(true); expect(unlocked(cat, g, l2)).toBe(false);
    bests.set({ map: best('nd1', 'tap', 1) }); expect(unlocked(cat, g, l2)).toBe(false);
    bests.set({ map: best('nd1', 'play', 2) }); expect(unlocked(cat, g, l2)).toBe(true); expect(unlocked(cat, g, l3)).toBe(false);
    bests.set({ map: { ...best('nd1', 'tap', 3), ...best('nd1', 'play', 1) } }); expect(bestStars(g, l1)).toBe(3); expect(unlocked(cat, g, l2)).toBe(true);
  });
  it('tap and play bests are separate keys; each game remembers its mode', () => {
    expect(bestKey('G_x', 'a', 'tap')).not.toBe(bestKey('G_x', 'a', 'play'));
    expect(modeFor(g)).toBe('tap'); expect(modeFor(G('G_box_runner'))).toBe('play');
    setModeFor(g, 'play'); expect(['tap', 'play']).toContain(modeFor(g));
    setModeFor(G('G_box_runner'), 'tap'); expect(modeFor(G('G_box_runner'))).toBe('play');  // no tap mode there
  });
  it('games.json: G2 games have levels and the modes the doc gives them', () => {
    expect(G('G_note_drop').modes).toEqual(['tap', 'play']); expect(G('G_fret_finder').modes).toEqual(['tap', 'play']);
    expect(G('G_octave_jump').modes.sort()).toEqual(['play', 'tap']); expect(G('G_box_runner').modes).toEqual(['play']); expect(G('G_in_the_pocket').modes).toEqual(['play']);
    for (const id of ['G_octave_jump', 'G_box_runner', 'G_in_the_pocket']) { expect(G(id).milestone).toBe('G2'); expect(G(id).levels.length).toBeGreaterThanOrEqual(3); }
  });
});
