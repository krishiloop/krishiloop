import { useEffect, useRef, useState } from 'react';
import { RefreshCw, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { init, loadPlan, selectField, selectProfile, useFarmer, chooseSource } from './farmerStore';
import { Signal } from './Signal';
import { ActionList } from './ActionList';
import { MoneySaved } from './MoneySaved';
import { FieldCard } from './FieldCard';
import { WeatherCalendar } from './WeatherCalendar';
import { WhyPanel } from './WhyPanel';
import { DataAsOf } from './DataAsOf';
import { Abstention } from './Abstention';
import { VoiceFab, VoiceSheet } from './VoiceSheet';
import { DemoSheet } from './DemoSheet';
import { PhotoHint } from './photo/PhotoHint';
import { ModeBanner, DataBadge } from '../../components/shell/Controls';
import { SampleBadge } from '../../components/ui/Badges';
import { useI18n } from '../../lib/i18n';
import { useMotionReduced } from '../../lib/motionPref';
import { fmtDate, humanize } from '../../lib/format';
import type { Plan } from '../../lib/api/types';

const farmerLabel = (profileId: string) => `Demo farmer ${profileId.split('-').at(-1)!.toUpperCase()}`;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function FarmerApp() {
  const { t } = useI18n();
  const st = useFarmer();
  const [day, setDay] = useState<number | null>(null);
  const [voice, setVoice] = useState(false);
  const [demo, setDemo] = useState(false);

  const reduced = useMotionReduced();
  // /app#photo (the status board links here): bring the photo card into view once the plan is on screen
  const photoLink = useRef(typeof window !== 'undefined' && window.location.hash === '#photo');

  useEffect(() => {
    void init();
  }, []);

  const field = st.fields.find((f) => f.field_id === st.fieldId);
  const profile = st.profiles.find((p) => p.farmer_profile_id === st.profileId);
  const plan = st.plan;
  const decision = plan?.actions?.find((a) => a.kind === 'input_decision') ?? plan?.actions?.[0];
  const money = plan?.actions?.map((a) => a.money_impact).find(Boolean);
  const expired = !!plan && plan.valid_to < todayISO();
  useEffect(() => {
    if (!photoLink.current || st.status !== 'ready' || !st.plan) return;
    photoLink.current = false;
    requestAnimationFrame(() => document.getElementById('photo')?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }));
  }, [st.status, st.plan, reduced]);
  const planField = plan ? st.fields.find((f) => f.field_id === plan.field_id) : undefined;
  const photoCard = plan ? (
    <PhotoHint
      key={`${plan.field_id}/${plan.farmer_profile_id}`}
      fieldId={plan.field_id}
      profileId={plan.farmer_profile_id}
      crop={planField?.crop}
      farmerLabel={farmerLabel(plan.farmer_profile_id)}
    />
  ) : null;
  const days = st.snapshot?.forecast?.days ?? [];
  const todayIdx = Math.max(0, days.findIndex((d) => d.date === todayISO()));
  const selectedDay = day ?? todayIdx;

  return (
    <div className="farmer mx-auto max-w-[1180px] px-4 pt-6 pb-36 sm:px-6 sm:pt-10">
      <header className="farmer-head">
        <div>
          <p className="eyebrow">KrishiLoop · {t('nav.app')}</p>
          <h1 className="mt-2 text-h1 font-medium tracking-tight">{t('app.title')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DataBadge className="lg:hidden" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDemo(true)} data-testid="demo-open">
            <SlidersHorizontal size={15} aria-hidden /> {t('demo.open')}
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void loadPlan({ force: true })} disabled={st.status === 'loading'} aria-label={t('app.refresh')} title={t('app.refresh')}>
            <RefreshCw size={15} aria-hidden className={st.status === 'loading' ? 'animate-spin' : undefined} />
            <span className="hidden sm:inline">{t('app.refresh')}</span>
          </button>
        </div>
      </header>

      {st.fields.length ? (
        <div className="farmer-context surface" role="group" aria-label={`${t('app.field')}, ${t('app.farmer')}`}>
          <label className="ctx-item">
            <span className="field-label">{t('app.field')}</span>
            <select className="select" value={st.fieldId ?? ''} onChange={(e) => selectField(e.target.value)} data-testid="field-select">
              {st.fields.map((f) => (
                <option key={f.field_id} value={f.field_id}>
                  {f.field_id} · {humanize(f.crop)}
                </option>
              ))}
            </select>
          </label>
          <label className="ctx-item">
            <span className="field-label">{t('app.farmer')}</span>
            <select className="select" value={st.profileId ?? ''} onChange={(e) => selectProfile(e.target.value)} data-testid="profile-select">
              {st.profiles.map((p) => (
                <option key={p.farmer_profile_id} value={p.farmer_profile_id}>
                  {t('app.demoFarmer', { id: p.farmer_profile_id.split('-').at(-1)!.toUpperCase() })}
                </option>
              ))}
            </select>
          </label>
          <div className="ctx-chips">
            {profile ? (
              <>
                <span className="chip">{profile.crop_protected ? t('app.protectedYes') : t('app.protectedNo')}</span>
                <span className="chip">{t('app.drainage', { value: profile.soil_drainage })}</span>
              </>
            ) : null}
            {field?.precision === 'sample_location' ? <SampleBadge label={t('app.sampleField')} className="chip-wrap" /> : null}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <ModeBanner />
      </div>

      {st.status === 'loading' && !plan ? <Loading /> : null}
      {st.status === 'error' ? <ErrorState message={st.error} /> : null}

      {plan ? (
        <>
          {st.status === 'loading' ? <p className="sr-only-live" role="status">{t('common.loading')}</p> : null}
          <div className="farmer-grid" data-busy={st.status === 'loading'}>
            <div className="farmer-main">
              {plan.status === 'abstained' && plan.abstention ? (
                <>
                  <Abstention plan={plan} field={field} source={st.planSource} />
                  {photoCard}
                </>
              ) : decision ? (
                <>
                  <Signal plan={plan} action={decision} source={st.planSource} />
                  {money ? <MoneySaved impact={money} /> : null}
                  {photoCard}
                  <section id="receipts" aria-labelledby="actions-t" className="scroll-mt-24">
                    <h2 id="actions-t" className="mb-5 text-h3 font-semibold tracking-tight">
                      {t('actions.title')}
                    </h2>
                    <ActionList actions={plan.actions ?? []} source={st.planSource} />
                  </section>
                </>
              ) : null}
            </div>

            <aside className="farmer-side" aria-label={t('field.title')}>
              {field ? <FieldCard field={field} snapshot={st.snapshot} /> : null}
              <WeatherCalendar snapshot={st.snapshot} selected={selectedDay} onSelect={setDay} />
              <WhyPanel plan={plan} snapshot={st.snapshot} />
            </aside>
          </div>

          <Provenance plan={plan} cachedAt={st.cached ? st.planAt : null} expired={expired} sample={st.planSource === 'sample'} />
        </>
      ) : null}

      {!plan && st.status === 'ready' ? (
        <section className="surface surface-pad mt-6 text-center">
          <h2 className="text-h3 font-semibold">{t('state.empty.title')}</h2>
          <p className="mt-2 text-chrome">{t('state.empty.body')}</p>
        </section>
      ) : null}

      <VoiceFab onClick={() => setVoice(true)} />
      <VoiceSheet open={voice} onClose={() => setVoice(false)} />
      <DemoSheet open={demo} onClose={() => setDemo(false)} />
    </div>
  );
}

function Provenance({ plan, cachedAt, expired, sample }: { plan: Plan; cachedAt: number | null; expired: boolean; sample: boolean }) {
  const { t, lang } = useI18n();
  const gen = plan.actions?.[0]?.receipt.generated_by;
  return (
    <footer className="provenance">
      <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1">
        {sample ? <SampleBadge /> : null}
        <span>
          {t('app.planFor', { from: fmtDate(plan.valid_from, lang), to: fmtDate(plan.valid_to, lang) })}
        </span>
        <span>{cachedAt ? t('app.cachedAt', { when: fmtDate(new Date(cachedAt), lang, 'datetime') }) : t('app.builtAt', { when: fmtDate(plan.generated_at, lang, 'datetime') })}</span>
        <DataAsOf asOf={plan.data_as_of} mode={plan.data_mode} />
        {expired ? (
          <span className="chip" data-tone="wait">
            <TriangleAlert size={12} aria-hidden /> {t('app.expired')}
          </span>
        ) : null}
      </p>
      <p className="m-0 mt-1 font-mono text-[0.7rem] break-all text-dim">
        plan {plan.plan_id} · snapshot {plan.snapshot_id}
        {gen ? ` · planner ${gen.planner_version} · validator ${gen.validator_version}` : ''}
      </p>
    </footer>
  );
}

function Loading() {
  const { t } = useI18n();
  const steps = ['state.loading.1', 'state.loading.2', 'state.loading.3', 'state.loading.4'] as const;
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), 1400);
    return () => window.clearInterval(id);
  }, [steps.length]);
  return (
    <div className="farmer-grid mt-2" aria-busy="true" data-testid="loading">
      <div className="farmer-main">
        <div className="surface surface-pad">
          <p className="eyebrow !text-chrome flex items-center gap-2" role="status">
            <span className="spinner" aria-hidden /> {t(steps[i]!)}
          </p>
          <div className="mt-5 flex gap-5">
            <div className="skeleton h-[212px] w-[92px] flex-none rounded-[46px]" />
            <div className="grid flex-1 content-start gap-3">
              <div className="skeleton h-14 w-3/4" />
              <div className="skeleton h-5 w-1/2" />
              <div className="skeleton h-16 w-full" />
            </div>
          </div>
        </div>
        <div className="skeleton h-72 w-full rounded-3xl" />
      </div>
      <div className="farmer-side">
        <div className="skeleton h-72 w-full rounded-3xl" />
        <div className="skeleton h-56 w-full rounded-3xl" />
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string | null }) {
  const { t } = useI18n();
  return (
    <section className="surface surface-pad mt-6" role="alert" data-testid="error-state">
      <h2 className="text-h3 font-semibold tracking-tight">{t('state.error.title')}</h2>
      <p className="mt-2 text-chrome">{t('state.error.body')}</p>
      {message ? <p className="mt-3 rounded-xl bg-bone/5 p-3 font-mono text-xs break-all text-dim">{message}</p> : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void loadPlan({ force: true })}>
          <RefreshCw size={15} aria-hidden /> {t('common.retry')}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void chooseSource('sample')}>
          {t('state.useSample')}
        </button>
      </div>
    </section>
  );
}
