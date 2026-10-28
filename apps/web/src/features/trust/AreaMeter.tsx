import { Lock, LockOpen } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Chip } from '../../ui/Chip';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import type { AreaStats } from '../../lib/api/types';
import { meterView } from './gate';
import { POLICY_V1, type Policy } from './policy';
import './meter.css';

/**
 * One area's evidence as an instrument: how many sure answers the officers have judged, and a bar for the cautious lower
 * bound with the line the gate waits for. The same component serves the farmer card (compact), the officer's detail and
 * the trust page, so a number never reads differently on two screens.
 *
 * Honest by construction: until 30 sure answers are counted the bound is drawn hatched and labelled "not counted yet",
 * because a high bound on a handful of answers cannot open the gate. The fill slides (transform only) when the numbers
 * change, so an officer sees their answer move it.
 */
export function AreaMeter({ area, stats, compact = false, policy = POLICY_V1, className }: { area: string; stats: AreaStats | null; compact?: boolean; policy?: Policy; className?: string }) {
  const { t, lang } = useI18n();
  const m = meterView(stats, policy);
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const bar = two(m.bar);
  const caption = m.phase === 'open' ? t('trust.meter.open', { close: two(m.closeBar) }) : m.phase === 'building' ? t('trust.meter.building', { lb: two(m.lowerBound), bar }) : t('trust.meter.collecting', { n: fmtNum(m.remaining, lang) });
  const valueText = t('trust.meter.valueText', { lb: two(m.lowerBound), bar, n: fmtNum(m.sure, lang), need: fmtNum(m.need, lang) });

  if (!stats) {
    return (
      <div className={cx('am', className)} data-compact={compact} aria-busy="true" data-testid="area-meter-loading">
        <div className="skeleton h-6 w-1/2" />
        <div className="skeleton h-3.5 w-full" />
      </div>
    );
  }

  return (
    <section className={cx('am', className)} data-phase={m.phase} data-compact={compact} data-testid="area-meter" aria-label={`${t('trust.title')}: ${area}`}>
      <div className="am-head">
        <span className="mono text-[0.8rem] text-ink-2" data-testid="am-area">
          {area}
        </span>
        <Chip tone={m.gateOpen ? 'go' : 'neutral'} data-open={m.gateOpen} data-testid="am-gate">
          {m.gateOpen ? <LockOpen size={12} aria-hidden /> : <Lock size={12} aria-hidden />}
          {m.gateOpen ? t('trust.meter.gate.open') : t('trust.meter.gate.closed')}
        </Chip>
      </div>

      <div className="am-wrap">
        <div className="am-track" role="meter" aria-label={t('trust.meter.bound')} aria-valuemin={0} aria-valuemax={1} aria-valuenow={m.lowerBound} aria-valuetext={valueText} data-counted={m.counted} data-reached={m.reachedBar} data-testid="am-bar">
          <span className="am-fill" style={{ ['--p' as string]: m.lowerBound } as CSSProperties} />
        </div>
        <span className="am-tick" data-kind="open" style={{ ['--x' as string]: m.bar } as CSSProperties} aria-hidden>
          <i>{bar}</i>
        </span>
        {m.gateOpen ? <span className="am-tick" data-kind="close" style={{ ['--x' as string]: m.closeBar } as CSSProperties} aria-hidden /> : null}
      </div>
      <p className="am-caption" data-testid="am-caption">
        {caption}
      </p>

      <dl className="am-stats">
        <div>
          <dt>{t('trust.meter.verdicts')}</dt>
          <dd data-testid="am-verdicts">{fmtNum(m.verdicts, lang)}</dd>
        </div>
        <div>
          <dt>{t('trust.meter.sure')}</dt>
          <dd data-testid="am-sure">{t('trust.meter.sureOf', { n: fmtNum(m.sure, lang), need: fmtNum(m.need, lang) })}</dd>
        </div>
        <div>
          <dt>{t('trust.meter.bound')}</dt>
          <dd data-testid="am-bound">
            {two(m.lowerBound)}
            <small>{t('trust.meter.bar', { bar })}</small>
            {!m.counted ? <span className="am-flag">{t('trust.meter.provisional')}</span> : null}
          </dd>
        </div>
      </dl>
    </section>
  );
}
