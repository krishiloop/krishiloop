import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, ScanLine, Headset } from 'lucide-react';
import { setLang, useI18n } from '../../lib/i18n';
import { fmtDate } from '../../lib/format';
import { LogoMark } from '../../ui/Logo';
import { LangSwitch, ThemeToggle } from '../../ui/SiteControls';
import { DataMark } from '../../ui/DataMark';
import { RECORDED_AT } from '../../data/recorded';
import { useApiState } from '../../lib/api/client';
import { currentField, useFarmer } from './farmerStore';
import { cropName, countryName, stageName } from './words';

/**
 * The app's own header (on phones it replaces the site bar). On a phone it starts with a thin glass strip that keeps
 * the app connected to the website: back to KrishiLoop, and one tap to Verify a receipt or to the Officer (same
 * account-less session: everything lives in this browser). Under it: the field (crop, stage, place), this week, where
 * the data came from, a one-tap language switch (English · Bangla; Hindi and Swahili previews in the menu), and the Guide.
 */
export function AppHeader({ onGuide }: { onGuide: () => void }) {
  const { t, lang } = useI18n();
  const st = useFarmer();
  const api = useApiState();
  const field = currentField(st);
  const recorded = st.planSource === 'sample' || api.forced || api.mode === 'sample';
  const plan = st.plan;

  return (
    <header className="fa-head band-night">
      <nav className="fa-site lg:hidden" aria-label={t('ui.app.site')}>
        <Link to="/" className="fa-site-home">
          <ArrowLeft size={16} aria-hidden />
          <LogoMark size={18} />
          <span>{t('ui.app.website')}</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link to="/verify" className="fa-site-link" aria-label={t('ui.nav.verify')}>
            <ScanLine size={15} aria-hidden />
            {t('ui.app.verify')}
          </Link>
          <Link to="/officer" className="fa-site-link" aria-label={t('ui.nav.officer')}>
            <Headset size={15} aria-hidden />
            {t('ui.app.officer')}
          </Link>
          <ThemeToggle />
        </div>
      </nav>
      <div className="fa-head-main">
        <div className="flex items-center gap-2.5">
          <Link to="/" aria-label={t('ui.nav.home')} className="fa-hit fa-logo -ml-1 grid place-items-center rounded-[14px] text-ink max-lg:hidden">
            <LogoMark size={24} />
          </Link>
          <div className="min-w-0 flex-1" aria-live="polite">
            {field ? (
              <>
                <p className="fa-field-name truncate" data-testid="fa-field">
                  {cropName(field.crop, t)} <span className="text-ink-3">·</span> {stageName(field.stage, t)}
                </p>
                <p className="truncate text-[0.8rem] leading-snug text-ink-3">
                  {countryName(field.country, lang)} · {t('fa.head.sample')}
                </p>
              </>
            ) : (
              <span className="skeleton block h-10 w-44" aria-hidden />
            )}
          </div>
          <button type="button" className="btn btn-secondary fa-hit fa-guide lg:hidden" onClick={onGuide} data-testid="fa-guide">
            <BookOpen size={18} aria-hidden />
            {t('fa.guide')}
          </button>
        </div>
        <div className="mt-1.5 flex min-h-12 items-center gap-2">
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
        </div>
      </div>
    </header>
  );
}
