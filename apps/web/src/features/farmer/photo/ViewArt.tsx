import { useId } from 'react';
import type { ViewArt as Art } from './report';

/**
 * Small illustrations for "photograph this next": what to point the camera at, with the sign to look for picked out in
 * gold. Drawn, not photographed, so they stay tiny and work in both themes. The gold ring breathes gently (decorative:
 * it stops with reduced motion).
 */
export function ViewArt({ art, className }: { art: Art; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={className} viewBox="0 0 132 96" aria-hidden focusable="false">
      <defs>
        <linearGradient id={`${id}-pale`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#7da560" />
          <stop offset="1" stopColor="#c1de9d" />
        </linearGradient>
        <linearGradient id={`${id}-green`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#376f29" />
          <stop offset="1" stopColor="#7cbd52" />
        </linearGradient>
      </defs>
      {art === 'underside' ? <Underside id={id} /> : art === 'close_up' ? <CloseUp id={id} /> : <AnotherLeaf id={id} />}
    </svg>
  );
}

const GOLD = 'var(--color-sun)';

function Underside({ id }: { id: string }) {
  const dots: [number, number, number][] = [
    [50, 40, 1.8],
    [57, 36, 1.4],
    [62, 43, 2],
    [54, 48, 1.5],
    [47, 46, 1.3],
    [60, 51, 1.6],
    [66, 38, 1.2],
    [52, 33, 1.3],
    [45, 38, 1.1],
    [58, 44, 1],
    [64, 49, 1.3],
    [49, 52, 1.2],
  ];
  return (
    <g>
      <g transform="translate(10 12) rotate(10 50 40)">
        <path d="M8 66C2 40 24 14 66 8c28 20 22 52-12 64C34 80 14 76 8 66Z" fill={`url(#${id}-pale)`} stroke="#6f9453" strokeWidth="2" />
        <path d="M11 70C32 50 52 30 66 11" stroke="#eef7da" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        <path d="M30 53 24 36M30 53l18 2M42 41 36 26M42 41l18 1M53 30l-4-11M53 30l16 3" stroke="#eef7da" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity=".85" />
        <g fill="#fff">
          {dots.map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} opacity={0.65 + (i % 3) * 0.12} />
          ))}
        </g>
        <circle className="va-ring" cx="55" cy="43" r="16" fill="none" stroke={GOLD} strokeWidth="2.2" strokeDasharray="4 4" strokeLinecap="round" />
      </g>
      {/* turn the leaf over */}
      <path d="M92 22c14-8 26 2 24 16" fill="none" stroke={GOLD} strokeWidth="2.6" strokeLinecap="round" className="va-flip" />
      <path d="m110 36 6 3 3-7" fill="none" stroke={GOLD} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function CloseUp({ id }: { id: string }) {
  return (
    <g>
      <g transform="rotate(-32 66 50)">
        <rect x="-10" y="26" width="150" height="48" rx="14" fill={`url(#${id}-green)`} stroke="#2c5a22" strokeWidth="2" />
        <path d="M-6 50h140M-6 38h140M-6 62h140" stroke="#bfe1a0" strokeWidth="1.2" opacity=".5" />
        <ellipse cx="66" cy="50" rx="30" ry="10.5" fill="#d6c25a" opacity=".55" />
        <ellipse cx="66" cy="50" rx="22" ry="7.5" fill="#6a3f20" />
        <ellipse cx="66" cy="50" rx="13" ry="3.8" fill="#cfd3c6" />
      </g>
      <circle className="va-ring" cx="66" cy="50" r="30" fill="none" stroke={GOLD} strokeWidth="2.6" />
      <path d="m88 72 18 16" stroke={GOLD} strokeWidth="5" strokeLinecap="round" />
    </g>
  );
}

function AnotherLeaf({ id }: { id: string }) {
  return (
    <g>
      <g transform="translate(6 22) rotate(-10 40 36)">
        <path d="M6 54C2 32 20 10 56 6c22 16 18 44-10 54C28 66 10 64 6 54Z" fill="none" stroke={GOLD} strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" className="va-ring" />
      </g>
      <g transform="translate(52 20) rotate(12 40 36)">
        <path d="M6 54C2 32 20 10 56 6c22 16 18 44-10 54C28 66 10 64 6 54Z" fill={`url(#${id}-green)`} stroke="#2c5a22" strokeWidth="2" />
        <path d="M9 58C28 42 44 26 56 9" stroke="#bfe1a0" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <path d="M26 44 22 30M26 44l14 2M37 33l-3-9M37 33l13 2" stroke="#bfe1a0" strokeWidth="1.3" fill="none" strokeLinecap="round" opacity=".8" />
      </g>
      <circle cx="30" cy="30" r="11" fill={GOLD} />
      <path d="M30 24v12M24 30h12" stroke="#1a1405" strokeWidth="2.6" strokeLinecap="round" />
    </g>
  );
}
