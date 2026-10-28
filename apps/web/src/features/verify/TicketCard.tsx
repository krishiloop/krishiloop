import { ShieldQuestion } from 'lucide-react';
import { AuthenticSeal, RecalledStamp } from './Stamp';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import type { AreaTrustSubject, Receipt } from '../../lib/api/types';

export type TicketStatus = 'idle' | 'authentic' | 'recalled' | 'invalid' | 'unreachable';

/**
 * The paper receipt the verdict lands on: a calm seal for AUTHENTIC, the red stamp for RECALLED. Used by the verifier
 * stage and by the story page's live demo. Animations key off an ancestor with data-play="true".
 */
export function TicketCard({ status, receipt, play, stampWord }: { status: TicketStatus; receipt: Receipt | null; play: boolean; stampWord?: string }) {
  const { t, lang } = useI18n();
  const quote = receipt?.sources[0]?.quote;
  const rule = receipt?.rule_refs[0];
  return (
    <div className="ticket" data-status={status} aria-hidden={!receipt}>
      {receipt ? (
        <>
          <p className="ticket-kicker">{t('receipt.header')}</p>
          <p className="ticket-quote">“{quote && quote.length > 118 ? `${quote.slice(0, 116)}…` : quote}”</p>
          <p className="ticket-meta">
            <span className="mono">
              {rule?.rule_id} {t('receipt.version', { n: rule?.version ?? 1 })}
            </span>
            <span>{fmtDate(receipt.created_at, lang, 'short')}</span>
          </p>
          {status === 'authentic' ? <AuthenticSeal play={play} /> : null}
          {status === 'recalled' ? <RecalledStamp word={stampWord ?? t('verify.stamp')} play={play} /> : null}
        </>
      ) : (
        <div className="ticket-empty">
          <ShieldQuestion size={44} strokeWidth={1.4} aria-hidden />
        </div>
      )}
    </div>
  );
}

/**
 * The paper an area's trust credential lands on: the area in big type, the model, the evidence in one line. A calm seal
 * while it stands, the ink stamp WITHDRAWN once the gate closed. It is the same ticket as a receipt, on purpose.
 */
export function AreaTrustTicket({ status, area, play }: { status: TicketStatus; area: AreaTrustSubject | null; play: boolean }) {
  const { t, lang } = useI18n();
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div className="ticket" data-status={status} aria-hidden={!area} data-testid="area-ticket">
      {area ? (
        <>
          <p className="ticket-kicker">{t('verify.area.kicker')}</p>
          <div className="ticket-quote">
            <span className="ticket-area-name block" data-testid="area-ticket-area">
              {area.area}
            </span>
            <span className="ticket-area-meta block">{area.model}</span>
          </div>
          <p className="ticket-meta">
            <span className="ticket-area-stats">
              {t('trust.meter.bound')} {two(area.lower_bound)} · {t('trust.moment.chip.sure', { n: fmtNum(area.sure_in_window, lang) })}
            </span>
            <span>{fmtDate(area.opened_at, lang, 'short')}</span>
          </p>
          {status === 'authentic' ? <AuthenticSeal play={play} /> : null}
          {status === 'recalled' ? <RecalledStamp word={t('verify.area.stamp')} play={play} /> : null}
        </>
      ) : (
        <div className="ticket-empty">
          <ShieldQuestion size={44} strokeWidth={1.4} aria-hidden />
        </div>
      )}
    </div>
  );
}
