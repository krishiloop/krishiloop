import { useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { useInViewOnce } from '../../lib/hooks';
import { cx } from '../../lib/cx';

/**
 * Scroll reveal with plain CSS transitions (opacity, transform, a touch of blur): it plays once, is interruptible,
 * and reduced motion makes it instant. `delay` staggers siblings (30 to 80 ms apart reads best).
 */
export function Reveal({ children, delay = 0, as, className, id }: { children: ReactNode; delay?: number; as?: ElementType; className?: string; id?: string }) {
  const ref = useRef<HTMLElement>(null);
  const seen = useInViewOnce(ref);
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag ref={ref} id={id} className={cx('reveal', className)} data-seen={seen} style={{ ['--d' as string]: `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}
