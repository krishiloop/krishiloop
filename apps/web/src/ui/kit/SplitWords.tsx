import { Fragment, type CSSProperties } from 'react';
import { cn } from './cn';

/**
 * A masked word-by-word rise for display headlines (the house reveal: 1.1 s expo-out, 70 ms stagger). CSS only, so
 * it stays smooth while the page is still loading. Screen readers get the sentence once; the animated words are
 * hidden from them.
 */
export function SplitWords({
  text,
  className,
  wordClassName,
  delay = 0,
  stagger = 0.07,
  play = true,
}: {
  text: string;
  className?: string;
  wordClassName?: (word: string, i: number) => string | undefined;
  delay?: number;
  stagger?: number;
  play?: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((w, i) => (
          <Fragment key={`${w}-${i}`}>
            <span className="split-w">
              <span className={cn('split-in', play && 'is-play', wordClassName?.(w, i))} style={{ '--d': `${delay + i * stagger}s` } as CSSProperties}>
                {w}
              </span>
            </span>
            {/* the space sits between the clipping boxes: inside one it would be trimmed */}
            {i < words.length - 1 ? ' ' : null}
          </Fragment>
        ))}
      </span>
    </span>
  );
}
