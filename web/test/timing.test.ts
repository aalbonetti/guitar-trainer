import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { lessonFeel, buildPlan, gradeTiming, ladderStart, ladderStep, calibrationOffset, bleedDelay, type Plan } from '../src/grading/timing';
import { OnsetDetector } from '../src/dsp/dsp.js';

const j = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const rhythm = j('rhythm.json');
const cat: any = { lessons: j('lessons.json'), strums: rhythm.strumming, picking: rhythm.picking, exercises: j('exercises.json') };
const L = (id: string) => cat.lessons.find((l: any) => l.id === id);
// deterministic jitter
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const play = (plan: Plan, latency: number, jitterMs: number, every = false) => plan.slots.filter(s => every || s.expected).map(s => s.t + latency + rnd() * 2 * jitterMs / 1000);

describe('lesson feel', () => {
  it('uses the strum pattern when its grid matches, with rests', () => {
    const f = lessonFeel(L('A.06'), cat);
    expect(f.patternId).toBe('S3_worship'); expect([f.beats, f.sub]).toEqual([4, 2]);
    expect(f.steps!.filter(s => s === '-').length).toBe(2);
  });
  it('waltz is 3 beats of eighths; 16ths are 4 per beat; exercises expect every slot', () => {
    expect([lessonFeel(L('A.07'), cat).beats, lessonFeel(L('A.07'), cat).sub]).toEqual([3, 2]);
    expect(lessonFeel(L('ER.10'), cat).sub).toBe(4);
    const sp = lessonFeel(L('F.05'), cat); expect(sp.steps).toBeNull(); expect(sp.sub).toBe(2);
    expect(lessonFeel(L('A.10'), cat).patternId).toBe('P2_pima');
  });
  it('every timing lesson builds a plan with the right number of slots', () => {
    for (const l of cat.lessons.filter((l: any) => l.pass_criteria.type === 'timing')) {
      const f = lessonFeel(l, cat), p = buildPlan(f, l.pass_criteria.bpm, l.pass_criteria.bars, 1);
      expect(p.slots.length).toBe(l.pass_criteria.bars * f.grid);
      expect(p.clicks.length).toBe(f.beats * (l.pass_criteria.bars + 1));
    }
  });
});

describe('timing grade', () => {
  const l = L('A.05'), f = lessonFeel(l, cat), plan = buildPlan(f, 80, 8, 2);
  it('passes tight playing once the calibrated offset is removed', () => {
    const r = gradeTiming(play(plan, 0.14, 15), plan, 140, 40);
    expect(r.met).toBe(true); expect(r.maeMs).toBeLessThan(10); expect(r.hits).toBe(64);
  });
  it('fails without calibration when latency is large, and reports dragging', () => {
    const r = gradeTiming(play(plan, 0.14, 5), plan, 0, 40);
    expect(r.met).toBe(false);
  });
  it('sloppy when a third of the strums are missing', () => {
    const on = play(plan, 0, 5).filter((_, i) => i % 3 !== 0);
    const r = gradeTiming(on, plan, 0, 40);
    expect(r.met).toBe(false); expect(r.sloppy).toBe(true);
  });
  it('strumming through the rests of the worship pattern costs slots', () => {
    const p2 = buildPlan(lessonFeel(L('A.06'), cat), 90, 8, 2);
    expect(gradeTiming(play(p2, 0, 8), p2, 0, 40).met).toBe(true);
    const r = gradeTiming(play(p2, 0, 8, true), p2, 0, 40);
    expect(r.extras).toBe(16); expect(r.met).toBe(false);
  });
  it('a steady 25 ms drag passes at 40 ms but fails at 20 ms', () => {
    const on = play(plan, 0.025, 2);
    expect(gradeTiming(on, plan, 0, 40).met).toBe(true);
    const r = gradeTiming(on, plan, 0, 20); expect(r.met).toBe(false); expect(r.biasMs).toBeGreaterThan(20);
  });
});

describe('tempo ladder', () => {
  const clean = { clean: true, sloppy: false }, sloppy = { clean: false, sloppy: true }, mid = { clean: false, sloppy: false };
  it('starts at 65%, climbs 4 after 3 clean, capped at target', () => {
    let l = ladderStart(80); expect(l.bpm).toBe(52);
    l = ladderStep(ladderStep(l, 80, clean), 80, clean); expect(l.bpm).toBe(52);
    l = ladderStep(l, 80, clean); expect(l.bpm).toBe(56);
    l = { bpm: 78, clean: 2, sloppy: 0 }; expect(ladderStep(l, 80, clean).bpm).toBe(80);
  });
  it('drops 8 after 2 sloppy (floor 50%); in-between resets the streaks', () => {
    let l = { bpm: 46, clean: 0, sloppy: 0 };
    l = ladderStep(ladderStep(l, 80, sloppy), 80, sloppy); expect(l.bpm).toBe(40);
    l = ladderStep(ladderStep({ bpm: 60, clean: 2, sloppy: 0 }, 80, mid), 80, clean); expect(l.bpm).toBe(60); expect(l.clean).toBe(1);
  });
});

describe('calibration', () => {
  it('finds the strum offset from 16 muted strums', () => {
    const clicks = Array.from({ length: 16 }, (_, i) => 3 + i * 0.75);
    const c = calibrationOffset(clicks.map(t => t + 0.12 + rnd() * 0.02), clicks)!;
    expect(Math.abs(c.offsetMs - 120)).toBeLessThan(6); expect(c.matched).toBe(16);
    expect(calibrationOffset(clicks.slice(0, 5), clicks)).toBeNull();
  });
  it('reads click-bleed delay from the count-in', () => {
    const clicks = [1, 1.75, 2.5, 3.25];
    expect(bleedDelay(clicks.map(t => t + 0.09), clicks)).toBeCloseTo(0.09, 5);
    expect(bleedDelay([], clicks)).toBeNull();
  });
});

describe('full DSP path on synthetic audio', () => {
  // Plucked-string strums rendered at 48 kHz, through the real onset detector, then graded.
  const sr = 48000;
  function render(times: number[], dur: number) {
    const x = new Float32Array(Math.ceil(dur * sr));
    for (const t of times) for (const [ni, m] of [43, 47, 50, 55, 59, 67].entries()) {
      const f = 440 * 2 ** ((m - 69) / 12), s0 = Math.round((t + ni * 0.004) * sr);
      for (let i = 0; i < sr * 0.5 && s0 + i < x.length; i++) x[s0 + i] += 0.12 * Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / (sr * 0.12)) * (i < 48 ? i / 48 : 1);
    }
    for (let i = 0; i < x.length; i++) x[i] += (Math.random() - 0.5) * 0.002;
    return x;
  }
  const detect = (x: Float32Array) => { const det = new OnsetDetector(sr), on: number[] = []; for (let i = 0; i < x.length; i += 512) det.push(x.subarray(i, i + 512), i).forEach(fr => on.push(fr / sr)); return on; };
  it('calibrate on 16 muted strums, then eighths at 80 BPM with 140 ms latency grade under 15 ms', () => {
    const clicks = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.75);
    const cal = calibrationOffset(detect(render(clicks.map(t => t + 0.14 + rnd() * 0.01), 13)), clicks)!;
    expect(cal.matched).toBe(16);
    const plan = buildPlan(lessonFeel(L('A.05'), cat), 80, 8, 0.5);
    const g = gradeTiming(detect(render(play(plan, 0.14, 10), plan.end + 1)), plan, cal.offsetMs, 40);
    expect(g.met).toBe(true); expect(g.maeMs).toBeLessThan(15); expect(g.hitRatio).toBeGreaterThan(0.95);
  });
});
