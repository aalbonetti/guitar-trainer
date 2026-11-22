// How playable a song is for you right now: which capo spot uses the chords you've learned.
// Pure (no storage), so it's unit-tested. Used by the song view's default capo and the Today song box.
import type { Catalog, Outline } from './catalog';
import type { LessonProgress } from './progress';
import { parseChord, transposeChord, keyName, pcOf, keyUsesFlats, capoOptions } from './music';

/** A chord reduced to what a beginner would play: root + "m" for minor. Cadd9 → C, Dsus4 → D, Em7 → Em, D/F# → D. */
export function simplify(name: string): string | null {
  const c = parseChord(name.split(' (')[0].trim());
  if (!c) return null;
  const minor = /^m(?!aj)/.test(c.suffix);
  return c.root + (minor ? 'm' : '');
}

/** Open chords a day-one player meets first. Used to pick a capo spot before any chord lesson is passed. */
const STARTER = ['G', 'C', 'D', 'Em', 'Am', 'E', 'A', 'Dm'];

/** Chords you've learned: those in lessons you've passed (or passed once), simplified. */
export function knownChords(cat: Pick<Catalog, 'lessons' | 'chords'>, lp: Record<string, LessonProgress>): Set<string> {
  const out = new Set<string>();
  for (const l of cat.lessons) {
    const p = lp[l.id];
    if (!(p && (p.state === 'passed' || p.first_pass_day))) continue;
    for (const id of l.assets.chords || []) {
      const c = cat.chords.find(x => x.id === id);
      const s = c && simplify(c.name);
      if (s) out.add(s);
    }
  }
  return out;
}

export interface Fit { capo: number; shapes: string; known: number; total: number; beginner: boolean; missing: string[] }

/** Best capo for `key`: the spot where you know the most chords (ties go to the lower capo).
 *  With no chords learned yet it picks the spot with the most starter chords and marks you a beginner. */
export function bestCapo(o: Pick<Outline, 'sections' | 'chart_key'>, key: string, known: Set<string>): Fit {
  const beginner = known.size === 0;
  const ref = beginner ? new Set(STARTER) : known;
  const semis = (pcOf(key) - pcOf(o.chart_key) + 12) % 12;
  const chords = [...new Set(o.sections.flatMap(s => s.chords_in_chart_key))];
  const spots = [{ capo: 0, shapes: key }, ...capoOptions(key).filter(c => c.capo > 0)];
  let best: Fit | null = null;
  for (const sp of spots) {
    const flats = keyUsesFlats(keyName(pcOf(key) - sp.capo));
    const names = [...new Set(chords.map(c => simplify(transposeChord(c, semis - sp.capo, flats))).filter((x): x is string => !!x))];
    const missing = names.filter(n => !ref.has(n));
    const fit: Fit = { capo: sp.capo, shapes: sp.shapes, known: names.length - missing.length, total: names.length, beginner, missing };
    if (!best || fit.known / fit.total > best.known / best.total) best = fit;
  }
  return best!;
}

/** One line for the song box / song view. */
export function fitLine(f: Fit, withWhere = true): string {
  const where = withWhere ? (f.capo ? `Capo ${f.capo}, ${f.shapes} shapes` : `No capo, ${f.shapes} shapes`) : '';
  const lead = (s: string) => (where ? `${where}${s[0] === ':' ? s : '. ' + s}` : (s[0] === ':' ? s.slice(2) : s).replace(/^./, c => c.toUpperCase()));
  if (f.beginner) return lead(`You haven't learned chords yet: listen along and follow the chord names. You'll play it after the first chord lessons (A.01–A.02).`);
  if (f.known === f.total) return lead(': you know every chord.');
  return lead(`: you know ${f.known} of ${f.total} chords. New: ${f.missing.join(', ')}.`);
}
