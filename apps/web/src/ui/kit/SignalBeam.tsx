/** A light that runs once along a curved hairline between two elements, each time `pulse` changes (Magic UI AnimatedBeam, MIT; a one-shot variant of kit/AnimatedBeam). */
import { useEffect, useState, type RefObject } from 'react';
import { motionReduced } from '../../lib/motionPref';
import './SignalBeam.css';

type Anchor = readonly [number, number];
const RIGHT_MID: Anchor = [1, 0.5];
const LEFT_MID: Anchor = [0, 0.5];

/**
 * From a point on `from` (fractions of its box, default its right edge) to a point on `to` (default its left edge).
 * The hairline is always there; the light runs once per new `pulse` (and not at all under reduced motion), so the line
 * says "this just happened here" rather than looping.
 */
export function SignalBeam({
  containerRef,
  fromRef,
  toRef,
  pulse,
  fromAt = RIGHT_MID,
  toAt = LEFT_MID,
  bend = 0.5,
  color,
}: {
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  pulse: string | number | null;
  fromAt?: Anchor;
  toAt?: Anchor;
  bend?: number;
  color?: string;
}) {
  const [geo, setGeo] = useState<{ d: string; w: number; h: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const c = containerRef.current?.getBoundingClientRect();
      const a = fromRef.current?.getBoundingClientRect();
      const b = toRef.current?.getBoundingClientRect();
      if (!c || !a || !b) return;
      const sx = a.left - c.left + a.width * fromAt[0];
      const sy = a.top - c.top + a.height * fromAt[1];
      const ex = b.left - c.left + b.width * toAt[0];
      const ey = b.top - c.top + b.height * toAt[1];
      const k = (ex - sx) * bend;
      setGeo({ d: `M ${sx},${sy} C ${sx + k},${sy} ${ex - k},${ey} ${ex},${ey}`, w: c.width, h: c.height });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    if (toRef.current) ro.observe(toRef.current);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
    // the anchors are compared by value (an inline array is a new object every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, fromRef, toRef, fromAt[0], fromAt[1], toAt[0], toAt[1], bend, pulse]);

  if (!geo) return null;
  return (
    <svg className="sig-beam" width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} fill="none" aria-hidden>
      <path d={geo.d} stroke="var(--color-rule-2)" strokeWidth="1" strokeLinecap="round" />
      {pulse != null && !motionReduced() && <path key={String(pulse)} d={geo.d} pathLength={1} className="sig-run" stroke={color ?? 'var(--color-sprout)'} strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}
