import { cx } from '../../lib/cx';

/**
 * KrishiLoop mark: an open loop (the receipt cycle: advice -> proof -> recall -> better advice) with a rice leaf
 * growing out through the gap. The ring takes the text colour; the leaf takes the sun accent.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={cx('flex-none', className)}>
      <circle cx="16" cy="17.5" r="10.2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="50.6 13.5" transform="rotate(-58 16 17.5)" />
      <path d="M12.6 20.6C12.9 14.4 17.2 9.4 25.3 6.6c-.6 6.4-4.9 11.9-12.7 14Z" fill="var(--color-sun)" />
      <path d="M13 20.2c2.6-3.6 6-6.3 10-8.3" stroke="var(--color-void)" strokeOpacity=".28" strokeWidth="1" strokeLinecap="round" />
      <circle cx="11.4" cy="21.9" r="1.5" fill="var(--color-sun)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-baseline gap-[1px] text-[1.15rem] leading-none font-semibold tracking-tight', className)} translate="no">
      Krishi<span className="font-serif text-[1.3em] font-normal italic text-sun">Loop</span>
    </span>
  );
}
