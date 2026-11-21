// Synthetic tests for dsp.js: Karplus-Strong guitar plucks/strums, noise, and click bleed.
const D = require('../src/dsp.js');
const SR = 48000;
let rng = 12345;
const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };

function ks(freq, durS, amp = 0.5, damp = 0.996) {
  const n = Math.floor(durS * SR), N = Math.max(2, Math.round(SR / freq));
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = (rand() * 2 - 1) * amp;
  const out = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const nx = (p + 1) % N;
    const v = buf[p];
    out[i] = v;
    buf[p] = damp * 0.5 * (buf[p] + buf[nx]);
    p = nx;
  }
  return out;
}
function mixInto(dst, src, at, gain = 1) { for (let i = 0; i < src.length && at + i < dst.length; i++) dst[at + i] += src[i] * gain; }
function strum(frets, durS, amp = 0.35, detuneCents = 0) {
  const out = new Float32Array(Math.floor(durS * SR));
  D.voicingMidi(frets).forEach((m, i) => {
    const f = D.midiToFreq(m + detuneCents / 100 * (rand() - 0.5) * 2);
    mixInto(out, ks(f, durS, amp * (0.8 + 0.4 * rand())), Math.floor(i * 0.012 * SR));
  });
  return out;
}
// same envelope as the app's click: 2 ms raised-cosine attack, 6 ms decay
function click(freq = 2400, durS = 0.03, att = 0.002) {
  const out = new Float32Array(Math.floor(durS * SR));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR, env = t < att ? 0.5 - 0.5 * Math.cos(Math.PI * t / att) : Math.exp(-(t - att) / 0.006);
    out[i] = Math.sin(2 * Math.PI * freq * t) * env;
  }
  return out;
}
function addNoise(buf, level) { for (let i = 0; i < buf.length; i++) buf[i] += (rand() * 2 - 1) * level; }

let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!ok) fails++; };

// 1. YIN on every open string + some fretted notes, plucked (KS) with noise
{
  const midis = [40, 45, 50, 55, 59, 64, 43, 52, 57, 62, 67, 69, 72, 76];
  let worst = 0, misses = 0;
  for (const m of midis) {
    const x = ks(D.midiToFreq(m), 0.6, 0.5);
    addNoise(x, 0.005);
    const frame = x.subarray(Math.floor(0.15 * SR), Math.floor(0.15 * SR) + 2048);
    const r = D.yin(frame, SR);
    if (!r) { misses++; continue; }
    const cents = Math.abs(1200 * Math.log2(r.freq / D.midiToFreq(m)));
    // KS has a small, known pitch bias from integer delay length; compare to its true period
    const N = Math.round(SR / D.midiToFreq(m)), trueF = SR / (N - 0.5); // this KS variant has period N-0.5
    const centsTrue = Math.abs(1200 * Math.log2(r.freq / trueF));
    worst = Math.max(worst, Math.min(cents, centsTrue));
  }
  check('YIN plucked notes E2..E5', misses === 0 && worst < 3, `misses=${misses} worst=${worst.toFixed(2)}c`);
}
// 1b. YIN on pure sines vs exact cents (tuner accuracy)
{
  let worst = 0;
  for (const f of [82.41, 110, 146.83, 196, 246.94, 329.63, 440, 87.31 * Math.pow(2, 3 / 1200)]) {
    const x = new Float32Array(2048);
    for (let i = 0; i < x.length; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * f * i / SR);
    const r = D.yin(x, SR);
    worst = Math.max(worst, Math.abs(1200 * Math.log2(r.freq / f)));
  }
  check('YIN sine accuracy', worst < 1, `worst=${worst.toFixed(3)}c (target ±2c)`);
}
// 2. Onset timing: strummed eighths at 80 BPM with click bleed and noise
{
  const bpm = 80, slot = 60 / bpm / 2, bars = 4, nSlots = bars * 8;
  const dur = nSlots * slot + 1;
  const x = new Float32Array(Math.floor(dur * SR));
  const truth = [];
  for (let s = 0; s < nSlots; s++) {
    const human = (rand() - 0.5) * 0.02; // ±10 ms human scatter
    const t = 0.5 + s * slot + human;
    truth.push(t);
    const chord = [[3, 2, 0, 0, 3, 3], [-1, 3, 2, 0, 3, 3]][Math.floor(s / 4) % 2];
    mixInto(x, strum(chord, slot * 0.95, s % 2 ? 0.2 : 0.35), Math.floor(t * SR));
  }
  for (let b = 0; b < nSlots / 2; b++) mixInto(x, click(b % 4 ? 2000 : 2600), Math.floor((0.5 + b * slot * 2) * SR), 0.6);
  addNoise(x, 0.003);
  // prepend a 1-bar clicks-only count-in and learn the bleed level from it
  const ci = new Float32Array(Math.floor(4 * slot * 2 * SR));
  for (let b = 0; b < 4; b++) mixInto(ci, click(b ? 2000 : 2600), Math.floor(b * slot * 2 * SR), 0.6);
  addNoise(ci, 0.003);
  const det = new D.OnsetDetector(SR);
  for (let i = 0; i < ci.length; i += 128) det.push(ci.subarray(i, i + 128), i - ci.length);
  det.learnBleed();
  const clickFrames = Array.from({ length: nSlots / 2 }, (_, b) => (0.5 + b * slot * 2) * SR);
  det.isNearClick = f => clickFrames.some(c => Math.abs(f - c) < 0.03 * SR);
  const on = [];
  for (let i = 0; i < x.length; i += 128) on.push(...det.push(x.subarray(i, i + 128), i));
  const onS = on.map(f => f / SR);
  const m = D.matchOnsets(onS, truth, slot / 2);
  const hits = m.filter(r => r.err !== null);
  const errs = hits.map(r => r.err);
  const bias = D.median(errs);
  const mae = D.mean(errs.map(e => Math.abs(e - bias))) * 1000;
  const extra = onS.length - hits.length;
  check('Onsets: strummed 8ths @80 + click bleed', hits.length / truth.length >= 0.95 && mae <= 8 && extra <= 2,
    `hit=${hits.length}/${truth.length} extra=${extra} bias=${(bias * 1000).toFixed(1)}ms meanAbsErr(after bias)=${mae.toFixed(1)}ms`);
}
// 2b. Clicks-only count-in teaches the detector the bleed level; then clicks alone must not trigger
{
  const x = new Float32Array(SR * 6);
  for (let b = 0; b < 12; b++) mixInto(x, click(b % 4 ? 2000 : 2600), Math.floor((0.3 + b * 0.5) * SR), 0.8);
  addNoise(x, 0.002);
  const det = new D.OnsetDetector(SR);
  const countIn = Math.floor(2.3 * SR); // first 4 clicks = count-in
  for (let i = 0; i < countIn; i += 128) det.push(x.subarray(i, Math.min(i + 128, countIn)), i);
  det.learnBleed();
  const on = [];
  for (let i = countIn; i < x.length; i += 128) on.push(...det.push(x.subarray(i, i + 128), i));
  check('Click bleed ignored after count-in', on.length <= 1, `false onsets=${on.length} minFlux=${det.minFlux.toFixed(1)}`);
  const bd = new D.BandOnsetDetector(SR, 1800, 3200); const cb = [];
  for (let i = 0; i < x.length; i += 128) cb.push(...bd.push(x.subarray(i, i + 128), i));
  const m = D.matchOnsets(cb.map(f => f / SR), Array.from({ length: 8 }, (_, b) => 0.3 + b * 0.5), 0.1);
  const errs = m.filter(r => r.err !== null).map(r => r.err * 1000);
  check('Click detector finds every click (loopback test)', errs.length === 8 && D.std(errs) < 1.5, `found=${errs.length}/8 spread(std)=${D.std(errs).toFixed(2)}ms`);
}
// 3. Chord verification: A.02 G family, strums with noise, slight detune, random string levels
{
  const chords = [
    { id: 'G', frets: [3, 2, 0, 0, 3, 3] },
    { id: 'Cadd9', frets: [-1, 3, 2, 0, 3, 3] },
    { id: 'Dsus4', frets: [-1, -1, 0, 2, 3, 3] },
    { id: 'Em7', frets: [0, 2, 2, 0, 3, 3] },
  ].map(c => Object.assign(c, { template: D.chordTemplate(c.frets) }));
  let correct = 0, total = 0;
  const conf = {};
  for (let trial = 0; trial < 80; trial++) {
    const c = chords[trial % 4];
    const x = strum(c.frets, 0.6, 0.3, 8);
    addNoise(x, 0.004);
    // average chroma over 60-400 ms after the strum
    const acc = new Array(12).fill(0);
    for (let t = 0.06; t + 8192 / SR <= 0.45; t += 0.03) {
      const ch = D.chroma(x.subarray(Math.floor(t * SR), Math.floor(t * SR) + 8192), SR);
      ch.forEach((v, i) => acc[i] += v);
    }
    const r = D.classifyChord(D.normalize(acc), chords);
    total++; if (r.best === c.id) correct++;
    conf[c.id + '->' + r.best] = (conf[c.id + '->' + r.best] || 0) + 1;
  }
  check('Chord verify G family (synthetic)', correct / total >= 0.9, `${correct}/${total} = ${(100 * correct / total).toFixed(0)}%  ${JSON.stringify(conf)}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
