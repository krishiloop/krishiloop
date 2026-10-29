import type { CSSProperties } from 'react';

/** A short light running round its parent's border (Magic UI BorderBeam, CSS offset-path). The parent needs `relative`. */
export function BorderBeam({ size = 120, duration = 9, delay = 0, radius = 22, from, to }: { size?: number; duration?: number; delay?: number; radius?: number; from?: string; to?: string }) {
  return (
    <span
      aria-hidden
      className="border-beam"
      style={
        {
          '--beam-size': `${size}px`,
          '--beam-duration': `${duration}s`,
          '--beam-delay': `${-delay}s`,
          '--beam-radius': `${radius}px`,
          ...(from ? { '--beam-from': from } : {}),
          ...(to ? { '--beam-to': to } : {}),
        } as CSSProperties
      }
    />
  );
}
