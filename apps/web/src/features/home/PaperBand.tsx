import type { CSSProperties } from 'react';
import { useI18n } from '../../lib/i18n';
import { LinkButton } from '../../ui/Button';
import { ReceiptCard } from '../../ui/Receipt';
import { Magnetic } from '../../ui/kit/Magnetic';
import { STORY } from '../story/storyData';

/**
 * The one light sheet on the page: receipts are paper, so this band is paper too. Two real receipts lie on it
 * (a Bangladeshi rice decision and a Kenyan potato one); the button leads to the page where one prints.
 */
export function PaperBand() {
  const { t } = useI18n();
  return (
    <section className="sheet-band paper-object bg-paper" aria-labelledby="paper-title">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="wrap relative grid items-center gap-14 py-[clamp(72px,9vw,136px)] lg:grid-cols-[1fr_1.1fr]">
        <div>
          <h2 id="paper-title" className="t-hero text-ink" data-reveal style={{ '--i': 1 } as CSSProperties}>
            {t('home.paper.title')}
          </h2>
          <p className="t-lead mt-6 max-w-[42ch]" data-reveal style={{ '--i': 2 } as CSSProperties}>
            {t('home.paper.line')}
          </p>
          <div className="mt-9" data-reveal style={{ '--i': 3 } as CSSProperties}>
            <Magnetic>
              <LinkButton to="/receipt" variant="secondary" size="lg" arrow className="border-ink/25 bg-ink text-paper hover:bg-ink/90 hover:text-paper">
                {t('home.paper.cta')}
              </LinkButton>
            </Magnetic>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-[420px] pb-6" data-reveal style={{ '--i': 1 } as CSSProperties}>
          <div className="relative -rotate-[3deg]">
            <ReceiptCard receipt={STORY.calm.action.receipt} status="authentic" compact tiny />
          </div>
        </div>
      </div>
    </section>
  );
}
