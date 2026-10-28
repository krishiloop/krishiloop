import { CalendarCheck, ClipboardCheck, Droplets, Eye, Sprout, UserRound, Wheat, type LucideIcon } from 'lucide-react';
import type { ActionKind, Decision } from '../lib/api/types';

/**
 * Decision pictograms, drawn for farmers who read little: a knapsack sprayer, the same sprayer struck through, and a
 * leaf under a magnifier. 64 × 64, 2.5 px strokes in currentColor, so the tone colours them.
 */
function Sprayer({ struck }: { struck?: boolean }) {
  return (
    <>
      <rect x="11" y="19" width="22" height="31" rx="5" />
      <path d="M17 19v-4.5h10V19" />
      <path d="M11 30h22" />
      <path d="M33 42c7 0 9-4 11-9l7-12" />
      <path d="M49 17.5l6.5 4" />
      <path d="M57.5 12.5l2.5-2.5M59.5 18.5h3.5M54.5 8l1-3.5" />
      {struck && (
        <>
          <path d="M9 9l46 46" stroke="var(--pict-bg, var(--color-card))" strokeWidth="9" />
          <path d="M9 9l46 46" />
        </>
      )}
    </>
  );
}
function Recheck() {
  return (
    <>
      <path d="M10 49c0-19 12-32 31-34-1.5 20-13.5 33-31 34z" />
      <path d="M10 49l19-19" />
      <circle cx="44" cy="43" r="9" stroke="var(--pict-bg, var(--color-card))" strokeWidth="9" />
      <circle cx="44" cy="43" r="9" fill="var(--pict-bg, var(--color-card))" />
      <path d="M50.5 49.5l7 7" />
    </>
  );
}

export function DecisionPictogram({ decision, size = 56, className }: { decision?: Decision; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {decision === 'recheck' ? <Recheck /> : <Sprayer struck={decision === 'dont_spray'} />}
    </svg>
  );
}

const KIND_ICON: Record<ActionKind, LucideIcon> = {
  input_decision: ClipboardCheck,
  monitoring: Eye,
  irrigation: Droplets,
  harvest: Wheat,
  nutrient: Sprout,
  officer_contact: UserRound,
  practice: CalendarCheck,
  other: ClipboardCheck,
};

/** A small line icon for an action that is not the spray decision. */
export function KindIcon({ kind, size = 20, className }: { kind: ActionKind; size?: number; className?: string }) {
  const Icon = KIND_ICON[kind] ?? ClipboardCheck;
  return <Icon size={size} strokeWidth={1.75} className={className} aria-hidden />;
}
