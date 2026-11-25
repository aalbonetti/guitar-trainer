// Files that are copies of something else must not drift from their source.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('DSP port', () => {
  // only the "ported from" header and the export lines differ (ES module in the app, global/CommonJS in M0)
  const body = (src: string) => src.split('\n').filter(l => !/^(\/\/ Ported from m0\/|export |if \(typeof (module|window) )/.test(l)).join('\n').trim();
  it('web/src/dsp/dsp.js matches m0/src/dsp.js', () => {
    const web = body(read('../src/dsp/dsp.js'));
    expect(web.length).toBeGreaterThan(5000);
    expect(web).toBe(body(read('../../m0/src/dsp.js')));
  });
});

describe('licenses.txt', () => {
  const shipped = read('../public/licenses.txt');
  for (const f of ['../node_modules/@tombatossals/chords-db/LICENSE', '../node_modules/preact/LICENSE', '../src/fonts/LICENSE-Fraunces.txt', '../src/fonts/LICENSE-Inter.txt'])
    it(`holds the full text of ${f.split('/').slice(-2).join('/')}`, () => { expect(shipped).toContain(read(f).trim()); });
});
