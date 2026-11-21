// SVG chord diagrams, fretboard scale diagrams and strum grids.
import type { Shape } from '../music';
import type { Scale, Strum } from '../catalog';

export function ChordDiagram({ name, shape, size = 1 }: { name: string; shape: Shape | null; size?: number }) {
  if (!shape) return <div class="chord missing"><b>{name}</b><span>no diagram</span></div>;
  const fretted = shape.frets.filter(f => f > 0);
  const max = fretted.length ? Math.max(...fretted) : 0, min = fretted.length ? Math.min(...fretted) : 0;
  const start = max <= 4 ? 1 : min;
  const rows = Math.max(4, max - start + 1);
  const W = 92 * size, sx = 14 * size, gap = 13 * size, fh = 17 * size, top = 22 * size;
  const H = top + rows * fh + 8 * size;
  const x = (s: number) => sx + s * gap; // s: 0 = string 6
  const y = (f: number) => top + (f - start + 0.5) * fh;
  return (
    <figure class="chord">
      <figcaption>{name}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${name} chord diagram`}>
        {start === 1
          ? <rect x={x(0)} y={top - 3 * size} width={gap * 5} height={3 * size} class="nut" />
          : <text x={x(5) + 6 * size} y={top + fh * 0.7} class="fretno">{start}</text>}
        {Array.from({ length: rows + 1 }, (_, i) => <line x1={x(0)} x2={x(5)} y1={top + i * fh} y2={top + i * fh} class="fret" />)}
        {Array.from({ length: 6 }, (_, s) => <line x1={x(s)} x2={x(s)} y1={top} y2={top + rows * fh} class="string" />)}
        {shape.barre ? (() => {
          const on = shape.frets.map((f, i) => (f === shape.barre ? i : -1)).filter(i => i >= 0);
          return on.length > 1 ? <rect x={x(on[0]) - 5 * size} y={y(shape.barre!) - 5 * size} width={x(on[on.length - 1]) - x(on[0]) + 10 * size} height={10 * size} rx={5 * size} class="dot" /> : null;
        })() : null}
        {shape.frets.map((f, s) => f < 0
          ? <text x={x(s)} y={top - 7 * size} class="mark">×</text>
          : f === 0 ? <circle cx={x(s)} cy={top - 10 * size} r={3.5 * size} class="open" />
          : <g><circle cx={x(s)} cy={y(f)} r={5.5 * size} class="dot" />
              {shape.fingers && shape.fingers[s] ? <text x={x(s)} y={y(f) + 3.5 * size} class="finger">{shape.fingers[s]}</text> : null}</g>)}
      </svg>
      {shape.note ? <small>{shape.note}</small> : null}
    </figure>
  );
}

export function ScaleDiagram({ scale }: { scale: Scale }) {
  const all = scale.frets.flat();
  const lo = Math.max(0, Math.min(...all) - (Math.min(...all) > 0 ? 1 : 0)), hi = Math.max(...all);
  const n = hi - lo + 1, cw = 30, rh = 16, left = 18, top = 14;
  const W = left + n * cw + 8, H = top + 5 * rh + 26;
  const rootPc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[scale.root[0] as 'C'] + (scale.root[1] === '#' ? 1 : scale.root[1] === 'b' ? -1 : 0);
  const open = [40, 45, 50, 55, 59, 64];
  return (
    <figure class="scale">
      <figcaption>{scale.name}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: `${W * 1.6}px` }} role="img" aria-label={scale.name}>
        {Array.from({ length: 6 }, (_, r) => <line x1={left} x2={left + n * cw} y1={top + r * rh} y2={top + r * rh} class="string" />)}
        {Array.from({ length: n + 1 }, (_, i) => <line x1={left + i * cw} x2={left + i * cw} y1={top} y2={top + 5 * rh} class={lo + i === 0 ? 'nut-line' : 'fret'} />)}
        {Array.from({ length: n }, (_, i) => <text x={left + (i + 0.5) * cw} y={top + 5 * rh + 16} class="fretno">{lo + i}</text>)}
        {scale.frets.map((fs, s) => fs.map(f => {
          const row = 5 - s; // string 1 on top, like tab
          const isRoot = ((open[s] + f) % 12 + 12) % 12 === ((rootPc % 12) + 12) % 12;
          const cx = f === 0 ? left - 8 : left + (f - lo - 0.5) * cw;
          return <circle cx={cx} cy={top + row * rh} r={6} class={isRoot ? 'root' : 'dot'} />;
        }))}
      </svg>
      <small>Top line = high E string. Filled orange = root.</small>
    </figure>
  );
}

export function StrumGrid({ strum, active = -1 }: { strum: Strum; active?: number }) {
  const per = strum.grid / (strum.meter.startsWith('3') ? 3 : 4);
  const label = (i: number) => (per === 2 ? (i % 2 ? '&' : String(i / 2 + 1)) : per === 4 ? ['', 'e', '&', 'a'][i % 4] || String(i / 4 + 1) : String(i + 1));
  return (
    <figure class="strum">
      <figcaption>{strum.name || strum.id} <small>{strum.meter}{strum.palm_mute ? ' · palm mute' : ''}</small></figcaption>
      <div class="grid" style={{ gridTemplateColumns: `repeat(${strum.grid}, 1fr)` }}>
        {strum.steps.map((s, i) => (
          <div class={`cell ${strum.accents.includes(i) ? 'acc' : ''} ${i === active ? 'on' : ''}`}>
            <b>{s === 'D' ? '↓' : s === 'U' ? '↑' : s === 'X' ? '✕' : '·'}</b>
            <span>{per === 4 && i % 4 === 0 ? i / 4 + 1 : label(i)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}
