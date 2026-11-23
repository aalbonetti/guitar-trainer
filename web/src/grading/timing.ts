// Timing grader (06-app-spec.md §5–§6). Pure functions: no audio, no DOM, so they're unit-tested.
// The app always knows what you're supposed to play: a grid of slots, each either a strum/note
// (expected) or a rest. Onsets are matched to the nearest slot within half a slot.
import { matchOnsets, mean, median, std } from '../dsp/dsp.js';
import type { Catalog, Lesson, Strum, Picking } from '../catalog';

export interface TimingCriteria { bpm: number; subdivision: number; max_err_ms: number; bars: number }
export interface Feel { beats: number; sub: number; grid: number; steps: string[] | null; patternId: string | null; patternName: string | null; meter: string }
export interface Slot { t: number; expected: boolean; step: string; accent: boolean }
export interface Plan { bpm: number; beat: number; slotDur: number; countIn: number[]; clicks: { t: number; kind: 0 | 1 | 2 }[]; slots: Slot[]; end: number }
export interface SlotResult { t: number; expected: boolean; step: string; onset: number | null; errMs: number | null }
export interface TimingResult {
  maeMs: number; biasMs: number; spreadMs: number;
  hitRatio: number;         // expected slots that got a strum
  slotsRight: number;       // all slots right: expected played + rests left empty
  extras: number;           // strums in rest slots
  expected: number; hits: number; onsets: number;
  met: boolean; clean: boolean; sloppy: boolean;
  great: boolean;           // well inside the target: the ladder jumps instead of waiting for 3 in a row
  slots: SlotResult[];
}

const PER_BEAT: Record<string, number> = { '4/4': 4, '3/4': 3, '6/8': 2, '2/4': 2 };

/** Which pattern to grade and how the click counts it. A pattern is used only if its grid matches the
 *  lesson's subdivision; otherwise every subdivision slot is expected (exercises, scales, picking runs). */
export function lessonFeel(l: Lesson, cat: Catalog): Feel {
  const p = l.pass_criteria as unknown as TimingCriteria;
  const ids = [...(l.assets.rhythm || []), ...(l.assets.picking || [])];
  const pats: (Strum | Picking)[] = ids.map(id => cat.strums.find(s => s.id === id) || cat.picking.find(s => s.id === id)).filter((x): x is Strum | Picking => !!x);
  const pat = pats.find(x => x.grid === p.subdivision);
  if (pat) return patternFeel(pat);
  const beats = p.subdivision === 6 ? 3 : 4;
  return { beats, sub: p.subdivision / beats, grid: p.subdivision, steps: null, patternId: null, patternName: null, meter: beats === 3 ? '3/4' : '4/4' };
}
/** How the click counts a strum or picking pattern, and which of its steps are played (also used by In the Pocket). */
export function patternFeel(pat: Strum | Picking): Feel {
  const beats = PER_BEAT[pat.meter] || 4, sub = pat.grid / beats;
  // strum steps are D/U/X/- ; a picking step is an object (every one is played)
  const steps = (pat.steps as unknown[]).map(s => (typeof s === 'string' ? s : 'N'));
  return { beats, sub, grid: pat.grid, steps, patternId: pat.id, patternName: pat.name || pat.id, meter: pat.meter };
}

/** Click and slot times for one attempt starting (first count-in click) at context time `t0`. One bar of count-in. */
export function buildPlan(feel: Feel, bpm: number, bars: number, t0: number, accents: number[] = []): Plan {
  const beat = 60 / bpm, slotDur = beat / feel.sub, start = t0 + feel.beats * beat;
  const countIn = Array.from({ length: feel.beats }, (_, i) => t0 + i * beat);
  const clicks: Plan['clicks'] = countIn.map((t, i) => ({ t, kind: i === 0 ? 0 : 1 }));
  for (let b = 0; b < bars * feel.beats; b++) clicks.push({ t: start + b * beat, kind: b % feel.beats === 0 ? 0 : 1 });
  const slots: Slot[] = [];
  for (let i = 0; i < bars * feel.grid; i++) {
    const step = feel.steps ? feel.steps[i % feel.grid] : 'N';
    slots.push({ t: start + i * slotDur, expected: step !== '-', step, accent: accents.includes(i % feel.grid) });
  }
  return { bpm, beat, slotDur, countIn, clicks, slots, end: start + bars * feel.beats * beat };
}

/** Grade onsets (context seconds) against the plan. `offsetMs` (from strum calibration) is subtracted first. */
export function gradeTiming(onsets: number[], plan: Plan, offsetMs: number, maxErrMs: number): TimingResult {
  const off = offsetMs / 1000;
  const adj = onsets.map(o => o - off).filter(o => o > plan.slots[0].t - plan.slotDur / 2 && o < plan.end + plan.slotDur / 2);
  const m = matchOnsets(adj, plan.slots.map(s => s.t), plan.slotDur / 2);
  const slots: SlotResult[] = plan.slots.map((s, i) => ({ t: s.t, expected: s.expected, step: s.step, onset: m[i].onset, errMs: m[i].err === null ? null : m[i].err! * 1000 }));
  const exp = slots.filter(s => s.expected), rests = slots.filter(s => !s.expected);
  const hitS = exp.filter(s => s.errMs !== null), errs = hitS.map(s => s.errMs!);
  const extras = rests.filter(s => s.onset !== null).length;
  const maeMs = errs.length ? mean(errs.map(Math.abs)) : Infinity;
  const hitRatio = exp.length ? hitS.length / exp.length : 0;
  const slotsRight = (hitS.length + (rests.length - extras)) / slots.length;
  const met = maeMs <= maxErrMs && slotsRight >= 0.9;
  const sloppy = maeMs > 1.5 * maxErrMs || hitRatio < 0.8;
  return { maeMs, biasMs: errs.length ? mean(errs) : 0, spreadMs: errs.length > 1 ? std(errs) : 0, hitRatio, slotsRight, extras,
    expected: exp.length, hits: hitS.length, onsets: adj.length, met, clean: met, sloppy, great: met && maeMs <= maxErrMs / 2 && slotsRight >= 0.97, slots };
}

// ---------- tempo ladder (§5) ----------
export interface Ladder { bpm: number; clean: number; sloppy: number }
export function ladderStart(target: number): Ladder { return { bpm: Math.round(0.65 * target), clean: 0, sloppy: 0 }; }
/** Apply one attempt. +4 BPM after 3 clean in a row (cap target); −8 after 2 sloppy in a row (floor 50%).
 *  Fast track: a *great* attempt (average error ≤ half the target, ≥ 97% right) jumps +8 straight away. */
export function ladderStep(l: Ladder, target: number, r: { clean: boolean; sloppy: boolean; great?: boolean }): Ladder {
  const n = { ...l };
  if (r.great) { n.bpm = Math.min(target, n.bpm + 8); n.clean = 0; n.sloppy = 0; }
  else if (r.clean) { n.clean++; n.sloppy = 0; if (n.clean >= 3) { n.bpm = Math.min(target, n.bpm + 4); n.clean = 0; } }
  else if (r.sloppy) { n.sloppy++; n.clean = 0; if (n.sloppy >= 2) { n.bpm = Math.max(Math.round(target * 0.5), n.bpm - 8); n.sloppy = 0; } }
  else { n.clean = 0; n.sloppy = 0; }
  return n;
}

// ---------- calibration ----------
/** Strum calibration: muted strums on each click. Returns the offset (ms) to subtract from timing grades. */
export function calibrationOffset(onsets: number[], clicks: number[]): { offsetMs: number; spreadMs: number; matched: number } | null {
  const first = matchOnsets(onsets, clicks, 0.3).filter(r => r.err !== null).map(r => r.err!);
  if (first.length < 8) return null;
  const guess = median(first);
  const m = matchOnsets(onsets, clicks.map(t => t + guess), 0.12).filter(r => r.err !== null).map(r => (r.err! + guess) * 1000);
  if (m.length < 8) return null;
  return { offsetMs: median(m), spreadMs: std(m), matched: m.length };
}
/** Click-bleed arrival from the count-in: the delay from each scheduled click to the first click-band onset after it. */
export function bleedDelay(clickOnsets: number[], clicks: number[]): number | null {
  const d: number[] = [];
  for (const t of clicks) { const c = clickOnsets.filter(o => o - t > 0.005 && o - t < 0.5).sort((a, b) => a - b)[0]; if (c !== undefined) d.push(c - t); }
  if (d.length < Math.min(3, clicks.length)) return null;
  const med = median(d);
  return d.filter(x => Math.abs(x - med) < 0.01).length >= Math.min(3, clicks.length) - 1 ? med : null;
}

/** Plain-language summary of a result, for the result card. */
export function coachLine(r: TimingResult, maxErrMs: number): string {
  if (r.hitRatio < 0.8) return 'A lot of strums weren’t heard. Strum a bit harder, or move the phone closer to the guitar.';
  if (r.extras > Math.max(1, r.expected * 0.05)) return `You strummed in ${r.extras} of the rests. Keep the hand moving but miss the strings there.`;
  const lean = Math.abs(r.biasMs) >= 8 ? (r.biasMs > 0 ? 'You’re dragging a little (behind the click). ' : 'You’re rushing a little (ahead of the click). ') : '';
  if (r.met) return `${lean}In the pocket.`;
  if (r.spreadMs > maxErrMs) return `${lean}Timing wanders from strum to strum. Slow it down and lock onto the click.`;
  return `${lean}Close. Try again at this tempo.`;
}
