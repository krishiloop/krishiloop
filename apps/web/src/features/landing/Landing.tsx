import { useEffect } from 'react';
import { Hero } from './Hero';
import { Problem } from './Problem';
import { Versus } from './Versus';
import { Chapters } from './Chapters';
import { ProveDemo } from './ProveDemo';
import { Closing, StatusBoard, World } from './ClosingSections';
import { useIsLite } from '../../lib/device';
import { useMotionReduced } from '../../lib/motionPref';

/**
 * The judge story: hero (living rice field) -> the problem (verified facts) -> AI vs KrishiLoop -> five chapters that
 * morph one liquid object -> try verify + recall -> any crop, any language -> honest status -> close.
 */
export default function Landing() {
  const lite = useIsLite();
  const reduced = useMotionReduced();

  // smooth scroll (Lenis) only where it helps: desktop pointer, full motion, rich mode
  useEffect(() => {
    if (lite || reduced || typeof window === 'undefined' || window.matchMedia('(pointer: coarse)').matches) return;
    let stop = false;
    let raf = 0;
    let destroy: (() => void) | undefined;
    void import('lenis').then(({ default: Lenis }) => {
      if (stop) return;
      const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
      const tick = (t: number) => {
        lenis.raf(t);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      destroy = () => lenis.destroy();
    });
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      destroy?.();
    };
  }, [lite, reduced]);

  return (
    <>
      <Hero />
      <Problem />
      <Versus />
      <Chapters />
      <ProveDemo />
      <World />
      <StatusBoard />
      <Closing />
    </>
  );
}
