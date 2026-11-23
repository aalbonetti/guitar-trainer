// Synthetic guitar strums for the G3 tests (the same model as chord.test.ts): Karplus-Strong plucked strings at
// sounding pitch, 12–25 ms strum spread, random string levels and slight detune, room noise, run through the real
// StrumAnalyzer in 512-sample blocks. Seeded, so results are repeatable.
import { StrumAnalyzer, soundingFrets, type Strum } from '../src/grading/chord';

export const SR = 48000;
const OPEN = [40, 45, 50, 55, 59, 64];
let seed = 4242;
export const reseed = (s = +(process.env.CHORD_SEED || 4242)) => { seed = s; };
export const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function ks(freq: number, n: number, amp: number, damp: number): Float32Array {
  const N = Math.max(2, Math.round(SR / freq + 0.5)), ring = new Float32Array(N), out = new Float32Array(n);
  for (let i = 0; i < N; i++) ring[i] = (rnd() * 2 - 1) * amp;
  let p = 0;
  for (let i = 0; i < n; i++) { const q = (p + 1) % N; out[i] = ring[p]; ring[p] = damp * 0.5 * (ring[p] + ring[q]); p = q; }
  return out;
}
export interface StrumSpec { frets: number[]; t: number; dur?: number; capo?: number; gain?: number; up?: boolean }
export function render(strums: StrumSpec[], len: number, noise = 0.002): Float32Array {
  const out = new Float32Array(Math.ceil(len * SR));
  const sorted = [...strums].sort((a, b) => a.t - b.t);
  const nextHit = (s: StrumSpec, string: number) => { const n = sorted.find(x => x.t > s.t && x.frets[6 - string] >= 0); return n ? n.t : Infinity; };
  for (const s of sorted) {
    const fr = soundingFrets(s.frets, s.capo || 0), spread = 0.012 + rnd() * 0.013, dur = s.dur ?? 1.2;
    const order = fr.map((_, i) => i).filter(i => fr[i] >= 0);
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
  return out;
}
export function analyze(buf: Float32Array): Strum[] {
  const a = new StrumAnalyzer(SR), out: Strum[] = [];
  for (let i = 0; i < buf.length; i += 512) out.push(...a.push(buf.subarray(i, Math.min(buf.length, i + 512)), i));
  return [...out, ...a.flush()];
}
export const strumsOf = (specs: StrumSpec[], len: number) => analyze(render(specs, len));
