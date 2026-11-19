import { useI18n } from '../../lib/i18n';
import { Calculator } from '../farmer/calc/Calculator';
import '../farmer/climate/climate.css'; // the calculator's form classes (kg-input, kg-label) live there

/** "How much can I save?": the farmer app's own savings calculator (builder R), reused unchanged. */
export function SavingsTool() {
  const { t } = useI18n();
  return (
    <div className="try-savings" data-testid="savings">
      <p className="mb-4 text-sm text-ink-2">{t('try.sv.note')}</p>
      <Calculator fieldId={null} />
    </div>
  );
}
