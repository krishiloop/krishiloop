import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import { ChapterFallback } from './ChapterFallback';
import { Scene } from '../../components/ui/Safe';
import { useI18n, type Key } from '../../lib/i18n';
import { useIsLite } from '../../lib/device';
import { useMotionReduced } from '../../lib/motionPref';
import { fetchStatusList } from '../../lib/api/statusList';
import { fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';

const ChapterScene = lazy(() => import('../../components/three/ChapterScene'));

type Status = 'implemented' | 'planned';
interface Chapter {
  id: string;
  label: Key;
  title: Key;
  body: Key;
  chips: { k: Key; s: Status }[];
  note?: Key;
}

/**
 * SEE, DECIDE, SPEAK, PROVE, LEARN. Every chip says whether the control is implemented or planned (AGENTS.md rule 7).
 * The statements are checked against the repo: planner.py + validator.py (DECIDE), tools/check_quotes.py (quote check),
 * services/trust (PROVE, LEARN), ml/vision (photo model, now wired into the farmer app).
 */
const CHAPTERS: Chapter[] = [
  {
    id: 'see',
    label: 'l.ch.see',
    title: 'l.ch.see.title',
    body: 'l.ch.see.body',
    chips: [
      { k: 'l.ch.chip.forecast', s: 'implemented' },
      { k: 'l.ch.chip.photo', s: 'implemented' },
      { k: 'l.ch.chip.sentinel', s: 'planned' },
    ],
  },
  {
    id: 'decide',
    label: 'l.ch.decide',
    title: 'l.ch.decide.title',
    body: 'l.ch.decide.body',
    chips: [
      { k: 'l.ch.chip.rules', s: 'implemented' },
      { k: 'l.ch.chip.quote', s: 'implemented' },
      { k: 'l.ch.chip.validator', s: 'implemented' },
    ],
  },
  {
    id: 'speak',
    label: 'l.ch.speak',
    title: 'l.ch.speak.title',
    body: 'l.ch.speak.body',
    chips: [
      { k: 'l.ch.chip.languages', s: 'implemented' },
      { k: 'l.ch.chip.voice', s: 'implemented' },
      { k: 'l.ch.chip.inbox', s: 'implemented' },
    ],
  },
  {
    id: 'prove',
    label: 'l.ch.prove',
    title: 'l.ch.prove.title',
    body: 'l.ch.prove.body',
    note: 'l.ch.prove.eu',
    chips: [
      { k: 'l.ch.chip.vc', s: 'implemented' },
      { k: 'l.ch.chip.verifier', s: 'implemented' },
    ],
  },
  {
    id: 'learn',
    label: 'l.ch.learn',
    title: 'l.ch.learn.title',
    body: 'l.ch.learn.body',
    chips: [
      { k: 'l.ch.chip.recall', s: 'implemented' },
      { k: 'l.ch.chip.notify', s: 'planned' },
    ],
  },
];
const N = CHAPTERS.length;
/** scroll distance of the pinned stage, in viewport heights: 4 morphs with a hold at both ends */
const RUN = 4.2;

export function Chapters() {
  const { t, lang } = useI18n();
  const lite = useIsLite();
  const reduced = useMotionReduced();
  const sec = useRef<HTMLElement>(null);
  const prog = useRef(0);
  const [active, setActive] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const [withdrawn, setWithdrawn] = useState<number | null>(null);

  useEffect(() => {
    const el = sec.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const run = Math.max(1, r.height - vh);
      const p = Math.min(1, Math.max(0, -r.top / run));
      prog.current = p * (N - 1);
      const a = Math.round(prog.current);
      setActive((cur) => (cur === a ? cur : a));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      cancelAnimationFrame(raf);
    };
  }, []);

  // a real, live number for the LEARN chapter: how many entries are withdrawn on this server's public status list
  useEffect(() => {
    let alive = true;
    void fetchStatusList().then((l) => alive && setWithdrawn(l ? l.withdrawn : null));
    return () => {
      alive = false;
    };
  }, []);

  const go = useCallback(
    (i: number) => {
      const el = sec.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const run = el.offsetHeight - window.innerHeight;
      window.scrollTo({ top: top + (run * i) / (N - 1) + 2, behavior: reduced ? 'auto' : 'smooth' });
    },
    [reduced],
  );

  return (
    <section ref={sec} id="how" className="chapters" data-theme="dark" style={{ ['--run' as string]: String(RUN) }} aria-labelledby="ch-title" data-testid="chapters">
      <div className="chapters-stage">
        <div className="chapters-visual" data-ready={sceneReady}>
          <div className="chapters-halo" aria-hidden />
          {lite ? (
            <ChapterFallback active={active} />
          ) : (
            <>
              <ChapterFallback active={sceneReady ? -1 : active} />
              <Scene fallback={<ChapterFallback active={active} />}>
                <Suspense fallback={null}>
                  <ChapterScene progress={prog} onReady={() => setSceneReady(true)} />
                </Suspense>
              </Scene>
            </>
          )}
        </div>

        <div className="chapters-copy">
          <p className="eyebrow">{t('l.ch.eyebrow')}</p>
          <h2 id="ch-title" className="chapters-h2">
            {t('l.ch.title')}
          </h2>
          <div className="chapters-slides">
            {CHAPTERS.map((c, i) => (
              <article key={c.id} className="chapter" data-active={i === active} aria-hidden={i !== active} {...(i !== active ? { inert: true } : {})}>
                <p className="chapter-verb display">{t(c.label)}</p>
                <h3 className="chapter-title">{t(c.title)}</h3>
                <p className="chapter-body">{t(c.body)}</p>
                {c.note ? <p className="chapter-note">{t(c.note)}</p> : null}
                <ul className="chapter-chips">
                  {c.chips.map((ch) => (
                    <li key={ch.k} className="chip" data-status={ch.s}>
                      {ch.s === 'implemented' ? <Check size={12} strokeWidth={3} aria-hidden /> : <Circle size={10} aria-hidden />}
                      {t(ch.k)}
                      <span className="sr-only"> ({ch.s === 'implemented' ? t('l.status.implemented') : t('l.status.planned')})</span>
                    </li>
                  ))}
                </ul>
                {c.id === 'learn' && withdrawn !== null ? (
                  <p className="chapter-live" data-testid="live-withdrawn">
                    <span className="chip" data-tone="go">
                      <span className="size-1.5 rounded-full bg-go" aria-hidden /> {t('data.live')}
                    </span>
                    {t('l.prove.list')}: <span className="mono">{fmtNum(withdrawn, lang)}</span>
                  </p>
                ) : null}
              </article>
            ))}
          </div>

          <nav className="chapters-nav" aria-label={t('l.ch.nav')}>
            {CHAPTERS.map((c, i) => (
              <button key={c.id} type="button" className={cx('chapters-tick', i === active && 'is-active')} aria-current={i === active ? 'step' : undefined} onClick={() => go(i)}>
                <span className="chapters-tick-bar" aria-hidden />
                <span>{t(c.label)}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}
