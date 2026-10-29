import { useEffect, useId, useRef, useState } from 'react';
import { Camera, ChevronDown, CircleHelp, Mic, ReceiptText, RefreshCw, RotateCcw, Square, UserRound, Volume2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { pickText } from '../../lib/format';
import { useInViewOnce } from '../../lib/hooks';
import { cx } from '../../lib/cx';
import type { Action, FieldSnapshot, Plan } from '../../lib/api/types';
import { DecisionCard } from '../../ui/DecisionCard';
import { KindIcon } from '../../ui/Pictogram';
import { Quote } from '../../ui/Quote';
import { WeatherStrip } from '../../ui/WeatherStrip';
import { DataAsOf } from '../../ui/DataAsOf';
import { toneOfLight } from '../../ui/Chip';
import { TONE_TILE } from '../../ui/Receipt';
import { readingLines, sourceLabel } from '../../ui/receiptView';
import { toast } from '../../ui/Toast';
import { init, loadPlan, useFarmer } from './farmerStore';
import { reasonText, todayISO } from './words';
import { readAloud, stopReading, type ReadResult } from './voice';
import type { ReceiptRef } from './ReceiptSheet';
import type { TabId } from './TabBar';
import { Handoff } from './Handoff';

/**
 * Today: this week's one decision (pictogram, word, the rule's own sentence, the receipt one tap away), at most two other
 * actions with their receipts, the 7-day forecast the plan used, and "Why this?" (rule, verbatim quote with page, the
 * numbers people set, the confidence basis). When the planner abstains: a calm hand-off to the officer, with the reason
 * in plain words and the case number.
 */
export function TodayTab({ onOpenReceipt, onTab }: { onOpenReceipt: (r: ReceiptRef) => void; onTab: (t: TabId) => void }) {
  const { t, lang } = useI18n();
  const st = useFarmer();

  if (st.boot === 'error') return <ErrorState message={st.error} onRetry={() => void init()} />;
  if (st.status === 'error' && !st.plan) return <ErrorState message={st.error} onRetry={() => void loadPlan({ force: true })} />;
  if (!st.plan) return <TodaySkeleton />;

  const plan = st.plan;
  const recorded = st.planSource === 'sample';
  const open = (a: Action) => onOpenReceipt({ receipt: a.receipt, credentialId: a.receipt_credential_id, recorded });
  const decision = plan.actions?.find((a) => a.kind === 'input_decision');
  const others = (plan.actions ?? []).filter((a) => a !== decision).slice(0, 2);
  const busy = st.status === 'loading';

  return (
    <div className={cx('fa-today grid gap-6 transition-opacity duration-200', busy && 'opacity-60')} aria-busy={busy} data-testid="fa-today">
      {busy && (
        <p className="sr-only-live" role="status">
          {t('ui.loading')}
        </p>
      )}
      {st.afterRecall && (
        <p className="fa-note" role="status" data-testid="fa-after-recall">
          <RotateCcw size={16} aria-hidden className="flex-none text-stop" />
          {t('fa.today.afterRecall')}
        </p>
      )}
      {st.photoCaseId && (
        <p className="fa-note" role="status">
          <Camera size={16} aria-hidden className="flex-none" />
          {plan.diagnosis_used ? t('fa.today.photoUsed') : t('fa.today.photoNotUsed')}
        </p>
      )}

      {plan.status === 'abstained' && plan.abstention ? (
        <Abstained plan={plan} onTab={onTab} />
      ) : decision ? (
        <div className="grid gap-3">
          <h2 className="sr-only-live">{t('fa.today.title')}</h2>
          <div key={plan.plan_id} className="fa-pop fa-arrive" data-testid="fa-decision">
            <DecisionCard action={decision} validTo={plan.valid_to} onOpenReceipt={() => open(decision)} />
          </div>
          <WhyThis action={decision} />
        </div>
      ) : null}

      {others.length > 0 && plan.status !== 'abstained' && (
        <section aria-labelledby="fa-also">
          <h2 id="fa-also" className="eyebrow">
            {t('fa.today.also')}
          </h2>
          <ul className="fa-stagger m-0 mt-3 grid list-none gap-2 p-0">
            {others.map((a, i) => {
              const title = pickText(a.title, lang);
              const tone = toneOfLight(a.traffic_light);
              return (
                <li key={a.action_id} style={{ ['--i' as string]: i }}>
                  <button type="button" className="fa-row" onClick={() => open(a)} data-testid="fa-action-row">
                    <span className={cx('grid size-11 flex-none place-items-center rounded-[10px]', TONE_TILE[tone])}>
                      <KindIcon kind={a.kind} size={22} />
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block text-xs font-semibold text-ink-3">{t(`ui.kind.${a.kind}`)}</span>
                      <span lang={title.lang} className="block leading-snug text-ink">
                        {title.text}
                      </span>
                    </span>
                    <span className="flex flex-none items-center gap-1 text-xs font-semibold text-ink-2">
                      <ReceiptText size={18} aria-hidden />
                      <span className="sr-only-live">{t('ui.receipt.open')}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Weather plan={plan} snapshot={st.snapshot} />
    </div>
  );
}

/* ------------------------------------------------------------------ hear it: the decision read aloud, in its own language */

function HearIt({ action }: { action: Action }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<ReadResult | 'idle'>('idle');
  useEffect(() => () => stopReading(), []);
  const title = pickText(action.title, lang);
  const word = action.decision ? t(`ui.decision.${action.decision}`) : t(`ui.kind.${action.kind}`);
  const go = async () => {
    if (state === 'speaking') {
      stopReading();
      setState('idle');
      return;
    }
    const r = await readAloud(`${word}. ${title.text}`, title.lang, () => setState('idle'));
    setState(r);
    if (r === 'no-voice') toast(t('fa.voice.noVoice', { lang: title.lang === 'bn' ? 'বাংলা' : title.lang.toUpperCase() }), { tone: 'info', ms: 4500 });
    if (r === 'unsupported') toast(t('fa.voice.noTts'), { tone: 'info', ms: 4500 });
  };
  return (
    <button type="button" className="fa-why-btn fa-hear flex-none" onClick={() => void go()} aria-pressed={state === 'speaking'} title={t('fa.today.hear')} data-testid="fa-hear">
      {state === 'speaking' ? <Square size={18} aria-hidden /> : <Volume2 size={20} aria-hidden />}
      {state === 'speaking' ? t('fa.rc.stop') : t('fa.today.hearShort')}
    </button>
  );
}

/* ------------------------------------------------------------------ why this? */

function firstSentence(s: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  return m ? m[1]! : s;
}

function WhyThis({ action }: { action: Action }) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const r = action.receipt;
  const rule = r.rule_refs[0];
  const source = r.sources[0];
  const params = r.reviewer_parameters ?? [];
  const lines = readingLines(r.data).filter((l) => l.label !== 'Question fingerprint');
  const basis = r.confidence.basis;
  const short = firstSentence(basis);

  return (
    <section className="fa-why" data-testid="fa-why">
      <div className="flex items-stretch">
        <button type="button" className="fa-why-btn flex-1" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          <CircleHelp size={19} aria-hidden />
          <span className="flex-1 text-left">{t('fa.why.title')}</span>
          <ChevronDown size={18} aria-hidden className={cx('transition-transform duration-200', open && 'rotate-180')} />
        </button>
        <span className="my-2.5 w-px flex-none bg-rule" aria-hidden />
        <HearIt action={action} />
      </div>
      {open && (
        <div id={id} className="fa-why-body">
          {rule && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="eyebrow">{t('ui.receipt.rule')}</span>
              <span className="mono text-ink">
                {rule.rule_id} v{rule.version}
              </span>
              <span className="chip">{t(`ui.review.${rule.review_level}`)}</span>
            </p>
          )}
          {source && <Quote source={source} lines={more ? undefined : 4} className="border-l-2 border-rule-2 pl-4" />}
          {params.length > 0 && (
            <div>
              <p className="eyebrow">{t('ui.receipt.set')}</p>
              <ul className="m-0 mt-1.5 grid list-none gap-1.5 p-0 text-sm">
                {params.map((p) => (
                  <li key={p.name}>
                    <span className="mono">
                      {p.name} = {p.value}
                      {p.unit ? ` ${p.unit}` : ''}
                    </span>
                    <span className="text-wait"> · {t('ui.receipt.notSource')}</span>
                    {more && (
                      <span lang="en" className="mt-0.5 block text-xs text-ink-3">
                        {p.note}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lines.length > 0 && (
            <div>
              <p className="eyebrow">{t('ui.receipt.data')}</p>
              <ul className="m-0 mt-1.5 grid list-none gap-1 p-0 text-sm">
                {lines.slice(0, more ? undefined : 2).map((l) => (
                  <li key={l.label}>
                    {l.label} <span className="mono">{l.value}</span> <span className="text-ink-3">· {sourceLabel(l.source)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="eyebrow">{t('ui.receipt.confidence')}</p>
            <p className="mt-1 text-sm">
              <span className="font-semibold">{t(`ui.conf.${r.confidence.level}`)}</span>
              <span className="text-ink-3"> · </span>
              <span lang="en" className="text-ink-2">
                {more ? basis : short}
              </span>
            </p>
          </div>
          {(basis !== short || params.length > 0 || lines.length > 2 || (source && source.quote.length > 160)) && (
            <button type="button" className="btn btn-ghost btn-sm fa-hit -ml-2 justify-self-start" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {more ? t('ui.less') : t('ui.more')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ the planner abstained */

function Abstained({ plan, onTab }: { plan: Plan; onTab: (t: TabId) => void }) {
  const { t } = useI18n();
  const ab = plan.abstention!;
  return (
    <section className="fa-wait" aria-labelledby="fa-abs-title" data-testid="fa-abstained">
      <div className="flex items-start gap-4 p-5">
        <span className="fa-wait-tile">
          <UserRound size={32} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="fa-abs-title" className="t-head">
            {t('fa.abs.title')}
          </h2>
          <p className="mt-1.5 text-[1.06rem] leading-snug">{t('fa.abs.sub')}</p>
        </div>
      </div>
      <Handoff />
      <dl className="m-0 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 border-t border-rule px-5 py-4 text-sm">
        <dt className="eyebrow pt-[3px]">{t('fa.abs.why')}</dt>
        <dd className="m-0" data-testid="fa-abs-reason">
          {reasonText(ab.reason_code, t)}
        </dd>
        <dt className="eyebrow pt-[3px]">{t('fa.abs.case')}</dt>
        <dd className="mono m-0 break-all text-ink-2" data-testid="fa-abs-case">
          {ab.inbox_item_id}
        </dd>
      </dl>
      <div className="grid grid-cols-2 gap-2 border-t border-rule p-3">
        <button type="button" className="btn btn-secondary fa-hit" onClick={() => onTab('ask')}>
          <Mic size={18} aria-hidden />
          {t('fa.abs.ask')}
        </button>
        <button type="button" className="btn btn-secondary fa-hit" onClick={() => onTab('photo')}>
          <Camera size={18} aria-hidden />
          {t('fa.abs.photo')}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the forecast behind the plan */

function Weather({ plan, snapshot }: { plan: Plan; snapshot: FieldSnapshot | null }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(ref, '0px 0px -6% 0px');
  const days = snapshot?.forecast?.days ?? [];
  return (
    <section aria-labelledby="fa-wx-title" data-testid="fa-weather">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="fa-wx-title" className="eyebrow">
          {t('ui.wx.title')}
        </h2>
        <DataAsOf mode={plan.data_mode} asOf={plan.data_as_of} source={snapshot?.forecast ? sourceLabel(snapshot.forecast.source) : undefined} />
      </div>
      {days.length ? (
        <div ref={ref} className={cx('fa-wx mt-3', seen && 'is-in')}>
          <WeatherStrip days={days} today={todayISO()} />
        </div>
      ) : (
        <p ref={ref} className="mt-3 text-sm text-ink-3">
          {t('fa.wx.none')}
        </p>
      )}
      {snapshot?.risk_basis && <p className="mt-2 text-xs leading-relaxed text-ink-3">{t('ui.wx.basis')}</p>}
    </section>
  );
}

/* ------------------------------------------------------------------ loading and errors */

function TodaySkeleton() {
  const { t } = useI18n();
  return (
    <div className="grid gap-6" aria-busy="true" data-testid="fa-loading">
      <p className="sr-only-live" role="status">
        {t('fa.today.loading')}
      </p>
      <div className="panel flex gap-4 p-5">
        <div className="skeleton size-[4.5rem] flex-none rounded-[14px]" />
        <div className="grid flex-1 content-start gap-2.5">
          <div className="skeleton h-7 w-2/3" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-4/5" />
        </div>
      </div>
      <div className="grid gap-2">
        <div className="skeleton h-16" />
        <div className="skeleton h-16" />
      </div>
      <div className="skeleton h-40" />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <section className="panel p-5" role="alert" data-testid="fa-error">
      <h2 className="t-head">{t('fa.err.title')}</h2>
      <p className="mt-2 text-ink-2">{t('fa.err.body')}</p>
      {message && <p className="mono mt-3 break-all rounded-[8px] bg-sunk p-3 text-xs text-ink-2">{message}</p>}
      <button type="button" className="btn btn-primary fa-hit mt-4" onClick={onRetry}>
        <RefreshCw size={17} aria-hidden />
        {t('ui.retry')}
      </button>
    </section>
  );
}
