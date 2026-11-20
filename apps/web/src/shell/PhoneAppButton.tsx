import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Smartphone } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cx } from '../lib/cx';

// the QR code and its words load only when someone opens the panel (nothing added to any first visit)
const OpenOnPhone = lazy(() => import('../features/mobile/OpenOnPhone').then((m) => ({ default: m.OpenOnPhone })));

/**
 * "Phone app" in the site's top bar (owner, 20 Nov: "the mobile app QR code and link need to be easy to find, maybe in
 * the nav bar"). A small panel opens under it: the QR code to /m, the link written out, Copy link, and Open. A disclosure
 * like "More": Escape, a click outside or a route change closes it.
 */
export function PhoneAppButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
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

  return (
    <div ref={box} className={cx('relative', className)}>
      <button
        type="button"
        className="nav-phone press"
        aria-expanded={open}
        aria-controls="nav-phone-panel"
        onClick={() => setOpen((o) => !o)}
        data-testid="nav-phone"
      >
        <Smartphone size={16} aria-hidden />
        {/* icon only from lg to xl, where longer languages (es, sw) would push the bar past its edge */}
        <span className="lg:max-xl:sr-only">{t('ui.nav.phoneApp')}</span>
      </button>
      {open && (
        <div id="nav-phone-panel" className="nav-phone-panel glass" role="group" aria-label={t('ui.nav.phoneApp')} data-testid="nav-phone-panel">
          <Suspense fallback={<span className="skeleton block h-[220px] w-full rounded-[14px]" aria-hidden />}>
            <OpenOnPhone compact />
          </Suspense>
          <Link to="/m" className="nav-phone-open press" data-testid="nav-phone-open">
            {t('ui.phone.open')} <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}
