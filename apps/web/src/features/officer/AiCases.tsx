import { useEffect, useState } from 'react';
import { RefreshCw, ScanSearch } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import '../../lib/i18n/strings.photoai';
import { fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { useApiState } from '../../lib/api/client';
import { judgeTriage, listTriageCases, recallModel, triageHeat, triageImageUrl, type ServerHeat, type TriageCase } from '../../lib/agritriage/api';
import { niceClass } from '../../lib/agritriage/gate';
import { rgbaToRgb } from '../../lib/agritriage/xai';
import { XaiViews } from '../farmer/photo/XaiViews';

/**
 * AgriTriage-Lite photo cases for the officer (the visitor plays the officer in the demo): the farmer's photo (only with
 * consent, only until the verdict), the server's gate result, the top classes, and "Why this answer?": the server's
 * exact CAM and attention from the same run as its reading (stored with the case, so they show at once), the spots on
 * the leaf (a colour estimate made here from the photo) and, on request, the server's hide-and-check (occlusion) test. A verdict feeds the area's ledger: earned trust and the coverage check (photo-trust policy v2).
 */
const OUT_TONE = { diagnose: 'chip-go', shortlist: 'chip-wait', refer: 'chip-stop' } as const;

/** The square the model saw (shorter side scaled to 256, centre 224), as RGB bytes: what the views are drawn on. */
async function square(url: string, S = 224): Promise<Uint8Array> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const side = (Math.min(img.naturalWidth, img.naturalHeight) * 224) / 256;
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, side, side, 0, 0, S, S);
  return rgbaToRgb(g.getImageData(0, 0, S, S).data);
}

export function AiCases() {
  const { t } = useI18n();
  const api = useApiState();
  const recorded = api.forced || api.mode === 'sample';
  const [cases, setCases] = useState<TriageCase[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    listTriageCases()
      .then((c) => {
        setCases(c);
        setErr(null);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    if (!recorded) void load();
  }, [recorded]);

  if (recorded || cases === null) return null;
  return (
    <section className="mb-6 grid gap-3" aria-labelledby="off-ai-title" data-testid="off-ai">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="off-ai-title" className="t-head m-0">
            {t('off.photo.ai.title')}
          </h2>
          <p className="m-0 mt-1 text-sm text-ink-2">{t('off.photo.ai.lead')}</p>
          <p className="chip mt-2 max-w-full whitespace-normal">{t('off.photo.ai.weights')}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
          <RefreshCw size={15} aria-hidden />
          {t('off.photo.ai.refresh')}
        </button>
      </div>
      {err && <p className="mono m-0 break-all text-xs text-ink-3">{err}</p>}
      <ModelRecall />
      {cases.length === 0 && <p className="m-0 text-sm text-ink-3">{t('off.photo.ai.empty')}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {(cases ?? []).map((c) => (
          <AiCase key={c.case_id} c={c} onJudged={(n) => setCases((cs) => (cs ?? []).map((x) => (x.case_id === n.case_id ? n : x)))} />
        ))}
      </div>
    </section>
  );
}

function AiCase({ c, onJudged }: { c: TriageCase; onJudged: (c: TriageCase) => void }) {
  const { t, lang } = useI18n();
  const r = c.reading;
  const url = c.photo_available ? triageImageUrl(c.case_id) : null;
  const [heat, setHeat] = useState<{ k: 'idle' } | { k: 'running' } | { k: 'done'; h: ServerHeat } | { k: 'error'; m: string }>(c.heat ? { k: 'done', h: c.heat } : { k: 'idle' });
  const [rgb, setRgb] = useState<Uint8Array | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    square(url)
      .then((d) => live && setRgb(d))
      .catch(() => undefined); // the plain photo stays; the views need the pixels
    return () => {
      live = false;
    };
  }, [url]);
  const [label, setLabel] = useState(r.labels[0]?.label ?? '');
  const [sending, setSending] = useState(false);
  const showWhere = async () => {
    if (!url) return;
    setHeat({ k: 'running' });
    try {
      setHeat({ k: 'done', h: c.heat ?? (await triageHeat(c.case_id)) });
    } catch (e) {
      setHeat({ k: 'error', m: e instanceof Error ? e.message : String(e) });
    }
  };
  const judge = async () => {
    setSending(true);
    try {
      onJudged((await judgeTriage(c.case_id, label)).case);
    } catch {
      /* already judged elsewhere: the refresh shows the server's state */
    } finally {
      setSending(false);
    }
  };
  return (
    <article className="panel grid gap-3 p-4" data-testid="off-ai-case" data-route={c.route}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx('chip', OUT_TONE[r.outcome])}>{t(`off.photo.ai.out.${r.outcome}` as Key)}</span>
        <span className="chip">{t(`off.photo.ai.route.${c.route}` as Key)}</span>
        <span className="mono text-xs text-ink-3">{c.case_id}</span>
      </div>
      <p className="m-0 text-sm text-ink-2">
        {t('off.photo.ai.gate', {
          mode: t(r.mode === 'crop_known' ? 'off.photo.ai.cropKnown' : 'off.photo.ai.anyCrop'),
          n: fmtNum(r.set.length, lang),
          q: fmtNum(r.q, lang, { maximumFractionDigits: 3 }),
          area: c.area,
        })}
      </p>
      {url && rgb ? (
        <XaiViews
          tid="off-ai"
          rgb={rgb}
          size={224}
          target={c.xai?.target ?? r.labels[0]?.label ?? ''}
          cam={c.xai ? { cells: c.xai.cam, bias: c.xai.cam_bias, logit: c.xai.logit } : null}
          attention={c.xai?.attention ?? null}
          occlusion={heat.k === 'done' ? { heat: heat.h.heat, grid: heat.h.grid } : null}
          occlusionData={heat.k === 'done' ? { where: 'server', grid: heat.h.grid } : undefined}
          photoAlt={t('off.photo.ai.photoAlt')}
          occlusionSlot={
            <>
              {heat.k !== 'done' && (
                <button type="button" className="btn btn-secondary btn-sm justify-self-start" disabled={heat.k === 'running'} onClick={() => void showWhere()} data-testid="off-ai-where">
                  <ScanSearch size={16} aria-hidden />
                  {heat.k === 'running' ? t('off.photo.ai.whereRunning') : t('off.photo.ai.where')}
                </button>
              )}
              {heat.k === 'error' && <p className="mono m-0 break-all text-xs text-ink-3">{heat.m}</p>}
            </>
          }
        />
      ) : url ? (
        <img src={url} alt={t('off.photo.ai.photoAlt')} className="aspect-[4/3] w-full rounded-[12px] object-cover" />
      ) : (
        <p className="m-0 text-sm text-ink-3">{t('off.photo.ai.noPhoto')}</p>
      )}
      <ul className="m-0 grid list-none gap-1 p-0 text-sm">
        {r.labels.slice(0, 3).map((l) => (
          <li key={l.label} className="flex justify-between gap-3">
            <span lang="en" className={cx(r.set.includes(l.label) && 'font-semibold')}>
              {niceClass(l.label)}
            </span>
            <span className="mono">{fmtNum(Math.round(l.prob * 1000) / 10, lang, { maximumFractionDigits: 1 })}%</span>
          </li>
        ))}
      </ul>
      {c.verdict ? (
        <p className="m-0 font-semibold" data-testid="off-ai-verdict">
          {t('off.photo.ai.judged', { label: niceClass(c.verdict) })}
        </p>
      ) : c.route === 'officer' ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span className="eyebrow">{t('off.photo.ai.verdict')}</span>
            <select className="input" value={label} onChange={(e) => setLabel(e.target.value)}>
              {r.labels.map((l) => (
                <option key={l.label} value={l.label}>
                  {niceClass(l.label)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary btn-sm" disabled={sending || !label} onClick={() => void judge()} data-testid="off-ai-judge">
            {t('off.photo.ai.confirm')}
          </button>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Recall the photo model in this sandbox ("recall a model, not only a rule"): its ModelCredential is revoked, so every
 * receipt that cited one of its readings verifies as Recalled, on the farmer's phone too, and it gives no new receipts.
 */
function ModelRecall() {
  const { t, lang } = useI18n();
  const [st, setSt] = useState<{ k: 'idle' } | { k: 'confirm' } | { k: 'busy' } | { k: 'done'; n: number } | { k: 'error'; m: string }>({ k: 'idle' });
  const go = async () => {
    setSt({ k: 'busy' });
    try {
      const r = await recallModel('officer console: recall of the photo model (demo sandbox)');
      setSt({ k: 'done', n: r.recalled_model_credentials.length });
    } catch (e) {
      setSt({ k: 'error', m: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="panel grid gap-2 p-4" data-testid="off-ai-recall">
      {st.k === 'done' ? (
        <p className="m-0 font-semibold" role="status">
          {t('off.photo.ai.recallDone', { n: fmtNum(st.n, lang) })}
        </p>
      ) : st.k === 'confirm' || st.k === 'busy' ? (
        <>
          <p className="m-0 text-sm">{t('off.photo.ai.recallAsk')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={st.k === 'busy'} onClick={() => void go()} data-testid="off-ai-recall-confirm">
              {t('off.photo.ai.recallConfirm')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={st.k === 'busy'} onClick={() => setSt({ k: 'idle' })}>
              {t('off.photo.ai.recallCancel')}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-sm text-ink-2">{t('off.photo.ai.recallLead')}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSt({ k: 'confirm' })} data-testid="off-ai-recall-start">
            {t('off.photo.ai.recall')}
          </button>
        </div>
      )}
      {st.k === 'error' && <p className="mono m-0 break-all text-xs text-ink-3">{st.m}</p>}
    </div>
  );
}
