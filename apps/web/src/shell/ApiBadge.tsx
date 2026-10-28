import { useApiState } from '../lib/api/client';
import { RECORDED_AT } from '../data/recorded';
import { useI18n } from '../lib/i18n';
import { fmtDate } from '../lib/format';
import { cx } from '../lib/cx';

/** Live server or recorded data, said once in the header. Hover or a screen reader gets the full sentence. */
export function ApiBadge({ className }: { className?: string }) {
  const api = useApiState();
  const { t, lang } = useI18n();
  if (api.mode === 'unknown') return null;
  if (api.mode === 'live') {
    return (
      <span className={cx('chip chip-go', className)}>
        <span className="dot" aria-hidden />
        {t('ui.api.live')}
      </span>
    );
  }
  const note = t('ui.api.note', { date: fmtDate(RECORDED_AT, lang, 'long') });
  return (
    <span className={cx('chip chip-carbon', className)} title={note}>
      {t('ui.api.recorded')}
      <span className="sr-only-live">. {note}</span>
    </span>
  );
}
