import { Link } from 'react-router-dom';
import { Lock, LockOpen } from 'lucide-react';
import type { AreaStats, GateEvent } from '../../lib/api/types';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { meterView } from '../trust/gate';
import { POLICY_V1 } from '../trust/policy';

const verifyPath = (id: string) => `/verify/${encodeURIComponent(id.replace(/^urn:uuid:/, ''))}`;

/**
 * One area's evidence: the gate (open or closed), the Wilson lower bound against the 0.85 bar, the sure answers the gate
 * needs, all verdicts and the precision. `before` shows what one verdict moved; `moment` plays the gate opening (or
 * closing) once: the bound slides past the bar and the lock turns. Transform and opacity only.
 */
export function AreaGauge({ stats, before, moment, compact }: { stats: AreaStats; before?: AreaStats | null; moment?: GateEvent | null; compact?: boolean }) {
  const { t, lang } = useI18n();
  const m = meterView(stats);
  const b = before ? meterView(before) : null;
  const n2 = (x: number | null) => (x == null ? '—' : fmtNum(x, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const bar = POLICY_V1.openLb;
  const opened = moment?.event === 'opened';
  const closed = moment?.event === 'closed';
  return (
    <div className={cx('off-gauge', moment && 'has-moment')} data-testid="area-gauge" data-gate={m.gateOpen ? 'open' : 'closed'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={cx('off-gate', m.gateOpen ? 'is-open' : 'is-closed', moment && 'off-gate-pop')} data-testid="gate-state">
          {m.gateOpen ? <LockOpen size={18} aria-hidden /> : <Lock size={18} aria-hidden />}
          {m.gateOpen ? t('off.gate.open') : t('off.gate.closed')}
        </p>
        <p className="mono m-0 text-xs text-ink-3">{stats.model}</p>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-ink-2">{t('off.gauge.bound')}</span>
          <span className="mono text-ink" data-testid="gauge-bound">
            {b && b.lowerBound !== m.lowerBound ? (
              <>
                <span className="text-ink-3">{n2(b.lowerBound)} → </span>
                {n2(m.lowerBound)}
              </>
            ) : (
              n2(m.lowerBound)
            )}{' '}
            <span className="text-ink-3">/ {n2(bar)}</span>
          </span>
        </div>
        <div className="off-track mt-2" role="img" aria-label={t('off.gauge.boundAria', { lb: n2(m.lowerBound), bar: n2(bar) })}>
          <span className="off-track-clip">
            <span className={cx('off-track-fill', m.reachedBar && 'is-over')} style={{ transform: `scaleX(${m.lowerBound})` }} />
          </span>
          <span className="off-track-bar" style={{ left: `${bar * 100}%` }} />
        </div>
      </div>

      <dl className={cx('off-gauge-nums', compact && 'is-compact')}>
        <div>
          <dt>{t('off.gauge.sure')}</dt>
          <dd className="mono" data-testid="gauge-sure">
            {m.sure < m.need ? t('off.gauge.sureOf', { n: fmtNum(m.sure, lang), need: fmtNum(m.need, lang) }) : t('off.gauge.sureEnough', { n: fmtNum(m.sure, lang) })}
          </dd>
        </div>
        <div>
          <dt>{t('off.gauge.verdicts')}</dt>
          <dd className="mono" data-testid="gauge-verdicts">
            {b && b.verdicts !== m.verdicts ? `${fmtNum(b.verdicts, lang)} → ${fmtNum(m.verdicts, lang)}` : fmtNum(m.verdicts, lang)}
          </dd>
        </div>
        <div>
          <dt>{t('off.gauge.precision')}</dt>
          <dd className="mono">{n2(m.precision)}</dd>
        </div>
      </dl>

      {moment && (
        <div className={cx('off-moment', opened ? 'is-opened' : 'is-closed')} role="status" data-testid="gate-moment" data-event={moment.event}>
          <p className="m-0 font-semibold">{opened ? t('off.moment.opened', { area: stats.area }) : t('off.moment.closed', { area: stats.area })}</p>
          <p className="m-0 mt-1 text-sm">{opened ? t('off.moment.openedSub') : t('off.moment.closedSub')}</p>
          <p className="mono m-0 mt-1 text-xs opacity-80">
            {fmtDate(moment.at, lang, 'datetime')} · {t('off.gauge.boundAria', { lb: n2(moment.lower_bound), bar: n2(bar) })}
          </p>
          {opened && stats.trust_credential_id && (
            <Link className="link mt-2 inline-block text-sm" to={verifyPath(stats.trust_credential_id)} data-testid="gate-moment-verify">
              {t('off.moment.verify')}
            </Link>
          )}
          {closed && <span className="sr-only-live">{t('off.moment.closedSub')}</span>}
        </div>
      )}
    </div>
  );
}

/** The gate's history, newest last: a small timeline of opened / closed events. */
export function GateEvents({ events }: { events: GateEvent[] }) {
  const { t, lang } = useI18n();
  if (!events.length) return <p className="m-0 text-sm text-ink-3">{t('off.area.noEvents')}</p>;
  return (
    <ol className="off-events" data-testid="gate-events">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} data-event={e.event}>
          <span className="off-events-dot" aria-hidden />
          <span className="font-medium text-ink">{e.event === 'opened' ? t('off.event.opened') : t('off.event.closed')}</span>
          <span className="mono text-xs text-ink-3">
            {fmtDate(e.at, lang, 'datetime')} · {t('off.event.detail', { n: fmtNum(e.verdicts, lang), lb: fmtNum(e.lower_bound, lang, { maximumFractionDigits: 2 }) })}
          </span>
        </li>
      ))}
    </ol>
  );
}
