import { useI18n } from '../lib/i18n';
import { fmtDate } from '../lib/format';
import { cx } from '../lib/cx';

export type MarkKind = 'live' | 'sample' | 'recorded' | 'simulation' | 'replay';

/**
 * Where a piece of data came from, said the same way everywhere (DESIGN.md rule 1): carbon-copy blue with a
 * dashed edge for anything that is not live. The long explanation is in `title` and in a hidden span for screen readers.
 */
export function DataMark({ kind, date, className }: { kind: MarkKind; date?: string; className?: string }) {
  const { t, lang } = useI18n();
  if (kind === 'live') {
    return (
      <span className={cx('chip chip-go', className)}>
        <span className="dot" aria-hidden />
        {t('ui.mark.live')}
      </span>
    );
  }
  const d = date ? fmtDate(date, lang, 'short') : '';
  const label = kind === 'recorded' ? t('ui.mark.recorded', { date: d }) : t(`ui.mark.${kind}`);
  const long = kind === 'recorded' ? t('ui.mark.recorded.title', { date: d }) : t(`ui.mark.${kind}.title`);
  return (
    <span className={cx('chip chip-carbon', className)} title={long}>
      {label}
      <span className="sr-only-live">. {long}</span>
    </span>
  );
}
