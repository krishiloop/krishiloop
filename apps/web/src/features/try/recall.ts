import type { Receipt, RuleRef } from '../../lib/api/types';

/**
 * "Take advice back (recall)": three RECORDED receipts (our server's own, 2 Nov 2026, signed by the development key)
 * and the rules they cite. A recall here is SIMULATED in this browser with the app's own sample-mode recall
 * (lib/api/mocks.ts simulateRecall), and each receipt's verdict comes from the same place the verifier reads it
 * (mockVerify): a receipt turns "Recalled" when any rule version it cites is withdrawn, as on the server.
 */
export const SAMPLE_RECEIPTS = [
  'urn:uuid:84942e4a-2ce9-4497-92ca-11f478f9e259', // R-BDR-002 v1: rice, no spray needed (BRRI planthopper sheet)
  'urn:uuid:30f55cde-e973-4ec8-8910-6143f8225d86', // R-BDR-009 v1: rice, no urea after a thunderstorm (BRRI)
  'urn:uuid:13ecf11f-3cdf-4a3f-b671-517197cdb2ed', // R-PLB-011 v2: potato, no protective spray this week (CIP)
] as const;

export const ruleKey = (r: Pick<RuleRef, 'rule_id' | 'version'>) => `${r.rule_id}@${r.version}`;

export interface PreviewRow {
  id: string;
  status: 'authentic' | 'recalled';
  /** the withdrawn rule versions this receipt cites, as "R-X v1" */
  hits: string[];
}

/** Which receipts a set of recalled rule versions turns "Recalled" (the server's rule: any cited version withdrawn). */
export function recallPreview(receipts: { id: string; receipt: Pick<Receipt, 'rule_refs'> }[], recalled: readonly string[]): PreviewRow[] {
  const gone = new Set(recalled);
  return receipts.map(({ id, receipt }) => {
    const hits = receipt.rule_refs.filter((r) => gone.has(ruleKey(r))).map((r) => `${r.rule_id} v${r.version}`);
    return { id, status: hits.length ? 'recalled' : 'authentic', hits };
  });
}

/** How many receipts cite a rule version (the reach of one recall). */
export const citing = (receipts: { receipt: Pick<Receipt, 'rule_refs'> }[], key: string) =>
  receipts.filter(({ receipt }) => receipt.rule_refs.some((r) => ruleKey(r) === key)).length;
