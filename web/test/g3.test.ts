// G3: chord games (Call the Number and Triad Hunt in play mode, Change Sprint, Song Run), Daily Challenge,
// heatmap, badges, and the scoring/stars/combo/unlock rules they rely on. Chord checks use synthetic strums
// (test/synth.ts) through the real StrumAnalyzer and the M8 verifier.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import { reseed, strumsOf, type StrumSpec } from './synth';
import { verifyChord, chordTarget } from '../src/grading/chord';
import { familyOf, familyFrets, numberFamily, keyTargets, triadPlacements, triadQ, triadTargets, triadFrets, isTriad, judgeSprint,
  songChords, songBoxes, songPlan, songTargets, gradeSong, boxVerdict, callTargets, SPRINT_FAST_MS, SPRINT_SLOW_MS } from '../src/games/chords';
import { rng, scoreRun, comboMult, stars, speedBonus, pointsWith, songCallsOf, songCallQ } from '../src/games/core';
import { bests, bestKey, unlocked } from '../src/arcade';
import { buildDaily, dailyDone, itemMinutes, DAILY_MINUTES, type DailyInput } from '../src/daily';
import { heatCells, hardSpots, band, HEAT_ID } from '../src/heat';
import { badgeProgress, type BadgeData } from '../src/badges';

const j = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const games = j('games.json'), outlines = j('song_outlines.json'), badgesJ = j('badges.json'), lessons = j('lessons.json'), quizzes = j('quizzes.json'), chordsJ = j('chords.json');
const G = (id: string) => games.find((g: any) => g.id === id);
const OPENC = new Map(chordsJ.filter((c: any) => c.tags.includes('open') && !c.name.includes('(')).map((c: any) => [c.name, c.frets]));
const open = (n: string) => (OPENC.get(n) as number[] | undefined) ?? null;
const cat: any = { games, lessons, quizzes, badges: badgesJ, outlines, outlineById: Object.fromEntries(outlines.map((o: any) => [o.id, o])) };
beforeEach(() => reseed());

describe('catalog (G3)', () => {
  it('every game has levels; Song Run has one per song outline', () => {
    for (const g of games) expect(g.levels.length, g.id).toBeGreaterThan(0);
    expect(G('G_song_run').levels.map((l: any) => l.id).sort()).toEqual(outlines.map((o: any) => o.id).sort());
  });
  it('Song Run rounds last 3 minutes at most at 1 bar per chord; short songs go round more than once', () => {
    for (const l of G('G_song_run').levels) {
      const beats = { '4/4': 4, '3/4': 3, '6/8': 2 }[l.params.meter as string]!, o = cat.outlineById[l.id];
      const n = o.sections.reduce((a: number, s: any) => a + s.chords_in_chart_key.length, 0) * l.params.passes;
      const s = n * beats * 60 / l.params.bpm;
      expect(s, l.id).toBeLessThanOrEqual(180); expect(s, l.id).toBeGreaterThan(14);
      expect(l.params.bars_per_chord).toContain('1');
      expect(l.target_score).toBe(l.params.targets['1']);
    }
  });
  it('Change Sprint cycles carry resolved voicings and the teaching lesson\'s goal', () => {
    for (const l of G('G_change_sprint').levels) {
      for (const r of l.params.cycle) for (const f of l.params.voicings[r].frets) expect(f).toHaveLength(6);
      const pc = lessons.find((x: any) => x.id === l.unlock_lesson).pass_criteria;
      if (pc.type === 'changes_per_min') expect(l.params.target_per_min).toBe(pc.target);
    }
  });
  it('badges name real games and levels', () => {
    expect(badgesJ.map((b: any) => b.id)).toEqual(['B_set_ready', 'B_all_twelve', 'B_whole_neck', 'B_five_boxes', 'B_in_the_pocket', 'B_capo_brain', 'B_faithful']);
    for (const b of badgesJ) if (b.rule.game) { const g = G(b.rule.game); expect(g, b.id).toBeTruthy(); if (b.rule.level) expect(g.levels.some((l: any) => l.id === b.rule.level)).toBe(true); }
    // Five Boxes needs a level for every position
    expect(new Set(G('G_box_runner').levels.flatMap((l: any) => l.params.positions))).toEqual(new Set([1, 2, 3, 4, 5]));
  });
});

describe('scoring, combo, stars, unlocks', () => {
  it('100 × bonus (1.0–2.0) × combo; combo ×1→×4 every 8 right, reset by a miss', () => {
    expect([0, 7, 8, 15, 16, 24, 40].map(comboMult)).toEqual([1, 1, 2, 2, 3, 4, 4]);
    expect(pointsWith(3, 0)).toBe(200); expect(pointsWith(0.2, 0)).toBe(100);
    const r = scoreRun([...Array(9).fill({ ok: true, bonus: 1 }), { ok: false, bonus: 0, miss: 'x' }, { ok: true, bonus: 1 }]);
    expect(r.score).toBe(8 * 100 + 200 + 100); expect(r.maxCombo).toBe(2); expect(r.streak).toBe(1);
  });
  it('Change Sprint speed bonus: 2.0 at a change a second, 1.0 at one every 4 s', () => {
    expect(speedBonus(800, SPRINT_FAST_MS, SPRINT_SLOW_MS)).toBe(2); expect(speedBonus(4000, SPRINT_FAST_MS, SPRINT_SLOW_MS)).toBe(1);
    expect(speedBonus(2000, SPRINT_FAST_MS, SPRINT_SLOW_MS)).toBeCloseTo(1.667, 2);
  });
  it('stars: ★ finish, ★★ 85%, ★★★ 95% and the target', () => {
    expect(stars(false, 1, 1e6, 1)).toBe(0); expect(stars(true, 0.84, 1e6, 1)).toBe(1); expect(stars(true, 0.85, 0, 1)).toBe(2);
    expect(stars(true, 0.95, 999, 1000)).toBe(2); expect(stars(true, 0.95, 1000, 1000)).toBe(3);
  });
  it('level unlocks: level 1 open, next at ★★ (either mode); every Song Run song open', () => {
    const th = G('G_triad_hunt'), cs = G('G_change_sprint'), sr = G('G_song_run');
    bests.set({ ready: true, map: {} });
    expect(unlocked(cat, th, th.levels[0])).toBe(true); expect(unlocked(cat, th, th.levels[1])).toBe(false);
    expect(unlocked(cat, cs, cs.levels[1])).toBe(false);
    expect(sr.levels.every((l: any) => unlocked(cat, sr, l))).toBe(true);
    bests.set({ map: { [bestKey('G_triad_hunt', 'th1', 'tap')]: { best_stars: 1 } as any } });
    expect(unlocked(cat, th, th.levels[1])).toBe(false);
    bests.set({ map: { [bestKey('G_triad_hunt', 'th1', 'play')]: { best_stars: 2 } as any } });
    expect(unlocked(cat, th, th.levels[1])).toBe(true); expect(unlocked(cat, th, th.levels[2])).toBe(false);
    bests.set({ map: { [bestKey('G_change_sprint', 'cs1', 'play')]: { best_stars: 3 } as any } });
    expect(unlocked(cat, cs, cs.levels[1])).toBe(true);
  });
});

describe('chord families', () => {
  it('a chord\'s family is its root and major/minor', () => {
    expect(familyOf('G2')).toEqual({ pc: 7, minor: false }); expect(familyOf('Gsus')).toEqual({ pc: 7, minor: false });
    expect(familyOf('D/F#')).toEqual({ pc: 2, minor: false }); expect(familyOf('Em7')).toEqual({ pc: 4, minor: true });
    expect(familyOf('Gmaj7')).toEqual({ pc: 7, minor: false }); expect(familyOf('Bbm7')).toEqual({ pc: 10, minor: true });
  });
  it('numbers in a key: 6m in G = Em, 5/7 in D = A, b7 in G = F, 1maj7 stays major', () => {
    expect(numberFamily('6m', 'G')).toEqual({ pc: 4, minor: true }); expect(numberFamily('5/7', 'D')).toEqual({ pc: 9, minor: false });
    expect(numberFamily('b7', 'G')).toEqual({ pc: 5, minor: false }); expect(numberFamily('1maj7', 'C')).toEqual({ pc: 0, minor: false });
    expect(numberFamily('2m7', 'A')).toEqual({ pc: 11, minor: true });
  });
  it('family frets: the open chord first, then E- and A-shape barres that spell the chord', () => {
    const OPEN = [40, 45, 50, 55, 59, 64];
    for (let pc = 0; pc < 12; pc++) for (const minor of [false, true]) {
      const fr = familyFrets({ pc, minor }, open);
      expect(fr.length).toBeGreaterThanOrEqual(2);
      for (const f of fr) {
        const pcs = new Set(f.flatMap((x, i) => (x < 0 ? [] : [(OPEN[i] + x) % 12])));
        expect(pcs).toEqual(new Set([pc, (pc + (minor ? 3 : 4)) % 12, (pc + 7) % 12]));
        expect(Math.max(...f)).toBeLessThanOrEqual(15);
      }
    }
    expect(familyFrets({ pc: 7, minor: false }, open)[0]).toEqual([3, 2, 0, 0, 0, 3]);
  });
});

/** Strum each chord twice (1 s apart) and verify each strum against the expected target and the others. */
function verifyAll(seq: { frets: number[]; capo?: number; expected: string }[], targets: Record<string, ReturnType<typeof chordTarget>>, others = Object.values(targets)) {
  const strums = strumsOf(seq.map((s, i) => ({ frets: s.frets, capo: s.capo, t: 0.3 + i, dur: 1.0 })), seq.length + 0.8);
  return seq.map((s, i) => { const st = strums.find(x => Math.abs(x.t - (0.3 + i)) < 0.06); return verifyChord(st?.chroma ?? null, targets[s.expected], others, undefined, undefined, st?.low ?? null); });
}

describe('Call the Number, play mode (synthetic strums)', () => {
  it('in G: every diatonic chord strummed open is heard as its number; a wrong chord is not', () => {
    const tg = keyTargets('G', ['1', '2m', '3m', '4', '5', '6m'], open);
    const fams = ['1', '2m', '3m', '4', '5', '6m'].map(n => numberFamily(n, 'G')!);
    const seq = fams.flatMap(f => [0, 1].map(() => ({ frets: familyFrets(f, open)[0], expected: `${f.pc}${f.minor ? 'm' : ''}` })));
    const v = verifyAll(seq, tg);
    expect(v.filter(x => x.ok).length / v.length).toBeGreaterThanOrEqual(0.9);
    // a C strummed when 5 (D) was called sounds like the 4, never like the D
    const w = verifyAll([{ frets: familyFrets({ pc: 0, minor: false }, open)[0], expected: '2' }], tg)[0];
    expect(w.ok).toBe(false); expect(w.heard).toBe('0');
  });
  it('in Bb (barres) and with a capo (G shapes, capo 3 = Bb): the right chord passes', () => {
    const tg = keyTargets('Bb', ['1', '4', '5', '6m'], open);
    const fams = ['1', '4', '5', '6m'].map(n => numberFamily(n, 'Bb')!);
    const barre = verifyAll(fams.map(f => ({ frets: familyFrets(f, open)[1], expected: `${f.pc}${f.minor ? 'm' : ''}` })), tg);
    expect(barre.filter(x => x.ok).length).toBeGreaterThanOrEqual(3);
    // G C D Em shapes with capo 3 sound Bb Eb F Gm
    const shapes = [[3, 2, 0, 0, 0, 3], [-1, 3, 2, 0, 1, 0], [-1, -1, 0, 2, 3, 2], [0, 2, 2, 0, 0, 0]];
    const capo = verifyAll(shapes.map((frets, i) => ({ frets, capo: 3, expected: `${fams[i].pc}${fams[i].minor ? 'm' : ''}` })), tg);
    expect(capo.filter(x => x.ok).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Call the Number, songs mode', () => {
  it('every outline: each call offers its answer, and play mode checks it against every other chord family', () => {
    expect(outlines.length).toBeGreaterThan(0);
    for (const o of outlines) {
      const s = songCallsOf(o);
      expect(s.prompts.length, o.id).toBe(o.sections.reduce((a: number, x: any) => a + x.chords_in_chart_key.length, 0));
      expect(new Set(s.choices).size, o.id).toBe(s.choices.length);
      const families = new Set(s.prompts.map(p => { const f = familyOf(p.chord); expect(f, `${o.id} ${p.chord}`).toBeTruthy(); return `${f!.pc}${f!.minor ? 'm' : ''}`; }));
      s.prompts.forEach((p, i) => {
        const q = songCallQ(s, i);
        expect(p.num, `${o.id} call ${i}`).toBeTruthy();
        expect(q.prompt).toBe(p.num); expect(q.answer).toBe(p.chord); expect(q.choices, `${o.id} ${p.chord}`).toContain(q.answer);
        const t = callTargets(q, open), ids = t.others.map(x => x.id);
        expect(ids, `${o.id} ${p.chord}`).toContain(t.expected.id);
        expect(new Set(ids), o.id).toEqual(families);
      });
    }
  });
});

describe('Triad Hunt', () => {
  it('placements are closed triads on the string set inside the window', () => {
    const pl = triadPlacements(7, false, [3, 2, 1], [6, 10]);
    expect(pl.map(p => p.join())).toContain('7,8,7'); // G 2nd inversion (tri_321_G_inv2)
    for (const p of pl) expect(Math.max(...p) - Math.min(...p)).toBeLessThan(5);
    expect(isTriad({ pc: 7, minor: false, strings: [3, 2, 1], window: [6, 10] }, [7, 8, 7])).toBe(true);
    expect(isTriad({ pc: 7, minor: false, strings: [3, 2, 1], window: [6, 10] }, [7, 8, 6])).toBe(false); // Gm
    expect(isTriad({ pc: 7, minor: false, strings: [3, 2, 1], window: [8, 12] }, [7, 8, 7])).toBe(false); // outside the window
  });
  it('every question\'s window holds at least one placement, for every level', () => {
    const r = rng(7);
    for (const l of G('G_triad_hunt').levels) { let prev; for (let i = 0; i < 60; i++) { const q = triadQ(r, l.params, prev); expect(q.placements.length, `${l.id} ${q.name}`).toBeGreaterThan(0); expect(q.window[0]).toBeGreaterThanOrEqual(0); expect(q.window[1]).toBeLessThanOrEqual(15); prev = q; } }
  });
  it('a strummed triad is heard as that triad; the other quality is not (synthetic)', () => {
    const r = rng(3), p = G('G_triad_hunt').levels[1].params;
    let ok = 0, wrongOk = 0, n = 0;
    for (let i = 0; i < 10; i++) {
      const q = triadQ(r, p), { expected, others } = triadTargets(q, p);
      const par = triadPlacements(q.pc, !q.minor, q.strings, [Math.max(0, q.window[0] - 2), Math.min(15, q.window[1] + 2)])[0];
      const strums = strumsOf([{ frets: triadFrets(q.strings, q.placements[0]), t: 0.3 }, ...(par ? [{ frets: triadFrets(q.strings, par), t: 1.3 }] : [])], 2.4);
      const a = strums.find(x => Math.abs(x.t - 0.3) < 0.06), b = strums.find(x => Math.abs(x.t - 1.3) < 0.06);
      if (verifyChord(a?.chroma ?? null, expected, others, undefined, undefined, a?.low ?? null).ok) ok++;
      if (par && verifyChord(b?.chroma ?? null, expected, others, undefined, undefined, b?.low ?? null).ok) wrongOk++;
      n++;
    }
    expect(ok / n).toBeGreaterThanOrEqual(0.8); expect(wrongOk).toBe(0);
  });
});

describe('Change Sprint', () => {
  const lv = G('G_change_sprint').levels;
  const cyc = (l: any) => l.params.cycle.map((r: string) => chordTarget(r, l.params.voicings[r].name, l.params.voicings[r].frets));
  it('Em ↔ G, one strum per chord every 1.2 s: changes counted, no misses', () => {
    const l = lv[0], c = cyc(l), specs: StrumSpec[] = [];
    for (let i = 0; i < 12; i++) specs.push({ frets: l.params.voicings[l.params.cycle[i % 2]].frets[0], t: 0.5 + i * 1.2, dur: 1.1 });
    const ev = judgeSprint(strumsOf(specs, 15.5), c, 0, 15);
    expect(ev[0].kind).toBe('start');
    expect(ev.filter(e => e.kind === 'change').length).toBeGreaterThanOrEqual(10);
    expect(ev.filter(e => e.kind === 'miss').length).toBeLessThanOrEqual(1);
    expect(ev.find(e => e.kind === 'change')!.ms).toBeGreaterThan(1000);
  });
  it('strumming the same chord again is neither a change nor a miss', () => {
    const l = lv[0], c = cyc(l), em = l.params.voicings.Em.frets[0];
    const ev = judgeSprint(strumsOf([0, 1, 2, 3].map(i => ({ frets: em, t: 0.4 + i, dur: 0.95 })), 5), c, 0, 5);
    expect(ev.filter(e => e.kind === 'change' || e.kind === 'miss')).toEqual([]);
  });
  it('G family cycle in order: G → Dsus4 → Em7 → Cadd9 changes count', () => {
    const l = lv.find((x: any) => x.id === 'cs5'), c = cyc(l), specs: StrumSpec[] = [];
    for (let i = 0; i < 12; i++) specs.push({ frets: l.params.voicings[l.params.cycle[i % 4]].frets[0], t: 0.5 + i * 1.2, dur: 1.1 });
    const ev = judgeSprint(strumsOf(specs, 15.5), c, 0, 15);
    expect(ev.filter(e => e.kind === 'change').length).toBeGreaterThanOrEqual(9);
  });
});

describe('Song Run', () => {
  const o = cat.outlineById['MS_sing_wherever_i_go'];
  it('chords in the chosen key and capo: the shape you play and the chord it sounds', () => {
    const ch = songChords(o, 'Bb', 3);           // chart in A, played in Bb with capo 3 → G shapes
    expect(ch[0]).toMatchObject({ chord: 'Bb', shape: 'G' });
    expect(ch.find(c => c.family.minor)!.shape).toBe('Em');
    expect(songBoxes(ch, '2').length).toBe(ch.length * 2); expect(songBoxes(ch, '0.5', 2).length).toBe(ch.length * 2);
  });
  it('plan: one bar of count-in, a box per bar (half a bar at ½), clicks on every beat', () => {
    const boxes = songBoxes(songChords(o, 'A', 0), '1'), p = songPlan(boxes, 120, 4, '1', 10);
    expect(p.start).toBe(12); expect(p.boxes[1].t0 - p.boxes[0].t0).toBeCloseTo(2); expect(p.clicks.length).toBe(4 + boxes.length * 4);
    const h = songPlan(boxes, 120, 4, '0.5', 10); expect(h.boxes[1].t0 - h.boxes[0].t0).toBeCloseTo(1);
  });
  /** Play the first `n` boxes with 2 strums a bar of `play(i)` (frets) and grade them. */
  function run(key: string, capo: number, play: (i: number, frets: number[]) => number[] | null, capoOn = capo, n = 8) {
    const ch = songChords(o, key, capo), boxes = songBoxes(ch, '1').slice(0, n), tg = songTargets(ch, capo, open, () => null);
    const plan = songPlan(boxes, 100, 4, '1', 0.2), specs: StrumSpec[] = [];
    plan.boxes.forEach((b, i) => { const fr = play(i, tg.targets[b.ref].frets[0].map(f => (f < 0 ? -1 : f - capo))); if (fr) for (let k = 0; k < 2; k++) specs.push({ frets: fr, capo: capoOn, t: b.t0 + k * plan.beat * 2 + 0.02, dur: plan.beat * 2 }); });
    const g = gradeSong(strumsOf(specs, plan.end + 1), plan, tg, 0);
    return plan.boxes.map((b, i) => boxVerdict(g, plan, i, 0, {}, b.label, `bar ${i + 1}`));
  }
  it('the right chords on their bars pass, close to the 1 for a full bonus', () => {
    const v = run('A', 0, (_, f) => f);
    expect(v.filter(x => x.ok).length).toBeGreaterThanOrEqual(7);
    expect(v.filter(x => x.ok).every(x => x.bonus > 1.5)).toBe(true);
  });
  it('with a capo: right shapes pass; a forgotten capo fails most bars', () => {
    expect(run('Bb', 3, (_, f) => f).filter(x => x.ok).length).toBeGreaterThanOrEqual(7);
    expect(run('Bb', 3, (_, f) => f, 0).filter(x => x.ok).length).toBeLessThanOrEqual(3);
  });
  it('a missed bar names the chord and the bar; a silent bar says no strum', () => {
    const v = run('A', 0, (i, f) => (i === 2 ? null : f));
    expect(v[2].ok).toBe(false); expect(v[2].miss).toMatch(/^A \(bar 3\): no strum/);
  });
});

describe('Daily Challenge', () => {
  const base = (over: Partial<DailyInput> = {}): DailyInput => ({
    day: '2026-11-23', games, lessons, quizzes, open: (g, l) => g.levels.indexOf(l) === 0, modeOf: g => (g.modes[0] as any), lessonOpen: () => true,
    quizMisses: [], due: [], hard: [], changes: [], stars: {}, ...over });
  it('about 10 minutes, at most 4 items, and the same all day', () => {
    const a = buildDaily(base()), b = buildDaily(base());
    expect(a).toEqual(b);
    expect(a.reduce((s, x) => s + x.minutes, 0)).toBe(DAILY_MINUTES); expect(a.length).toBeLessThanOrEqual(4); expect(a.length).toBeGreaterThan(0);
    expect(a.some(x => x.game === 'G_song_run')).toBe(false);
  });
  it('weak spots come first: hard frets → Note Drop with focus; quiz misses → the matching game; slow changes → Change Sprint; due reviews', () => {
    const d = buildDaily(base({
      hard: [{ string: 5, fret: 3 }, { string: 6, fret: 5 }],
      quizMisses: [{ quiz_id: 'Q_capo', item_key: 'Bb-G', seen: 4, correct: 1 }],
      changes: [{ refs: ['C', 'Am'], ratio: 0.5 }, { refs: ['Em', 'G|G_4f'], ratio: 0.7 }],
      open: () => true,
    }));
    expect(d[0]).toMatchObject({ game: 'G_note_drop' }); expect(d[0].focus!.length).toBeGreaterThan(0);
    expect(d.some(x => x.game === 'G_capo_quick')).toBe(true);
    expect(d.find(x => x.game === 'G_change_sprint')!.level).toBe('cs2');
    const r = buildDaily(base({ due: ['T.04', 'A.06'] }));
    expect(r.some(x => x.game === 'G_capo_quick' && /Review due/.test(x.why))).toBe(true);
    expect(r.some(x => x.kind === 'lesson' && x.lesson === 'A.06')).toBe(true);
  });
  it('only open levels are picked; done = a round of that level since the challenge was made', () => {
    const d = buildDaily(base());
    for (const it of d) if (it.kind === 'game') expect(G(it.game!).levels[0].id).toBe(it.level);
    const done = dailyDone(d, 1000, [{ game_id: d[0].game!, level_id: d[0].level!, at: 999 }, { game_id: d[1]?.game ?? '', level_id: d[1]?.level ?? '', at: 1001 }], []);
    expect(done[0]).toBe(false); if (d[1]?.kind === 'game') expect(done[1]).toBe(true);
    expect(itemMinutes(G('G_note_drop'), G('G_note_drop').levels[0])).toBe(2);
  });
});

describe('heatmap', () => {
  const rows = [
    { quiz_id: HEAT_ID, item_key: 's5f3', seen: 6, correct: 2, ms_sum: 2000 },
    { quiz_id: HEAT_ID, item_key: 's6f3', seen: 5, correct: 5, ms_sum: 5000 },
    { quiz_id: HEAT_ID, item_key: 's6f5', seen: 4, correct: 4, ms_sum: 12000 },
    { quiz_id: HEAT_ID, item_key: 's6f7', seen: 4, correct: 4, ms_sum: 4400 },
    { quiz_id: 'Q_note_names', item_key: 's6f1', seen: 9, correct: 0 },
  ];
  it('cells per string and fret with accuracy and average time; other quizzes ignored', () => {
    const c = heatCells(rows);
    expect(Object.keys(c).sort()).toEqual(['s5f3', 's6f3', 's6f5', 's6f7']);
    expect(c.s5f3.acc).toBeCloseTo(1 / 3); expect(c.s6f5.avgMs).toBe(3000);
  });
  it('hard spots: inaccurate first, then slow ones; colour bands', () => {
    const c = heatCells(rows), h = hardSpots(c);
    expect(h.map(x => `${x.string}/${x.fret}`)).toEqual(['5/3', '6/5']);
    expect(band(c.s5f3, 1100)).toBe(1); expect(band(c.s6f3, 1100)).toBe(4); expect(band(c.s6f5, 1100)).toBe(3); expect(band(undefined, 1)).toBe(0);
  });
});

describe('badges', () => {
  const B = (id: string) => badgesJ.find((b: any) => b.id === id);
  const d = (o: Partial<BadgeData>): BadgeData => ({ bests: {}, runs: [], churchSongs: [], longestStreak: 0, ...o });
  const run = (o: any) => ({ game_id: '', level_id: '', mode: 'tap', stars: 2, accuracy: 0.9, at: 0, ...o });
  it('Set Ready: ★★★ Song Run on every church song', () => {
    const best = (id: string, s: number) => ({ [bestKey('G_song_run', id, 'play')]: { key: '', game_id: 'G_song_run', level_id: id, mode: 'play', best_stars: s } });
    expect(badgeProgress(B('B_set_ready'), d({ churchSongs: ['a', 'b'], bests: { ...best('a', 3), ...best('b', 2) } }))).toMatchObject({ earned: false, have: 1, need: 2 });
    expect(badgeProgress(B('B_set_ready'), d({ churchSongs: ['a', 'b'], bests: { ...best('a', 3), ...best('b', 3) } })).earned).toBe(true);
    expect(badgeProgress(B('B_set_ready'), d({})).earned).toBe(false);
  });
  it('All Twelve: a key counts with 85% of ≥ 3 calls in a ★★ round', () => {
    const keys = Object.fromEntries(['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb'].map(k => [k, [3, 3]]));
    const r1 = run({ game_id: 'G_call_the_number', extra_json: JSON.stringify({ keys: { ...keys, B: [2, 3] } }) });
    expect(badgeProgress(B('B_all_twelve'), d({ runs: [r1] }))).toMatchObject({ earned: false, have: 11 });
    const r2 = run({ game_id: 'G_call_the_number', extra_json: JSON.stringify({ keys: { B: [6, 7] } }) });
    expect(badgeProgress(B('B_all_twelve'), d({ runs: [r1, r2] })).earned).toBe(true);
    expect(badgeProgress(B('B_all_twelve'), d({ runs: [r1, { ...r2, stars: 1 }] })).earned).toBe(false);
  });
  it('Whole Neck, Five Boxes, In the Pocket, Capo Brain, Faithful', () => {
    expect(badgeProgress(B('B_whole_neck'), d({ bests: { x: { key: 'x', game_id: 'G_note_drop', level_id: 'nd4', mode: 'tap', best_stars: 3 } } })).earned).toBe(false);
    expect(badgeProgress(B('B_whole_neck'), d({ bests: { x: { key: 'x', game_id: 'G_note_drop', level_id: 'nd4', mode: 'play', best_stars: 3 } } })).earned).toBe(true);
    const box = (pos: number, stars = 2) => run({ game_id: 'G_box_runner', stars, extra_json: JSON.stringify({ pos }) });
    expect(badgeProgress(B('B_five_boxes'), d({ runs: [1, 2, 3, 4].map(p => box(p)).concat(box(5, 1)) })).have).toBe(4);
    expect(badgeProgress(B('B_five_boxes'), d({ runs: [1, 2, 3, 4, 5].map(p => box(p)) })).earned).toBe(true);
    const pk = (ms: number | null, at: number) => run({ game_id: 'G_in_the_pocket', level_id: 'pk3', at, extra_json: JSON.stringify({ landings: { 1: 50, 4: ms } }) });
    expect(badgeProgress(B('B_in_the_pocket'), d({ runs: [pk(5, 1), pk(-12, 2), pk(30, 3), pk(1, 4), pk(2, 5), pk(19, 6), pk(-20, 7)] })).earned).toBe(false);
    expect(badgeProgress(B('B_in_the_pocket'), d({ runs: [pk(5, 1), pk(-12, 2), pk(3, 3), pk(1, 4), pk(-20, 5)] })).earned).toBe(true);
    expect(badgeProgress(B('B_capo_brain'), d({ runs: [run({ game_id: 'G_capo_quick', max_streak: 29 })] })).earned).toBe(false);
    expect(badgeProgress(B('B_capo_brain'), d({ runs: [run({ game_id: 'G_capo_quick', max_streak: 30 })] })).earned).toBe(true);
    expect(badgeProgress(B('B_faithful'), d({ longestStreak: 30 })).earned).toBe(true);
  });
});
