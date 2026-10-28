import type { HTMLAttributes } from 'react';
import { cx } from '../lib/cx';
import type { TrafficLight } from '../lib/api/types';

export type Tone = 'neutral' | 'go' | 'wait' | 'stop' | 'carbon';

/** One small label per item (DESIGN.md rule 3). Colour tones always come with a word. */
export function Chip({ tone = 'neutral', dot, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span className={cx('chip', tone !== 'neutral' && `chip-${tone}`, className)} {...rest}>
      {dot && <span className="dot" aria-hidden />}
      {children}
    </span>
  );
}

export const toneOfLight = (l?: TrafficLight | null): Tone => (l === 'green' ? 'go' : l === 'amber' ? 'wait' : l === 'red' ? 'stop' : 'neutral');
