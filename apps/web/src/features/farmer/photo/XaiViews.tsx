import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Crosshair, Grid3x3, ScanEye, ScanSearch, type LucideIcon } from 'lucide-react';
import { useI18n, type Key } from '../../../lib/i18n';
import '../../../lib/i18n/strings.photoai';
import { fmtNum } from '../../../lib/format';
import { cx } from '../../../lib/cx';
import { niceClass } from '../../../lib/agritriage/gate';
import { attentionView, camUnit, GRID, gradcamUnit, lesion, overlap, upsample } from '../../../lib/agritriage/xai';
import { Comparer } from '../../../ui/kit/Comparer';
import { COOL, heatUrl, LEAF, photoUrl, rampCss, SPOT, spotsUrl, WARM } from './xaiDraw';
import './xai.css';

/**
 * "Why this answer?": four ways to look inside the photo model, each in the same drag-to-compare slider.
 * 1. Where the AI looked: the exact class activation map (CAM) from model_xai.onnx, same run as the answer.
 * 2. What the AI paid attention to: the stage-3 self-attention each square receives, same run.
 * 3. Spots on the leaf: a colour estimate of the lesions and their share of the leaf (NOT the model), with how much of
 *    the CAM falls on them.
 * 4. Hide-and-check test: the occlusion map, which needs extra runs (the parent runs it and passes the result in).
 * Used by the farmer's Photo tab, the /try page's leaf tool and the officer's photo cases. Maths: lib/agritriage/xai.ts.
 */
export type ViewId = 'cam' | 'attention' | 'spots' | 'occlusion';
const VIEWS: { id: ViewId; icon: LucideIcon }[] = [
  { id: 'cam', icon: Crosshair },
  { id: 'attention', icon: ScanEye },
  { id: 'spots', icon: ScanSearch },
  { id: 'occlusion', icon: Grid3x3 },
];

export interface XaiViewsProps {
  /** test ids start with this (fa-ai, leaf, off-ai) */
  tid: string;
  /** the square the model saw: S*S*3 RGB bytes */
  rgb: Uint8Array;
  size: number;
  /** the class explained (the model's English label) */
  target: string;
  cam: { cells: ArrayLike<number>; bias: number; logit: number; grad?: ArrayLike<number> } | null;
  /** attention each of the 49 squares receives (sums to 1) */
  attention: ArrayLike<number> | null;
  occlusion: { heat: number[]; grid: number } | null;
  /** the parent's controls for the hide-and-check test (a button, a progress bar, where it ran) */
  occlusionSlot?: ReactNode;
  /** extra attributes for the comparer while it shows the occlusion map (where, grid) */
  occlusionData?: Record<string, string | number>;
  photoAlt: string;
}

const pct1 = (v: number, lang: 'en' | 'bn' | string) => fmtNum(Math.round(v * 10) / 10, lang as never, { maximumFractionDigits: 1 });

export function XaiViews(p: XaiViewsProps) {
  const { t, lang } = useI18n();
  const hasXai = !!p.cam && !!p.attention;
  const [view, setView] = useState<ViewId>(hasXai ? 'cam' : 'occlusion');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const S = p.size;

  const photo = useMemo(() => photoUrl(p.rgb, S), [p.rgb, S]);
  // true Grad-CAM when the model gives it (model_xai.onnx since 20 Nov); the exact CAM otherwise (the server's cases)
  const isGrad = !!p.cam?.grad;
  const camMap = useMemo(() => (p.cam ? (p.cam.grad ? gradcamUnit(p.cam.grad) : camUnit(p.cam.cells)) : null), [p.cam]);
  const att = useMemo(() => (p.attention ? attentionView(p.attention) : null), [p.attention]);
  const les = useMemo(() => lesion(p.rgb, S), [p.rgb, S]);
  const ov = useMemo(() => (camMap ? overlap(upsample(camMap, GRID, S), les) : null), [camMap, les, S]);
  // overlays are drawn when first shown (each ~10 ms), then kept
  const after = useMemo(() => {
    if (view === 'cam' && camMap) return heatUrl(p.rgb, S, camMap, GRID, WARM);
    if (view === 'attention' && att) return heatUrl(p.rgb, S, att.view, GRID, COOL, { sinks: att.sinks });
    if (view === 'spots') return spotsUrl(p.rgb, S, les);
    if (view === 'occlusion' && p.occlusion) return heatUrl(p.rgb, S, p.occlusion.heat, p.occlusion.grid, WARM, { blocky: true });
    return null;
  }, [view, camMap, att, les, p.occlusion, p.rgb, S]);

  const label = niceClass(p.target);
  const camErr = p.cam ? Math.abs(Array.from(p.cam.cells).reduce((s, v) => s + v, 0) + p.cam.bias - p.cam.logit) : null;
  const enabled = (v: ViewId) => v === 'occlusion' || v === 'spots' || hasXai;
  const onKey = (e: KeyboardEvent, i: number) => {
    const order = VIEWS.filter((v) => enabled(v.id));
    const at = order.findIndex((v) => v.id === VIEWS[i]!.id);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (at + 1) % order.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (at - 1 + order.length) % order.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = order.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = order[next]!.id;
    setView(id);
    tabs.current[VIEWS.findIndex((v) => v.id === id)]?.focus();
  };
  const panelId = `${p.tid}-xai-panel`;

  return (
    <section className="xai grid gap-3" data-testid={`${p.tid}-xai`} data-view={view} aria-labelledby={`${p.tid}-xai-title`}>
      <div>
        <h4 id={`${p.tid}-xai-title`} className="eyebrow m-0">
          {t('photoai.xai.title')}
        </h4>
        <p className="m-0 mt-1 text-sm text-ink-2">{hasXai ? t('photoai.xai.sub') : t('photoai.xai.none')}</p>
      </div>
      <div className="xai-tabs" role="tablist" aria-label={t('photoai.xai.tabs')}>
        {VIEWS.map(({ id, icon: Icon }, i) => (
          <button
            key={id}
            ref={(el) => void (tabs.current[i] = el)}
            type="button"
            role="tab"
            id={`${p.tid}-xai-tab-${id}`}
            aria-selected={view === id}
            aria-controls={panelId}
            tabIndex={view === id ? 0 : -1}
            disabled={!enabled(id)}
            className="xai-tab"
            onClick={() => setView(id)}
            onKeyDown={(e) => onKey(e, i)}
            data-testid={`${p.tid}-xai-tab-${id}`}
          >
            <Icon size={16} aria-hidden className="flex-none" />
            <span>{t((id === 'cam' && isGrad ? 'photoai.xai.tab.gradcam' : `photoai.xai.tab.${id}`) as Key)}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={panelId} aria-labelledby={`${p.tid}-xai-tab-${view}`} className="grid gap-2.5">
        {after ? (
          <div data-testid={`${p.tid}-xai-cmp`} data-view={view} {...(view === 'occlusion' ? dataAttrs(p.occlusionData) : {})}>
            <Comparer
              className="aspect-square w-full overflow-hidden rounded-[12px]"
              before={<img src={photo} alt={p.photoAlt} />}
              after={<img src={after} alt="" />}
              beforeLabel={t('photoai.xai.photo')}
              afterLabel={t(`photoai.xai.short.${view}` as Key)}
              label={t(`photoai.xai.slider.${view}` as Key)}
              initial={50}
            />
          </div>
        ) : (
          <img src={photo} alt={p.photoAlt} className="aspect-square w-full max-w-[14rem] rounded-[12px] object-cover" />
        )}

        {after && <Legend view={view} />}

        {view === 'cam' && p.cam && (
          <>
            <p className="m-0 text-sm font-semibold" data-testid={`${p.tid}-xai-say`}>
              {t(isGrad ? 'photoai.xai.say.gradcam' : 'photoai.xai.say.cam', { label })}
            </p>
            <p className="m-0 text-xs text-ink-3">{t('photoai.xai.ready')}</p>
          </>
        )}
        {view === 'attention' && (
          <>
            <p className="m-0 text-sm font-semibold" data-testid={`${p.tid}-xai-say`}>
              {t('photoai.xai.say.attention')}
            </p>
            <p className="m-0 text-xs text-ink-3">{t('photoai.xai.ready')}</p>
          </>
        )}
        {view === 'spots' && (
          <div className="grid gap-1.5" data-testid={`${p.tid}-xai-spots`} data-verdict={ov?.verdict ?? (les.leafFound ? 'none' : 'no_leaf')}>
            <p className="chip m-0 w-fit max-w-full whitespace-normal" data-testid={`${p.tid}-xai-lesion-label`}>
              {t('photoai.xai.lesionLabel')}
            </p>
            <p className="m-0 text-sm font-semibold" data-testid={`${p.tid}-xai-say`}>
              {t('photoai.xai.say.spots')}{' '}
              {les.severityPct !== null && (
                <span data-testid={`${p.tid}-xai-severity`} data-pct={Math.round(les.severityPct * 10) / 10}>
                  {t('photoai.xai.severity', { pct: pct1(les.severityPct, lang) })}
                </span>
              )}
            </p>
            {les.severityPct !== null && les.severityPct >= 0.5 && (
              <p className="m-0 text-xs text-ink-3">
                {t('photoai.xai.kinds', { brown: pct1(les.kindsPct.brown ?? 0, lang), yellow: pct1(les.kindsPct.yellow ?? 0, lang), dark: pct1(les.kindsPct.dark ?? 0, lang) })}
              </p>
            )}
            {ov ? (
              <p className="m-0 text-sm" data-testid={`${p.tid}-xai-overlap`} data-verdict={ov.verdict}>
                <strong>{t(`photoai.xai.ov.${ov.verdict}` as Key)}</strong>
                {ov.verdict !== 'no_leaf' && ov.verdict !== 'no_spots' && (
                  <span className="text-ink-2"> {t('photoai.xai.ovNumbers', { on: pct1(ov.onSpotsPct, lang), area: pct1(ov.spotAreaPct, lang) })}</span>
                )}
              </p>
            ) : (
              !les.leafFound && <p className="m-0 text-sm">{t('photoai.xai.ov.no_leaf')}</p>
            )}
          </div>
        )}
        {view === 'occlusion' && (
          <>
            {p.occlusion && (
              <p className="m-0 text-sm font-semibold" data-testid={`${p.tid}-xai-say`}>
                {t('photoai.xai.say.occlusion', { label })}
              </p>
            )}
            {p.occlusionSlot}
          </>
        )}

        <details className="xai-can text-sm">
          <summary>{t('photoai.xai.canTitle')}</summary>
          <p className="m-0 mt-1.5 text-ink-2">{t(`photoai.xai.can.${view}` as Key)}</p>
          {view === 'cam' && camErr !== null && (
            <p className="mono m-0 mt-1.5 text-xs text-ink-3" data-testid={`${p.tid}-xai-check`} data-cam-error={camErr}>
              {t('photoai.xai.check', { err: camErr < 1e-4 ? '< 0.0001' : fmtNum(Math.round(camErr * 1e4) / 1e4, lang) })}
            </p>
          )}
          {view === 'cam' && isGrad && <p className="m-0 mt-1.5 text-xs text-ink-3">{t('photoai.xai.checkGrad')}</p>}
        </details>
      </div>
    </section>
  );
}

function dataAttrs(d?: Record<string, string | number>) {
  return Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [`data-${k}`, String(v)]));
}

function Legend({ view }: { view: ViewId }) {
  const { t } = useI18n();
  if (view === 'spots') {
    return (
      <ul className="xai-legend" aria-label={t('photoai.xai.tab.spots')}>
        <li>
          <span className="xai-swatch xai-swatch-spot" style={{ background: SPOT }} aria-hidden />
          {t('photoai.xai.legend.spots')}
        </li>
        <li>
          <span className="xai-swatch xai-swatch-leaf" style={{ borderColor: LEAF }} aria-hidden />
          {t('photoai.xai.legend.leaf')}
        </li>
      </ul>
    );
  }
  return (
    <div className="grid gap-1.5">
      <div className="xai-ramp" aria-hidden>
        <span className="xai-ramp-bar" style={{ background: rampCss(view === 'attention' ? COOL : WARM) }} />
      </div>
      <div className="flex justify-between text-xs text-ink-2">
        <span>{t('photoai.xai.less')}</span>
        <span>{t('photoai.xai.more')}</span>
      </div>
      <ul className="xai-legend">
        <li>
          <span className="xai-swatch xai-swatch-line" aria-hidden />
          {t('photoai.xai.strongest')}
        </li>
        {view === 'attention' && (
          <li className={cx('min-w-0')}>
            <span className="xai-swatch xai-swatch-ring" aria-hidden />
            {t('photoai.xai.sink')}
          </li>
        )}
      </ul>
    </div>
  );
}
