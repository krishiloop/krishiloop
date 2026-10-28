import { useRef } from 'react';
import { PiggyBank } from 'lucide-react';
import { SampleBadge } from '../../components/ui/Badges';
import { useI18n } from '../../lib/i18n';
import { currencySymbol, fmtNum } from '../../lib/format';
import { useCountUp, useInViewOnce } from '../../lib/hooks';
import type { MoneyImpact } from '../../lib/api/types';

/**
 * Money counter. Rendered ONLY when the plan carries `money_impact` (the planner has to cite prices to produce it).
 * `sample: true` shows the dashed SAMPLE label; the numbers are never presented as real in that case.
 */
export function MoneySaved({ impact }: { impact: MoneyImpact }) {
  const { t, lang } = useI18n();
  const box = useRef<HTMLElement>(null);
  const seen = useInViewOnce(box);
  const sym = currencySymbol(impact.currency, lang);
  const minRef = useCountUp(impact.amount_min, seen, (n) => fmtNum(Math.round(n), lang));
  const maxRef = useCountUp(impact.amount_max, seen, (n) => fmtNum(Math.round(n), lang));
  const range = impact.amount_min !== impact.amount_max;
  return (
    <section ref={box} className="money surface surface-pad" aria-labelledby="money-t" data-direction={impact.direction} data-testid="money-slot">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="money-t" className="eyebrow !text-chrome flex items-center gap-2">
          <PiggyBank size={15} aria-hidden /> {impact.direction === 'saves' ? t('money.saves') : t('money.costs')}
        </h2>
        {impact.sample ? <SampleBadge /> : null}
      </div>
      <p className="money-figure display" aria-label={`${sym} ${fmtNum(impact.amount_min, lang)}${range ? ` – ${fmtNum(impact.amount_max, lang)}` : ''}`}>
        <span className="money-sym">{sym}</span>
        <span ref={minRef} className="tabular" aria-hidden>
          0
        </span>
        {range ? (
          <>
            <span className="money-dash" aria-hidden>
              –
            </span>
            <span ref={maxRef} className="tabular" aria-hidden>
              0
            </span>
          </>
        ) : null}
      </p>
      <p className="m-0 mt-2 text-sm text-chrome">
        <span className="font-semibold text-bone">{t('money.basis')}: </span>
        {impact.basis}
      </p>
      <p className="m-0 mt-3 flex flex-wrap items-center gap-2 text-xs text-dim">
        {t('money.sources')}:
        {impact.price_source_ids.map((id) => (
          <span key={id} className="chip chip-mono">
            {id}
          </span>
        ))}
      </p>
      {impact.sample ? <p className="m-0 mt-2 text-xs text-dim">{t('money.sampleNote')}</p> : null}
    </section>
  );
}
