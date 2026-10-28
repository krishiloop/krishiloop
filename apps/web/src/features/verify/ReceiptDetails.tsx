import { Link } from 'react-router-dom';
import { ArrowRight, ExternalLink, Flag, Scale, ShieldCheck } from 'lucide-react';
import { DataLine } from '../farmer/ReceiptPass';
import { groupReadings } from '../farmer/readings';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate } from '../../lib/format';
import type { Credential, Receipt, ReviewLevel } from '../../lib/api/types';

const REVIEW_KEY: Record<ReviewLevel, Key> = { expert: 'review.expert', team: 'review.team', pending: 'review.pending' };
const LICENCE_KEY = { cleared: 'receipt.licence.cleared', permitted: 'receipt.licence.permitted', cited_permission_requested: 'receipt.licence.cited_permission_requested' } as const;

/** "What this receipt says": the signed content, laid out for an officer or an auditor. */
export function ReceiptDetails({ receipt, cred }: { receipt: Receipt; cred: Credential }) {
  const { t, lang } = useI18n();
  const groups = groupReadings(receipt.data);
  return (
    <section className="surface surface-pad" aria-labelledby="details-t" data-testid="receipt-details">
      <h2 id="details-t" className="text-h3 font-semibold tracking-tight">
        {t('verify.details')}
      </h2>

      <div className="vd-grid">
        <div className="vd-block vd-wide">
          <h3 className="eyebrow">{t('receipt.source')}</h3>
          {receipt.sources.map((s) => (
            <figure key={s.quote_sha256} className="vd-source">
              <blockquote lang={s.language}>“{s.quote}”</blockquote>
              <figcaption>
                <span className="chip chip-mono tabular">{t('common.page', { n: s.page })}</span>
                <span>
                  {s.title} · {s.publisher}
                </span>
                <span className="chip">
                  {t('receipt.licence')}: {t(LICENCE_KEY[s.licence_status])}
                </span>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">
                    {t('receipt.readSource')} <ExternalLink size={12} aria-hidden />
                  </a>
                ) : null}
              </figcaption>
              {s.acknowledgement ? <p className="m-0 mt-1 text-xs text-dim">{s.acknowledgement}</p> : null}
            </figure>
          ))}
        </div>

        <div className="vd-block">
          <h3 className="eyebrow">{t('receipt.rule')}</h3>
          <ul className="vd-list">
            {receipt.rule_refs.map((r) => (
              <li key={r.credential_id}>
                <span className="mono">
                  {r.rule_id} {t('receipt.version', { n: r.version })}
                </span>
                <span className="chip" data-tone={r.review_level === 'expert' ? 'go' : r.review_level === 'pending' ? 'wait' : undefined}>
                  <Scale size={12} aria-hidden /> {t(REVIEW_KEY[r.review_level])}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="vd-block">
          <h3 className="eyebrow">{t('receipt.confidence')}</h3>
          <p className="m-0 font-semibold">{t(`confidence.${receipt.confidence.level}` as Key)}</p>
          <p className="m-0 mt-1 text-sm text-chrome">{receipt.confidence.basis}</p>
        </div>

        {receipt.reviewer_parameters?.length ? (
          <div className="vd-block vd-wide vd-params">
            <h3 className="eyebrow flex items-center gap-2">
              <Flag size={13} aria-hidden /> {t('receipt.params')}
            </h3>
            <ul className="vd-list">
              {receipt.reviewer_parameters.map((p) => (
                <li key={p.name}>
                  <span className="mono">
                    {p.name} = {p.value}
                    {p.unit ? ` ${p.unit}` : ''}
                  </span>
                  <span className="chip" data-tone="stop">
                    {t('receipt.paramFlag')}
                  </span>
                  <span className="text-sm text-chrome">
                    {t('receipt.paramBy', { who: p.set_by })}. {p.note}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {receipt.area_trust_ref ? (
          <div className="vd-block vd-wide" data-testid="receipt-photo-trust">
            <h3 className="eyebrow flex items-center gap-2">
              <ShieldCheck size={13} aria-hidden /> {t('verify.photo.block')}
            </h3>
            <p className="m-0 mt-2">{t('verify.photo.block.body', { area: receipt.area_trust_ref.area })}</p>
            <p className="m-0 mt-1 mono text-dim">
              {receipt.area_trust_ref.area} · {receipt.area_trust_ref.model}
            </p>
            <Link to={`/verify/${encodeURIComponent(receipt.area_trust_ref.credential_id)}`} className="link mt-2 inline-flex items-center gap-1.5 text-sm" data-testid="receipt-photo-trust-link">
              {t('verify.photo.block.verify')} <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        ) : null}

        <div className="vd-block vd-wide">
          <h3 className="eyebrow">{t('receipt.data')}</h3>
          {groups.length ? (
            <div className="vd-data pass-lite">
              {groups.map((g) => (
                <DataLine key={`${g.source}${g.variable}`} g={g} serverPhoto={!!receipt.area_trust_ref} />
              ))}
            </div>
          ) : (
            <p className="m-0 text-chrome">{t('receipt.dataNone')}</p>
          )}
        </div>

        <div className="vd-block vd-wide">
          <h3 className="eyebrow">{t('verify.sigTitle')}</h3>
          <dl className="vd-meta">
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
            <div>
              <dt>{t('receipt.models')}</dt>
              <dd>
                <span className="mono">{t('receipt.planner', { v: receipt.generated_by.planner_version })}</span> · <span className="mono">{t('receipt.validator', { v: receipt.generated_by.validator_version })}</span> · {t('receipt.phrasing')}:{' '}
                {receipt.generated_by.phrasing_model ?? t('receipt.phrasingNone')}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
