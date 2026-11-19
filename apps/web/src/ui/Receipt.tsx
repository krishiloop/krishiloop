import type { ReactNode } from 'react';
import type { Receipt } from '../lib/api/types';
import { useI18n } from '../lib/i18n';
import { fmtDate, pickText, shortId } from '../lib/format';
import { verifyUrl } from '../lib/qr';
import { cx } from '../lib/cx';
import { DecisionPictogram, KindIcon } from './Pictogram';
import { Quote } from './Quote';
import { Qr } from './Qr';
import { Stamp, type StampKind } from './Stamp';
import { toneOfLight } from './Chip';
import { LogoMark } from './Logo';
import { readingLines, sourceLabel } from './receiptView';

export const TONE_TILE = {
  go: 'bg-go-wash text-go',
  wait: 'bg-wait-wash text-wait',
  stop: 'bg-stop-wash text-stop',
  neutral: 'bg-sunk text-ink-2',
  carbon: 'bg-carbon-wash text-carbon',
} as const;
export const TONE_TEXT = { go: 'text-go', wait: 'text-wait', stop: 'text-stop', neutral: 'text-ink-2', carbon: 'text-carbon' } as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="eyebrow pt-[3px]">{label}</dt>
      <dd className="m-0 min-w-0 text-ink">{children}</dd>
    </>
  );
}

/**
 * The advice receipt: the product's one object (DESIGN.md). Real signed content only — the advice, the verbatim source
 * passage with its page, the field data with its source, the rule version and its review level, the numbers people set
 * ("not from the source"), the confidence, and a QR that opens the public verifier.
 *
 * `status` lands a stamp over the stub (give `stampKey` a new value to land it again); `struck` strikes the rule line
 * through (a recall); `print` feeds the paper out of a slot once (DESIGN.md: three feed pauses).
 */
export function ReceiptCard({
  receipt,
  credentialId,
  status,
  stampKey,
  mark,
  compact,
  tiny,
  print,
  struck,
  stampDelay = 0,
  className,
  children,
}: {
  receipt: Receipt;
  credentialId?: string;
  status?: StampKind | null;
  stampKey?: string | number;
  mark?: ReactNode;
  compact?: boolean;
  /** v6: no quote and no signature row, just the advice, the rule and the week (home cards, where the page must stay light) */
  tiny?: boolean;
  print?: boolean;
  struck?: boolean;
  /** ms before the stamp lands (e.g. after the paper has printed) */
  stampDelay?: number;
  className?: string;
  children?: ReactNode;
}) {
  const { t, lang } = useI18n();
  const advice = receipt.advice;
  const title = pickText(advice?.title, lang);
  const tone = toneOfLight(advice?.traffic_light);
  const source = receipt.sources[0];
  const lines = compact ? [] : readingLines(receipt.data).slice(0, 2);
  const params = receipt.reviewer_parameters ?? [];
  const rule = receipt.rule_refs[0];
  const plan = receipt.plan;

  return (
    <article className={cx('paper-object relative', className)} aria-label={`${t('ui.receipt.header')}: ${title.text}`}>
      <div className={cx(print && 'print-slot')}>
        <div className={cx('paper serrated-b relative px-5 pb-7 pt-5 sm:px-6', print && 'print-in')}>
          <header className="flex items-center justify-between gap-3">
            <span className="eyebrow flex items-center gap-2 text-ink-2">
              <LogoMark size={15} />
              KrishiLoop · {t('ui.receipt.header')}
            </span>
            {mark}
          </header>

          <div className="mt-5 flex items-start gap-4">
            <span className={cx('grid size-14 flex-none place-items-center rounded-[10px]', TONE_TILE[tone])} style={{ ['--pict-bg' as string]: `var(--color-${tone === 'neutral' ? 'sunk' : `${tone}-wash`})` }}>
              {advice?.decision ? <DecisionPictogram decision={advice.decision} size={40} /> : <KindIcon kind={advice?.kind ?? 'other'} size={26} />}
            </span>
            <div className="min-w-0">
              <p className={cx('text-sm font-semibold', TONE_TEXT[tone])}>{advice?.decision ? t(`ui.decision.${advice.decision}`) : t(`ui.kind.${advice?.kind ?? 'other'}`)}</p>
              <h3 lang={title.lang} className="mt-0.5 text-[1.1rem] font-semibold leading-snug text-ink">
                {title.text}
              </h3>
            </div>
          </div>

          {source && !tiny && <Quote source={source} lines={compact ? 3 : 6} className="mt-5 border-l-2 border-rule-2 pl-4" />}

          <dl className="mt-5 grid grid-cols-[6.4rem_1fr] gap-x-3 gap-y-2 text-sm">
            {rule && (
              <Row label={t('ui.receipt.rule')}>
                <span className={cx('mono', struck && 'text-stop line-through decoration-2')}>
                  {rule.rule_id} v{rule.version}
                </span>
                <span className="text-ink-3"> · {t(`ui.review.${rule.review_level}`)}</span>
              </Row>
            )}
            {lines.map((l) => (
              <Row key={l.label} label={t('ui.receipt.data')}>
                {l.label} <span className="mono">{l.value}</span>
                <span className="text-ink-3">
                  {' '}
                  · {sourceLabel(l.source)}
                  {l.count > 1 ? ` · ${t('ui.receipt.readings', { n: l.count })}` : ''}
                </span>
              </Row>
            ))}
            {!compact && params[0] && (
              <Row label={t('ui.receipt.set')}>
                <span className="mono">
                  {params[0].name} = {params[0].value}
                  {params[0].unit ? ` ${params[0].unit}` : ''}
                </span>
                <span className="text-wait"> · {t('ui.receipt.notSource')}</span>
                {params.length > 1 && <span className="text-ink-3"> · +{params.length - 1}</span>}
              </Row>
            )}
            {!compact && (
              <Row label={t('ui.receipt.confidence')}>
                {t(`ui.conf.${receipt.confidence.level}`)}
              </Row>
            )}
            {plan && (
              <Row label={t('ui.receipt.valid')}>
                <span className="mono">
                  {fmtDate(plan.valid_from, lang)} – {fmtDate(plan.valid_to, lang)}
                </span>
              </Row>
            )}
            {!tiny && (
              <Row label={t('ui.receipt.signed')}>
                <span className="mono">eddsa-jcs-2022</span>
                <span className="text-ink-3"> · {fmtDate(receipt.created_at, lang)}</span>
              </Row>
            )}
          </dl>

          {credentialId && (
            <>
              <div className="perf my-5" style={{ ['--perf-bg' as string]: 'var(--color-paper)' }} />
              {/* QR · words · a column kept free for the stamp, so it never covers text */}
              <footer className="grid grid-cols-[auto_1fr_5.5rem] items-center gap-3 sm:grid-cols-[auto_1fr_8rem] sm:gap-4">
                <Qr value={verifyUrl(credentialId)} size={78} label={t('ui.receipt.verify')} className="flex-none" />
                <div className="min-w-0">
                  <p className="font-semibold leading-tight">{t('ui.receipt.scan')}</p>
                  <p className="mt-1 text-sm leading-snug text-ink-3">{t('ui.receipt.scanSub')}</p>
                  <p className="mono mt-1.5 text-xs text-ink-3">№ …{shortId(credentialId, 10)}</p>
                </div>
                <span aria-hidden />
              </footer>
            </>
          )}
          {/* without a QR stub the stamp sits in its own row, so it never covers a line of the receipt */}
          {status && !credentialId && (
            <div className="mt-4 flex justify-end pr-1">
              <Stamp key={stampKey} kind={status} land size="inherit" className="text-[1.05rem] sm:text-[1.3rem]" style={stampDelay ? { animationDelay: `${stampDelay}ms` } : undefined} />
            </div>
          )}
          {children}
        </div>
      </div>
      {status && credentialId && (
        <Stamp
          key={stampKey}
          kind={status}
          land
          size="inherit"
          className="absolute bottom-[3.1rem] right-3 text-[1.05rem] sm:bottom-[3.3rem] sm:right-5 sm:text-[1.45rem]"
          style={stampDelay ? { animationDelay: `${stampDelay}ms` } : undefined}
        />
      )}
    </article>
  );
}
