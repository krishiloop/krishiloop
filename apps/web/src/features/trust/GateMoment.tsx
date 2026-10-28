import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lock, LockOpen } from 'lucide-react';
import { Chip } from '../../ui/Chip';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { useMotionReduced } from '../../lib/motionPref';
import type { GateEvent } from '../../lib/api/types';
import { POLICY_V1, type Policy } from './policy';
import './meter.css';

/**
 * A gate event is a moment, not a row in a list: the lock pops open for "Trust earned" and shut for "Trust withdrawn",
 * and the text says what changed for farmers in that area. It links to the credential, which anyone can verify.
 * Quiet by design: no confetti. The only motion is the lock popping once, and one short buzz on a withdrawal.
 */
export function GateMoment({ event, area, credentialId, policy = POLICY_V1 }: { event: GateEvent; area: string; credentialId: string | null; policy?: Policy }) {
  const { t, lang } = useI18n();
  const reduced = useMotionReduced();
  const opened = event.event === 'opened';
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const precision = event.precision ?? 0;

  useEffect(() => {
    if (opened || reduced) return;
    // a withdrawal is felt once; browsers ignore a buzz before the visitor has touched the page
    const id = window.setTimeout(() => {
      try {
        if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([28]);
      } catch {
        /* no vibration API */
      }
    }, 700);
    return () => window.clearTimeout(id);
  }, [opened, reduced]);

  const body = opened
    ? t('trust.moment.opened.body', {
        right: fmtNum(Math.round(precision * event.sure_in_window), lang),
        n: fmtNum(event.sure_in_window, lang),
        pct: `${fmtNum(Math.round(precision * 100), lang)}%`,
        lb: two(event.lower_bound),
        bar: two(policy.openLb),
        area,
      })
    : t('trust.moment.closed.body', { lb: two(event.lower_bound), bar: two(policy.closeLb), area });

  return (
    <section className="gm" data-event={event.event} role="status" aria-live="polite" data-testid="gate-moment" data-play="true">
      <div className="gm-art" aria-hidden>
        {opened ? <LockOpen size={26} strokeWidth={1.8} /> : <Lock size={26} strokeWidth={1.8} />}
      </div>
      <div className="min-w-0">
        <h3 className="t-head gm-title" data-testid="gate-moment-title">
          {t(opened ? 'trust.moment.opened' : 'trust.moment.closed', { area })}
        </h3>
        <p className="gm-body">{body}</p>
        <p className="m-0 mt-3 flex flex-wrap gap-2">
          <Chip>
            {t('trust.meter.bound')} {two(event.lower_bound)}
          </Chip>
          <Chip>{t('trust.moment.chip.sure', { n: fmtNum(event.sure_in_window, lang) })}</Chip>
        </p>
        {credentialId ? (
          <Link to={`/verify/${encodeURIComponent(credentialId)}`} className="btn btn-secondary mt-3" data-testid="gate-moment-verify">
            {t(opened ? 'trust.moment.verify' : 'trust.moment.verifyWithdrawn')} <ArrowRight size={15} aria-hidden />
          </Link>
        ) : null}
      </div>
      <span className="sr-only-live">{t(opened ? 'trust.moment.sr.opened' : 'trust.moment.sr.closed', { area })}</span>
    </section>
  );
}
