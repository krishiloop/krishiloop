import { FlaskConical } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/cx';

/** "SAMPLE" label for anything that is not live data. Dashed, small caps, hard to miss. */
export function SampleBadge({ className, label }: { className?: string; label?: string }) {
  const { t } = useI18n();
  return (
    <span className={cx('chip chip-sample', className)} title={t('data.sampleTip')}>
      <FlaskConical size={11} aria-hidden />
      {label ?? t('common.sample')}
    </span>
  );
}

/** "preview" label for planned or machine-translated things. */
export function PreviewBadge({ className, label }: { className?: string; label?: string }) {
  const { t } = useI18n();
  return <span className={cx('chip chip-sample', className)}>{label ?? t('common.preview')}</span>;
}
