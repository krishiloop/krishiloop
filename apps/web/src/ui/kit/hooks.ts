import { useEffect, useRef, useState, type RefObject } from 'react';

/** The house curves (DESIGN.md): quint-out for most entrances, expo-out for the masked headline reveals. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * True while the element is on screen (with a margin). Sections pass `data-offscreen` from it, which pauses every
 * CSS loop inside (kit.css), so nothing keeps animating where nobody looks.
 */
export function useOnScreen<T extends Element>(ref: RefObject<T | null>, margin = '120px 0px'): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOn(!!e?.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return on;
}

/** Becomes true once, the first time the element scrolls into view (for count-ups and draw-ins that play once). */
export function useSeenOnce<T extends Element>(margin = '0px 0px -12% 0px') {
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

const finePointer = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

/**
 * Pointer light for `.surface` cards: sets --mx/--my on the element (no React state, no re-render) and fades the
 * glow in and out. Mouse only; touch never sees it.
 */
export function spotlight() {
  return {
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      if (e.pointerType !== 'mouse' || !finePointer()) return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
      el.style.setProperty('--glow', '1');
    },
    onPointerLeave(e: React.PointerEvent<HTMLElement>) {
      e.currentTarget.style.setProperty('--glow', '0');
    },
  };
}
