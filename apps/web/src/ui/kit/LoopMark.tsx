import { cn } from './cn';

/**
 * The mark: a loop that is almost closed, and the dot that travels it. Advice goes out, comes back checked, and a
 * wrong rule can be called back along the same loop.
 */
export function LoopMark({ size = 26, className, live }: { size?: number; className?: string; live?: boolean }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" className={cn('flex-none', className)} aria-hidden>
      <circle cx="16" cy="16" r="11.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="62 10.3" transform="rotate(-62 16 16)" />
      <g className={live ? 'loopmark-orbit' : undefined} style={{ transformOrigin: '16px 16px' }}>
        <circle cx="16" cy="4.5" r="3.1" fill="var(--color-sprout)" />
      </g>
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-ink', className)}>
      <LoopMark size={26} />
      <span className="text-[1.18rem] font-[620] leading-none tracking-[-0.035em]">KrishiLoop</span>
    </span>
  );
}
