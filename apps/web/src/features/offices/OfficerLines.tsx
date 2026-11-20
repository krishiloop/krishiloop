import { Phone, UserRound } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { officeName, placeLine } from './districts';
import type { Office } from './nearest';

/** Name, place and distance of one office (the card and the finder share it). */
export function OfficeHead({ office: o, km, inDistrict }: { office: Office; km: number | null; inDistrict?: boolean }) {
  const { t, lang } = useI18n();
  return (
    <div className="min-w-0">
      <h4 className="near-title">{officeName(o, lang)}</h4>
      <p className="near-sub">{placeLine(o, lang)}</p>
      {km != null ? (
        <p className="near-km" data-testid="near-km">
          {t('near.km', { km: fmtNum(km, lang, { maximumFractionDigits: km < 10 ? 1 : 0 }) })}
        </p>
      ) : inDistrict ? (
        <p className="near-km">{t('near.inDistrict')}</p>
      ) : null}
    </div>
  );
}

/**
 * The officer as the DAE upazila page publishes them: name (Bangla, as published), title, work phone. Fields the
 * page does not give are left out; with no officer at all only the office phone (if any) shows.
 */
export function OfficerLines({ office: o }: { office: Office }) {
  const { t, lang } = useI18n();
  const off = o.officer;
  if (!off && !o.phone) return null;
  return (
    <div className="near-officer" data-testid={off ? 'near-officer' : 'near-officephone'}>
      {off && (
        <p className="near-line">
          <UserRound size={16} aria-hidden />
          <span>
            <span lang="bn" className="font-semibold">
              {off.name_bn}
            </span>
            <span className="near-role"> · {lang === 'bn' ? <span lang="bn">{off.designation_bn ?? off.designation_en}</span> : off.designation_en}</span>
          </span>
        </p>
      )}
      {off?.mobile && (
        <p className="near-line">
          <Phone size={16} aria-hidden />
          <span className="near-num-text">{t('near.officerPhone', { phone: off.mobile })}</span>
        </p>
      )}
      {o.phone && o.phone !== off?.mobile && (
        <p className="near-line">
          <Phone size={16} aria-hidden />
          <span className="near-num-text">{t('near.officePhone', { phone: o.phone })}</span>
        </p>
      )}
      <p className="near-published">{t('near.published')}</p>
    </div>
  );
}
