import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, Menu, Search } from 'lucide-react';
import { useI18n, type Key } from '../lib/i18n';
import { cx } from '../lib/cx';
import { Wordmark } from '../ui/kit/LoopMark';
import { openPalette } from '../ui/kit/CommandPalette';
import { LinkButton } from '../ui/Button';
import { LangSwitch, ThemeToggle } from '../ui/SiteControls';
import { Sheet } from '../ui/Sheet';
import { ApiBadge } from './ApiBadge';

/** The bar's links (the logo is the way home); "More" holds the rest, and the menu sheet, the palette and the footer list everything. */
export const NAV: { to: string; key: Key; end?: boolean }[] = [
  { to: '/app', key: 'ui.nav.app' },
  { to: '/map', key: 'ui.nav.map' },
  { to: '/try', key: 'ui.nav.try' },
  { to: '/officer', key: 'ui.nav.officer' },
  { to: '/verify', key: 'ui.nav.verify' },
];
export const NAV_MORE: { to: string; key: Key; end?: boolean }[] = [
  { to: '/trust', key: 'ui.nav.trust' },
  { to: '/proof', key: 'ui.nav.proof' },
  { to: '/about', key: 'ui.nav.about' },
];
export const NAV_ALL: { to: string; key: Key; end?: boolean }[] = [{ to: '/', key: 'ui.nav.story', end: true }, { to: '/receipt', key: 'ui.nav.receipt' }, ...NAV, ...NAV_MORE];

/** "More": the less-used pages in a small menu (a disclosure: Escape, a click outside or a route change closes it). */
function MoreMenu() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLLIElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const here = NAV_MORE.some((n) => pathname.startsWith(n.to));
  return (
    <li ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="nav-more"
        onClick={() => setOpen((o) => !o)}
        className={cx('relative z-10 inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[0.88rem] font-[500] transition-colors duration-200', here || open ? 'text-ink' : 'text-ink-2 hover:text-ink')}
      >
        {t('ui.nav.more')}
        <ChevronDown size={15} aria-hidden className={cx('transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <ul id="nav-more" className="glass absolute right-0 top-[calc(100%+10px)] m-0 grid min-w-[220px] list-none gap-0.5 rounded-[18px] p-2">
          {NAV_MORE.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.end}
                className={({ isActive }) => cx('flex min-h-11 items-center rounded-[12px] px-3 text-[0.92rem] font-[520]', isActive ? 'bg-sunk text-ink' : 'text-ink-2 hover:bg-sunk hover:text-ink')}
              >
                {t(n.key)}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * A floating glass pill (the house nav). The current page sits on a soft highlight that slides between links
 * (a shared layout animation: route changes are occasional, so the motion explains where you went).
 */
export function SiteHeader({ className }: { className?: string }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useEffect(() => setMenu(false), [pathname]);
  // move the highlight under the active link (also after the language changes link widths)
  useLayoutEffect(() => {
    const ul = list.current;
    const p = pill.current;
    if (!ul || !p) return;
    const place = () => {
      const a = ul.querySelector<HTMLElement>(':scope > li > a[aria-current="page"]');
      if (!a) {
        p.style.opacity = '0';
        return;
      }
      p.style.width = `${a.offsetWidth}px`;
      p.style.transform = `translateX(${a.parentElement?.offsetLeft ?? 0}px)`;
      p.style.opacity = '1';
    };
    place();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(place);
    ro.observe(ul);
    return () => ro.disconnect();
  }, [pathname, t]);

  return (
    <>
      <header className={cx('sticky top-0 z-50 flex h-[var(--header-h)] items-center px-[clamp(8px,1.6vw,20px)]', className)}>
        <div className="glass mx-auto flex h-[54px] w-full max-w-[1240px] items-center gap-2 rounded-full pl-4 pr-2">
          <Link to="/" aria-label={t('ui.nav.home')} className="press -ml-1 rounded-full px-1 py-1">
            <Wordmark />
          </Link>
          <nav aria-label={t('ui.nav.main')} className="mx-auto hidden lg:block">
            <ul ref={list} className="relative m-0 flex list-none items-center gap-0.5 p-0">
              {/* one highlight that slides to the current page (plain CSS transition: no animation library in the shell) */}
              <span ref={pill} aria-hidden className="nav-lozenge pointer-events-none absolute left-0 top-0 h-9 rounded-full opacity-0 transition-[transform,width,opacity] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)]" />
              {NAV.map((n) => (
                <li key={n.to} className="relative">
                  <NavLink
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) =>
                      cx('relative z-10 inline-flex h-9 items-center whitespace-nowrap rounded-full px-3 text-[0.88rem] font-[500] transition-colors duration-200 xl:px-3.5', isActive ? 'text-ink' : 'text-ink-2 hover:text-ink')
                    }
                  >
                    {t(n.key)}
                  </NavLink>
                </li>
              ))}
              <MoreMenu />
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <ApiBadge className="mr-1 hidden 2xl:inline-flex" />
            <button type="button" onClick={openPalette} className="btn btn-ghost btn-sm hidden gap-2 px-3 xl:inline-flex">
              <Search size={16} aria-hidden />
              <span className="sr-only">{t('ui.palette.open')}</span>
              <kbd className="mono rounded-md border border-rule px-1.5 text-[0.66rem] text-ink-3">Ctrl K</kbd>
            </button>
            <LangSwitch compact />
            <ThemeToggle />
            {pathname !== '/app' && (
              <LinkButton to="/app" variant="primary" size="sm" className="ml-1 hidden sm:inline-flex lg:hidden xl:inline-flex">
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
                <NavLink to={n.to} end={n.end} className={({ isActive }) => cx('flex min-h-14 items-center text-[1.4rem] font-[560] tracking-[-0.03em]', isActive ? 'text-ink' : 'text-ink-2')}>
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
