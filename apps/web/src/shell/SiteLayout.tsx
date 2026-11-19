import { Suspense, useEffect, useRef } from 'react';
import { Outlet, useLocation, useMatch } from 'react-router-dom';
import { useI18n, type Key } from '../lib/i18n';
import { startReveal } from '../lib/reveal';
import { cx } from '../lib/cx';
import { Toaster } from '../ui/Toast';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { CommandPalette } from '../ui/kit/CommandPalette';
import { NAV_ALL } from './SiteHeader';

const TITLES: [RegExp, Key][] = [
  [/^\/app/, 'ui.nav.app'],
  [/^\/map/, 'ui.nav.map'],
  [/^\/try/, 'ui.nav.try'],
  [/^\/officer/, 'ui.nav.officer'],
  [/^\/verify/, 'ui.nav.verify'],
  [/^\/trust/, 'ui.nav.trust'],
  [/^\/proof/, 'ui.nav.proof'],
  [/^\/about/, 'ui.nav.about'],
  [/^\/receipt/, 'ui.nav.receipt'],
];

function PageSkeleton() {
  return (
    // a full screen tall, so the footer never shows (and then jumps away) while a page chunk loads: CLS 0
    <div className="wrap min-h-[100svh] pt-16" aria-busy="true">
      <div className="skeleton h-12 w-2/3 max-w-xl" />
      <div className="skeleton mt-6 h-72 w-full" />
    </div>
  );
}

/**
 * The frame of every page: skip link, sticky header, main, footer. On a route change the page starts at the top and
 * focus moves to <main> (screen readers hear the new page), and the tab title follows the route.
 * Inside the farmer app on phones and tablets the app's own header replaces the site bar.
 */
export function SiteLayout() {
  const { t } = useI18n();
  const { pathname, hash } = useLocation();
  const inApp = !!useMatch('/app');
  const isHome = pathname === '/';
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    startReveal();
    // the botanic art's sway (kit.css .botanic-bg): its own tiny chunk, so the first screen does not wait for it
    void import('./botanicArt').then((m) => m.startBotanicArt());
  }, []);
  // showcase cards lean toward the mouse: one delegated listener for every page, loaded only for a desktop mouse
  useEffect(() => {
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    let stop: (() => void) | undefined;
    let dead = false;
    void import('../ui/kit/autoTilt').then((m) => {
      if (!dead) stop = m.startAutoTilt();
    });
    return () => {
      dead = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    const key = TITLES.find(([re]) => re.test(pathname))?.[1];
    document.title = key ? `${t(key)} · KrishiLoop` : 'KrishiLoop · AI farm advice with a receipt anyone can check';
  }, [pathname, t]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (hash) return;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    main.current?.focus({ preventScroll: true });
  }, [pathname, hash]);

  return (
    <>
      <a href="#main" className="skip-link">
        {t('ui.nav.skip')}
      </a>
      <SiteHeader className={cx(inApp && 'max-lg:hidden')} />
      <main id="main" ref={main} tabIndex={-1} className="relative isolate min-h-[70dvh]">
        {/* every inner page opens under the same field light: mustard dawn, paddy rows (static, behind everything) */}
        {!inApp && !isHome && <div className="page-dawn" aria-hidden />}
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      {!inApp && <SiteFooter />}
      <Toaster />
      <CommandPalette routes={NAV_ALL} />
    </>
  );
}
