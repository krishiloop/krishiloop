import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, LocateFixed, Mail, Navigation, Phone, Search } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { motionReduced } from '../../lib/motionPref';
import { cx } from '../../lib/cx';
import { Sheet } from '../../ui/Sheet';
import { DISTRICTS, districtName, officeName, placeLine } from './districts';
import { directionsUrl, haversineKm, NO_LIST_KM, originOf, osmUrl, rankForPlace, telHref, type Office, type Place } from './nearest';
import { locate, pickDistrict, placeStore, useOffices } from './place';
import { searchOffices } from './search';
import { OfficeHead, OfficerLines } from './OfficerLines';

const OfficeMap = lazy(() => import('./OfficeMap'));

/**
 * The finder: a map of every upazila agriculture office, a search box (upazila or district, Bangla or English),
 * "Use my location" (a district list when the browser refuses), and a list sorted by distance. Choosing an office
 * flies the map to it and opens its card with the officer (as published), Call and Open directions.
 * `focusId` opens with that office chosen (the card's "Go there").
 */
export default function OfficesSheet({ open, focusId = null, onClose }: { open: boolean; focusId?: string | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { place, status } = placeStore.use();
  const data = useOffices(open);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(focusId);
  const mapBox = useRef<HTMLDivElement>(null);

  // opened from a card's "Go there": that office is the chosen one
  useEffect(() => {
    if (open && focusId) setSel(focusId);
  }, [open, focusId]);

  const offices = data?.offices ?? [];
  const origin = useMemo(() => originOf(place, offices), [place, offices]);
  const ranked = useMemo(() => (data ? rankForPlace(data.offices, place, 10) : []), [data, place]);
  const far = place?.kind === 'gps' && ranked.length > 0 && ranked[0]!.km > NO_LIST_KM;
  const hits = useMemo(() => (data && q.trim() ? searchOffices(data.offices, q, place?.kind === 'gps' ? origin : null) : null), [data, q, place, origin]);
  const showKm = place?.kind === 'gps' && !far;
  const rows = hits ?? (far ? [] : ranked.map((r) => ({ office: r.office, km: r.km })));

  // a new place, or nothing chosen yet: choose the nearest office (a card's "Go there" keeps its own office)
  const lastPlace = useRef<Place | null>(place);
  const top = far ? undefined : ranked[0]?.office.id;
  useEffect(() => {
    if (!top || (lastPlace.current === place && sel)) return;
    lastPlace.current = place;
    setSel(top);
  }, [place, top, sel]);

  const chosen = sel ? (offices.find((o) => o.id === sel) ?? null) : null;
  const chosenKm = chosen && showKm && origin ? haversineKm(origin.lat, origin.lon, chosen.lat, chosen.lon) : null;
  const nat = data?.national;
  const districts = lang === 'bn' ? [...DISTRICTS].sort((a, b) => a.bn.localeCompare(b.bn, 'bn')) : DISTRICTS;
  const labelOf = (o: Office) => `${officeName(o, lang)} (${placeLine(o, lang)})`;

  const choose = (id: string) => {
    setSel(id);
    mapBox.current?.scrollIntoView({ block: 'start', behavior: motionReduced() ? 'auto' : 'smooth' });
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('near.sheet.title')} subtitle={t('near.sheet.sub')} wide>
      <div className="near-body" data-testid="near-sheet">
        <section className="near-find" aria-label={t('near.search.label')}>
          <label className="near-search">
            <span className="near-label">{t('near.search.label')}</span>
            <span className="near-searchbox">
              <Search size={18} aria-hidden />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('near.search.ph')} autoComplete="off" enterKeyHint="search" data-testid="near-search" />
            </span>
          </label>
          <div className="near-locrow">
            <button type="button" className={cx('btn near-hit', place?.kind === 'gps' ? 'btn-secondary' : 'btn-primary')} onClick={locate} disabled={status === 'asking'} data-testid="near-locate">
              <LocateFixed size={18} aria-hidden /> {status === 'asking' ? t('near.loc.asking') : t('near.loc.allow')}
            </button>
            <select
              className="near-select near-hit"
              value={place?.kind === 'district' ? place.district : ''}
              onChange={(e) => pickDistrict(e.target.value)}
              aria-label={t('near.district.label')}
              data-testid="near-district"
            >
              <option value="">{t('near.district.pick')}</option>
              {districts.map((d) => (
                <option key={d.en} value={d.en}>
                  {lang === 'bn' ? d.bn : d.en}
                </option>
              ))}
            </select>
          </div>
          <p className="near-from" data-testid="near-from" data-kind={place?.kind ?? 'none'}>
            {place?.kind === 'gps' ? (
              <>
                <LocateFixed size={16} aria-hidden /> {t('near.from.you')}
              </>
            ) : place?.kind === 'district' ? (
              t('near.from.district', { district: districtName(place.district, lang) ?? place.district })
            ) : (
              t('near.loc.why')
            )}
          </p>
          {status === 'denied' && (
            <p className="near-denied" role="status" data-testid="near-denied">
              {t('near.loc.denied')}
            </p>
          )}
        </section>

        <div ref={mapBox} className="near-map" role="region" aria-label={t('near.map.label')} data-testid="near-map">
          {data ? (
            <Suspense fallback={<p className="near-maptext">{t('near.map.loading')}</p>}>
              <OfficeMap offices={data.offices} origin={showKm ? origin : null} selected={chosen} onSelect={setSel} labelOf={labelOf} youLabel={t('near.map.you')} errorText={t('near.map.error')} />
            </Suspense>
          ) : (
            <div className="skeleton h-full min-h-60" aria-hidden />
          )}
        </div>
        <p className="near-attrib">
          {t('near.map.tap')} {showKm && chosen ? t('near.map.line') : ''} {t('near.attrib')}
        </p>

        {far && (
          <p className="near-far" role="status" data-testid="near-far">
            {t('near.far')}
          </p>
        )}

        {chosen && <OfficeCard office={chosen} km={chosenKm} inDistrict={place?.kind === 'district' && chosen.district_en === place.district} helpline={nat?.phone ?? null} />}

        <h3 className="eyebrow">{hits ? t('near.search.results') : t('near.list')}</h3>
        {hits && hits.length === 0 && (
          <p className="near-note" role="status" data-testid="near-none">
            {t('near.search.none', { q: q.trim() })}
          </p>
        )}
        {!hits && !place && <p className="near-note">{t('near.list.hint')}</p>}
        {rows.length > 0 && (
          <ol className="near-list" data-testid="near-list">
            {rows.map(({ office: o, km }) => (
              <li key={o.id}>
                <button type="button" className="near-row" aria-pressed={o.id === sel} onClick={() => choose(o.id)} data-testid="near-row" data-id={o.id}>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="near-row-name">{officeName(o, lang)}</span>
                    <span className="near-sub block">{placeLine(o, lang)}</span>
                  </span>
                  {showKm && km != null && (
                    <span className="near-row-km" data-testid="near-row-km">
                      {t('near.km', { km: fmtNum(km, lang, { maximumFractionDigits: km < 10 ? 1 : 0 }) })}
                    </span>
                  )}
                  {o.officer && <span className="near-row-dot" aria-hidden />}
                </button>
              </li>
            ))}
          </ol>
        )}

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
        {lang === 'bn' && <p className="near-small">{t('near.mt')}</p>}
      </div>
    </Sheet>
  );
}

/** The chosen office: name, place, distance, the officer as published, Call, Open directions, and the source. */
function OfficeCard({ office: o, km, inDistrict, helpline }: { office: Office; km: number | null; inDistrict: boolean; helpline: string | null }) {
  const { t, lang } = useI18n();
  const name = officeName(o, lang);
  const call = o.officer?.mobile ? { who: 'officer', phone: o.officer.mobile } : o.phone ? { who: 'office', phone: o.phone } : null;
  return (
    <article className="near-office" data-testid="near-office" data-id={o.id} aria-label={t('near.selected')}>
      <p className="near-eyebrow">{t('near.selected')}</p>
      <OfficeHead office={o} km={km} inDistrict={inDistrict} />
      <OfficerLines office={o} />
      {!o.officer && <p className="near-small">{t('near.officerNone')}</p>}
      <div className="near-actions">
        {call && (
          <a className="btn btn-primary near-hit near-grow" href={telHref(call.phone)} aria-label={`${call.who === 'officer' ? t('near.call.officer') : t('near.call.office')}, ${call.phone}`} data-testid="near-call">
            <Phone size={18} aria-hidden /> {call.who === 'officer' ? t('near.call.officer') : t('near.call.office')}
          </a>
        )}
        <a
          className={cx('btn near-hit near-grow', call ? 'btn-secondary' : 'btn-primary')}
          href={directionsUrl(o.lat, o.lon)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('near.directions.aria', { name })}
          data-testid="near-directions"
        >
          <Navigation size={18} aria-hidden /> {t('near.directions')}
        </a>
        {!o.officer?.mobile && helpline && (
          <a className="btn btn-secondary near-hit near-grow" href={telHref(helpline)} data-testid="near-helpline">
            <Phone size={18} aria-hidden /> {t('near.callcentre.call')}
          </a>
        )}
      </div>
      {o.email && (
        <p className="near-line">
          <Mail size={16} aria-hidden />
          <a href={`mailto:${o.email}`}>{o.email}</a>
        </p>
      )}
      <p className="near-small">
        {o.geo === 'osm_point' ? t('near.exact') : t('near.approx')}{' '}
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
    </article>
  );
}
