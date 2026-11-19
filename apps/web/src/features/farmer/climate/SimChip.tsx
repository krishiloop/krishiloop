import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/cx';

/**
 * "Simulated" on the thing it labels. Not DataMark's "simulation" (that one says the simulation runs in the browser to
 * explain an idea): these simulations are made by our server code (services/engine/climate.py, radar.py), seeded.
 */
export function SimChip({ className }: { className?: string }) {
  const { t } = useI18n();
  return <span className={cx('chip chip-carbon', className)}>{t('fa.climate.simChip')}</span>;
}
