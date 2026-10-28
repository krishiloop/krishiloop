import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cx } from '../../lib/cx';

/** Eyebrow + title (+ one short line) for a story section. Reveals on scroll. */
export function SectionHead({ eyebrow, title, lead, id, center, className }: { eyebrow: string; title: ReactNode; lead?: ReactNode; id?: string; center?: boolean; className?: string }) {
  return (
    <header className={cx('max-w-3xl', center && 'mx-auto text-center', className)}>
      <p className="eyebrow" data-reveal>
        {eyebrow}
      </p>
      <h2 id={id} className="t-title mt-4" data-reveal style={{ ['--i' as string]: 1 }}>
        {title}
      </h2>
      {lead && (
        <p className={cx('t-lead mt-5 max-w-[46ch]', center && 'mx-auto')} data-reveal style={{ ['--i' as string]: 2 }}>
          {lead}
        </p>
      )}
    </header>
  );
}

/** True once the element comes within `margin` of the viewport (for loading or starting something once). */
export function useNear<T extends Element>(ref: RefObject<T | null>, margin = '300px'): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}

/** True once the element is really on screen (for starting an animation exactly when it can be seen). */
export function useSeen<T extends Element>(margin = '0px 0px -15% 0px') {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin, seen]);
  return [ref, seen] as const;
}

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
