/** The house section heading (mono label with a hairline, a tight title, at most one line), shared by the app screens. */
import type { CSSProperties, ReactNode } from 'react';
import { cn as cx } from './cn';

/**
 * Same look as the home page's `Head`, without importing the home chunk. `accent` is the one italic serif phrase,
 * set on its own line after the title. Reveals on scroll (data-reveal), 70 ms apart.
 */
export function Heading({ eyebrow, title, accent, lead, id, className, size = 'title' }: { eyebrow: string; title: ReactNode; accent?: ReactNode; lead?: ReactNode; id?: string; className?: string; size?: 'title' | 'head' }) {
  return (
    <header className={cx('max-w-3xl', className)}>
      <p className="label m-0 flex items-center gap-2.5" data-reveal>
        <span className="h-px w-8 bg-ink-3" aria-hidden />
        {eyebrow}
      </p>
      <h2 id={id} className={cx(size === 'head' ? 't-head' : 't-title', 'm-0 mt-5 text-ink')} data-reveal style={{ '--i': 1 } as CSSProperties}>
        {title}
        {accent ? <span className="serif-i block text-ink-2">{accent}</span> : null}
      </h2>
      {lead && (
        <p className="t-lead m-0 mt-5 max-w-[52ch]" data-reveal style={{ '--i': 2 } as CSSProperties}>
          {lead}
        </p>
      )}
    </header>
  );
}
