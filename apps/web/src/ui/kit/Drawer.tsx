import { useEffect, useId, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { cn } from './cn';

/**
 * Drawer: a slide-out panel on wide screens and a bottom sheet on phones, with optional steps (book, report, set up).
 * Built on the native <dialog> (showModal): the browser gives the focus trap, Escape, the top layer and focus return.
 * On a phone you can swipe it down from the grip or the header (it follows the finger, then closes past 110 px or on a
 * quick flick, else springs back). Children render only while open, so a closed drawer costs nothing.
 *
 *   <Drawer open={o} onClose={() => setO(false)} title="Book a visit" steps={['Date', 'Details', 'Done']} step={s}
 *           footer={<LiquidButton onClick={next}>Next</LiquidButton>}>
 *     {s === 0 && <DatePicker/>} {s === 1 && <Fields/>} {s === 2 && <Confirmation/>}
 *   </Drawer>
 *
 * side: 'auto' (right panel from 900 px, bottom sheet below) or 'bottom' (always a sheet). `wide` makes the panel 720 px.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  steps,
  step = 0,
  side = 'auto',
  wide,
  className,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** sticky actions under the content (Back / Next / Confirm) */
  footer?: ReactNode;
  /** step names; a progress bar and "Step n of m" show when there are two or more */
  steps?: string[];
  /** the current step, 0-based (the consumer renders that step's content as children) */
  step?: number;
  side?: 'auto' | 'bottom';
  wide?: boolean;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t, lang } = useI18n();
  const prev = useRef(step);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (step !== prev.current) setDir(step < prev.current ? 'back' : 'fwd');
    prev.current = step;
  }, [step]);

  // swipe down to close (touch and pen; a sheet only: the side panel ignores it)
  const isSheet = () => side === 'bottom' || !window.matchMedia('(min-width: 900px)').matches;
  const onDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!isSheet() || (e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ref.current?.setAttribute('data-dragging', '');
  };
  const onMove = (e: RPointerEvent) => {
    const g = drag.current;
    if (!g) return;
    // down follows the finger; up resists (a sheet does not lift off the bottom)
    const raw = e.clientY - g.y;
    g.dy = raw > 0 ? raw : raw * 0.15;
    ref.current?.style.setProperty('--drag', `${g.dy}px`);
  };
  const onUp = () => {
    const g = drag.current;
    drag.current = null;
    const d = ref.current;
    if (!g || !d) return;
    d.removeAttribute('data-dragging');
    const v = g.dy / Math.max(1, performance.now() - g.t); // px per ms
    d.style.setProperty('--drag', '0px');
    if (g.dy > 110 || (g.dy > 24 && v > 0.55)) onClose();
  };

  const multi = !!steps && steps.length > 1;

  return (
    <dialog
      ref={ref}
      className={cn('drawer', className)}
      data-side={side === 'bottom' ? 'bottom' : undefined}
      data-wide={wide ? '' : undefined}
      aria-labelledby={titleId}
      data-testid={testId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // a click on the backdrop
      }}
    >
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className="flex-none">
        <div className="drawer-grip" aria-hidden />
        <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-1 sm:px-7 sm:pt-6">
          <div className="min-w-0">
            {multi && (
              <p className="label m-0 mb-2" aria-live="polite">
                {t('ui.drawer.step', { n: fmtNum(step + 1, lang), total: fmtNum(steps.length, lang) })} · {steps[step]}
              </p>
            )}
            <h2 id={titleId} className="t-head m-0">
              {title}
            </h2>
            {subtitle && <p className="m-0 mt-1.5 text-sm text-ink-3">{subtitle}</p>}
          </div>
          <button type="button" className="btn btn-secondary btn-icon btn-sm -mr-1 flex-none" onClick={onClose} aria-label={t('ui.close')}>
            <X size={18} aria-hidden />
          </button>
        </header>
        {multi && (
          <ol className="drawer-steps m-0 list-none px-5 pb-1 sm:px-7" aria-hidden>
            {steps.map((s, i) => (
              <li key={s} data-done={i < step ? '' : undefined} aria-current={i === step ? 'step' : undefined} />
            ))}
          </ol>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7">
        {open ? (
          <div key={step} className="drawer-step" data-dir={dir}>
            {children}
          </div>
        ) : null}
      </div>
      {footer && open && <div className="flex flex-none flex-wrap items-center justify-end gap-3 border-t border-rule px-5 py-4 sm:px-7">{footer}</div>}
    </dialog>
  );
}
