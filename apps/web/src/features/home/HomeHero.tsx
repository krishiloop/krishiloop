import '../../lib/i18n/strings.homestory';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, Hand } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { SplitWords } from '../../ui/kit/SplitWords';
import { LiquidLink } from '../../ui/kit/LiquidButton';
import { useOnScreen } from '../../ui/kit/hooks';
import { holdMap, STEPS, STORY } from './story/steps';
import type { FieldApi } from './story/field';

/**
 * The first screen (builder H, 19 Nov v4): a forest band where a field of leaves tells KrishiLoop's story as the page
 * scrolls. The band is pinned while the leaves morph through six pictures, each with one plain line: the field, a sick
 * leaf the crop doctor reads, rain and the weather warning, the village disease map, a receipt anyone can check, and
 * the loop itself. The headline, the promise and the two actions stay put and readable the whole time.
 *
 * The leaves are a 2D canvas in their own chunk (story/field.ts), started after the first paint, paused off screen and
 * in a hidden tab, 30 fps on phones. The pointer brushes them like wind, a tap is a gust. Reduced motion: each picture
 * is drawn once, still. The canvas is an ILLUSTRATION (labelled), never data.
 */
export function HomeHero() {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<FieldApi | null>(null);
  const progress = useRef(0);
  const onScreen = useOnScreen(ref);
  const [play, setPlay] = useState(false);
  const [step, setStep] = useState(0);
  const [live, setLive] = useState(false);
  const [still, setStill] = useState(false);
  // start after the first paint (an effect, not requestAnimationFrame: a background tab never runs rAF)
  useEffect(() => setPlay(true), []);

  // where the reader is in the story: 0 at the top of the band, STEPS - 1 when the pin lets go
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const el = track.current;
      const st = stick.current;
      if (!el || !st) return;
      const span = el.offsetHeight - st.offsetHeight;
      // a very short screen does not pin (home.css): the dots alone choose the picture
      if (span <= 0) return;
      const top = el.getBoundingClientRect().top;
      const p = Math.min(1, Math.max(0, -top / span)) * (STEPS - 1);
      progress.current = p;
      const s = Math.round(holdMap(p));
      setStep((prev) => (prev === s ? prev : s));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, []);

  // the leaf field: its own chunk, loaded once the page has loaded, so the headline always paints first
  useEffect(() => {
    let dead = false;
    let timer = 0;
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const mobile = !!window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 768;
    setStill(reduced);
    const go = () =>
      import('./story/field').then(({ startField }) => {
        if (dead || !canvas.current) return;
        field.current = startField({ canvas: canvas.current, getProgress: () => progress.current, reduced, mobile });
        setLive(true);
      });
    const onLoad = () => {
      timer = window.setTimeout(() => void go(), 50);
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    return () => {
      dead = true;
      window.clearTimeout(timer);
      window.removeEventListener('load', onLoad);
      field.current?.destroy();
      field.current = null;
    };
  }, []);

  // reduced motion: the still picture follows the step
  useEffect(() => field.current?.setStep(step), [step, live]);

  /** the dots: scroll to the start of a picture's stretch */
  const goTo = (i: number) => {
    const el = track.current;
    const st = stick.current;
    if (!el || !st) return;
    const span = el.offsetHeight - st.offsetHeight;
    if (span <= 0) {
      progress.current = i;
      setStep(i);
      return;
    }
    const top = el.getBoundingClientRect().top + window.scrollY + (span * i) / (STEPS - 1) + 2;
    window.scrollTo({ top, behavior: still ? 'auto' : 'smooth' });
  };

  const cur = STORY[step]!;
  const n = (v: number) => fmtNum(v, lang, { minimumIntegerDigits: 2 });

  return (
    <section ref={ref} className="kg-hero band-night relative" data-offscreen={onScreen ? undefined : ''} aria-labelledby="home-title">
      <div ref={track} className="kg-track" style={{ '--kg-steps': STEPS } as CSSProperties}>
        <div ref={stick} className="kg-stick">
          <div className="kg-glow" aria-hidden />
          <div className="wrap kg-grid">
            <div className="kg-copy relative z-10">
              <p className="eyebrow hero-rise m-0" style={{ '--i': 0 } as CSSProperties}>
                {t('home.kicker')}
              </p>
              <p lang="bn" className="kg-bn-name hero-rise m-0 mt-4 sm:mt-6 lg:mt-9" style={{ '--i': 1 } as CSSProperties}>
                কৃষিলুপ
              </p>
              <h1 id="home-title" className="kg-wordmark m-0 mt-1 lg:mt-2">
                <SplitWords text="KrishiLoop" delay={0.15} play={play} />
                <span className="sr-only-live"> · {t('home.kg.promise')}</span>
              </h1>
              <p className="kg-promise m-0 mt-4 max-w-[34ch] lg:mt-6" aria-hidden>
                {t('home.kg.promise')}
              </p>
              <div className="hero-rise mt-5 flex flex-wrap items-center gap-2.5 sm:mt-6 sm:gap-3 lg:mt-10" style={{ '--i': 5 } as CSSProperties}>
                <LiquidLink to="/app" size="lg" arrow magnetic>
                  {t('ui.cta.tryApp')}
                </LiquidLink>
                <LiquidLink to="/receipt" tone="glass" size="lg" magnetic className="kg-outline">
                  {t('ui.nav.receipt')}
                </LiquidLink>
              </div>
              <a href="#home-after" className="kg-skip hero-rise" style={{ '--i': 7 } as CSSProperties}>
                <ArrowDown size={15} aria-hidden />
                {t('home.story.skip')}
              </a>
            </div>

            {/* the story: leaves on a canvas (aria-hidden), the line for this picture, and dots to jump between them */}
            <figure className="kg-story m-0" aria-label={t('home.story.label')}>
              <div className="kg-field" data-live={live ? '' : undefined}>
                <canvas ref={canvas} aria-hidden />
                <span className="chip chip-carbon kg-illus" title={t('home.story.illus')}>
                  {t('home.illus')}
                  <span className="sr-only-live">. {t('home.story.illus')}</span>
                </span>
              </div>
              <figcaption className="kg-caption">
                <div className="kg-line" key={step} aria-hidden>
                  <p className="kg-line-k m-0">
                    <span className="kg-line-n">
                      {n(step + 1)} / {n(STEPS)}
                    </span>
                    <span>{t(cur.name)}</span>
                  </p>
                  <p className="kg-line-t m-0">{t(cur.line)}</p>
                </div>
                <ol className="sr-only-live">
                  {STORY.map((s) => (
                    <li key={s.name}>
                      {t(s.name)}: {t(s.line)}
                    </li>
                  ))}
                </ol>
                <div className="kg-dots-row">
                  <nav className="kg-dots" aria-label={t('home.story.label')}>
                    {STORY.map((s, i) => (
                      <button
                        key={s.name}
                        type="button"
                        className="kg-dot"
                        aria-label={t('home.story.go', { n: fmtNum(i + 1, lang), name: t(s.name) })}
                        aria-current={i === step ? 'step' : undefined}
                        onClick={() => goTo(i)}
                      />
                    ))}
                  </nav>
                  {!still && (
                    <span className="kg-hint" aria-hidden>
                      <Hand size={14} />
                      {t('home.story.hint')}
                    </span>
                  )}
                </div>
              </figcaption>
            </figure>
          </div>
        </div>
      </div>
      <span id="home-after" tabIndex={-1} className="kg-after" />
    </section>
  );
}
