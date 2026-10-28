import { useMemo } from 'react';
import { qrPath } from '../lib/qr';
import { cx } from '../lib/cx';

/** A crisp QR (one SVG path). Always dark modules on a light plate with a quiet zone, in both themes, so it scans. */
export function Qr({ value, size = 112, label, className }: { value: string; size?: number; label: string; className?: string }) {
  const { size: n, d } = useMemo(() => qrPath(value, 'M'), [value]);
  const q = 2; // quiet zone in modules (the plate's padding adds the rest)
  return (
    <svg
      viewBox={`${-q} ${-q} ${n + 2 * q} ${n + 2 * q}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cx('block rounded-[3px] bg-[#fcfaf4]', className)}
    >
      <path d={d} fill="#1b1a16" />
    </svg>
  );
}
