import { useId, useRef } from 'react';
import { Copy, Smartphone } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import '../../lib/i18n/strings.mobile';
import { publicBase } from '../../lib/qr';
import { cx } from '../../lib/cx';
import { Qr } from '../../ui/Qr';
import { toast } from '../../ui/Toast';
import './open-on-phone.css';

/** The phone app's address: `{origin}/m` (VITE_PUBLIC_BASE_URL when set, so a printed QR opens the hosted site). */
export const phoneAppUrl = () => `${publicBase()}/m`;

/**
 * "Open on your phone": a QR code to the phone app (/m), the link written out, and "Copy link". For a laptop visitor
 * (a judge, an officer at a desk) to move to their phone in one scan. Used by the home page and by /app's left rail.
 * The QR is always dark modules on a light plate, in both themes, so it scans.
 */
export function OpenOnPhone({ className, compact }: { className?: string; compact?: boolean }) {
  const { t } = useI18n();
  const url = phoneAppUrl();
  const shown = url.replace(/^https?:\/\//, '');
  const field = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(t('m.open.copied'));
    } catch {
      field.current?.select();
      toast(t('m.open.copyFail'), { tone: 'info', ms: 4000 });
    }
  };

  return (
    <section className={cx('oop', compact && 'oop-compact', className)} aria-labelledby={titleId} data-testid="open-on-phone">
      <div className="oop-qr paper-object">
        <Qr value={url} size={compact ? 112 : 140} label={t('m.open.qrAlt')} />
      </div>
      <div className="oop-body">
        <h2 id={titleId} className="oop-title">
          <Smartphone size={18} aria-hidden className="flex-none" />
          {t('m.open.title')}
        </h2>
        <p className="oop-scan">{t('m.open.scan')}</p>
        {!compact && <p className="oop-sub">{t('m.open.sub')}</p>}
        <input ref={field} className="oop-url mono" value={shown} readOnly aria-label={t('m.open.title')} onFocus={(e) => e.currentTarget.select()} data-testid="open-on-phone-url" />
        <button type="button" className="btn btn-secondary btn-sm oop-copy" onClick={() => void copy()} data-testid="open-on-phone-copy">
          <Copy size={16} aria-hidden />
          {t('m.open.copy')}
        </button>
      </div>
    </section>
  );
}

export default OpenOnPhone;
