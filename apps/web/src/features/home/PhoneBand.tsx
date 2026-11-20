import type { CSSProperties } from 'react';
import { useI18n } from '../../lib/i18n';
import { LiquidLink } from '../../ui/kit/LiquidButton';
import { OpenOnPhone } from '../mobile/OpenOnPhone';
import { FarmerCameo } from '../../ui/farmer/FarmerCameo';

/**
 * "Use it on your phone" (builder Ho, v5): the owner's ask, "I just scan a code or use a copy link". On a laptop the
 * QR and "Copy link" (builder Mo's OpenOnPhone) move the visitor to the phone app (/m) in one scan; on a phone, one
 * button opens it. A hyacinth mesh with the deck's flowering sprig.
 */
export function PhoneBand() {
  const { t } = useI18n();
  return (
    <section className="sheet-band mesh mesh-hyacinth botanic-bg botanic-bg--flower section" aria-labelledby="phone-title" data-testid="phone-band">
      <div className="wrap ph-grid">
        <div>
          <FarmerCameo mood="phone" />
          <h2 id="phone-title" className="t-title m-0 max-w-[16ch]" data-reveal style={{ '--i': 1 } as CSSProperties}>
            {t('home.phone.title')}
          </h2>
          <div className="mt-8" data-reveal style={{ '--i': 3 } as CSSProperties}>
            <LiquidLink to="/m" size="lg" arrow>
              {t('home.phone.open')}
            </LiquidLink>
          </div>
        </div>
        <div className="ph-card" data-reveal style={{ '--i': 2 } as CSSProperties}>
          <div data-tilt="4">
            <OpenOnPhone compact />
          </div>
        </div>
      </div>
    </section>
  );
}
