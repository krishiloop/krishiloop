import { useCallback, useId } from 'react';
import { AnimatedNumber } from '../../../components/ui/AnimatedNumber';
import type { Severity } from './report';
import { useI18n } from '../../../lib/i18n';
import { fmtNum } from '../../../lib/format';

/**
 * Severity: how much of the leaf is affected (lesion area / tissue area). Manuals state their thresholds in this unit,
 * so it is the number the rules can use. Neutral gold, not green/amber/red: colour is kept for decisions, and this is a
 * measurement. The pale band is the estimate's range.
 */
export function SeverityMeter({ severity }: { severity: Severity }) {
  const { t, lang } = useI18n();
  const id = useId();
  const { pct, lo, hi } = severity;
  const fmt = useCallback((n: number) => `${fmtNum(Math.round(n), lang)}%`, [lang]);
  const range = lo != null && hi != null ? `${fmtNum(lo, lang)}–${fmtNum(hi, lang)}%` : null;
  const text = t('photo.severity.value', { pct: fmtNum(pct, lang) }) + (range ? `, ${t('photo.severity.range', { range })}` : '');
  return (
    <section className="sev" aria-labelledby={id} data-testid="photo-severity">
      <div className="sev-head">
        <h3 id={id} className="eyebrow !text-chrome m-0">
          {t('photo.severity')}
        </h3>
        <p className="sev-val">
          <strong className="tabular">
            <AnimatedNumber value={pct} format={fmt} />
          </strong>{' '}
          <span>{t('photo.severity.of')}</span>
        </p>
      </div>
      <div className="sev-track" role="meter" aria-labelledby={id} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={text}>
        {lo != null && hi != null ? <span className="sev-range" style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%` }} /> : null}
        <span className="sev-fill" style={{ ['--p' as string]: Math.min(1, Math.max(0, pct / 100)) }} />
      </div>
      <div className="sev-scale tabular" aria-hidden>
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100%</span>
      </div>
      {range ? <p className="sev-note">{t('photo.severity.range', { range })}</p> : null}
    </section>
  );
}
