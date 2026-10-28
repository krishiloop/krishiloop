import { lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { SiteLayout } from './shell/SiteLayout';
import { useI18n } from './lib/i18n';
import { LinkButton } from './ui/Button';

// every page is its own chunk: the farmer app never downloads the story page, and vice versa
const StoryPage = lazy(() => import('./features/story/StoryPage'));
const FarmerApp = lazy(() => import('./features/farmer/FarmerApp'));
const VerifyPage = lazy(() => import('./features/verify/VerifyPage'));
const OfficerPage = lazy(() => import('./features/officer/OfficerPage'));
const TrustPage = lazy(() => import('./features/trust/TrustPage'));
const ProofPage = lazy(() => import('./features/proof/ProofPage'));
const AboutPage = lazy(() => import('./features/about/AboutPage'));

function NotFound() {
  const { t } = useI18n();
  return (
    <section className="wrap grid min-h-[60dvh] place-items-center py-24 text-center">
      <div>
        <p className="eyebrow">404</p>
        <h1 className="t-title mt-4">{t('ui.notFound')}</h1>
        <p className="t-lead mx-auto mt-4 max-w-md">{t('ui.notFoundBody')}</p>
        <LinkButton to="/" variant="primary" className="mt-8" arrow>
          {t('ui.goHome')}
        </LinkButton>
      </div>
    </section>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<SiteLayout />}>
          <Route index element={<StoryPage />} />
          <Route path="app" element={<FarmerApp />} />
          <Route path="verify" element={<VerifyPage />} />
          <Route path="verify/:id" element={<VerifyPage />} />
          <Route path="officer" element={<OfficerPage />} />
          <Route path="officer/:id" element={<OfficerPage />} />
          <Route path="trust" element={<TrustPage />} />
          <Route path="proof" element={<ProofPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
