/** Hold to confirm (Emil Kowalski's "hold to delete": a linear clip-path fill while held, a 200 ms snap back on release); our own code. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn as cx } from './cn';
import './hold.css';

/**
 * A deliberate action: press and hold for `holdMs`; a fill sweeps across the button (clip-path, linear) and the action
 * runs when it is full. Letting go early snaps the fill back in 200 ms and nothing happens.
 * Keyboard and assistive tech (a click with no pointer, `detail === 0`) get the equivalent two-step path: the first press
 * arms the button ("Press again to confirm", announced), the second press runs it; leaving the button disarms it.
 * `canStart` runs first on every attempt: return false to refuse (say, a missing reason) without any fill.
 * The fill is a progress indicator, not decoration, so it also runs under reduced motion (WAAPI, not a CSS transition).
 */
export function HoldButton({
  children,
  armedLabel,
  hint,
  holdMs = 1700,
  onConfirm,
  canStart,
  disabled,
  className,
  testId,
}: {
  children: ReactNode;
  /** what the button says once armed by the keyboard ("Press again to recall") */
  armedLabel: string;
  /** a one-line hint under the button ("Hold to recall, or press Enter twice") */
  hint?: ReactNode;
  holdMs?: number;
  onConfirm: () => void;
  canStart?: () => boolean;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const anim = useRef<Animation | null>(null);
  const timer = useRef<number | null>(null);
  const armedAt = useRef(0);
  const [armed, setArmed] = useState(false);
  const [holding, setHolding] = useState(false);
  const done = useRef(false);

  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => () => clear(), []);

  const sweep = (to: number, ms: number, easing: string) => {
    const el = fill.current;
    if (!el || typeof el.animate !== 'function') return;
    const from = getComputedStyle(el).clipPath;
    anim.current?.cancel();
    anim.current = el.animate([{ clipPath: from === 'none' ? 'inset(0 100% 0 0)' : from }, { clipPath: `inset(0 ${100 - to}% 0 0)` }], { duration: ms, easing, fill: 'forwards' });
  };

  const start = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    if (canStart && !canStart()) return;
    done.current = false;
    setArmed(false);
    setHolding(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    sweep(100, holdMs, 'linear');
    clear();
    timer.current = window.setTimeout(() => {
      done.current = true;
      setHolding(false);
      onConfirm();
      // ready for the next time (the button may stay mounted, say inside a closed dialog)
      timer.current = window.setTimeout(() => anim.current?.cancel(), 500);
    }, holdMs);
  };
  const stop = () => {
    if (!holding) return;
    setHolding(false);
    clear();
    if (!done.current) sweep(0, 200, 'cubic-bezier(0.23, 1, 0.32, 1)');
  };

  return (
    <span className={cx('hold-wrap', className)}>
      <button
        type="button"
        className={cx('hold-btn', holding && 'is-holding', armed && 'is-armed')}
        disabled={disabled}
        data-testid={testId}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onContextMenu={(e) => e.preventDefault()}
        onBlur={() => setArmed(false)}
        onClick={(e) => {
          // pointer clicks are handled by the hold; only keyboard / assistive-tech activation gets here with detail 0
          if (e.detail !== 0 || disabled) return;
          if (canStart && !canStart()) return;
          if (!armed) {
            armedAt.current = performance.now();
            setArmed(true);
            return;
          }
          if (performance.now() - armedAt.current < 350) return; // a held Enter repeats: ignore it
          setArmed(false);
          onConfirm();
        }}
      >
        <span className="hold-label">{armed ? armedLabel : children}</span>
        <span ref={fill} className="hold-fill" aria-hidden>
          <span className="hold-label">{armed ? armedLabel : children}</span>
        </span>
      </button>
      {hint ? <span className="hold-hint">{hint}</span> : null}
      <span className="sr-only-live" aria-live="polite">
        {armed ? armedLabel : ''}
      </span>
    </span>
  );
}
