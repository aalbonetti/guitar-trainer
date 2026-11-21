// Tuner and metronome UI: full panels (Tools screen) and the compact bar/sheet used inside lessons and songs.
import { useEffect, useState } from 'preact/hooks';
import { metro, tuner, startMetronome, stopMetronome, setMetro, tapTempo, startTuner, stopTuner, playReference, listInputs } from '../audio/engine';
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

export function MetronomePanel({ compact = false }: { compact?: boolean }) {
  const m = useStore(metro);
  return (
    <div class={`metro ${compact ? 'compact' : ''}`}>
      <div class="beats">
        {Array.from({ length: m.beats }, (_, i) => <i class={`${m.running && m.beat === i ? 'on' : ''} ${i === 0 ? 'one' : ''}`} />)}
      </div>
      <div class="bpmrow">
        <button class="round" onClick={() => setMetro({ bpm: m.bpm - (compact ? 4 : 1) })} aria-label="Slower">−</button>
        <div class="bpm"><b>{m.bpm}</b><span>BPM</span></div>
        <button class="round" onClick={() => setMetro({ bpm: m.bpm + (compact ? 4 : 1) })} aria-label="Faster">+</button>
      </div>
      {!compact ? <input type="range" min="40" max="220" value={m.bpm} onInput={e => setMetro({ bpm: +(e.target as HTMLInputElement).value })} aria-label="Tempo" /> : null}
      <div class="row center">
        <button class={m.running ? '' : 'primary'} onClick={() => (m.running ? stopMetronome() : startMetronome())}>{m.running ? 'Stop' : 'Start'}</button>
        <button onClick={tapTempo}>Tap</button>
        <select value={m.beats} onChange={e => setMetro({ beats: +(e.target as HTMLSelectElement).value })} aria-label="Beats per bar">
          {[2, 3, 4, 6].map(b => <option value={b}>{b}/4</option>)}
        </select>
        <select value={m.sub} onChange={e => setMetro({ sub: +(e.target as HTMLSelectElement).value })} aria-label="Subdivision">
          <option value={1}>♩</option><option value={2}>♫ 8ths</option><option value={3}>triplets</option><option value={4}>16ths</option>
        </select>
      </div>
      {!compact ? (
        <label class="vol">Volume <input type="range" min="0.1" max="1" step="0.05" value={m.volume} onInput={e => setMetro({ volume: +(e.target as HTMLInputElement).value })} /></label>
      ) : null}
    </div>
  );
}

/** Tuner + metronome buttons for lessons and songs; the metronome is pre-set from the page. */
export function ToolBar({ preset, label }: { preset: { bpm: number; beats: number; sub: number }; label?: string }) {
  const [open, setOpen] = useState<'tuner' | 'metro' | null>(null);
  const m = useStore(metro);
  useEffect(() => () => { if (tuner.get().on) stopTuner(); }, []);
  return (
    <div class="toolbar">
      <div class="row">
        <button class={open === 'tuner' ? 'sel' : ''} onClick={() => setOpen(open === 'tuner' ? null : 'tuner')}>🎚 Tuner</button>
        <button class={open === 'metro' ? 'sel' : ''} onClick={() => { if (!m.running) setMetro(preset); setOpen(open === 'metro' ? null : 'metro'); }}>⏱ Metronome</button>
        <button class="chip" onClick={() => { setMetro(preset); startMetronome(preset); setOpen('metro'); }}>▶ {preset.bpm} BPM{label ? ` · ${label}` : ''}</button>
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
    <label class="field">Audio input
      <select value={sel} onChange={e => { const v = (e.target as HTMLSelectElement).value; setSel(v); inputPref.set(v); if (tuner.get().on) void startTuner(v || undefined); }}>
        <option value="">Phone microphone (default)</option>
        {devs.filter(d => d.deviceId && d.deviceId !== 'default').map(d => <option value={d.deviceId}>{d.label || 'Input ' + d.deviceId.slice(0, 6)}</option>)}
      </select>
      <small>Plug in a USB interface (or the Kemper), start the tuner once to grant the mic, then come back to pick it.</small>
    </label>
  );
}
