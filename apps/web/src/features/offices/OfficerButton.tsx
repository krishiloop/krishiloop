import { lazy, Suspense, useState } from 'react';
import { MapPin } from 'lucide-react';
import '../../lib/i18n/strings.offices';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import './officerPage.css';

const OfficesSheet = lazy(() => import('./OfficesSheet'));

/**
 * A "Krishi officer" button for the apps' headers (owner, 20 Nov: the officer finder must be easy to find, on every
 * screen). A terracotta pill (not another green control) that opens the finder sheet; the sheet loads on the first tap.
 */
export function OfficerButton({ className, label = true }: { className?: string; label?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cx('officer-btn press', className)}
        onClick={() => {
          setSeen(true);
          setOpen(true);
        }}
        aria-label={label ? undefined : t('near.btn')}
        data-testid="officer-btn"
      >
        <MapPin size={17} aria-hidden />
        {label && <span>{t('near.btn')}</span>}
      </button>
      {seen && (
        <Suspense fallback={null}>
          <OfficesSheet open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
