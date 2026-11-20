import { useEffect, useRef, useState } from 'react';
import { useI18n, type Key } from '../../lib/i18n';
import { Comparer } from '../../ui/kit/Comparer';
import { useOnScreen } from '../../ui/kit/hooks';

/**
 * The plant doctor's card on the home page: REAL output of the photo AI, not a drawing (owner, 20 Nov). One real rice
 * blast photo (RiceLeafDiseaseBD, Munna et al., Mendeley Data, CC BY 4.0) went through the leaf tool on /try, and these
 * are the images that tool drew: the photo the model saw, true Grad-CAM (the class score's gradient, model_xai.onnx), the
 * stage-3 attention map, and the lesion mask (a colour estimate, not the model). The model read it as rice blast, 76.6 %.
 *
 * Motion: the view changes by itself every few seconds while the card is on screen (an explanation: three ways to look
 * inside the same answer). It waits while a pointer rests on it or after a touch; reduced motion keeps it still. The
 * views cross-fade (opacity, 280 ms, strong ease-out) so the photo underneath never jumps.
 */
const VIEWS = [
  { id: 'gradcam', src: '/xai-example/gradcam.webp', name: 'home.pi.xai.gradcam', say: 'home.pi.xai.gradcam.say' },
  { id: 'attention', src: '/xai-example/attention.webp', name: 'home.pi.xai.attention', say: 'home.pi.xai.attention.say' },
  { id: 'lesion', src: '/xai-example/lesion.webp', name: 'home.pi.xai.lesion', say: 'home.pi.xai.lesion.say' },
] as const;
const STEP_MS = 3600;

export function RealXai() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(ref);
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => setReduced(!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches), []);
  useEffect(() => {
    if (!onScreen || held || reduced) return;
    const id = window.setTimeout(() => setI((v) => (v + 1) % VIEWS.length), STEP_MS);
    return () => window.clearTimeout(id);
  }, [i, onScreen, held, reduced]);
  const hold = () => {
    setHeld(true);
    window.setTimeout(() => setHeld(false), 6000);
  };
  const cur = VIEWS[i]!;

  return (
    <div ref={ref} className="rx" data-testid="real-xai" data-view={cur.id} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} onPointerDown={hold}>
      <Comparer
        className="rx-cmp aspect-square w-full"
        initial={42}
        label={t('home.pi.xai.cmp')}
        before={<img src="/xai-example/photo.webp" alt={t('home.pi.xai.alt')} width={448} height={448} loading="lazy" decoding="async" />}
        after={
          <span className="rx-stack" aria-hidden>
            {VIEWS.map((v, k) => (
              <img key={v.id} src={v.src} alt="" width={448} height={448} loading="lazy" decoding="async" data-on={k === i ? '' : undefined} />
            ))}
          </span>
        }
        beforeLabel={t('home.pi.xai.photo')}
        afterLabel={t(cur.name as Key)}
      />
      <span className="rx-real chip">{t('home.pi.xai.real')}</span>
      <div className="rx-tabs" role="tablist" aria-label={t('home.pi.xai.cmp')}>
        {VIEWS.map((v, k) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={k === i}
            className="rx-tab"
            data-tone={v.id}
            onClick={() => {
              setI(k);
              hold();
            }}
          >
            {t(v.name as Key)}
            {k === i && !held && !reduced && <span className="rx-tab-bar" key={i} style={{ animationDuration: `${STEP_MS}ms` }} />}
          </button>
        ))}
      </div>
      <p className="rx-say m-0" aria-live="polite">
        <b>{t('home.pi.xai.result')}</b> · {t(cur.say as Key)}
      </p>
      <p className="rx-credit m-0">
        {t('home.pi.xai.credit')}{' '}
        <a href="https://doi.org/10.17632/86s4jzj2m4.3" target="_blank" rel="noreferrer">
          doi:10.17632/86s4jzj2m4
        </a>
      </p>
    </div>
  );
}
