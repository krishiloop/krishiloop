import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, CircleQuestionMark, ListChecks, Loader2, PenTool, RotateCcw, ScanSearch, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { gate, niceClass, topClasses, type GateResult, type Outcome } from '../../lib/agritriage/gate';
import { heatColour } from '../../lib/agritriage/occlusion';
import { decodeImage, loadRuntime, occlusionMap, preprocess, readPhoto, type Reading, type Runtime } from '../../lib/agritriage/runtime';
import { Comparer } from '../../ui/kit/Comparer';
import { drawTestLeaf } from './testLeaf';
import { Choice } from './parts';

/** public/models/agritriage/config.json `model_mb` (the INT8 student, 11,500,687 bytes): said before anything loads. */
const MODEL_MB = 11.5;
type Crop = 'any' | 'rice' | 'potato';
type Phase =
  | { k: 'idle' }
  | { k: 'loading' }
  | { k: 'reading' }
  | { k: 'done'; reading: Reading; photo: string; test: boolean }
  | { k: 'error'; kind: 'model' | 'image' };
type Heat = { k: 'idle' } | { k: 'running'; done: number; total: number; grid: number } | { k: 'done'; url: string; grid: number };

const GATE: { o: Outcome; icon: LucideIcon; tone: string }[] = [
  { o: 'diagnose', icon: ShieldCheck, tone: 'is-sure' },
  { o: 'shortlist', icon: ListChecks, tone: 'is-unsure' },
  { o: 'refer', icon: UserRound, tone: 'is-risky' },
];

/** The 224 px square the model saw (CHW floats back to pixels), with the occlusion map over it when given. */
function squareUrl(x: Float32Array, S: number, heat?: number[], grid = 7): string {
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(S, S);
  const n = S * S;
  for (let i = 0; i < n; i++) {
    img.data[4 * i] = Math.round(x[i]! * 255);
    img.data[4 * i + 1] = Math.round(x[n + i]! * 255);
    img.data[4 * i + 2] = Math.round(x[2 * n + i]! * 255);
    img.data[4 * i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  if (heat) {
    const h = document.createElement('canvas');
    h.width = grid;
    h.height = grid;
    const hg = h.getContext('2d')!;
    const hd = hg.createImageData(grid, grid);
    heat.forEach((v, i) => hd.data.set(heatColour(v), 4 * i));
    hg.putImageData(hd, 0, 0);
    g.globalAlpha = 0.25;
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    g.globalAlpha = 1;
    g.imageSmoothingEnabled = true;
    g.drawImage(h, 0, 0, S, S);
  }
  return cv.toDataURL('image/jpeg', 0.88);
}

const modelCrop = (c: Crop) => (c === 'any' ? null : c);

/**
 * "Check a leaf photo": the AgriTriage-Lite student (lib/agritriage, builder P) reads the photo inside the browser; the
 * model and its runtime load only when the visitor starts. The conformal gate answers diagnose / shortlist / refer;
 * changing the crop re-runs the gate on the same reading at once. "Where it looked" is the occlusion map in the Comparer.
 * Research weights (trained on PlantWild, non-commercial). No sample photos are shipped: the visitor's own, or a drawn leaf.
 */
export default function LeafTool() {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const [crop, setCrop] = useState<Crop>('any');
  const [heat, setHeat] = useState<Heat>({ k: 'idle' });
  const rt = useRef<Runtime | null>(null);
  const cancel = useRef({ cancelled: false });
  const fileRef = useRef<HTMLInputElement>(null);

  const result: GateResult | null = phase.k === 'done' && rt.current ? gate(phase.reading.logits, rt.current.cfg, modelCrop(crop)) : null;
  const target = result?.order[0] ?? -1;

  async function run(src: () => Promise<CanvasImageSource & { width: number; height: number; close?: () => void }>, test: boolean) {
    cancel.current.cancelled = true;
    cancel.current = { cancelled: false };
    setHeat({ k: 'idle' });
    try {
      if (!rt.current) {
        setPhase({ k: 'loading' });
        rt.current = await loadRuntime();
      }
    } catch {
      setPhase({ k: 'error', kind: 'model' });
      return;
    }
    setPhase({ k: 'reading' });
    try {
      const img = await src();
      const x = preprocess(img, rt.current.cfg);
      img.close?.();
      const reading = await readPhoto(rt.current, x, modelCrop(crop));
      setPhase({ k: 'done', reading, photo: squareUrl(x, rt.current.cfg.input_size), test });
    } catch {
      setPhase({ k: 'error', kind: 'image' });
    }
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void run(() => decodeImage(f), false);
  };

  // "Where it looked": a quick 4 x 4 map for the top class whenever the reading or the crop changes
  useEffect(() => {
    if (phase.k !== 'done' || !rt.current || target < 0) return;
    void map(4);
    return () => {
      cancel.current.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, target, crop]);

  async function map(grid: number) {
    if (phase.k !== 'done' || !rt.current) return;
    const sig = { cancelled: false };
    cancel.current = sig;
    setHeat({ k: 'running', done: 0, total: grid * grid, grid });
    // the map measures drops from the answer for the crop chosen NOW (the reading may have been made in another mode)
    const now = { ...phase.reading, result: gate(phase.reading.logits, rt.current.cfg, modelCrop(crop)) };
    const h = await occlusionMap(rt.current, now, modelCrop(crop), target, (done, total) => setHeat({ k: 'running', done, total, grid }), sig, 8, grid);
    if (!h || sig.cancelled) return;
    setHeat({ k: 'done', url: squareUrl(phase.reading.x, rt.current.cfg.input_size, h.heat, grid), grid });
  }

  const busy = phase.k === 'loading' || phase.k === 'reading';
  return (
    <div className="try-leaf">
      <p className="flex flex-wrap gap-2">
        <span className="chip chip-carbon" data-testid="leaf-weights">
          {t('try.leaf.weights')}
        </span>
      </p>
      <p className="text-sm text-ink-2">{t('try.leaf.private')}</p>

      <Choice
        label={t('try.leaf.crop')}
        value={crop}
        onChange={setCrop}
        testId="leaf-crop"
        options={[
          { value: 'any', label: t('try.leaf.any') },
          { value: 'rice', label: t('try.leaf.rice') },
          { value: 'potato', label: t('try.leaf.potato') },
        ]}
      />

      <div className="try-leaf-start">
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={onFile} data-testid="leaf-file" />
        <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="leaf-pick">
          <Camera size={18} aria-hidden /> {phase.k === 'done' ? t('try.leaf.again') : t('try.leaf.pick')}
        </button>
        <button type="button" className="try-chipbtn" onClick={() => void run(async () => drawTestLeaf(), true)} disabled={busy} data-testid="leaf-test">
          <PenTool size={14} aria-hidden /> {t('try.leaf.test')}
        </button>
      </div>
      {phase.k === 'idle' && <p className="try-slider-hint">{t('try.leaf.size', { mb: fmtNum(MODEL_MB, lang) })}</p>}

      <div aria-live="polite">
        {busy && (
          <p className="try-busy" data-testid="leaf-busy">
            <Loader2 size={16} aria-hidden className="animate-spin" /> {phase.k === 'loading' ? t('try.leaf.loading', { mb: fmtNum(MODEL_MB, lang) }) : t('try.leaf.reading')}
          </p>
        )}
        {phase.k === 'error' && (
          <p className="try-abstain" data-testid="leaf-error">
            <CircleQuestionMark size={18} aria-hidden /> {phase.kind === 'model' ? t('try.leaf.errModel') : t('try.leaf.errImage')}
          </p>
        )}
      </div>

      {phase.k === 'done' && result && rt.current && (
        <div className="try-leaf-out" data-testid="leaf-result" data-outcome={result.outcome}>
          {phase.test && <p className="chip chip-carbon w-fit">{t('try.leaf.testNote')}</p>}
          <div>
            <p className="eyebrow">{t('try.gate.title')}</p>
            <ol className="try-gate" aria-label={t('try.gate.title')}>
              {GATE.map(({ o, icon: Icon, tone }) => (
                <li key={o} className={cx('try-gate-step', tone, o === result.outcome && 'is-on')} aria-current={o === result.outcome ? 'true' : undefined}>
                  <Icon size={16} aria-hidden />
                  <span>{t(`try.gate.${o}` as Key)}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-sm" data-testid="leaf-why">
              {result.reason === 'single'
                ? t('try.gate.why.single')
                : result.reason === 'few'
                  ? t('try.gate.why.few', { n: fmtNum(result.set.length, lang) })
                  : result.reason === 'many'
                    ? t('try.gate.why.many', { n: fmtNum(result.set.length, lang) })
                    : t('try.gate.why.unknown')}
            </p>
          </div>

          <div>
            <p className="eyebrow">{t('try.leaf.top')}</p>
            <ul className="try-top" data-testid="leaf-top">
              {topClasses(result, rt.current.cfg, 3).map((c) => (
                <li key={c.label}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span lang="en" className="font-medium">
                      {niceClass(c.label)}
                    </span>
                    <span className="mono text-sm">{fmtNum(c.prob * 100, lang, { maximumFractionDigits: 1 })}%</span>
                  </span>
                  <span className="try-top-bar" aria-hidden>
                    <span style={{ transform: `scaleX(${c.prob})` }} />
                  </span>
                  {c.inSet && <span className="text-xs text-ink-2">{t('try.leaf.inSet')}</span>}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-ink-3">{t('try.leaf.namesNote')}</p>
          </div>

          <div>
            <p className="eyebrow flex items-center gap-2">
              <ScanSearch size={14} aria-hidden /> {t('try.leaf.where')}
            </p>
            {heat.k === 'done' ? (
              <Comparer
                className="try-cmp aspect-square"
                before={<img src={phase.photo} alt="" />}
                after={<img src={heat.url} alt="" />}
                beforeLabel={t('try.leaf.photo')}
                afterLabel={t('try.leaf.where')}
                label={t('try.leaf.compare')}
                initial={50}
              />
            ) : (
              <div className="try-cmp aspect-square try-cmp-wait">
                <img src={phase.photo} alt="" />
              </div>
            )}
            <p className="mt-2 text-xs text-ink-2" data-testid="leaf-map-state">
              {heat.k === 'running' ? t('try.leaf.mapping', { done: fmtNum(heat.done, lang), total: fmtNum(heat.total, lang) }) : heat.k === 'done' ? t('try.leaf.mapNote') : ''}
            </p>
            {heat.k === 'done' && heat.grid < 7 && (
              <button type="button" className="try-chipbtn mt-2" onClick={() => void map(7)} data-testid="leaf-sharper">
                <RotateCcw size={14} aria-hidden /> {t('try.leaf.sharper')}
              </button>
            )}
            <p className="mt-2 text-xs text-ink-3">{t('try.leaf.ms', { ms: fmtNum(Math.round(phase.reading.ms), lang) })}</p>
          </div>
        </div>
      )}
    </div>
  );
}
