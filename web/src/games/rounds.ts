// Round setups for the click-timed games (pure: unit-tested). Box Runner: the box moved to a key and the path
// through it. In the Pocket: the click plan, with the click dropped in Gap Click bars, and the strum slots.
import type { Catalog } from '../catalog';
import { pick, boxFrets, boxNotes, boxPath, pocketLayout, type Rng, type BoxScale, type PocketSlot } from './core';
import { buildPlan, patternFeel, type Plan } from '../grading/timing';

/** Test-only: shorter rounds for headless tests (`__gtGameShortBars`). */
const shortBars = (): number | undefined => (globalThis as any).__gtGameShortBars;

/** Box Runner's setup for a round: key and position picked from the level, the box moved to that key, the path. */
export function boxSetup(cat: Pick<Catalog, 'scales'>, p: Record<string, any>, r: Rng) {
  const key: string = pick(r, p.keys), pos: number = pick(r, p.positions);
  const root = p.scale === 'major_pentatonic' ? 'G' : 'A';
  const sc = cat.scales.find(s => s.kind === p.scale && s.position === pos && s.root === root) as BoxScale;
  const frets = boxFrets(sc, key), notes = boxNotes(frets);
  let path = boxPath(notes, p.path, p.passes);
  const sb = shortBars(); if (sb) path = path.slice(0, sb * 4 * p.sub);
  const lo = Math.min(...frets.flat()), hi = Math.max(...frets.flat());
  return { key, pos, frets, notes, path, window: [Math.max(0, lo - 1), Math.min(15, hi + 1)] as [number, number], name: `${key} ${p.scale === 'major_pentatonic' ? 'major' : 'minor'} pentatonic, position ${pos}` };
}

export interface PocketSetup { plan: Plan & { start: number }; slots: PocketSlot[]; returnBars: Map<number, number>; gapOf: number[]; feel: ReturnType<typeof patternFeel> }
/** The click plan for a round: the pattern's slots for every bar; the click drops out in Gap Click bars. */
export function pocketSetup(cat: Pick<Catalog, 'strums'>, p: Record<string, any>, t0: number): PocketSetup {
  const pat = cat.strums.find(s => s.id === p.pattern)!, feel = patternFeel(pat);
  const lay = pocketLayout({ bars: p.bars, gap_bars: p.gap_bars, click_bars: p.click_bars, window_ms: p.window_ms });
  const bars = Math.min(lay.bars, shortBars() ?? lay.bars);
  const plan = { ...buildPlan(feel, p.bpm, bars, t0, pat.accents), start: t0 + feel.beats * (60 / p.bpm) };
  const barS = feel.beats * plan.beat, nCount = feel.beats;
  plan.clicks = plan.clicks.filter((c, i) => i < nCount || (lay.gapOf[Math.floor((c.t - plan.start) / barS + 1e-6)] ?? -1) < 0);
  const slots = plan.slots.map((s, i) => ({ t: s.t, expected: s.expected, bar: Math.floor(i / feel.grid) }));
  return { plan, slots, returnBars: new Map(lay.returns.filter(x => x.bar < bars).map(x => [x.bar, x.bars])), gapOf: lay.gapOf.slice(0, bars), feel };
}
