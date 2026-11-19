import { Link } from 'react-router-dom';
import { ArrowRight, CloudRain, Leaf, RotateCcw, SprayCan, type LucideIcon } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import '../../lib/i18n/strings.trystrip';
import './teaser.css';

const ITEMS: { id: string; icon: LucideIcon; title: Key; sub: Key; tone: string }[] = [
  { id: 'spray', icon: SprayCan, title: 'try.strip.spray', sub: 'try.strip.spraySub', tone: 'butter' },
  { id: 'leaf', icon: Leaf, title: 'try.strip.leaf', sub: 'try.strip.leafSub', tone: 'moss' },
  { id: 'weather', icon: CloudRain, title: 'try.strip.weather', sub: 'try.strip.weatherSub', tone: 'terracotta' },
  { id: 'recall', icon: RotateCcw, title: 'try.strip.recall', sub: 'try.strip.recallSub', tone: 'lotus' },
];

/**
 * The "Try it" strip: four shortcuts into /try, for the home page (the lead places it). Light on purpose: its own few
 * words (en.trystrip.ts), its own small stylesheet, no tool code; each link opens /try at that tool.
 */
export function TryTeaser({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <section className={`try-strip ${className ?? ''}`} aria-labelledby="try-strip-title" data-testid="try-teaser">
      <div className="try-strip-head">
        <h2 id="try-strip-title" className="try-strip-title">
          {t('try.strip.title')}
        </h2>
        <Link to="/try" className="try-strip-all">
          {t('try.strip.all')} <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
      <ul className="try-strip-list">
        {ITEMS.map(({ id, icon: Icon, title, tone }) => (
          <li key={id}>
            <Link to={`/try#${id}`} className={`try-strip-item tone-${tone}`}>
              <span className="try-strip-icon" aria-hidden>
                <Icon size={20} strokeWidth={1.8} />
              </span>
              <span className="min-w-0">
                <span className="try-strip-name">{t(title)}</span>
              </span>
              <ArrowRight size={16} aria-hidden className="try-strip-arrow" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default TryTeaser;
