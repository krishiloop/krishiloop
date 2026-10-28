import { useMemo } from 'react';
import { qrPath } from '../../lib/qr';

/** A QR as one SVG path on a white plate. Dark on light in BOTH themes: a QR needs its contrast to scan. */
export function Qr({ value, size = 112, label, className }: { value: string; size?: number; label: string; className?: string }) {
  const q = useMemo(() => qrPath(value), [value]);
  const quiet = 3;
  const box = q.size + quiet * 2;
  return (
    <svg className={className} width={size} height={size} viewBox={`${-quiet} ${-quiet} ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#fff" />
      <path d={q.d} fill="#111" />
    </svg>
  );
}
