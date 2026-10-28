import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cx } from '../lib/cx';

/**
 * A bottom sheet on phones and a side sheet on wide screens, built on the native <dialog>: the browser gives the focus
 * trap, Escape, the top layer and focus return. It slides in with @starting-style (ui.css, 300 ms --ease-drawer).
 * Children render only while open, so a closed sheet costs nothing.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useI18n();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx('sheet', wide && 'sheet-wide', className)}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // a click on the backdrop
      }}
    >
      <div className="sheet-grip" aria-hidden />
      <header className="flex items-start justify-between gap-4 border-b border-rule px-5 pb-4 pt-3 sm:px-6 sm:pt-5">
        <div className="min-w-0">
          <h2 id={titleId} className="t-head">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
        </div>
        <button type="button" className="btn btn-ghost btn-icon btn-sm -mr-2 flex-none" onClick={onClose} aria-label={t('ui.close')}>
          <X size={20} aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{open ? children : null}</div>
    </dialog>
  );
}
