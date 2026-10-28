import type { DataMode } from '../lib/api/types';
import { useI18n } from '../lib/i18n';
import { fmtDate } from '../lib/format';
import { cx } from '../lib/cx';
import { Chip } from './Chip';

const MODE_TONE = { live: 'go', snapshot: 'neutral', sample: 'carbon', unavailable: 'stop' } as const;

/** Where the data behind a plan came from and when: "Live · Data as of 28 Oct, 23:27". */
export function DataAsOf({ mode, asOf, source, className }: { mode?: DataMode; asOf?: string | null; source?: string; className?: string }) {
  const { t, lang } = useI18n();
  return (
    <p className={cx('flex flex-wrap items-center gap-2 text-xs text-ink-3', className)}>
      {mode && <Chip tone={MODE_TONE[mode]}>{t(`ui.mode.${mode}`)}</Chip>}
      {asOf && <span className="mono">{t('ui.asOf', { time: fmtDate(asOf, lang, 'datetime') })}</span>}
      {source && <span className="mono">· {source}</span>}
    </p>
  );
}
