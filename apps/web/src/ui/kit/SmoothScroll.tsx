import { useEffect } from 'react';
import Lenis from 'lenis';

/**
 * Lenis smooth scrolling for the long story pages only (the house rule: Lenis on the homepage, never in the app
 * screens). Off under reduced motion and for touch, where native scrolling is better.
 */
export function SmoothScroll() {
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (reduce || coarse) return;
    const lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1, anchors: { offset: -88 } });
    let raf = requestAnimationFrame(function loop(t) {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);
  return null;
}
