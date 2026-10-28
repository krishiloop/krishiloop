import { useRef, type ChangeEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Camera, Check, CircleDashed, Hand, Image as ImageIcon, Lock, RotateCcw, Send, ServerOff, ShieldCheck, Sprout, WifiOff } from 'lucide-react';
import { useAreaPhoto, type Phase, type PlanState } from './useAreaPhoto';
import { ActionList } from '../ActionList';
import { AreaMeter } from '../../trust/AreaMeter';
import { areaLabelName } from '../../trust/labels';
import { meterView } from '../../trust/gate';
import { useI18n } from '../../../lib/i18n';
import { fmtNum, humanize } from '../../../lib/format';
import type { AreaStats } from '../../../lib/api/types';
import type { PhotoErrorKind } from '../../../lib/api/trust';
import { cx } from '../../../lib/cx';

const ERROR_KEY = {
  unavailable: 'trust.farmer.unavailable.body',
  unreadable: 'trust.farmer.unreadable',
  prepare: 'trust.farmer.unreadable',
  rate: 'trust.farmer.rate',
  judged: 'trust.farmer.other',
  offline: 'trust.farmer.offline',
  other: 'trust.farmer.other',
} as const satisfies Record<PhotoErrorKind | 'prepare', string>;

/**
 * The leaf photo check, server path. A photo model never earns trust everywhere: in this area (crop at place) it must earn
 * it from the officer's answers first. So the farmer's photo is read on the server, its suggestion is frozen before any
 * officer answers, and:
 *   - gate closed (or the suggestion is not sure): "Not sure yet in your area. Sent to your officer." plus the area meter.
 *     The unverified suggestion is never shown to the farmer as an answer.
 *   - gate open and sure: "Looks like <label>", why it can be trusted here (officer answers, precision, the lower bound
 *     against the bar, a link to verify the area's credential), and the plan with the receipted photo practice.
 * The photo is downscaled to 1024 px in the browser; the officer sees it only if the farmer switched sharing on.
 */
export function AreaPhotoCard({ fieldId, profileId, area, crop, onUseDevice }: { fieldId: string; profileId: string; area: string; crop: string; onUseDevice: () => void }) {
  const { t } = useI18n();
  const s = useAreaPhoto({ fieldId, profileId, area });
  const take = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const { phase } = s;
  const busy = phase.k === 'preparing' || phase.k === 'sending';

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    void s.pick(e.currentTarget.files?.[0]);
    e.currentTarget.value = '';
  };

  return (
    <section id="photo" className="photo surface surface-pad" aria-labelledby="photo-t" data-testid="photo-card" data-engine="area" data-path="area" data-phase={phase.k} data-crop={crop}>
      <div className="photo-head">
        <h2 id="photo-t" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Camera size={18} className="text-sun" aria-hidden /> {t('photo.title')}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="chip" title={t('photo.crop.tip')} data-testid="photo-crop">
            <Sprout size={12} aria-hidden /> {humanize(crop)}
          </span>
          <span className="chip" data-tone="sun" data-testid="area-chip">
            <ShieldCheck size={12} aria-hidden /> {t('trust.chip.area')}
          </span>
        </div>
      </div>

      {s.support === 'unknown' || s.support === 'unavailable' ? (
        <div className="mt-4" aria-busy="true" data-testid="area-checking">
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton mt-3 h-12 w-full" />
          <p className="sr-only" role="status">
            {t('trust.farmer.checking')}
          </p>
        </div>
      ) : s.support === 'offline' ? (
        <div className="ap-note" role="alert" data-testid="area-offline">
          <WifiOff size={20} aria-hidden />
          <div>
            <p className="ap-note-title">{t('trust.farmer.offline')}</p>
            <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={s.retryProbe}>
              <RotateCcw size={15} aria-hidden /> {t('common.retry')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {phase.k === 'idle' || phase.k === 'preparing' ? (
            <>
              <p className="ap-lead">{t('trust.farmer.lead', { area })}</p>
              <AreaMeter area={area} stats={s.stats} compact className="ap-meter" />
              <div className="photo-actions ap-pick">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => take.current?.click()} data-testid="area-take">
                  <Camera size={17} aria-hidden /> {t('photo.take')}
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => pick.current?.click()} data-testid="area-choose">
                  <ImageIcon size={17} aria-hidden /> {t('photo.choose')}
                </button>
              </div>
              <p className="ap-privacy" data-testid="area-privacy">
                <Lock size={14} aria-hidden /> {t('trust.farmer.privacy')}
              </p>
              {phase.k === 'preparing' ? (
                <p className="photo-busy" role="status">
                  <span className="spinner" aria-hidden /> {t('photo.analyzing')}
                </p>
              ) : null}
            </>
          ) : null}

          {phase.k === 'picked' || phase.k === 'sending' || (phase.k === 'error' && phase.shot) ? (
            <Composer phase={phase} consent={s.consent} onConsent={s.setConsent} onSend={() => void s.send()} onAnother={() => pick.current?.click()} />
          ) : null}

          {phase.k === 'officer' ? (
            <div className="ap-result" data-testid="area-result" data-route="officer">
              <div className="photo-outcome" data-o="unsure" data-testid="photo-outcome">
                <Hand size={22} strokeWidth={1.6} aria-hidden />
                <div>
                  <p className="photo-outcome-title" data-testid="area-officer-title">
                    {t('trust.farmer.officer.title')}
                  </p>
                  <p className="m-0 mt-1 text-sm text-chrome">{phase.shared ? t('trust.farmer.officer.shared') : t('trust.farmer.officer.unshared')}</p>
                </div>
              </div>
              <AreaMeter area={area} stats={s.stats} compact />
              <p className="ap-case">
                <span>{t('trust.farmer.officer.case')}</span>
                <span className="chip chip-mono" data-testid="photo-case">
                  {phase.caseId}
                </span>
                <Link to={`/officer/${encodeURIComponent(phase.caseId)}`} className="link inline-flex items-center gap-1" data-testid="area-open-officer">
                  {t('trust.farmer.officer.open')} <ArrowRight size={13} aria-hidden />
                </Link>
              </p>
              <p className="m-0 text-sm text-dim">{t('trust.farmer.officer.demo')}</p>
              <div>
                <button type="button" className="btn btn-quiet btn-sm" onClick={s.reset} data-testid="area-again">
                  <RotateCcw size={14} aria-hidden /> {t('trust.farmer.more')}
                </button>
              </div>
            </div>
          ) : null}

          {phase.k === 'auto' ? <AutoResult phase={phase} area={area} stats={s.stats} onRetry={s.retryPlan} onAgain={s.reset} /> : null}

          {phase.k === 'error' ? (
            <div className="photo-error ap-error" role="alert" data-testid="area-error" data-error={phase.error}>
              <p className="m-0">{t(ERROR_KEY[phase.error])}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {phase.shot ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void s.send()}>
                    <RotateCcw size={15} aria-hidden /> {t('common.retry')}
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={s.reset}>
                    <RotateCcw size={15} aria-hidden /> {t('trust.farmer.more')}
                  </button>
                )}
              </div>
            </div>
          ) : null}

          <div className="ap-foot">
            <button type="button" className="btn btn-quiet btn-sm" onClick={onUseDevice} disabled={phase.k === 'sending'} data-testid="area-use-device">
              <ServerOff size={14} aria-hidden /> {t('trust.farmer.useDevice')}
            </button>
          </div>
        </>
      )}

      <input ref={take} type="file" accept="image/*" capture="environment" hidden onChange={onFile} data-testid="area-take-input" />
      <input ref={pick} type="file" accept="image/*" hidden onChange={onFile} data-testid="area-photo-input" />
      <p className="sr-only" role="status" data-testid="photo-announce">
        {s.announce}
      </p>
    </section>
  );
}

/** The photo, the consent switch and the send button: consent is decided at the moment of sending, never remembered. */
function Composer({ phase, consent, onConsent, onSend, onAnother }: { phase: Extract<Phase, { k: 'picked' | 'sending' | 'error' }>; consent: boolean; onConsent: (v: boolean) => void; onSend: () => void; onAnother: () => void }) {
  const { t } = useI18n();
  const sending = phase.k === 'sending';
  const shot = phase.shot;
  if (!shot) return null;
  return (
    <div className="ap-picked" data-testid="area-composer">
      <figure className="ap-preview">
        <div className="pc" data-scan={sending}>
          <img src={shot.url} alt={t('trust.farmer.preview')} />
        </div>
        <figcaption className="photo-cap">{t('trust.farmer.preview')}</figcaption>
      </figure>
      <div className="ap-form">
        <label className="ap-consent">
          <input type="checkbox" role="switch" className="ap-switch" checked={consent} onChange={(e) => onConsent(e.currentTarget.checked)} disabled={sending} data-testid="area-consent" />
          <span className="ap-consent-text">
            <strong>{t('trust.farmer.consent')}</strong>
            <span data-testid="area-consent-note">{consent ? t('trust.farmer.consent.on') : t('trust.farmer.consent.off')}</span>
          </span>
        </label>
        <p className="ap-privacy">
          <Lock size={14} aria-hidden /> {t('trust.farmer.privacy')}
        </p>
        {sending ? (
          <p className="ap-sending" role="status" data-testid="area-sending">
            <span className="spinner" aria-hidden /> {t('trust.farmer.sending')}
          </p>
        ) : (
          <div className="ap-actions">
            <button type="button" className="btn btn-primary" onClick={onSend} data-testid="area-send">
              <Send size={16} aria-hidden /> {t('trust.farmer.send')}
            </button>
            <button type="button" className="btn btn-quiet" onClick={onAnother} data-testid="area-another">
              <ImageIcon size={16} aria-hidden /> {t('trust.farmer.another')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AutoResult({ phase, area, stats, onRetry, onAgain }: { phase: Extract<Phase, { k: 'auto' }>; area: string; stats: AreaStats | null; onRetry: () => void; onAgain: () => void }) {
  const { t, lang } = useI18n();
  const label = areaLabelName(phase.label, t);
  const m = meterView(stats);
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n: number) => `${fmtNum(Math.round(n * 100), lang)}%`;
  return (
    <div className="ap-result" data-testid="area-result" data-route="auto" data-label={phase.label}>
      <div className="photo-outcome" data-o="hint" data-testid="photo-outcome">
        <Check size={22} strokeWidth={2} aria-hidden />
        <div>
          <p className="photo-outcome-title" data-testid="area-label">
            {t('trust.farmer.auto.title', { label })}
          </p>
          <p className="photo-outcome-sub">{t('trust.farmer.auto.sub', { area })}</p>
        </div>
      </div>

      {stats ? (
        <section className="ap-why" aria-labelledby="ap-why-t" data-testid="area-why">
          <h3 id="ap-why-t">{t('trust.farmer.why')}</h3>
          <dl className="ap-why-stats">
            <div>
              <dt>{t('trust.farmer.why.checks')}</dt>
              <dd className="tabular" data-testid="why-checks">
                {fmtNum(m.verdicts, lang)}
              </dd>
            </div>
            <div>
              <dt>{t('trust.farmer.why.precision')}</dt>
              <dd className="tabular" data-testid="why-precision">
                {m.precision === null ? '—' : pct(m.precision)}
              </dd>
            </div>
            <div>
              <dt>{t('trust.farmer.why.bound')}</dt>
              <dd className="tabular" data-testid="why-bound">
                {two(m.lowerBound)}
                <small>{t('trust.farmer.why.barOf', { bar: two(m.bar) })}</small>
              </dd>
            </div>
          </dl>
          <p>{t('trust.farmer.why.body', { area, n: fmtNum(m.sure, lang), pct: m.precision === null ? '—' : pct(m.precision), lb: two(m.lowerBound), bar: two(m.bar) })}</p>
          <p className="ap-links">
            {stats.trust_credential_id ? (
              <Link to={`/verify/${encodeURIComponent(stats.trust_credential_id)}`} className="link inline-flex items-center gap-1" data-testid="area-verify-link">
                {t('trust.farmer.why.verify')} <ArrowRight size={13} aria-hidden />
              </Link>
            ) : null}
            <Link to="/trust" className="link inline-flex items-center gap-1">
              {t('trust.farmer.why.how')} <ArrowRight size={13} aria-hidden />
            </Link>
          </p>
        </section>
      ) : null}

      <PlanSection plan={phase.plan} onRetry={onRetry} />

      <div>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onAgain} data-testid="area-again">
          <RotateCcw size={14} aria-hidden /> {t('trust.farmer.more')}
        </button>
      </div>
    </div>
  );
}

function PlanSection({ plan, onRetry }: { plan: PlanState; onRetry: () => void }) {
  const { t } = useI18n();
  if (plan.state === 'loading') {
    return (
      <p className="photo-busy m-0" role="status" data-testid="area-plan-loading">
        <span className="spinner" aria-hidden /> {t('trust.farmer.plan.loading')}
      </p>
    );
  }
  if (plan.state === 'ready') {
    return (
      <section className="photo-decision m-0" aria-labelledby="ap-plan-t" data-testid="area-plan" data-state="ready">
        <div className="ap-plan-head">
          <h3 id="ap-plan-t" className="photo-decision-h">
            {t('trust.farmer.plan.title')}
          </h3>
          <span className="chip" data-tone="sun" data-testid="area-plan-badge">
            <Camera size={12} aria-hidden /> {t('trust.farmer.plan.fromPhoto')}
          </span>
        </div>
        <ActionList actions={plan.actions} source="live" />
      </section>
    );
  }
  const body: ReactNode =
    plan.state === 'unused' ? (
      <>
        <p className="ap-note-title">{t('trust.farmer.plan.unused.title')}</p>
        <p className="ap-note-body">{t('trust.farmer.plan.unused.body', { label: areaLabelName(plan.label, t) })}</p>
      </>
    ) : plan.state === 'withdrawn' ? (
      <p className="ap-note-title">{t('trust.farmer.plan.withdrawn')}</p>
    ) : plan.state === 'offline' ? (
      <p className="ap-note-title">{t('trust.farmer.plan.offline')}</p>
    ) : (
      <>
        <p className="ap-note-title">{t('trust.farmer.plan.failed')}</p>
        <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={onRetry}>
          <RotateCcw size={15} aria-hidden /> {t('common.retry')}
        </button>
      </>
    );
  return (
    <div className={cx('ap-note', 'm-0')} data-testid="area-plan" data-state={plan.state} role={plan.state === 'failed' ? 'alert' : undefined}>
      <CircleDashed size={20} aria-hidden />
      <div>{body}</div>
    </div>
  );
}
