// this page's words (English loads per screen): the home page reuses the story's verified copy
import '../../lib/i18n/strings.story';
import './home.css';
import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from 'react';
import { SmoothScroll } from '../../ui/kit/SmoothScroll';
import { HomeHero } from './HomeHero';

// below the first screen: its own chunk (HomeRest.tsx), so the first screen paints without that work
const HomeRest = lazy(() => import('./HomeRest'));

/**
 * When to mount everything below the first screen: as soon as the visitor comes near it, interacts, arrives with a
 * #hash link, or the browser goes idle after load (so screen-reader users and find-in-page get it within a moment,
 * without scrolling). Until then a placeholder keeps the page's length.
 */
function useRestReady(ref: RefObject<HTMLElement | null>): boolean {
  const [ready, setReady] = useState(() => typeof window === 'undefined' || !!window.location.hash);
  useEffect(() => {
    if (ready) return;
    const go = () => setReady(true);
    const el = ref.current;
    const io = el && typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && go(), { rootMargin: '0px 0px 400px 0px' }) : null;
    if (el && io) io.observe(el);
    const events = ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, go, { once: true, passive: true }));
    let idle = 0;
    const onLoad = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      idle = ric ? ric(go, { timeout: 3500 }) : window.setTimeout(go, 2500);
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    if (!io && !el) go();
    return () => {
      io?.disconnect();
      events.forEach((e) => window.removeEventListener(e, go));
      window.removeEventListener('load', onLoad);
      const cic = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (cic) cic(idle);
      else window.clearTimeout(idle);
    };
  }, [ready, ref]);
  return ready;
}

/**
 * The front page (/), after the owner's KrishiGuard AI deck: a forest hero (the promise, three problems, the app at work);
 * the merged product as a magazine with a sticky index, in the deck's order (Crop Guardian, the Climate Shield, the
 * village disease radar, precision savings, Bangla voice and basic phones, the officer, and only then trust: the receipt
 * and recall); who it is for (verified facts only); the whole system in one diagram; why chatbots are not enough; what
 * we measured; the receipt itself (paper); the honest status; one QR to scan.
 */
export default function HomePage() {
  const restRef = useRef<HTMLDivElement>(null);
  const ready = useRestReady(restRef);
  // a still block (no shimmer: a 1400 px animated gradient repaints every frame while the first screen loads)
  const placeholder = <div className="h-[1400px]" aria-hidden />;
  return (
    <>
      <SmoothScroll />
      <HomeHero />
      <div ref={restRef}>{ready ? <Suspense fallback={placeholder}><HomeRest /></Suspense> : placeholder}</div>
    </>
  );
}
