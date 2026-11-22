// Grader fallback flag (06-app-spec.md §6): auto (default), assisted (shows what was detected, you confirm
// or override) or self (no audio; you mark it). Stored per grader on this phone (backed up with the gt_ prefs).
import { persisted } from '../store';
import type { Catalog, Lesson } from '../catalog';
import { pitchSetup, noteKind } from './pitch';

export type GraderMode = 'auto' | 'assisted' | 'self';
export interface GraderInfo { key: string; name: string; def: GraderMode; note: string }
/** Pitch grading of single notes rests on YIN, proven on synthetic audio (M0). Double stops use a spectral
 *  check like the chord graders, so they start in assisted mode until the real-phone check backs them.
 *  Octave shapes are graded on the low note only (a lone low note would pass), so you confirm them too. */
export const GRADERS: GraderInfo[] = [
  { key: 'pitch', name: 'Pitch: tuning, bends, single notes, harmonics', def: 'auto', note: 'F.02, EL.05, EL.07, EL.11' },
  { key: 'octaves', name: 'Pitch: octave shapes', def: 'assisted', note: 'EL.04. The app hears only the low note (the high one is its overtone), so you confirm the octave rang.' },
  { key: 'double_stops', name: 'Pitch: double stops (two notes at once)', def: 'assisted', note: 'EL.06' },
];
export const graderModePref = persisted<Record<string, GraderMode>>('gt_grader_modes', {});
export function graderMode(key: string): GraderMode {
  return graderModePref.get()[key] ?? GRADERS.find(g => g.key === key)?.def ?? 'auto';
}
export function setGraderMode(key: string, m: GraderMode) { graderModePref.set({ ...graderModePref.get(), [key]: m }); }
/** Which flag governs a pitch lesson. */
export function pitchGraderKey(l: Lesson, cat: Pick<Catalog, 'exercises'>): string {
  const s = pitchSetup(l, cat);
  return s.dyads ? 'double_stops' : s.expected.some(e => noteKind(e) === 'octave') ? 'octaves' : 'pitch';
}
