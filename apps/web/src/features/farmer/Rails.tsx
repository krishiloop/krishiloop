import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, RotateCcw } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum, LOCALES } from '../../lib/format';
import { cx } from '../../lib/cx';
import { useApiState } from '../../lib/api/client';
import { DataMark } from '../../ui/DataMark';
import { RECORDED_AT } from '../../data/recorded';
import { select, useFarmer } from './farmerStore';
import { cropName, countryName, profileLetter, profileSummary, profilesFor, stageName } from './words';
import { resetTried, tick, TRY_IDS, useTried, type TryId } from './checklist';
import { clearInspector, useInspector, type InsEntry, type InsKind, type Part } from './inspector';
import { useHeld } from './receipts';
import type { TabId } from './TabBar';

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
    <div className="grid gap-6" data-testid="fa-rail">
      <div>
        {!inSheet && (
          <>
            <p className="eyebrow">{t('fa.rail.eyebrow')}</p>
            <h2 className="t-head mt-2">{t('fa.rail.title')}</h2>
          </>
        )}
        <div className={cx('flex flex-wrap items-center gap-x-2 gap-y-1', !inSheet && 'mt-2')} data-testid="fa-mode">
          {api.mode === 'unknown' && !recorded ? <span className="chip">{t('ui.api.checking')}</span> : recorded ? <DataMark kind="recorded" date={RECORDED_AT} /> : <DataMark kind="live" />}
          <span className="text-sm text-ink-2">{t('fa.rail.sub')}</span>
        </div>
        <p className="mt-1.5 text-sm leading-snug text-ink-3">{recorded ? t('fa.rail.recorded') : t('fa.rail.live')}</p>
      </div>

      <section aria-labelledby="fa-rail-try">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="fa-rail-try" className="eyebrow">
            {t('fa.rail.try')}
          </h3>
          <span className="mono text-xs text-ink-3" aria-live="polite">
            {t('fa.rail.done', { n: fmtNum(done, lang), of: fmtNum(TRY_IDS.length, lang) })}
          </span>
        </div>
        <ol className="m-0 mt-1.5 grid list-none p-0" data-testid="fa-try">
          {TRY_IDS.map((id) => {
            const at = tried[id];
            const ok = !!at;
            const label = t(TRY_KEY[id]);
            const tab = TRY_TAB[id];
            return (
              <li key={id} className="fa-try" data-done={ok} data-just={ok && now - at! < 2500} data-testid={`fa-try-${id}`}>
                <span className="fa-try-tick" aria-hidden>
                  {ok && <Check size={14} strokeWidth={3} />}
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

      <fieldset className="m-0 grid gap-1.5 border-0 p-0">
        <legend className="eyebrow mb-1.5">{t('fa.rail.field')}</legend>
        {st.fields.length === 0 && <div className="skeleton h-28" />}
        {st.fields.map((f) => (
          <label key={f.field_id} className="fa-pick" data-checked={f.field_id === st.fieldId} title={f.field_id}>
            <input type="radio" name="fa-field" value={f.field_id} checked={f.field_id === st.fieldId} onChange={() => void select(f.field_id)} className="fa-pick-input" data-testid={`fa-field-${f.field_id}`} />
            <span className="min-w-0 flex-1 truncate font-semibold">
              {cropName(f.crop, t)} · {stageName(f.stage, t)}
            </span>
            <span className="flex-none text-xs text-ink-3">{countryName(f.country, lang)}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="m-0 grid gap-1.5 border-0 p-0">
        <legend className="eyebrow mb-1.5">{t('fa.rail.farmer')}</legend>
        {profiles.map((p) => {
          const s = profileSummary(p, t);
          return (
            <label key={p.farmer_profile_id} className="fa-pick" data-checked={p.farmer_profile_id === st.profileId}>
              <input type="radio" name="fa-profile" value={p.farmer_profile_id} checked={p.farmer_profile_id === st.profileId} onChange={() => void select(st.fieldId, p.farmer_profile_id)} className="fa-pick-input" data-testid={`fa-profile-${p.farmer_profile_id}`} />
              <span className="min-w-0">
                <span className="block leading-tight">
                  <span className="font-semibold">{t('fa.profile.name', { id: profileLetter(p.farmer_profile_id) })}</span>
                  <span className="text-ink-2"> · {s.line}</span>
                </span>
                {s.data && <span className="mono mt-0.5 block text-[0.72rem] text-ink-3">{s.data}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}

/* ================================================================== right rail: the inspector */

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
    <section aria-labelledby="fa-ins-title" className="fa-ins" data-testid="fa-inspector">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="fa-ins-title" className="eyebrow">
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
        <ol className="m-0 mt-4 grid list-none gap-3 p-0">
          {entries.map((e: InsEntry) => (
            <li key={e.id} className={cx('fa-ins-entry', e.at >= since.current && 'is-new')} data-kind={e.kind} data-testid="fa-ins-entry">
              <div className="flex items-center justify-between gap-2">
                <span className="fa-ins-kind">{t(KIND_KEY[e.kind])}</span>
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
