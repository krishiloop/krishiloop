import { useEffect, useRef } from 'react';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/cx';
import { availableLayers, type OverlayLayer, type PhotoOverlay, type Plane } from './overlay';

/**
 * A leaf photo with room for what a future model can say about it.
 *
 *  - The photo fills a square. The corner marks show the area the model reads (the centre 87.5% of the short side),
 *    and the rim outside it is dimmed a little: "inside the marks is what was read".
 *  - Layers (leaf mask, lesion boxes, attention heat) are drawn in the model's own crop space, so whatever the v1
 *    student returns lines up with no extra maths. With no overlay data nothing extra is drawn and no toggle shows.
 *  - Everything drawn on top is aria-hidden; what it means is carried by the caption text next to the photo.
 *  - While the engine reads the photo (`scanning`) a soft gold line sweeps down it: something is looking, not stuck.
 */
export function PhotoCanvas({
  src,
  alt,
  overlay,
  layers,
  frame = true,
  scanning = false,
  className,
}: {
  src: string;
  alt: string;
  overlay?: PhotoOverlay | null;
  /** which overlay layers to draw; default = every layer the overlay has */
  layers?: readonly OverlayLayer[];
  frame?: boolean;
  /** the engine is reading this photo: a gold line sweeps over it */
  scanning?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const on = layers ?? availableLayers(overlay);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const showMask = !!overlay?.mask && on.includes('mask');
  const showHeat = !!overlay?.heat && on.includes('heat');
  const showLesions = !!overlay?.lesions?.length && on.includes('lesions');

  useEffect(() => {
    if (showMask) paint(maskRef.current, overlay!.mask!, (v) => [8, 12, 10, Math.round((255 - v) * 0.62)]);
  }, [showMask, overlay]);
  useEffect(() => {
    if (showHeat) paint(heatRef.current, overlay!.heat!, (v) => [240, 201, 107, Math.round(v * 0.78)]);
  }, [showHeat, overlay]);

  return (
    <div className={cx('pc', className)} data-frame={frame} data-scan={scanning}>
      <img src={src} alt={alt} draggable={false} />
      {frame ? (
        <div className="pc-frame" aria-hidden>
          {showMask ? <canvas ref={maskRef} className="pc-plane" width={overlay!.mask!.size} height={overlay!.mask!.size} /> : null}
          {showHeat ? <canvas ref={heatRef} className="pc-plane pc-heat" width={overlay!.heat!.size} height={overlay!.heat!.size} /> : null}
          {showLesions
            ? overlay!.lesions!.map((l, i) => (
                <span key={i} className="pc-lesion" style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}>
                  <i>{i + 1}</i>
                </span>
              ))
            : null}
        </div>
      ) : null}
      {overlay?.sample ? <span className="pc-badge">{t('photo.sampleOverlay')}</span> : null}
    </div>
  );
}

/** Draw a 0..255 plane into a canvas, one RGBA pixel per value. */
function paint(canvas: HTMLCanvasElement | null, plane: Plane, rgba: (v: number) => [number, number, number, number]) {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return;
  const img = ctx.createImageData(plane.size, plane.size);
  for (let i = 0; i < plane.size * plane.size; i++) {
    const [r, g, b, a] = rgba(plane.data[i] ?? 0);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
}

/** Switches for the layers the overlay actually has. Renders nothing when there is nothing to switch. */
export function LayerToggle({ overlay, value, onChange }: { overlay?: PhotoOverlay | null; value: readonly OverlayLayer[] | null; onChange: (next: OverlayLayer[]) => void }) {
  const { t } = useI18n();
  const all = availableLayers(overlay);
  if (!all.length) return null;
  const on = value ?? all;
  const label: Record<OverlayLayer, string> = { mask: t('photo.layer.mask'), lesions: t('photo.layer.lesions'), heat: t('photo.layer.heat') };
  return (
    <div className="pc-layers" role="group" aria-label={t('photo.layers')}>
      {all.map((l) => (
        <button key={l} type="button" className="pc-layer" aria-pressed={on.includes(l)} onClick={() => onChange(on.includes(l) ? on.filter((x) => x !== l) : [...on, l])}>
          {label[l]}
        </button>
      ))}
    </div>
  );
}
