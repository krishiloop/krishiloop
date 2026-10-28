import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Camera, Check, CircleHelp, Download, FlaskConical, Hand, Image as ImageIcon, Leaf, Lock, Plus, RotateCcw, ServerOff, ShieldCheck, Sprout, Trash2 } from 'lucide-react';
import { DEFAULT_SCENARIO, enginesFor, type Engine } from './engines';
import { OTHER, MAX_PHOTOS, topDisease, type Symptom } from './report';
import { SAMPLE_SCENARIOS, type SampleScenarioId } from './samplePacks';
import { PackLine } from '../PackLine';
import { DOWNLOAD_MB, getModelSha } from './photoModel';
import { usePhotoSession } from './usePhotoSession';
import { LayerToggle, PhotoCanvas } from './PhotoCanvas';
import { Differential } from './Differential';
import { SeverityMeter } from './SeverityMeter';
import { CitationSheet, SymptomChips } from './SymptomChips';
import { ViewRequestCard } from './ViewRequestCard';
import { DiagnosisReceipt } from './DiagnosisReceipt';
import { PhotoDecision } from './PhotoDecision';
import { AreaPhotoCard } from './AreaPhotoCard';
import { availableLayers, type OverlayLayer } from './overlay';
import { SampleBadge } from '../../../components/ui/Badges';
import { SERVER_PHOTO_CROPS } from '../../trust/labels';
import { useApiState } from '../../../lib/api/client';
import { photoSupport } from '../../../lib/api/trust';
import { useI18n, type Key } from '../../../lib/i18n';
import { fmtNum, humanize, pickText } from '../../../lib/format';
import { cx } from '../../../lib/cx';

export interface PhotoHintProps {
  fieldId: string;
  profileId: string;
  /** the field profile's crop: it picks the engine and the crop pack. Nothing in this flow is specific to one crop. */
  crop?: string;
  farmerLabel: string;
  /** the field's photo-trust area (crop@place). With it, a rice field in live mode offers the server's area check first. */
  area?: string;
}

const SCENARIO_KEY: Record<SampleScenarioId, Key> = { needs_view: 'photo.sample.s.needs_view', confident: 'photo.sample.s.confident', unsure: 'photo.sample.s.unsure' };

/**
 * Leaf photo check, the same flow for every crop (the crop comes from the field profile).
 *   photo -> engine -> differential + severity + lesion highlights + symptoms (each with its manual quote)
 *     sure enough      -> the diagnosis feeds the planner -> a receipted decision
 *     not sure         -> ONE targeted extra photo, with a picture and a reason; the differential then shifts
 *     still not sure   -> the officer gets the case
 *   every result carries a diagnosis receipt (model, tested on, time on this phone).
 * The photo never leaves the phone. Today the real engine reads rice only; the sample engine (labelled) shows the full
 * result for the crops that have a sample pack, until the KrishiLens model and crop packs arrive.
 */
export function PhotoHint(props: PhotoHintProps) {
  const crop = props.crop ?? '';
  const api = useApiState();
  const support = photoSupport.use();
  const { real, sample } = enginesFor(crop);
  const [preferSample, setPreferSample] = useState(false);
  const [scenario, setScenario] = useState<SampleScenarioId>(DEFAULT_SCENARIO);
  const [path, setPath] = useState<'area' | 'device'>('area');
  // The server's area check (earned trust per area) is offered for the crop its photo model reads, with the live API, and
  // until the server says it has no photo model. The on-device and sample flow below stays the fallback, unchanged.
  const offered = !!props.area && SERVER_PHOTO_CROPS.includes(crop) && !api.forced && api.mode !== 'sample';
  if (offered && props.area && path === 'area' && support !== 'unavailable') {
    return <AreaPhotoCard key={`${props.fieldId}/${props.profileId}`} fieldId={props.fieldId} profileId={props.profileId} area={props.area} crop={crop} onUseDevice={() => setPath('device')} />;
  }
  const banner: ReactNode = offered ? <DeviceBanner unavailable={support === 'unavailable'} onBack={() => setPath('area')} /> : null;
  const engine = (preferSample || !real ? sample : real) ?? real;
  if (!engine) return <NoPack crop={crop} />;
  return <PhotoCheck key={engine.info.id} {...props} crop={crop} engine={engine} canSwitch={!!real && !!sample} onSwitch={(toSample) => setPreferSample(toSample)} scenario={scenario} onScenario={setScenario} banner={banner} />;
}

/** Above the on-device flow when the area check was offered: a calm note when this server has no photo model, else a way back. */
function DeviceBanner({ unavailable, onBack }: { unavailable: boolean; onBack: () => void }) {
  const { t } = useI18n();
  if (unavailable) {
    return (
      <div className="ap-note" data-testid="area-unavailable">
        <ServerOff size={20} aria-hidden />
        <div>
          <p className="ap-note-title">{t('trust.farmer.unavailable.title')}</p>
          <p className="ap-note-body">{t('trust.farmer.unavailable.body')}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <button type="button" className="btn btn-quiet btn-sm" onClick={onBack} data-testid="device-use-area">
        <ShieldCheck size={14} aria-hidden /> {t('trust.farmer.useArea')}
      </button>
    </div>
  );
}

function NoPack({ crop }: { crop: string }) {
  const { t } = useI18n();
  return (
    <section id="photo" className="photo surface surface-pad" aria-labelledby="photo-t" data-testid="photo-card" data-engine="none">
      <h2 id="photo-t" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Camera size={18} className="text-sun" aria-hidden /> {t('photo.title')}
      </h2>
      <div className="photo-outcome" data-o="plain" data-testid="photo-nopack">
        <Sprout size={22} strokeWidth={1.6} aria-hidden />
        <div>
          <p className="photo-outcome-title">{t('photo.nopack.title', { crop: humanize(crop) })}</p>
          <p className="m-0 mt-1 text-sm text-chrome">{t('photo.nopack.body')}</p>
        </div>
      </div>
    </section>
  );
}

function PhotoCheck({
  fieldId,
  profileId,
  crop,
  farmerLabel,
  engine,
  canSwitch,
  onSwitch,
  scenario,
  onScenario,
  banner,
}: PhotoHintProps & { crop: string; engine: Engine; canSwitch: boolean; onSwitch: (toSample: boolean) => void; scenario: SampleScenarioId; onScenario: (s: SampleScenarioId) => void; banner?: ReactNode }) {
  const { t, lang } = useI18n();
  const s = usePhotoSession({ engine, scenario, fieldId, profileId, crop, farmerLabel });
  const { report, shots, active } = s;
  const [layers, setLayers] = useState<OverlayLayer[] | null>(null);
  const shown = layers ?? (availableLayers(shots[active]?.read?.overlay).filter((l) => l !== 'heat') as OverlayLayer[]);
  const [cite, setCite] = useState<Symptom | null>(null);
  const take = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const sample = engine.info.sample;

  useEffect(() => {
    if (refocus.current && !shots.length) {
      refocus.current = false;
      primary.current?.focus();
    }
  }, [shots.length]);

  const cur = shots[active];
  const hasShots = shots.length > 0;
  const pct = (p: number) => fmtNum(Math.round(p * 100), lang);
  const mb = (n: number) => fmtNum(n / 1_000_000, lang, { maximumFractionDigits: 1 });
  const best = report ? topDisease(report) : undefined;
  const named = report?.differential.filter((d) => d.id !== OTHER) ?? [];
  const nameOf = (d: { name: Record<string, string> }) => pickText(d.name, lang).text;
  const left = MAX_PHOTOS - shots.length;
  const startOver = () => {
    refocus.current = true;
    setLayers(null);
    s.startOver();
  };

  return (
    <section id="photo" className="photo surface surface-pad" aria-labelledby="photo-t" data-testid="photo-card" data-engine={engine.info.kind} data-verdict={report?.verdict} data-crop={crop}>
      <div className="photo-head">
        <h2 id="photo-t" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Camera size={18} className="text-sun" aria-hidden /> {t('photo.title')}
        </h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="chip" title={t('photo.crop.tip')} data-testid="photo-crop">
            <Sprout size={12} aria-hidden /> {humanize(crop)}
          </span>
          {sample ? (
            <SampleBadge />
          ) : (
            <span className="chip" data-tone="go">
              <ShieldCheck size={12} aria-hidden /> {t('photo.tag.onDevice')}
            </span>
          )}
        </div>
      </div>

      {banner}

      {canSwitch ? (
        <div className="photo-seg mt-3" role="group" aria-label={t('photo.engine.label')}>
          <button type="button" aria-pressed={!sample} onClick={() => onSwitch(false)} data-testid="photo-engine-real">
            {t('photo.engine.real')}
          </button>
          <button type="button" aria-pressed={sample} onClick={() => onSwitch(true)} data-testid="photo-engine-sample">
            {t('photo.engine.sample')}
          </button>
        </div>
      ) : null}

      {sample ? (
        <p className="photo-sample" data-testid="photo-sample-banner">
          <FlaskConical size={15} aria-hidden />
          <span>{t('photo.sample.banner')}</span>
        </p>
      ) : null}

      {!hasShots ? <p className="mt-3 mb-0 text-chrome">{t('photo.lead')}</p> : null}
      <p className="photo-privacy" data-testid="photo-privacy">
        <Lock size={14} aria-hidden /> {t('photo.stays')}
      </p>
      <PackLine crop={crop} className="pack-line mt-2" />

      {/* the real model is downloaded only when the farmer asks */}
      {s.stage === 'idle' ? (
        <div className="photo-model">
          <p className="m-0 text-sm text-chrome">{t('photo.model.notLoaded')}</p>
          <p className="m-0 mt-1 text-xs text-dim">{t('photo.model.size', { mb: fmtNum(DOWNLOAD_MB, lang) })}</p>
          <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => void s.download()} data-testid="photo-download">
            <Download size={15} aria-hidden /> {t('photo.model.get')}
          </button>
        </div>
      ) : null}
      {s.stage === 'downloading' ? (
        <div className="photo-model" aria-live="polite" data-testid="photo-progress">
          <p className="m-0 flex items-center gap-2 text-sm">
            <span className="spinner" aria-hidden />
            {!s.progress || s.progress.phase === 'starting' ? t('photo.model.starting') : s.progress.phase === 'runtime' ? t('photo.model.runtime') : t('photo.model.weights')}
          </p>
          {s.progress ? <progress className="photo-progress" max={1} value={s.progress.total ? s.progress.loaded / s.progress.total : 0} aria-label={t('photo.model.get')} /> : null}
          {s.progress && s.progress.phase !== 'starting' ? (
            <p className="m-0 mt-1 text-xs text-dim tabular">
              {mb(s.progress.loaded)} / {mb(s.progress.total)} MB
            </p>
          ) : null}
        </div>
      ) : null}

      {/* the first photo */}
      {!hasShots ? (
        <>
          {sample ? (
            <div className="photo-pick">
              <p className="eyebrow !text-chrome m-0" id="photo-pick-t">
                {t('photo.sample.pick')}
              </p>
              <div className="photo-seg" role="group" aria-labelledby="photo-pick-t">
                {SAMPLE_SCENARIOS.map((id) => (
                  <button key={id} type="button" aria-pressed={scenario === id} onClick={() => onScenario(id)} data-testid={`photo-scenario-${id}`}>
                    {t(SCENARIO_KEY[id])}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="photo-actions">
            {sample ? (
              <button ref={primary} type="button" className="btn btn-primary" disabled={!s.canAdd} onClick={() => void s.addSample()} data-testid="photo-sample-leaf">
                <Leaf size={17} aria-hidden /> {t('photo.sample.useLeaf')}
              </button>
            ) : null}
            <button ref={sample ? undefined : primary} type="button" className={cx('btn', sample ? 'btn-ghost' : 'btn-primary')} disabled={!s.canAdd} onClick={() => take.current?.click()} data-testid="photo-take">
              <Camera size={17} aria-hidden /> {t('photo.take')}
            </button>
            <button type="button" className="btn btn-ghost" disabled={!s.canAdd} onClick={() => pick.current?.click()} data-testid="photo-choose">
              <ImageIcon size={17} aria-hidden /> {t('photo.choose')}
            </button>
            {s.stage === 'ready' && !sample ? <span className="text-xs text-dim">{t('photo.model.ready')}</span> : null}
          </div>
        </>
      ) : null}
      <input ref={take} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void s.addFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      <input ref={pick} type="file" accept="image/*" hidden data-testid="photo-input" onChange={(e) => { void s.addFile(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />

      {s.error ? (
        <div className="photo-error" role="alert">
          <p className="m-0">{s.error === 'read' ? t('photo.error.read') : s.error === 'download' ? t('photo.error.download') : t('photo.error.model')}</p>
          {s.error === 'download' ? (
            <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => void s.download()}>
              <RotateCcw size={15} aria-hidden /> {t('common.retry')}
            </button>
          ) : null}
        </div>
      ) : null}

      {hasShots && cur ? (
        <>
          <div className="photo-result" data-testid="photo-result" data-verdict={report?.verdict ?? 'reading'}>
            <div className="photo-view">
              <figure className="photo-fig">
                <PhotoCanvas src={cur.url} alt={cur.sample ? t('photo.sample.art') : t('photo.shotAlt', { n: active + 1 })} overlay={cur.read?.overlay} layers={shown} scanning={cur.state === 'reading'} />
                <figcaption className="photo-cap">{cur.sample ? t('photo.sample.art') : t('photo.shotAlt', { n: active + 1 })}</figcaption>
              </figure>
              <LayerToggle overlay={cur.read?.overlay} value={shown} onChange={setLayers} />
              <div className="photo-thumbs" role="group" aria-label={t('photo.shots')}>
                {shots.map((sh, i) => (
                  <button key={sh.id} type="button" className="photo-thumb" aria-pressed={i === active} aria-label={t('photo.shotAlt', { n: i + 1 })} data-reading={sh.state === 'reading'} onClick={() => s.setActive(i)}>
                    <img src={sh.url} alt="" />
                    <span className="tabular">{i + 1}</span>
                  </button>
                ))}
                {Array.from({ length: left }, (_, i) => (
                  <span key={`empty-${i}`} className="photo-thumb is-empty" aria-hidden>
                    <Plus size={16} />
                  </span>
                ))}
              </div>
              <button type="button" className="btn btn-quiet btn-sm justify-self-start" onClick={s.removeActive} disabled={s.busy} data-testid="photo-remove">
                <Trash2 size={14} aria-hidden /> {t('photo.remove', { n: active + 1 })}
              </button>
            </div>

            <div className="photo-reading" data-busy={s.busy}>
              {!report ? (
                <p className="photo-busy m-0" role="status" data-testid="photo-analyzing">
                  <span className="spinner" aria-hidden /> {t('photo.analyzing')}
                </p>
              ) : (
                <>
                  {s.busy ? (
                    <p className="photo-busy m-0 mb-3" role="status" data-testid="photo-analyzing">
                      <span className="spinner" aria-hidden /> {t('photo.analyzingN', { n: shots.length })}
                    </p>
                  ) : null}
                  <p className="eyebrow !text-chrome m-0">{t('photo.reading')}</p>

                  {report.verdict === 'confident' && best ? (
                    <div className="photo-outcome" data-o="hint" data-testid="photo-outcome">
                      <Check size={22} strokeWidth={2} aria-hidden />
                      <div>
                        <p className="photo-outcome-title">{best.id === 'healthy' ? t('photo.looksHealthy') : nameOf(best)}</p>
                        <p className="photo-outcome-sub tabular">
                          {t('photo.conf', { pct: pct(best.prob) })}
                          {report.photos > 1 ? ` · ${t('photo.avg', { n: report.photos })}` : ''}
                        </p>
                        {s.withdrawn ? <p className="m-0 mt-2 text-sm text-dim">{t('photo.withdrawn', { id: s.withdrawn })}</p> : null}
                      </div>
                    </div>
                  ) : null}

                  {report.verdict === 'ambiguous' ? (
                    <div className="photo-outcome" data-o="ask" data-testid="photo-outcome">
                      <CircleHelp size={22} strokeWidth={1.7} aria-hidden />
                      <div>
                        <p className="photo-outcome-title">{named[1] ? t('photo.ask.title', { a: nameOf(named[0]!), b: nameOf(named[1]) }) : t('photo.ask.title1', { a: named[0] ? nameOf(named[0]) : '' })}</p>
                        <p className="photo-outcome-sub">{t('photo.ask.sub')}</p>
                      </div>
                    </div>
                  ) : null}

                  {report.verdict === 'unsure' ? (
                    <div className="photo-outcome" data-o="unsure" data-testid="photo-outcome">
                      <Hand size={22} strokeWidth={1.6} aria-hidden />
                      <div>
                        <p className="photo-outcome-title">{t('photo.unsure.title')}</p>
                        <p className="m-0 mt-1 text-sm text-chrome">{t('photo.unsure.body')}</p>
                        {s.caseId ? (
                          <p className="m-0 mt-2 flex flex-wrap items-center gap-2 text-sm">
                            <span className="text-dim">{t('photo.unsure.case')}</span>
                            <span className="chip chip-mono" data-testid="photo-case">
                              {s.caseId}
                            </span>
                            <Link to={`/officer/${encodeURIComponent(s.caseId)}`} className="link inline-flex items-center gap-1">
                              {t('photo.inbox.open')} <ArrowRight size={13} aria-hidden />
                            </Link>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {report.photos > 1 && report.agree !== undefined ? (
                    <p className="m-0 mt-2">
                      <span className="chip" data-tone={report.agree ? 'go' : 'wait'} data-testid="photo-agree">
                        {report.agree ? t('photo.agree') : t('photo.disagree')}
                      </span>
                    </p>
                  ) : null}

                  <h3 className="eyebrow !text-chrome mt-5 mb-2">{t('photo.differential')}</h3>
                  <Differential rows={report.differential} reportId={report.id} separates={report.verdict === 'ambiguous' ? report.nextView?.separates : undefined} pending={s.busy} />
                  {!sample ? <p className="m-0 mt-2 text-xs text-dim">{t('photo.labelNote')}</p> : null}

                  {report.severity ? <SeverityMeter severity={report.severity} /> : null}
                  {report.symptoms.length ? <SymptomChips report={report} onOpen={setCite} /> : null}
                </>
              )}
            </div>
          </div>

          {report ? (
            <>
              {report.verdict === 'ambiguous' && report.nextView ? (
                <ViewRequestCard
                  key={report.nextView.id + report.photos}
                  view={report.nextView}
                  taken={shots.length}
                  sample={sample}
                  canAdd={s.canAdd}
                  hasCase={!!s.caseId}
                  onTake={() => take.current?.click()}
                  onGallery={() => pick.current?.click()}
                  onSample={() => void s.addSample()}
                  onOfficer={s.sendToOfficer}
                />
              ) : null}

              {report.verdict === 'confident' ? <PhotoDecision decision={s.decision} officerCase={s.caseId} onSend={s.sendToOfficer} onRetry={s.retryPlan} /> : null}

              <DiagnosisReceipt report={report} sha={getModelSha()} onOpenSymptom={setCite} />
              <CitationSheet symptom={cite} report={report} onClose={() => setCite(null)} />
            </>
          ) : null}

          <button type="button" className="btn btn-quiet btn-sm mt-4" onClick={startOver} data-testid="photo-again">
            <RotateCcw size={14} aria-hidden /> {t('photo.again')}
          </button>
        </>
      ) : null}

      <p className="sr-only" role="status" data-testid="photo-announce">
        {s.announce}
      </p>
    </section>
  );
}
