import { useEffect, useState, type RefObject } from 'react';
import type { Tip } from './MapView';

export type TipApi = (tip: Tip | null) => void;

/** The map's tooltip: name and count near the pointer or the focused area. Moved with transform only; hidden from
 *  screen readers (each area's accessible name already says the same). */
export function TipLayer({ apiRef, text }: { apiRef: RefObject<TipApi | null>; text: (code: string) => string | null }) {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    apiRef.current = setTip;
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);
  const label = tip ? text(tip.code) : null;
  if (!tip || !label) return null;
  return (
    <div className="mp-tip" aria-hidden style={{ transform: `translate(${Math.round(tip.x)}px, ${Math.round(tip.y)}px)` }} data-testid="map-tip">
      {label}
    </div>
  );
}
