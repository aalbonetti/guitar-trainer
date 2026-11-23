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
  // M8. Chord verification is proven only on synthetic strums; the phone check (06-app-spec.md §10, ≥ 90% across
  // the A.02 G family) hasn't been run, so both start assisted: you see what it heard and confirm.
  { key: 'chord_accuracy', name: 'Chords: right chord on each strum', def: 'assisted', note: 'A.08, A.11, A.12, ER.05, ER.09, ER.11. Starts assisted until the phone audio check shows chord detection works on this phone.' },
  { key: 'changes_per_min', name: 'Chords: one-minute changes', def: 'assisted', note: 'A.01–A.04, ER.04, ER.06. Same chord check, counting changes.' },
];
export const graderModePref = persisted<Record<string, GraderMode>>('gt_grader_modes', {});
export function graderMode(key: string): GraderMode {
  return graderModePref.get()[key] ?? GRADERS.find(g => g.key === key)?.def ?? 'auto';
}
export function setGraderMode(key: string, m: GraderMode) { graderModePref.set({ ...graderModePref.get(), [key]: m }); }
/** Which flag governs a chord lesson: its pass_criteria type. */
export const chordGraderKey = (l: Lesson): string => l.pass_criteria.type;
export const isChordLesson = (l: Lesson): boolean => l.pass_criteria.type === 'chord_accuracy' || l.pass_criteria.type === 'changes_per_min';
/** Which flag governs a pitch lesson. */
export function pitchGraderKey(l: Lesson, cat: Pick<Catalog, 'exercises'>): string {
  const s = pitchSetup(l, cat);
  return s.dyads ? 'double_stops' : s.expected.some(e => noteKind(e) === 'octave') ? 'octaves' : 'pitch';
}
