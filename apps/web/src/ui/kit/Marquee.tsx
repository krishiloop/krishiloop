import type { CSSProperties, ReactNode } from 'react';
import { cn } from './cn';

/** An endless row (Magic UI Marquee, CSS only): two copies, the track slides by one. Hover pauses it (mouse only). */
export function Marquee({ children, duration = 40, gap = '2.5rem', className, label }: { children: ReactNode; duration?: number; gap?: string; className?: string; label?: string }) {
  return (
    <div className={cn('marquee', className)} style={{ '--duration': `${duration}s`, '--gap': gap } as CSSProperties} role={label ? 'region' : undefined} aria-label={label}>
      <div>{children}</div>
      <div aria-hidden>{children}</div>
    </div>
  );
}
