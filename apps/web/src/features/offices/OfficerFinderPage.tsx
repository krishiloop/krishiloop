import '../../lib/i18n/strings.offices';
import { Phone } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { FarmerCameo } from '../../ui/farmer/FarmerCameo';
import OfficesSheet from './OfficesSheet';
import './offices.css';
import './officerPage.css';

/**
 * /krishi-officer: the nearest Krishi officer as its own page (owner, 20 Nov: "this Krishi officer finding needs to be
 * more focused, and shown properly in the app and in the website"). The same finder as the sheet the apps open when the
 * AI is not sure: search an upazila or district, use my location or pick a district, the map, the officer's name and
 * work phone as the DAE pages publish them, Call and Go there. The Krishi Call Centre (16123) is one tap away at the top.
 */
export default function OfficerFinderPage() {
  const { t } = useI18n();
  return (
    <div className="near-page" data-testid="officer-finder-page">
      <section className="near-page-head wrap">
        <div className="min-w-0">
          <p className="eyebrow m-0">{t('near.page.kicker')}</p>
          <h1 className="t-title m-0 mt-3">{t('near.page.title')}</h1>
          <p className="m-0 mt-3 max-w-[52ch] text-[1.05rem] text-ink-2">{t('near.page.sub')}</p>
          <a href="tel:16123" className="near-page-call press" data-testid="near-page-16123">
            <Phone size={18} aria-hidden /> {t('near.callcentre.call')}
            <span className="near-page-call-sub">{t('near.page.callSub')}</span>
          </a>
        </div>
        <FarmerCameo mood="pointing" variant="corner" />
      </section>
      <section className="wrap near-page-body" aria-label={t('near.sheet.title')}>
        <OfficesSheet open inline onClose={() => undefined} />
      </section>
    </div>
  );
}
