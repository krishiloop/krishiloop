import { lazy, Suspense, useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Camera, Check, Image as ImageIcon, RefreshCw, ServerOff, ShieldCheck, UserRound } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { createStore } from '../../lib/store';
import { fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { motionReduced } from '../../lib/motionPref';
import { useApiState } from '../../lib/api/client';
import { loadAreaStats, photoErrorKind, sendPhoto, useAreaStats, type PhotoErrorKind } from '../../lib/api/trust';
import type { PhotoCase } from '../../lib/api/types';
import { meterView } from '../trust/gate';
import { prepareJpeg } from './photo/downscale';
import { currentField, loadPlan, useFarmer } from './farmerStore';
import { logError, logPhoto, setWorking } from './inspector';
import { tick } from './checklist';
import { areaOf, cropName, countryName, photoLabelName } from './words';
import type { TabId } from './TabBar';

/** AgriTriage-Lite on the phone: its own chunk, and ONNX Runtime + the 11.5 MB model load only when a photo is read. */
const AiPhoto = lazy(() => import('./photo/AiPhoto'));

type PhotoState =
  | { phase: 'idle' }
  | { phase: 'preparing' }
  | { phase: 'reading'; preview: string }
  | { phase: 'done'; preview: string; c: PhotoCase }
  | { phase: 'error'; preview?: string; kind: PhotoErrorKind | 'prepare'; message: string };

/** The last photo and its answer stay while the visitor switches tabs (the preview is the JPEG that was sent). */
const photoStore = createStore<PhotoState>({ phase: 'idle' });
let lastUrl: string | null = null;
const keepUrl = (u: string) => {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = u;
  return u;
};

async function send(file: File, fieldId: string, consent: boolean) {
  photoStore.set({ phase: 'preparing' });
  let preview: string;
  let b64: string;
  try {
    const prep = await prepareJpeg(file);
    preview = keepUrl(URL.createObjectURL(prep.blob));
    b64 = prep.b64;
  } catch (e) {
    photoStore.set({ phase: 'error', kind: 'prepare', message: e instanceof Error ? e.message : String(e) });
    return;
  }
  photoStore.set({ phase: 'reading', preview });
  setWorking('photo');
  try {
    const c = await sendPhoto(fieldId, b64, consent);
    const area = await loadAreaStats(c.area).catch(() => null);
    logPhoto(c, area);
    tick('photo');
    photoStore.set({ phase: 'done', preview, c });
  } catch (e) {
    const kind = photoErrorKind(e);
    const message = e instanceof Error ? e.message : String(e);
    logError('POST /api/demo/‹sid›/photo', message);
    photoStore.set({ phase: 'error', preview, kind, message });
  } finally {
    setWorking(null);
  }
}

/**
 * Photo: the farmer's photo goes to the SERVER, which reads it (BioCLIP 2) and freezes its suggestion in the area's
 * ledger. The officer confirms it, unless this crop and area have earned trust (the gate is open and the reading is
 * sure): then it is answered automatically. Consent decides whether the photo is kept for the officer. With recorded
 * data there is no server to read a photo, and the tab says so.
 */
export function PhotoTab({ onTab }: { onTab: (t: TabId) => void }) {
  const { t, lang } = useI18n();
  const st = useFarmer();
  const api = useApiState();
  const state = photoStore.use();
  const field = currentField(st);
  const area = field ? areaOf(field) : null;
  const stats = useAreaStats(area);
  const [consent, setConsent] = useState(false);
  const [areaErr, setAreaErr] = useState<PhotoErrorKind | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const consentId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const lastPhase = useRef(state.phase);

  // the photo and then its answer come into view as they arrive (not when the tab is reopened)
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = state.phase;
    if (was !== state.phase && (state.phase === 'reading' || state.phase === 'done' || state.phase === 'error')) {
      resultRef.current?.scrollIntoView({ block: state.phase === 'reading' ? 'center' : 'start', behavior: motionReduced() ? 'auto' : 'smooth' });
    }
  }, [state.phase]);
  const offline = api.forced || api.mode === 'sample' || st.planSource === 'sample';

  useEffect(() => {
    if (!area || offline) return;
    let alive = true;
    loadAreaStats(area)
      .then(() => alive && setAreaErr(null))
      .catch((e: unknown) => alive && setAreaErr(photoErrorKind(e)));
    return () => {
      alive = false;
    };
  }, [area, offline]);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f && field) void send(f, field.field_id, consent);
  };

  const busy = state.phase === 'preparing' || state.phase === 'reading';
  const unavailable = areaErr === 'unavailable';
  const place = field ? `${cropName(field.crop, t)} · ${countryName(field.country, lang)}` : '';

  return (
    <div className="grid gap-6" data-testid="fa-photo">
      <h2 className="t-head">{t('fa.photo.title')}</h2>
      <Suspense fallback={<div className="skeleton h-40" aria-hidden />}>
        <AiPhoto onTab={onTab} />
      </Suspense>
      {/* the earlier research model (BioCLIP 2 on the server, earned trust per area): kept, closed by default */}
      <details className="grid gap-6 border-t border-rule pt-5" data-testid="fa-photo-earlier">
        <summary className="t-head fa-hit cursor-pointer">{t('fa.photo.areaTitle')}</summary>
        <div className="mt-4 grid gap-6">
        <p className="m-0 text-ink-2">{t('fa.photo.sub')}</p>

      {offline ? (
        <section className="panel p-5" data-tone="terracotta" data-testid="fa-photo-offline">
          <p className="flex items-center gap-2 font-semibold">
            <ServerOff size={18} aria-hidden />
            {t('fa.photo.offTitle')}
          </p>
          <p className="mt-1.5 text-sm text-ink-2">{t('fa.photo.offBody')}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary fa-hit" disabled>
              <Camera size={18} aria-hidden />
              {t('fa.photo.take')}
            </button>
            <button type="button" className="btn btn-secondary fa-hit" disabled>
              <ImageIcon size={18} aria-hidden />
              {t('fa.photo.choose')}
            </button>
          </div>
          <Link to="/trust" className="btn btn-ghost fa-hit -ml-2 mt-3">
            {t('fa.photo.replay')}
            <ArrowRight size={18} className="arrow" aria-hidden />
          </Link>
        </section>
      ) : (
        <>
          <AreaStatus area={area} place={place} stats={stats} err={areaErr} />

          <div className="panel flex items-start gap-3 p-4" data-tone="monsoon">
            <div className="min-w-0 flex-1">
              <p id={consentId} className="font-semibold">
                {t('fa.photo.consent')}
              </p>
              <p className="mt-0.5 text-sm text-ink-2">{t('fa.photo.consentSub')}</p>
            </div>
            <button type="button" role="switch" aria-checked={consent} aria-labelledby={consentId} className="fa-switch" onClick={() => setConsent((c) => !c)} data-testid="fa-photo-consent">
              <span className="fa-switch-knob" aria-hidden />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary fa-hit" onClick={() => cam.current?.click()} disabled={busy || unavailable || !field} data-testid="fa-photo-take">
              <Camera size={18} aria-hidden />
              {t('fa.photo.take')}
            </button>
            <button type="button" className="btn btn-secondary fa-hit" onClick={() => pick.current?.click()} disabled={busy || unavailable || !field} data-testid="fa-photo-choose">
              <ImageIcon size={18} aria-hidden />
              {t('fa.photo.choose')}
            </button>
            <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={onFile} data-testid="fa-photo-camera-input" />
            <input ref={pick} type="file" accept="image/*" hidden onChange={onFile} data-testid="fa-photo-input" />
          </div>

          <div ref={resultRef} className="scroll-mt-4" aria-live="polite" aria-busy={busy} data-testid="fa-photo-result">
            {state.phase === 'preparing' && <p className="fa-note">{t('fa.photo.preparing')}</p>}
            {(state.phase === 'reading' || state.phase === 'done' || (state.phase === 'error' && state.preview)) && (
              <figure className="fa-shot m-0">
                <img src={state.phase === 'error' ? state.preview : state.preview} alt={t('fa.photo.previewAlt')} />
                {state.phase === 'reading' && <span className="fa-scan" aria-hidden />}
                {state.phase === 'reading' && <figcaption className="fa-shot-cap">{t('fa.photo.reading')}</figcaption>}
              </figure>
            )}
            {state.phase === 'done' && <Result c={state.c} onTab={onTab} />}
            {state.phase === 'error' && (
              <div className="panel mt-3 p-4" role="alert" data-testid="fa-photo-error">
                <p className="font-semibold">{t(`fa.photo.err.${state.kind}`)}</p>
                <p className="mono mt-1.5 break-all text-xs text-ink-3">{state.message}</p>
              </div>
            )}
          </div>
        </>
      )}
        </div>
      </details>
    </div>
  );
}

function Result({ c, onTab }: { c: PhotoCase; onTab: (t: TabId) => void }) {
  const { t } = useI18n();
  const [updating, setUpdating] = useState(false);
  const top = c.suggestion[0];

  if (c.route === 'auto' && top) {
    return (
      <section className="panel mt-3 overflow-hidden" data-testid="fa-photo-auto">
        <div className="flex items-start gap-4 p-5">
          <span className="grid size-14 flex-none place-items-center rounded-[12px] bg-go-wash text-go">
            <ShieldCheck size={28} strokeWidth={1.7} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="t-head text-go">{t('fa.photo.autoTitle')}</p>
            <p className="mt-1 text-[1.06rem] font-semibold">{photoLabelName(top.label, t)}</p>
            <p className="mt-1 text-sm text-ink-2">{t('fa.photo.autoWhy')}</p>
          </div>
        </div>
        <CaseLine c={c} />
        <div className="border-t border-rule p-3">
          <button
            type="button"
            className="btn btn-primary fa-hit w-full"
            disabled={updating}
            onClick={() => {
              setUpdating(true);
              onTab('today');
              void loadPlan({ photoCaseId: c.case_id });
            }}
          >
            <RefreshCw size={17} aria-hidden />
            {t('fa.photo.useIt')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel mt-3 overflow-hidden" data-testid="fa-photo-officer">
      <div className="flex items-start gap-4 p-5">
        <span className="grid size-14 flex-none place-items-center rounded-[12px] bg-sunk text-ink-2">
          <UserRound size={28} strokeWidth={1.7} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="t-head">{t('fa.photo.officerTitle')}</p>
          <p className="mt-1 text-sm text-ink-2">{t('fa.photo.officerWhy')}</p>
        </div>
      </div>
      <CaseLine c={c} />
    </section>
  );
}

function CaseLine({ c }: { c: PhotoCase }) {
  const { t } = useI18n();
  return (
    <dl className="m-0 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 border-t border-rule px-5 py-4 text-sm">
      <dt className="eyebrow pt-[3px]">{t('fa.abs.case')}</dt>
      <dd className="mono m-0 break-all" data-testid="fa-photo-case">
        {c.case_id}
      </dd>
      <dt className="eyebrow pt-[3px]">{t('fa.photo.kept')}</dt>
      <dd className="m-0 text-ink-2">{c.photo_available ? t('fa.photo.keptYes') : t('fa.photo.keptNo')}</dd>
    </dl>
  );
}

/** The area's evidence, read-only, from the trust gate helpers: officer checks, sure readings and the gate. */
function AreaStatus({ area, place, stats, err }: { area: string | null; place: string; stats: ReturnType<typeof useAreaStats>; err: PhotoErrorKind | null }) {
  const { t, lang } = useI18n();
  const m = meterView(stats);
  if (err === 'unavailable') {
    return (
      <p className="fa-note" data-testid="fa-photo-unavailable">
        <ServerOff size={16} aria-hidden className="flex-none" />
        {t('fa.photo.err.unavailable')}
      </p>
    );
  }
  return (
    <section className="panel p-4" data-tone="lotus" aria-labelledby="fa-area-title" data-testid="fa-area">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="fa-area-title" className="eyebrow">
          {t('fa.photo.area')}
        </h3>
        <span className="text-xs text-ink-3" title={area ?? undefined}>
          {place}
        </span>
      </div>
      <p className="mt-1.5 flex items-center gap-2 font-semibold" data-testid="fa-gate">
        {m.gateOpen ? <Check size={18} aria-hidden className="flex-none text-go" /> : <UserRound size={18} aria-hidden className="flex-none text-ink-2" />}
        <span className={cx(m.gateOpen && 'text-go')}>{m.gateOpen ? t('fa.photo.gateOpen') : t('fa.photo.gateClosed')}</span>
      </p>
      <div className="fa-meter mt-3" role="img" aria-label={t('fa.photo.meterLabel', { lb: fmtNum(m.lowerBound, lang, { maximumFractionDigits: 2 }), bar: fmtNum(m.bar, lang, { maximumFractionDigits: 2 }) })}>
        <span className="fa-meter-fill" data-open={m.gateOpen} style={{ transform: `scaleX(${m.lowerBound})` }} />
        <span className="fa-meter-bar" style={{ left: `${m.bar * 100}%` }} />
      </div>
      <dl className="m-0 mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-xs text-ink-3">{t('fa.photo.checks')}</dt>
          <dd className="mono m-0 text-lg font-semibold">{stats ? fmtNum(m.verdicts, lang) : '–'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">{t('fa.photo.sure')}</dt>
          <dd className="mono m-0 text-lg font-semibold">{stats ? `${fmtNum(m.sure, lang)}/${fmtNum(m.need, lang)}` : '–'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">{t('fa.photo.lb')}</dt>
          <dd className="mono m-0 text-lg font-semibold">
            {stats ? fmtNum(m.lowerBound, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–'}
            <span className="text-xs font-normal text-ink-3">/{fmtNum(m.bar, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}
