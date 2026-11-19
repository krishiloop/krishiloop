import { lazy, Suspense } from 'react';

const KrishiGuard = lazy(() => import('./KrishiGuard'));

/**
 * The one-line mount for Today (`<KrishiGuardSlot />`): the Climate-Smart Shield, "near you", the savings calculator and
 * the visit booking load in their own chunk after the plan, so the farmer app's first visit does not grow.
 */
export function KrishiGuardSlot() {
  return (
    <Suspense fallback={null}>
      <KrishiGuard />
    </Suspense>
  );
}
