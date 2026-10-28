import { useSyncExternalStore } from 'react';
import { readStore, writeStore } from './storage';

/**
 * Less motion, site-wide: on when the visitor's system asks for reduced motion, or when they press
 * "Pause motion" (remembered in this browser). Loops, 3D wind, parallax and scroll effects all read
 * this, and `html.reduce-motion` stops CSS animations (index.css). WCAG 2.2.2 asks for a way to
 * pause anything that moves by itself for more than five seconds, so the control sits next to the scene.
 * Pattern from ShadowAstra Atlas (lib/motionPref.ts).
 */
const KEY = 'kl.motion';
const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let paused = readStore(KEY) === 'paused';
const subs = new Set<() => void>();
// Read once, then only via the change event (reading `matches` on every render can swallow the event).
let system = !!query?.matches;

export const motionReduced = () => paused || system;
export const motionPaused = () => paused;
export const systemReduced = () => system;

function apply() {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('reduce-motion', paused);
  subs.forEach((f) => f());
}
query?.addEventListener('change', (e) => {
  system = e.matches;
  apply();
});
apply();

export function setMotionPaused(v: boolean) {
  paused = v;
  writeStore(KEY, v ? 'paused' : 'on');
  apply();
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** True when motion should be kept to a minimum (system setting or the pause switch). */
export const useMotionReduced = () => useSyncExternalStore(subscribe, motionReduced, () => false);
/** True only when the visitor pressed pause on the site. */
export const useMotionPaused = () => useSyncExternalStore(subscribe, motionPaused, () => false);
