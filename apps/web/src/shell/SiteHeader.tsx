import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useI18n, type Key } from '../lib/i18n';
import { cx } from '../lib/cx';
import { Logo } from '../ui/Logo';
import { LinkButton } from '../ui/Button';
import { LangSwitch, ThemeToggle } from '../ui/SiteControls';
import { Sheet } from '../ui/Sheet';
import { ApiBadge } from './ApiBadge';

/** The bar's links (the logo is the way home); the menu sheet and the footer add the story first. */
export const NAV: { to: string; key: Key; end?: boolean }[] = [
  { to: '/app', key: 'ui.nav.app' },
  { to: '/officer', key: 'ui.nav.officer' },
  { to: '/verify', key: 'ui.nav.verify' },
  { to: '/trust', key: 'ui.nav.trust' },
  { to: '/proof', key: 'ui.nav.proof' },
  { to: '/about', key: 'ui.nav.about' },
];
export const NAV_ALL: { to: string; key: Key; end?: boolean }[] = [{ to: '/', key: 'ui.nav.story', end: true }, ...NAV];

/** Sticky paper bar. A hairline appears once the page scrolls (a sentinel, not a scroll handler). */
export function SiteHeader({ className }: { className?: string }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setStuck(!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => setMenu(false), [pathname]);

  return (
    <>
      <div ref={sentinel} className="absolute left-0 top-0 h-px w-px" aria-hidden />
      <header className={cx('sticky top-0 z-50 border-b bg-paper transition-colors duration-200', stuck ? 'border-rule' : 'border-transparent', className)}>
        <div className="wrap flex h-[var(--header-h)] items-center gap-3">
          <Link to="/" aria-label={t('ui.nav.home')} className="-ml-1 rounded-md p-1">
            <Logo />
          </Link>
          <nav aria-label={t('ui.nav.main')} className="ml-5 hidden lg:block">
            <ul className="m-0 flex list-none items-center gap-1 p-0">
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) =>
                      cx(
                        'relative inline-flex h-10 items-center rounded-md px-3 text-[0.95rem] font-medium transition-colors duration-150',
                        isActive ? 'text-ink after:absolute after:inset-x-3 after:bottom-1 after:h-[2px] after:rounded-full after:bg-ink' : 'text-ink-2 hover:text-ink',
                      )
                    }
                  >
                    {t(n.key)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ApiBadge className="mr-1 hidden xl:inline-flex" />
            <LangSwitch compact />
            <ThemeToggle />
            {pathname !== '/app' && (
              <LinkButton to="/app" variant="primary" size="sm" className="ml-1 hidden sm:inline-flex">
                {t('ui.cta.tryApp')}
              </LinkButton>
            )}
            <button type="button" className="btn btn-ghost btn-icon btn-sm lg:hidden" aria-label={t('ui.nav.menu')} aria-expanded={menu} onClick={() => setMenu(true)}>
              <Menu size={20} aria-hidden />
            </button>
          </div>
        </div>
      </header>
      <Sheet open={menu} onClose={() => setMenu(false)} title={t('ui.nav.menu')}>
        <nav aria-label={t('ui.nav.main')}>
          <ul className="m-0 list-none p-0">
            {NAV_ALL.map((n) => (
              <li key={n.to} className="border-b border-rule">
                <NavLink to={n.to} end={n.end} className={({ isActive }) => cx('flex min-h-14 items-center text-[1.35rem] font-semibold [font-stretch:88%]', isActive ? 'text-ink' : 'text-ink-2')}>
                  {t(n.key)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <ApiBadge />
          <LangSwitch />
          <ThemeToggle />
        </div>
      </Sheet>
    </>
  );
}
