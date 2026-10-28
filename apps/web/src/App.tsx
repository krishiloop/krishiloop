import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/shell/Layout';
import { useI18n } from './lib/i18n';

// every experience is its own chunk: the farmer app never downloads the story page (GSAP, 3D) and vice versa
const Landing = lazy(() => import('./features/landing/Landing'));
const FarmerApp = lazy(() => import('./features/farmer/FarmerApp'));
const VerifyPage = lazy(() => import('./features/verify/VerifyPage'));
const OfficerPage = lazy(() => import('./features/officer/OfficerPage'));

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-24 sm:px-6" aria-busy="true">
      <div className="skeleton h-10 w-2/3 max-w-md" />
      <div className="skeleton mt-6 h-64 w-full" />
    </div>
  );
}

function NotFound() {
  const { t } = useI18n();
  return (
    <section className="mx-auto grid min-h-[60dvh] max-w-md place-items-center px-6 py-24 text-center">
      <div>
        <p className="eyebrow text-sun">404</p>
        <h1 className="mt-4 text-h2 font-medium tracking-tight">{t('common.notFound')}</h1>
        <p className="mt-3 text-chrome">{t('common.notFoundBody')}</p>
        <Link to="/" className="btn btn-primary mt-8">
          {t('common.goHome')}
        </Link>
      </div>
    </section>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Landing />} />
            <Route path="app" element={<FarmerApp />} />
            <Route path="verify" element={<VerifyPage />} />
            <Route path="verify/:id" element={<VerifyPage />} />
            <Route path="officer" element={<OfficerPage />} />
            <Route path="officer/:id" element={<OfficerPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
