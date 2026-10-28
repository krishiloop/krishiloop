import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronRight, FileQuestion, Lock, LockOpen, TriangleAlert } from 'lucide-react';
import { DataMark } from '../../ui/DataMark';
import { LinkButton } from '../../ui/Button';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { useMotionReduced } from '../../lib/motionPref';
import { apiStore } from '../../lib/api/client';
import { fetchReplay, useAreaStats } from '../../lib/api/trust';
import { REPLAY_DATASETS, shapeReplay, type ReplayModel, type ShapedReplay } from './replay';
import { POLICY_V1, type Policy } from './policy';
import { PHOTO_DEMO } from './labels';
import { PolicyBar } from './PolicyBar';
import { ReplayStage } from './ReplayStage';
import { AreaCards } from './AreaCards';
import { SandboxMeter } from './SandboxMeter';
import { blob } from '../proof/sources';
import './trust.css';

type View = { state: 'loading' } | { state: 'ready'; replay: ShapedReplay; bundled: boolean } | { state: 'missing' } | { state: 'error'; message: string };

const HERO_AREA = 'BD-D';
const Y_MIN = 0.5;
const toTrack = (lb: number) => Math.min(1, Math.max(0, (lb - Y_MIN) / (1 - Y_MIN)));

/**
 * /trust: earned trust for photo diagnosis (plan/EARNED_TRUST_DESIGN.md, rules/policy/photo-trust.yaml).
 *   1. the idea in one line, with a mini meter from the real replay;
 *   2. the bar: the policy's numbers, the three tiers, and what 0.85 asks for in right answers;
 *   3. the real replay of public datasets (live from the API, or the bundled copy of the same file), playable;
 *   4. one card per replayed area, which also picks the area to replay;
 *   5. this visitor's own sandbox meter;
 *   6. method and limits, behind "Show more".
 * Every number is the replay file's, the policy's, or the visitor's own sandbox: nothing is made up here.
 */
export default function TrustPage() {
  const { t, lang } = useI18n();
  const reduced = useMotionReduced();
  const [view, setView] = useState<View>({ state: 'loading' });
  const [selected, setSelected] = useState(HERO_AREA);
  const version = useAreaStats(PHOTO_DEMO.area)?.policy_version ?? 1;

  useEffect(() => {
    let alive = true;
    void fetchReplay().then((r) => {
      if (!alive) return;
      if (r.state === 'missing') return setView({ state: 'missing' });
      if (r.state === 'error') return setView({ state: 'error', message: r.message });
      const replay = shapeReplay(r.payload);
      setView(replay ? { state: 'ready', replay, bundled: r.state === 'sample' } : { state: 'error', message: 'no usable curves' });
    });
    return () => {
      alive = false;
    };
  }, []);

  const replay = view.state === 'ready' ? view.replay : null;
  const policy = replay?.policy ?? POLICY_V1;
  const model = replay ? (replay.areas.find((a) => a.key === selected) ?? replay.areas[0]!) : null;
  const hero = replay ? (replay.areas.find((a) => a.key === HERO_AREA) ?? replay.areas[0]!) : null;
  const forced = apiStore.use().forced;

  return (
    <div className="tp-page pb-8">
      {/* 1. the idea */}
      <section className="wrap pt-10 pb-14 sm:pt-16 sm:pb-20" aria-labelledby="tp-title">
        <div className="grid items-end gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
          <div>
            <p className="eyebrow hero-rise">{t('tp.eyebrow')}</p>
            <h1 id="tp-title" className="t-title hero-rise mt-4 max-w-[16ch]" style={{ ['--i' as string]: 1 }} data-testid="trust-title">
              {t('tp.title')}
            </h1>
            <p className="t-lead hero-rise mt-5 max-w-[46ch]" style={{ ['--i' as string]: 2 }}>
              {t('tp.lead')}
            </p>
          </div>
          <div className="hero-rise" style={{ ['--i' as string]: 3 }}>
            {hero ? <HeroMeter m={hero} policy={policy} play={!reduced} /> : view.state === 'loading' ? <div className="skeleton h-[212px] w-full" /> : null}
          </div>
        </div>
      </section>

      {/* 2. the bar */}
      <section className="rule-t" aria-labelledby="tp-bar">
        <div className="wrap section">
          <p className="eyebrow">{t('tp.policy.eyebrow')}</p>
          <h2 id="tp-bar" className="t-title mt-3 max-w-[20ch]">
            {t('tp.policy.title')}
          </h2>
          <div className="mt-10">
            <PolicyBar policy={policy} version={version} />
          </div>
        </div>
      </section>

      {/* 3 + 4. the replay and its areas */}
      <section className="rule-t bg-sunk" aria-labelledby="tp-replay" id="replay">
        <div className="wrap section">
          <div className="flex flex-wrap items-center gap-3">
            <p className="eyebrow m-0">{t('tp.replay.eyebrow')}</p>
            <DataMark kind="replay" />
            {view.state === 'ready' && view.bundled ? (
              <span className="chip chip-carbon" data-testid="replay-bundled">
                {forced ? t('tp.replay.bundled.forced') : t('tp.replay.bundled')}
              </span>
            ) : null}
          </div>
          <h2 id="tp-replay" className="t-title mt-3 max-w-[18ch]">
            {t('tp.replay.title')}
          </h2>
          <p className="mt-4 max-w-[60ch] text-ink-2" data-testid="replay-label">
            {t('tp.replay.label')}
          </p>

          <div className="paper mt-8 p-4 sm:p-6" data-testid="replay-panel">
            {model ? (
              <>
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="m-0 font-semibold">
                    <span className="mono mr-2 text-[0.8rem] font-medium text-ink-3">{model.key}</span>
                    {REPLAY_DATASETS[model.key] ?? model.key}
                  </p>
                  <p className="mono m-0 text-[0.75rem] text-ink-3">{t('tp.card.photos', { n: fmtNum(model.summary.photos, lang) })}</p>
                </div>
                <ReplayStage model={model} policy={policy} autoPlay={!reduced} />
              </>
            ) : view.state === 'loading' ? (
              <div aria-busy="true" data-testid="replay-loading">
                <div className="skeleton h-[300px] w-full" />
                <p className="sr-only-live" role="status">
                  {t('tp.replay.loading')}
                </p>
              </div>
            ) : view.state === 'missing' ? (
              <Empty icon={<FileQuestion size={22} aria-hidden />} text={t('tp.replay.missing')} testId="replay-missing" />
            ) : view.state === 'error' ? (
              <Empty icon={<TriangleAlert size={22} aria-hidden />} text={t('tp.replay.error')} testId="replay-error" alert />
            ) : null}
          </div>

          {replay ? (
            <div className="mt-10">
              <h3 className="t-head max-w-[24ch]">{t('tp.areas.title')}</h3>
              <p className="mt-2 max-w-[56ch] text-ink-2">{t('tp.areas.lead')}</p>
              <div className="mt-6">
                <AreaCards areas={replay.areas} policy={policy} selected={model?.key ?? selected} onSelect={setSelected} />
              </div>
              <p className="mt-5 max-w-[80ch] text-[0.82rem] text-ink-3">{t('tp.replay.credit', { backbone: replay.backbone === 'bioclip2' ? 'BioCLIP 2' : replay.backbone })}</p>
            </div>
          ) : null}
        </div>
      </section>

      {/* 5. this visitor's sandbox */}
      <section className="rule-t" aria-labelledby="tp-sb">
        <div className="wrap section">
          <p className="eyebrow">{t('tp.sb.eyebrow')}</p>
          <h2 id="tp-sb" className="t-title mt-3 max-w-[18ch]">
            {t('tp.sb.title')}
          </h2>
          <p className="t-lead mt-4 max-w-[50ch]">{t('tp.sb.lead')}</p>
          <div className="mt-8">
            <SandboxMeter />
          </div>
        </div>
      </section>

      {/* 6. method and limits */}
      <section className="rule-t" aria-label={t('tp.more')}>
        <div className="wrap py-10 sm:py-14">
          <details className="tp-more" data-testid="method">
            <summary>
              <ChevronRight size={18} className="tp-chev" aria-hidden />
              <span className="t-head">{t('tp.more')}</span>
            </summary>
            <div className="mt-6 grid gap-10 md:grid-cols-2">
              <div>
                <h3 className="eyebrow">{t('tp.m.title')}</h3>
                <ul className="tp-list mt-3">
                  {(['tp.m.1', 'tp.m.2', 'tp.m.3', 'tp.m.4'] as const).map((k) => (
                    <li key={k}>{t(k, { window: fmtNum(policy.window, lang), min: fmtNum(policy.minSure, lang) })}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="eyebrow">{t('tp.l.title')}</h3>
                <ul className="tp-list mt-3">
                  {(['tp.l.1', 'tp.l.2', 'tp.l.3', 'tp.l.4', 'tp.l.5'] as const).map((k) => (
                    <li key={k}>{t(k)}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[0.85rem]">
              <span className="text-ink-3">{t('tp.sources')}</span>
              {['ml/vision/MODEL_CARD.md', 'ml/vision/artifacts/area_trust_replay.json', 'ml/vision/artifacts/earned_trust_sim_v2_strict.json', 'rules/policy/photo-trust.yaml'].map((f) => (
                <a key={f} className="link mono text-[0.8rem]" href={blob(f)} target="_blank" rel="noreferrer">
                  {f}
                </a>
              ))}
            </p>
          </details>
          <div className="mt-8">
            <LinkButton to="/proof" variant="secondary" arrow>
              {t('tp.proofLink')}
            </LinkButton>
          </div>
        </div>
      </section>
    </div>
  );
}

/** The idea as an instrument: the real Savar replay's bound climbing through the bar, and the gate popping open. */
function HeroMeter({ m, policy, play }: { m: ReplayModel; policy: Policy; play: boolean }) {
  const { t, lang } = useI18n();
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const end = useMemo(() => [...m.points].reverse().find((p) => p.lb !== null)?.lb ?? null, [m]);
  const start = useMemo(() => m.points.find((p) => p.lb !== null)?.lb ?? null, [m]);
  if (end === null || start === null) return null;
  const open = m.openAt !== null;
  return (
    <figure className={`paper m-0 p-5 sm:p-6 ${play ? 'tp-hero-run' : ''}`} data-testid="hero-meter">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="mono text-[0.75rem] tracking-[0.06em] text-ink-3">
          {m.key} · {REPLAY_DATASETS[m.key] ?? m.key}
        </span>
        <DataMark kind="replay" />
      </figcaption>
      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="m-0 text-[0.85rem] text-ink-3">{t('tp.hero.bound')}</p>
          <p className="tp-big m-0 mt-1">{two(end)}</p>
        </div>
        <span className={`tp-lock tp-lock-pop ${open ? 'text-go' : 'text-ink-3'}`} aria-hidden>
          {open ? <LockOpen size={20} /> : <Lock size={20} />}
        </span>
      </div>
      <div className="tp-meter mt-4" role="img" aria-label={t('tp.hero.aria', { lb: two(end), bar: two(policy.openLb), n: fmtNum(m.openAt ?? 0, lang) })}>
        <div className="tp-track">
          <span className="tp-fill" data-open={open} style={{ ['--p' as string]: toTrack(end), ['--from' as string]: toTrack(start) } as CSSProperties} />
        </div>
        <span className="tp-notch" style={{ ['--x' as string]: toTrack(policy.openLb) } as CSSProperties} />
        <span className="tp-notch" data-kind="close" style={{ ['--x' as string]: toTrack(policy.closeLb) } as CSSProperties} />
      </div>
      <div className="mono relative mt-2 h-4 text-[0.7rem] text-ink-3" aria-hidden>
        <span className="absolute left-0">{two(Y_MIN)}</span>
        <span className="absolute -translate-x-1/2 font-semibold text-ink" style={{ left: `${toTrack(policy.openLb) * 100}%` }}>
          {two(policy.openLb)}
        </span>
        <span className="absolute right-0">{two(1)}</span>
      </div>
      <p className={`m-0 mt-4 font-semibold ${open ? 'text-go' : 'text-ink-2'}`}>{open ? t('tp.hero.open', { n: fmtNum(m.openAt!, lang) }) : t('tp.hero.never')}</p>
    </figure>
  );
}

function Empty({ icon, text, testId, alert }: { icon: ReactNode; text: string; testId: string; alert?: boolean }) {
  return (
    <div className="tp-notice" data-testid={testId} role={alert ? 'alert' : undefined}>
      <span className="mt-0.5 shrink-0 text-ink-3">{icon}</span>
      <p className="m-0">{text}</p>
    </div>
  );
}
