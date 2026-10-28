import { cx } from '../lib/cx';

/** The mark: a receipt with a torn foot and a tick. The product in one glyph (advice that comes with proof). */
export function LogoMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={cx('flex-none', className)} aria-hidden>
      <path d="M5.5 2.75h13v18.5l-2.17-1.4-2.16 1.4-2.17-1.4-2.17 1.4-2.16-1.4-2.17 1.4z" />
      <path d="M8.75 11.6l2.25 2.25 4.4-4.85" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-2 text-ink', className)}>
      <LogoMark size={22} />
      <span className="text-[1.22rem] font-[700] leading-none tracking-[-0.015em] [font-stretch:84%]">KrishiLoop</span>
    </span>
  );
}
