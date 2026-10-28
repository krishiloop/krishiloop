import { Database, RefreshCw, RotateCcw } from 'lucide-react';
import { Sheet } from '../../components/ui/Sheet';
import { useI18n, type Key } from '../../lib/i18n';
import { forgetSession, useApiState } from '../../lib/api/client';
import { resetSampleRecalls, SCENARIOS, type Scenario } from '../../lib/api/mocks';
import { applyScenario, chooseSource, loadPlan, useFarmer } from './farmerStore';
import { toast } from '../../components/ui/Toaster';
import { cx } from '../../lib/cx';

/** Demo controls for judges and developers: choose live vs sample data, pick a sample scenario, reset the demo. */
export function DemoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const api = useApiState();
  const st = useFarmer();
  const live = !api.forced;
  const options: Scenario[] = ['live', ...SCENARIOS.map((s) => s.id)];

  const reset = () => {
    resetSampleRecalls();
    forgetSession(); // a new demo sandbox on the next call: new receipts, an empty recall list, an empty inbox
    void loadPlan({ force: true });
    toast(t('demo.reset'));
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('demo.title')}>
      <p className="m-0 mb-5 text-sm text-chrome">{t('demo.lead')}</p>

      <h3 className="eyebrow !text-chrome mb-2 flex items-center gap-2">
        <Database size={13} aria-hidden /> {t('demo.source')}
      </h3>
      <div className="seg mb-5" role="group" aria-label={t('demo.source')}>
        <button type="button" aria-pressed={live} onClick={() => void chooseSource('live')}>
          {t('demo.liveApi')}
        </button>
        <button type="button" aria-pressed={!live} onClick={() => void chooseSource('sample')}>
          {t('demo.sampleData')}
        </button>
      </div>

      <h3 className="eyebrow !text-chrome mb-2">{t('demo.scenario')}</h3>
      <div role="radiogroup" aria-label={t('demo.scenario')} className="grid gap-1.5">
        {options.map((id) => {
          const active = id === 'live' ? live : !live && st.scenario === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={active} className={cx('radio-row', active && 'is-active')} onClick={() => void applyScenario(id)}>
              <span className="radio-dot" aria-hidden />
              <span>{t(`demo.s.${id}` as Key)}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void loadPlan({ force: true })}>
          <RefreshCw size={15} aria-hidden /> {t('app.refresh')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
          <RotateCcw size={15} aria-hidden /> {t('demo.reset')}
        </button>
      </div>
      <p className="m-0 mt-4 text-xs text-dim">{t('demo.recallHint')}</p>
    </Sheet>
  );
}
