import { afterEach, describe, expect, it } from 'vitest';
import before from '../../data/recorded/verify-before.json';
import { mockVerify, resetSampleRecalls, sampleRecalls, simulateRecall } from '../../lib/api/mocks';
import type { Receipt, VerifyResponse } from '../../lib/api/types';
import { citing, recallPreview, SAMPLE_RECEIPTS } from './recall';

/** The recall tool on /try: its preview agrees with the app's own sample-mode recall and with the verifier's answer. */
const all = Object.entries(before as unknown as Record<string, VerifyResponse>).map(([id, v]) => ({ id, receipt: v.credential!.credentialSubject as Receipt }));
const samples = SAMPLE_RECEIPTS.map((id) => all.find((r) => r.id === id)!);

afterEach(() => resetSampleRecalls());

describe('recall preview', () => {
  it('uses three recorded receipts that cite three different rules', () => {
    expect(samples.every(Boolean)).toBe(true);
    expect(samples.map((s) => `${s.receipt.rule_refs[0]!.rule_id} v${s.receipt.rule_refs[0]!.version}`)).toEqual(['R-BDR-002 v1', 'R-BDR-009 v1', 'R-PLB-011 v2']);
  });

  it('turns exactly the receipts that cite the recalled rule version "Recalled"', () => {
    expect(recallPreview(samples, []).map((r) => r.status)).toEqual(['authentic', 'authentic', 'authentic']);
    const one = recallPreview(samples, ['R-BDR-002@1']);
    expect(one.map((r) => r.status)).toEqual(['recalled', 'authentic', 'authentic']);
    expect(one[0]!.hits).toEqual(['R-BDR-002 v1']);
    // another version of the same rule is a different rule version: nothing changes
    expect(recallPreview(samples, ['R-PLB-011@1']).map((r) => r.status)).toEqual(['authentic', 'authentic', 'authentic']);
    expect(recallPreview(samples, ['R-BDR-009@1', 'R-PLB-011@2']).map((r) => r.status)).toEqual(['authentic', 'recalled', 'recalled']);
  });

  it('counts how many recorded receipts one recall reaches', () => {
    expect(all).toHaveLength(20);
    expect(citing(all, 'R-BDR-002@1')).toBe(4);
    expect(citing(all, 'R-PLB-011@2')).toBe(3);
  });

  it('agrees with the verifier after the app\'s own simulated recall (simulateRecall + mockVerify)', async () => {
    simulateRecall('R-BDR-002', 1);
    expect(sampleRecalls.get()).toEqual(['R-BDR-002@1']);
    const preview = recallPreview(all, sampleRecalls.get());
    for (const row of preview) {
      const v = await mockVerify(row.id);
      expect(v?.status, row.id).toBe(row.status);
    }
    expect(preview.filter((r) => r.status === 'recalled')).toHaveLength(4);
  });
});
