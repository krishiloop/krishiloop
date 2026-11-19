import { useRef, type CSSProperties, type ReactNode } from 'react';
import { cn } from './cn';

const canTilt = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: hover) and (pointer: fine)').matches &&
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * TiltCard: a showcase card that leans toward the mouse in CSS 3D (rotateX/rotateY with perspective; no WebGL), with a
 * soft glare where the light would catch. Mouse only: touch, pen and reduced motion get a still card. The pointer writes
 * CSS variables straight to the element (no React state, no re-render per frame).
 *
 *   <TiltCard max={7} className="surface p-6">…</TiltCard>
 */
export function TiltCard({
  children,
  max = 7,
  glare = true,
  className,
  style,
  as: Tag = 'div',
  ...rest
}: {
  children: ReactNode;
  /** the largest lean, in degrees */
  max?: number;
  glare?: boolean;
  className?: string;
  style?: CSSProperties;
  as?: 'div' | 'article' | 'li' | 'figure';
} & Omit<React.HTMLAttributes<HTMLElement>, 'children'>) {
  const ref = useRef<HTMLElement>(null);
  const frame = useRef(0);

  const move = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse' || !canTilt()) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.dataset.active = '';
      el.style.setProperty('--ry', `${((px - 0.5) * 2 * max).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${((0.5 - py) * 2 * max).toFixed(2)}deg`);
      el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
      el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    });
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    delete el.dataset.active;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };

  const Comp = Tag as 'div';
  return (
    <Comp ref={ref as React.Ref<HTMLDivElement>} className={cn('tilt relative', className)} style={style} onPointerMove={move} onPointerLeave={leave} {...rest}>
      {children}
      {glare && <span className="tilt-glare" aria-hidden />}
    </Comp>
  );
}
