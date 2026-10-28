import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ExternalLink, Flag, Scale, ScanLine, ShieldCheck } from 'lucide-react';
import { Qr } from './Qr';
import { groupReadings, numericSeries, type ReadingGroup } from './readings';
import { SampleBadge } from '../../components/ui/Badges';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate, fmtNum, humanize, pickText, shortId } from '../../lib/format';
import { verifyUrl } from '../../lib/qr';
import type { Action, ConfidenceLevel, DataSource, ReviewLevel } from '../../lib/api/types';
import { cx } from '../../lib/cx';

const REVIEW_KEY: Record<ReviewLevel, Key> = { expert: 'review.expert', team: 'review.team', pending: 'review.pending' };
const CONF_KEY: Record<ConfidenceLevel, Key> = { high: 'confidence.high', medium: 'confidence.medium', low: 'confidence.low' };
const CONF_PIPS: Record<ConfidenceLevel, number> = { high: 3, medium: 2, low: 1 };
const LICENCE_KEY = { cleared: 'receipt.licence.cleared', permitted: 'receipt.licence.permitted', cited_permission_requested: 'receipt.licence.cited_permission_requested' } as const;
const VAR_KEY: Record<string, Key> = {
  relative_humidity_2m_mean: 'var.relative_humidity_2m_mean',
  rh_mean_pct: 'var.relative_humidity_2m_mean',
  tmin_c: 'var.tmin_c',
  tmax_c: 'var.tmax_c',
  precip_mm: 'var.precip_mm',
  leaf_diagnosis: 'var.leaf_diagnosis',
  leaf_diagnosis_prob: 'var.leaf_diagnosis_prob',
  forecast_humid_mild_days: 'var.forecast_humid_mild_days',
};

export function Spark({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 96;
  const h = 28;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 3 - ((v - min) / span) * (h - 6)}`).join(' ');
  return (
    <svg className="pass-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w} cy={Number(pts.split(' ').at(-1)!.split(',')[1])} r="2.6" fill="currentColor" />
    </svg>
  );
}

/**
 * The receipt: a boarding-pass style card. Left: the claim, the quoted source passage with page, the rule and its
 * review level, the confidence, the numbers a reviewer set (flagged "not from the source"). Right (or bottom on a
 * phone): the QR that opens the public verifier. Tap "Show the evidence" for the readings and model versions.
 */
export function ReceiptPass({ action, source, index, total }: { action: Action; source: DataSource | null; index: number; total: number }) {
  const { t, lang } = useI18n();
  const r = action.receipt;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const title = pickText(action.title, lang);
  const credId = action.receipt_credential_id;
  const url = credId ? verifyUrl(credId) : null;
  const groups = groupReadings(r.data);
  const rule = r.rule_refs[0];
  const sample = source === 'sample';

  return (
    <article className="pass" data-sample={sample} aria-label={`${t('receipt.title')} ${index + 1}`} data-testid="receipt-pass">
      <div className="pass-main">
        <div className="pass-top">
          <span className="pass-kicker">{t('receipt.header')}</span>
          <span className="flex items-center gap-2">
            {sample ? <SampleBadge className="pass-sample" /> : null}
            <span className="pass-kicker tabular">
              {index + 1}/{total}
            </span>
          </span>
        </div>

        <h3 className="pass-claim" lang={title.lang}>
          {title.text}
        </h3>

        {r.sources.map((s) => (
          <figure key={`${s.doc_id}-${s.page}-${s.quote_sha256.slice(0, 6)}`} className="pass-source">
            <blockquote className="pass-quote" lang={s.language}>
              “{s.quote}”
            </blockquote>
            <figcaption className="pass-cite">
              <span className="pass-chip tabular">{t('common.page', { n: s.page })}</span>
              <span>
                {s.title} · {s.publisher}
              </span>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="pass-link">
                  {t('receipt.readSource')}
                  <ExternalLink size={12} aria-hidden />
                </a>
              ) : null}
            </figcaption>
          </figure>
        ))}

        <dl className="pass-facts">
          <div>
            <dt>{t('receipt.rule')}</dt>
            <dd>
              <span className="pass-mono">
                {rule?.rule_id} {t('receipt.version', { n: rule?.version ?? 1 })}
              </span>
              {rule ? (
                <span className="pass-chip" data-tone={rule.review_level} title={t(REVIEW_KEY[rule.review_level])}>
                  <Scale size={12} aria-hidden />
                  {t(REVIEW_KEY[rule.review_level])}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t('receipt.confidence')}</dt>
            <dd>
              <span className="pass-pips" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <i key={i} data-on={i < CONF_PIPS[r.confidence.level]} />
                ))}
              </span>
              <span>{t(CONF_KEY[r.confidence.level])}</span>
            </dd>
          </div>
          <div className="pass-facts-wide">
            <dt>{t('receipt.data')}</dt>
            <dd className="pass-data">
              {groups.length === 0 ? <span className="text-paper-dim">{t('receipt.dataNone')}</span> : groups.map((g) => <DataLine key={`${g.source}${g.variable}`} g={g} />)}
            </dd>
          </div>
        </dl>

        {r.reviewer_parameters?.length ? (
          <div className="pass-params">
            <p className="pass-params-title">
              <Flag size={13} aria-hidden /> {t('receipt.params')}
            </p>
            <ul>
              {r.reviewer_parameters.map((p) => (
                <li key={p.name}>
                  <span className="pass-mono">
                    {p.name} = {p.value}
                    {p.unit ? ` ${p.unit}` : ''}
                  </span>
                  <span className="pass-chip" data-tone="flag">
                    {t('receipt.paramFlag')}
                  </span>
                  <span className="text-paper-dim">{t('receipt.paramBy', { who: p.set_by })}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <button type="button" className="pass-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
          <ChevronDown size={16} aria-hidden data-open={open} />
          {open ? t('receipt.evidenceHide') : t('receipt.evidence')}
        </button>
        <div id={panelId} className="pass-evidence" data-open={open}>
          <div>
            <Evidence action={action} groups={groups} />
          </div>
        </div>
      </div>

      <div className="pass-stub">
        {url && credId ? (
          <>
            <Qr value={url} size={116} label={t('receipt.qrAlt')} className="pass-qr" />
            <p className="pass-scan">
              <ScanLine size={14} aria-hidden /> {t('receipt.scan')}
            </p>
            <p className="pass-mono pass-id" title={credId}>
              …{shortId(credId, 10)}
            </p>
            <Link className="pass-open" to={`/verify/${encodeURIComponent(credId)}`}>
              <ShieldCheck size={14} aria-hidden />
              {t('receipt.open')}
            </Link>
            <p className="pass-hint">{t('receipt.stubHint')}</p>
          </>
        ) : (
          <p className="pass-hint">{t('common.na')}</p>
        )}
      </div>
    </article>
  );
}

export function varLabel(variable: string, t: (k: Key) => string): string {
  const k = VAR_KEY[variable];
  return k ? t(k) : humanize(variable);
}

export function DataLine({ g }: { g: ReadingGroup }) {
  const { t, lang } = useI18n();
  const nums = numericSeries(g);
  const first = g.series[0]?.date;
  const last = g.series.at(-1)?.date;
  const range = nums.length ? `${fmtNum(Math.min(...nums), lang)}–${fmtNum(Math.max(...nums), lang)}${g.unit ? ` ${g.unit}` : ''}` : null;
  return (
    <span className={cx('pass-dataline')}>
      <span className="pass-dataname">{varLabel(g.variable, t)}</span>
      {g.series.length > 1 && range ? (
        <>
          <Spark values={nums} label={`${varLabel(g.variable, t)} ${range}`} />
          <span className="tabular">{range}</span>
        </>
      ) : (
        <span className="tabular">
          {String(g.series[0]?.value)}
          {g.unit ? ` ${g.unit}` : ''}
        </span>
      )}
      <span className="pass-mini">
        {g.derived ? t('receipt.dataDerived') : g.source}
        {first && last && first !== last ? ` · ${t('receipt.dataMore', { n: g.series.length, from: fmtDate(first, lang), to: fmtDate(last, lang) })}` : ''}
      </span>
    </span>
  );
}

function Evidence({ action, groups }: { action: Action; groups: ReadingGroup[] }) {
  const { t, lang } = useI18n();
  const r = action.receipt;
  return (
    <div className="pass-evidence-body">
      <section>
        <h4>{t('receipt.confidence')}</h4>
        <p>{r.confidence.basis}</p>
      </section>
      {groups.length ? (
        <section>
          <h4>{t('receipt.data')}</h4>
          <div className="pass-tablewrap">
            <table className="pass-table">
              <thead>
                <tr>
                  <th scope="col">{t('receipt.col.reading')}</th>
                  <th scope="col">{t('receipt.col.value')}</th>
                  <th scope="col">{t('receipt.col.observed')}</th>
                  <th scope="col">{t('receipt.col.source')}</th>
                </tr>
              </thead>
              <tbody>
                {r.data.map((d, i) => (
                  <tr key={`${d.variable}-${i}`}>
                    <th scope="row" className="pass-mono">
                      {d.variable}
                    </th>
                    <td className="tabular">
                      {String(d.value)}
                      {d.unit ? ` ${d.unit}` : ''}
                    </td>
                    <td className="tabular">{fmtDate(d.observed_at, lang, 'short')}</td>
                    <td className="pass-mono">
                      {d.source} · {fmtDate(d.retrieved_at, lang, 'datetime')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <section>
        <h4>{t('receipt.source')}</h4>
        {r.sources.map((s) => (
          <p key={s.quote_sha256}>
            <span className="pass-mono">{s.doc_id}</span> · {t('receipt.publisher')}: {s.publisher} · {t('receipt.licence')}: {t(LICENCE_KEY[s.licence_status])}
            {s.acknowledgement ? <span className="pass-mini block">{s.acknowledgement}</span> : null}
            <span className="pass-mini pass-mono block">sha256 {s.quote_sha256.slice(0, 16)}…</span>
          </p>
        ))}
      </section>
      <section>
        <h4>{t('receipt.models')}</h4>
        <p className="pass-mono">
          {t('receipt.planner', { v: r.generated_by.planner_version })} · {t('receipt.validator', { v: r.generated_by.validator_version })} · {t('receipt.phrasing')}:{' '}
          {r.generated_by.phrasing_model ?? t('receipt.phrasingNone')}
        </p>
        <p className="pass-mini pass-mono">
          {t('receipt.id')} {r.receipt_id} · {t('receipt.issued')} {fmtDate(r.created_at, lang, 'datetime')}
        </p>
      </section>
    </div>
  );
}
