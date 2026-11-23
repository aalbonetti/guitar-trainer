// Ported from m0/src/dsp.js (tested there with synthetic guitar audio). Keep the two in sync.
// Guitar Trainer DSP: pitch (YIN), onsets (spectral flux), chroma + chord verification.
// Pure functions, no DOM: shared by the browser page and the Node tests.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // string 6 -> 1

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }

function noteInfo(freq) {
  const m = freqToMidi(freq);
  const r = Math.round(m);
  return { midi: r, name: NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1), cents: (m - r) * 100 };
}

// YIN pitch detector. buf: Float32Array (~2048 samples). Returns {freq, clarity} or null.
function yin(buf, sr, opts = {}) {
  const minF = opts.minFreq || 70, maxF = opts.maxFreq || 1400, thr = opts.threshold || 0.12;
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < (opts.minRms || 0.003)) return null;
  const maxTau = Math.min(Math.floor(sr / minF), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sr / maxF));
  const W = n - maxTau;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    d[tau] = s;
  }
  // cumulative mean normalized difference
  const c = new Float32Array(maxTau + 1);
  c[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxTau; tau++) { run += d[tau]; c[tau] = run > 0 ? d[tau] * tau / run : 1; }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (c[t] < thr) {
      while (t + 1 <= maxTau && c[t + 1] < c[t]) t++;
      tau = t; break;
    }
  }
  if (tau < 0) {
    // fall back to the global minimum if it is reasonably clear
    let best = minTau;
    for (let t = minTau; t <= maxTau; t++) if (c[t] < c[best]) best = t;
    if (c[best] > 0.35) return null;
    tau = best;
  }
  // parabolic interpolation
  let t0 = tau;
  if (tau > 1 && tau < maxTau) {
    const a = c[tau - 1], b = c[tau], g = c[tau + 1];
    const den = a + g - 2 * b;
    if (den !== 0) t0 = tau + (a - g) / (2 * den);
  }
  return { freq: sr / t0, clarity: 1 - c[tau] };
}

// In-place radix-2 complex FFT. re, im: Float64Array of length 2^k.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

const _hannCache = {};
function hann(n) {
  if (!_hannCache[n]) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    _hannCache[n] = w;
  }
  return _hannCache[n];
}

// Magnitude spectrum of a frame (length = power of 2), Hann windowed.
function magSpectrum(frame) {
  const n = frame.length, w = hann(n);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = frame[i] * w[i];
  fft(re, im);
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

// 12-bin chroma from a frame (8192 samples recommended at 48 kHz).
// Uses spectral PEAKS with interpolated frequency, not raw bins: leakage and the noise floor
// otherwise flatten the chroma. Peaks off the semitone grid by > 25 cents are ignored (the 7th
// harmonic, 31 cents flat, would otherwise add a 7th to every chord: G heard as G7), and the
// click band (above `hi`) is never counted.
function chroma(frame, sr, opts = {}) {
  const lo = opts.lo || 75, hi = opts.hi || 1500, relDb = opts.relDb || 40;
  const mag = magSpectrum(frame);
  const n = frame.length, binHz = sr / n;
  const k0 = Math.max(2, Math.ceil(lo / binHz)), k1 = Math.min(mag.length - 2, Math.floor(hi / binHz));
  let mx = 0;
  for (let k = k0; k <= k1; k++) if (mag[k] > mx) mx = mag[k];
  const ch = new Float64Array(12);
  if (mx <= 0) return Array.from(ch);
  const floor = mx * Math.pow(10, -relDb / 20);
  for (let k = k0; k <= k1; k++) {
    const m = mag[k];
    if (m < floor || m < mag[k - 1] || m < mag[k + 1]) continue;
    // parabolic interpolation on log magnitude
    const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(m + 1e-12), g = Math.log(mag[k + 1] + 1e-12);
    const den = a - 2 * b + g;
    const off = den !== 0 ? 0.5 * (a - g) / den : 0;
    const f = (k + off) * binHz;
    const midi = freqToMidi(f), r = Math.round(midi);
    if (Math.abs(midi - r) > 0.25) continue;
    ch[((r % 12) + 12) % 12] += Math.sqrt(m / mx); // compress so loud bass strings don't dominate
  }
  return normalize(ch);
}

function normalize(v) {
  let s = 0;
  for (const x of v) s += x * x;
  s = Math.sqrt(s) || 1;
  return Array.from(v, x => x / s);
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += a[i] * b[i];
  return s;
}

// frets: 6 values string 6->1, -1 muted. Returns MIDI notes.
function voicingMidi(frets) {
  const out = [];
  frets.forEach((f, i) => { if (f >= 0) out.push(OPEN_MIDI[i] + f); });
  return out;
}

// Chord template from the actual voicing: each sounding note plus decaying harmonics.
function chordTemplate(frets) {
  const t = new Float64Array(12);
  for (const m of voicingMidi(frets)) {
    for (let h = 1; h <= 5; h++) {
      const pc = ((Math.round(m + 12 * Math.log2(h)) % 12) + 12) % 12;
      t[pc] += Math.pow(0.6, h - 1);
    }
  }
  // flatten a little so a missing harmonic doesn't dominate
  return normalize(Array.from(t, x => Math.sqrt(x)));
}

// Verify: which of the candidate chords does this chroma match best?
function classifyChord(ch, candidates) {
  const scores = candidates.map(c => ({ id: c.id, score: cosine(ch, c.template) }));
  scores.sort((a, b) => b.score - a.score);
  return { best: scores[0].id, margin: scores[0].score - (scores[1] ? scores[1].score : 0), scores };
}

// Streaming onset detector (spectral flux, half-wave rectified, adaptive threshold).
// Feed blocks of samples with their absolute start frame; get back onset frames.
class OnsetDetector {
  constructor(sr, opts = {}) {
    this.sr = sr;
    this.n = opts.frame || 1024;
    this.hop = opts.hop || 256;
    this.excludeLo = opts.excludeLo ?? 1800; // click band, Hz
    this.excludeHi = opts.excludeHi ?? 3200;
    this.bandLo = opts.bandLo || 60;
    this.bandHi = opts.bandHi || 6000;
    this.minGapS = opts.minGap || 0.07;
    this.k = opts.k || 1.6;
    this.floor = opts.floor || 0.5;
    this.gamma = opts.gamma || 1000;
    this.minFlux = opts.minFlux || 0; // absolute floor; set from a clicks-only count-in
    this.peakFlux = 0;               // max flux seen since resetPeak()
    this.isNearClick = opts.isNearClick || null; // (frame) => true near a predicted click arrival
    this.buf = new Float32Array(this.n);
    this.filled = 0;
    this.sinceHop = 0;
    this.prev = null;
    this.hist = [];
    this.lastOnset = -1e12;
    this.frameEnd = 0; // absolute frame index of the sample after the newest one
    this.pending = null; // candidate peak
  }
  push(samples, startFrame) {
    const out = [];
    if (!this.ring) { this.ring = new Float32Array(this.n); this.w = 0; this.frame = new Float32Array(this.n); }
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.w] = samples[i];
      this.w = (this.w + 1) % this.n;
      this.filled = Math.min(this.n, this.filled + 1);
      this.frameEnd = startFrame + i + 1;
      if (++this.sinceHop >= this.hop && this.filled === this.n) {
        this.sinceHop = 0;
        // unroll the ring into a contiguous frame, oldest sample first
        const tail = this.n - this.w;
        this.frame.set(this.ring.subarray(this.w), 0);
        this.frame.set(this.ring.subarray(0, this.w), tail);
        const r = this._step();
        if (r !== null) out.push(r);
      }
    }
    return out;
  }
  resetPeak() { this.peakFlux = 0; }
  // Call after a clicks-only count-in: onsets must beat the click bleed by this margin.
  learnBleed(margin = 1.3) { this.minFlux = this.peakFlux * margin; return this.minFlux; }
  _step() {
    const mag = magSpectrum(this.frame);
    const binHz = this.sr / this.n;
    let flux = 0;
    if (this.prev) {
      const k0 = Math.ceil(this.bandLo / binHz), k1 = Math.min(mag.length - 1, Math.floor(this.bandHi / binHz));
      for (let k = k0; k <= k1; k++) {
        const f = k * binHz;
        if (f >= this.excludeLo && f <= this.excludeHi) continue;
        const a = Math.log1p(this.gamma * mag[k]), b = Math.log1p(this.gamma * this.prev[k]);
        if (a > b) flux += a - b;
      }
    }
    this.prev = mag;
    if (flux > this.peakFlux) this.peakFlux = flux;
    // adaptive threshold: median + k * mean abs deviation of recent flux
    this.hist.push(flux);
    if (this.hist.length > 40) this.hist.shift();
    const sorted = [...this.hist].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const mad = this.hist.reduce((s, x) => s + Math.abs(x - med), 0) / this.hist.length;
    // time of this analysis frame: centre of the newest hop
    const t = this.frameEnd - this.hop / 2;
    // the click-bleed floor only applies around predicted click arrivals (or everywhere if unknown)
    const near = this.isNearClick ? this.isNearClick(t) : true;
    const thr = Math.max(this.floor * 10, near ? this.minFlux : 0, med + this.k * mad * 3);
    let result = null;
    // peak picking with one-step look-back
    if (this.pending && flux < this.pending.flux) {
      if (this.pending.t - this.lastOnset >= this.minGapS * this.sr) {
        result = this.pending.t;
        this.lastOnset = this.pending.t;
      }
      this.pending = null;
    }
    if (flux > thr && (!this.pending || flux > this.pending.flux)) this.pending = { flux, t };
    return result;
  }
}

// Energy detector for the metronome click band only (used by the loopback tests).
class BandOnsetDetector extends OnsetDetector {
  constructor(sr, lo, hi, opts = {}) {
    super(sr, Object.assign({ excludeLo: 1e9, excludeHi: 1e9, bandLo: lo, bandHi: hi, frame: 512, hop: 64, k: 2.0, minGap: 0.1 }, opts));
  }
}

// Match detected onset times (s) to expected times (s). Returns per-expected nearest within window.
function matchOnsets(onsets, expected, windowS) {
  const res = [];
  let j = 0;
  const used = new Set();
  for (const e of expected) {
    let best = null;
    for (let k = 0; k < onsets.length; k++) {
      if (used.has(k)) continue;
      const d = onsets[k] - e;
      if (Math.abs(d) <= windowS && (best === null || Math.abs(d) < Math.abs(onsets[best] - e))) best = k;
    }
    if (best !== null) { used.add(best); res.push({ expected: e, onset: onsets[best], err: onsets[best] - e }); }
    else res.push({ expected: e, onset: null, err: null });
  }
  return res;
}

function median(a) { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; }
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; }
function std(a) { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); }

const DSP = { NOTE_NAMES, OPEN_MIDI, midiToFreq, freqToMidi, noteInfo, yin, fft, magSpectrum, chroma, normalize, cosine,
  voicingMidi, chordTemplate, classifyChord, OnsetDetector, BandOnsetDetector, matchOnsets, median, mean, std };
export default DSP;
export { yin, noteInfo, chroma, chordTemplate, classifyChord, OnsetDetector, BandOnsetDetector, midiToFreq, freqToMidi, matchOnsets, median, mean, std, normalize };
