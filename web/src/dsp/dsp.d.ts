export function yin(buf: Float32Array, sr: number, opts?: Record<string, number>): { freq: number; clarity: number } | null;
export function noteInfo(freq: number): { midi: number; name: string; cents: number };
export function midiToFreq(m: number): number;
export function freqToMidi(f: number): number;
export function chroma(frame: Float32Array, sr: number, opts?: Record<string, number>): number[];
export function chordTemplate(frets: number[]): number[];
export function classifyChord(ch: number[], c: { id: string; template: number[] }[]): { best: string; margin: number };
export function normalize(v: ArrayLike<number>): number[];
export function median(a: number[]): number;
export function mean(a: number[]): number;
export function std(a: number[]): number;
export function matchOnsets(on: number[], exp: number[], w: number): { expected: number; onset: number | null; err: number | null }[];
export class OnsetDetector { constructor(sr: number, opts?: Record<string, unknown>); push(d: Float32Array, f: number): number[]; learnBleed(m?: number): number; isNearClick: ((f: number) => boolean) | null; }
export class BandOnsetDetector extends OnsetDetector { constructor(sr: number, lo: number, hi: number, opts?: Record<string, unknown>); }
declare const DSP: Record<string, unknown>;
export default DSP;
