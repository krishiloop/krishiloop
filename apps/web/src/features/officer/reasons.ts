import type { Key } from '../../lib/i18n';
import { humanize } from '../../lib/format';

/** Why a case came to the officer, in plain words, with one line on what it means. Unknown codes are shown humanised. */
export const REASONS = [
  'rule_recalled',
  'question_unanswered',
  'data_stale',
  'data_unavailable',
  'low_confidence',
  'out_of_distribution',
  'missing_source',
  'validator_blocked',
  'conflicting_rules',
  'farmer_requested',
  'no_matching_rule',
  'unsafe_intent',
  'no_rule_for_problem',
  'visit_request',
] as const;
export type KnownReason = (typeof REASONS)[number];

const isKnown = (c: string): c is KnownReason => (REASONS as readonly string[]).includes(c);

export function reasonTitle(code: string, t: (k: Key) => string): string {
  return isKnown(code) ? t(`off.reason.${code}`) : humanize(code);
}

export function reasonHint(code: string, t: (k: Key) => string): string | null {
  return isKnown(code) ? t(`off.hint.${code}`) : null;
}

/** "R-BDR-002 v1" -> rule id and version (inbox `details.recalled` entries). */
export function parseRuleLabel(s: string): { rule_id: string; version: number } | null {
  const m = /^(R-[A-Z]{2,8}-\d{3}) v(\d+)$/.exec(s.trim());
  return m ? { rule_id: m[1]!, version: Number(m[2]) } : null;
}
