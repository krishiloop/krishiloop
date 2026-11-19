import { useCallback, useEffect, useId, useRef, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import '../../../lib/i18n/strings.krishiguard';
import { motionReduced } from '../../../lib/motionPref';
import { cx } from '../../../lib/cx';
import './drawer.css';

/**
 * A small accessible drawer (builder R; `ui/kit/Drawer` did not exist yet). Built on the native modal <dialog>, which
 * gives the focus trap, the top layer, inert background and focus return. Escape and a click on the backdrop close it
 * with the exit motion; on a phone it is a bottom sheet you can swipe down (grip or header). Enter and exit move only
 * transform and opacity, on cubic-bezier(0.16, 1, 0.3, 1); reduced motion closes at once. Children render only while
 * open.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  testId,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subId = useId();
  const { t } = useI18n();
  const closing = useRef(false);
  const drag = useRef<{ y: number; t: number; dy: number; id: number } | null>(null);

  const finish = useCallback(() => {
    closing.current = false;
    const d = ref.current;
    if (d?.open) d.close(); // fires 'close' -> onClose
  }, []);

  /** Close with the exit motion (Escape, backdrop, close button, swipe). */
  const requestClose = useCallback(() => {
    const d = ref.current;
    const p = panel.current;
    if (!d?.open || closing.current) return;
    if (motionReduced() || !p) return finish();
    closing.current = true;
    d.classList.add('is-closing');
    const done = () => {
      d.classList.remove('is-closing');
      if (p) p.style.transform = '';
      finish();
    };
    const timer = window.setTimeout(done, 320); // never stuck if animationend does not fire
    p.addEventListener(
      'animationend',
      () => {
        window.clearTimeout(timer);
        done();
      },
      { once: true },
    );
  }, [finish]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.classList.remove('is-closing');
      d.showModal();
    }
    if (!open && d.open) finish();
  }, [open, finish]);

  /* swipe down to close (phones: the sheet sits at the bottom) */
  const onPointerDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' || !window.matchMedia('(max-width: 767px)').matches) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panel.current?.classList.add('is-dragging');
  };
  const onPointerMove = (e: RPointerEvent) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId || !panel.current) return;
    g.dy = Math.max(0, e.clientY - g.y);
    panel.current.style.transform = `translate3d(0, ${g.dy}px, 0)`;
  };
  const onPointerUp = (e: RPointerEvent) => {
    const g = drag.current;
    drag.current = null;
    const p = panel.current;
    if (!g || !p) return;
    p.classList.remove('is-dragging');
    const v = g.dy / Math.max(1, performance.now() - g.t); // px per ms
    if (g.dy > 96 || (g.dy > 24 && v > 0.6)) {
      p.style.setProperty('--kg-drag', `${g.dy}px`);
      requestClose();
    } else {
      p.style.transform = '';
    }
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <dialog
      ref={ref}
      className={cx('kg-drawer', className)}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subId : undefined}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault(); // Escape: close with the exit motion
        requestClose();
      }}
      onClose={() => {
        closing.current = false;
        if (panel.current) panel.current.style.transform = '';
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) requestClose(); // the backdrop
      }}
    >
      <div ref={panel} className="kg-drawer-panel">
        <div className="kg-drawer-drag" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <div className="kg-drawer-grip" aria-hidden />
          <header className="kg-drawer-head">
            <div className="min-w-0">
              <h2 id={titleId} className="kg-drawer-title">
                {title}
              </h2>
              {subtitle && (
                <p id={subId} className="mt-1 text-sm text-ink-2">
                  {subtitle}
                </p>
              )}
            </div>
            <button type="button" className="btn btn-ghost btn-icon btn-sm -mr-2 flex-none" onClick={requestClose} aria-label={t('fa.drawer.close')}>
              <X size={20} aria-hidden />
            </button>
          </header>
        </div>
        <div className="kg-drawer-body">{open ? children : null}</div>
      </div>
    </dialog>
  );
}
