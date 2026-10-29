import { useEffect, useRef, useState } from 'react';
import { Check, Minus, X } from 'lucide-react';
import type { DidDocument } from '../../lib/api/types';
import { fetchDid, verifyReceipt, type VerifyOutcome } from '../../lib/api/client';
import { fetchStatusList, statusPathOf } from '../../lib/api/statusList';
import recordedDid from '../../data/recorded/did.json';
import { useI18n, type Key, type Params } from '../../lib/i18n';
import { shortId } from '../../lib/format';
import { motionReduced } from '../../lib/motionPref';
import { HyperText } from '../../ui/kit/HyperText';
import { checkInBrowser, type LocalCheckState, type ProofStep } from './localCheck';
import { isAreaTrust, isReceipt, rememberCheck } from './verifyUtil';

/**
 * The check, step by step, as it really runs (src/lib/vc/verify.ts `checkProof`, in this order):
 *   fetch    GET /api/verify/{id}: the signed credential and the server's verdict
 *   issuer   the key the proof names, found in the issuer's DID document (and bound to the credential's issuer)
 *   canon    RFC 8785 JCS bytes of the proof options and of the credential
 *   hash     SHA-256 of each
 *   sig      Ed25519 over the two hashes
 *   status   the Bitstring Status List: the server's answer, and the bit itself read in this browser when it can
 */
export type StepId = 'fetch' | 'issuer' | 'canon' | 'hash' | 'sig' | 'status';
export type RunState = 'idle' | 'active' | 'ok' | 'bad' | 'na' | 'skip';
export interface RunStep {
  id: StepId;
  state: RunState;
  /** raw data (an id, bytes, a hash): scrambles into place */
  value?: string;
  note?: [Key, Params?];
}
export interface RunResult {
  phase: 'checking' | 'done';
  outcome: VerifyOutcome | null;
  failed: boolean;
  checkedAt: Date;
  local: LocalCheckState | null;
}

const ORDER: StepId[] = ['fetch', 'issuer', 'canon', 'hash', 'sig', 'status'];
const LOCAL: StepId[] = ['issuer', 'canon', 'hash', 'sig'];
const fresh = (): RunStep[] => ORDER.map((id, i) => ({ id, state: i === 0 ? 'active' : 'idle' }));

/** Where a failed in-browser check stopped (vc/verify.ts LOCAL_CHECK_REASONS). */
function failedAt(reason: string): StepId {
  if (reason === 'not-canonicalizable') return 'canon';
  if (reason === 'bad-proof-value' || reason === 'signature-mismatch') return 'sig';
  return 'issuer';
}

/**
 * Pacing for legibility only: the real checks finish in a few milliseconds, so each step's result is shown at most
 * 150 ms after the previous one (0 under reduced motion). Nothing waits on a timer that the check does not need.
 */
const STEP_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useCheckRun(id: string, nonce: number): { steps: RunStep[]; result: RunResult } {
  const [steps, setSteps] = useState<RunStep[]>(fresh);
  const [result, setResult] = useState<RunResult>({ phase: 'checking', outcome: null, failed: false, checkedAt: new Date(), local: null });
  const first = useRef(true);

  useEffect(() => {
    let alive = true;
    const pace = motionReduced() ? 0 : STEP_MS;
    let last = performance.now();
    let chain: Promise<void> = Promise.resolve();
    const reveal = (fn: () => void) => {
      chain = chain.then(async () => {
        const wait = last + pace - performance.now();
        if (wait > 0) await sleep(wait);
        if (!alive) return;
        fn();
        last = performance.now();
      });
      return chain;
    };
    const patch = (ids: StepId | StepId[], p: Partial<RunStep>) => setSteps((list) => list.map((s) => ((Array.isArray(ids) ? ids : [ids]).includes(s.id) ? { ...s, ...p } : s)));
    const activate = (sid: StepId | undefined) => sid && setSteps((list) => list.map((s) => (s.id === sid && s.state === 'idle' ? { ...s, state: 'active' } : s)));

    if (!first.current) {
      setSteps(fresh());
      setResult((r) => ({ ...r, phase: 'checking' }));
    }
    first.current = false;

    void (async () => {
      let o: VerifyOutcome | null = null;
      let failed = false;
      try {
        o = await verifyReceipt(id); // one call: GET /api/verify/{id}; only its `credential` is rendered
      } catch {
        failed = true;
      }
      if (!alive) return;
      const cred = o && o.status !== 'unreachable' ? (o.credential ?? null) : null;
      const recorded = o?.source === 'sample';

      void reveal(() => {
        if (!o || o.status === 'unreachable') patch('fetch', { state: 'bad', note: ['vf.run.unreachable'] });
        else if (!cred) patch('fetch', { state: 'bad', note: ['vf.run.none'] });
        else patch('fetch', { state: 'ok', value: `urn:uuid:${shortId(cred.id, 12)}`, note: recorded ? ['vf.run.recorded'] : ['vf.run.fetched'] });
        if (cred) activate('issuer');
      });

      let local: LocalCheckState | null = null;
      if (cred) {
        const did = recorded ? (recordedDid as unknown as DidDocument) : await fetchDid();
        if (!alive) return;
        // each step is shown as checkProof reports it (paced, see STEP_MS)
        const onStep = (ev: ProofStep) => {
          void reveal(() => {
            if (ev.step === 'key') {
              patch('issuer', { state: 'ok', value: ev.keyId });
              activate('canon');
            } else if (ev.step === 'canonical') {
              patch('canon', { state: 'ok', value: `${ev.proofBytes} + ${ev.documentBytes} B` });
              activate('hash');
            } else if (ev.step === 'hash') {
              patch('hash', { state: 'ok', value: `${ev.documentHash.slice(0, 24)}…` });
              activate('sig');
            } else {
              patch('sig', ev.valid ? { state: 'ok', note: ['vf.run.valid'] } : { state: 'bad', note: ['vf.run.mismatch'] });
            }
          });
        };
        local = await checkInBrowser(cred, did, onStep);
        await chain;
        if (!alive) return;
        const res = local;
        const cannot = res.state === 'unavailable' || (res.state === 'done' && !res.result.ok && /^(unsupported|no-did-document)$/.test(res.result.reason));
        if (cannot) {
          void reveal(() =>
            setSteps((list) => list.map((s) => (LOCAL.includes(s.id) && s.state !== 'ok' ? { ...s, state: 'na', note: [res.state === 'unavailable' && res.reason === 'no-did' ? 'vf.run.noDid' : 'vf.run.browserNo'] } : s))),
          );
        } else if (res.state === 'done' && !res.result.ok) {
          const at = failedAt(res.result.reason);
          const reason = res.result.reason;
          void reveal(() =>
            setSteps((list) =>
              list.map((s) => {
                if (!LOCAL.includes(s.id) || s.state === 'ok' || s.state === 'bad') return s;
                return s.id === at ? { ...s, state: 'bad', value: reason, note: undefined } : { ...s, state: 'skip', note: ['vf.run.notRun'] };
              }),
            ),
          );
        }
      } else {
        void reveal(() => patch(LOCAL, { state: 'skip', note: ['vf.run.notRun'] }));
      }

      // the status list: the server's answer, plus the bit itself read here when the list is reachable (live only)
      let bit: boolean | null = null;
      const status = cred?.credentialStatus;
      const index = status?.statusListIndex != null ? Number(status.statusListIndex) : NaN;
      if (cred && o?.source === 'live' && Number.isFinite(index)) {
        const list = await fetchStatusList(statusPathOf(status?.statusListCredential ?? o.status_list)).catch(() => null);
        if (list) bit = list.bit(index);
      }
      if (!alive) return;
      void reveal(() => {
        activate('status');
        if (!cred || !o || o.status === 'unreachable' || o.status === 'invalid') {
          patch('status', { state: 'skip', note: ['vf.run.notRun'] });
          return;
        }
        const where: [Key, Params?] = bit != null ? ['vf.run.bit', { n: String(index), v: bit ? '1' : '0' }] : recorded ? ['vf.run.recorded'] : ['vf.run.byServer'];
        if (o.status === 'recalled') patch('status', { state: 'bad', value: (o.rules ?? []).join(', ') || undefined, note: where });
        else patch('status', { state: 'ok', note: where });
      });
      await chain;
      if (!alive) return;

      const at = new Date();
      setResult({ phase: 'done', outcome: o, failed, checkedAt: at, local });
      if (o && o.status !== 'unreachable') {
        const c = o.credential;
        rememberCheck({
          id,
          status: o.status === 'authentic' && o.expired ? 'expired' : o.status,
          title: isReceipt(c) ? (c.credentialSubject.advice?.title ?? null) : null,
          kind: isReceipt(c) ? 'receipt' : isAreaTrust(c) ? 'area' : 'other',
          at: at.toISOString(),
          recorded: o.source === 'sample',
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, nonce]);

  return { steps, result };
}

const LABEL: Record<StepId, Key> = {
  fetch: 'vf.run.fetch',
  issuer: 'vf.run.issuer',
  canon: 'vf.run.canon',
  hash: 'vf.run.hash',
  sig: 'vf.run.sig',
  status: 'vf.run.status',
};
const STATE_SR: Record<RunState, Key> = {
  idle: 'vf.run.s.idle',
  active: 'vf.run.s.active',
  ok: 'vf.run.s.ok',
  bad: 'vf.run.s.bad',
  na: 'vf.run.s.na',
  skip: 'vf.run.s.skip',
};

/** The steps as a ledger: one line each, the real value scrambling into place as the step completes. */
export function RunLedger({ steps, compact }: { steps: RunStep[]; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <ol className="vf-run" data-compact={compact || undefined} data-testid="vf-steps">
      {steps.map((s) => (
        <li key={s.id} data-state={s.state} data-step={s.id}>
          <span className="vf-run-ic" aria-hidden>
            {s.state === 'ok' ? <Check size={13} strokeWidth={3} /> : s.state === 'bad' ? <X size={13} strokeWidth={3} /> : s.state === 'na' || s.state === 'skip' ? <Minus size={13} strokeWidth={2.5} /> : null}
          </span>
          <span className="vf-run-k">
            {t(LABEL[s.id])}
            <span className="sr-only">: {t(STATE_SR[s.state])}</span>
          </span>
          <span className="vf-run-v">
            {s.value && <HyperText text={s.value} className="vf-run-hash" />}
            {s.note && <span className="vf-run-note">{t(s.note[0], s.note[1])}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
