import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronDown, FlaskConical, WifiOff } from 'lucide-react';
import type { AreaTrustSubject, Receipt } from '../../lib/api/types';
import type { VerifyOutcome } from '../../lib/api/client';
import { currentSessionId, isMySandboxCredential } from '../../lib/api/client';
import { RECORDED_AT } from '../../data/recorded';
import { useI18n } from '../../lib/i18n';
import { fmtDate, shortId } from '../../lib/format';
import { verifyUrl } from '../../lib/qr';
import { cx } from '../../lib/cx';
import { Stamp, type StampKind } from '../../ui/Stamp';
import { DataMark } from '../../ui/DataMark';
import { Button } from '../../ui/Button';
import { Qr } from '../../ui/Qr';
import { BorderBeam } from '../../ui/kit/BorderBeam';
import { HyperText } from '../../ui/kit/HyperText';
import { splitRecalled } from '../trust/gate';
import { recallOf } from '../officer/recallLog';
import { RunLedger, type RunStep } from './CheckRun';
import { FarmerCameo } from '../../ui/farmer/FarmerCameo';

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
    case 'recalled': {
      if (photo.length && !splitRecalled(outcome?.rules).rules.length) return { line: t('vf.meaning.photoWithdrawn'), sub: t('vf.sub.photoWithdrawn', { area: photo[0]!.area }) };
      // when this browser made the recall (the officer desk), the day it was taken back is known
      const sample = outcome?.source === 'sample';
      const at = splitRecalled(outcome?.rules).rules.map((r) => recallOf(r, sample ? 'sample' : 'sandbox', currentSessionId())).find(Boolean)?.at;
      return { line: at ? t('vf.meaning.recalledOn', { date: fmtDate(at, lang, 'long') }) : t('vf.meaning.recalled'), sub: t('vf.sub.recalled') };
    }
    case 'invalid':
      return { line: t('vf.meaning.invalid'), sub: /unknown/i.test(outcome?.reason ?? '') ? t('vf.sub.invalid.unknown') : t('vf.sub.invalid.altered') };
    default:
      return { line: t('vf.meaning.unreachable'), sub: /sample mode/i.test(outcome?.reason ?? '') ? t('vf.sub.forced') : t('vf.sub.unreachable') };
  }
}

/**
 * The check and its verdict on one stage. On the left, the receipt being checked (its own QR and id): a light runs
 * round it while the check runs, then the verdict lands on it as a stamp: Authentic (go), Recalled (ember, with the
 * reason), Expired (wait), Cannot verify (grey, dashed). An unreachable server gets no stamp: it says nothing about
 * the receipt. On the right, the steps as they really run, then the meaning in one line and what qualifies it.
 * "Authentic" is said as what it is (issued by KrishiLoop and unaltered), never as "correct".
 */
export function VerdictStage({
  phase,
  steps,
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
  phase: 'checking' | 'done';
  steps: RunStep[];
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
  const checking = phase === 'checking';
  const { line, sub } = useMeaning(kind, receipt, area, outcome);
  const split = splitRecalled(outcome?.rules);
  const plan = receipt?.plan;
  const mine = !!outcome?.sandbox && isMySandboxCredential(outcome.status_list);
  const forced = kind === 'unreachable' && /sample mode/i.test(outcome?.reason ?? '');
  const known = kind === 'recalled' ? (split.rules.map((r) => recallOf(r, recorded ? 'sample' : 'sandbox', currentSessionId())).find(Boolean) ?? null) : null;
  const stageKind = checking ? 'checking' : kind;

  return (
    <section
      className="vf-stage vf-v5"
      data-kind={stageKind}
      data-testid={checking ? 'checking' : 'verdict'}
      data-status={checking ? undefined : kind}
      aria-busy={checking || undefined}
      aria-labelledby="vf-verdict-line"
    >
      <div className="wrap vf-v5-grid">
        <div className="vf-v5-mark">
          {checking ? (
            <div className="vf-check" data-state={stageKind}>
              <BorderBeam size={150} duration={2.2} radius={26} />
              <div className="vf-check-qr paper-object">
                <Qr value={verifyUrl(id)} size={132} label={t('vf.checking.qr')} />
              </div>
              <p className="vf-check-id">
                <span className="label">№</span>
                <HyperText text={`…${shortId(id, 12)}`} duration={760} />
              </p>
            </div>
          ) : kind !== 'unreachable' ? (
            <span className="vf-bigstamp" key={`s-${landKey}`}>
              {(kind === 'authentic' || kind === 'recalled') && <span className="vf-ring" data-kind={kind} aria-hidden />}
              <Stamp kind={STAMP[kind]} land size="inherit" sub={`KrishiLoop · ${fmtDate(checkedAt, lang, 'short')}`} className="vf-stamp" />
            </span>
          ) : (
            <span className="vf-bigstamp vf-offline" aria-hidden>
              <WifiOff size={56} strokeWidth={1.4} />
            </span>
          )}
        </div>

        <div className="vf-stage-copy">
          {checking ? (
            <>
              <p className="eyebrow">№ …{shortId(id, 10)}</p>
              <h1 id="vf-verdict-line" className="vf-meaning">
                {t('vf.checking.title')}
              </h1>
              <div className="vf-run-wrap">
                <p className="label">{t('vf.run.live')}</p>
                <RunLedger steps={steps} />
              </div>
            </>
          ) : (
            <div className="thud" key={`copy-${landKey}`}>
              {/* the leaf farmer reads the verdict with you: glad when it holds, worried when it was taken back */}
              <FarmerCameo mood={kind === 'authentic' ? 'happy' : kind === 'recalled' ? 'worried' : kind === 'unreachable' ? 'thinking' : 'surprised'} />
              <p className="eyebrow">{t(area ? 'vf.stage.eyebrowArea' : 'vf.stage.eyebrow', { id: shortId(id, 10), time: fmtDate(checkedAt, lang, 'time') })}</p>
              <h1 id="vf-verdict-line" className="vf-meaning" data-testid="verdict-line">
                {line}
              </h1>
              <p className="vf-sub">{sub}</p>

              {kind === 'recalled' && (split.rules.length > 0 || split.photoTrust.length > 0) && (
                <div className="vf-why" data-testid="withdrawn-rules">
                  <p className="m-0 flex flex-wrap items-center gap-2">
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
                  {known ? (
                    <p className="m-0 mt-2 text-sm text-ink-2">{t('vf.tl.reason', { reason: known.reason })}</p>
                  ) : outcome?.reason ? (
                    <p className="mono m-0 mt-2 text-xs text-ink-3">{outcome.reason}</p>
                  ) : null}
                </div>
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
          )}
        </div>
      </div>

      {!checking && (
        <div className="wrap">
          {/* what was checked, step by step, for anyone who wants it: folded so the verdict reads first */}
          <details className="vf-details" data-testid="vf-details">
            <summary>
              <ChevronDown size={18} aria-hidden className="vf-details-chev" />
              <span>{t('vf.details.show')}</span>
              <span className="vf-details-sub">{t('vf.details.sub')}</span>
            </summary>
            <div className="vf-details-body">
              <div className="vf-check" data-state={stageKind}>
                <div className="vf-check-qr paper-object">
                  <Qr value={verifyUrl(id)} size={120} label={t('vf.checking.qr')} />
                </div>
                <p className="vf-check-id">
                  <span className="label">№</span>
                  <span className="mono">…{shortId(id, 12)}</span>
                </p>
              </div>
              <div className="vf-run-wrap is-done">
                <p className="label">{t('vf.run.title')}</p>
                <RunLedger steps={steps} compact />
              </div>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
