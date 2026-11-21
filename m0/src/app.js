// Guitar Trainer: M0 audio feasibility test (browser version).
// Every test schedules sound on the AudioContext clock and timestamps input by AudioContext frame,
// so timing is measured on one clock end to end.
(function () {
  'use strict';
  const D = window.DSP;
  const $ = id => document.getElementById(id);
  const LS_KEY = 'gt_m0_results_v1';

  // Click sound: accent 2600 Hz, normal 2000 Hz, 2 ms raised-cosine attack, 6 ms decay.
  // The guitar onset detector ignores 1800-3200 Hz, so speaker bleed doesn't count as a strum.
  const CLICK_HI = 2600, CLICK_LO = 2000;

  const S = {
    ctx: null, stream: null, src: null, node: null, sink: null,
    sr: 48000, ringLen: 48000 * 10, ring: null, wAbs: 0,
    expectNext: null, gaps: 0, gapLog: [], channels: 1, ch: 0,
    listeners: new Set(), deviceId: null, deviceLabel: '', wake: null,
    results: load(), events: [], busy: false,
  };

  function load() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(S.results)); } catch (e) { /* storage may be unavailable */ } }

  const posture = () => (window.innerWidth >= 600 ? 'unfolded' : 'folded');
  const routeKey = () => (S.deviceLabel || 'default mic') + (S.channels > 1 ? ` · ch ${S.ch + 1}/${S.channels}` : '');
  function record(test, value) {
    const r = routeKey(), p = posture();
    S.results[r] = S.results[r] || {};
    S.results[r][p] = S.results[r][p] || {};
    S.results[r][p][test] = Object.assign({ at: new Date().toISOString() }, value);
    save(); renderResults();
  }
  function getResult(test) { const r = S.results[routeKey()]; return r && r[posture()] && r[posture()][test]; }

  // ---------- audio setup ----------
  const WORKLET = `
  class Cap extends AudioWorkletProcessor {
    constructor() { super(); this.ch = 0; this.buf = new Float32Array(512); this.n = 0; this.start = 0; this.reported = -1;
      this.port.onmessage = e => { if (e.data && e.data.ch != null) this.ch = e.data.ch; }; }
    process(inputs, outputs) {
      const inp = inputs[0];
      if (!inp || inp.length === 0) return true;
      if (inp.length !== this.reported) { this.reported = inp.length; this.port.postMessage({ chs: inp.length }); }
      const c = inp[Math.min(this.ch, inp.length - 1)];
      for (let i = 0; i < c.length; i++) {
        if (this.n === 0) this.start = currentFrame + i;
        this.buf[this.n++] = c[i];
        if (this.n === this.buf.length) { this.port.postMessage({ f: this.start, d: this.buf.slice(0) }); this.n = 0; }
      }
      return true;
    }
  }
  registerProcessor('cap', Cap);`;

  async function startAudio(deviceId) {
    stopAudio();
    const constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 8 } } };
    if (deviceId) constraints.audio.deviceId = { exact: deviceId };
    S.stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (!S.ctx) {
      S.ctx = new AudioContext({ latencyHint: 'interactive' });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await S.ctx.audioWorklet.addModule(url);
    }
    await S.ctx.resume();
    S.sr = S.ctx.sampleRate;
    S.ringLen = S.sr * 10;
    S.ring = new Float32Array(S.ringLen);
    S.wAbs = 0; S.expectNext = null; S.gaps = 0; S.firstFrame = null;
    const track = S.stream.getAudioTracks()[0];
    S.deviceLabel = track.label || 'default mic';
    S.deviceId = track.getSettings().deviceId || deviceId || null;
    S.src = S.ctx.createMediaStreamSource(S.stream);
    S.node = new AudioWorkletNode(S.ctx, 'cap', { numberOfInputs: 1, numberOfOutputs: 1, channelCountMode: 'max' });
    S.node.port.onmessage = onBlock;
    S.node.port.postMessage({ ch: S.ch });
    S.sink = S.ctx.createGain(); S.sink.gain.value = 0;
    S.src.connect(S.node); S.node.connect(S.sink); S.sink.connect(S.ctx.destination);
    try { S.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not fatal */ }
    logEvent('audio started');
    await listDevices();
    renderStatus();
  }
  function stopAudio() {
    if (S.src) { try { S.src.disconnect(); S.node.disconnect(); S.sink.disconnect(); } catch (e) {} }
    if (S.stream) S.stream.getTracks().forEach(t => t.stop());
    S.src = S.node = S.sink = S.stream = null;
  }

  function onBlock(e) {
    const m = e.data;
    if (m.chs != null) { S.channels = m.chs; renderChannels(); renderStatus(); return; }
    const f = m.f, d = m.d;
    if (S.firstFrame === null) S.firstFrame = f;
    // ignore the first half-second while the input stream settles
    if (S.expectNext !== null && f !== S.expectNext && f - S.firstFrame > 0.5 * S.sr) { S.gaps++; S.gapLog.push({ at: f / S.sr, missing: (f - S.expectNext) / S.sr }); }
    S.expectNext = f + d.length;
    for (let i = 0; i < d.length; i++) S.ring[(f + i) % S.ringLen] = d[i];
    S.wAbs = f + d.length;
    for (const l of S.listeners) l(d, f);
  }
  // samples [fromFrame, fromFrame+n) from the ring (zeros if not available)
  function grab(fromFrame, n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const F = fromFrame + i;
      if (F >= S.wAbs - S.ringLen && F < S.wAbs) out[i] = S.ring[F % S.ringLen];
    }
    return out;
  }

  function scheduleClick(t, accent, vol = 0.8) {
    const o = S.ctx.createOscillator(), g = S.ctx.createGain();
    o.frequency.value = accent ? CLICK_HI : CLICK_LO;
    g.gain.setValueAtTime(0, t);
    g.gain.setValueCurveAtTime(new Float32Array([0, 0.146, 0.5, 0.854, 1].map(x => x * vol)), t, 0.002);
    g.gain.setTargetAtTime(0, t + 0.002, 0.006);
    o.connect(g); g.connect(S.ctx.destination);
    o.start(t); o.stop(t + 0.06);
  }
  // times[]: AudioContext seconds. Returns times.
  function scheduleClicks(times, accentEvery, vol) { times.forEach((t, i) => scheduleClick(t, accentEvery && i % accentEvery === 0, vol)); return times; }
  const ctxNow = () => S.ctx.currentTime;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitUntilCtx(t) { while (ctxNow() < t) await sleep(20); }

  // collect onsets (seconds, AudioContext clock) from a detector between t0 and t1
  async function collectOnsets(det, t1, onEach) {
    const out = [];
    const l = (d, f) => { for (const fr of det.push(d, f)) { const s = fr / S.sr; out.push(s); if (onEach) onEach(s); } };
    S.listeners.add(l);
    await waitUntilCtx(t1);
    await sleep(150);
    S.listeners.delete(l);
    return out;
  }

  function requireAudio() { if (!S.ctx || !S.stream) { alertBox('Tap “Start audio” first.'); return false; } return true; }
  function alertBox(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3500); }
  async function guard(btn, fn) {
    if (!requireAudio() || S.busy) return;
    S.busy = true; document.body.classList.add('busy'); btn.classList.add('running');
    try { await fn(); } catch (err) { console.error(err); alertBox('Error: ' + err.message); }
    S.busy = false; document.body.classList.remove('busy'); btn.classList.remove('running');
  }

  // ---------- 1. tuner ----------
  let tunerOn = false;
  function tunerLoop() {
    if (!tunerOn) return;
    if (S.ring) {
      const r = D.yin(grab(S.wAbs - 2048, 2048), S.sr);
      if (r) {
        const n = D.noteInfo(r.freq);
        $('tNote').textContent = n.name;
        $('tCents').textContent = (n.cents >= 0 ? '+' : '') + n.cents.toFixed(1) + '¢';
        $('tFreq').textContent = r.freq.toFixed(2) + ' Hz';
        $('tNeedle').style.transform = `rotate(${Math.max(-50, Math.min(50, n.cents)) * 0.9}deg)`;
        $('tNeedle').classList.toggle('ok', Math.abs(n.cents) <= 2);
      }
    }
    requestAnimationFrame(tunerLoop);
  }
  async function tunerSelfTest(btn) {
    await guard(btn, async () => {
      const tones = [330, 440, 660], out = [];
      for (const f of tones) {
        const t0 = ctxNow() + 0.15, dur = 1.6;
        const o = S.ctx.createOscillator(), g = S.ctx.createGain();
        o.frequency.value = f; g.gain.value = 0.5;
        o.connect(g); g.connect(S.ctx.destination); o.start(t0); o.stop(t0 + dur);
        await waitUntilCtx(t0 + dur + 0.1);
        const readings = [];
        for (let t = t0; t + 2048 / S.sr < t0 + dur; t += 0.01) {
          const r = D.yin(grab(Math.round(t * S.sr), 2048), S.sr);
          readings.push({ t: t - t0, c: r ? 1200 * Math.log2(r.freq / f) : null });
        }
        let stableAt = null;
        for (let i = 2; i < readings.length; i++) {
          if ([0, 1, 2].every(k => readings[i - k].c !== null && Math.abs(readings[i - k].c) <= 2)) { stableAt = readings[i - 2].t; break; }
        }
        const tail = readings.filter(r => r.t > 0.6 && r.c !== null).map(r => r.c);
        out.push({ f, medianCents: D.median(tail), stableMs: stableAt === null ? null : stableAt * 1000 });
        await sleep(200);
      }
      const worst = Math.max(...out.map(o => Math.abs(o.medianCents)));
      const slow = Math.max(...out.map(o => (o.stableMs === null ? 9999 : o.stableMs)));
      record('tuner', { pass: worst <= 2 && slow <= 300, worstCents: +worst.toFixed(2), stableMs: Math.round(slow), detail: out });
      $('tunerOut').textContent = out.map(o => `${o.f} Hz: ${o.medianCents.toFixed(2)}¢, stable in ${o.stableMs === null ? '—' : Math.round(o.stableMs) + ' ms'}`).join('\n') +
        `\nWorst error ${worst.toFixed(2)}¢ (bar: ±2¢) · slowest lock ${Math.round(slow)} ms (bar: 300 ms; includes speaker latency)`;
    });
  }

  // ---------- 2. click stability (loopback) ----------
  async function clickStability(btn) {
    await guard(btn, async () => {
      const secs = +$('stabLen').value, bpm = 120, period = 60 / bpm, n = Math.round(secs / period);
      const t0 = ctxNow() + 0.3;
      const times = Array.from({ length: n }, (_, i) => t0 + i * period);
      const gaps0 = S.gaps;
      scheduleClicks(times, 4, 0.9);
      const det = new D.BandOnsetDetector(S.sr, 1800, 3200);
      const prog = setInterval(() => { $('stabOut').textContent = `Running… ${Math.max(0, Math.round(times[n - 1] - ctxNow()))} s left. Keep the phone still and the room quiet.`; }, 500);
      const on = await collectOnsets(det, times[n - 1] + 0.3);
      clearInterval(prog);
      // estimate the loopback delay from the first clicks, then match every click around it
      const est = [];
      for (const t of times.slice(0, 8)) { const c = on.find(o => o - t > 0 && o - t < 0.5); if (c !== undefined) est.push(c - t); }
      const lat = est.length ? D.median(est) : 0;
      const m = D.matchOnsets(on, times.map(t => t + lat), 0.05);
      const hits = m.filter(r => r.onset !== null).map(r => r.onset);
      const ioi = []; for (let i = 1; i < hits.length; i++) ioi.push((hits[i] - hits[i - 1]) * 1000);
      const dev = ioi.map(x => x - period * 1000);
      const jitter = D.std(dev), worst = Math.max(...dev.map(Math.abs));
      const gaps = S.gaps - gaps0;
      record('clickJitter', { pass: jitter < 1 && gaps === 0 && hits.length >= 0.95 * n, jitterMs: +jitter.toFixed(3), worstMs: +worst.toFixed(2), heard: `${hits.length}/${n}`, captureGaps: gaps, seconds: secs });
      $('stabOut').textContent = `Heard ${hits.length}/${n} clicks · jitter (std) ${jitter.toFixed(3)} ms (bar: < 1 ms) · worst ${worst.toFixed(2)} ms · capture gaps ${gaps}` +
        (hits.length < 0.9 * n ? '\nMany clicks not heard: turn the media volume up.' : '');
    });
  }

  // ---------- 3. round-trip latency (loopback) ----------
  async function latencyLoopback(btn) {
    await guard(btn, async () => {
      const t0 = ctxNow() + 0.3, times = Array.from({ length: 16 }, (_, i) => t0 + i * 0.75);
      scheduleClicks(times, 0, 0.9);
      const det = new D.BandOnsetDetector(S.sr, 1800, 3200);
      const on = await collectOnsets(det, times[15] + 0.6);
      const offs = [];
      for (const t of times) { const c = on.filter(o => o - t > 0 && o - t < 0.6).sort((a, b) => a - b)[0]; if (c !== undefined) offs.push((c - t) * 1000); }
      if (offs.length < 10) { $('latOut').textContent = `Only heard ${offs.length}/16 clicks. Turn media volume up and retry.`; return; }
      const s = [...offs].sort((a, b) => a - b), p10 = s[Math.floor(s.length * 0.1)], p90 = s[Math.ceil(s.length * 0.9) - 1];
      const med = D.median(offs), spread = (p90 - p10) / 2;
      record('latencyLoopback', { pass: spread <= 5, roundTripMs: +med.toFixed(1), repeatabilityMs: +spread.toFixed(2), heard: `${offs.length}/16`,
        outputLatencyMs: S.ctx.outputLatency ? +(S.ctx.outputLatency * 1000).toFixed(1) : null, baseLatencyMs: +(S.ctx.baseLatency * 1000).toFixed(1) });
      $('latOut').textContent = `Round trip ${med.toFixed(1)} ms · repeatable within ±${spread.toFixed(2)} ms (bar: ±5 ms) · heard ${offs.length}/16`;
    });
  }

  // ---------- 4. strum-along calibration ----------
  async function strumCalibrate(btn) {
    await guard(btn, async () => {
      const bpm = 80, p = 60 / bpm, t0 = ctxNow() + 0.4;
      const countIn = Array.from({ length: 4 }, (_, i) => t0 + i * p);
      const times = Array.from({ length: 16 }, (_, i) => t0 + (4 + i) * p);
      scheduleClicks([...countIn, ...times], 4, 0.7);
      const det = new D.OnsetDetector(S.sr);
      // learn bleed during count-in
      const l = (d, f) => det.push(d, f);
      S.listeners.add(l);
      $('calOut').textContent = 'Count-in: listen… then strum muted strings ON each click (16 strums).';
      await waitUntilCtx(times[0] - 0.08);
      S.listeners.delete(l);
      det.learnBleed();
      const lb = getResult('latencyLoopback');
      const arrive = lb ? lb.roundTripMs / 1000 : 0.08;
      det.isNearClick = fr => times.some(t => Math.abs(fr / S.sr - (t + arrive)) < 0.03);
      let k = 0;
      const on = await collectOnsets(det, times[15] + 0.5, () => { $('calOut').textContent = `Strums heard: ${++k}/16`; });
      const first = D.matchOnsets(on, times, 0.3).filter(r => r.err !== null).map(r => r.err);
      if (first.length < 8) { $('calOut').textContent = `Only ${first.length} strums matched. Strum harder (muted) and retry.`; return; }
      const guess = D.median(first);
      const m = D.matchOnsets(on, times.map(t => t + guess), 0.12).filter(r => r.err !== null).map(r => (r.err + guess) * 1000);
      const off = D.median(m), spread = D.std(m);
      record('calibration', { offsetMs: +off.toFixed(1), spreadMs: +spread.toFixed(1), matched: `${m.length}/16` });
      $('calOut').textContent = `Calibration offset ${off.toFixed(1)} ms (your timing + audio delay) · spread ${spread.toFixed(1)} ms · matched ${m.length}/16\nSaved for this input and posture.`;
    });
  }

  // ---------- 5. onset timing test ----------
  async function timingTest(btn) {
    await guard(btn, async () => {
      const cal = getResult('calibration');
      if (!cal) { alertBox('Run step 4 (calibration) first, in this posture.'); return; }
      const bpm = 80, beat = 60 / bpm, slot = beat / 2, bars = 8, t0 = ctxNow() + 0.4;
      const countIn = Array.from({ length: 4 }, (_, i) => t0 + i * beat);
      const start = t0 + 4 * beat;
      const clicks = Array.from({ length: bars * 4 }, (_, i) => start + i * beat);
      const slots = Array.from({ length: bars * 8 }, (_, i) => start + i * slot);
      scheduleClicks([...countIn, ...clicks], 4, 0.6);
      const det = new D.OnsetDetector(S.sr);
      const l = (d, f) => det.push(d, f);
      S.listeners.add(l);
      $('timOut').textContent = 'Count-in… then strum eighth notes (down-up) on a G chord for 8 bars.';
      await waitUntilCtx(start - 0.1);
      S.listeners.delete(l);
      det.learnBleed();
      const lb = getResult('latencyLoopback'), arrive = lb ? lb.roundTripMs / 1000 : cal.offsetMs / 1000;
      det.isNearClick = fr => clicks.some(t => Math.abs(fr / S.sr - (t + arrive)) < 0.03);
      let k = 0;
      const on = await collectOnsets(det, slots[slots.length - 1] + 0.4, () => { $('timOut').textContent = `Strums heard: ${++k}/${slots.length}`; });
      const offS = cal.offsetMs / 1000;
      const m = D.matchOnsets(on.map(o => o - offS), slots, slot / 2);
      const hits = m.filter(r => r.err !== null), errs = hits.map(r => r.err * 1000);
      const mae = D.mean(errs.map(Math.abs)), bias = D.mean(errs), hitRatio = hits.length / slots.length;
      record('timing', { pass: mae <= 15 && hitRatio >= 0.9, meanAbsErrMs: +mae.toFixed(1), biasMs: +bias.toFixed(1), hits: `${hits.length}/${slots.length}`, extra: on.length - hits.length });
      $('timOut').textContent = `Mean error ${mae.toFixed(1)} ms (bar: ≤ 15 ms) · ${bias >= 0 ? 'behind' : 'ahead of'} the beat by ${Math.abs(bias).toFixed(1)} ms on average · hit ${hits.length}/${slots.length} · extra onsets ${on.length - hits.length}`;
    });
  }

  // ---------- 6. chord verification ----------
  const GFAM = [
    { id: 'G', frets: [3, 2, 0, 0, 3, 3] },
    { id: 'Cadd9', frets: [-1, 3, 2, 0, 3, 3] },
    { id: 'Dsus4', frets: [-1, -1, 0, 2, 3, 3] },
    { id: 'Em7', frets: [0, 2, 2, 0, 3, 3] },
  ].map(c => Object.assign(c, { template: D.chordTemplate(c.frets) }));
  const fretStr = f => f.map(x => (x < 0 ? 'x' : x)).join('');
  function chromaAfter(onsetFrame) {
    const acc = new Array(12).fill(0), N = 8192;
    for (let t = 0.06; t + N / S.sr <= 0.47; t += 0.03) {
      D.chroma(grab(onsetFrame + Math.round(t * S.sr), N), S.sr).forEach((v, i) => (acc[i] += v));
    }
    return D.normalize(acc);
  }
  function drawChroma(ch) {
    $('chromaBars').innerHTML = ch.map((v, i) => `<div class="bar"><i style="height:${Math.round(v * 100)}%"></i><b>${D.NOTE_NAMES[i]}</b></div>`).join('');
  }
  async function chordTest(btn) {
    await guard(btn, async () => {
      const trials = [];
      const order = [];
      for (let r = 0; r < 5; r++) order.push(...GFAM.map(c => c.id));
      order.sort(() => Math.random() - 0.5);
      const conf = {};
      for (let i = 0; i < order.length; i++) {
        const target = GFAM.find(c => c.id === order[i]);
        $('chordPrompt').innerHTML = `<span class="big">${target.id}</span><span class="frets">${fretStr(target.frets)}</span><span class="sub">Trial ${i + 1}/${order.length}: strum once and let it ring</span>`;
        const det = new D.OnsetDetector(S.sr);
        const onsetFrame = await new Promise(resolve => {
          const l = (d, f) => { const r = det.push(d, f); if (r.length) { S.listeners.delete(l); clearTimeout(to); resolve(r[0]); } };
          const to = setTimeout(() => { S.listeners.delete(l); resolve(null); }, 20000);
          S.listeners.add(l);
        });
        if (onsetFrame === null) { $('chordPrompt').innerHTML = '<span class="sub">No strum heard for 20 s, so the test stopped. Tap Run to start again.</span>'; return; }
        while (S.wAbs < onsetFrame + Math.round(0.5 * S.sr)) await sleep(20);
        const ch = chromaAfter(onsetFrame);
        drawChroma(ch);
        const res = D.classifyChord(ch, GFAM);
        trials.push({ target: target.id, heard: res.best, margin: +res.margin.toFixed(3) });
        conf[`${target.id}→${res.best}`] = (conf[`${target.id}→${res.best}`] || 0) + 1;
        $('chordLog').innerHTML = trials.map(t => `<span class="${t.target === t.heard ? 'ok' : 'bad'}">${t.target}${t.target === t.heard ? '' : '→' + t.heard}</span>`).join(' ');
        await sleep(700);
      }
      const correct = trials.filter(t => t.target === t.heard).length;
      const usb = /usb|kemper|interface/i.test(S.deviceLabel);
      const bar = usb ? 0.95 : 0.9;
      record('chordVerify', { pass: correct / trials.length >= bar, accuracy: +(correct / trials.length).toFixed(3), bar, correct: `${correct}/${trials.length}`, confusion: conf });
      $('chordPrompt').innerHTML = `<span class="big">${Math.round(100 * correct / trials.length)}%</span><span class="sub">${correct}/${trials.length} correct (bar: ${bar * 100}% ${usb ? 'USB' : 'mic'})</span>`;
    });
  }

  // ---------- 7. fold / unfold ----------
  function logEvent(what) {
    const tr = S.stream && S.stream.getAudioTracks()[0];
    const st = tr ? tr.getSettings() : {};
    const ev = {
      t: new Date().toLocaleTimeString(), what, posture: posture(), size: `${window.innerWidth}×${window.innerHeight}`,
      ctx: S.ctx ? S.ctx.state : 'none', outLatMs: S.ctx && S.ctx.outputLatency ? +(S.ctx.outputLatency * 1000).toFixed(1) : null,
      mic: tr ? tr.label : '-', micSettings: st.sampleRate ? `${st.sampleRate} Hz · ${st.channelCount || '?'} ch · latency ${st.latency != null ? (st.latency * 1000).toFixed(0) + ' ms' : '?'}` : '-',
      captureGaps: S.gaps,
    };
    S.events.push(ev);
    if (S.events.length > 60) S.events.shift();
    const el = $('foldLog');
    if (el) el.textContent = S.events.slice().reverse().map(e => `${e.t}  ${e.what}  [${e.posture} ${e.size}]  audio:${e.ctx}  out:${e.outLatMs ?? '?'}ms  gaps:${e.captureGaps}\n    mic: ${e.mic} (${e.micSettings})`).join('\n');
    renderStatus();
  }
  let lastPosture = posture();
  window.addEventListener('resize', () => { const p = posture(); if (p !== lastPosture) { lastPosture = p; logEvent('posture → ' + p); renderResults(); } });
  if (screen.orientation) screen.orientation.addEventListener('change', () => logEvent('orientation ' + screen.orientation.type));
  document.addEventListener('visibilitychange', () => logEvent('page ' + document.visibilityState));

  async function foldTest(btn) {
    await guard(btn, async () => {
      const bpm = 100, p = 60 / bpm, n = 60, t0 = ctxNow() + 0.3;
      const times = Array.from({ length: n }, (_, i) => t0 + i * p);
      scheduleClicks(times, 4, 0.9);
      const gaps0 = S.gaps, startPosture = posture();
      let changes = 0;
      const onResize = () => { changes++; };
      window.addEventListener('resize', onResize);
      const det = new D.BandOnsetDetector(S.sr, 1800, 3200);
      const prog = setInterval(() => { $('foldOut').textContent = `Click running for ${Math.max(0, Math.round(times[n - 1] - ctxNow()))} s: fold and unfold the phone 2–3 times now.`; }, 400);
      const on = await collectOnsets(det, times[n - 1] + 0.3);
      clearInterval(prog);
      window.removeEventListener('resize', onResize);
      const est = [];
      for (const t of times.slice(0, 6)) { const c = on.find(o => o - t > 0 && o - t < 0.5); if (c !== undefined) est.push(c - t); }
      const lat = est.length ? D.median(est) : 0;
      const m = D.matchOnsets(on, times.map(t => t + lat), 0.05);
      const hits = m.filter(r => r.onset !== null);
      const devs = hits.map(r => Math.abs(r.err) * 1000);
      const worst = devs.length ? Math.max(...devs) : NaN;
      const gaps = S.gaps - gaps0;
      record('foldUnfold', { pass: gaps === 0 && hits.length >= n - 2 && worst < 5 && changes > 0, foldChanges: changes, heard: `${hits.length}/${n}`, worstClickShiftMs: +worst.toFixed(2), captureGaps: gaps, startPosture });
      $('foldOut').textContent = changes === 0 ? 'No fold/unfold detected during the test. Run again and fold the phone while it clicks.' :
        `Posture changes ${changes} · clicks heard ${hits.length}/${n} · worst click shift ${worst.toFixed(2)} ms · capture gaps ${gaps} → ${gaps === 0 && worst < 5 ? 'no dropout' : 'DROPOUT'}`;
    });
  }

  // ---------- devices / status / results ----------
  async function listDevices() {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    const sel = $('inputSel');
    sel.innerHTML = devs.map(d => `<option value="${d.deviceId}" ${d.deviceId === S.deviceId ? 'selected' : ''}>${d.label || 'Microphone ' + d.deviceId.slice(0, 6)}</option>`).join('');
  }
  function renderChannels() {
    const sel = $('chanSel');
    sel.innerHTML = Array.from({ length: S.channels }, (_, i) => `<option value="${i}" ${i === S.ch ? 'selected' : ''}>Channel ${i + 1}</option>`).join('');
    $('chanWrap').style.display = S.channels > 1 ? '' : 'none';
  }
  function renderStatus() {
    const el = $('status');
    if (!S.ctx) { el.textContent = 'Audio not started'; return; }
    el.textContent = `${S.ctx.state} · ${S.sr} Hz · out ${S.ctx.outputLatency ? (S.ctx.outputLatency * 1000).toFixed(0) + ' ms' : '?'} · in: ${routeKey()} · ${posture()} · gaps ${S.gaps}`;
  }
  let levelPeak = 0;
  function levelLoop() {
    if (S.ring) {
      const b = grab(S.wAbs - 1024, 1024);
      let pk = 0; for (const x of b) pk = Math.max(pk, Math.abs(x));
      levelPeak = Math.max(pk, levelPeak * 0.92);
      $('level').style.width = Math.min(100, Math.round(Math.sqrt(levelPeak) * 100)) + '%';
    }
    requestAnimationFrame(levelLoop);
  }

  const TESTS = [
    ['tuner', 'Tuner accuracy', r => `${r.worstCents}¢ worst · lock ${r.stableMs} ms`, '±2¢, stable ≤ 300 ms'],
    ['clickJitter', 'Click stability', r => `${r.jitterMs} ms jitter · ${r.heard} · gaps ${r.captureGaps}`, '< 1 ms'],
    ['latencyLoopback', 'Round-trip latency', r => `${r.roundTripMs} ms · ±${r.repeatabilityMs} ms`, 'repeatable ±5 ms'],
    ['calibration', 'Strum calibration', r => `${r.offsetMs} ms · spread ${r.spreadMs} ms`, '(measured)'],
    ['timing', 'Onset timing @80 8ths', r => `${r.meanAbsErrMs} ms · hit ${r.hits}`, '≤ 15 ms'],
    ['chordVerify', 'Chord verify (G family)', r => `${Math.round(r.accuracy * 100)}% (${r.correct})`, '≥ 90% mic / 95% USB'],
    ['foldUnfold', 'Fold/unfold', r => `gaps ${r.captureGaps} · shift ${r.worstClickShiftMs} ms · ${r.foldChanges} changes`, 'no dropout'],
  ];
  function renderResults() {
    const cols = [];
    for (const [route, ps] of Object.entries(S.results)) for (const p of Object.keys(ps)) cols.push([route, p]);
    if (!cols.length) { $('results').innerHTML = '<p class="muted">No results yet. Run the tests above; results are saved on this phone.</p>'; return; }
    let h = '<table><thead><tr><th>Test</th><th>Bar</th>' + cols.map(([r, p]) => `<th>${esc(r)}<br><small>${p}</small></th>`).join('') + '</tr></thead><tbody>';
    for (const [key, name, fmt, bar] of TESTS) {
      h += `<tr><td>${name}</td><td class="muted">${bar}</td>` + cols.map(([r, p]) => {
        const v = S.results[r][p][key];
        if (!v) return '<td class="muted">—</td>';
        const cls = v.pass === undefined ? '' : v.pass ? 'ok' : 'bad';
        return `<td class="${cls}">${v.pass === undefined ? '' : v.pass ? '✓ ' : '✗ '}${esc(fmt(v))}</td>`;
      }).join('') + '</tr>';
    }
    $('results').innerHTML = h + '</tbody></table>';
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function resultsText() {
    const lines = [`Guitar Trainer M0 results · ${new Date().toLocaleString()} · ${navigator.userAgent}`];
    for (const [route, ps] of Object.entries(S.results)) for (const [p, tests] of Object.entries(ps)) {
      lines.push(`\n## ${route} · ${p}`);
      for (const [key, name] of TESTS) if (tests[key]) lines.push(`- ${name}: ${JSON.stringify(tests[key])}`);
    }
    lines.push('\n## Fold/mic log'); S.events.forEach(e => lines.push(`- ${e.t} ${e.what} [${e.posture} ${e.size}] mic=${e.mic} (${e.micSettings}) out=${e.outLatMs}ms gaps=${e.captureGaps}`));
    return lines.join('\n');
  }

  // ---------- wire up ----------
  function wire() {
    $('startBtn').onclick = async () => {
      try { await startAudio($('inputSel').value || null); $('startBtn').textContent = 'Restart audio'; tunerOn = true; tunerLoop(); }
      catch (err) { alertBox('Microphone not available: ' + err.message); }
    };
    $('inputSel').onchange = async e => { S.ch = 0; await startAudio(e.target.value); };
    $('chanSel').onchange = e => { S.ch = +e.target.value; if (S.node) S.node.port.postMessage({ ch: S.ch }); renderStatus(); renderResults(); };
    $('tunerTest').onclick = e => tunerSelfTest(e.currentTarget);
    $('stabBtn').onclick = e => clickStability(e.currentTarget);
    $('latBtn').onclick = e => latencyLoopback(e.currentTarget);
    $('calBtn').onclick = e => strumCalibrate(e.currentTarget);
    $('timBtn').onclick = e => timingTest(e.currentTarget);
    $('chordBtn').onclick = e => chordTest(e.currentTarget);
    $('foldBtn').onclick = e => foldTest(e.currentTarget);
    $('copyBtn').onclick = async () => {
      try { await navigator.clipboard.writeText(resultsText()); alertBox('Results copied. Paste them into the chat.'); }
      catch (e) { $('copyArea').value = resultsText(); $('copyArea').style.display = 'block'; $('copyArea').select(); alertBox('Copy the text below.'); }
    };
    $('clearBtn').onclick = () => { if (S.clearArmed) { S.results = {}; save(); renderResults(); $('clearBtn').textContent = 'Clear results'; S.clearArmed = false; } else { S.clearArmed = true; $('clearBtn').textContent = 'Tap again to clear'; setTimeout(() => { S.clearArmed = false; $('clearBtn').textContent = 'Clear results'; }, 3000); } };
    drawChroma(new Array(12).fill(0));
    renderResults(); renderStatus(); levelLoop();
    if (!window.isSecureContext || !navigator.mediaDevices) $('secure').style.display = 'block';
  }
  document.addEventListener('DOMContentLoaded', wire);
})();
