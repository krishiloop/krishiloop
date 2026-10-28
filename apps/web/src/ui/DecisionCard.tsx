import type { ReactNode } from 'react';
import { ReceiptText } from 'lucide-react';
import type { Action } from '../lib/api/types';
import { useI18n } from '../lib/i18n';
import { fmtDate, fmtMoneyRange, pickText } from '../lib/format';
import { cx } from '../lib/cx';
import { Button } from './Button';
import { DecisionPictogram } from './Pictogram';
import { toneOfLight } from './Chip';
import { DataMark } from './DataMark';
import { TONE_TEXT, TONE_TILE } from './Receipt';

/**
 * This week's input decision, the one thing a farmer must understand at a glance: a pictogram in the decision's colour,
 * the decision word, the rule's own sentence, the plan window, the money it saves (only when the plan carries it), and
 * the receipt one tap away. Colour never carries meaning alone: the word and the pictogram say it too.
 */
export function DecisionCard({
  action,
  validTo,
  onOpenReceipt,
  aside,
  className,
}: {
  action: Action;
  validTo?: string;
  onOpenReceipt?: () => void;
  aside?: ReactNode;
  className?: string;
}) {
  const { t, lang } = useI18n();
  const tone = toneOfLight(action.traffic_light);
  const title = pickText(action.title, lang);
  const money = action.money_impact;
  return (
    <section className={cx('panel overflow-hidden', className)} aria-label={t('ui.kind.input_decision')}>
      <div className="flex items-start gap-4 p-5 sm:gap-5 sm:p-6">
        <span className={cx('grid size-[4.5rem] flex-none place-items-center rounded-[14px]', TONE_TILE[tone])} style={{ ['--pict-bg' as string]: `var(--color-${tone === 'neutral' ? 'sunk' : `${tone}-wash`})` }}>
          <DecisionPictogram decision={action.decision} size={52} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cx('t-head', TONE_TEXT[tone])}>{action.decision ? t(`ui.decision.${action.decision}`) : t('ui.kind.input_decision')}</p>
          <p lang={title.lang} className="mt-2 text-[1.06rem] leading-snug text-ink">
            {title.text}
          </p>
          {validTo && <p className="mono mt-2 text-xs text-ink-3">→ {fmtDate(validTo, lang, 'long')}</p>}
        </div>
        {aside}
      </div>
      {money && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule bg-sunk/60 px-5 py-3 text-sm sm:px-6">
          <span className="font-semibold">{fmtMoneyRange(money.amount_min, money.amount_max, money.currency, lang)}</span>
          <span className="text-ink-3">{money.basis}</span>
          {money.sample && <DataMark kind="sample" />}
        </div>
      )}
      {onOpenReceipt && (
        <div className="border-t border-rule p-3 sm:px-4">
          <Button variant="ghost" className="w-full justify-between" onClick={onOpenReceipt}>
            <span className="inline-flex items-center gap-2">
              <ReceiptText size={18} aria-hidden />
              {t('ui.receipt.open')}
            </span>
            <span aria-hidden>→</span>
          </Button>
        </div>
      )}
    </section>
  );
}
