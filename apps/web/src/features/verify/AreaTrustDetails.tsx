import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { POLICY_V1 } from '../trust/policy';
import type { AreaTrustSubject, Credential } from '../../lib/api/types';

/**
 * "What this credential says": the signed content of an area's earned photo trust, laid out for an officer or an
 * auditor, like the receipt's own details. Every number is read from the verified credential (`credentialSubject`).
 */
export function AreaTrustDetails({ cred, area }: { cred: Credential; area: AreaTrustSubject }) {
  const { t, lang } = useI18n();
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <section className="surface surface-pad" aria-labelledby="atd-t" data-testid="area-details">
      <h2 id="atd-t" className="text-h3 font-semibold tracking-tight">
        {t('verify.area.details')}
      </h2>
      <dl className="vd-meta mt-4">
        <div>
          <dt>{t('trust.area')}</dt>
          <dd className="mono" data-testid="area-d-area">
            {area.area}
          </dd>
        </div>
        <div>
          <dt>{t('trust.model')}</dt>
          <dd className="mono">{area.model}</dd>
        </div>
        <div>
          <dt>{t('verify.area.earned')}</dt>
          <dd className="mono">{fmtDate(area.opened_at, lang, 'datetime')}</dd>
        </div>
        <div>
          <dt>{t('verify.area.verdicts')}</dt>
          <dd className="tabular">{fmtNum(area.verdicts, lang)}</dd>
        </div>
        <div>
          <dt>{t('verify.area.sure')}</dt>
          <dd className="tabular">{fmtNum(area.sure_in_window, lang)}</dd>
        </div>
        <div>
          <dt>{t('verify.area.right')}</dt>
          <dd className="tabular">{fmtNum(area.sure_right_in_window, lang)}</dd>
        </div>
        <div>
          <dt>{t('verify.area.precision')}</dt>
          <dd className="tabular">{area.precision === null ? '—' : `${fmtNum(Math.round(area.precision * 1000) / 10, lang, { maximumFractionDigits: 1 })}%`}</dd>
        </div>
        <div>
          <dt>{t('verify.area.bound')}</dt>
          <dd className="tabular" data-testid="area-d-bound">
            {t('verify.area.boundVsBar', { lb: two(area.lower_bound), bar: two(POLICY_V1.openLb) })}
          </dd>
        </div>
        <div>
          <dt>{t('verify.area.policy')}</dt>
          <dd className="mono">
            {area.policy_id ? `${area.policy_id} ` : ''}v{fmtNum(area.policy_version, lang)}
          </dd>
        </div>
        <div>
          <dt>{t('verify.issuer')}</dt>
          <dd className="mono">{cred.issuer}</dd>
        </div>
        <div>
          <dt>{t('verify.issued')}</dt>
          <dd className="mono">{fmtDate(cred.validFrom, lang, 'datetime')}</dd>
        </div>
        <div>
          <dt>{t('verify.suite')}</dt>
          <dd className="mono">
            {cred.proof.type} · {cred.proof.cryptosuite}
          </dd>
        </div>
        <div>
          <dt>{t('verify.credId')}</dt>
          <dd className="mono">{cred.id}</dd>
        </div>
      </dl>
      <Link to="/trust" className="link mt-4 inline-flex items-center gap-1.5 text-sm" data-testid="area-d-panel">
        {t('verify.area.panel')} <ArrowRight size={13} aria-hidden />
      </Link>
    </section>
  );
}
