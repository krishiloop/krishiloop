import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { LogoMark, Wordmark } from '../ui/Logo';
import { LangMenu, ThemeToggle, MotionToggle, ModeToggle, DataBadge } from './Controls';
import { Sheet } from '../ui/Sheet';
import { Toaster } from '../ui/Toaster';
import { PageBoundary } from '../ui/Safe';
import { useI18n, type Key } from '../../lib/i18n';

const NAV: { to: string; key: Key; end?: boolean; preload: () => Promise<unknown> }[] = [
  { to: '/', key: 'nav.home', end: true, preload: () => import('../../features/landing/Landing') },
  { to: '/app', key: 'nav.app', preload: () => import('../../features/farmer/FarmerApp') },
  { to: '/verify', key: 'nav.verify', preload: () => import('../../features/verify/VerifyPage') },
  { to: '/officer', key: 'nav.officer', preload: () => import('../../features/officer/OfficerPage') },
];

function titleFor(path: string): Key | null {
  if (path.startsWith('/app')) return 'app.title';
  if (path.startsWith('/verify')) return 'verify.title';
  if (path.startsWith('/officer')) return 'officer.title';
  return null;
}

export function Layout() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  const onHome = pathname === '/';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // route change: new title, back to the top, and move focus to the page so keyboard and screen-reader users start there
  useEffect(() => {
    const k = titleFor(pathname);
    document.title = k ? `${t(k)} · KrishiLoop` : 'KrishiLoop · every piece of AI farm advice comes with a receipt';
    setMenu(false);
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [pathname, lang, t]);

  return (
    <>
      <a href="#main" className="skip-link">
        {t('nav.skip')}
      </a>
      <header className="topbar" data-scrolled={scrolled} data-over-hero={onHome} {...(onHome && !scrolled ? { 'data-theme': 'dark' } : {})}>
        <div className="mx-auto flex h-full max-w-[1280px] items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="mr-2 inline-flex min-h-11 items-center gap-2.5 rounded-full" aria-label={t('nav.home.aria')}>
            <LogoMark size={30} className="text-bone" />
            <Wordmark />
          </Link>
          <nav className="hidden items-center md:flex" aria-label="Primary">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className="nav-link" onPointerEnter={() => void n.preload()} onFocus={() => void n.preload()}>
                {t(n.key)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <DataBadge className="hidden lg:inline-flex" />
            <LangMenu />
            <span className="hidden items-center gap-1.5 md:flex">
              <ModeToggle />
              <MotionToggle />
              <ThemeToggle />
            </span>
            <button type="button" className="icon-btn md:hidden" onClick={() => setMenu(true)} aria-label={t('nav.menu')}>
              <Menu size={22} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <Sheet open={menu} onClose={() => setMenu(false)} title={t('nav.menu')}>
        <nav className="grid gap-1" aria-label="Mobile">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="btn btn-quiet justify-between rounded-2xl text-base" onClick={() => setMenu(false)}>
              {t(n.key)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <ModeToggle />
          <MotionToggle className="border border-line-2" />
          <ThemeToggle />
          <DataBadge />
        </div>
      </Sheet>

      <main id="main" ref={main} tabIndex={-1} className="page-in outline-none">
        <PageBoundary key={pathname}>
          <Outlet />
        </PageBoundary>
      </main>

      <Footer />
      <Toaster />
    </>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-10 text-sm text-chrome sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md">
          <Link to="/" className="inline-flex items-center gap-2.5 text-bone">
            <LogoMark size={26} className="text-bone" />
            <Wordmark />
          </Link>
          <p className="mt-3 mb-0 leading-relaxed">{t('brand.tag')}</p>
        </div>
        <ul className="m-0 grid list-none gap-1.5 p-0 text-[0.85rem]">
          <li>{t('footer.honest')}</li>
          <li>{t('footer.facts')}</li>
          <li>{t('footer.openCore')}</li>
        </ul>
      </div>
    </footer>
  );
}
