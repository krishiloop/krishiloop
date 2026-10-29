import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * A light that travels along a curved line between two elements (Magic UI AnimatedBeam, rebuilt with a CSS dash on a
 * pathLength=1 path instead of a per-frame gradient). The path is recomputed when the container resizes. The loop
 * pauses with its section ([data-offscreen]) and runs once, short, under reduced motion.
 */
export function AnimatedBeam({
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = 3.4,
  delay = 0,
  color,
  dim,
}: {
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  curvature?: number;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  color?: string;
  dim?: boolean;
}) {
  const [d, setD] = useState('');
  const [box, setBox] = useState({ w: 0, h: 0 });

  // a passive effect, not a layout effect: the container's ref (a parent) is attached only after its children's
  // layout effects have run
  useEffect(() => {
    const update = () => {
      const c = containerRef.current?.getBoundingClientRect();
      const a = fromRef.current?.getBoundingClientRect();
      const b = toRef.current?.getBoundingClientRect();
      if (!c || !a || !b) return;
      setBox({ w: c.width, h: c.height });
      const sx = a.left - c.left + a.width / 2;
      const sy = a.top - c.top + a.height / 2;
      const ex = b.left - c.left + b.width / 2;
      const ey = b.top - c.top + b.height / 2;
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2 - curvature;
      setD(reverse ? `M ${ex},${ey} Q ${mx},${my} ${sx},${sy}` : `M ${sx},${sy} Q ${mx},${my} ${ex},${ey}`);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [containerRef, fromRef, toRef, curvature, reverse]);

  if (!d) return null;
  return (
    <svg className="pointer-events-none absolute left-0 top-0 -z-0" width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} fill="none" aria-hidden>
      <path d={d} stroke="var(--color-rule-2)" strokeWidth="1.25" strokeLinecap="round" />
      {!dim && (
        <path
          d={d}
          pathLength={1}
          className="beam-dash"
          stroke={color ?? 'var(--color-sprout)'}
          strokeWidth="2"
          strokeLinecap="round"
          style={{ animationDuration: `${duration}s`, animationDelay: `${delay}s` } as CSSProperties}
        />
      )}
    </svg>
  );
}
