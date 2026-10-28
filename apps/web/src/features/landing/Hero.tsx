import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, CloudRain, Moon, ScanLine, Sun, QrCode } from 'lucide-react';
import { HeroPoster } from './HeroPoster';
import { HeroReceipt } from './HeroReceipt';
import { loadGsap } from './gsapLoader';
import { MotionToggle } from '../../components/shell/Controls';
import { Scene } from '../../components/ui/Safe';
import type { LightMode } from '../../components/three/lightModes';
import { useI18n } from '../../lib/i18n';
import { useIsLite } from '../../lib/device';
import { useMotionReduced } from '../../lib/motionPref';
import { cx } from '../../lib/cx';

const HeroScene = lazy(() => import('../../components/three/HeroScene'));

/** "Every piece ... a *receipt* anyone can check." -> the starred word becomes an emphasised word. */
export function emphasis(text: string): ReactNode[] {
  return text.split(/(\*[^*]+\*)/g).map((part, i) => (part.startsWith('*') && part.endsWith('*') ? <em key={i}>{part.slice(1, -1)}</em> : <span key={i}>{part}</span>));
}

const MODES: { id: LightMode; icon: typeof Sun; key: 'l.hero.light.sun' | 'l.hero.light.rain' | 'l.hero.light.dusk' }[] = [
  { id: 'sun', icon: Sun, key: 'l.hero.light.sun' },
  { id: 'rain', icon: CloudRain, key: 'l.hero.light.rain' },
  { id: 'dusk', icon: Moon, key: 'l.hero.light.dusk' },
];

export function Hero() {
  const { t, lang } = useI18n();
  const lite = useIsLite();
  const reduced = useMotionReduced();
  const [mode, setMode] = useState<LightMode>('sun');
  const [ready, setReady] = useState(false);
  const [scanKey, setScanKey] = useState(0);
  const [scanning, setScanning] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);

  // headline: masked word reveal (GSAP SplitText), loaded after first paint. Plain HTML until then, and for reduced motion.
  useEffect(() => {
    const el = title.current;
    if (!el) return;
    if (reduced) {
      el.classList.remove('reveal-pending');
      return;
    }
    let alive = true;
    let revert: (() => void) | undefined;
    void loadGsap().then(({ gsap, SplitText }) => {
      if (!alive || !el.isConnected) return;
      const split = SplitText.create(el, { type: 'words', mask: 'words' });
      el.classList.remove('reveal-pending');
      gsap.from(split.words, { yPercent: 118, duration: 1.15, ease: 'expo.out', stagger: 0.065, delay: 0.1, onComplete: () => split.revert() });
      revert = () => split.revert();
    });
    return () => {
      alive = false;
      revert?.();
    };
  }, [lang, reduced]);

  return (
    <section className="hero" data-theme="dark" data-ready={ready} data-mode={mode} aria-labelledby="hero-title">
      <div className="hero-media">
        <HeroPoster mode={mode} label={t('l.hero.poster')} />
        {!lite ? (
          <div className="hero-scene" role="img" aria-label={t('l.hero.scene')}>
            <Scene fallback={null}>
              <Suspense fallback={null}>
                <HeroScene mode={mode} scanKey={scanKey} onReady={() => setReady(true)} onScan={setScanning} />
              </Suspense>
            </Scene>
          </div>
        ) : null}
        <div className="hero-scrim" />
      </div>

      <div className="hero-inner">
        <div className="hero-copy">
          <p className="eyebrow hero-in" style={{ ['--d' as string]: '0ms' }}>
            {t('l.hero.eyebrow')}
          </p>
          <h1 id="hero-title" ref={title} className="display hero-title reveal-pending" data-testid="hero-title">
            {emphasis(t('l.hero.title'))}
          </h1>
          <p className="hero-sub hero-in" style={{ ['--d' as string]: '620ms' }}>
            {t('l.hero.sub')}
          </p>
          <div className="hero-cta hero-in" style={{ ['--d' as string]: '780ms' }}>
            <Link to="/app" className="btn btn-sun">
              {t('l.hero.cta.app')} <ArrowRight size={17} aria-hidden />
            </Link>
            <Link to="/verify" className="btn btn-ghost hero-ghost">
              <QrCode size={17} aria-hidden /> {t('l.hero.cta.verify')}
            </Link>
          </div>
        </div>
        <div className="hero-aside hero-in" style={{ ['--d' as string]: '1500ms' }}>
          <HeroReceipt />
        </div>
      </div>

      <div className="hero-controls" role="group" aria-label={t('l.hero.light')}>
        <div className="seg hero-seg">
          {MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)} data-testid={`light-${m.id}`}>
              <m.icon size={15} aria-hidden /> <span>{t(m.key)}</span>
            </button>
          ))}
        </div>
        {!lite ? (
          <button type="button" className={cx('btn btn-ghost btn-sm hero-ghost', scanning && 'is-live')} onClick={() => setScanKey((k) => k + 1)} disabled={scanning} data-testid="scan-btn">
            <ScanLine size={15} aria-hidden /> {scanning ? t('l.hero.scanning') : t('l.hero.scan')}
          </button>
        ) : null}
        <MotionToggle className="hero-motion" />
      </div>

      <a href="#problem" className="hero-cue">
        {t('l.hero.cue')} <ArrowDown size={15} aria-hidden />
      </a>
    </section>
  );
}
