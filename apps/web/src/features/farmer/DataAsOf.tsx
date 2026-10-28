import { Database } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate } from '../../lib/format';
import type { DataMode } from '../../lib/api/types';

const MODE_KEY: Record<DataMode, Key> = {
  live: 'data.mode.live',
  snapshot: 'data.mode.snapshot',
  sample: 'data.mode.sample',
  unavailable: 'data.mode.unavailable',
};

/**
 * "Weather data as of {when} ({mode})": when the weather behind a plan or a receipt was saved, and whether it was fetched
 * live, taken from a saved snapshot, or is sample data. Both values come from the plan / signed receipt as they are.
 */
export function DataAsOf({ asOf, mode, className }: { asOf?: string; mode?: DataMode; className?: string }) {
  const { t, lang } = useI18n();
  if (!asOf) return null;
  return (
    <span className={className ?? 'data-asof'} data-testid="data-as-of">
      <Database size={13} aria-hidden />
      {t('data.asOf', { when: fmtDate(asOf, lang, 'datetime'), mode: mode ? t(MODE_KEY[mode]) : t('common.na') })}
    </span>
  );
}
