import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, FlaskConical, WifiOff } from 'lucide-react';
import type { AreaTrustSubject, Receipt } from '../../lib/api/types';
import type { VerifyOutcome } from '../../lib/api/client';
import { isMySandboxCredential } from '../../lib/api/client';
import { RECORDED_AT } from '../../data/recorded';
import { useI18n } from '../../lib/i18n';
import { fmtDate, shortId } from '../../lib/format';
import { cx } from '../../lib/cx';
import { Stamp, type StampKind } from '../../ui/Stamp';
import { DataMark } from '../../ui/DataMark';
import { Button } from '../../ui/Button';
import { splitRecalled } from '../trust/gate';

export type VerdictKind = 'authentic' | 'recalled' | 'invalid' | 'expired' | 'unreachable';

export function verdictOf(o: VerifyOutcome | null, failed: boolean): VerdictKind {
  if (failed || !o || o.status === 'unreachable') return 'unreachable';
  if (o.status === 'authentic' && o.expired) return 'expired';
  return o.status;
}

const STAMP: Record<Exclude<VerdictKind, 'unreachable'>, StampKind> = { authentic: 'authentic', recalled: 'recalled', invalid: 'invalid', expired: 'expired' };

/** The one-line meaning of a verdict, also used for the screen-reader announcement. */
export function useMeaning(kind: VerdictKind, receipt: Receipt | null, area: AreaTrustSubject | null, outcome: VerifyOutcome | null) {
  const { t, lang } = useI18n();
  const photo = splitRecalled(outcome?.rules).photoTrust;
  const plan = receipt?.plan;
  const week = plan ? { from: fmtDate(plan.valid_from, lang), to: fmtDate(plan.valid_to, lang) } : { from: '—', to: '—' };
  if (area) {
    if (kind === 'authentic' || kind === 'expired') return { line: t('vf.meaning.area.authentic', { area: area.area }), sub: t('vf.sub.area.authentic') };
    if (kind === 'recalled') return { line: t('vf.meaning.area.recalled', { area: area.area }), sub: t('vf.sub.area.recalled') };
  }
  switch (kind) {
    case 'authentic':
      return { line: t('vf.meaning.authentic'), sub: t('vf.sub.authentic') };
    case 'expired':
      return { line: t('vf.meaning.expired'), sub: t('vf.sub.expired', week) };
    case 'recalled':
      return photo.length && !splitRecalled(outcome?.rules).rules.length
        ? { line: t('vf.meaning.photoWithdrawn'), sub: t('vf.sub.photoWithdrawn', { area: photo[0]!.area }) }
        : { line: t('vf.meaning.recalled'), sub: t('vf.sub.recalled') };
    case 'invalid':
      return { line: t('vf.meaning.invalid'), sub: /unknown/i.test(outcome?.reason ?? '') ? t('vf.sub.invalid.unknown') : t('vf.sub.invalid.altered') };
    default:
      return { line: t('vf.meaning.unreachable'), sub: /sample mode/i.test(outcome?.reason ?? '') ? t('vf.sub.forced') : t('vf.sub.unreachable') };
  }
}

/**
 * The verdict, full width: the stamp lands (authentic green, recalled vermilion, cannot-verify ink, expired turmeric),
 * then one line of meaning and the notes that qualify it. "Authentic" is said as what it is — issued by KrishiLoop and
 * unaltered — never as "correct". An unreachable server gets no stamp at all: it says nothing about the receipt.
 */
export function VerdictStage({
  kind,
  id,
  receipt,
  area,
  outcome,
  recorded,
  checkedAt,
  landKey,
  actions,
  onUseLive,
}: {
  kind: VerdictKind;
  id: string;
  receipt: Receipt | null;
  area: AreaTrustSubject | null;
  outcome: VerifyOutcome | null;
  recorded: boolean;
  checkedAt: Date;
  landKey: number;
  actions: ReactNode;
  onUseLive?: () => void;
}) {
  const { t, lang } = useI18n();
  const { line, sub } = useMeaning(kind, receipt, area, outcome);
  const split = splitRecalled(outcome?.rules);
  const plan = receipt?.plan;
  const mine = !!outcome?.sandbox && isMySandboxCredential(outcome.status_list);
  const forced = kind === 'unreachable' && /sample mode/i.test(outcome?.reason ?? '');

  return (
    <section className="vf-stage" data-kind={kind} data-testid="verdict" data-status={kind} aria-labelledby="vf-verdict-line">
      <div className="wrap vf-stage-grid">
        <div className="vf-stamp-slot" aria-hidden={kind === 'unreachable' ? true : undefined}>
          {kind === 'unreachable' ? (
            <span className="vf-offline">
              <WifiOff size={56} strokeWidth={1.4} aria-hidden />
            </span>
          ) : (
            <Stamp
              key={landKey}
              kind={STAMP[kind]}
              land
              size="xl"
              sub={`KrishiLoop · ${fmtDate(checkedAt, lang, 'short')}`}
              className="vf-stamp"
              style={{ fontSize: kind === 'invalid' ? 'var(--vf-stamp-long)' : 'var(--vf-stamp)' }}
            />
          )}
        </div>

        <div className="vf-stage-copy thud" key={`copy-${landKey}`}>
          <p className="eyebrow">
            {t(area ? 'vf.stage.eyebrowArea' : 'vf.stage.eyebrow', { id: shortId(id, 10), time: fmtDate(checkedAt, lang, 'time') })}
          </p>
          <h1 id="vf-verdict-line" className="vf-meaning" data-testid="verdict-line">
            {line}
          </h1>
          <p className="vf-sub">{sub}</p>

          {kind === 'recalled' && (split.rules.length > 0 || split.photoTrust.length > 0) && (
            <p className="mt-4 flex flex-wrap items-center gap-2" data-testid="withdrawn-rules">
              <span className="eyebrow">{t('vf.withdrawn')}</span>
              {split.rules.map((r) => (
                <span key={r} className="chip chip-stop mono normal-case tracking-normal">
                  {r}
                </span>
              ))}
              {split.photoTrust.map((p) => (
                <span key={p.entry} className="chip chip-stop normal-case tracking-normal" data-testid="photo-withdrawn-entry">
                  {p.entry}
                </span>
              ))}
            </p>
          )}

          <ul className="vf-notes">
            {recorded && (
              <li>
                <DataMark kind="recorded" date={RECORDED_AT} />
                <span>{t('vf.note.recorded', { date: fmtDate(RECORDED_AT, lang, 'long') })}</span>
              </li>
            )}
            {outcome?.sandbox && (
              <li data-testid="note-sandbox">
                <FlaskConical size={16} aria-hidden className="flex-none text-ink-3" />
                <span>
                  {t('vf.note.sandbox')}
                  {mine && (
                    <>
                      {' '}
                      <Link className="link" to="/officer?tab=recall">
                        {t('vf.note.mine')}
                      </Link>
                    </>
                  )}
                </span>
              </li>
            )}
            {kind === 'expired' && plan && (
              <li>
                <CalendarClock size={16} aria-hidden className="flex-none text-ink-3" />
                <span>{t('vf.note.expired', { from: fmtDate(plan.valid_from, lang), to: fmtDate(plan.valid_to, lang) })}</span>
              </li>
            )}
          </ul>

          {forced && onUseLive && (
            <Button variant="secondary" className="mt-5" onClick={onUseLive}>
              {t('vf.useLive')}
            </Button>
          )}
          <div className={cx('vf-actions no-print')}>{actions}</div>
        </div>
      </div>
    </section>
  );
}
