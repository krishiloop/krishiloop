import '../../lib/i18n/strings.homestory';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent as RPointerEvent } from 'react';
import { Hand, Pause, Play } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { SplitWords } from '../../ui/kit/SplitWords';
import { LiquidLink } from '../../ui/kit/LiquidButton';
import { useOnScreen } from '../../ui/kit/hooks';
import { LeafFarmer, type Mood } from '../../ui/farmer/LeafFarmer';
import { STEP_MS, STEPS, STORY } from './story/steps';
import type { FieldApi } from './story/field';

const isDark = () => document.documentElement.dataset.theme === 'dark';

/**
 * The leaf farmer presents the story (owner, 20 Nov): he stands beside the leaf pictures, faces them, and reacts to
 * each one. A plain mood, or moods over the picture's time (seconds). Same order as STORY.
 */
const PRESENTER: (Mood | [number, Mood][])[] = [
  'waving', // your field: he greets you
  'pointing', // potato: look at this
  'happy', // tomato
  [
    [0, 'leaf'],
    [1.1, 'scan'],
    [2.5, 'happy'],
  ], // crop doctor: worried at the sick leaf, scans it with his phone, relieved
  [
    [0, 'thinking'],
    [1.4, 'pointing'],
  ], // not sure: thinks, then points the way to the nearest officer
  [
    [0, 'surprised'],
    [1.5, 'phone'],
  ], // weather: rain! the warning on his phone
  'thinking', // the disease map
  'proud', // a receipt
  'happy', // the loop
];

/**
 * The first screen (builder H v4; v5 builder Ho): a field of leaves tells KrishiLoop's story in six pictures, and now
 * it plays by itself, one picture every few seconds: the field, a sick leaf the crop doctor reads, rain and the weather
 * warning, the disease map, a receipt anyone can check, and the loop itself. Each picture has its own pastel (a wash
 * behind the hero and a glow on its subject) and one plain line that crossfades in with a soft wipe. The headline, the
 * promise and the two actions stay put.
 *
 * Playing: it pauses while a mouse rests on the story, while a keyboard is in it, and for a few seconds after a touch;
 * off screen and in a hidden tab. A visible pause / play button stops it for good (WCAG 2.2.2), the dots jump, and the
 * active dot fills as its picture's time runs out. Reduced motion: it starts paused and shows still pictures.
 *
 * The leaves are a 2D canvas in their own chunk (story/field.ts), started after the page has loaded, 30 fps on phones.
 * The canvas is an ILLUSTRATION (labelled), never data.
 */
export function HomeHero() {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const field = useRef<FieldApi | null>(null);
  const onScreen = useOnScreen(ref);
  const [play, setPlay] = useState(false);
  const [step, setStep] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [still, setStill] = useState(false);
  // the visitor's choice (the pause button), and the moments the story waits by itself (hover, keyboard, touch)
  const [playing, setPlaying] = useState(true);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [touch, setTouch] = useState(false);
  const [hidden, setHidden] = useState(false);
  const timers = useRef<{ hover?: number; focus?: number; touch?: number }>({});
  // start after the first paint (an effect, not requestAnimationFrame: a background tab never runs rAF)
  useEffect(() => setPlay(true), []);

  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    const tm = timers.current;
    return () => {
      document.removeEventListener('visibilitychange', on);
      window.clearTimeout(tm.hover);
      window.clearTimeout(tm.focus);
      window.clearTimeout(tm.touch);
    };
  }, []);

  // the leaf field: its own chunk, loaded once the page has loaded, so the headline always paints first
  useEffect(() => {
    let dead = false;
    let timer = 0;
    const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const mobile = !!window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 768;
    setStill(reduced);
    if (reduced) setPlaying(false);
    const go = () =>
      import('./story/field').then(({ startField }) => {
        if (dead || !canvas.current) return;
        field.current = startField({ canvas: canvas.current, glow: glow.current, step: 0, reduced, mobile, dark: isDark() });
        setLive(true);
      });
    const onLoad = () => {
      timer = window.setTimeout(() => void go(), 50);
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    // the theme switch repaints the leaves in that theme's tones
    const mo = new MutationObserver(() => field.current?.setDark(isDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      dead = true;
      window.clearTimeout(timer);
      window.removeEventListener('load', onLoad);
      mo.disconnect();
      field.current?.destroy();
      field.current = null;
    };
  }, []);

  useEffect(() => field.current?.go(step), [step, live]);

  const show = useCallback((i: number) => {
    setStep((s) => {
      if (s !== i) setPrev(s);
      return i;
    });
  }, []);
  const next = () => show((step + 1) % STEPS);

  // the story waits while a mouse rests on it, while a keyboard is in it, and a few seconds after a touch
  const onEnter = (e: RPointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(timers.current.hover);
    setHover(true);
  };
  const onLeave = (e: RPointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    window.clearTimeout(timers.current.hover);
    timers.current.hover = window.setTimeout(() => setHover(false), 700);
  };
  const onDown = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse') return;
    window.clearTimeout(timers.current.touch);
    setTouch(true);
    timers.current.touch = window.setTimeout(() => setTouch(false), 4000);
  };
  const onFocus = (e: FocusEvent) => {
    if (!(e.target as HTMLElement).matches?.(':focus-visible')) return;
    window.clearTimeout(timers.current.focus);
    setFocus(true);
  };
  const onBlur = (e: FocusEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    window.clearTimeout(timers.current.focus);
    timers.current.focus = window.setTimeout(() => setFocus(false), 700);
  };

  const waiting = !playing || hover || focus || touch || hidden || !onScreen || !live;
  const cur = STORY[step]!;
  const n = (v: number) => fmtNum(v, lang, { minimumIntegerDigits: 2 });
  const line = (i: number, cls: string) => {
    const s = STORY[i]!;
    return (
      <div className={`kg-line ${cls}`} key={`${cls}-${i}`}>
        <p className="kg-line-k m-0">
          <span className="kg-line-n">
            {n(i + 1)} / {n(STEPS)}
          </span>
          <span>{t(s.name)}</span>
        </p>
        <p className="kg-line-t m-0">{t(s.line)}</p>
      </div>
    );
  };

  return (
    <section
      ref={ref}
      className="kg-hero relative"
      data-tone={cur.tone}
      data-paused={waiting ? '' : undefined}
      data-stopped={playing ? undefined : ''}
      data-offscreen={onScreen ? undefined : ''}
      aria-labelledby="home-title"
    >
      {/* each picture's pastel wash: six still layers, only the current one shows (an opacity crossfade) */}
      <div className="kg-washes" aria-hidden>
        {STORY.map((s, i) => (
          <div key={`${s.tone}-${i}`} className={`kg-wash kg-wash-${s.tone}`} data-on={i === step ? '' : undefined} />
        ))}
      </div>
      {/* botanical line art on BOTH sides (owner, 20 Nov: "clearly visible, left and right"): each drawing in its own colour
          (leaf green, terracotta, lotus, lilac), drawn through a CSS mask so it takes any colour in either theme, and
          swaying a little (CSS, transform only; still under reduced motion) */}
      <div className="kg-flora" aria-hidden>
        <span className="kg-fl kg-fl--l1" />
        <span className="kg-fl kg-fl--l2" />
        <span className="kg-fl kg-fl--l3" />
        <span className="kg-fl kg-fl--r1" />
        <span className="kg-fl kg-fl--r2" />
        <span className="kg-fl kg-fl--r3" />
      </div>
      <div className="kg-stick">
        <div className="wrap kg-grid">
          <div className="kg-copy relative z-10">
            <p className="eyebrow hero-rise m-0" style={{ '--i': 0 } as CSSProperties}>
              {t('home.kicker')}
            </p>
            <p lang="bn" className="kg-bn-name hero-rise m-0 mt-4 sm:mt-6 lg:mt-9" style={{ '--i': 1 } as CSSProperties}>
              কৃষিলুপ
            </p>
            <h1 id="home-title" className="kg-wordmark m-0 mt-1 lg:mt-2">
              <SplitWords text="Krishi" delay={0.15} play={play} />
              <SplitWords text="Loop" className="kg-loop" delay={0.26} play={play} />
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
          </div>

          {/* the story: leaves on a canvas (aria-hidden), the line for this picture, the pause button and the dots */}
          <figure
            className="kg-story m-0"
            aria-label={t('home.story.label')}
            onPointerEnter={onEnter}
            onPointerLeave={onLeave}
            onPointerDown={onDown}
            onFocus={onFocus}
            onBlur={onBlur}
          >
            <div className="kg-field" data-live={live ? '' : undefined}>
              <span ref={glow} className="kg-spot" aria-hidden />
              <canvas ref={canvas} aria-hidden />
              {(() => {
                // one farmer for the whole story (never remounted), so he gathers from leaves once and then just acts
                const p = PRESENTER[step] ?? 'calm';
                return <LeafFarmer className="kg-farmer" flip mood={typeof p === 'string' ? p : 'calm'} script={typeof p === 'string' ? undefined : p} scriptKey={step} />;
              })()}
              <span className="chip chip-carbon kg-illus" title={t('home.story.illus')}>
                {t('home.illus')}
                <span className="sr-only-live">. {t('home.story.illus')}</span>
              </span>
            </div>
            <figcaption className="kg-caption">
              <div className="kg-lines" aria-hidden>
                {prev !== null && prev !== step && line(prev, 'is-out')}
                {line(step, prev === null ? 'is-first' : 'is-in')}
              </div>
              <ol className="sr-only-live">
                {STORY.map((s) => (
                  <li key={s.name}>
                    {t(s.name)}: {t(s.line)}
                  </li>
                ))}
              </ol>
              <div className="kg-dots-row">
                <div className="kg-controls">
                  <button
                    type="button"
                    className="kg-play"
                    aria-label={playing ? t('home.story.pause') : t('home.story.play')}
                    title={playing ? t('home.story.pause') : t('home.story.play')}
                    onClick={() => setPlaying((p) => !p)}
                  >
                    {playing ? <Pause size={15} strokeWidth={2.2} aria-hidden /> : <Play size={15} strokeWidth={2.2} aria-hidden />}
                  </button>
                  <nav className="kg-dots" aria-label={t('home.story.label')}>
                    {STORY.map((s, i) => (
                      <button
                        key={s.name}
                        type="button"
                        className="kg-dot"
                        aria-label={t('home.story.go', { n: fmtNum(i + 1, lang), name: t(s.name) })}
                        aria-current={i === step ? 'step' : undefined}
                        onClick={() => show(i)}
                      >
                        {/* the active dot fills as its picture's time runs out; when it is full, the next picture comes */}
                        {i === step && playing && <span className="kg-dot-bar" key={step} style={{ '--kg-dur': `${STEP_MS}ms` } as CSSProperties} onAnimationEnd={next} />}
                      </button>
                    ))}
                  </nav>
                </div>
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
    </section>
  );
}
