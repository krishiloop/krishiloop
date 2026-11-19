import { lazy, Suspense, useEffect, useState } from 'react';
import { ExternalLink, LocateFixed, Mail, Navigation, Phone, UserRound } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { Sheet } from '../../ui/Sheet';
import { currentField, useFarmer } from '../farmer/farmerStore';
import { directionsUrl, nearest, NO_LIST_KM, osmUrl, telHref, type OfficeData, type Ranked } from './nearest';

const OfficeMap = lazy(() => import('./OfficeMap'));

/** The Bangladesh sample farm (rules/demo/demo.yaml, BD-SAMPLE-01): used when no farm is loaded yet. */
const SAMPLE = { lat: 24.75, lon: 90.4 };
type Origin = { lat: number; lon: number; kind: 'you' | 'sample' };
type Ask = 'idle' | 'asking' | 'denied';

export default function OfficesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const st = useFarmer();
  const f = currentField(st);
  const sample: Origin = { lat: f?.lat ?? SAMPLE.lat, lon: f?.lon ?? SAMPLE.lon, kind: 'sample' };
  const [you, setYou] = useState<Origin | null>(null);
  const [ask, setAsk] = useState<Ask>('idle');
  const [data, setData] = useState<OfficeData | null>(null);
  const origin = you ?? sample;

  useEffect(() => {
    if (!open || data) return;
    let live = true;
    void import('../../data/offices/bd.json').then((m) => live && setData((m.default ?? m) as unknown as OfficeData));
    return () => {
      live = false;
    };
  }, [open, data]);

  const locate = () => {
    if (!('geolocation' in navigator)) return setAsk('denied');
    setAsk('asking');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setYou({ lat: p.coords.latitude, lon: p.coords.longitude, kind: 'you' });
        setAsk('idle');
      },
      () => {
        setYou(null);
        setAsk('denied');
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 },
    );
  };

  const ranked: Ranked[] = data ? nearest(data.offices, origin.lat, origin.lon, 5) : [];
  const far = ranked.length > 0 && ranked[0]!.km > NO_LIST_KM;
  const shown = far ? [] : ranked;
  const nat = data?.national;

  return (
    <Sheet open={open} onClose={onClose} title={t('near.sheet.title')} subtitle={t('near.sheet.sub')} wide>
      <div className="near-body" data-testid="near-sheet">
        <section className="near-loc" aria-labelledby="near-loc-title">
          <p id="near-loc-title" className="near-from" data-testid="near-from" data-kind={origin.kind}>
            <LocateFixed size={18} aria-hidden /> {origin.kind === 'you' ? t('near.from.you') : t('near.from.sample')}
          </p>
          {origin.kind === 'sample' && (
            <>
              <p className="text-sm text-ink-2">{t('near.loc.why')}</p>
              <button type="button" className="btn btn-secondary near-hit w-fit" onClick={locate} disabled={ask === 'asking'} data-testid="near-locate">
                <LocateFixed size={18} aria-hidden /> {ask === 'asking' ? t('near.loc.asking') : t('near.loc.allow')}
              </button>
              {ask === 'denied' && (
                <p className="text-sm" role="status" data-testid="near-denied">
                  {t('near.loc.denied')}
                </p>
              )}
            </>
          )}
          {origin.kind === 'you' && (
            <button type="button" className="btn btn-ghost near-hit w-fit" onClick={() => setYou(null)}>
              {t('near.loc.sample')}
            </button>
          )}
        </section>

        {nat && (
          <section className="near-call" aria-labelledby="near-cc-title" data-testid="near-callcentre">
            <div className="min-w-0 flex-1">
              <h3 id="near-cc-title" className="near-title">
                {t('near.callcentre')}
              </h3>
              <p className="near-sub">{t('near.callcentre.sub')}</p>
            </div>
            <a className="btn btn-primary near-hit" href={telHref(nat.phone)} data-testid="near-cc-call">
              <Phone size={18} aria-hidden /> {t('near.callcentre.call')}
            </a>
          </section>
        )}

        {!data && <div className="skeleton h-40" aria-hidden />}
        {far && (
          <p className="near-far" role="status" data-testid="near-far">
            {t('near.far')}
          </p>
        )}

        {shown.length > 0 && (
          <>
            <div className="near-map" role="region" aria-label={t('near.map.label')} data-testid="near-map">
              <Suspense fallback={<p className="near-maptext">{t('near.map.loading')}</p>}>
                <OfficeMap origin={origin} ranked={shown.slice(0, 3)} youLabel={origin.kind === 'you' ? t('near.map.you') : t('near.map.sample')} errorText={t('near.map.error')} />
              </Suspense>
            </div>
            <p className="near-attrib">{t('near.attrib')}</p>
            <h3 className="eyebrow">{t('near.list')}</h3>
            <ol className="near-list" data-testid="near-list">
              {shown.map(({ office: o, km }, i) => {
                const name = lang === 'bn' && o.name_bn ? o.name_bn : o.name_en;
                const place = [lang === 'bn' ? (o.upazila_bn ?? o.upazila_en) : o.upazila_en, lang === 'bn' ? (o.district_bn ?? o.district_en) : o.district_en].filter(Boolean).join(', ');
                return (
                  <li key={o.id} className="near-office panel" data-testid="near-office" data-id={o.id}>
                    <div className="flex items-start gap-3">
                      <span className="near-num" aria-hidden>
                        {fmtNum(i + 1, lang)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="near-title">{name}</h4>
                        <p className="near-sub">{place}</p>
                        <p className="near-km" data-testid="near-km">
                          {t('near.km', { km: fmtNum(km, lang, { maximumFractionDigits: km < 10 ? 1 : 0 }) })}
                        </p>
                      </div>
                    </div>
                    <p className="near-note">{o.geo === 'osm_point' ? t('near.exact') : t('near.approx')}</p>
                    <div className="near-actions">
                      <a className="btn btn-primary near-hit near-go" href={directionsUrl(o.lat, o.lon)} target="_blank" rel="noopener noreferrer" aria-label={t('near.gothere.aria', { name })} data-testid="near-go">
                        <Navigation size={20} aria-hidden /> {t('near.gothere')}
                      </a>
                      {o.phone ? (
                        <a className="btn btn-secondary near-hit" href={telHref(o.phone)} data-testid="near-call">
                          <Phone size={18} aria-hidden /> {t('near.call', { phone: o.phone })}
                        </a>
                      ) : (
                        <p className="near-note m-0" data-testid="near-nophone">
                          {t('near.nophone')}
                        </p>
                      )}
                    </div>
                    {o.email && (
                      <p className="near-line">
                        <Mail size={16} aria-hidden />
                        <a href={`mailto:${o.email}`}>{o.email}</a>
                      </p>
                    )}
                    {o.officer ? (
                      <div className="near-officer" data-testid="near-officer">
                        <p className="near-line">
                          <UserRound size={16} aria-hidden />
                          <span>
                            {t('near.officer')}: <span lang="bn">{o.officer.name_bn}</span>,{' '}
                            {lang === 'bn' ? <span lang="bn">{o.officer.designation_bn ?? o.officer.designation_en}</span> : o.officer.designation_en}
                          </span>
                        </p>
                        {o.officer.mobile && (
                          <a className="btn btn-ghost near-hit w-fit" href={telHref(o.officer.mobile)} data-testid="near-officer-call">
                            <Phone size={16} aria-hidden /> {t('near.officerCall', { phone: o.officer.mobile })}
                          </a>
                        )}
                        <p className="near-small">{t('near.officerNote')}</p>
                      </div>
                    ) : (
                      <p className="near-small">{t('near.officerNone')}</p>
                    )}
                    <p className="near-small">
                      {o.source_url ? (
                        <>
                          {t('near.source', { date: o.source_read ? fmtDate(o.source_read, lang, 'long') : '' })}{' '}
                          <a href={o.source_url} target="_blank" rel="noopener noreferrer">
                            {new URL(o.source_url).host}
                          </a>
                        </>
                      ) : (
                        t('near.sourceNone')
                      )}{' '}
                      <a href={osmUrl(o.lat, o.lon)} target="_blank" rel="noopener noreferrer" className="near-osm">
                        {t('near.osm')} <ExternalLink size={12} aria-hidden className="inline" />
                      </a>
                    </p>
                  </li>
                );
              })}
            </ol>
          </>
        )}
        {lang === 'bn' && <p className="near-small">{t('near.mt')}</p>}
      </div>
    </Sheet>
  );
}
