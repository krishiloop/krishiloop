import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Wordmark } from '../ui/kit/LoopMark';
import { FlickeringGrid } from '../ui/kit/FlickeringGrid';
import { LinkButton } from '../ui/Button';
import { NAV_ALL } from './SiteHeader';

const REPO = 'https://github.com/krishiloop/krishiloop';

/**
 * The end of every page: one big sentence, where to go, where the evidence lives, the standards, and the honest
 * footnote, over a field of flickering squares (a crop seen from above at night).
 */
export function SiteFooter() {
  const { t } = useI18n();
  const evidence = [
    { href: REPO, label: t('ui.footer.code') },
    { href: `${REPO}/blob/main/ml/vision/MODEL_CARD.md`, label: t('ui.footer.modelCard') },
    { href: `${REPO}/tree/main/docs/prompt-library`, label: t('ui.footer.prompts') },
    { href: `${REPO}/tree/main/contracts/schemas`, label: t('ui.footer.api') },
    { href: '/docs/', label: t('ui.footer.docs') },
    { href: '/design-system/', label: t('ui.footer.design') },
  ];
  return (
    <footer className="band-night relative mt-10 overflow-hidden">
      {/* the deck's closing art: the rice plant rising from the bottom edge (the team's own drawing) */}
      <img src="/art/rice-plant.webp" alt="" aria-hidden loading="lazy" decoding="async" className="botanic bottom-0 right-[4%] w-[min(46vw,560px)]" />
      <div className="wrap relative z-10 pt-20 md:pt-28">
        <div className="grid items-end gap-10 lg:grid-cols-[1fr_auto]">
          <p className="t-display m-0 max-w-[14ch] text-ink" data-reveal>
            {t('ui.footer.big')}
          </p>
          <div className="flex flex-wrap gap-3 lg:pb-4" data-reveal style={{ ['--i' as string]: 1 }}>
            {/* plain links styled as the liquid pills: the shell never loads the animation library */}
            <LinkButton to="/app" variant="primary" size="lg" arrow>
              {t('ui.cta.tryApp')}
            </LinkButton>
            <LinkButton to="/verify" variant="ghost" size="lg" className="liquid liquid-glass glass">
              {t('ui.cta.verify')}
            </LinkButton>
          </div>
        </div>
        <div className="mt-16 grid gap-12 border-t border-rule pt-12 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="mt-5 max-w-[40ch] text-[1rem] leading-relaxed text-ink-2">{t('ui.footer.tag')}</p>
            <p className="label mt-6">{t('ui.footer.standards')}</p>
          </div>
          <nav aria-label={t('ui.footer.product')}>
            <p className="label">{t('ui.footer.product')}</p>
            <ul className="m-0 mt-5 list-none space-y-3 p-0">
              {NAV_ALL.map((n) => (
                <li key={n.to}>
                  <Link to={n.to} className="text-ink-2 transition-colors duration-200 hover:text-ink">
                    {t(n.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label={t('ui.footer.evidence')}>
            <p className="label">{t('ui.footer.evidence')}</p>
            <ul className="m-0 mt-5 list-none space-y-3 p-0">
              {evidence.map((e) => (
                <li key={e.href}>
                  <a href={e.href} className="group inline-flex items-center gap-1 text-ink-2 transition-colors duration-200 hover:text-ink" target="_blank" rel="noreferrer">
                    {e.label}
                    <ArrowUpRight size={14} className="opacity-50 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="mt-14 flex flex-col gap-2 border-t border-rule py-7 text-[0.85rem] text-ink-3 md:flex-row md:justify-between">
          <p className="m-0">{t('ui.footer.credit')}</p>
          <p className="m-0">{t('ui.footer.noPii')}</p>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] [mask-image:linear-gradient(to_top,#000_10%,transparent)]" aria-hidden>
        <FlickeringGrid square={3} gap={7} chance={0.05} maxOpacity={0.22} />
      </div>
    </footer>
  );
}
