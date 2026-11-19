import { describe, expect, it } from 'vitest';
import { mergeSaved, shownVerdict, type SavedReceipt } from './saved';
import type { HeldReceipt, StatusInfo } from '../farmer/receipts';
import type { Receipt } from '../../lib/api/types';

const r = (id: string, at: number): HeldReceipt => ({ id, receipt: { receipt_id: id } as unknown as Receipt, via: 'plan', fieldId: 'BD-SAMPLE-02', at, recorded: true });

describe('receipts saved on the phone', () => {
  it('adds new receipts, newest first, and keeps the old ones', () => {
    const saved: SavedReceipt[] = [r('a', 1)];
    const out = mergeSaved(saved, [r('c', 3), r('b', 2), r('a', 1)], {});
    expect(out.map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });

  it('returns the same array when nothing changed (no needless writes)', () => {
    const saved: SavedReceipt[] = [r('a', 1)];
    expect(mergeSaved(saved, [r('a', 1)], {})).toBe(saved);
  });

  it('saves a real verdict with its time', () => {
    const st: Record<string, StatusInfo> = { a: { s: 'authentic', at: 50 } };
    const out = mergeSaved([r('a', 1)], [], st);
    expect(out[0]!.last).toEqual({ s: 'authentic', at: 50, rules: undefined });
  });

  it('a newer recall replaces an older authentic check', () => {
    const saved: SavedReceipt[] = [{ ...r('a', 1), last: { s: 'authentic', at: 50 } }];
    const out = mergeSaved(saved, [], { a: { s: 'recalled', at: 60, rules: ['R-BDR-002 v1'] } });
    expect(out[0]!.last).toEqual({ s: 'recalled', at: 60, rules: ['R-BDR-002 v1'] });
  });

  it('never lets "checking" or "unreachable" overwrite a real verdict', () => {
    const saved: SavedReceipt[] = [{ ...r('a', 1), last: { s: 'recalled', at: 50 } }, { ...r('b', 0), last: { s: 'authentic', at: 40 } }];
    const out = mergeSaved(saved, [], { a: { s: 'unreachable', at: 99 }, b: { s: 'checking', at: 99 } });
    expect(out).toBe(saved);
    expect(out[0]!.last?.s).toBe('recalled');
  });

  it('an older verdict never replaces a newer one', () => {
    const saved: SavedReceipt[] = [{ ...r('a', 1), last: { s: 'recalled', at: 80 } }];
    expect(mergeSaved(saved, [], { a: { s: 'authentic', at: 70 } })[0]!.last?.s).toBe('recalled');
  });

  it('keeps at most the cap', () => {
    const many = Array.from({ length: 8 }, (_, i) => r(`x${i}`, i));
    expect(mergeSaved([], many, {}, 5).map((x) => x.id)).toEqual(['x7', 'x6', 'x5', 'x4', 'x3']);
  });

  it('shows a fresh verdict first, then the saved one, never a made-up one', () => {
    const x: SavedReceipt = { ...r('a', 1), last: { s: 'authentic', at: 10 } };
    expect(shownVerdict(x, { s: 'recalled', at: 20 })).toMatchObject({ s: 'recalled', fresh: true });
    expect(shownVerdict(x, { s: 'unreachable', at: 20 })).toMatchObject({ s: 'authentic', fresh: false, at: 10 });
    expect(shownVerdict(x, undefined)).toMatchObject({ s: 'authentic', fresh: false });
    expect(shownVerdict(r('b', 1), undefined)).toEqual({ s: 'unknown', fresh: false });
    expect(shownVerdict(r('b', 1), { s: 'checking', at: 1 })).toEqual({ s: 'checking', fresh: false });
  });
});
