// Metronome meters and accents. Pure: the engine asks it what kind of click each tick is.
//
// Simple meters (2/4 3/4 4/4 6/4): one light per beat; BPM counts quarter notes.
// 6/8 is compound: BPM counts the dotted-quarter pulse (two per bar), the way worship charts list 6/8
// tempos (e.g. 72 for a 6/8 ballad) and the way a band feels it. Six lights, one per eighth, grouped 3 + 3:
// beat 1 accented, beat 4 a normal click, the other eighths softer. Subdivision 3 = eighths (default),
// 1 = pulse only, 6 = sixteenths.
export type Meter = '2/4' | '3/4' | '4/4' | '6/4' | '6/8';
export const METERS: Meter[] = ['2/4', '3/4', '4/4', '6/4', '6/8'];
export type ClickKind = 0 | 1 | 2; // 0 accent (2600 Hz), 1 beat (2000 Hz), 2 subdivision (1500 Hz, quieter)

export interface MeterInfo { beats: number; compound: boolean; lights: number; lightsPerBeat: number }
export function meterInfo(m: string): MeterInfo {
  if (m === '6/8') return { beats: 2, compound: true, lights: 6, lightsPerBeat: 3 };
  const beats = Math.max(1, Math.min(12, parseInt(m, 10) || 4));
  return { beats, compound: false, lights: beats, lightsPerBeat: 1 };
}
export function isMeter(m: unknown): m is Meter { return typeof m === 'string' && (METERS as string[]).includes(m); }
/** Older presets only say beats + clicks per beat. Two beats split in three is how the app has always written 6/8. */
export function meterFrom(beats: number, sub: number): Meter {
  if (beats === 2 && (sub === 3 || sub === 6)) return '6/8';
  const m = `${beats}/4`;
  return isMeter(m) ? m : '4/4';
}
export function subOptions(m: string): { v: number; label: string }[] {
  return meterInfo(m).compound
    ? [{ v: 1, label: 'dotted ♩ only' }, { v: 3, label: '♪ eighths' }, { v: 6, label: '16ths' }]
    : [{ v: 1, label: '♩' }, { v: 2, label: '♫ 8ths' }, { v: 3, label: 'triplets' }, { v: 4, label: '16ths' }];
}
/** Keep `sub` if the meter allows it, else the meter's default (eighths for 6/8, quarters otherwise). */
export function fitSub(m: string, sub: number): number {
  const ok = subOptions(m).some(o => o.v === sub);
  return ok ? sub : meterInfo(m).compound ? 3 : 1;
}
export function defaultAccents(_m: string): number[] { return [0]; }
/** Which light (beat, or eighth in 6/8) a tick at bar position `pos` lands on; null between lights. */
export function lightOf(pos: number, sub: number, m: string): number | null {
  const mi = meterInfo(m);
  const num = pos * mi.lightsPerBeat;
  return num % sub === 0 ? num / sub : null;
}
/** Click kind for the tick at bar position `pos` (0 … beats × sub − 1). Accents are light indices. */
export function clickKind(pos: number, sub: number, m: string, accents: number[]): ClickKind {
  const light = lightOf(pos, sub, m);
  if (light !== null && accents.includes(light)) return 0;
  return pos % sub === 0 ? 1 : 2;
}
export function toggleAccent(accents: number[], i: number): number[] {
  return accents.includes(i) ? accents.filter(x => x !== i) : [...accents, i].sort((a, b) => a - b);
}
