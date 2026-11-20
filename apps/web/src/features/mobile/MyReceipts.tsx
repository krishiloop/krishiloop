import { useEffect, useState } from 'react';
import { ChevronRight, Copy, House, QrCode, Share2, WifiOff } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum, pickText } from '../../lib/format';
import { cx } from '../../lib/cx';
import { publicBase, verifyUrl } from '../../lib/qr';
import { receiptCode } from '../../lib/api/client';
import { DecisionPictogram, KindIcon } from '../../ui/Pictogram';
import { Stamp } from '../../ui/Stamp';
import { Qr } from '../../ui/Qr';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/Toast';
import { toneOfLight } from '../../ui/Chip';
import { TONE_TILE } from '../../ui/Receipt';
import { refreshStatuses, useHeld } from '../farmer/receipts';
import type { ReceiptRef } from '../farmer/ReceiptSheet';
import { checkOlder, shownVerdict, useSaved, type SavedReceipt } from './saved';
import { useOnline } from './platform';

/** When the verdict was given, in the phone's words: "14:05" today, "18 Nov, 14:05" on another day. */
function whenText(at: number, lang: Parameters<typeof fmtDate>[1]): string {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today ? fmtDate(d, lang, 'time') : `${fmtDate(d, lang, 'short')}, ${fmtDate(d, lang, 'time')}`;
}

/** The link an officer's phone opens: the short receipt code when there is one (a smaller QR scans better), else the id. */
async function linkFor(id: string): Promise<{ url: string; code: string | null }> {
  const code = await receiptCode(id).catch(() => null);
  return { url: code ? `${publicBase()}/v/${code}` : verifyUrl(id), code };
}

async function shareReceipt(x: SavedReceipt, title: string, t: ReturnType<typeof useI18n>['t']) {
  const { url } = await linkFor(x.id);
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: 'KrishiLoop', text: title, url });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(t('m.qr.copied'));
  } catch {
    toast(t('m.qr.copyFail'), { tone: 'info' });
  }
}

/**
 * My receipts: every receipt saved on this phone, newest first, each with its stamp (Authentic or Recalled) and when it
 * was checked. Online, each one is checked again when the list opens. Offline, the last check is shown and the list
 * says so plainly. Tap a row for the receipt itself; "Show QR" for an officer to scan; "Share" sends the check link.
 */
export function MyReceipts({ onOpen, onQr, onHome }: { onOpen: (r: ReceiptRef) => void; onQr: (x: SavedReceipt) => void; onHome: () => void }) {
  const { t, lang } = useI18n();
  const saved = useSaved();
  const { status } = useHeld();
  const online = useOnline();

  useEffect(() => {
    if (!online) return;
    void refreshStatuses();
    void checkOlder();
  }, [online]);

  if (!saved.length) {
    return (
      <div className="grid gap-4" data-testid="m-receipts">
        <h2 className="t-head">{t('m.rc.title')}</h2>
        <p className="text-ink-2">{t('m.rc.empty')}</p>
        <button type="button" className="btn btn-primary justify-self-start" onClick={onHome}>
          <House size={18} aria-hidden />
          {t('m.rc.goHome')}
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-5" data-testid="m-receipts">
      <div>
        <h2 className="t-head">{t('m.rc.title')}</h2>
        <p className="mt-1.5 text-ink-2">{t('m.rc.sub')}</p>
        <p className="mt-1 text-sm text-ink-3" aria-live="polite">
          {t('m.rc.count', { n: fmtNum(saved.length, lang) })}
        </p>
      </div>
      {!online && (
        <p className="fa-note" role="status" data-testid="m-rc-old">
          <WifiOff size={16} aria-hidden className="flex-none" />
          {t('m.rc.oldNote')}
        </p>
      )}
      <ul className="m-0 grid list-none gap-3 p-0">
        {saved.map((x) => (
          <li key={x.id}>
            <Row x={x} now={status[x.id]} onOpen={() => onOpen({ receipt: x.receipt, credentialId: x.id, recorded: x.recorded })} onQr={() => onQr(x)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ x, now, onOpen, onQr }: { x: SavedReceipt; now: Parameters<typeof shownVerdict>[1]; onOpen: () => void; onQr: () => void }) {
  const { t, lang } = useI18n();
  const advice = x.receipt.advice;
  const title = pickText(advice?.title, lang);
  const tone = toneOfLight(advice?.traffic_light);
  const v = shownVerdict(x, now);
  const recalled = v.s === 'recalled';
  const word = advice?.decision ? t(`ui.decision.${advice.decision}`) : '';

  return (
    <div className={cx('surface m-rc', recalled && 'is-recalled')} data-testid="m-receipt" data-status={v.s}>
      <button type="button" className="m-rc-open" onClick={onOpen}>
        <span className="sr-only-live">{t('m.rc.open')}: </span>
        <span className={cx('grid size-12 flex-none place-items-center rounded-[12px]', TONE_TILE[tone])} style={{ ['--pict-bg' as string]: `var(--color-${tone === 'neutral' ? 'sunk' : `${tone}-wash`})` }}>
          {advice?.decision ? <DecisionPictogram decision={advice.decision} size={34} /> : <KindIcon kind={advice?.kind ?? 'other'} size={22} />}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span lang={title.lang} className={cx('block font-semibold leading-snug', recalled ? 'text-ink-2 line-through decoration-stop/70' : 'text-ink')}>
            {title.text}
          </span>
          <span className="mt-1 block text-[0.8rem] text-ink-3">
            {x.via === 'ask' ? t('m.rc.fromAsk') : t('m.rc.fromPlan')} · {whenText(x.at, lang)}
            {x.recorded && <> · {t('m.rc.recorded')}</>}
          </span>
        </span>
        <ChevronRight size={20} aria-hidden className="flex-none text-ink-3" />
      </button>
      <div className="m-rc-status">
        {v.s === 'authentic' || v.s === 'recalled' ? (
          <Stamp kind={v.s} size="sm" className="m-rc-stamp" />
        ) : (
          <span className="text-sm text-ink-2">{v.s === 'checking' ? t('m.rc.checking') : v.s === 'invalid' ? t('m.rc.unknown') : t('m.rc.notChecked')}</span>
        )}
        {v.at && (v.s === 'authentic' || v.s === 'recalled') && (
          <span className="text-xs text-ink-3" data-testid="m-rc-when">
            {v.fresh && Date.now() - v.at < 60_000 ? t('m.rc.checkedNow') : t('m.rc.checkedAt', { when: whenText(v.at, lang) })}
          </span>
        )}
      </div>
      {recalled && (
        <p className="m-rc-now" data-testid="m-rc-withdrawn">
          {t('m.rc.withdrawn')}
        </p>
      )}
      <div className="m-rc-actions">
        <button type="button" className="btn btn-secondary" onClick={onQr} data-testid="m-rc-qr">
          <QrCode size={18} aria-hidden />
          {t('m.rc.qr')}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void shareReceipt(x, word ? `${word}: ${title.text}` : title.text, t)} data-testid="m-rc-share">
          <Share2 size={18} aria-hidden />
          {t('m.rc.share')}
        </button>
      </div>
    </div>
  );
}

/**
 * The QR an officer scans, big, on a light plate in both themes, with the short receipt code written out (for reading
 * aloud on a call) and "Copy link". The QR opens the public check page on any phone.
 */
export function QrSheet({ value, onClose }: { value: SavedReceipt | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const title = value ? pickText(value.receipt.advice?.title, lang) : null;
  return (
    <Sheet open={!!value} onClose={onClose} title={t('m.qr.title')} subtitle={t('m.qr.sub')} className="m-qr-sheet">
      {value && <QrBody key={value.id} x={value} title={title?.text ?? ''} onClose={onClose} />}
    </Sheet>
  );
}

function QrBody({ x, title, onClose }: { x: SavedReceipt; title: string; onClose: () => void }) {
  const { t } = useI18n();
  const [link, setLink] = useState<{ url: string; code: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void linkFor(x.id).then((l) => alive && setLink(l));
    return () => {
      alive = false;
    };
  }, [x.id]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast(t('m.qr.copied'));
    } catch {
      toast(t('m.qr.copyFail'), { tone: 'info' });
    }
  };

  return (
    <div className="grid justify-items-center gap-4 pb-2 text-center" data-testid="m-qr">
      <p className="m-0 max-w-[32ch] font-semibold leading-snug">{title}</p>
      <div className="m-qr-plate paper-object">{link ? <Qr value={link.url} size={232} label={t('m.qr.alt')} /> : <div className="skeleton size-[232px]" aria-hidden />}</div>
      {link?.code && (
        <p className="m-0">
          <span className="block text-xs text-ink-3">{t('m.qr.code')}</span>
          <span className="mono text-2xl font-semibold tracking-wider" data-testid="m-qr-code">
            {link.code}
          </span>
        </p>
      )}
      {link && (
        <p className="mono m-0 max-w-full break-all text-xs text-ink-3" data-testid="m-qr-url">
          {link.url.replace(/^https?:\/\//, '')}
        </p>
      )}
      <div className="grid w-full max-w-[360px] grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => void copy()} disabled={!link}>
          <Copy size={17} aria-hidden />
          {t('m.qr.copy')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('m.qr.close')}
        </button>
      </div>
    </div>
  );
}
