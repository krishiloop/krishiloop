import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, PenLine, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { DataMark } from '../../ui/DataMark';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { useMotionReduced } from '../../lib/motionPref';
import { apiStore, fetchDid, verifyReceipt, type VerifyOutcome } from '../../lib/api/client';
import type { Credential, DidDocument } from '../../lib/api/types';
import { RECORDED_AT } from '../../data/recorded';
import { checkProof, LOCAL_CHECK_REASONS, type LocalCheck, type ProofStep } from '../../lib/vc/verify';

type StepName = 'key' | 'canonical' | 'hash' | 'signature';
const ORDER: StepName[] = ['key', 'canonical', 'hash', 'signature'];

type Run =
  | { phase: 'idle' }
  | { phase: 'fetching'; id: string }
  /** the server sent no signed credential (unknown id, unreachable, sample mode for a live id) */
  | { phase: 'nocred'; id: string; outcome: VerifyOutcome }
  | { phase: 'nodid'; id: string; outcome: VerifyOutcome }
  | { phase: 'checked'; id: string; outcome: VerifyOutcome; steps: Partial<Record<StepName, ProofStep>>; shown: number; result: LocalCheck; tampered: string | null };

const short = (hex: string, n = 16) => (hex.length > n + 8 ? `${hex.slice(0, n)}…${hex.slice(-8)}` : hex);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A receipt link, a /verify/<id> URL, or the bare id: the id. */
export function parseReceiptId(raw: string): string {
  let s = raw.trim();
  const at = s.indexOf('/verify/');
  if (at >= 0) s = s.slice(at + '/verify/'.length);
  s = s.split(/[?#]/)[0] ?? '';
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep it as typed */
  }
  return s.trim();
}

/** Change one letter of the signed advice (or the first text in the credential), and say which field changed. */
function tamperOne(c: Credential): { cred: Credential; field: string } {
  const copy = JSON.parse(JSON.stringify(c)) as Credential & { credentialSubject: Record<string, unknown> };
  const flip = (s: string) => {
    const i = s.search(/[A-Za-z]/);
    if (i < 0) return `${s}.`;
    const ch = s[i]!;
    return s.slice(0, i) + (ch === 'a' ? 'e' : ch === 'A' ? 'E' : 'a') + s.slice(i + 1);
  };
  const advice = copy.credentialSubject.advice as { title?: Record<string, string> } | undefined;
  if (advice?.title && typeof advice.title.en === 'string') {
    advice.title.en = flip(advice.title.en);
    return { cred: copy, field: 'credentialSubject.advice.title.en' };
  }
  const walk = (o: Record<string, unknown>, path: string): string | null => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string') {
        o[k] = flip(v);
        return `${path}.${k}`;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const hit = walk(v as Record<string, unknown>, `${path}.${k}`);
        if (hit) return hit;
      }
    }
    return null;
  };
  return { cred: copy, field: walk(copy.credentialSubject, 'credentialSubject') ?? 'credentialSubject' };
}

/**
 * "Check it yourself": paste a receipt id and this browser checks its signature with lib/vc (eddsa-jcs-2022: RFC 8785
 * canonicalisation, SHA-256, Ed25519 in WebCrypto), showing each real intermediate result as it completes. A recorded
 * receipt is checked against the recorded issuer key; a live one against the live server's DID document. "Change one
 * letter" alters the signed advice and runs the same check, which then fails.
 */
export function CheckYourself() {
  const { t } = useI18n();
  const reduced = useMotionReduced();
  const [input, setInput] = useState('');
  const [run, setRun] = useState<Run>({ phase: 'idle' });
  const token = useRef(0);
  const last = useRef<{ outcome: VerifyOutcome; did: DidDocument; id: string } | null>(null);

  // the default: the recorded hero receipt of the story page (read-only import, loaded lazily)
  useEffect(() => {
    let alive = true;
    void import('../story/storyData').then(({ STORY }) => {
      if (alive) setInput((cur) => cur || STORY.calm.action.receipt_credential_id || '');
    });
    return () => {
      alive = false;
    };
  }, []);

  const check = async (outcome: VerifyOutcome, did: DidDocument, id: string, tamper: boolean) => {
    const me = ++token.current;
    let cred = outcome.credential as Credential;
    let tampered: string | null = null;
    if (tamper) {
      const t2 = tamperOne(cred);
      cred = t2.cred;
      tampered = t2.field;
    }
    const steps: Partial<Record<StepName, ProofStep>> = {};
    const result = await checkProof(cred, did, { onStep: (s) => (steps[s.step] = s) });
    // show the steps one after the other; they really happened in this order, a moment ago
    const n = ORDER.filter((s) => steps[s]).length;
    for (let shown = 0; shown <= n; shown++) {
      if (token.current !== me) return;
      setRun({ phase: 'checked', id, outcome, steps, shown, result: shown === n ? result : { ok: false, reason: 'pending' }, tampered });
      if (shown < n) await sleep(reduced ? 60 : 340);
    }
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const id = parseReceiptId(input);
    if (!id) return;
    const me = ++token.current;
    setRun({ phase: 'fetching', id });
    let outcome: VerifyOutcome;
    try {
      outcome = await verifyReceipt(id);
    } catch (err) {
      outcome = { status: 'unreachable', reason: err instanceof Error ? err.message : String(err), source: 'none' };
    }
    if (token.current !== me) return;
    if (!outcome.credential) return setRun({ phase: 'nocred', id, outcome });
    // a recorded receipt is signed by the recorded issuer key: check it against that DID document, never the live one
    const did = outcome.source === 'sample' ? ((await import('../../data/recorded/did.json')).default as unknown as DidDocument) : await fetchDid();
    if (token.current !== me) return;
    if (!did) return setRun({ phase: 'nodid', id, outcome });
    last.current = { outcome, did, id };
    await check(outcome, did, id, false);
  };

  const tamper = () => {
    if (last.current) void check(last.current.outcome, last.current.did, last.current.id, true);
  };

  const reasonText = (reason: string) => ((LOCAL_CHECK_REASONS as readonly string[]).includes(reason) ? t(`proof.check.reason.${reason}` as Key) : reason);

  return (
    <div className="pf-check" data-testid="check-yourself">
      <form onSubmit={(e) => void submit(e)} className="grid content-start gap-3">
        <label htmlFor="pf-receipt" className="font-semibold">
          {t('proof.check.label')}
        </label>
        <input
          id="pf-receipt"
          className="pf-input"
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder="urn:uuid:…"
          data-testid="check-input"
        />
        <p className="m-0 text-[0.85rem] text-ink-3">{t('proof.check.hint')}</p>
        <div className="mt-1 flex flex-wrap gap-3">
          <Button type="submit" variant="primary" disabled={run.phase === 'fetching'} data-testid="check-run">
            {t('proof.check.run')}
          </Button>
          {run.phase === 'checked' && run.shown >= 4 && !run.tampered && run.result.ok ? (
            <Button type="button" variant="secondary" onClick={tamper} data-testid="check-tamper">
              <PenLine size={16} aria-hidden /> {t('proof.check.tamper')}
            </Button>
          ) : null}
        </div>
        <p className="m-0 mt-2 text-[0.85rem] text-ink-3">{t('proof.check.note')}</p>
      </form>

      <div aria-live="polite" data-testid="check-result">
        {run.phase === 'idle' ? <p className="m-0 text-ink-3">{t('proof.check.idle')}</p> : null}
        {run.phase === 'fetching' ? <p className="m-0 text-ink-2">{t('proof.check.fetching')}</p> : null}
        {run.phase === 'nocred' ? (
          <p className="m-0" data-testid="check-nocred">
            {run.outcome.status === 'unreachable'
              ? apiStore.get().forced
                ? t('proof.check.sampleOnly')
                : t('proof.check.unreachable')
              : t('proof.check.nocred', { status: t(`proof.check.status.${run.outcome.status}` as Key) })}
          </p>
        ) : null}
        {run.phase === 'nodid' ? <p className="m-0">{t('proof.check.nodid')}</p> : null}
        {run.phase === 'checked' ? <Steps run={run} reasonText={reasonText} /> : null}
      </div>
    </div>
  );
}

function Steps({ run, reasonText }: { run: Extract<Run, { phase: 'checked' }>; reasonText: (r: string) => string }) {
  const { t, lang } = useI18n();
  const { steps, shown, result, outcome } = run;
  const done = shown >= ORDER.filter((s) => steps[s]).length && (result.ok || result.reason !== 'pending');
  const failedEarly = done && !result.ok && !steps.signature;
  const num = (n: number) => fmtNum(n, lang);
  const state = (i: number, name: StepName): 'wait' | 'done' | 'fail' => {
    if (i >= shown || !steps[name]) return 'wait';
    if (name === 'signature') {
      const s = steps.signature;
      return s && s.step === 'signature' && s.valid ? 'done' : 'fail';
    }
    return 'done';
  };
  const k = steps.key?.step === 'key' ? steps.key : null;
  const c = steps.canonical?.step === 'canonical' ? steps.canonical : null;
  const h = steps.hash?.step === 'hash' ? steps.hash : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mono text-[0.78rem] text-ink-3">{run.id}</span>
        {outcome.source === 'sample' ? <DataMark kind="recorded" date={RECORDED_AT} /> : <DataMark kind="live" />}
      </div>
      {run.tampered ? (
        <p className="m-0 mb-3 text-[0.9rem] text-ink-2" data-testid="check-tampered">
          {t('proof.check.tampered')} <code className="mono text-[0.8rem]">{run.tampered}</code>
        </p>
      ) : null}
      <ol className="pf-steps">
        {ORDER.map((name, i) => {
          const st = state(i, name);
          return (
            <li key={`${name}-${run.tampered ?? ''}`} className="pf-step" data-state={st} data-testid={`step-${name}`}>
              <span className="pf-dot" aria-hidden>
                {st === 'done' ? <Check size={15} /> : st === 'fail' ? <X size={15} /> : i + 1}
              </span>
              <div className="min-w-0">
                <p className="m-0 font-semibold">{t(`proof.check.step.${name}` as Key)}</p>
                {st !== 'wait' && name === 'key' && k ? (
                  <span className="pf-hex">
                    {k.keyId}
                    <br />
                    {t('proof.check.pubkey')} {short(k.publicKeyHex)}
                  </span>
                ) : null}
                {st !== 'wait' && name === 'canonical' && c ? (
                  <>
                    <span className="pf-hex">{t('proof.check.bytes', { proof: num(c.proofBytes), doc: num(c.documentBytes) })}</span>
                    <span className="pf-canon">{c.document.slice(0, 260)}</span>
                  </>
                ) : null}
                {st !== 'wait' && name === 'hash' && h ? (
                  <span className="pf-hex">
                    {t('proof.check.hashProof')} {short(h.proofHash)}
                    <br />
                    {t('proof.check.hashDoc')} {short(h.documentHash)}
                  </span>
                ) : null}
                {st !== 'wait' && name === 'signature' ? <span className="pf-hex">{st === 'done' ? t('proof.check.sigOk') : t('proof.check.sigBad')}</span> : null}
              </div>
            </li>
          );
        })}
      </ol>

      {done ? (
        <div className="mt-4 grid gap-3" data-testid="check-verdict" data-ok={result.ok}>
          {result.ok ? (
            <p className="m-0 flex items-start gap-2 font-semibold text-go">
              <Check size={18} className="mt-0.5 shrink-0" aria-hidden />
              {t('proof.check.ok', { key: result.keyId })}
            </p>
          ) : (
            <p className="m-0 flex items-start gap-2 font-semibold text-stop">
              <X size={18} className="mt-0.5 shrink-0" aria-hidden />
              {failedEarly || result.reason !== 'signature-mismatch' ? reasonText(result.reason) : run.tampered ? t('proof.check.badTampered') : reasonText(result.reason)}
            </p>
          )}
          {!run.tampered ? (
            <p className="m-0 flex flex-wrap items-center gap-2 text-[0.9rem] text-ink-2">
              {t('proof.check.server')}
              <Chip tone={outcome.status === 'authentic' ? 'go' : outcome.status === 'recalled' ? 'stop' : 'neutral'}>{t(`proof.check.status.${outcome.status}` as Key)}</Chip>
              <Link to={`/verify/${encodeURIComponent(run.id)}`} className="link inline-flex min-h-11 items-center gap-1">
                {t('proof.check.open')} <ArrowRight size={14} aria-hidden />
              </Link>
            </p>
          ) : null}
          <p className="m-0 text-[0.82rem] text-ink-3">{t('proof.check.means')}</p>
        </div>
      ) : null}
    </div>
  );
}
