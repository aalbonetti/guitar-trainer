// Chart import (06-app-spec.md §3 Import, SCHEMA.md "User chart import"). Pure: parse ChordPro or a plain
// "chords over lyrics" paste, convert to Nashville numbers, match to an outline. Charts stay on the phone.
import { parseChord, pcOf, keyName } from './music';
import type { Outline } from './catalog';

export interface ChartLine { chords: { at: number; chord: string }[]; lyric: string }
export interface ChartSection { name: string; lines: ChartLine[]; chords: string[]; numbers: string[] }
export interface ParsedChart {
  title: string; artist: string | null; key: string | null; tempo: number | null; time: string | null; capo: number;
  ccli: number | null; sections: ChartSection[]; format: 'chordpro' | 'plain'; unknown: string[]; warnings: string[];
}

const DEG: Record<number, number> = { 0: 1, 2: 2, 4: 3, 5: 4, 7: 5, 9: 6, 11: 7 };
/** Chord → Nashville number in `key`. Same rules as build_song_outlines.py's to_number. */
export function toNumber(chord: string, key: string): string {
  const c = parseChord(chord), k = pcOf(key);
  if (!c || isNaN(k) || isNaN(pcOf(c.root))) return chord;
  const iv = ((pcOf(c.root) - k) % 12 + 12) % 12;
  const num = DEG[iv] !== undefined ? String(DEG[iv]) : ({ 1: 'b2', 3: 'b3', 6: 'b5', 8: 'b6', 10: 'b7' } as Record<number, string>)[iv];
  const q = c.suffix, minor = q.startsWith('m') && !q.startsWith('maj');
  let suffix = minor ? 'm' + q.slice(1) : q;
  if (/^\d/.test(suffix)) suffix = `(${suffix})`;
  let out = num + suffix;
  if (c.bass) { const b = ((pcOf(c.bass) - k) % 12 + 12) % 12; out += '/' + (DEG[b] !== undefined ? DEG[b] : `?${c.bass}`); }
  return out;
}

const CHORD_TOKEN = /^[A-G][#b]?(?:maj|min|m|M|dim|aug|sus|add|no|omit|alt|°|ø|\+|\d|\(|\)|b|#)*(?:\/[A-G][#b]?)?$/;
const isChord = (t: string) => CHORD_TOKEN.test(t) && !!parseChord(t);
/** A line that is only chords (plus bar lines, "N.C.", repeat marks) — the plain-text chord row. */
export function isChordLine(line: string): boolean {
  const toks = line.trim().split(/\s+/).filter(t => t && !/^(\||\/|-|N\.?C\.?|x\d+|\(x\d+\)|%)$/i.test(t));
  return toks.length > 0 && toks.every(isChord);
}
const SECTION_RE = /^\s*\[?\(?((?:intro|verse|pre-?chorus|chorus|bridge|tag|outro|ending|interlude|instrumental|turnaround|refrain|vamp|coda)(?:\s*\d+)?[a-z ]*?)\)?\]?\s*:?\s*$/i;
const cap = (s: string) => s.replace(/\b\w/g, m => m.toUpperCase()).replace(/\s+/g, ' ').trim();

function finish(sec: ChartSection, key: string | null) {
  sec.chords = sec.lines.flatMap(l => l.chords.map(c => c.chord));
  sec.numbers = key ? sec.chords.map(c => toNumber(c, key)) : [];
}

/** Parse a chart. ChordPro if it has {directives} or [inline] chords; otherwise chords-over-lyrics. */
export function parseChart(text: string, fileName = ''): ParsedChart {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const chordpro = /\{[a-z_]+[:}]/i.test(src) || [...src.matchAll(/\[([^\]\s]{1,10})\]/g)].some(m => isChord(m[1])) || /\.(cho|chordpro|pro|crd)$/i.test(fileName);
  const out: ParsedChart = { title: '', artist: null, key: null, tempo: null, time: null, capo: 0, ccli: null, sections: [], format: chordpro ? 'chordpro' : 'plain', unknown: [], warnings: [] };
  let cur: ChartSection | null = null;
  const section = (name: string) => { cur = { name, lines: [], chords: [], numbers: [] }; out.sections.push(cur); return cur; };
  const ensure = () => cur || section('Song');
  const lines = src.split('\n');

  if (chordpro) {
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const dir = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i.exec(line);
      if (dir) {
        const [, k0, v = ''] = dir, k = k0.toLowerCase();
        if (k === 'title' || k === 't') out.title = v;
        else if (k === 'artist' || k === 'subtitle' || k === 'st' || k === 'author') out.artist = out.artist || v;
        else if (k === 'key') out.key = v.trim();
        else if (k === 'tempo') out.tempo = parseFloat(v) || null;
        else if (k === 'time') out.time = v.trim();
        else if (k === 'capo') out.capo = parseInt(v, 10) || 0;
        else if (k === 'ccli' || k === 'ccli_song_number' || k === 'ccli_number') out.ccli = parseInt(v.replace(/\D/g, ''), 10) || null;
        else if (/^(start_of_|so)(chorus|c|verse|v|bridge|b|tab|t|grid|g)$/.test(k) || k.startsWith('start_of_')) {
          const kind = k.replace(/^start_of_|^so/, '');
          section(v || cap(({ c: 'chorus', v: 'verse', b: 'bridge', t: 'tab', g: 'grid' } as Record<string, string>)[kind] || kind));
        }
        else if (/^(end_of_|eo)/.test(k)) cur = null;
        else if (k === 'comment' || k === 'c' || k === 'comment_italic' || k === 'ci' || k === 'comment_box' || k === 'cb') { if (SECTION_RE.test(v)) section(cap(v)); }
        else if (k === 'copyright' || k === 'footer' || k === 'album' || k === 'year' || k === 'duration' || k === 'meta' || k === 'new_song' || k === 'ns' || k === 'chorus' || k === 'define') { /* ignored */ }
        else out.unknown.push(k);
        continue;
      }
      if (/^\s*#/.test(line)) continue;
      if (!line.trim()) continue;
      if (SECTION_RE.test(line) && !/\[/.test(line)) { section(cap(line.replace(/[\[\]():]/g, ''))); continue; }
      // inline [chords]
      const chords: ChartLine['chords'] = []; let lyric = '';
      const re = /\[([^\]]*)\]/g; let last = 0, m: RegExpExecArray | null;
      while ((m = re.exec(line))) { lyric += line.slice(last, m.index); const c = m[1].trim(); if (c && isChord(c)) chords.push({ at: lyric.length, chord: c }); else if (c && !/^(\||N\.?C\.?)$/i.test(c)) out.warnings.push(`Not a chord: [${c}]`); last = m.index + m[0].length; }
      lyric += line.slice(last);
      ensure().lines.push({ chords, lyric: lyric.replace(/\s+$/, '') });
    }
  } else {
    // plain text: header lines "Key - G", "Tempo - 72", "CCLI Song # 123"; chord rows sit above lyric rows
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\s+$/, '');
      if (!line.trim()) continue;
      const kv = /^\s*(key|tempo|bpm|time|capo|ccli(?: song)?(?: #| number)?)\s*[-:=#]?\s*(.+)$/i.exec(line);
      if (kv && !isChordLine(line)) {
        const k = kv[1].toLowerCase(), v = kv[2].trim();
        if (k === 'key') out.key = v.split(/\s/)[0]; else if (k === 'tempo' || k === 'bpm') out.tempo = parseFloat(v) || null;
        else if (k === 'time') out.time = v; else if (k === 'capo') out.capo = parseInt(v, 10) || 0; else out.ccli = parseInt(v.replace(/\D/g, ''), 10) || null;
        continue;
      }
      if (SECTION_RE.test(line)) { section(cap(line.replace(/[\[\]():]/g, ''))); continue; }
      if (isChordLine(line)) {
        const chords: ChartLine['chords'] = []; const re = /\S+/g; let m: RegExpExecArray | null;
        while ((m = re.exec(line))) if (isChord(m[0])) chords.push({ at: m.index, chord: m[0] });
        const next = lines[i + 1];
        if (next !== undefined && next.trim() && !isChordLine(next) && !SECTION_RE.test(next)) { ensure().lines.push({ chords, lyric: next.replace(/\s+$/, '') }); i++; }
        else ensure().lines.push({ chords, lyric: '' });
        continue;
      }
      if (!out.title && !out.sections.length) { out.title = line.trim(); continue; }
      if (!out.artist && !out.sections.length && out.title) { out.artist = line.trim(); continue; }
      ensure().lines.push({ chords: [], lyric: line });
    }
  }
  if (!out.title) out.title = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled chart';
  if (out.key && isNaN(pcOf(out.key.replace(/m$/, '')))) { out.warnings.push(`Unrecognized key "${out.key}"`); out.key = null; }
  // minor-key charts ("Em") are numbered from the relative major, so Em is 6m (the usual worship-chart convention)
  if (out.key && /m$/.test(out.key)) { const pc = pcOf(out.key.slice(0, -1)); out.key = keyName(pc + 3); }
  if (!out.key) { const first = out.sections.flatMap(s => s.lines.flatMap(l => l.chords))[0]; if (first) { out.key = parseChord(first.chord)!.root; out.warnings.push(`No key given; assuming ${out.key} (the first chord).`); } }
  out.sections = out.sections.filter(s => s.lines.length);
  out.sections.forEach(s => finish(s, out.key));
  if (!out.sections.some(s => s.chords.length)) out.warnings.push('No chords found.');
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** Match a chart to an outline: CCLI number first, then title. */
export function matchOutline(c: Pick<ParsedChart, 'ccli' | 'title'>, outlines: Outline[]): Outline | null {
  if (c.ccli) { const o = outlines.find(x => x.ccli === c.ccli); if (o) return o; }
  const t = norm(c.title);
  return outlines.find(o => norm(o.title) === t) || null;
}
