import { Link } from 'react-router-dom';
import { BookOpen, Download } from 'lucide-react';
import { setLang, useI18n } from '../../lib/i18n';
import { fmtDate } from '../../lib/format';
import { LogoMark } from '../../ui/Logo';
import { LangSwitch } from '../../ui/SiteControls';
import { DataMark } from '../../ui/DataMark';
import { RECORDED_AT } from '../../data/recorded';
import { useApiState } from '../../lib/api/client';
import { currentField, useFarmer } from './farmerStore';
import { cropName, countryName, stageName } from './words';
import { promptInstall, useInstall } from './install';

/**
 * The app's own header (on phones it replaces the site bar): home, the field (crop, stage, place), this week, where the
 * data came from, a one-tap language switch (English · Bangla; Hindi and Swahili previews in the menu), and the Guide.
 */
export function AppHeader({ onGuide }: { onGuide: () => void }) {
  const { t, lang } = useI18n();
  const st = useFarmer();
  const api = useApiState();
  const install = useInstall();
  const field = currentField(st);
  const recorded = st.planSource === 'sample' || api.forced || api.mode === 'sample';
  const plan = st.plan;

  return (
    <header className="fa-head">
      <div className="flex items-center gap-2">
        <Link to="/" aria-label={t('ui.nav.home')} className="fa-hit -ml-1 grid place-items-center rounded-[10px] text-ink">
          <LogoMark size={24} />
        </Link>
        <div className="min-w-0 flex-1" aria-live="polite">
          {field ? (
            <>
              <p className="truncate text-[1.02rem] font-semibold leading-tight" data-testid="fa-field">
                {cropName(field.crop, t)} <span className="text-ink-3">·</span> {stageName(field.stage, t)}
              </p>
              <p className="truncate text-[0.8rem] leading-snug text-ink-3">
                {countryName(field.country, lang)} · {t('fa.head.sample')}
              </p>
            </>
          ) : (
            <span className="skeleton block h-9 w-40" aria-hidden />
          )}
        </div>
        <button type="button" className="btn btn-secondary fa-hit lg:hidden" onClick={onGuide} data-testid="fa-guide">
          <BookOpen size={18} aria-hidden />
          {t('fa.guide')}
        </button>
      </div>
      <div className="mt-1 flex min-h-12 items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {plan && (
            <span className="text-[0.8rem] font-medium text-ink-2" data-testid="fa-week">
              {t('fa.head.week', { from: fmtDate(plan.valid_from, lang), to: fmtDate(plan.valid_to, lang) })}
            </span>
          )}
          {recorded && <DataMark kind="recorded" date={RECORDED_AT} />}
        </div>
        <div role="group" aria-label={t('ui.lang.label')} className="fa-langq">
          {(['en', 'bn'] as const).map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => void setLang(l)}>
              {l === 'en' ? 'EN' : 'বাংলা'}
            </button>
          ))}
        </div>
        <LangSwitch compact className="fa-more-langs" />
        {install === 'ready' && (
          <button type="button" className="btn btn-ghost btn-icon fa-hit" onClick={() => void promptInstall()} aria-label={t('fa.install')} title={t('fa.install')} data-testid="fa-install">
            <Download size={19} aria-hidden />
          </button>
        )}
      </div>
    </header>
  );
}
