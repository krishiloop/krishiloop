import { setLang, useI18n } from '../../lib/i18n';
import { fmtDate } from '../../lib/format';
import { useApiState } from '../../lib/api/client';
import { LoopMark } from '../../ui/kit/LoopMark';
import { DataMark } from '../../ui/DataMark';
import { RECORDED_AT } from '../../data/recorded';
import { currentField, useFarmer } from '../farmer/farmerStore';
import { cropName, countryName, stageName } from '../farmer/words';

/**
 * The app bar, under the notch: the site's pastel mesh over the page colour (cream, or forest in the dark theme) with the
 * site's loop mark. The farm (crop, growth stage, country) marked "Sample farm",
 * this week's dates, where the answers come from (Recorded, when the server is not connected), and a one-tap
 * language switch (English · বাংলা), 48 px tall.
 */
export function MHeader() {
  const { t, lang } = useI18n();
  const st = useFarmer();
  const api = useApiState();
  const field = currentField(st);
  const plan = st.plan;
  const recorded = st.planSource === 'sample' || api.forced || api.mode === 'sample';

  return (
    <header className="m-head mesh" data-testid="m-head">
      <div className="m-head-row">
        <span className="m-logo" aria-hidden>
          <LoopMark size={26} />
        </span>
        <div className="min-w-0 flex-1" aria-live="polite">
          {field ? (
            <>
              <p className="m-farm" data-testid="m-farm">
                {cropName(field.crop, t)} <span className="text-ink-3">·</span> {stageName(field.stage, t)}
              </p>
              <p className="m-farm-sub truncate">
                {countryName(field.country, lang)} · <span className="m-sample">{t('m.head.sample')}</span>
              </p>
            </>
          ) : (
            <p className="m-farm-sub">{t('m.head.loading')}</p>
          )}
        </div>
        <div role="group" aria-label={t('ui.lang.label')} className="m-lang">
          {(['bn', 'en'] as const).map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => void setLang(l)} data-testid={`m-lang-${l}`}>
              {l === 'en' ? 'EN' : 'বাংলা'}
            </button>
          ))}
        </div>
      </div>
      {(plan || recorded) && (
        <div className="m-head-meta">
          {plan && <span data-testid="m-week">{t('m.head.week', { from: fmtDate(plan.valid_from, lang), to: fmtDate(plan.valid_to, lang) })}</span>}
          {recorded && <DataMark kind="recorded" date={RECORDED_AT} />}
        </div>
      )}
    </header>
  );
}
