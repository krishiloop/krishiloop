import { lazy, Suspense, useState } from 'react';
import { MapPin } from 'lucide-react';
import '../../lib/i18n/strings.offices';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import './offices.css';

/** The sheet, the map and the office data load on the first tap (Leaflet only when the map shows). */
const OfficesSheet = lazy(() => import('./OfficesSheet'));

/**
 * "Not sure? Talk to your nearest agriculture office". Two looks:
 *  - card: shown when the answer is "ask an expert" or "not sure" (photo check, Ask).
 *  - entry: a plain row, "Find my agriculture office" (Help tab, farmer app).
 * The place comes from the browser only after the farmer taps "Use my location"; until then the sample farm is used and said so.
 */
export function NearestOffice({ variant = 'card', className }: { variant?: 'card' | 'entry'; className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // the sheet stays mounted after its first opening so it can close with its exit motion
  const [seen, setSeen] = useState(false);
  const go = () => {
    setSeen(true);
    setOpen(true);
  };
  return (
    <>
      {variant === 'card' ? (
        <section className={cx('near-card', className)} aria-labelledby="near-card-title" data-testid="near-card">
          <span className="near-ic" aria-hidden>
            <MapPin size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 id="near-card-title" className="near-title">
              {t('near.card.title')}
            </h3>
            <p className="near-sub">{t('near.card.sub')}</p>
          </div>
          <button type="button" className="btn btn-primary near-hit" onClick={go} data-testid="near-open">
            {t('near.card.go')}
          </button>
        </section>
      ) : (
        <button type="button" className={cx('near-entry', className)} onClick={go} data-testid="near-entry">
          <span className="near-ic" aria-hidden>
            <MapPin size={22} />
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="near-title block">{t('near.entry.title')}</span>
            <span className="near-sub block">{t('near.entry.sub')}</span>
          </span>
        </button>
      )}
      {seen && (
        <Suspense fallback={null}>
          <OfficesSheet open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

export default NearestOffice;
