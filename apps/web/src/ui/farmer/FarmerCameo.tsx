import { lazy, Suspense } from 'react';
import type { Mood } from './LeafFarmer';
import './farmerCameo.css';

/** The farmer's drawing code (about 6 KB) loads after the page, so it never slows a first visit; his leaves gather in. */
const LeafFarmer = lazy(() => import('./LeafFarmer').then((m) => ({ default: m.LeafFarmer })));

/**
 * The leaf farmer standing beside a page's title, with the face that page calls for (owner, 20 Nov: "a farmer with a
 * farmer cap all over our website, big and visible, with different expressions in different places").
 * `float` sits in the title's text column and the words wrap round him; `corner` stands in the corner of a header
 * that is `position: relative`. The space is held from the start (same shape as the drawing), so nothing shifts.
 */
export function FarmerCameo({ mood, variant = 'float', flip = false }: { mood: Mood; variant?: 'float' | 'corner'; flip?: boolean }) {
  return (
    <div className={`farmer-cameo farmer-cameo--${variant}`} aria-hidden>
      <Suspense fallback={<span className="farmer-cameo-hold" />}>
        <LeafFarmer mood={mood} flip={flip} />
      </Suspense>
    </div>
  );
}

/** The same lazy farmer, for places that size him themselves (the nearest-officer card). */
export function LazyLeafFarmer({ mood, flip = false, className }: { mood: Mood; flip?: boolean; className?: string }) {
  return (
    <Suspense fallback={<span className="farmer-cameo-hold" />}>
      <LeafFarmer mood={mood} flip={flip} className={className} />
    </Suspense>
  );
}
