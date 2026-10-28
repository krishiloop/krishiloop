import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

/**
 * Bottom sheet on phones, centred dialog on larger screens. Built on the native <dialog>: focus trap,
 * Escape and the top layer come from the browser. Enter/exit animate with @starting-style (components.css).
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
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
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // a click on the backdrop (the dialog element itself) closes it
        if (e.target === ref.current) onClose();
      }}
    >
      <div className={`sheet-panel ${className ?? ''}`}>
        <div className="sheet-grip" aria-hidden />
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-h3 font-semibold tracking-tight">
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <X size={20} aria-hidden />
          </button>
        </div>
        {open ? children : null}
      </div>
    </dialog>
  );
}
