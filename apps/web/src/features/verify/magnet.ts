import type { PointerEvent } from 'react';

/**
 * A magnetic primary button without Motion (the kit's Magnetic pulls in about 43 KB): the button leans a few pixels
 * toward a desktop mouse and springs back when it leaves. Transform only, written straight to the element; off for
 * touch, pen and reduced motion.
 */
const canMove = () => typeof window !== 'undefined' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function magnet(strength = 0.22) {
  return {
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (e.pointerType !== 'mouse' || !canMove()) return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) * strength;
      const y = (e.clientY - (r.top + r.height / 2)) * strength;
      el.style.transition = 'transform 120ms ease-out';
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    },
    onPointerLeave(e: PointerEvent<HTMLElement>) {
      const el = e.currentTarget;
      el.style.transition = 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)';
      el.style.transform = '';
    },
  };
}
