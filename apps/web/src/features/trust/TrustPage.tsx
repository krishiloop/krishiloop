import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileQuestion, TriangleAlert } from 'lucide-react';
import { ReplayPanel } from './ReplayPanel';
import { LiveArea } from './LiveArea';
import { PHOTO_DEMO } from './labels';
import { POLICY_V1, requiredRight, type Policy } from './policy';
import { shapeReplay, type ShapedReplay } from './replay';
import { Reveal } from '../../components/ui/Reveal';
import { SampleBadge } from '../../components/ui/Badges';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { fetchReplay, useAreaStats } from '../../lib/api/trust';

type View = { state: 'loading' } | { state: 'ready'; replay: ShapedReplay; sample: boolean } | { state: 'missing' } | { state: 'error'; message: string };

/**
 * /trust: the area trust panel. A replay of public datasets (the dataset labels stand in for officers), then the live meter
 * for this demo session's rice@BD, then how the gate works in plain words, with the numbers the bar really asks for.
 * Everything on the page is the API's, or a labelled sample in mock mode: no number is made up here.
 */
export default function TrustPage() {
  const { t } = useI18n();
  const [view, setView] = useState<View>({ state: 'loading' });

  useEffect(() => {
    let alive = true;
    void fetchReplay().then((r) => {
      if (!alive) return;
      if (r.state === 'missing') return setView({ state: 'missing' });
      if (r.state === 'error') return setView({ state: 'error', message: r.message });
      const replay = shapeReplay(r.payload);
      setView(replay ? { state: 'ready', replay, sample: r.state === 'sample' } : { state: 'error', message: 'the replay file has no usable curves' });
    });
    return () => {
      alive = false;
    };
  }, []);

  const policy = view.state === 'ready' ? view.replay.policy : POLICY_V1;

  return (
    <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-8 sm:px-6 sm:pt-10">
      <header className="mb-6 sm:mb-8">
        <p className="eyebrow flex flex-wrap items-center gap-2">
          KrishiLoop · {t('trust.eyebrow')} {view.state === 'ready' && view.sample ? <SampleBadge /> : null}
        </p>
        <h1 className="mt-2 max-w-[24ch] text-h1 font-medium tracking-tight text-balance" data-testid="trust-title">
          {t('trust.page.title')}
        </h1>
        <p className="mt-3 max-w-[62ch] text-lg text-chrome">{t('trust.page.lead')}</p>
      </header>

      <div className="tr-grid">
        <div className="tr-replay-col">
          {view.state === 'loading' ? (
            <div className="surface surface-pad" aria-busy="true" data-testid="replay-loading">
              <div className="skeleton h-5 w-3/4" />
              <div className="skeleton mt-5 h-64 w-full" />
              <p className="sr-only" role="status">
                {t('trust.replay.loading')}
              </p>
            </div>
          ) : null}
          {view.state === 'ready' ? <ReplayPanel replay={view.replay} sample={view.sample} /> : null}
          {view.state === 'missing' ? (
            <section className="surface surface-pad tr-empty" data-testid="replay-missing">
              <FileQuestion size={26} strokeWidth={1.4} aria-hidden />
              <h2 className="tr-h">{t('trust.replay.missing.title')}</h2>
              <p className="m-0 text-chrome">{t('trust.replay.missing.body')}</p>
            </section>
          ) : null}
          {view.state === 'error' ? (
            <section className="surface surface-pad tr-empty" role="alert" data-testid="replay-error">
              <TriangleAlert size={26} strokeWidth={1.4} aria-hidden />
              <p className="m-0 text-chrome">{t('trust.replay.error', { message: view.message })}</p>
            </section>
          ) : null}
        </div>

        <div className="tr-live-col">
          <Reveal>
            <LiveArea area={PHOTO_DEMO.area} />
          </Reveal>
        </div>

        <div className="tr-how-col">
          <Reveal delay={80}>
            <How policy={policy} />
          </Reveal>
        </div>
      </div>
    </div>
  );
}

/** The gate in five plain sentences, and what its bar means in numbers (computed here from the policy, not claimed). */
function How({ policy }: { policy: Policy }) {
  const { t, lang } = useI18n();
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const version = useAreaStats(PHOTO_DEMO.area)?.policy_version ?? 1;
  const rows = [policy.minSure, 40, policy.window].filter((n, i, all) => n >= policy.minSure && n <= policy.window && all.indexOf(n) === i);
  return (
    <section className="surface surface-pad tr-how" aria-labelledby="tr-how-t" data-testid="how-panel">
      <h2 id="tr-how-t" className="tr-h">
        {t('trust.how.title')}
      </h2>
      <ol className="tr-steps">
        <li>{t('trust.how.1')}</li>
        <li>{t('trust.how.2', { sure: two(policy.sure) })}</li>
        <li>{t('trust.how.3', { window: fmtNum(policy.window, lang), min: fmtNum(policy.minSure, lang), open: two(policy.openLb) })}</li>
        <li>{t('trust.how.4', { audit: `${fmtNum(Math.round(policy.audit * 100), lang)}%` })}</li>
        <li>{t('trust.how.5', { close: two(policy.closeLb) })}</li>
      </ol>
      <details className="tr-details">
        <summary>{t('trust.how.table')}</summary>
        <ul className="tr-bar-table" data-testid="bar-table">
          {rows.map((n) => {
            const k = requiredRight(n, policy.openLb);
            return k === null ? null : (
              <li key={n} className="tabular">
                {t('trust.how.table.row', { n: fmtNum(n, lang), k: fmtNum(k, lang) })}
              </li>
            );
          })}
        </ul>
      </details>
      <p className="m-0 mt-4 text-xs text-dim">{t('trust.how.policy', { v: fmtNum(version, lang) })}</p>
      <Link to="/officer" className="link mt-3 inline-flex items-center gap-1.5 text-sm">
        {t('trust.live.officer')} <ArrowRight size={13} aria-hidden />
      </Link>
    </section>
  );
}
