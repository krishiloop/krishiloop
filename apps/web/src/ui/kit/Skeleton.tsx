import type { CSSProperties } from 'react';
import { useI18n } from '../../lib/i18n';
import { cn } from './cn';

/**
 * Skeleton: a shimmer placeholder in the shape of what is coming (a card, a line of text, a photo), so nothing jumps
 * when it arrives. Decorative (aria-hidden); put `aria-busy` on the region that is loading, or use `SkeletonBlock`,
 * which says "Loading" once to screen readers. The shimmer stops under reduced motion.
 *
 *   <Skeleton className="h-40 w-full" />            a block
 *   <Skeleton lines={3} />                          three lines of text, the last one shorter
 *   <Skeleton round className="size-12" />          an avatar or an icon
 */
export function Skeleton({ className, lines, round, style }: { className?: string; lines?: number; round?: boolean; style?: CSSProperties }) {
  if (lines && lines > 1) {
    return (
      <span className={cn('grid gap-2.5', className)} aria-hidden style={style}>
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="skel block h-[0.9em] rounded-full" style={{ width: i === lines - 1 ? '62%' : '100%' }} />
        ))}
      </span>
    );
  }
  return <span className={cn('skel block', round && 'rounded-full', className)} aria-hidden style={style} />;
}

/** A loading region: the placeholder plus one polite "Loading" for screen readers. */
export function SkeletonBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={className} aria-busy="true">
      <span className="sr-only-live" role="status">
        {t('ui.loading')}
      </span>
      {children ?? <Skeleton className="h-40 w-full" />}
    </div>
  );
}
