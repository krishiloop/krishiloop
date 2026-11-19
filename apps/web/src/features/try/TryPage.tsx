import { lazy, Suspense, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import '../../lib/i18n/strings.try';
import { Skeleton } from '../../ui/kit/Skeleton';
import { ToolCard } from './parts';
import { SprayTool } from './SprayTool';
import { WeatherTool } from './WeatherTool';
import { ReceiptTool } from './ReceiptTool';
import { RecallTool } from './RecallTool';
import { SavingsTool } from './SavingsTool';
import './try.css';

// the photo tool is its own chunk; the model and its runtime load only when the visitor starts (LeafTool)
const LeafTool = lazy(() => import('./LeafTool'));

export const TOOLS = [
  { id: 'spray', key: 'try.spray.title' },
  { id: 'leaf', key: 'try.leaf.title' },
  { id: 'receipt', key: 'try.receipt.title' },
  { id: 'weather', key: 'try.weather.title' },
  { id: 'savings', key: 'try.savings.title' },
  { id: 'recall', key: 'try.recall.title' },
] as const;

/**
 * /try: six tools a visitor can use without the app's phone frame, each on KrishiLoop's real logic or data:
 * the planner's rules ("Should I spray?"), the AgriTriage photo model, the receipt checker, the Climate-Smart Shield,
 * the savings calculator and the recall. Honest labels sit on each tool (practice weather, recorded receipts, research
 * weights, an unsigned preview).
 */
export default function TryPage() {
  const { t } = useI18n();
  const { hash } = useLocation();

  // the site sets titles per route before this chunk's words load, so the page names itself once it is here
  useEffect(() => {
    document.title = `${t('try.eyebrow')} · KrishiLoop`;
  }, [t]);

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }, [hash]);

  return (
    <div className="try-page botanic-bg botanic-bg--pg-a">
      <header className="wrap try-hero">
        <p className="eyebrow">{t('try.eyebrow')}</p>
        <h1 className="t-title try-hero-title">{t('try.title')}</h1>
        <p className="try-hero-honest">{t('try.honest')}</p>
        <nav className="try-jump" aria-label={t('try.jump')}>
          {TOOLS.map((x, i) => (
            <a key={x.id} href={`#${x.id}`} className={`try-jump-link tone-${TONES[i]}`}>
              <span className="mono" aria-hidden>
                0{i + 1}
              </span>
              {t(x.key)}
            </a>
          ))}
        </nav>
      </header>

      <div className="wrap try-grid">
        <ToolCard id="spray" n={1} tone="butter" wide title={t('try.spray.title')} help={t('try.spray.help')} tags={<span className="chip">{t('try.spray.tag')}</span>}>
          <SprayTool />
        </ToolCard>
        <ToolCard id="leaf" n={2} tone="moss" title={t('try.leaf.title')} help={t('try.leaf.help')}>
          <Suspense fallback={<Skeleton lines={4} />}>
            <LeafTool />
          </Suspense>
        </ToolCard>
        <ToolCard id="receipt" n={3} tone="monsoon" title={t('try.receipt.title')} help={t('try.receipt.help')}>
          <ReceiptTool />
        </ToolCard>
        <ToolCard id="weather" n={4} tone="terracotta" wide title={t('try.weather.title')} help={t('try.weather.help')}>
          <WeatherTool />
        </ToolCard>
        <ToolCard id="savings" n={5} tone="hyacinth" title={t('try.savings.title')} help={t('try.savings.help')}>
          <SavingsTool />
        </ToolCard>
        <ToolCard id="recall" n={6} tone="lotus" title={t('try.recall.title')} help={t('try.recall.help')}>
          <RecallTool />
        </ToolCard>
      </div>
    </div>
  );
}

const TONES = ['butter', 'moss', 'monsoon', 'terracotta', 'hyacinth', 'lotus'] as const;
