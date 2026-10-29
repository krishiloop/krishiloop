import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtDate, pickText, shortId } from '../../lib/format';
import { cx } from '../../lib/cx';
import { DecisionPictogram, KindIcon } from '../../ui/Pictogram';
import { Stamp } from '../../ui/Stamp';
import { toneOfLight } from '../../ui/Chip';
import { TONE_TILE } from '../../ui/Receipt';
import { refreshStatuses, useHeld, type HeldReceipt, type StatusInfo } from './receipts';
import type { ReceiptRef } from './ReceiptSheet';

/**
 * Receipts: every receipt this visitor received in this tab (from plans and from Ask), newest first, each with what the
 * verifier says about it NOW. A receipt whose rule was recalled shows a RECALLED stamp and what to do instead.
 */
export function ReceiptsTab({ onOpenReceipt }: { onOpenReceipt: (r: ReceiptRef) => void }) {
  const { t } = useI18n();
  const { items, status } = useHeld();

  useEffect(() => {
    void refreshStatuses();
  }, []);

  if (!items.length) {
    return (
      <div className="grid gap-3" data-testid="fa-receipts">
        <h2 className="t-head">{t('fa.rcs.title')}</h2>
        <p className="text-ink-2">{t('fa.rcs.empty')}</p>
      </div>
    );
  }
  const recalled = items.filter((x) => status[x.id]?.s === 'recalled').length;

  return (
    <div className="grid gap-5" data-testid="fa-receipts">
      <div>
        <h2 className="t-head">{t('fa.rcs.title')}</h2>
        <p className="mt-1.5 text-ink-2" aria-live="polite">
          {t('fa.rcs.count', { n: items.length })}
          {recalled > 0 && <span className="font-semibold text-stop"> · {t('fa.rcs.recalledN', { n: recalled })}</span>}
        </p>
      </div>
      <ul className="fa-stagger m-0 grid list-none gap-2 p-0">
        {items.map((x, i) => (
          <li key={x.id} style={{ ['--i' as string]: Math.min(i, 8) }}>
            <Row item={x} info={status[x.id]} onOpen={() => onOpenReceipt({ receipt: x.receipt, credentialId: x.id, recorded: x.recorded })} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ item, info, onOpen }: { item: HeldReceipt; info: StatusInfo | undefined; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const advice = item.receipt.advice;
  const title = pickText(advice?.title, lang);
  const tone = toneOfLight(advice?.traffic_light);
  const rule = item.receipt.rule_refs[0];
  const s = info?.s ?? 'checking';
  const recalled = s === 'recalled';
  // a receipt this visitor holds turns Recalled while they look: the row flips over to ember once (not on first draw)
  const was = useRef(s);
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    const before = was.current;
    was.current = s;
    if (s !== 'recalled' || before === 'recalled') return;
    setFlip(true);
    const id = window.setTimeout(() => setFlip(false), 900);
    return () => window.clearTimeout(id);
  }, [s]);
  return (
    <div className={cx('fa-rc-row', recalled && 'is-recalled')} data-flip={flip || undefined} data-testid="fa-receipt-row" data-status={s}>
      <button type="button" className="fa-rc-open" onClick={onOpen}>
        <span className={cx('grid size-12 flex-none place-items-center rounded-[10px]', TONE_TILE[tone])} style={{ ['--pict-bg' as string]: `var(--color-${tone === 'neutral' ? 'sunk' : `${tone}-wash`})` }}>
          {advice?.decision ? <DecisionPictogram decision={advice.decision} size={34} /> : <KindIcon kind={advice?.kind ?? 'other'} size={22} />}
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span lang={title.lang} className={cx('block leading-snug', recalled ? 'text-ink-2 line-through decoration-stop/70' : 'text-ink')}>
            {title.text}
          </span>
          <span className="mono mt-1 block text-[0.72rem] text-ink-3">
            {rule ? `${rule.rule_id} v${rule.version}` : ''} · {item.via === 'ask' ? t('fa.rcs.viaAsk') : t('fa.rcs.viaPlan')} · {fmtDate(new Date(item.at), lang, 'time')} · №…{shortId(item.id, 6)}
          </span>
          <span className="mt-2 flex min-h-7 items-center">
            {s === 'authentic' || s === 'recalled' ? (
              <Stamp key={s} kind={s} size="sm" land={recalled} className="fa-rc-stamp" />
            ) : (
              <span className="text-xs text-ink-3">{s === 'checking' ? t('ui.stamp.checking') : s === 'invalid' ? t('ui.stamp.invalid') : t('fa.rcs.unreachable')}</span>
            )}
          </span>
        </span>
        <ChevronRight size={18} aria-hidden className="flex-none text-ink-3" />
      </button>
      {recalled && (
        <p className="fa-rc-now" data-testid="fa-receipt-now">
          <span className="font-semibold text-stop">{t('fa.rc.nowTitle')}</span> {t('fa.rcs.now', { rules: (info?.rules ?? []).join(', ') || (rule ? `${rule.rule_id} v${rule.version}` : '') })}
        </p>
      )}
    </div>
  );
}
