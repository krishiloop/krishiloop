import { lazy, Suspense } from 'react';
import { CalendarRange, FlaskConical, Hourglass, ShieldAlert, ShieldCheck, ShieldQuestion, WifiOff } from 'lucide-react';
import { TicketCard } from './TicketCard';
import { SampleBadge } from '../../components/ui/Badges';
import { signalOf } from '../farmer/Signal';
import { DataAsOf } from '../farmer/DataAsOf';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate, pickText } from '../../lib/format';
import { useMode } from '../../lib/device';
import { useMotionReduced } from '../../lib/motionPref';
import type { Action, Receipt } from '../../lib/api/types';
import type { VerifyOutcome } from '../../lib/api/client';

const MeshBackdrop = lazy(() => import('./MeshBackdrop'));

export type Verdict = VerifyOutcome['status'];

const PALETTE: Record<Verdict, string[]> = {
  authentic: ['#0b2417', '#14452c', '#1f6f46', '#08130d', '#2f9a62'],
  recalled: ['#2a0b09', '#5c1510', '#93241a', '#13090a', '#c2402e'],
  invalid: ['#2a1d08', '#4d3510', '#7c5616', '#120d05', '#b0802f'],
  unreachable: ['#141a15', '#1e2720', '#2a352d', '#0d110e', '#3a4a3e'],
};

const WORD: Record<Verdict, Key> = { authentic: 'verify.authentic', recalled: 'verify.recalled', invalid: 'verify.invalid', unreachable: 'verify.unreachable' };
const LINE: Record<Verdict, Key> = { authentic: 'verify.authentic.line', recalled: 'verify.recalled.line', invalid: 'verify.invalid.line', unreachable: 'verify.unreachable.line' };
const ICON = { authentic: ShieldCheck, recalled: ShieldAlert, invalid: ShieldQuestion, unreachable: WifiOff } as const;

/**
 * The verdict, staged. The verdict panel is always a dark "window" (data-theme="dark") so the white type stays readable
 * in both themes. AUTHENTIC is calm (a ring draws, a tick appears). RECALLED is the dramatic one (red stamp slam on the
 * receipt). INVALID and "could not check" stay quiet: uncertainty and errors never shake or bounce.
 */
export function VerdictStage({
  status,
  receipt,
  sample,
  sandbox = false,
  expired = false,
  reason,
  rules,
  play,
}: {
  status: Verdict;
  receipt: Receipt | null;
  sample: boolean;
  /** a receipt made in a demo session (GET /api/verify/{id} says `sandbox: true`) */
  sandbox?: boolean;
  /** signed and unaltered, but the plan week is over */
  expired?: boolean;
  reason?: string;
  rules?: string[];
  play: boolean;
}) {
  const { t } = useI18n();
  const mode = useMode();
  const reduced = useMotionReduced();
  const Icon = ICON[status];
  const invalidWhy = status === 'invalid' ? (reason && /unknown/i.test(reason) ? t('verify.invalid.unknown') : t('verify.invalid.sig')) : null;

  return (
    <section className="verdict" data-status={status} data-theme="dark" aria-labelledby="verdict-word" data-testid="verdict" data-play={play}>
      <div className="verdict-bg" aria-hidden>
        {mode.resolved === 'rich' ? (
          <Suspense fallback={null}>
            <MeshBackdrop colors={PALETTE[status]} speed={reduced ? 0 : 0.16} />
          </Suspense>
        ) : null}
        <div className="verdict-veil" />
      </div>

      <div className="verdict-inner">
        <TicketCard status={status} receipt={receipt} play={play} />

        <div className="verdict-copy">
          <p className="eyebrow flex flex-wrap items-center gap-2">
            {t('verify.title')} {sample ? <SampleBadge /> : null}
            {sandbox ? (
              <span className="chip" data-tone="sun" data-testid="badge-sandbox">
                <FlaskConical size={12} aria-hidden /> {t('verify.sandbox')}
              </span>
            ) : null}
            {expired && status === 'authentic' ? (
              <span className="chip" data-tone="wait" data-testid="badge-expired">
                <Hourglass size={12} aria-hidden /> {t('verify.expired')}
              </span>
            ) : null}
          </p>
          <h1 id="verdict-word" className="display verdict-word" data-testid="verdict-word">
            <Icon className="verdict-icon" size={34} strokeWidth={1.8} aria-hidden />
            {t(WORD[status])}
          </h1>
          <p className="verdict-line">{t(LINE[status])}</p>

          {receipt?.advice ? <Certifies receipt={receipt} /> : null}
          {status === 'authentic' ? <p className="verdict-note">{t('verify.authentic.note')}</p> : null}
          {status === 'authentic' && expired ? <p className="verdict-note">{t('verify.expired.note')}</p> : null}
          {sandbox ? <p className="verdict-note">{t('verify.sandbox.note')}</p> : null}
          {status === 'recalled' ? (
            <>
              {rules?.length ? <p className="verdict-rules mono">{t('verify.recalled.rules', { rules: rules.join(', ') })}</p> : null}
              <p className="verdict-note verdict-do">{t('verify.recalled.do')}</p>
              {reason ? (
                <p className="verdict-reason">
                  <span className="eyebrow">{t('verify.recalled.reason')}</span>
                  <span className="mono">{reason}</span>
                </p>
              ) : null}
            </>
          ) : null}
          {status === 'invalid' ? (
            <>
              <p className="verdict-note">{invalidWhy}</p>
              <p className="verdict-note">{t('verify.invalid.do')}</p>
            </>
          ) : null}
          {status === 'unreachable' ? <p className="verdict-note">{t('verify.unreachable.note')}</p> : null}
        </div>
      </div>
    </section>
  );
}

const LIGHT_TONE = { green: 'go', amber: 'wait', red: 'stop' } as const;

/**
 * "This receipt certifies the advice: ...": the signed advice text, its decision and light, the plan window and where the
 * weather came from. All of it is read from the verified credential (`credentialSubject.advice` and `.plan`).
 */
function Certifies({ receipt }: { receipt: Receipt }) {
  const { t, lang } = useI18n();
  const advice = receipt.advice!;
  const plan = receipt.plan;
  const title = pickText(advice.title, lang);
  const sig = advice.decision || advice.traffic_light ? signalOf(advice as unknown as Action) : null;
  return (
    <div className="verdict-certifies" data-testid="certifies">
      <p className="eyebrow">{t('verify.certifies')}</p>
      <p className="verdict-advice" lang={title.lang} data-testid="certifies-title">
        {title.text}
      </p>
      <p className="verdict-chips">
        {advice.decision && sig ? (
          <span className="chip" data-tone={LIGHT_TONE[sig.light]} data-testid="certifies-decision">
            {t(`decision.${advice.decision}` as Key)}
          </span>
        ) : null}
        {sig ? (
          <span className="chip" data-tone={LIGHT_TONE[sig.light]} data-testid="certifies-light">
            <span className="size-1.5 rounded-full bg-current" aria-hidden /> {t(`light.${sig.light}` as Key)}
          </span>
        ) : null}
      </p>
      {plan ? (
        <p className="verdict-window">
          <span className="inline-flex items-center gap-1.5">
            <CalendarRange size={13} aria-hidden />
            <span data-testid="certifies-window">{t('verify.certifies.window', { from: fmtDate(plan.valid_from, lang), to: fmtDate(plan.valid_to, lang) })}</span>
          </span>
          <DataAsOf asOf={plan.data_as_of} mode={plan.data_mode} className="verdict-asof" />
        </p>
      ) : null}
    </div>
  );
}
