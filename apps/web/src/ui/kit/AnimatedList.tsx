/** Magic UI AnimatedList, rebuilt in CSS (no Motion): items rise in, one after another; a later arrival lands on top with a short sprout flash. */
import { Children, isValidElement, useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { cn as cx } from './cn';
import './animated-list.css';

/**
 * A list whose items arrive: the first batch staggers in (60 ms apart, at most 8 steps), and any item that appears later
 * (a new case in the inbox) slides in and flashes once so the officer sees what is new. Children must be keyed elements;
 * each is wrapped in an <li>. Items already seen never animate again (React keeps their nodes). Under reduced motion the
 * global rule shortens it all to a short fade.
 */
export function AnimatedList({ children, className, itemClassName, testId, label }: { children: ReactNode; className?: string; itemClassName?: string; testId?: string; label?: string }) {
  const seen = useRef<Set<string> | null>(null);
  const first = seen.current === null;
  const items = Children.toArray(children).filter(isValidElement) as ReactElement[];
  const keys = items.map((c) => String(c.key));
  useEffect(() => {
    seen.current ??= new Set();
    keys.forEach((k) => seen.current!.add(k));
  });
  return (
    <ul className={cx('al-list', className)} data-testid={testId} aria-label={label}>
      {items.map((child, i) => {
        const k = String(child.key);
        const fresh = !first && !seen.current!.has(k);
        return (
          <li key={k} className={cx('al-item', fresh && 'is-new', itemClassName)} style={{ '--i': first ? Math.min(i, 8) : 0 } as CSSProperties}>
            {child}
          </li>
        );
      })}
    </ul>
  );
}
