import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { meterInfo, meterFrom, clickKind, lightOf, fitSub, toggleAccent, subOptions, METERS } from '../src/audio/meter';
import { lessonTempo, lessonMeter } from '../src/catalog';

const j = (f: string) => JSON.parse(fs.readFileSync(new URL(`../public/catalog/${f}`, import.meta.url), 'utf8'));
const rhythm = j('rhythm.json');
const cat: any = { lessons: j('lessons.json'), strums: rhythm.strumming, picking: rhythm.picking, exercises: j('exercises.json'), songs: j('songs.json') };
const L = (id: string) => cat.lessons.find((l: any) => l.id === id);
const bar = (m: string, sub: number, acc: number[]) => Array.from({ length: meterInfo(m).beats * sub }, (_, p) => clickKind(p, sub, m, acc));

describe('meters', () => {
  it('lists 6/8 next to the simple meters', () => {
    expect(METERS).toEqual(['2/4', '3/4', '4/4', '6/4', '6/8']);
    expect(meterInfo('6/8')).toEqual({ beats: 2, compound: true, lights: 6, lightsPerBeat: 3 });
    expect(meterInfo('3/4')).toEqual({ beats: 3, compound: false, lights: 3, lightsPerBeat: 1 });
  });
  it('simple meters click as before: accent on 1, beats, softer subdivisions', () => {
    expect(bar('4/4', 1, [0])).toEqual([0, 1, 1, 1]);
    expect(bar('4/4', 2, [0])).toEqual([0, 2, 1, 2, 1, 2, 1, 2]);
    expect(bar('3/4', 3, [0])).toEqual([0, 2, 2, 1, 2, 2, 1, 2, 2]);
  });
  it('6/8 counts the dotted-quarter pulse: 1 accented, 4 a full click, other eighths soft', () => {
    expect(bar('6/8', 3, [0])).toEqual([0, 2, 2, 1, 2, 2]);
    expect(bar('6/8', 1, [0])).toEqual([0, 1]);           // pulse only: clicks on 1 and 4
    expect(bar('6/8', 6, [0])).toEqual([0, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2]);
    expect([0, 1, 2, 3, 4, 5].map(p => lightOf(p, 3, '6/8'))).toEqual([0, 1, 2, 3, 4, 5]);
    expect([0, 1].map(p => lightOf(p, 1, '6/8'))).toEqual([0, 3]);
    expect(lightOf(1, 6, '6/8')).toBeNull();
  });
  it('tapping a light toggles its accent', () => {
    expect(toggleAccent([0], 2)).toEqual([0, 2]);
    expect(toggleAccent([0, 2], 0)).toEqual([2]);
    expect(bar('4/4', 1, [0, 2])).toEqual([0, 1, 0, 1]);
    expect(bar('4/4', 1, [])).toEqual([1, 1, 1, 1]);
    expect(bar('6/8', 3, [0, 3])).toEqual([0, 2, 2, 0, 2, 2]);
    expect(bar('6/8', 3, [0, 4])).toEqual([0, 2, 2, 1, 0, 2]); // an accented eighth inside the beat
  });
  it('old presets (beats + sub) map to meters; subdivisions fit the meter', () => {
    expect(meterFrom(2, 3)).toBe('6/8'); expect(meterFrom(2, 1)).toBe('2/4'); expect(meterFrom(3, 2)).toBe('3/4'); expect(meterFrom(5, 1)).toBe('4/4');
    expect(fitSub('6/8', 2)).toBe(3); expect(fitSub('6/8', 1)).toBe(1); expect(fitSub('4/4', 6)).toBe(1); expect(fitSub('4/4', 4)).toBe(4);
    expect(subOptions('6/8').map(o => o.v)).toEqual([1, 3, 6]);
  });
});

describe('lesson metronome presets', () => {
  it('meter comes from the exercise, rhythm pattern or song', () => {
    expect(lessonMeter(L('F.05'), cat)).toBe('4/4');                 // EX_spider
    expect(lessonTempo(L('A.07'), cat)).toEqual({ bpm: 90, beats: 3, sub: 2, meter: '3/4' }); // graded pattern S4_waltz
    expect(lessonTempo(L('A.10'), cat).meter).toBe('4/4');           // P2_pima matches subdivision 8
    expect(lessonTempo(L('EL.07'), cat)).toEqual({ bpm: 80, beats: 3, sub: 1, meter: '3/4' }); // Amazing Grace
    expect(lessonTempo(L('A.11'), cat).meter).toBe('3/4');
    expect(lessonTempo(L('F.06'), cat)).toEqual({ bpm: 70, beats: 4, sub: 1, meter: '4/4' });
  });
  it('a 6/8 pattern presets 6/8 with eighths', () => {
    const l = { ...L('A.07'), assets: { rhythm: ['S5_six_eight'] } };
    expect(lessonTempo(l, cat)).toEqual({ bpm: 90, beats: 2, sub: 3, meter: '6/8' });
  });
  it('every lesson gets a valid meter', () => {
    for (const l of cat.lessons) expect(METERS).toContain(lessonMeter(l, cat));
  });
});
