// Tuner and metronome UI: full panels (Tools screen) and the compact bar/sheet used inside lessons and songs.
import { useEffect, useState } from 'preact/hooks';
import { metro, tuner, capture, levels, startMetronome, stopMetronome, setMetro, tapTempo, startTuner, stopTuner, playReference, listInputs, acquireCapture, releaseCapture, setInputChannel, watchLevels, channelPref, deviceKey, type MetroPreset } from '../audio/engine';
import { METERS, meterInfo, subOptions, toggleAccent } from '../audio/meter';
import { useStore, persisted } from '../store';

const STRINGS = [{ n: 'E2', f: 82.41 }, { n: 'A2', f: 110 }, { n: 'D3', f: 146.83 }, { n: 'G3', f: 196 }, { n: 'B3', f: 246.94 }, { n: 'E4', f: 329.63 }];
export const inputPref = persisted<string>('gt_input', '');

export function TunerPanel({ compact = false }: { compact?: boolean }) {
  const t = useStore(tuner);
  const inTune = t.note && Math.abs(t.cents) <= 3;
  const angle = Math.max(-50, Math.min(50, t.cents)) * 0.9;
  return (
    <div class={`tuner ${compact ? 'compact' : ''}`}>
      <div class="dial">
        <svg viewBox="0 0 200 110" width="100%">
          <path d="M20 100 A80 80 0 0 1 180 100" class="arc" />
          {[-50, -25, 0, 25, 50].map(c => { const a = (c * 0.9 - 90) * Math.PI / 180; return <line x1={100 + 72 * Math.cos(a)} y1={100 + 72 * Math.sin(a)} x2={100 + 82 * Math.cos(a)} y2={100 + 82 * Math.sin(a)} class="tick" />; })}
          <line x1="100" y1="100" x2="100" y2="28" class={`needle ${inTune ? 'ok' : ''}`} style={{ transform: `rotate(${t.note ? angle : 0}deg)`, transformOrigin: '100px 100px' }} />
        </svg>
        <div class={`note ${inTune ? 'ok' : ''}`}>{t.on ? t.note || '–' : '–'}</div>
        <div class="cents">{t.on && t.note ? `${t.cents >= 0 ? '+' : ''}${t.cents.toFixed(1)}¢ · ${t.freq.toFixed(1)} Hz` : t.on ? 'Play a string' : ' '}</div>
      </div>
      <div class="row center">
        {t.on ? <button onClick={() => stopTuner()}>Stop tuner</button>
          : <button class="primary" onClick={() => startTuner(inputPref.get() || undefined)}>Start tuner</button>}
      </div>
      {t.error ? <p class="error">Microphone: {t.error}</p> : null}
      <div class="strings">
        {STRINGS.map(s => <button class="small" onClick={() => playReference(s.f)} title={`Play ${s.n}`}>{s.n.replace(/\d/, '')}<sub>{s.n.slice(-1)}</sub></button>)}
      </div>
      {!compact ? <p class="muted">Tap a string name to hear its reference pitch. Green = within 3 cents.</p> : null}
    </div>
  );
}

/** Beat lights. Tap one to toggle its accent. In 6/8 there's one light per eighth, grouped 3 + 3. */
export function BeatLights() {
  const m = useStore(metro);
  const mi = meterInfo(m.meter);
  return (
    <div class={`beats ${mi.compound ? 'compound' : ''}`} role="group" aria-label="Beats: tap to toggle an accent">
      {Array.from({ length: mi.lights }, (_, i) => (
        <button type="button" class={`light ${m.running && m.light === i ? 'on' : ''} ${m.accents.includes(i) ? 'acc' : ''} ${i % mi.lightsPerBeat === 0 ? 'pulse' : 'eighth'} ${mi.compound && i === 3 ? 'group' : ''}`}
          aria-pressed={m.accents.includes(i)} aria-label={`${mi.compound ? 'Eighth' : 'Beat'} ${i + 1}${m.accents.includes(i) ? ', accented' : ''}`}
          onClick={() => setMetro({ accents: toggleAccent(m.accents, i) })} />
      ))}
    </div>
  );
}

export function MetronomePanel({ compact = false }: { compact?: boolean }) {
  const m = useStore(metro);
  const mi = meterInfo(m.meter);
  return (
    <div class={`metro ${compact ? 'compact' : ''}`}>
      <BeatLights />
      <div class="bpmrow">
        <button class="round" onClick={() => setMetro({ bpm: m.bpm - (compact ? 4 : 1) })} aria-label="Slower">−</button>
        <div class="bpm"><b>{m.bpm}</b><span>{mi.compound ? 'BPM (♩.)' : 'BPM'}</span></div>
        <button class="round" onClick={() => setMetro({ bpm: m.bpm + (compact ? 4 : 1) })} aria-label="Faster">+</button>
      </div>
      {!compact ? <input type="range" min="40" max="220" value={m.bpm} onInput={e => setMetro({ bpm: +(e.target as HTMLInputElement).value })} aria-label="Tempo" /> : null}
      <div class="row center">
        <button class={m.running ? '' : 'primary'} onClick={() => (m.running ? stopMetronome() : startMetronome())}>{m.running ? 'Stop' : 'Start'}</button>
        <button onClick={tapTempo}>Tap</button>
        <select value={m.meter} onChange={e => setMetro({ meter: (e.target as HTMLSelectElement).value })} aria-label="Meter">
          {METERS.map(x => <option value={x}>{x}</option>)}
        </select>
        <select value={m.sub} onChange={e => setMetro({ sub: +(e.target as HTMLSelectElement).value })} aria-label="Subdivision">
          {subOptions(m.meter).map(o => <option value={o.v}>{o.label}</option>)}
        </select>
      </div>
      {!compact ? <p class="muted small">{mi.compound ? '6/8: the tempo counts the two big beats (dotted quarters), the way 6/8 worship songs list it. ' : ''}Tap a beat light to accent it.</p> : null}
      {!compact ? (
        <label class="vol">Volume <input type="range" min="0.1" max="1" step="0.05" value={m.volume} onInput={e => setMetro({ volume: +(e.target as HTMLInputElement).value })} /></label>
      ) : null}
    </div>
  );
}

/** Tuner + metronome buttons for lessons and songs; the metronome is pre-set from the page. */
export function ToolBar({ preset, label, goal }: { preset: MetroPreset & { bpm: number }; label?: string; goal?: number }) {
  const [open, setOpen] = useState<'tuner' | 'metro' | null>(null);
  const m = useStore(metro);
  useEffect(() => () => { if (tuner.get().on) stopTuner(); }, []);
  return (
    <div class="toolbar">
      <div class="row">
        <button class={open === 'tuner' ? 'sel' : ''} onClick={() => setOpen(open === 'tuner' ? null : 'tuner')}>🎚 Tuner</button>
        <button class={open === 'metro' ? 'sel' : ''} onClick={() => { if (!m.running) setMetro(preset); setOpen(open === 'metro' ? null : 'metro'); }}>⏱ Metronome</button>
        <button class="chip" onClick={() => { setMetro(preset); startMetronome(preset); setOpen('metro'); }}>▶ {preset.bpm} BPM{preset.meter && preset.meter !== '4/4' ? ` · ${preset.meter}` : ''}{label ? ` · ${label}` : ''}</button>
        {goal && goal !== preset.bpm ? <button class="chip ghost" onClick={() => { const p = { ...preset, bpm: goal }; setMetro(p); startMetronome(p); setOpen('metro'); }}>🎯 {goal} goal</button> : null}
      </div>
      {open === 'tuner' ? <div class="sheet"><TunerPanel compact /></div> : null}
      {open === 'metro' ? <div class="sheet"><MetronomePanel compact /></div> : null}
    </div>
  );
}

/** Always-visible strip while the click is running, on any screen. */
export function MetroStrip() {
  const m = useStore(metro);
  if (!m.running) return null;
  return (
    <div class="metrostrip">
      <span class="dots">{Array.from({ length: m.beats }, (_, i) => <i class={m.beat === i ? 'on' : ''} />)}</span>
      <button class="small" onClick={() => setMetro({ bpm: m.bpm - 2 })}>−</button>
      <b>{m.bpm}</b>
      <button class="small" onClick={() => setMetro({ bpm: m.bpm + 2 })}>+</button>
      <button class="small" onClick={stopMetronome}>■ Stop</button>
    </div>
  );
}

export function InputPicker() {
  const [devs, setDevs] = useState<MediaDeviceInfo[]>([]);
  const [sel, setSel] = useState(inputPref.get());
  useEffect(() => { void listInputs().then(setDevs); }, []);
  return (
    <div>
      <label class="field">Audio input
        <select value={sel} onChange={e => { const v = (e.target as HTMLSelectElement).value; setSel(v); inputPref.set(v); if (tuner.get().on) void startTuner(v || undefined); }}>
          <option value="">Phone microphone (default)</option>
          {devs.filter(d => d.deviceId && d.deviceId !== 'default').map(d => <option value={d.deviceId}>{d.label || 'Input ' + d.deviceId.slice(0, 6)}</option>)}
        </select>
        <small>Plug in a USB interface (or the Kemper), start the tuner once to grant the mic, then come back to pick it.</small>
      </label>
      <ChannelPicker device={sel} />
    </div>
  );
}

/** Which channel of the input to grade from (per input). Opens the input while shown so the level bars show
 *  where the guitar is. On the Kemper, pick a dry or clean channel: delay and reverb blur notes and strums. */
function ChannelPicker({ device }: { device: string }) {
  const cap = useStore(capture); const lv = useStore(levels);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!show) return;
    const off = watchLevels(); setErr('');
    acquireCapture('settings', device || undefined).catch(e => { setErr((e as Error).message || 'Microphone not available'); setShow(false); });
    return () => { off(); releaseCapture('settings'); };
  }, [show, device]);
  const saved = Object.entries(channelPref.get()).filter(([k, ch]) => ch > 0 && !k.startsWith('id:'));
  // input closed (e.g. after a reload): show the channel saved for the selected input, which is what grading will use
  const savedHere = channelPref.get()[deviceKey(device || undefined)];
  const showCh = cap.on && cap.channels > 1 ? `channel ${cap.channel + 1} of ${cap.channels}` : !cap.on && savedHere !== undefined ? `channel ${savedHere + 1} (saved for this input)` : 'channel 1';
  return (
    <div class="chanpick">
      {!show ? <>
        <p class="muted small">Grading listens to {showCh} of the input{saved.length ? ` · saved: ${saved.map(([l, ch]) => `${l} → ch ${ch + 1}`).join(', ')}` : ''}.</p>
        <button class="small" onClick={() => setShow(true)}>Choose input channel</button>
      </> : <>
        <p class="small">{cap.on ? <><b>{cap.label}</b>: {cap.channels} channel{cap.channels === 1 ? '' : 's'}.</> : 'Opening the input…'} {cap.channels > 1 ? 'Play a few notes; the bar that moves is your guitar. Tap it to grade from that channel. On the Kemper pick a dry or clean channel (no delay or reverb).' : cap.on ? 'Nothing to choose: this input has one channel.' : ''}</p>
        <ul class="chanlist">
          {Array.from({ length: cap.on ? cap.channels : 0 }, (_, i) => {
            const pk = lv.peaks[i] || 0, db = pk > 0 ? 20 * Math.log10(pk) : -90, w = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
            return <li><button class={`chan ${cap.channel === i ? 'sel' : ''}`} aria-pressed={cap.channel === i} onClick={() => setInputChannel(i)}>
              <span>Ch {i + 1}</span><span class="meter"><i style={{ width: `${w}%` }} /></span><small>{pk > 0 ? `${db.toFixed(0)} dB` : '–'}</small></button></li>;
          })}
        </ul>
        <button class="small" onClick={() => setShow(false)}>Done</button>
      </>}
      {err ? <p class="error">{err}</p> : null}
    </div>
  );
}
