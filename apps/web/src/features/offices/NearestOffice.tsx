import { lazy, Suspense, useId, useState } from 'react';
import { LocateFixed, MapPin, Navigation, Phone } from 'lucide-react';
import '../../lib/i18n/strings.offices';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/cx';
import { DISTRICTS, officeName } from './districts';
import { telHref } from './nearest';
import { clearPlace, locate, pickDistrict, placeStore, useOffices } from './place';
import { cardModel } from './unsure';
import { OfficeHead, OfficerLines } from './OfficerLines';
import { LazyLeafFarmer } from '../../ui/farmer/FarmerCameo';
import './offices.css';

/** The finder (map, search, list) and Leaflet load on the first tap. */
const OfficesSheet = lazy(() => import('./OfficesSheet'));

/**
 * "Nearest Krishi officer". Two looks:
 *  - card: right where a result is not sure (photo check "shortlist"/"refer", Ask abstained or "talk to your officer",
 *    this week's advice held for an officer). It names the closest office and, when the DAE page publishes them, the
 *    officer and the work phone, with Call, Go there (the map, with a line from the farmer) and Call 16123.
 *    With no place known it asks for the location with one button; if that is refused, a district list.
 *  - entry: a plain row, "Find your nearest Krishi officer", that opens the finder.
 */
export function NearestOffice({ variant = 'card', className }: { variant?: 'card' | 'entry'; className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // the sheet stays mounted after its first opening so it can close with its exit motion
  const [seen, setSeen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const go = (id: string | null = null) => {
    setFocus(id);
    setSeen(true);
    setOpen(true);
  };
  return (
    <>
      {variant === 'card' ? (
        <NearestCard className={className} onGo={go} />
      ) : (
        <button type="button" className={cx('near-entry', className)} onClick={() => go()} data-testid="near-entry">
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
          <OfficesSheet open={open} focusId={focus} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

function NearestCard({ className, onGo }: { className?: string; onGo: (id: string | null) => void }) {
  const { t, lang } = useI18n();
  const { place, status } = placeStore.use();
  const tid = useId();
  const data = useOffices(place != null);
  const m = cardModel(data, place);
  const districts = lang === 'bn' ? [...DISTRICTS].sort((a, b) => a.bn.localeCompare(b.bn, 'bn')) : DISTRICTS;

  return (
    <section className={cx('near-card', className)} aria-labelledby={tid} data-testid="near-card" data-state={m.kind}>
      <div className="near-card-top">
        {/* the leaf farmer: thinking while we don't know where he is, then pointing the way to the office */}
        <span className="near-farmer" aria-hidden>
          <LazyLeafFarmer mood={m.kind === 'office' ? 'pointing' : 'thinking'} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={tid} className="near-eyebrow">
            {t('near.card.title')}
          </h3>
          <p className="near-sub">{t('near.card.sub')}</p>
        </div>
      </div>

      {m.kind === 'ask' && (
        <div className="near-card-ask">
          {status !== 'denied' ? (
            <>
              <p className="near-note">{t('near.card.ask')}</p>
              <button type="button" className="btn btn-primary near-hit" onClick={locate} disabled={status === 'asking'} data-testid="near-card-locate">
                <LocateFixed size={18} aria-hidden /> {status === 'asking' ? t('near.loc.asking') : t('near.loc.allow')}
              </button>
            </>
          ) : (
            <label className="near-district">
              <span className="near-note" role="status" data-testid="near-card-denied">
                {t('near.card.denied')}
              </span>
              <select className="near-select near-hit" defaultValue="" onChange={(e) => pickDistrict(e.target.value)} data-testid="near-card-district">
                <option value="" disabled>
                  {t('near.district.pick')}
                </option>
                {districts.map((d) => (
                  <option key={d.en} value={d.en}>
                    {lang === 'bn' ? d.bn : d.en}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {m.kind === 'loading' && <div className="skeleton h-24" aria-label={t('near.card.loading')} />}

      {m.kind === 'far' && (
        <>
          <p className="near-note" role="status">
            {t('near.far')}
          </p>
          {m.helpline && (
            <div className="near-actions">
              <a className="btn btn-primary near-hit" href={telHref(m.helpline)} data-testid="near-card-helpline">
                <Phone size={18} aria-hidden /> {t('near.callcentre.call')}
              </a>
            </div>
          )}
        </>
      )}

      {m.kind === 'office' && (
        <div className="near-card-office" data-testid="near-card-office" data-id={m.office.id}>
          <OfficeHead office={m.office} km={m.km} inDistrict={place?.kind === 'district'} />
          <OfficerLines office={m.office} />
          <div className="near-actions">
            {m.call && (
              <a className="btn btn-primary near-hit near-grow" href={telHref(m.call.phone)} aria-label={`${m.call.who === 'officer' ? t('near.call.officer') : t('near.call.office')}, ${m.call.phone}`} data-testid="near-card-call">
                <Phone size={18} aria-hidden /> {m.call.who === 'officer' ? t('near.call.officer') : t('near.call.office')}
              </a>
            )}
            <button type="button" className={cx('btn near-hit near-grow', m.call ? 'btn-secondary' : 'btn-primary')} onClick={() => onGo(m.office.id)} aria-label={t('near.gothere.aria', { name: officeName(m.office, lang) })} data-testid="near-card-go">
              <Navigation size={18} aria-hidden /> {t('near.gothere')}
            </button>
            {m.helpline && (
              <a className="btn btn-secondary near-hit near-grow" href={telHref(m.helpline)} data-testid="near-card-helpline">
                <Phone size={18} aria-hidden /> {t('near.callcentre.call')}
              </a>
            )}
          </div>
          <button type="button" className="near-link" onClick={clearPlace} data-testid="near-card-change">
            {t('near.card.change')}
          </button>
        </div>
      )}
    </section>
  );
}

export default NearestOffice;
