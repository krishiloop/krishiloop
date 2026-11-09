import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { useI18n } from '../../lib/i18n';
import { LinkButton } from '../../ui/Button';
import { SplitWords } from '../../ui/kit/SplitWords';
import { WordCycler } from '../../ui/kit/WordCycler';
import { Magnetic } from '../../ui/kit/Magnetic';
import { useOnScreen } from '../../ui/kit/hooks';
import { LoopStage } from './LoopStage';

/**
 * The first screen: what KrishiLoop is, in five words and one moving picture. The headline rises word by word;
 * the line under it names one promise at a time; the loop on the right shows the whole product working. On scroll
 * the two headline lines drift apart and the copy fades (scroll-linked transforms, nothing else).
 */
export function HomeHero() {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const onScreen = useOnScreen(ref);
  const [play, setPlay] = useState(false);
  // start after the first paint (an effect, not requestAnimationFrame: a background tab never runs rAF, and the words
  // would wait hidden until someone looked)
  useEffect(() => setPlay(true), []);

  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const line1X = useTransform(p, [0, 1], [0, -120]);
  const line2X = useTransform(p, [0, 1], [0, 90]);
  const copyOpacity = useTransform(p, [0, 0.6], [1, 0]);
  const stageY = useTransform(p, [0, 1], [0, -80]);
  const railOpacity = useTransform(p, [0, 0.15], [1, 0]);

  const cycle = [t('home.cycle.1'), t('home.cycle.2'), t('home.cycle.3'), t('home.cycle.4')];

  return (
    <section ref={ref} className="relative overflow-x-clip" data-offscreen={onScreen ? undefined : ''} aria-labelledby="home-title">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="wrap relative grid min-h-[calc(100svh-var(--header-h))] items-center gap-12 pb-28 pt-10 lg:grid-cols-[1.12fr_1fr] lg:gap-6 lg:pb-24">
        <motion.div style={{ opacity: copyOpacity }} className="relative z-10">
          <p className="hero-rise flex items-center gap-2.5 font-mono text-[0.75rem] tracking-[0.04em] text-ink-2" style={{ '--i': 0 } as CSSProperties}>
            {t('home.kicker')}
          </p>
          <h1 id="home-title" className="t-display mt-7 text-ink [font-size:clamp(3.2rem,0.8rem+6.4vw,7.4rem)]">
            <motion.span style={{ x: line1X }} className="block">
              <SplitWords text={t('home.title.a')} delay={0.12} play={play} />
            </motion.span>
            <motion.span style={{ x: line2X }} className="block">
              <SplitWords text={t('home.title.b')} delay={0.3} play={play} wordClassName={() => 'serif-i text-sheen pr-[0.1em] text-[1.04em]'} />
            </motion.span>
          </h1>
          <p className="hero-rise t-lead mt-9 max-w-[30ch] text-ink-2" style={{ '--i': 6 } as CSSProperties}>
            {t('home.sub')} <WordCycler words={cycle} play={play && onScreen} className="serif-i text-[1.14em] text-ink" />
          </p>
          <div className="hero-rise mt-10 flex flex-wrap items-center gap-3" style={{ '--i': 7 } as CSSProperties}>
            <Magnetic>
              <LinkButton to="/app" variant="primary" size="lg" arrow>
                {t('ui.cta.tryApp')}
              </LinkButton>
            </Magnetic>
            <Magnetic>
              <LinkButton to="/receipt" variant="secondary" size="lg">
                {t('home.cta.receipt')}
              </LinkButton>
            </Magnetic>
          </div>
        </motion.div>

        <motion.div style={{ y: stageY }} className="relative mx-auto lg:ml-auto lg:mr-0">
          <LoopStage play={play} />
        </motion.div>
      </div>

      {/* bottom rail */}
      <motion.div style={{ opacity: railOpacity }} className="pointer-events-none absolute inset-x-0 bottom-6 hidden lg:block">
        <div className="wrap hero-rise flex items-center justify-between" style={{ '--i': 9 } as CSSProperties}>
          <p className="label m-0">{t('story.hero.facts')}</p>
          <div className="flex items-center gap-3 text-ink-3">
            <span className="label">{t('home.scroll')}</span>
            <span className="relative h-9 w-px overflow-hidden bg-ink/10" aria-hidden>
              <span className="hero-cue absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-transparent via-sprout to-transparent" />
            </span>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
