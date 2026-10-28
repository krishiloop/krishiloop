import { useEffect, useState } from 'react';
import { Check, RefreshCw, TriangleAlert } from 'lucide-react';
import { useMotionReduced } from '../../lib/motionPref';
import type { TrafficLight as Light } from '../../lib/api/types';

const ORDER: { c: Light; icon: typeof Check }[] = [
  { c: 'red', icon: TriangleAlert },
  { c: 'amber', icon: RefreshCw },
  { c: 'green', icon: Check },
];

/**
 * The "Should I spray?" signal. Pure CSS/SVG (works in Lite mode, crisp, accessible).
 * On load the lamps sweep red -> amber -> green like a real signal checking itself, then the answer lamp
 * stays on and the housing settles. The lit lamp also carries an icon: meaning never relies on colour alone.
 */
export function TrafficLight({ light, label, size = 'lg', replayKey = 0 }: { light: Light; label: string; size?: 'lg' | 'sm'; replayKey?: number }) {
  const reduced = useMotionReduced();
  const [phase, setPhase] = useState<'sweep' | 'set'>(reduced ? 'set' : 'sweep');

  useEffect(() => {
    if (reduced) {
      setPhase('set');
      return;
    }
    setPhase('sweep');
    const id = window.setTimeout(() => setPhase('set'), 1050);
    return () => window.clearTimeout(id);
  }, [light, replayKey, reduced]);

  return (
    <div className="signal-lamps" data-size={size} data-phase={phase} data-light={light} role="img" aria-label={label}>
      {ORDER.map(({ c, icon: Icon }, i) => (
        <span key={c} className="lamp" data-c={c} data-on={phase === 'set' && c === light} style={{ ['--i' as string]: i }}>
          <span className="lamp-lens" />
          <span className="lamp-lit">
            <Icon size={size === 'lg' ? 26 : 18} strokeWidth={2.6} aria-hidden />
          </span>
        </span>
      ))}
    </div>
  );
}
