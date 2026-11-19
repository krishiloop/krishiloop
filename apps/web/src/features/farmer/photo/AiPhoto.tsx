import { useEffect, useRef, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Check, Image as ImageIcon, Lightbulb, Loader2, ReceiptText, RotateCcw, ScanSearch, ServerOff, ShieldCheck, UserRound } from 'lucide-react';
import { useI18n, type Key, type Lang } from '../../../lib/i18n';
import '../../../lib/i18n/strings.photoai';
import { createStore } from '../../../lib/store';
import { fmtNum } from '../../../lib/format';
import { cx } from '../../../lib/cx';
import { apiStore, useApiState } from '../../../lib/api/client';
import type { Action, Plan } from '../../../lib/api/types';
import { FIELD_TO_MODEL_CROP, gate, niceClass, topClasses, type GateResult } from '../../../lib/agritriage/gate';
import { heatColour } from '../../../lib/agritriage/occlusion';
import { decodeImage, loadRuntime, occlusionMap, preprocess, readPhoto, type Reading, type Runtime } from '../../../lib/agritriage/runtime';
import { escalateTriage, submitTriage, triageHeatOnce, triagePlan, type ModelInfo, type TriageArea, type TriageCase } from '../../../lib/agritriage/api';
import { Comparer } from '../../../ui/kit/Comparer';
import { prepareJpeg } from './downscale';
import { currentField, farmer, useFarmer } from '../farmerStore';
import { logPlan } from '../inspector';
import { holdPlan } from '../receipts';
import type { TabId } from '../TabBar';
import { tick } from '../checklist';
import { cropName } from '../words';

/**
 * AgriTriage-Lite in the farmer app: the owner's TinyViT-11M student reads the leaf INSIDE the phone (ONNX Runtime Web,
 * loaded only here), the conformal gate answers diagnose / shortlist / refer, and an occlusion map shows where it looked.
 * A signed answer is a second, server-side reading of the same photo (only when the farmer asks): photo-trust policy v2
 * then gives a receipt, asks for a clearer photo, or hands the case to the officer. Works with recorded data too: the
 * on-device step needs no server.
 */
type Mode = 'field' | 'any';
type Phase =
  | { k: 'idle' }
  | { k: 'loading' }
  | { k: 'reading'; preview: string }
  | { k: 'done'; preview: string; photo: string; reading: Reading; b64: string }
  | { k: 'error'; kind: 'model' | 'image'; message: string };
type Server =
  | { k: 'idle' }
  | { k: 'sending' }
  | { k: 'done'; c: TriageCase; area: TriageArea; model: ModelInfo }
  | { k: 'error'; message: string };
type PlanState = { k: 'idle' } | { k: 'planning' } | { k: 'done'; action: Action | null; plan: Plan } | { k: 'error'; message: string };
/** A map on screen: computed on this phone (a quick 4 x 4 pass, then 7 x 7) or, if the farmer chose it, on our server. */
type Shown = { url: string; grid: number; ms: number; where: 'phone' | 'server'; target: number; roundTripMs?: number };
type Heat =
  | { k: 'idle' }
  | { k: 'running'; done: number; total: number; stage: 'quick' | 'fine' | 'server'; shown: Shown | null }
  | { k: 'done'; shown: Shown }
  | { k: 'error'; message: string; shown: Shown | null };

interface State {
  phase: Phase;
  mode: Mode;
  server: Server;
  plan: PlanState;
  heat: Heat;
  /** the farmer chose to compute "Show where" on our server (the photo is sent once, not kept) */
  serverMap: boolean;
  rt: { loadS: number } | null;
}
const store = createStore<State>({ phase: { k: 'idle' }, mode: 'field', server: { k: 'idle' }, plan: { k: 'idle' }, heat: { k: 'idle' }, serverMap: false, rt: null });
let previewUrl: string | null = null;
let runtime: Runtime | null = null;
const cancel = { cancelled: false };

/** The 224 px square the model saw, as an image (CHW floats in [0, 1] back to pixels), at 2x for sharp phones. */
function squareUrl(x: Float32Array, S: number, heat?: number[], grid = 7): string {
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(S, S);
  const n = S * S;
  for (let i = 0; i < n; i++) {
    img.data[4 * i] = Math.round(x[i] * 255);
    img.data[4 * i + 1] = Math.round(x[n + i] * 255);
    img.data[4 * i + 2] = Math.round(x[2 * n + i] * 255);
    img.data[4 * i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = 2 * S;
  out.height = 2 * S;
  const o = out.getContext('2d')!;
  o.imageSmoothingQuality = 'high';
  o.drawImage(cv, 0, 0, 2 * S, 2 * S);
  if (heat) {
    const h = document.createElement('canvas');
    h.width = grid;
    h.height = grid;
    const hg = h.getContext('2d')!;
    const hd = hg.createImageData(grid, grid);
    heat.forEach((v, i) => hd.data.set(heatColour(v), 4 * i));
    hg.putImageData(hd, 0, 0);
    o.globalAlpha = 0.25; // dim the photo a little under the map so warm squares read on a green leaf
    o.fillStyle = '#000';
    o.fillRect(0, 0, 2 * S, 2 * S);
    o.globalAlpha = 1;
    o.imageSmoothingEnabled = true;
    o.drawImage(h, 0, 0, 2 * S, 2 * S);
  }
  return out.toDataURL('image/jpeg', 0.88);
}

async function read(file: File) {
  cancel.cancelled = true;
  store.set((s) => ({ ...s, phase: runtime ? { k: 'reading', preview: '' } : { k: 'loading' }, server: { k: 'idle' }, plan: { k: 'idle' }, heat: { k: 'idle' } }));
  let prep;
  try {
    prep = await prepareJpeg(file); // the exact JPEG the server would get: the phone and the server read the same pixels
  } catch (e) {
    store.set((s) => ({ ...s, phase: { k: 'error', kind: 'image', message: e instanceof Error ? e.message : String(e) } }));
    return;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(prep.blob);
  try {
    if (!runtime) {
      store.set((s) => ({ ...s, phase: { k: 'loading' } }));
      runtime = await loadRuntime();
      store.set((s) => ({ ...s, rt: { loadS: runtime!.loadS } }));
    }
  } catch (e) {
    store.set((s) => ({ ...s, phase: { k: 'error', kind: 'model', message: e instanceof Error ? e.message : String(e) } }));
    return;
  }
  store.set((s) => ({ ...s, phase: { k: 'reading', preview: previewUrl! } }));
  try {
    const bmp = await decodeImage(prep.blob);
    const x = preprocess(bmp, runtime.cfg);
    bmp.close();
    const reading = await readPhoto(runtime, x, cropFor(store.get().mode));
    store.set((s) => ({ ...s, phase: { k: 'done', preview: previewUrl!, photo: squareUrl(x, runtime!.cfg.input_size), reading, b64: prep.b64 } }));
    tick('photo');
  } catch (e) {
    store.set((s) => ({ ...s, phase: { k: 'error', kind: 'image', message: e instanceof Error ? e.message : String(e) } }));
  }
}

function cropFor(mode: Mode): string | null {
  const f = currentField();
  return mode === 'field' && f ? (FIELD_TO_MODEL_CROP[f.crop] ?? null) : null;
}

/** Crop chips change the answer without reading the photo again (the same logits, gated again). */
function setMode(mode: Mode) {
  store.set((s) => {
    if (s.phase.k !== 'done' || !runtime) return { ...s, mode };
    const r = s.phase.reading;
    const result = gate(r.logits, runtime.cfg, cropFor(mode));
    return { ...s, mode, phase: { ...s.phase, reading: { ...r, result } }, server: { k: 'idle' }, plan: { k: 'idle' }, heat: { k: 'idle' } };
  });
}

/** The live API is there (not recorded data): the server path may be offered. */
const serverOnline = () => {
  const a = apiStore.get();
  return !a.forced && a.mode !== 'sample' && farmer.get().planSource !== 'sample';
};

async function showWhere() {
  const s = store.get();
  if (s.phase.k !== 'done' || !runtime) return;
  cancel.cancelled = false;
  const r = s.phase.reading;
  const target = r.result.order[0];
  const S = runtime.cfg.input_size;
  const crop = cropFor(s.mode);
  const f = currentField();
  // 1. the farmer chose our server and it is there: one call, about 4 s (the photo is used once and not kept)
  if (s.serverMap && serverOnline() && f) {
    store.set((x) => ({ ...x, heat: { k: 'running', done: 0, total: 1, stage: 'server', shown: null } }));
    const t0 = performance.now();
    try {
      const h = await triageHeatOnce(f.field_id, s.phase.b64, s.mode === 'any', runtime.cfg.classes[target]);
      const shown: Shown = { url: squareUrl(r.x, S, h.heat, h.grid), grid: h.grid, ms: h.ms, where: 'server', target, roundTripMs: performance.now() - t0 };
      store.set((x) => ({ ...x, heat: { k: 'done', shown } }));
      return;
    } catch {
      /* the server did not answer: the phone computes it instead */
    }
  }
  // 2. on this phone: a quick 4 x 4 map first (16 runs), then the 7 x 7 one (49 runs); Stop keeps what is shown
  let shown: Shown | null = null;
  const pass = (grid: number, stage: 'quick' | 'fine') =>
    occlusionMap(runtime!, r, crop, target, (done, total) => store.set((x) => ({ ...x, heat: { k: 'running', done, total, stage, shown } })), cancel, grid === 4 ? 8 : 7, grid);
  try {
    const quick = await pass(4, 'quick');
    if (!quick) return store.set((x) => ({ ...x, heat: { k: 'idle' } }));
    shown = { url: squareUrl(r.x, S, quick.heat, 4), grid: 4, ms: quick.ms, where: 'phone', target };
    const fine = await pass(7, 'fine');
    if (fine) shown = { url: squareUrl(r.x, S, fine.heat, 7), grid: 7, ms: quick.ms + fine.ms, where: 'phone', target };
    const done = shown;
    store.set((x) => ({ ...x, heat: { k: 'done', shown: done } }));
  } catch (e) {
    const keep = shown;
    store.set((x) => ({ ...x, heat: { k: 'error', message: e instanceof Error ? e.message : String(e), shown: keep } }));
  }
}

async function askServer(toOfficer: boolean) {
  const s = store.get();
  const f = currentField();
  if (s.phase.k !== 'done' || !f || !runtime) return;
  const r = s.phase.reading.result;
  store.set((x) => ({ ...x, server: { k: 'sending' }, plan: { k: 'idle' } }));
  try {
    const client = {
      outcome: r.outcome,
      set: r.set.map((i) => runtime!.cfg.classes[i]),
      top: topClasses(r, runtime.cfg, 3).map((c) => ({ label: c.label, prob: Math.round(c.prob * 10000) / 10000 })),
      ms: Math.round(s.phase.reading.ms),
    };
    const res = await submitTriage(f.field_id, s.phase.b64, true, s.mode === 'any', client);
    let c = res.case;
    if (toOfficer && c.route === 'retake') c = await escalateTriage(c.case_id);
    store.set((x) => ({ ...x, server: { k: 'done', c, area: res.area, model: res.model } }));
  } catch (e) {
    store.set((x) => ({ ...x, server: { k: 'error', message: e instanceof Error ? e.message : String(e) } }));
  }
}

async function getReceipt(caseId: string, profileId: string) {
  store.set((x) => ({ ...x, plan: { k: 'planning' } }));
  try {
    const plan = await triagePlan(caseId, profileId);
    const action = plan.actions?.find((a) => a.receipt.photo_reading?.case_id === caseId) ?? null;
    store.set((x) => ({ ...x, plan: { k: 'done', action, plan } }));
    // like every other plan: it becomes this week's plan on Today, and its receipts join the Receipts list (where a
    // model recall turns the photo receipt Recalled, through the same verifier)
    farmer.set((s) => ({ ...s, status: 'ready', plan, planSource: 'live', cached: false, afterRecall: false, photoCaseId: caseId, error: null }));
    logPlan(plan, 'live', { photoCaseId: caseId });
    holdPlan(plan, 'live');
  } catch (e) {
    store.set((x) => ({ ...x, plan: { k: 'error', message: e instanceof Error ? e.message : String(e) } }));
  }
}

const secs = (ms: number, lang: Lang) => fmtNum(Math.round(ms / 100) / 10, lang, { maximumFractionDigits: 1 });
const pct = (p: number, lang: Lang) => `${fmtNum(Math.round(p * 1000) / 10, lang, { maximumFractionDigits: 1 })}%`;

export default function AiPhoto({ onTab }: { onTab?: (t: TabId) => void }) {
  const { t } = useI18n();
  const st = useFarmer();
  const api = useApiState();
  const s = store.use();
  const field = currentField(st);
  const fieldCrop = field ? (FIELD_TO_MODEL_CROP[field.crop] ?? null) : null;
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const offline = api.forced || api.mode === 'sample' || st.planSource === 'sample';
  const busy = s.phase.k === 'loading' || s.phase.k === 'reading';

  useEffect(() => {
    if (field && !fieldCrop && s.mode === 'field') setMode('any'); // a crop the model does not know: any crop only
  }, [field, fieldCrop, s.mode]);
  useEffect(() => {
    if (s.phase.k === 'done' || s.phase.k === 'error') resultRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [s.phase.k]);
  useEffect(() => () => void (cancel.cancelled = true), []);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void read(f);
  };

  return (
    <section className="grid gap-4" aria-labelledby="fa-ai-title" data-testid="fa-ai">
      <div>
        <h3 id="fa-ai-title" className="t-head">
          {t('fa.photo.ai.title')}
        </h3>
        <p className="mt-1 text-sm text-ink-2">{t('fa.photo.ai.sub')}</p>
        <p className="chip mt-2 max-w-full whitespace-normal" data-testid="fa-ai-weights">
          {t('fa.photo.ai.weights')}
        </p>
      </div>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="eyebrow mb-1.5">{t('fa.photo.ai.cropLabel')}</legend>
        <div className="flex flex-wrap gap-2">
          {fieldCrop && field && (
            <button type="button" className={cx('btn btn-sm fa-hit', s.mode === 'field' ? 'btn-primary' : 'btn-secondary')} aria-pressed={s.mode === 'field'} onClick={() => setMode('field')} data-testid="fa-ai-crop-field">
              {t('fa.photo.ai.cropField', { crop: cropName(field.crop, t) })}
            </button>
          )}
          <button type="button" className={cx('btn btn-sm fa-hit', s.mode === 'any' ? 'btn-primary' : 'btn-secondary')} aria-pressed={s.mode === 'any'} onClick={() => setMode('any')} data-testid="fa-ai-crop-any">
            {t('fa.photo.ai.cropAny')}
          </button>
        </div>
        {s.mode === 'any' && <p className="m-0 text-xs text-ink-3">{t('fa.photo.ai.cropAnyNote')}</p>}
      </fieldset>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-primary fa-hit" onClick={() => cam.current?.click()} disabled={busy} data-testid="fa-ai-take">
          <Camera size={18} aria-hidden />
          {t('fa.photo.ai.take')}
        </button>
        <button type="button" className="btn btn-secondary fa-hit" onClick={() => pick.current?.click()} disabled={busy} data-testid="fa-ai-choose">
          <ImageIcon size={18} aria-hidden />
          {t('fa.photo.ai.choose')}
        </button>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={onFile} data-testid="fa-ai-camera-input" />
        <input ref={pick} type="file" accept="image/*" hidden onChange={onFile} data-testid="fa-ai-input" />
      </div>

      <div ref={resultRef} className="scroll-mt-4" aria-live="polite" aria-busy={busy} data-testid="fa-ai-result">
        {s.phase.k === 'loading' && (
          <p className="fa-note">
            <Loader2 size={16} className="flex-none animate-spin motion-reduce:animate-none" aria-hidden />
            {t('fa.photo.ai.loading')}
          </p>
        )}
        {s.phase.k === 'reading' && <p className="fa-note">{t('fa.photo.ai.reading')}</p>}
        {s.phase.k === 'error' && (
          <div className="panel p-4" role="alert" data-testid="fa-ai-error">
            <p className="m-0 font-semibold">{t(s.phase.kind === 'model' ? 'fa.photo.ai.err.model' : 'fa.photo.ai.err.image')}</p>
            <p className="mono m-0 mt-1.5 break-all text-xs text-ink-3">{s.phase.message}</p>
          </div>
        )}
        {s.phase.k === 'done' && runtime && <Result s={s} phase={s.phase} rt={runtime} offline={offline} profileId={st.profileId} onTab={onTab} />}
      </div>
    </section>
  );
}

const OUT_KEY = { diagnose: 'fa.photo.ai.out.diagnose', shortlist: 'fa.photo.ai.out.shortlist', refer: 'fa.photo.ai.out.refer' } as const;
const OUT_TONE = { diagnose: 'chip-go', shortlist: 'chip-wait', refer: 'chip-stop' } as const;

type T = ReturnType<typeof useI18n>['t'];

function why(r: GateResult, t: T, lang: Lang) {
  const n = fmtNum(r.set.length, lang);
  if (r.reason === 'single') return t('fa.photo.ai.why.single');
  if (r.reason === 'few') return t('fa.photo.ai.why.few', { n });
  if (r.reason === 'many') return t('fa.photo.ai.why.many', { n });
  return t('fa.photo.ai.why.unknown');
}

function Result({ s, phase, rt, offline, profileId, onTab }: { s: State; phase: Extract<Phase, { k: 'done' }>; rt: Runtime; offline: boolean; profileId: string | null; onTab?: (t: TabId) => void }) {
  const { t, lang } = useI18n();
  const r = phase.reading.result;
  const top = topClasses(r, rt.cfg, 5);
  const name = niceClass(rt.cfg.classes[r.order[0]]);
  const heat = s.heat;
  const shown = heat.k === 'idle' ? null : heat.shown;
  return (
    <article className="panel overflow-hidden" data-testid="fa-ai-card" data-outcome={r.outcome}>
      <div className="grid gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx('chip', OUT_TONE[r.outcome])} data-testid="fa-ai-outcome">
            {t(OUT_KEY[r.outcome])}
          </span>
        </div>
        {r.outcome === 'diagnose' && (
          <p className="t-head m-0" data-testid="fa-ai-disease" lang="en">
            {name}
          </p>
        )}
        <p className="m-0 text-sm text-ink-2">{why(r, t, lang)}</p>

        <div>
          <h4 className="eyebrow m-0">{t('fa.photo.ai.top')}</h4>
          <ul className="m-0 mt-2 grid list-none gap-2 p-0" data-testid="fa-ai-top">
            {top.map((c) => (
              <li key={c.label} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={cx('min-w-0', c.inSet && r.outcome !== 'refer' && 'font-semibold')} lang="en">
                    {niceClass(c.label)}
                    {c.inSet && r.outcome !== 'refer' && <span className="sr-only"> ({t('fa.photo.ai.inSet')})</span>}
                  </span>
                  <span className="mono flex-none">{pct(c.prob, lang)}</span>
                </div>
                <span className="block h-1.5 overflow-hidden rounded-full bg-sunk" aria-hidden>
                  <span className={cx('block h-full origin-left rounded-full', c.inSet && r.outcome !== 'refer' ? 'bg-go' : 'bg-ink-3')} style={{ transform: `scaleX(${Math.max(0.02, c.prob)})` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="m-0 text-xs text-ink-3" data-testid="fa-ai-time">
          {t('fa.photo.ai.time', { ms: fmtNum(Math.round(phase.reading.ms), lang), s: fmtNum(Math.round(rt.loadS * 10) / 10, lang) })}
        </p>
      </div>

      <div className="grid gap-3 border-t border-rule p-4">
        {shown && (
          <div className="grid gap-2" data-testid="fa-ai-comparer" data-where={shown.where} data-grid={shown.grid}>
            <Comparer
              className="aspect-square w-full overflow-hidden rounded-[12px]"
              before={<img src={phase.photo} alt={t('fa.photo.ai.previewAlt')} />}
              after={<img src={shown.url} alt="" />}
              beforeLabel={t('fa.photo.ai.wherePhoto')}
              afterLabel={t('fa.photo.ai.whereHeat')}
              label={t('fa.photo.ai.whereSlider')}
              initial={50}
            />
            <p className="m-0 text-xs text-ink-3">{t('fa.photo.ai.whereMethod', { label: niceClass(rt.cfg.classes[shown.target]) })}</p>
            <p className="m-0 text-xs font-semibold text-ink-2" data-testid="fa-ai-where-time">
              {shown.where === 'server'
                ? t('fa.photo.ai.whereOnServer', { grid: fmtNum(shown.grid, lang), s: secs(shown.ms, lang), rt: secs(shown.roundTripMs ?? shown.ms, lang) })
                : t('fa.photo.ai.whereOnPhone', { grid: fmtNum(shown.grid, lang), s: secs(shown.ms, lang) })}
            </p>
          </div>
        )}
        {heat.k === 'running' && (
          <div className="grid gap-2">
            <p className="m-0 text-sm">
              {heat.stage === 'server'
                ? t('fa.photo.ai.whereServerRunning')
                : t(heat.stage === 'quick' ? 'fa.photo.ai.whereRunning' : 'fa.photo.ai.whereSharpening', { done: fmtNum(heat.done, lang), total: fmtNum(heat.total, lang) })}
            </p>
            <div
              className="h-2 overflow-hidden rounded-full bg-sunk"
              role="progressbar"
              aria-label={t('fa.photo.ai.where')}
              aria-valuemin={0}
              aria-valuemax={heat.total}
              aria-valuenow={heat.done}
              data-testid="fa-ai-where-progress"
            >
              <span className="block h-full origin-left bg-go transition-transform motion-reduce:transition-none" style={{ transform: `scaleX(${heat.total ? heat.done / heat.total : 0})` }} />
            </div>
            {heat.stage !== 'server' && (
              <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => (cancel.cancelled = true)}>
                {t('fa.photo.ai.whereCancel')}
              </button>
            )}
          </div>
        )}
        {/* also after a map is shown: the farmer may switch to our server and ask again */}
        {heat.k !== 'running' && (heat.k !== 'done' || (heat.shown.where === 'phone' && !offline)) && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              {!shown && <img src={phase.photo} alt={t('fa.photo.ai.previewAlt')} className="size-16 flex-none rounded-[10px] object-cover" />}
              <button type="button" className="btn btn-secondary fa-hit" onClick={() => void showWhere()} data-testid="fa-ai-where">
                <ScanSearch size={18} aria-hidden />
                {t('fa.photo.ai.where')}
              </button>
            </div>
            {!offline && (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p id="fa-ai-srvmap" className="m-0 text-sm font-semibold">
                    {t('fa.photo.ai.whereServer')}
                  </p>
                  <p className="m-0 mt-0.5 text-xs text-ink-3">{t('fa.photo.ai.whereServerSub')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.serverMap}
                  aria-labelledby="fa-ai-srvmap"
                  className="fa-switch"
                  onClick={() => store.set((x) => ({ ...x, serverMap: !x.serverMap }))}
                  data-testid="fa-ai-where-server"
                >
                  <span className="fa-switch-knob" aria-hidden />
                </button>
              </div>
            )}
            {heat.k === 'error' && <p className="mono m-0 w-full break-all text-xs text-ink-3">{heat.message}</p>}
          </div>
        )}
      </div>

      {r.outcome === 'shortlist' && (
        <div className="border-t border-rule p-4" data-testid="fa-ai-tips">
          <p className="m-0 flex items-center gap-2 font-semibold">
            <Lightbulb size={17} aria-hidden />
            {t('fa.photo.ai.tipsTitle')}
          </p>
          <ul className="m-0 mt-2 grid gap-1 pl-5 text-sm text-ink-2">
            <li>{t('fa.photo.ai.tip1')}</li>
            <li>{t('fa.photo.ai.tip2')}</li>
            <li>{t('fa.photo.ai.tip3')}</li>
            <li>{t('fa.photo.ai.tip4')}</li>
          </ul>
        </div>
      )}

      <ServerStep s={s} outcome={r.outcome} offline={offline} profileId={profileId} onTab={onTab} />
    </article>
  );
}

function ServerStep({ s, outcome, offline, profileId, onTab }: { s: State; outcome: GateResult['outcome']; offline: boolean; profileId: string | null; onTab?: (t: TabId) => void }) {
  const { t, lang } = useI18n();
  const sv = s.server;
  if (offline) {
    return (
      <p className="fa-note m-0 rounded-none border-t border-rule px-4 py-3" data-testid="fa-ai-offline">
        <ServerOff size={16} aria-hidden className="flex-none" />
        {t('fa.photo.ai.needsServer')}
      </p>
    );
  }
  if (sv.k === 'idle' || sv.k === 'error') {
    return (
      <div className="grid gap-2 border-t border-rule p-4">
        <div className="flex flex-wrap gap-2">
          {outcome === 'diagnose' && (
            <button type="button" className="btn btn-primary fa-hit" onClick={() => void askServer(false)} data-testid="fa-ai-signed">
              <ShieldCheck size={18} aria-hidden />
              {t('fa.photo.ai.signed')}
            </button>
          )}
          {outcome === 'shortlist' && (
            <button type="button" className="btn btn-secondary fa-hit" onClick={() => document.querySelector<HTMLInputElement>('[data-testid="fa-ai-camera-input"]')?.click()}>
              <RotateCcw size={18} aria-hidden />
              {t('fa.photo.ai.retake')}
            </button>
          )}
          {outcome !== 'diagnose' && (
            <button type="button" className={cx('btn fa-hit', outcome === 'refer' ? 'btn-primary' : 'btn-secondary')} onClick={() => void askServer(true)} data-testid="fa-ai-officer">
              <UserRound size={18} aria-hidden />
              {t('fa.photo.ai.toOfficer')}
            </button>
          )}
        </div>
        <p className="m-0 text-xs text-ink-3">{t('fa.photo.ai.signedSub')}</p>
        {sv.k === 'error' && (
          <p className="m-0 text-sm" role="alert">
            {t('fa.photo.ai.err.server')} <span className="mono break-all text-xs text-ink-3">{sv.message}</span>
          </p>
        )}
      </div>
    );
  }
  if (sv.k === 'sending') return <p className="fa-note m-0 rounded-none border-t border-rule px-4 py-3">{t('fa.photo.ai.sending')}</p>;
  const c = sv.c;
  const routeKey: Key = c.route === 'receipt' ? 'fa.photo.ai.srv.receipt' : c.route === 'retake' ? 'fa.photo.ai.srv.retake' : 'fa.photo.ai.srv.officer';
  const agree = c.agreement?.same_outcome && c.agreement?.same_set;
  return (
    <div className="grid gap-3 border-t border-rule p-4" data-testid="fa-ai-server" data-route={c.route} data-reason={c.reason}>
      <div>
        <h4 className="eyebrow m-0">{t('fa.photo.ai.srv.title')}</h4>
        <p className="m-0 mt-1 flex items-center gap-2 font-semibold">
          {c.route === 'receipt' ? <ShieldCheck size={18} className="flex-none text-go" aria-hidden /> : <UserRound size={18} className="flex-none text-ink-2" aria-hidden />}
          {t(routeKey)}
        </p>
        {c.route !== 'receipt' && <p className="m-0 mt-1 text-sm text-ink-2">{t(`fa.photo.ai.srv.reason.${c.reason}` as Key)}</p>}
        <p className="m-0 mt-1 text-sm text-ink-2" data-testid="fa-ai-agree" data-agree={agree ? 'true' : 'false'} data-same-top={c.agreement?.same_top ? 'true' : 'false'}>
          {agree ? t('fa.photo.ai.srv.agree') : t('fa.photo.ai.srv.differ')}{' '}
          <span lang="en">
            ({c.reading.outcome}: {c.reading.set.map(niceClass).join(', ') || '–'})
          </span>
        </p>
      </div>
      <dl className="m-0 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="eyebrow pt-[3px]">{t('fa.abs.case')}</dt>
        <dd className="mono m-0 break-all" data-testid="fa-ai-case">
          {c.case_id}
        </dd>
        <dt className="eyebrow pt-[3px]">{t('fa.photo.ai.rcpt.model')}</dt>
        <dd className="mono m-0 break-all text-xs">
          {c.reading.model} · {c.reading.sha256.slice(0, 12)}…
        </dd>
        <dt className="eyebrow pt-[3px]">{t('fa.photo.kept')}</dt>
        <dd className="m-0 text-ink-2">{c.photo_available ? t('fa.photo.ai.srv.kept') : t('fa.photo.ai.srv.notKept')}</dd>
      </dl>
      {c.route === 'receipt' && profileId && <ReceiptStep caseId={c.case_id} profileId={profileId} plan={s.plan} lang={lang} onTab={onTab} />}
    </div>
  );
}

function ReceiptStep({ caseId, profileId, plan, lang, onTab }: { caseId: string; profileId: string; plan: PlanState; lang: Lang; onTab?: (t: TabId) => void }) {
  const { t } = useI18n();
  if (plan.k === 'idle' || plan.k === 'error') {
    return (
      <div className="grid gap-2">
        <button type="button" className="btn btn-primary fa-hit" onClick={() => void getReceipt(caseId, profileId)} data-testid="fa-ai-get-receipt">
          <ReceiptText size={18} aria-hidden />
          {t('fa.photo.ai.srv.getReceipt')}
        </button>
        {plan.k === 'error' && <p className="mono m-0 break-all text-xs text-ink-3">{plan.message}</p>}
      </div>
    );
  }
  if (plan.k === 'planning') return <p className="fa-note m-0">{t('fa.photo.ai.srv.planning')}</p>;
  const a = plan.action;
  if (!a) return <p className="m-0 text-sm text-ink-2">{t('fa.photo.ai.rcpt.none')}</p>;
  const pr = a.receipt.photo_reading!;
  const title = (a.title as Record<string, string>)[lang] ?? a.title.en;
  return (
    <section className="rounded-[12px] border border-rule p-3" data-testid="fa-ai-receipt">
      <h4 className="m-0 flex items-center gap-2 font-semibold">
        <Check size={17} className="text-go" aria-hidden />
        {t('fa.photo.ai.rcpt.title')}
      </h4>
      <p className="m-0 mt-1.5 text-sm">{title}</p>
      <dl className="m-0 mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="eyebrow">{t('fa.photo.ai.rcpt.rule')}</dt>
        <dd className="mono m-0">{a.receipt.rule_refs.map((r) => `${r.rule_id} v${r.version}`).join(', ')}</dd>
        <dt className="eyebrow">{t('fa.photo.ai.rcpt.model')}</dt>
        <dd className="mono m-0 break-all">{pr.model_ref.model}</dd>
        <dt className="eyebrow">{t('fa.photo.ai.rcpt.gate')}</dt>
        <dd className="m-0">
          {t('fa.photo.ai.rcpt.gateValue', { outcome: pr.outcome, set: pr.set.map(niceClass).join(', ') })}
        </dd>
      </dl>
      {a.receipt_credential_id && (
        <Link to={`/verify/${encodeURIComponent(a.receipt_credential_id)}`} className="btn btn-ghost btn-sm -ml-2 mt-2" data-testid="fa-ai-verify">
          {t('fa.photo.ai.rcpt.check')}
        </Link>
      )}
      {onTab && (
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => onTab('today')} data-testid="fa-ai-to-today">
          {t('fa.photo.ai.rcpt.today')}
        </button>
      )}
    </section>
  );
}
