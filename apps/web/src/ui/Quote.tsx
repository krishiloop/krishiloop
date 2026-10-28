import type { ReceiptSource } from '../lib/api/types';
import { useI18n } from '../lib/i18n';
import { cx } from '../lib/cx';

/**
 * A verbatim source passage, set like the manual it came from (serif), with its page and publisher.
 * `lines` clamps long passages in compact places; the full text stays in the DOM for screen readers and search.
 */
export function Quote({ source, lines, className }: { source: ReceiptSource; lines?: number; className?: string }) {
  const { t } = useI18n();
  return (
    <figure className={cx('m-0', className)}>
      <blockquote
        lang={source.language}
        className="quote m-0 text-ink"
        style={lines ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}
      >
        “{source.quote}”
      </blockquote>
      <figcaption className="mt-2 text-sm text-ink-3">
        <span className="mono text-xs text-ink-2">{t('ui.receipt.page', { page: String(source.page) })}</span>
        <span aria-hidden> · </span>
        {source.publisher}
      </figcaption>
    </figure>
  );
}
