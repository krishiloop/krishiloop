import { Link } from 'react-router-dom';
import { useI18n } from '../lib/i18n';
import { Logo } from '../ui/Logo';
import { NAV_ALL } from './SiteHeader';

const REPO = 'https://github.com/krishiloop/krishiloop';

/** The end of every page: the sentence, where to go, where the evidence lives, and the honest footnote. */
export function SiteFooter() {
  const { t } = useI18n();
  const evidence = [
    { href: REPO, label: t('ui.footer.code') },
    { href: `${REPO}/blob/main/ml/vision/MODEL_CARD.md`, label: t('ui.footer.modelCard') },
    { href: `${REPO}/tree/main/docs/prompt-library`, label: t('ui.footer.prompts') },
    { href: `${REPO}/tree/main/contracts/schemas`, label: t('ui.footer.api') },
  ];
  return (
    <footer className="border-t border-rule bg-sunk/50">
      <div className="wrap grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr] md:py-20">
        <div>
          <Logo />
          <p className="mt-5 max-w-[34ch] text-[1.05rem] leading-relaxed text-ink-2">{t('ui.footer.tag')}</p>
        </div>
        <nav aria-label={t('ui.footer.product')}>
          <p className="eyebrow">{t('ui.footer.product')}</p>
          <ul className="m-0 mt-4 list-none space-y-2.5 p-0">
            {NAV_ALL.map((n) => (
              <li key={n.to}>
                <Link to={n.to} className="link no-underline hover:underline">
                  {t(n.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={t('ui.footer.evidence')}>
          <p className="eyebrow">{t('ui.footer.evidence')}</p>
          <ul className="m-0 mt-4 list-none space-y-2.5 p-0">
            {evidence.map((e) => (
              <li key={e.href}>
                <a href={e.href} className="link no-underline hover:underline" target={e.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                  {e.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-rule">
        <div className="wrap flex flex-col gap-2 py-6 text-sm text-ink-3 md:flex-row md:justify-between">
          <p className="m-0">{t('ui.footer.credit')}</p>
          <p className="m-0">{t('ui.footer.noPii')}</p>
        </div>
      </div>
    </footer>
  );
}
