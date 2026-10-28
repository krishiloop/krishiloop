import type { ReplaySettings } from '../../lib/api/types';

/**
 * The photo-trust policy the screens explain (plan/EARNED_TRUST_DESIGN.md section 2).
 *
 * `POLICY_V1` mirrors `rules/policy/photo-trust.yaml` version 1 (team-set numbers, draft, not reviewed by an agronomist or a
 * statistician). The server is the one that applies the policy; these numbers only label the bar on a meter and a chart.
 * Where the API states the policy it wins: the replay carries its own `settings`, and an area's stats carry `policy_version`.
 */
export interface Policy {
  /** a suggestion is "sure" at or above this top probability */
  sure: number;
  /** the gate looks at the officer's verdicts on the last `window` sure suggestions */
  window: number;
  /** ...and needs at least this many of them before it may open */
  minSure: number;
  /** the gate opens when the Wilson 95% lower bound on their precision reaches this */
  openLb: number;
  /** the gate closes again (drift) when the bound falls below this */
  closeLb: number;
  /** share of automatic answers that are still sent to the officer as an audit */
  audit: number;
}

export const POLICY_V1: Policy = { sure: 0.85, window: 50, minSure: 30, openLb: 0.85, closeLb: 0.8, audit: 0.1 };

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** The policy a replay says it was run with (any missing number falls back to version 1). */
export function policyFromSettings(s?: Partial<ReplaySettings> | null): Policy {
  if (!s) return POLICY_V1;
  return {
    sure: num(s.sure, POLICY_V1.sure),
    window: num(s.window, POLICY_V1.window),
    minSure: num(s.min_n, POLICY_V1.minSure),
    openLb: num(s.open_lb, POLICY_V1.openLb),
    closeLb: num(s.close_lb, POLICY_V1.closeLb),
    audit: num(s.audit, POLICY_V1.audit),
  };
}

/** Wilson score interval, lower end (same formula and z as services/vision/ledger.py). */
export function wilsonLowerBound(k: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = k / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
}

/** The fewest right answers out of `n` sure ones whose lower bound reaches `bar` (null when even all of them cannot). */
export function requiredRight(n: number, bar: number): number | null {
  for (let k = 0; k <= n; k++) if (wilsonLowerBound(k, n) >= bar) return k;
  return null;
}
