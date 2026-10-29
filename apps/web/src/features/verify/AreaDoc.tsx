import type { AreaTrustSubject, Credential } from '../../lib/api/types';
import type { VerifyOutcome } from '../../lib/api/client';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { LogoMark } from '../../ui/Logo';
import { POLICY_V1 } from '../trust/policy';
import { DocSection, Signature, Timeline } from './ReceiptDoc';
import type { VerdictKind } from './VerdictStage';
import type { LocalCheckState } from './localCheck';

/** A 0..1 track with the bar marked: the lower bound fills it, the bar is a tick with its number. Transform only. */
export function BoundMeter({ value, bar, className, label }: { value: number; bar: number; className?: string; label: string }) {
  const v = Math.min(1, Math.max(0, value));
  return (
    <div className={cx('vf-meter', className)} role="img" aria-label={label}>
      <span className="vf-meter-track">
        <span className="vf-meter-fill" data-over={v >= bar || undefined} style={{ transform: `scaleX(${v})` }} />
      </span>
      <span className="vf-meter-bar" style={{ left: `${bar * 100}%` }} />
    </div>
  );
}

/**
 * An AreaTrustCredential: what an area earned, signed when its gate opened. Rendered as its own document (a certificate),
 * then the signature and the timeline. The numbers are the signed ones, as they stood when the gate opened.
 */
export function AreaDoc({ cred, area, kind, outcome, checkedAt, local }: { cred: Credential; area: AreaTrustSubject; kind: VerdictKind; outcome: VerifyOutcome | null; checkedAt: Date; local?: LocalCheckState | null }) {
  const { t, lang } = useI18n();
  const n2 = (x: number | null) => (x == null ? '—' : fmtNum(x, lang, { minimumFractionDigits: 2, maximumFractionDigits: 3 }));
  const bar = POLICY_V1.openLb;
  return (
    <div className="wrap vf-doc" data-testid="area-doc">
      <div className="vf-doc-card">
        <article className="paper-object">
          <div className="paper serrated-b px-5 pb-7 pt-5 sm:px-6" data-status={kind} data-testid="area-ticket">
            <header className="eyebrow flex items-center gap-2 text-ink-2">
              <LogoMark size={15} />
              KrishiLoop · {t('vf.area.header')}
            </header>
            <p className="mono mt-6 text-[clamp(1.8rem,1.4rem+1.5vw,2.4rem)] font-semibold leading-none text-ink" data-testid="area-ticket-area">
              {area.area}
            </p>
            <p className="mono mt-2 text-sm text-ink-3">{area.model}</p>
            <dl className="vf-dl mt-6" data-testid="area-details">
              <dt>{t('vf.area.verdicts')}</dt>
              <dd className="mono">{fmtNum(area.verdicts, lang)}</dd>
              <dt>{t('vf.area.sure')}</dt>
              <dd className="mono">{t('vf.area.sureVal', { right: fmtNum(area.sure_right_in_window, lang), n: fmtNum(area.sure_in_window, lang) })}</dd>
              <dt>{t('vf.area.precision')}</dt>
              <dd className="mono">{n2(area.precision)}</dd>
              <dt>{t('vf.area.bound')}</dt>
              <dd className="mono" data-testid="area-d-bound">
                {t('vf.area.boundVs', { lb: n2(area.lower_bound), bar: n2(bar) })}
              </dd>
              <dt>{t('vf.area.opened')}</dt>
              <dd className="mono">{fmtDate(area.opened_at, lang, 'datetime')}</dd>
              <dt>{t('vf.area.policy')}</dt>
              <dd className="mono">
                {area.policy_id ?? 'photo-trust'} v{area.policy_version}
              </dd>
            </dl>
            <BoundMeter className="mt-6" value={area.lower_bound} bar={bar} label={t('vf.area.boundVs', { lb: n2(area.lower_bound), bar: n2(bar) })} />
          </div>
        </article>
      </div>
      <div className="vf-doc-body">
        <DocSection n="01" title={t('vf.sig.title')} testId="doc-signature">
          <Signature cred={cred} statusList={outcome?.status_list} recorded={false} local={local} />
        </DocSection>
        <DocSection n="02" title={t('vf.tl.title')} testId="doc-timeline">
          <Timeline cred={cred} receipt={null} kind={kind} outcome={outcome} recorded={false} checkedAt={checkedAt} />
        </DocSection>
      </div>
    </div>
  );
}
