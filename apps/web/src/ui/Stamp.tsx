import type { CSSProperties, ReactNode } from 'react';
import { useI18n } from '../lib/i18n';
import { cx } from '../lib/cx';

export type StampKind = 'authentic' | 'recalled' | 'invalid' | 'expired' | 'checking';

const TONE: Record<StampKind, string> = {
  authentic: 'stamp-go',
  recalled: 'stamp-stop',
  invalid: 'stamp-ink',
  expired: 'stamp-wait',
  checking: 'stamp-ink',
};
/** `inherit`: no inline size, so a className can size it per breakpoint */
const SIZE = { sm: '1.05rem', md: '1.6rem', lg: '2.6rem', xl: 'clamp(2.6rem, 1.6rem + 4vw, 4.6rem)', inherit: undefined } as const;

/**
 * A rubber-stamp verdict. `land` plays the landing (DESIGN.md: 420 ms with an overshoot); give the stamp a new
 * `key` to land it again. The word is real text, so screen readers read it.
 */
export function Stamp({
  kind,
  sub,
  land,
  size = 'md',
  tilt,
  className,
  style,
}: {
  kind: StampKind;
  sub?: ReactNode;
  land?: boolean;
  size?: keyof typeof SIZE;
  tilt?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useI18n();
  return (
    <span
      className={cx('stamp', TONE[kind], land && 'stamp-land', className)}
      style={{ fontSize: SIZE[size], ...(tilt != null ? ({ '--tilt': `${tilt}deg` } as CSSProperties) : null), ...style }}
    >
      {t(`ui.stamp.${kind}`)}
      {sub && <small>{sub}</small>}
    </span>
  );
}
