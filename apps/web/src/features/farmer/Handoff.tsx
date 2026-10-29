import { Headset, Smartphone } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

/**
 * "Not sure" goes to a person. A drawing of the hand-off: the case leaves the farmer's phone once and arrives at the
 * officer (900 ms, once), then stays there in the calm wait colour. The real case number is printed next to it, so this
 * is aria-hidden.
 */
export function Handoff() {
  const { t } = useI18n();
  return (
    <div className="fa-handoff" aria-hidden>
      <span className="fa-handoff-end">
        <span className="fa-handoff-ic">
          <Smartphone size={17} strokeWidth={1.8} />
        </span>
        {t('fa.handoff.you')}
      </span>
      <span className="fa-handoff-line">
        <span className="fa-handoff-run">
          <span className="fa-handoff-dot" />
        </span>
      </span>
      <span className="fa-handoff-end" data-officer>
        <span className="fa-handoff-ic">
          <Headset size={17} strokeWidth={1.8} />
        </span>
        {t('fa.handoff.officer')}
      </span>
    </div>
  );
}
