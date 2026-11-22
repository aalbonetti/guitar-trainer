// Pitch grader with synthetic guitar-like audio (sine + decaying harmonics), run through the same
// PitchTracker + spectral-flux OnsetDetector the app uses, in 512-sample blocks like the capture worklet.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { OnsetDetector } from '../src/dsp/dsp.js';
import {
  PitchTracker, segmentNotes, gradeNotes, verifySegment, HoldTracker, buildNotePlan, pitchSetup, expectedFromEvents, eventMidi,
  noteKind, noteTolerance, trackerRange, midiName, type PitchFrame, type Expected, type HoldTarget,
} from '../src/grading/pitch';

const SR = 48000;
const j = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const cat: any = { lessons: j('lessons.json'), exercises: j('exercises.json') };
const L = (id: string) => cat.lessons.find((l: any) => l.id === id);
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;

interface Note { midi: number; t: number; dur: number; cents?: number; gain?: number; vib?: number; vibHz?: number; bend?: number; bendAt?: number; bendDur?: number; attack?: number; amps?: number[]; decay?: number }
/** Mix notes into a buffer. Plucked notes decay; swells (attack > 50 ms) fade in and hold. */
function render(notes: Note[], len: number, extra?: (buf: Float32Array) => void): Float32Array {
  const out = new Float32Array(Math.ceil(len * SR));
  for (const n of notes) {
    const amps = n.amps || [1, 0.6, 0.35, 0.22, 0.12, 0.07], ph = amps.map(() => rnd() * 6);
    const i0 = Math.round(n.t * SR), N = Math.round(n.dur * SR), att = n.attack ?? 0.004, g = n.gain ?? 0.4, dec = n.decay ?? 1.5;
    const f0 = 440 * 2 ** ((n.midi - 69 + (n.cents || 0) / 100) / 12);
    for (let i = 0; i < N && i0 + i < out.length; i++) {
      const t = i / SR;
      let semis = 0;
      if (n.bend) semis += n.bend * Math.min(1, Math.max(0, (t - (n.bendAt ?? 0.1)) / (n.bendDur ?? 0.15)));
      if (n.vib) semis += (n.vib / 100) * Math.sin(2 * Math.PI * (n.vibHz || 5.5) * t);
      const f = f0 * 2 ** (semis / 12);
      const env = Math.min(1, t / att) * (att > 0.05 ? 1 : Math.exp(-t * dec)) * Math.min(1, (N - i) / (0.01 * SR));
      let v = 0;
      for (let h = 0; h < amps.length; h++) { if (f * (h + 1) > SR / 2.2) break; ph[h] += 2 * Math.PI * f * (h + 1) / SR; v += amps[h] * Math.exp(-t * h * 0.8) * Math.sin(ph[h]); }
      out[i0 + i] += g * env * v * 0.5;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += rnd() * 0.0006; // a little room noise
  extra?.(out);
  return out;
}
/** Click bleed: 2 kHz / 2.6 kHz bursts like the engine's click, arriving `lat` s after each click. */
const bleed = (clicks: { t: number; kind: number }[], lat = 0.09, gain = 0.25) => (buf: Float32Array) => {
  for (const c of clicks) { const i0 = Math.round((c.t + lat) * SR), f = c.kind === 0 ? 2600 : 2000;
    for (let i = 0; i < 0.06 * SR && i0 + i < buf.length; i++) { const t = i / SR; buf[i0 + i] += gain * Math.min(1, t / 0.002) * Math.exp(-(t - 0.002) / 0.006) * Math.sin(2 * Math.PI * f * t); } }
};
/** Run audio through the tracker + onset detector exactly like the runner. */
function analyze(buf: Float32Array, midis: number[], isNearClick?: (t0: number, t1: number) => boolean) {
  const tr = new PitchTracker(SR, trackerRange(midis)); tr.isNearClick = isNearClick || null;
  const det = new OnsetDetector(SR);
  const frames: PitchFrame[] = [], onsets: number[] = [];
  for (let i = 0; i < buf.length; i += 512) {
    const d = buf.subarray(i, Math.min(buf.length, i + 512));
    frames.push(...tr.push(d, i)); det.push(d, i).forEach(f => onsets.push(f / SR));
  }
  return { frames, onsets };
}
const settledCents = (frames: PitchFrame[], midi: number, from: number, to: number) => frames.filter(f => f.t > from && f.t < to && f.midi !== null).map(f => (f.midi! - midi) * 100);

describe('tracker (YIN from the engine DSP)', () => {
  it('reads plucked-style notes E2–E6 within ±2 cents', () => {
    let worst = 0;
    for (const m of [40, 45, 50, 55, 59, 64, 69, 76, 83, 88]) {
      const { frames } = analyze(render([{ midi: m, t: 0.05, dur: 1.2 }], 1.3), [m]);
      const c = settledCents(frames, m, 0.2, 1.0);
      expect(c.length).toBeGreaterThan(20);
      const med = c.sort((a, b) => a - b)[Math.floor(c.length / 2)];
      worst = Math.max(worst, Math.abs(med));
    }
    expect(worst).toBeLessThan(2);
  });
  it('hears a 3-cent detune as 3 cents', () => {
    const { frames } = analyze(render([{ midi: 57, t: 0.05, dur: 1, cents: 3 }], 1.1), [57]);
    const c = settledCents(frames, 57, 0.2, 0.9).sort((a, b) => a - b);
    expect(Math.abs(c[Math.floor(c.length / 2)] - 3)).toBeLessThan(1);
  });
});

describe('lesson setup', () => {
  it('all six pitch lessons have something to verify against', () => {
    const s = (id: string) => pitchSetup(L(id), cat);
    expect(s('F.02').mode).toBe('hold'); expect(s('F.02').targets.map(t => t.label)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    expect(s('EL.05').mode).toBe('hold'); expect(s('EL.05').targets.map(t => t.label)).toEqual(['A3 → B3', 'D4 → E4', 'B3 → C4']);
    expect(s('EL.04').mode).toBe('timed'); expect(s('EL.04').expected).toHaveLength(8); expect(noteKind(s('EL.04').expected[0])).toBe('octave');
    expect(s('EL.06').mode).toBe('free'); expect(s('EL.06').dyads).toBe(true); expect(s('EL.06').expected[0].label).toBe('G3+E4');
    expect(s('EL.07').mode).toBe('timed'); expect(s('EL.07').meter).toBe('3/4'); expect(s('EL.07').expected.map(e => e.label).join(' ')).toBe('D3 G3 B3 G3 B3 A3 G3 E3 D3 D3 G3 B3 G3 B3 A3 D4');
    expect(s('EL.11').mode).toBe('free'); expect(s('EL.11').expected.map(e => e.label).slice(0, 3)).toEqual(['G4', 'B4', 'E5']);
    expect(eventMidi({ beat: 0, string: 1, fret: 5, dur: 1, tech: 'harmonic' })).toBe(88);
  });
  it('a timed plan has one bar of count-in and expected notes on the beat', () => {
    const p = buildNotePlan(pitchSetup(L('EL.07'), cat).expected, 80, 3, 10);
    expect(p.countIn).toHaveLength(3); expect(p.clicks).toHaveLength(3 + 24);
    expect(p.expected[0].t).toBeCloseTo(10 + 2.25 + 1.5); // pickup on beat 3 of bar 1
    expect(noteTolerance(0.75)).toBeCloseTo(0.375); expect(noteTolerance(2)).toBe(0.45);
  });
});

/** Play an exercise (expected notes in beats) at `bpm`, starting at `t0`, with optional changes per note. */
function playExercise(exp: Expected[], bpm: number, t0: number, change: (e: Expected, i: number) => Partial<Note>[] | null = () => null, latency = 0.12) {
  const beat = 60 / bpm, notes: Note[] = [];
  exp.forEach((e, i) => {
    const mods = change(e, i);
    const base = e.midis.map(m => ({ midi: m, t: t0 + e.t * beat + latency + rnd() * 0.02, dur: Math.max(0.2, e.dur * beat - 0.02), gain: 0.35 }));
    if (mods === null) notes.push(...base); else mods.forEach((m, k) => notes.push({ ...base[Math.min(k, base.length - 1)], ...m }));
  });
  return notes;
}

describe('note_accuracy, timed (EL.04 octaves at 100 BPM, with click bleed)', () => {
  const setup = pitchSetup(L('EL.04'), cat), bpm = 100;
  const plan = buildNotePlan(setup.expected, bpm, 4, 0.5);
  const midis = setup.expected.flatMap(e => e.midis);
  const near = (t0: number, t1: number) => plan.clicks.some(c => c.t + 0.09 >= t0 - 0.03 && c.t + 0.09 <= t1 + 0.005);
  const run = (change?: Parameters<typeof playExercise>[3]) => {
    const notes = playExercise(setup.expected, bpm, plan.start, change);
    const { frames, onsets } = analyze(render(notes, plan.end + 1, bleed(plan.clicks)), midis, near);
    return gradeNotes(segmentNotes(frames, onsets), plan.expected, { target: 0.9, timed: true, tolS: noteTolerance(plan.beat), offsetS: 0.12 });
  };
  it('right notes pass, 8/8', () => {
    const g = run(); expect(g.matched).toBe(8); expect(g.met).toBe(true); expect(g.great).toBe(true);
    expect(Math.abs(g.meanOffMs!)).toBeLessThan(40);
  });
  it('two wrong notes (a fret off) fail and show what was heard', () => {
    const g = run((e, i) => (i === 2 || i === 5 ? e.midis.map(m => ({ midi: m + 1 })) : null));
    expect(g.matched).toBe(6); expect(g.met).toBe(false);
    expect(g.notes[2].ok).toBe(false); expect(g.notes[2].heard).toBe(midiName(setup.expected[2].midis[0] + 1));
  });
  it('only the high note of an octave shape does not count; the low note alone does (the high one is its harmonic)', () => {
    const g = run((e, i) => (i === 3 ? [{ midi: e.midis[1] }] : i === 4 ? [{ midi: e.midis[0] }] : null));
    expect(g.notes[3].ok).toBe(false); expect(g.notes[3].why).toBe('octave');
    expect(g.notes[4].ok).toBe(true);
  });
  it('playing late by a beat misses the notes', () => {
    const late = playExercise(setup.expected, bpm, plan.start + plan.beat);
    const { frames, onsets } = analyze(render(late, plan.end + 1.5, bleed(plan.clicks)), midis, near);
    const g2 = gradeNotes(segmentNotes(frames, onsets), plan.expected, { target: 0.9, timed: true, tolS: noteTolerance(plan.beat), offsetS: 0.12 });
    expect(g2.matched).toBeLessThan(3);
  });
});

describe('octave handling for single notes', () => {
  const exp: Expected[] = [55, 57, 59, 60].map((m, i) => ({ t: i, dur: 0.5, midis: [m], label: midiName(m), where: '' }));
  const grade = (notes: Note[], anyOctave: boolean) => {
    const { frames, onsets } = analyze(render(notes, 3), [55, 60]);
    return gradeNotes(segmentNotes(frames, onsets), exp, { target: 0.9, timed: false, anyOctave });
  };
  const notes = (shift: (i: number) => number) => exp.map((e, i) => ({ midi: e.midis[0] + shift(i), t: 0.1 + i * 0.6, dur: 0.55 }));
  it('exact octave by default: an octave too high is wrong', () => {
    const g = grade(notes(i => (i === 1 ? 12 : 0)), false);
    expect(g.notes.map(n => n.ok)).toEqual([true, false, true, true]); expect(g.notes[1].why).toBe('octave');
  });
  it('any_octave lessons accept it', () => {
    expect(grade(notes(i => (i === 1 ? 12 : 0)), true).matched).toBe(4);
    expect(grade(notes(() => -12), true).matched).toBe(4);
  });
  it('a YIN octave slip (strong 2nd harmonic) still counts as the expected note', () => {
    const slip: Note[] = exp.map((e, i) => ({ midi: e.midis[0], t: 0.1 + i * 0.6, dur: 0.55, amps: [0.12, 1, 0.12, 0.5, 0.05, 0.2] }));
    const { frames, onsets } = analyze(render(slip, 3), [55, 60]);
    const segs = segmentNotes(frames, onsets);
    expect(gradeNotes(segs, exp, { target: 0.9, timed: false }).matched).toBe(4);
  });
});

describe('sustain, slides and swells', () => {
  it('a note still ringing under the next one does not confuse the order', () => {
    const exp = [64, 67, 69, 71].map((m, i) => ({ t: i, dur: 0.4, midis: [m], label: midiName(m), where: '' }));
    const notes = exp.map((e, i) => ({ midi: e.midis[0], t: 0.1 + i * 0.4, dur: 2.0 - i * 0.4, decay: 0.6, gain: 0.35 })); // let ring
    const { frames, onsets } = analyze(render(notes, 2.3), [64, 71]);
    expect(gradeNotes(segmentNotes(frames, onsets), exp, { target: 0.9, timed: false }).matched).toBe(4);
  });
  it('…but a wrong note played while another rings is still wrong', () => {
    const exp = [64, 67, 69, 71].map((m, i) => ({ t: i, dur: 0.4, midis: [m], label: midiName(m), where: '' }));
    const notes = [64, 66, 69, 71].map((m, i) => ({ midi: m, t: 0.1 + i * 0.4, dur: 2.0 - i * 0.4, decay: 0.6, gain: 0.35 }));
    const { frames, onsets } = analyze(render(notes, 2.3), [64, 71]);
    const g = gradeNotes(segmentNotes(frames, onsets), exp, { target: 0.9, timed: false });
    expect(g.notes.map(n => n.ok)).toEqual([true, false, true, true]);
  });
  it('legato pitch changes (slides, no new attack) split into notes', () => {
    const exp = [62, 64, 67].map((m, i) => ({ t: i, dur: 0.4, midis: [m], label: midiName(m), where: '' }));
    const buf = render([{ midi: 62, t: 0.1, dur: 0.5, decay: 0.3 }, { midi: 64, t: 0.6, dur: 0.5, attack: 0.002, decay: 0.3, gain: 0.25 }, { midi: 67, t: 1.1, dur: 0.6, attack: 0.002, decay: 0.3, gain: 0.25 }], 1.9);
    const { frames } = analyze(buf, [62, 67]);
    expect(gradeNotes(segmentNotes(frames, []), exp, { target: 0.9, timed: false }).matched).toBe(3); // no onsets at all
  });
  it('EL.11: harmonics and volume swells (no pick attack) at your own pace', () => {
    const s = pitchSetup(L('EL.11'), cat);
    let t = 0.2; const notes: Note[] = [];
    for (const e of s.expected) {
      const sw = e.tech === 'swell';
      notes.push({ midi: e.midis[0], t, dur: sw ? 1.4 : 1.0, attack: sw ? 0.5 : 0.003, amps: sw ? undefined : [1, 0.08], gain: sw ? 0.3 : 0.15 });
      t += sw ? 1.7 : 1.2;
    }
    const { frames, onsets } = analyze(render(notes, t + 0.5), s.expected.flatMap(e => e.midis));
    const g = gradeNotes(segmentNotes(frames, onsets), s.expected, { target: 0.9, timed: false });
    expect(g.matched).toBe(12); expect(g.met).toBe(true);
  });
});

describe('double stops (EL.06, spectral check of both notes)', () => {
  const s = pitchSetup(L('EL.06'), cat);
  const play = (change: (i: number, m: number[]) => number[]) => {
    const notes: Note[] = [];
    s.expected.forEach((e, i) => change(i, e.midis).forEach(m => notes.push({ midi: m, t: 0.2 + i * 0.9, dur: 0.8, gain: 0.3 })));
    const { frames, onsets } = analyze(render(notes, 0.2 + s.expected.length * 0.9 + 0.4), s.expected.flatMap(e => e.midis));
    return gradeNotes(segmentNotes(frames, onsets), s.expected, { target: 0.9, timed: false });
  };
  it('all eight 6ths right', () => { const g = play((_, m) => m); expect(g.matched).toBe(8); expect(g.met).toBe(true); });
  it('one note missing, one a fret off, one with an extra string: those three fail', () => {
    const g = play((i, m) => (i === 1 ? [m[0]] : i === 4 ? [m[0], m[1] + 1] : i === 6 ? [...m, m[0] + 4] : m));
    expect(g.notes.map(n => n.ok)).toEqual([true, false, true, true, false, true, false, true]);
    expect(g.notes[1].why).toBe('missing'); expect(g.met).toBe(false);
  });
});

describe('cents: holding a target', () => {
  const hold = (target: HoldTarget, cents: number, notes: Note[], len: number) => {
    const { frames, onsets } = analyze(render(notes, len), [target.midi, target.from ?? target.midi]);
    const h = new HoldTracker(target, cents); let doneAt: number | null = null, oi = 0;
    for (const f of frames) { let on = false; while (oi < onsets.length && onsets[oi] <= f.t) { on = true; oi++; } const st = h.push(f, on); if (st.done && doneAt === null) doneAt = f.t; }
    return doneAt;
  };
  const E2: HoldTarget = { midi: 40, label: 'E2', where: '', octaveSlack: true };
  it('F.02: an open string 2 cents off passes ±5; 9 cents off does not', () => {
    expect(hold(E2, 5, [{ midi: 40, cents: 2, t: 0.1, dur: 2, decay: 0.5 }], 2.2)).not.toBeNull();
    expect(hold(E2, 5, [{ midi: 40, cents: 9, t: 0.1, dur: 2, decay: 0.5 }], 2.2)).toBeNull();
  });
  it('F.02: a reading an octave up (phone mics on low strings) still tunes', () => {
    expect(hold(E2, 5, [{ midi: 52, cents: -1, t: 0.1, dur: 2, decay: 0.5 }], 2.2)).not.toBeNull();
  });
  it('takes at least half a second of holding', () => {
    const at = hold(E2, 5, [{ midi: 40, t: 0.1, dur: 2, decay: 0.5 }], 2.2)!;
    expect(at).toBeGreaterThan(0.1 + 0.47); // frames are 21 ms apart; their windows cover ≥ 0.5 s
  });
  const bend: HoldTarget = { midi: 59, from: 57, label: 'A3 → B3', where: '', octaveSlack: false };
  it('EL.05: a whole-step bend that lands in tune and holds passes, with vibrato too', () => {
    expect(hold(bend, 15, [{ midi: 57, bend: 2, bendAt: 0.15, bendDur: 0.2, t: 0.1, dur: 1.6, decay: 0.4 }], 1.9)).not.toBeNull();
    expect(hold(bend, 15, [{ midi: 57, bend: 2, vib: 20, vibHz: 5.5, bendAt: 0.15, bendDur: 0.2, t: 0.1, dur: 1.6, decay: 0.4 }], 1.9)).not.toBeNull();
  });
  it('EL.05: a half-step bend (B3 → C4) passes; picking the target fresh after the start note does not', () => {
    const half: HoldTarget = { midi: 60, from: 59, label: 'B3 → C4', where: '', octaveSlack: false };
    expect(hold(half, 15, [{ midi: 59, bend: 1, bendAt: 0.15, bendDur: 0.2, t: 0.1, dur: 1.6, decay: 0.4 }], 1.9)).not.toBeNull();
    expect(hold(half, 15, [{ midi: 59, bend: 1, bendAt: 0.12, bendDur: 0.08, t: 0.1, dur: 1.6, decay: 0.4 }], 1.9)).not.toBeNull(); // a fast bend
    expect(hold(half, 15, [{ midi: 59, t: 0.1, dur: 0.4, decay: 0.4 }, { midi: 60, t: 0.5, dur: 1.4, decay: 0.4 }], 1.9)).toBeNull();
  });
  it('EL.05: under-bent by 30 cents fails; fretting the target without bending fails; a slow sweep through fails', () => {
    expect(hold(bend, 15, [{ midi: 57, bend: 1.7, bendAt: 0.15, bendDur: 0.2, t: 0.1, dur: 1.6, decay: 0.4 }], 1.9)).toBeNull();
    expect(hold(bend, 15, [{ midi: 59, t: 0.1, dur: 1.6, decay: 0.4 }], 1.9)).toBeNull();
    expect(hold(bend, 15, [{ midi: 57, bend: 3, bendAt: 0.1, bendDur: 2.4, t: 0.1, dur: 2.6, decay: 0.3 }], 2.9)).toBeNull();
  });
  it('an onset fired mid-bend (flux sees the glide) does not reset the bend; a fresh pick does', () => {
    const half: HoldTarget = { midi: 60, from: 59, label: 'B3 → C4', where: '', octaveSlack: false };
    const fr = (t: number, midi: number): PitchFrame => ({ t, rms: 0.1, midi, clarity: 0.95, peaks: [], click: false });
    const glide = Array.from({ length: 60 }, (_, i) => fr(i * 0.021, i < 8 ? 59 : Math.min(60, 59 + (i - 8) * 0.1)));
    let h = new HoldTracker(half, 15); expect(glide.map((f, i) => h.push(f, i === 0 || i === 15).done).some(Boolean)).toBe(true);
    const jump = Array.from({ length: 60 }, (_, i) => fr(i * 0.021, i < 8 ? 59 : 60));
    h = new HoldTracker(half, 15); expect(jump.map((f, i) => h.push(f, i === 0 || i === 8).done).some(Boolean)).toBe(false);
  });
  it('vibrato centred off the target by 25 cents fails ±15', () => {
    expect(hold({ midi: 62, label: 'D4', where: '', octaveSlack: false }, 15, [{ midi: 62, cents: 25, vib: 20, t: 0.1, dur: 1.6, decay: 0.4 }], 1.9)).toBeNull();
  });
});

describe('segments and verify (unit)', () => {
  const fr = (t: number, midi: number | null, rms = 0.05): PitchFrame => ({ t, rms, midi, clarity: midi === null ? 0 : 0.95, peaks: midi === null ? [] : [{ f: 440 * 2 ** ((midi - 69) / 12), db: 0 }], click: false });
  it('click-flagged frames are ignored', () => {
    const frames = [...Array.from({ length: 20 }, (_, i) => fr(i * 0.02, 60)), ...Array.from({ length: 20 }, (_, i) => ({ ...fr(0.4 + i * 0.02, 70), click: i % 4 === 0 }))];
    const segs = segmentNotes(frames, []);
    expect(segs.map(s => Math.round(s.midi!))).toEqual([60, 70]);
    expect(segs[1].frames.every(f => !f.click)).toBe(true);
  });
  it('verify: exact, wrong, octave', () => {
    const seg = (m: number) => segmentNotes(Array.from({ length: 10 }, (_, i) => fr(i * 0.02, m)), [])[0];
    expect(verifySegment(seg(60), { midis: [60] }).ok).toBe(true);
    expect(verifySegment(seg(61), { midis: [60] })).toMatchObject({ ok: false, why: 'wrong', heard: 'C#4' });
    expect(verifySegment(seg(72), { midis: [60] })).toMatchObject({ ok: false, why: 'octave' });
    expect(verifySegment(seg(72), { midis: [60] }, true).ok).toBe(true);
  });
  it('expected events group simultaneous notes', () => {
    const e = expectedFromEvents([{ beat: 0, string: 3, fret: 0, dur: 1 }, { beat: 0, string: 1, fret: 0, dur: 1 }, { beat: 1, string: 2, fret: 3, dur: 1, tech: 'bend', bend: 2 }]);
    expect(e.map(x => x.midis)).toEqual([[55, 64], [64]]);
  });
});
