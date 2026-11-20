import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarCheck, Check, ReceiptText, RefreshCw, ScanLine } from 'lucide-react';
import { setLang, useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { SCENARIOS } from '../../lib/api/mocks';
import { Wordmark } from '../../ui/kit/LoopMark';
import { init, select, useFarmer } from '../farmer/farmerStore';
import { cropName, countryName, profileSummary, stageName } from '../farmer/words';

const STEPS = 3;

/**
 * The first time the app opens: three short screens, one decision each.
 *  1. Your language (Bangla or English), as big as a thumb.
 *  2. A farm to try, said plainly to be a sample farm (the five recorded field and farmer pairs).
 *  3. What the app does, in three short lines. Then Start.
 * Everything can be changed later in Help, and Help can show these screens again.
 */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { t, lang } = useI18n();
  const st = useFarmer();
  const [step, setStep] = useState(0);
  const head = useRef<HTMLHeadingElement>(null);

  // each new screen is announced: focus moves to its title
  useEffect(() => {
    head.current?.focus({ preventScroll: true });
  }, [step]);

  const farms = SCENARIOS.map((s) => {
    const f = st.fields.find((x) => x.field_id === s.field);
    const p = st.profiles.find((x) => x.farmer_profile_id === s.profile);
    return f && p ? { id: s.id, f, p } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <div className="m-ob" data-testid="m-welcome" data-step={step + 1}>
      <div className="m-ob-top mesh">
        <Wordmark />
        <ol className="m-ob-dots" aria-label={t('m.ob.step', { n: fmtNum(step + 1, lang), of: fmtNum(STEPS, lang) })}>
          {Array.from({ length: STEPS }, (_, i) => (
            <li key={i} data-on={i <= step || undefined} aria-current={i === step ? 'step' : undefined} />
          ))}
        </ol>
      </div>

      <main className="m-ob-body" key={step}>
        {/* the deck's rice line art, low in the corners behind the choices (decorative) */}
        <div className="botanic-art botanic-bg--rice" aria-hidden />
        <p className="m-ob-step">{t('m.ob.step', { n: fmtNum(step + 1, lang), of: fmtNum(STEPS, lang) })}</p>

        {step === 0 && (
          <section className="grid gap-5" aria-labelledby="m-ob-h">
            <div>
              <h1 id="m-ob-h" ref={head} tabIndex={-1} className="m-ob-title">
                {t('m.ob.langTitle')}
              </h1>
              <p className="m-ob-sub">{t('m.ob.langSub')}</p>
            </div>
            <div className="grid gap-3" role="group" aria-labelledby="m-ob-h">
              {(['bn', 'en'] as const).map((l) => (
                <button key={l} type="button" lang={l} className="m-ob-lang" aria-pressed={lang === l} onClick={() => void setLang(l)} data-testid={`m-ob-lang-${l}`}>
                  <span className="m-ob-lang-word">{l === 'bn' ? 'বাংলা' : 'English'}</span>
                  <span className="m-ob-lang-small">{l === 'bn' ? 'Bangla' : 'ইংরেজি'}</span>
                  {lang === l && <Check size={22} aria-hidden className="m-ob-tick" />}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="grid gap-5" aria-labelledby="m-ob-h">
            <div>
              <h1 id="m-ob-h" ref={head} tabIndex={-1} className="m-ob-title">
                {t('m.ob.farmTitle')}
              </h1>
              <p className="m-ob-sub">{t('m.ob.farmSub')}</p>
            </div>
            {st.boot === 'error' ? (
              <div className="panel grid gap-3 p-4" role="alert">
                <p className="m-0">{t('m.ob.failed')}</p>
                <button type="button" className="btn btn-secondary justify-self-start" onClick={() => void init()}>
                  <RefreshCw size={17} aria-hidden />
                  {t('ui.retry')}
                </button>
              </div>
            ) : farms.length === 0 ? (
              <div className="grid gap-3" aria-busy="true">
                <p className="sr-only-live" role="status">
                  {t('m.ob.loading')}
                </p>
                <div className="skeleton h-20" />
                <div className="skeleton h-20" />
                <div className="skeleton h-20" />
              </div>
            ) : (
              <fieldset className="m-0 grid gap-2.5 border-0 p-0">
                <legend className="m-ob-badge mb-1">{t('m.head.sample')}</legend>
                {farms.map(({ id, f, p }) => {
                  const on = st.fieldId === f.field_id && st.profileId === p.farmer_profile_id;
                  return (
                    <label key={id} className={cx('m-ob-farm', on && 'is-on')} data-testid={`m-ob-farm-${id}`}>
                      <input type="radio" name="m-ob-farm" checked={on} onChange={() => void select(f.field_id, p.farmer_profile_id)} />
                      <span className="min-w-0 flex-1">
                        <span className="m-ob-farm-name">{t('m.ob.farmName', { crop: cropName(f.crop, t), country: countryName(f.country, lang) })}</span>
                        <span className="m-ob-farm-line">
                          {stageName(f.stage, t)} · {profileSummary(p, t).line}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="grid gap-5" aria-labelledby="m-ob-h">
            <h1 id="m-ob-h" ref={head} tabIndex={-1} className="m-ob-title">
              {t('m.ob.whatTitle')}
            </h1>
            <ul className="m-ob-what">
              <li>
                <span className="m-ob-what-icon" data-tone="terracotta" aria-hidden>
                  <CalendarCheck size={24} />
                </span>
                {t('m.ob.what1')}
              </li>
              <li>
                <span className="m-ob-what-icon" data-tone="moss" aria-hidden>
                  <ScanLine size={24} />
                </span>
                {t('m.ob.what2')}
              </li>
              <li>
                <span className="m-ob-what-icon" data-tone="lotus" aria-hidden>
                  <ReceiptText size={24} />
                </span>
                {t('m.ob.what3')}
              </li>
            </ul>
          </section>
        )}
      </main>

      <div className="m-ob-foot">
        {step > 0 ? (
          <button type="button" className="btn btn-ghost m-ob-back" onClick={() => setStep((s) => s - 1)} data-testid="m-ob-back">
            <ArrowLeft size={18} aria-hidden />
            {t('m.ob.back')}
          </button>
        ) : (
          <span />
        )}
        {step < STEPS - 1 ? (
          <button type="button" className="btn btn-primary btn-lg m-ob-next" onClick={() => setStep((s) => s + 1)} disabled={step === 1 && !st.profileId} data-testid="m-ob-next">
            {t('m.ob.next')}
            <ArrowRight size={18} aria-hidden />
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-lg m-ob-next" onClick={onDone} data-testid="m-ob-start">
            {t('m.ob.start')}
            <ArrowRight size={18} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
