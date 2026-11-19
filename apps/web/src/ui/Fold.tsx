import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { cx } from '../lib/cx';

/**
 * "Show more": the long caveat, the technical name or the file list lives here, closed, so a page shows the number and
 * one short line first (v6, 20 Nov: "text-heavy AI slop"). A plain <details>: works without script, find-in-page opens it.
 */
export function Fold({ children, label, className, testId }: { children: ReactNode; label?: string; className?: string; testId?: string }) {
  const { t } = useI18n();
  return (
    <details className={cx('fold', className)} data-testid={testId}>
      <summary>
        <ChevronRight size={14} aria-hidden className="fold-chev" />
        {label ?? t('ui.more')}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
