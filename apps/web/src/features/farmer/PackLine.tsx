import { Package } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { usePacks } from '../../lib/api/hooks';

/**
 * Which rule pack the API holds for a crop (GET /api/packs), with its rule count. Symptom signatures are "planned":
 * the Knowledge Compiler is not built, and the API says so. Nothing is shown when the API did not answer.
 */
export function PackLine({ crop, className }: { crop: string; className?: string }) {
  const { t, lang } = useI18n();
  const packs = usePacks();
  const pack = packs?.find((p) => p.crops.includes(crop));
  if (!pack) return null;
  return (
    <p className={className ?? 'pack-line'} data-testid="pack-line">
      <Package size={13} aria-hidden />
      <span className="mono">{pack.pack_id}</span>
      <span>{t('packs.rules', { n: fmtNum(pack.rules, lang) })}</span>
      <span>{t('packs.signatures')}</span>
    </p>
  );
}
