import { useI18n } from '../../lib/i18n';
import '../../lib/i18n/strings.krishiguard';
import { Drawer } from '../farmer/calc/Drawer';
import { VisitForm } from '../farmer/climate/VisitForm';
import '../farmer/climate/climate.css';

/** "Call my officer": the farmer app's booking drawer (visit or call), reused as it is. Its own chunk, loaded on the tap. */
export default function Booking({ open, onClose, fieldId, profileId }: { open: boolean; onClose: () => void; fieldId: string; profileId: string }) {
  const { t } = useI18n();
  return (
    <Drawer open={open} onClose={onClose} title={t('fa.visit.title')} subtitle={t('fa.visit.sub')} testId="m-visit-drawer">
      <VisitForm fieldId={fieldId} profileId={profileId} farmerLabel={profileId} onDone={onClose} />
    </Drawer>
  );
}
