// Runs the maintained end-to-end suites one at a time (in parallel the timing-based ones are flaky).
// Needs `npm run build` first, Python Playwright and Google Chrome at /usr/bin/google-chrome.
// `npm run test:e2e -- m4 g2` runs only those suites.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const web = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SUITES = ['persist', 'm4', 'm5', 'channels', 'm7', 'm8', 'g1', 'g2', 'g3', 'update'];
const picked = process.argv.slice(2);
const unknown = picked.filter(s => !SUITES.includes(s));
if (unknown.length) { console.error(`Unknown suite: ${unknown.join(', ')}. Suites: ${SUITES.join(', ')}`); process.exit(2); }
const failed = [];
for (const s of picked.length ? picked : SUITES) {
  console.log(`\n=== ${s}_e2e.py ===`);
  const t0 = Date.now();
  const r = spawnSync('python3', [`test/${s}_e2e.py`], { cwd: web, stdio: 'inherit' });
  const ok = r.status === 0;
  if (!ok) failed.push(s);
  console.log(`=== ${s}: ${ok ? 'passed' : `FAILED (exit ${r.status})`} in ${Math.round((Date.now() - t0) / 1000)} s ===`);
}
console.log(failed.length ? `\nFailed: ${failed.join(', ')}` : '\nAll suites passed.');
process.exit(failed.length ? 1 : 0);
