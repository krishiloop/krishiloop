import { useMemo } from 'react';
import type { LightMode } from '../../components/three/lightModes';

/**
 * The still version of the hero: a procedurally drawn paddy (SVG). It is the poster shown while the 3D scene
 * downloads, and the whole hero in Lite mode or without WebGL. Rows converge to the horizon like the real field,
 * the light has the same three states, and in Rich/Lite a few foreground clumps sway with plain CSS.
 */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1600;
const H = 900;
const HORIZON = 372;

const SKY: Record<LightMode, { top: string; mid: string; low: string; sun: number; glow: string; field: [string, string]; leaf: [string, string, string] }> = {
  sun: { top: '#24506f', mid: '#d79a6e', low: '#fbc08a', sun: 1, glow: '#ffe3ae', field: ['#3a4a2c', '#10190d'], leaf: ['#1d4a1c', '#4f8f2a', '#d7da7a'] },
  rain: { top: '#3f4c52', mid: '#79878a', low: '#a5b2b0', sun: 0, glow: '#c9d3d3', field: ['#33463a', '#0c140f'], leaf: ['#173b27', '#356a42', '#8fb08a'] },
  dusk: { top: '#0c1033', mid: '#8b3d5a', low: '#e46a4d', sun: 0.6, glow: '#ff9a63', field: ['#23283a', '#070a12'], leaf: ['#10312f', '#256050', '#7d9a86'] },
};

interface Row {
  d: string;
  color: string;
  width: number;
  near: number;
}

export function HeroPoster({ mode, label }: { mode: LightMode; label: string }) {
  const pal = SKY[mode];
  const rows = useMemo<Row[]>(() => {
    const r = rng(7);
    const out: Row[] = [];
    const N = 16;
    for (let i = 0; i < N; i++) {
      const dpt = Math.pow((i + 1) / N, 2.1);
      const y = HORIZON + 6 + dpt * (H - HORIZON + 40);
      const scale = 0.12 + dpt * 1.5;
      const spacing = 14 + dpt * 150;
      let d = '';
      for (let x = -80 + r() * spacing; x < W + 80; x += spacing * (0.85 + r() * 0.3)) {
        const blades = 4 + Math.floor(dpt * 3);
        for (let b = 0; b < blades; b++) {
          const lean = (r() - 0.5) * 90 * scale;
          const hgt = (40 + r() * 38) * scale;
          const bx = x + (r() - 0.5) * 16 * scale;
          d += `M${bx.toFixed(1)} ${y.toFixed(1)}q${(lean * 0.2).toFixed(1)} ${(-hgt * 0.7).toFixed(1)} ${lean.toFixed(1)} ${(-hgt).toFixed(1)}`;
        }
      }
      const t = i / (N - 1);
      const color = t < 0.5 ? pal.leaf[0] : t < 0.85 ? pal.leaf[1] : pal.leaf[2];
      out.push({ d, color, width: 0.6 + dpt * 4.2, near: dpt });
    }
    return out;
  }, [pal]);

  const trees = useMemo(() => {
    const r = rng(3);
    let d = `M0 ${HORIZON}`;
    for (let x = 0; x <= W; x += 22) d += `L${x} ${(HORIZON - 4 - r() * 12 - Math.sin(x * 0.012) * 6 - (r() > 0.9 ? 16 : 0)).toFixed(1)}`;
    return `${d}L${W} ${HORIZON + 8}L0 ${HORIZON + 8}Z`;
  }, []);

  return (
    <svg className="hero-poster" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={label} data-mode={mode}>
      <defs>
        <linearGradient id="hp-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={pal.top} />
          <stop offset="0.62" stopColor={pal.mid} />
          <stop offset="1" stopColor={pal.low} />
        </linearGradient>
        <radialGradient id="hp-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={pal.glow} stopOpacity="1" />
          <stop offset="0.12" stopColor={pal.glow} stopOpacity="0.9" />
          <stop offset="0.5" stopColor={pal.glow} stopOpacity="0.22" />
          <stop offset="1" stopColor={pal.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hp-field" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={pal.field[0]} />
          <stop offset="1" stopColor={pal.field[1]} />
        </linearGradient>
        <linearGradient id="hp-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={pal.low} stopOpacity="0.7" />
          <stop offset="0.3" stopColor={pal.field[0]} stopOpacity="0.15" />
          <stop offset="1" stopColor={pal.field[1]} stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width={W} height={HORIZON + 10} fill="url(#hp-sky)" />
      {pal.sun > 0 ? <circle cx="1180" cy={HORIZON - 150} r={420} fill="url(#hp-sun)" opacity={pal.sun} /> : null}
      <path d={trees} fill={mode === 'dusk' ? '#2a1c2e' : mode === 'rain' ? '#56665f' : '#5c4a3a'} opacity="0.85" />
      <rect y={HORIZON} width={W} height={H - HORIZON} fill="url(#hp-field)" />
      <rect y={HORIZON} width={W} height={H - HORIZON} fill="url(#hp-water)" />
      {rows.map((row, i) => (
        <path key={i} d={row.d} fill="none" stroke={row.color} strokeWidth={row.width} strokeLinecap="round" className={row.near > 0.66 ? `hp-sway hp-sway-${i % 3}` : undefined} opacity={0.5 + row.near * 0.5} />
      ))}
      {mode === 'rain'
        ? Array.from({ length: 70 }, (_, i) => {
            const r = rng(i + 11);
            const x = r() * W;
            const y = r() * H;
            return <line key={i} x1={x} y1={y} x2={x - 8} y2={y + 34} stroke="#dbe6ea" strokeOpacity="0.28" strokeWidth="1.2" />;
          })
        : null}
    </svg>
  );
}
