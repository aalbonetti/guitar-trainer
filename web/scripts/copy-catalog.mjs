// Copies the generated catalog into public/catalog and builds a compact chord library from chords-db.
// The church's set list (setlist.json / CSV) is personal and is NOT published; it's imported on the phone.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, '../../guitar-kb/catalog');
const out = path.resolve(here, '../public/catalog');
fs.mkdirSync(out, { recursive: true });
const SKIP = new Set(['setlist.json']);
let n = 0;
for (const f of fs.readdirSync(src)) {
  if (!f.endsWith('.json') || SKIP.has(f)) continue;
  fs.copyFileSync(path.join(src, f), path.join(out, f)); n++;
}
// Lesson text: guitar-kb/content/*.md -> public/content
const csrc = path.resolve(here, '../../guitar-kb/content'), cout = path.resolve(here, '../public/content');
fs.rmSync(cout, { recursive: true, force: true }); fs.mkdirSync(cout, { recursive: true });
let nc = 0;
if (fs.existsSync(csrc)) for (const f of fs.readdirSync(csrc)) if (f.endsWith('.md')) { fs.copyFileSync(path.join(csrc, f), path.join(cout, f)); nc++; }
console.log(`content: ${nc} lesson files`);
// chords-db (MIT, Copyright (c) 2016 David Rubert): keep up to 3 voicings per chord, frets made absolute.
const db = require('@tombatossals/chords-db/lib/guitar.json');
const lib = {};
for (const [key, list] of Object.entries(db.chords)) {
  const k = key.replace('sharp', '#');
  lib[k] = {};
  for (const ch of list) {
    lib[k][ch.suffix] = ch.positions.slice(0, 3).map(p => ({
      frets: p.frets.map(f => (f > 0 ? f + p.baseFret - 1 : f)),
      fingers: p.fingers,
      barre: p.barres && p.barres.length ? p.barres[0] + p.baseFret - 1 : null,
    }));
  }
}
fs.writeFileSync(path.join(out, 'chords-lib.json'), JSON.stringify(lib));
console.log(`catalog: ${n} files + chords-lib.json (${Math.round(fs.statSync(path.join(out, 'chords-lib.json')).size / 1024)} KB)`);
