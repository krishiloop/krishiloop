import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { CloudRain, Mic, Users } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { SplitWords } from '../../ui/kit/SplitWords';
import { LiquidLink } from '../../ui/kit/LiquidButton';
import { useOnScreen } from '../../ui/kit/hooks';

const PROBLEMS: Key[] = ['home.kg.p1', 'home.kg.p2', 'home.kg.p3'];

/**
 * The first screen, after the owner's KrishiGuard AI deck (slide 1): a forest band with the deck's own line art, the
 * Bangla name over a big Fraunces wordmark, the one-line promise, three numbered problems, and a phone showing the app
 * at work: a leaf with gold detection corners and the gate's answer, with two glass alerts floating beside it (rain,
 * and the village alert). The phone and the alerts are an ILLUSTRATION (labelled); the real thing is one tap away.
 */
export function HomeHero() {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const onScreen = useOnScreen(ref);
  const [play, setPlay] = useState(false);
  // start after the first paint (an effect, not requestAnimationFrame: a background tab never runs rAF)
  useEffect(() => setPlay(true), []);

  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const copyY = useTransform(p, [0, 1], [0, 70]);
  const copyOpacity = useTransform(p, [0, 0.7], [1, 0]);
  const phoneY = useTransform(p, [0, 1], [0, -60]);
  const cardsY = useTransform(p, [0, 1], [0, -150]);
  const artY = useTransform(p, [0, 1], [0, 80]);

  return (
    <section ref={ref} className="kg-hero band-night relative overflow-x-clip" data-offscreen={onScreen ? undefined : ''} aria-labelledby="home-title">
      {/* the deck's title-slide art: field lines, a gold ring, a leaf branch and a rice stalk (the team's own drawing) */}
      <motion.div style={{ y: artY }} className="pointer-events-none absolute inset-0" aria-hidden>
        <img
          src="/art/hero-lines-1024.webp"
          srcSet="/art/hero-lines-1024.webp 1024w, /art/hero-lines-2048.webp 2048w"
          sizes="100vw"
          alt=""
          width={2048}
          height={1152}
          decoding="async"
          className="kg-hero-art"
        />
      </motion.div>

      <div className="wrap relative grid min-h-[calc(100svh-var(--header-h))] items-center gap-14 pb-20 pt-10 lg:grid-cols-[1.15fr_1fr] lg:gap-6">
        <motion.div style={{ y: copyY, opacity: copyOpacity }} className="relative z-10">
          <p className="eyebrow hero-rise m-0" style={{ '--i': 0 } as CSSProperties}>
            {t('home.kicker')}
          </p>
          <p lang="bn" className="kg-bn-name hero-rise m-0 mt-9" style={{ '--i': 1 } as CSSProperties}>
            কৃষিলুপ
          </p>
          <h1 id="home-title" className="kg-wordmark m-0 mt-2">
            <SplitWords text="KrishiLoop" delay={0.15} play={play} />
            <span className="sr-only-live"> · {t('home.kg.promise')}</span>
          </h1>
          <p className="kg-promise hero-rise m-0 mt-6 max-w-[34ch]" style={{ '--i': 4 } as CSSProperties} aria-hidden>
            {t('home.kg.promise')}
          </p>

          <ol className="kg-numcols hero-rise m-0 mt-12 p-0" style={{ '--i': 6 } as CSSProperties} aria-label={t('home.kg.problems')}>
            {PROBLEMS.map((k, i) => (
              <li key={k}>
                <span className="kg-num">{fmtNum(i + 1, lang, { minimumIntegerDigits: 2 })}</span>
                <span className="kg-num-t">{t(k)}</span>
              </li>
            ))}
          </ol>

          <div className="hero-rise mt-11 flex flex-wrap items-center gap-3" style={{ '--i': 7 } as CSSProperties}>
            <LiquidLink to="/app" size="lg" arrow magnetic>
              {t('ui.cta.tryApp')}
            </LiquidLink>
            <LiquidLink to="/receipt" tone="glass" size="lg" magnetic className="kg-outline">
              {t('ui.nav.receipt')}
            </LiquidLink>
          </div>
        </motion.div>

        {/* the app at work: an illustration (labelled), always in Bangla, as a farmer sees it */}
        <figure className="kg-stage relative m-0" aria-labelledby="kg-stage-cap">
          <motion.div style={{ y: phoneY }} className="kg-phone-wrap">
            <div className="kg-phone hero-rise" style={{ '--i': 3 } as CSSProperties} aria-hidden>
              <div className="kg-screen" lang="bn">
                <div className="flex items-center justify-between gap-2 px-4 pt-4">
                  <span className="text-[1.05rem] font-[700] text-[#14261c]">কৃষিলুপ</span>
                  <span className="kg-pill">আলু · ৪৫ দিন</span>
                </div>
                <div className="kg-leaf mx-3 mt-3">
                  <img src="/art/leaf-detect.webp" alt="" width={672} height={540} decoding="async" />
                  <span className="kg-detect" />
                  <span className="kg-leaf-chip">লেট ব্লাইট · খুব নিশ্চিত</span>
                </div>
                <div className="px-4 pt-3">
                  <p className="m-0 text-[1.02rem] font-[700] text-[#14261c]">আলুর মড়ক রোগ</p>
                  <div className="kg-gatebar mt-2">
                    <span data-g="sure">খুব নিশ্চিত</span>
                    <span data-g="unsure">নিশ্চিত নই</span>
                    <span data-g="risky">নতুন</span>
                  </div>
                  <p className="m-0 mt-3 text-[0.82rem] font-[700] text-[#8a5a0e]">এখন যা করবেন</p>
                  <ol className="m-0 mt-1 list-none space-y-0.5 p-0 text-[0.8rem] leading-snug text-[#14261c]">
                    <li>১. আক্রান্ত পাতা তুলে ফেলুন</li>
                    <li>২. বৃষ্টি আসছে, এখন ইউরিয়া দেবেন না</li>
                  </ol>
                </div>
                <div className="kg-ask">
                  <span className="kg-mic">
                    <Mic size={15} />
                  </span>
                  <span>বাংলায় প্রশ্ন করুন</span>
                </div>
              </div>
            </div>
          </motion.div>

          <motion.div style={{ y: cardsY }} className="kg-alerts" aria-hidden>
            <div className="kg-alert glass hero-rise" style={{ '--i': 6 } as CSSProperties}>
              <span className="kg-alert-ic" data-tone="water">
                <CloudRain size={18} />
              </span>
              <span>
                <b>{t('home.kg.alert.rain')}</b>
                <span>{t('home.kg.alert.rainSub')}</span>
              </span>
            </div>
            <div className="kg-alert glass hero-rise" style={{ '--i': 8 } as CSSProperties}>
              <span className="kg-alert-ic">
                <Users size={18} />
              </span>
              <span>
                <b>{t('home.kg.alert.farms')}</b>
                <span>{t('home.kg.alert.farmsSub')}</span>
              </span>
            </div>
          </motion.div>

          <figcaption id="kg-stage-cap" className="kg-cap hero-rise" style={{ '--i': 9 } as CSSProperties}>
            <span className="chip chip-carbon">{t('home.illus')}</span>
            <span>{t('home.kg.cap')}</span>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
