import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Globe, Headset, Moon, PanelsTopLeft, RotateCcw, Sun } from 'lucide-react';
import { setLang, useI18n } from '../../lib/i18n';
import { setTheme, useTheme } from '../../lib/theme';
import { cx } from '../../lib/cx';
import { useApiState } from '../../lib/api/client';
import { DataMark } from '../../ui/DataMark';
import { NearestOffice } from '../offices/NearestOffice';
import { RECORDED_AT } from '../../data/recorded';
import { select, useFarmer } from '../farmer/farmerStore';
import { cropName, countryName, profileLetter, profileSummary, profilesFor, stageName } from '../farmer/words';

/** The booking drawer and its words load on the first tap of "Call my officer". */
const Booking = lazy(() => import('./Booking'));

/**
 * Help: the things a farmer looks for when stuck, biggest first.
 *  - "Call my officer": the same booking drawer as the farmer app (visit or call, a day, a time; recorded mode keeps it
 *    on this phone and says it was not sent).
 *  - Language and screen (light or dark: dark reads better in strong sun).
 *  - The sample farm and farmer (for the demo, said plainly), where the answers come from, links back to the website
 *    and to the full demo, and what is real here.
 */
export default function HelpTab({ onRestart }: { onRestart: () => void }) {
  const { t, lang } = useI18n();
  const st = useFarmer();
  const api = useApiState();
  const theme = useTheme();
  const [visit, setVisit] = useState(false);
  // the drawer stays mounted after its first opening, so it can close with its exit motion
  const [booked, setBooked] = useState(false);
  const plan = st.plan;
  const recorded = api.forced || api.mode === 'sample' || st.planSource === 'sample';
  const profiles = profilesFor(st.fieldId, st.profiles);
  const fieldId = plan?.field_id ?? st.fieldId;
  const profileId = st.profileId ?? plan?.farmer_profile_id ?? null;

  return (
    <div className="grid gap-6" data-testid="m-help">
      <h2 className="t-head">{t('m.help.title')}</h2>

      <section className="m-officer" aria-labelledby="m-officer-title">
        <span className="m-officer-icon" aria-hidden>
          <Headset size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="m-officer-title" className="m-officer-title">
            {t('m.help.officer')}
          </h3>
          <p className="m-officer-sub">{fieldId && profileId ? t('m.help.officerSub') : t('m.help.noFarm')}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary m-officer-go"
          onClick={() => {
            setBooked(true);
            setVisit(true);
          }}
          disabled={!fieldId || !profileId}
          data-testid="m-call-officer"
        >
          {t('m.help.officerGo')}
        </button>
      </section>

      <NearestOffice variant="entry" />

      <section className="m-card" aria-labelledby="m-lang-title">
        <h3 id="m-lang-title" className="eyebrow">
          {t('m.help.lang')}
        </h3>
        <div className="m-seg mt-3" role="group" aria-labelledby="m-lang-title">
          {(['bn', 'en'] as const).map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => void setLang(l)} data-testid={`m-help-lang-${l}`}>
              {l === 'bn' ? 'বাংলা' : 'English'}
            </button>
          ))}
        </div>
        <h3 id="m-screen-title" className="eyebrow mt-5">
          {t('m.help.screen')}
        </h3>
        <div className="m-seg mt-3" role="group" aria-labelledby="m-screen-title">
          <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')} data-testid="m-theme-light">
            <Sun size={18} aria-hidden />
            {t('m.help.light')}
          </button>
          <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} data-testid="m-theme-dark">
            <Moon size={18} aria-hidden />
            {t('m.help.dark')}
          </button>
        </div>
      </section>

      <section className="m-card grid gap-4" aria-labelledby="m-farm-title">
        <div>
          <h3 id="m-farm-title" className="eyebrow">
            {t('m.help.farm')}
          </h3>
          <p className="mt-1.5 text-sm text-ink-2">{t('m.help.farmSub')}</p>
        </div>
        <fieldset className="m-0 grid gap-1.5 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold">{t('m.help.field')}</legend>
          {st.fields.length === 0 && <div className="skeleton h-28" />}
          {st.fields.map((f) => (
            <label key={f.field_id} className="fa-pick m-pick" data-checked={f.field_id === st.fieldId}>
              <input type="radio" name="m-field" value={f.field_id} checked={f.field_id === st.fieldId} onChange={() => void select(f.field_id)} className="fa-pick-input" data-testid={`m-field-${f.field_id}`} />
              <span className="min-w-0 flex-1 font-[560]">
                {cropName(f.crop, t)} · {stageName(f.stage, t)}
              </span>
              <span className="flex-none text-xs text-ink-3">{countryName(f.country, lang)}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="m-0 grid gap-1.5 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold">{t('m.help.farmer')}</legend>
          {profiles.map((p) => (
            <label key={p.farmer_profile_id} className="fa-pick m-pick" data-checked={p.farmer_profile_id === st.profileId}>
              <input type="radio" name="m-profile" value={p.farmer_profile_id} checked={p.farmer_profile_id === st.profileId} onChange={() => void select(st.fieldId, p.farmer_profile_id)} className="fa-pick-input" data-testid={`m-profile-${p.farmer_profile_id}`} />
              <span className="min-w-0 flex-1">
                <span className="font-[560]">{t('fa.profile.name', { id: profileLetter(p.farmer_profile_id) })}</span>
                <span className="text-ink-2"> · {profileSummary(p, t).line}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="m-card" aria-labelledby="m-data-title" data-testid="m-data">
        <h3 id="m-data-title" className="eyebrow">
          {t('m.help.data')}
        </h3>
        <div className="mt-3 flex flex-wrap items-center gap-2">{recorded ? <DataMark kind="recorded" date={RECORDED_AT} /> : api.mode === 'live' ? <DataMark kind="live" /> : null}</div>
        <p className="mt-2 text-sm text-ink-2">{recorded ? t('m.help.recorded') : t('m.help.live')}</p>
      </section>

      <section className="m-card" aria-labelledby="m-honest-title">
        <h3 id="m-honest-title" className="eyebrow">
          {t('m.help.honest')}
        </h3>
        <ul className="m-honest">
          <li>{t('m.help.honest1')}</li>
          <li data-testid="m-weights">{t('m.help.honest2')}</li>
          <li>{t('m.help.honest3')}</li>
        </ul>
      </section>

      <nav className="grid gap-2" aria-label={t('m.help.links')}>
        <Link to="/" className="m-link">
          <Globe size={20} aria-hidden />
          <span className="flex-1">{t('m.help.website')}</span>
          <ArrowUpRight size={18} aria-hidden className="text-ink-3" />
        </Link>
        <Link to="/app" className="m-link">
          <PanelsTopLeft size={20} aria-hidden />
          <span className="flex-1">{t('m.help.full')}</span>
          <ArrowUpRight size={18} aria-hidden className="text-ink-3" />
        </Link>
        <button type="button" className={cx('m-link')} onClick={onRestart} data-testid="m-restart">
          <RotateCcw size={20} aria-hidden />
          <span className="flex-1 text-left">{t('m.help.restart')}</span>
        </button>
      </nav>

      {booked && fieldId && profileId && (
        <Suspense fallback={null}>
          <Booking open={visit} onClose={() => setVisit(false)} fieldId={fieldId} profileId={profileId} />
        </Suspense>
      )}
    </div>
  );
}
