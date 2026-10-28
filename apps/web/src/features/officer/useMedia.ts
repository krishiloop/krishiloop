import { useSyncExternalStore } from 'react';

/** A media query as state (e.g. the wide layout where a case opens beside the list instead of in a sheet). */
export function useMedia(query: string, fallback = true): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}

export const WIDE = '(min-width: 1024px)';
