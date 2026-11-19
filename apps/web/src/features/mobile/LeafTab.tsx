import { lazy, Suspense } from 'react';
import { Hand, Leaf, Sun } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { TabId } from '../farmer/TabBar';

/**
 * The leaf check is builder X's AgriTriage-Lite screen, imported as it is (never forked): the model reads the photo on
 * the phone, so it works with no internet once the model has loaded once. Its "Take a photo" button opens the camera
 * directly (`capture="environment"`). This tab adds only three tips for a good photo above it.
 */
const AiPhoto = lazy(() => import('../farmer/photo/AiPhoto'));

export default function LeafTab({ onTab }: { onTab: (t: TabId) => void }) {
  const { t } = useI18n();
  return (
    <div className="m-leaf grid gap-5" data-testid="m-leaf">
      <h2 className="sr-only-live">{t('m.leaf.title')}</h2>
      <section className="m-tips" aria-label={t('m.leaf.tips')}>
        <p className="m-tips-sub">{t('m.leaf.sub')}</p>
        <ul className="m-tips-row">
          <li>
            <Leaf size={18} aria-hidden />
            {t('m.leaf.tip1')}
          </li>
          <li>
            <Sun size={18} aria-hidden />
            {t('m.leaf.tip2')}
          </li>
          <li>
            <Hand size={18} aria-hidden />
            {t('m.leaf.tip3')}
          </li>
        </ul>
      </section>
      <Suspense fallback={<div className="skeleton h-64" aria-hidden />}>
        <AiPhoto onTab={onTab} />
      </Suspense>
    </div>
  );
}
