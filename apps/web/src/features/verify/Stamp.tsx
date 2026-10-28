import { useEffect, useRef } from 'react';
import { useMotionReduced } from '../../lib/motionPref';

/** SVG filter that gives the stamp ink its rough edge and missing specks. Rendered once per page. */
export function InkFilter() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
      <filter id="ink-rough" x="-6%" y="-10%" width="112%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="rough" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -4 3.05" result="specks" />
        <feComposite in="rough" in2="specks" operator="in" />
      </filter>
    </svg>
  );
}

/**
 * The big red stamp. It slams down (scale 2.8 -> 1 with a hint of overshoot), the paper thuds, a shock ring and ink
 * splatter spread, and the phone gets one short buzz on the same frame as the impact. Reduced motion: it is simply there.
 */
export function RecalledStamp({ word, play }: { word: string; play: boolean }) {
  const reduced = useMotionReduced();
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!play || reduced) return;
    // impact is at ~62% of the 560 ms slam: buzz exactly then
    const id = window.setTimeout(() => {
      try {
        // browsers ignore (and log) a buzz before the visitor has touched the page
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([28]);
      } catch {
        /* no vibration API */
      }
    }, 340 + 330);
    return () => window.clearTimeout(id);
  }, [play, reduced]);

  return (
    <div ref={el} className="stamp-wrap" data-play={play} aria-hidden="true">
      <span className="stamp-ring" />
      <span className="stamp-ring r2" />
      <div className="stamp">
        <span className="stamp-text">{word}</span>
      </div>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <i key={i} className="stamp-splat" style={{ ['--a' as string]: `${i * 51 + 12}deg`, ['--d' as string]: `${54 + (i % 3) * 14}px`, ['--s' as string]: `${3 + (i % 4)}px` }} />
      ))}
    </div>
  );
}

/** Calm seal for AUTHENTIC: a ring that draws itself, then the tick. No bounce, no shake: this is the quiet moment. */
export function AuthenticSeal({ play }: { play: boolean }) {
  return (
    <svg className="seal" data-play={play} viewBox="0 0 120 120" width="112" height="112" aria-hidden="true">
      <circle className="seal-ring-bg" cx="60" cy="60" r="46" fill="none" strokeWidth="5" />
      <circle className="seal-ring" cx="60" cy="60" r="46" fill="none" strokeWidth="5" strokeLinecap="round" pathLength="100" />
      <circle className="seal-dots" cx="60" cy="60" r="54" fill="none" strokeWidth="2" strokeDasharray="1 5.6" strokeLinecap="round" />
      <path className="seal-tick" d="M40 62 L55 77 L82 46" fill="none" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" pathLength="100" />
    </svg>
  );
}
