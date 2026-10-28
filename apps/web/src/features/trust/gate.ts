import type { AreaStats, GateEvent, PhotoCase } from '../../lib/api/types';
import { AREA_LABELS } from './labels';
import { POLICY_V1, type Policy } from './policy';

/**
 * State logic for the earned-trust screens: pure functions over what the API sent, so the farmer card, the officer
 * detail and the trust panel can never disagree about what a number means. No fetching and no React in here.
 */

/* ------------------------------------------------------------------ the meter */

/**
 *  collecting  fewer than `minSure` sure verdicts in the window: the bound exists but does not count yet
 *  building    enough sure verdicts, and the lower bound is still below the bar
 *  open        the gate stands
 */
export type MeterPhase = 'collecting' | 'building' | 'open';

export interface MeterView {
  phase: MeterPhase;
  gateOpen: boolean;
  /** all officer verdicts in the area */
  verdicts: number;
  /** sure suggestions among the last `window` judged ones, and how many of them were right */
  sure: number;
  sureRight: number;
  need: number;
  /** sure verdicts still missing before the bound counts (0 once it counts) */
  remaining: number;
  /** 0..1, sure / need, capped */
  sureProgress: number;
  lowerBound: number;
  /** the bound is based on enough sure verdicts to count toward the gate */
  counted: boolean;
  precision: number | null;
  bar: number;
  closeBar: number;
  /** counted and at or above the bar */
  reachedBar: boolean;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

export function meterView(a: AreaStats | null | undefined, p: Policy = POLICY_V1): MeterView {
  const sure = Math.max(0, a?.sure_in_window ?? 0);
  const counted = sure >= p.minSure;
  const lowerBound = clamp01(a?.lower_bound ?? 0);
  const gateOpen = !!a?.gate_open;
  return {
    phase: gateOpen ? 'open' : counted ? 'building' : 'collecting',
    gateOpen,
    verdicts: Math.max(0, a?.verdicts ?? 0),
    sure,
    sureRight: Math.max(0, a?.sure_right_in_window ?? 0),
    need: p.minSure,
    remaining: Math.max(0, p.minSure - sure),
    sureProgress: clamp01(p.minSure > 0 ? sure / p.minSure : 1),
    lowerBound,
    counted,
    precision: a?.precision ?? null,
    bar: p.openLb,
    closeBar: p.closeLb,
    reachedBar: counted && lowerBound >= p.openLb,
  };
}

/* ------------------------------------------------------------------ photo cases */

/**
 *  open      waiting for the officer
 *  resolved  the officer answered
 *  auto      answered automatically (the gate was open): nothing for the officer to do
 */
export type CaseStatus = 'open' | 'resolved' | 'auto';

export function caseStatus(c: PhotoCase): CaseStatus {
  if (c.verdict) return 'resolved';
  return c.route === 'auto' ? 'auto' : 'open';
}

export const newestFirst = <T extends { created_at: string }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));

/** The labels outside the frozen top-2: what "something else" offers. */
export function otherLabels(c: PhotoCase, all: readonly string[] = AREA_LABELS): string[] {
  const top = new Set(c.suggestion.slice(0, 2).map((s) => s.label));
  return all.filter((l) => !top.has(l));
}

/** What the officer's verdict says about the frozen suggestion. It was recorded before the officer answered. */
export interface VerdictReview {
  chosen: string;
  suggested: string;
  suggestedProb: number;
  /** where the officer's label stood in the frozen top-2: 0 = first, 1 = second, null = neither */
  rank: 0 | 1 | null;
  /** the first suggestion was right */
  right: boolean;
  /** the first suggestion was sure (top probability at or above the policy's level) */
  sure: boolean;
  /** only sure suggestions are evidence for the gate */
  countsTowardGate: boolean;
}

export function reviewVerdict(c: PhotoCase, chosen: string | null = c.verdict): VerdictReview | null {
  const first = c.suggestion[0];
  if (!chosen || !first) return null;
  const rank = c.suggestion.findIndex((s) => s.label === chosen);
  return {
    chosen,
    suggested: first.label,
    suggestedProb: first.prob,
    rank: rank === 0 ? 0 : rank === 1 ? 1 : null,
    right: first.label === chosen,
    sure: c.sure,
    countsTowardGate: c.sure,
  };
}

/* ------------------------------------------------------------------ evidence moving */

export interface EvidenceDelta {
  /** null when the area's numbers before this verdict were not at hand */
  before: MeterView | null;
  after: MeterView;
  /** the lower bound moved up through the bar / down through the close line with this verdict */
  crossedUp: boolean;
  crossedDown: boolean;
  /** the sure window changed (a sure suggestion was judged) */
  sureCounted: boolean;
}

export function evidenceDelta(before: AreaStats | null | undefined, after: AreaStats, p: Policy = POLICY_V1): EvidenceDelta {
  const a = before ? meterView(before, p) : null;
  const b = meterView(after, p);
  return {
    before: a,
    after: b,
    crossedUp: !!a && a.lowerBound < p.openLb && b.lowerBound >= p.openLb,
    crossedDown: !!a && a.lowerBound >= p.closeLb && b.lowerBound < p.closeLb,
    sureCounted: !!a && (b.sure !== a.sure || b.sureRight !== a.sureRight),
  };
}

/* ------------------------------------------------------------------ gate events */

export const isOpened = (e: GateEvent | null | undefined): e is GateEvent => e?.event === 'opened';
export const isClosed = (e: GateEvent | null | undefined): e is GateEvent => e?.event === 'closed';

/** The most recent gate event of an area, if any. */
export const lastEvent = (a: AreaStats | null | undefined): GateEvent | null => a?.events?.at(-1) ?? null;

/* ------------------------------------------------------------------ advice receipts that relied on a photo reading */

const PHOTO_TRUST_RULE = /^photo trust for (.+) in (.+)$/;

/** `rules` of a recalled receipt: "photo trust for <model> in <area>" means an area's trust was withdrawn, not a rule. */
export function splitRecalled(rules: readonly string[] | undefined): { photoTrust: { entry: string; model: string; area: string }[]; rules: string[] } {
  const photoTrust: { entry: string; model: string; area: string }[] = [];
  const other: string[] = [];
  for (const r of rules ?? []) {
    const m = PHOTO_TRUST_RULE.exec(r);
    if (m) photoTrust.push({ entry: r, model: m[1]!, area: m[2]! });
    else other.push(r);
  }
  return { photoTrust, rules: other };
}
