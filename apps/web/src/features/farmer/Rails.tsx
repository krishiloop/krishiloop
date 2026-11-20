import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Carrot, Check, Headset, Minus, RotateCcw, Sprout, Wheat, X } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum, LOCALES } from '../../lib/format';
import { cx } from '../../lib/cx';
import { motionReduced } from '../../lib/motionPref';
import { useApiState } from '../../lib/api/client';
import { DataMark } from '../../ui/DataMark';
import { TracingBeam } from '../../ui/kit/TracingBeam';
import { RECORDED_AT } from '../../data/recorded';
import { select, useFarmer } from './farmerStore';
import { cropName, countryName, profileLetter, profileSummary, profilesFor, stageName } from './words';
import { resetTried, tick, TRY_IDS, useTried, type TryId } from './checklist';
import { clearInspector, useInspector, useWorking, type InsEntry, type InsKind, type Part, type TraceNode, type TraceStep } from './inspector';
import { useHeld } from './receipts';
import type { TabId } from './TabBar';
import { OpenOnPhone } from '../mobile/OpenOnPhone'; // builder Mo: the phone app's QR and link, on the wide screen only

/* ================================================================== left rail: pick a field and a farmer, what to try */

const TRY_KEY: Record<TryId, Key> = {
  receipt: 'fa.try.receipt',
  ask: 'fa.try.ask',
  voice: 'fa.try.voice',
  photo: 'fa.try.photo',
  verify: 'fa.try.verify',
  recall: 'fa.try.recall',
};
const TRY_TAB: Partial<Record<TryId, TabId>> = { receipt: 'today', ask: 'ask', voice: 'ask', photo: 'photo' };

const CROP_ICON = { rice: Wheat, potato: Carrot } as const;
const CROP_TONE: Record<string, string> = { rice: 'moss', potato: 'terracotta' };

export function DemoRail({ onTab, inSheet }: { onTab: (t: TabId) => void; inSheet?: boolean }) {
  const { t, lang } = useI18n();
  const st = useFarmer();
  const api = useApiState();
  const tried = useTried();
  const held = useHeld();
  const latest = held.items[0]?.id;
  const profiles = profilesFor(st.fieldId, st.profiles);
  const recorded = api.forced || api.mode === 'sample' || st.planSource === 'sample';
  const done = TRY_IDS.filter((id) => tried[id]).length;
  const now = Date.now();

  return (
    <div className="fa-rail-grid grid gap-5" data-testid="fa-rail">
      <div className={cx(!inSheet && 'px-1')}>
        {!inSheet && (
          <>
            <p className="label">{t('fa.rail.eyebrow')}</p>
            <h2 className="t-head mt-2.5">{t('fa.rail.title')}</h2>
          </>
        )}
        <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-1', !inSheet && 'mt-3')} data-testid="fa-mode">
          {api.mode === 'unknown' && !recorded ? <span className="chip">{t('ui.api.checking')}</span> : recorded ? <DataMark kind="recorded" date={RECORDED_AT} /> : <DataMark kind="live" />}
          <span className="text-sm text-ink-2">{t('fa.rail.sub')}</span>
        </div>
        <p className="mt-1.5 text-[0.84rem] leading-snug text-ink-3">{recorded ? t('fa.rail.recorded') : t('fa.rail.live')}</p>
      </div>

      <section aria-labelledby="fa-rail-try" className="fa-card" data-tone="lotus">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="fa-rail-try" className="label">
            {t('fa.rail.try')}
          </h3>
          <span className="mono text-xs text-ink-3" aria-live="polite">
            {t('fa.rail.done', { n: fmtNum(done, lang), of: fmtNum(TRY_IDS.length, lang) })}
          </span>
        </div>
        <span className="fa-progress mt-2.5" aria-hidden>
          <span style={{ transform: `scaleX(${done / TRY_IDS.length})` }} />
        </span>
        <ol className="m-0 mt-2 grid list-none p-0" data-testid="fa-try">
          {TRY_IDS.map((id) => {
            const at = tried[id];
            const ok = !!at;
            const label = t(TRY_KEY[id]);
            const tab = TRY_TAB[id];
            return (
              <li key={id} className="fa-try" data-done={ok} data-just={ok && now - at! < 2500} data-testid={`fa-try-${id}`}>
                <span className="fa-try-tick" aria-hidden>
                  {ok && <Check size={13} strokeWidth={3} />}
                </span>
                <span className="sr-only-live">{ok ? t('fa.try.doneSr') : t('fa.try.todoSr')}</span>
                {tab ? (
                  <button type="button" className="fa-try-go" onClick={() => onTab(tab)}>
                    {label}
                  </button>
                ) : id === 'verify' ? (
                  latest ? (
                    <Link to={`/verify/${encodeURIComponent(latest.replace(/^urn:uuid:/, ''))}`} className="fa-try-go" onClick={() => tick('verify')}>
                      {label}
                      <ArrowRight size={15} aria-hidden />
                    </Link>
                  ) : (
                    <span className="fa-try-go" data-off="true">
                      {label}
                    </span>
                  )
                ) : (
                  <Link to="/officer?tab=recall" className="fa-try-go">
                    {label}
                    <ArrowRight size={15} aria-hidden />
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
        {done > 0 && (
          <button type="button" className="btn btn-ghost btn-sm fa-hit -ml-2 mt-1" onClick={resetTried}>
            <RotateCcw size={15} aria-hidden />
            {t('fa.try.reset')}
          </button>
        )}
      </section>

      <fieldset className="fa-fieldset m-0 grid gap-1.5 border-0 p-0" data-tone="moss">
        <legend className="label mb-2 px-1">{t('fa.rail.field')}</legend>
        {st.fields.length === 0 && <div className="skeleton h-28" />}
        {st.fields.map((f) => (
          <label key={f.field_id} className="fa-pick" data-checked={f.field_id === st.fieldId} data-tone={CROP_TONE[f.crop] ?? 'hyacinth'} title={f.field_id}>
            <input type="radio" name="fa-field" value={f.field_id} checked={f.field_id === st.fieldId} onChange={() => void select(f.field_id)} className="fa-pick-input" data-testid={`fa-field-${f.field_id}`} />
            <span className="fa-pick-ic" aria-hidden>
              {(() => {
                const Ic = CROP_ICON[f.crop as keyof typeof CROP_ICON] ?? Sprout;
                return <Ic size={17} strokeWidth={1.9} />;
              })()}
            </span>
            <span className="min-w-0 flex-1 truncate font-[560]">
              {cropName(f.crop, t)} · {stageName(f.stage, t)}
            </span>
            <span className="mono flex-none text-[0.7rem] text-ink-3">{countryName(f.country, lang)}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="fa-fieldset m-0 grid gap-1.5 border-0 p-0" data-tone="hyacinth">
        <legend className="label mb-2 px-1">{t('fa.rail.farmer')}</legend>
        {profiles.map((p) => {
          const s = profileSummary(p, t);
          return (
            <label key={p.farmer_profile_id} className="fa-pick" data-tone="hyacinth" data-checked={p.farmer_profile_id === st.profileId}>
              <input type="radio" name="fa-profile" value={p.farmer_profile_id} checked={p.farmer_profile_id === st.profileId} onChange={() => void select(st.fieldId, p.farmer_profile_id)} className="fa-pick-input" data-testid={`fa-profile-${p.farmer_profile_id}`} />
              <span className="fa-pick-ic fa-pick-av" aria-hidden>
                {profileLetter(p.farmer_profile_id)}
              </span>
              <span className="min-w-0">
                <span className="block leading-tight">
                  <span className="font-[560]">{t('fa.profile.name', { id: profileLetter(p.farmer_profile_id) })}</span>
                  <span className="text-ink-2"> · {s.line}</span>
                </span>
                {s.data && <span className="mono mt-0.5 block text-[0.7rem] text-ink-3">{s.data}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>

      {!inSheet && <OpenOnPhone compact />}
    </div>
  );
}

/* ================================================================== right rail, top: behind the tap */

const STEP_KEY: Record<TraceStep, Key> = {
  data: 'fa.tr.data',
  retrieval: 'fa.tr.retrieval',
  rule: 'fa.tr.rule',
  validator: 'fa.tr.validator',
  receipt: 'fa.tr.receipt',
  officer: 'fa.tr.officer',
  model: 'fa.tr.model',
  gate: 'fa.tr.gate',
  route: 'fa.tr.route',
  sig: 'fa.tr.sig',
  issuer: 'fa.tr.issuer',
  list: 'fa.tr.list',
  verdict: 'fa.tr.verdict',
  recall: 'fa.tr.recall',
  rebuilt: 'fa.tr.rebuilt',
  request: 'fa.tr.request',
};
const EVENT_KEY: Partial<Record<InsKind, Key>> = {
  plan: 'fa.tr.ev.plan',
  ask: 'fa.tr.ev.ask',
  photo: 'fa.tr.ev.photo',
  verify: 'fa.tr.ev.verify',
  recall: 'fa.tr.ev.recall',
  error: 'fa.tr.ev.error',
};
const STATE_KEY = { ok: 'fa.tr.s.ok', skip: 'fa.tr.s.skip', wait: 'fa.tr.s.wait', stop: 'fa.tr.s.stop' } as const;
/** before anything has happened: the answer path, unlit */
const IDLE: TraceNode[] = (['retrieval', 'rule', 'validator', 'receipt'] as const).map((step) => ({ step, v: [], s: 'skip' }));

/** Pacing for legibility only: the server already ran these steps; they light in the order it reported, 150 ms apart. */
const STEP_MS = 150;

/**
 * Behind the tap: the latest thing the app did, read as a path (retrieval, rule, validator, receipt; or the officer),
 * lit step by step in the order the answer reports. While the app waits, the panel says so. Only real values are shown:
 * rule ids, the validator version, the receipt's id and suite, the router's stages, the case number.
 */
export function TracePanel({ bodyRef }: { bodyRef?: React.Ref<HTMLDivElement> }) {
  const { t } = useI18n();
  const entries = useInspector();
  const st = useFarmer();
  const w = useWorking();
  const busy: InsKind | null = w ?? (st.status === 'loading' ? 'plan' : null);
  const latest = entries.find((e) => e.trace?.length) ?? null;
  const nodes = latest?.trace ?? IDLE;
  const [lit, setLit] = useState(latest ? nodes.length : 0);
  const shown = useRef(latest?.id ?? null);

  useEffect(() => {
    if (!latest || latest.id === shown.current) return;
    shown.current = latest.id;
    const n = latest.trace!.length;
    if (motionReduced()) {
      setLit(n);
      return;
    }
    setLit(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setLit(i);
      if (i >= n) window.clearInterval(id);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [latest]);

  const part = (p: Part) => (typeof p === 'string' ? p : t(p[0], p[1]));
  const end = nodes[Math.min(lit, nodes.length) - 1];
  const tone = !latest ? undefined : end?.s === 'wait' ? 'var(--color-wait)' : end?.s === 'stop' ? 'var(--color-ember)' : 'var(--color-sprout)';
  const kindKey = latest ? EVENT_KEY[latest.kind] : undefined;

  return (
    <section className="fa-trace" data-tone="monsoon" aria-labelledby="fa-trace-title" data-busy={busy ? '' : undefined} data-testid="fa-trace">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="fa-trace-title" className="label">
            {t('fa.tr.title')}
          </h2>
          <p className="mt-2 truncate text-[1.02rem] font-[560] leading-tight text-ink" aria-live="polite">
            {busy ? t('fa.tr.working', { what: t(EVENT_KEY[busy] ?? 'fa.tr.ev.plan') }) : kindKey ? t(kindKey) : t('fa.tr.idle')}
          </p>
        </div>
        {busy ? <span className="ping mt-1.5 flex-none" aria-hidden /> : latest?.recorded ? <DataMark kind="recorded" date={RECORDED_AT} className="flex-none" /> : null}
      </header>
      <div ref={bodyRef} className="mt-4">
        <TracingBeam at={latest ? Math.min(lit, nodes.length) - 1 : -1} tone={tone} x={17}>
          <ol className="fa-trace-list" key={latest?.id ?? 'idle'}>
            {nodes.map((n, i) => {
              const on = !!latest && i < lit;
              return (
                <li key={`${n.step}-${i}`} className="fa-trace-step" data-state={on ? n.s : 'idle'} data-step={n.step} style={{ '--i': i } as CSSProperties}>
                  {/* the step's number until it has run, then what happened to it (the word sits next to it) */}
                  <span className="fa-trace-dot" data-beam-stop aria-hidden>
                    {!on ? (
                      <span className="mono text-[0.72rem]">{i + 1}</span>
                    ) : n.s === 'ok' ? (
                      <Check size={15} strokeWidth={2.6} />
                    ) : n.s === 'wait' ? (
                      <Headset size={15} strokeWidth={2} />
                    ) : n.s === 'stop' ? (
                      <X size={15} strokeWidth={2.6} />
                    ) : (
                      <Minus size={15} strokeWidth={2.4} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="fa-trace-k">{t(STEP_KEY[n.step])}</span>
                      {on && <span className="fa-trace-s">{t(STATE_KEY[n.s])}</span>}
                    </span>
                    {n.v.length > 0 && <span className="fa-trace-v">{n.v.map(part).join(' · ')}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </TracingBeam>
      </div>
      <p className="mt-4 text-[0.78rem] leading-snug text-ink-3">{t('fa.tr.order')}</p>
    </section>
  );
}

/* ================================================================== right rail, below: the inspector */

const KIND_KEY: Record<InsKind, Key> = {
  boot: 'fa.ins.kind.boot',
  plan: 'fa.ins.kind.plan',
  ask: 'fa.ins.kind.ask',
  photo: 'fa.ins.kind.photo',
  verify: 'fa.ins.kind.verify',
  recall: 'fa.ins.kind.recall',
  error: 'fa.ins.kind.error',
};
const TONE = { go: 'text-go', wait: 'text-wait', stop: 'text-stop', carbon: 'text-carbon' } as const;

export function InspectorPanel() {
  const { t, lang } = useI18n();
  const entries = useInspector();
  const since = useRef(Date.now());
  const time = (at: number) => {
    try {
      return new Intl.DateTimeFormat(LOCALES[lang], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(at);
    } catch {
      return new Date(at).toISOString().slice(11, 19);
    }
  };
  const part = (p: Part) => (typeof p === 'string' ? p : t(p[0], p[1]));

  return (
    <section aria-labelledby="fa-ins-title" className="fa-ins" data-tone="butter" data-testid="fa-inspector">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="fa-ins-title" className="label">
            {t('fa.ins.title')}
          </h2>
          <p className="mt-1.5 text-sm text-ink-2">{t('fa.ins.sub')}</p>
        </div>
        {entries.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm fa-hit -mr-2 flex-none" onClick={clearInspector}>
            {t('fa.ins.clear')}
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-ink-3">{t('fa.ins.empty')}</p>
      ) : (
        <ol className="m-0 mt-3 grid list-none p-0">
          {entries.map((e: InsEntry) => (
            <li key={e.id} className={cx('fa-ins-entry', e.at >= since.current && 'is-new')} data-kind={e.kind} data-testid="fa-ins-entry">
              <div className="flex items-center justify-between gap-2">
                <span className="fa-ins-kind" data-kind={e.kind}>{t(KIND_KEY[e.kind])}</span>
                <span className="flex items-center gap-2">
                  {e.recorded && <span className="mono text-[0.68rem] text-carbon">{t('fa.ins.recorded')}</span>}
                  <time className="mono text-[0.7rem] text-ink-3" dateTime={new Date(e.at).toISOString()}>
                    {time(e.at)}
                  </time>
                </span>
              </div>
              <p className="mono mt-1 break-all text-[0.72rem] text-ink-2">{e.req}</p>
              <dl className="fa-ins-lines">
                {e.lines.map((l, i) => (
                  <div key={i} className="contents">
                    <dt>{t(l.k)}</dt>
                    <dd className={cx(l.tone && TONE[l.tone])}>{l.v.map(part).join(' · ')}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
