import { useEffect, useId, useState } from 'react';
import { Check, ChevronDown, Copy, FlaskConical, KeyRound, MessageSquareText, Radio, Smartphone, ShieldAlert } from 'lucide-react';
import { toast } from '../../components/ui/Toaster';
import { PreviewBadge } from '../../components/ui/Badges';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { fetchDid, isMySandboxCredential, recallRule, type RecallResult } from '../../lib/api/client';
import { fetchStatusList, statusPathOf, type StatusList } from '../../lib/api/statusList';
import { resetSampleRecalls } from '../../lib/api/mocks';
import type { Credential, DidDocument, Receipt } from '../../lib/api/types';
import type { Verdict } from './VerdictStage';

/* ------------------------------------------------------------------ how this was checked */
interface Checked {
  list: StatusList | null;
  did: DidDocument | null;
  receiptBit: { index: number; set: boolean } | null;
}

/**
 * "How this was checked": what the verifier looked at, with the real values: the signature suite and public key, and the
 * receipt's bit in its Bitstring Status List (set = withdrawn). The list is the one the verified credential points at (a
 * demo sandbox has its own). Everything else here comes from the same `credential` the verifier returned.
 */
export function HowChecked({ cred, sample, verdict, statusList }: { cred: Credential; sample: boolean; verdict: Verdict; statusList?: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Checked | 'loading' | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open || data || sample) return;
    setData('loading');
    let alive = true;
    void (async () => {
      // receipts have no status entry of their own (recall is per rule version): show the issuing store's list
      const [list, did] = await Promise.all([fetchStatusList(statusPathOf(cred.credentialStatus?.statusListCredential ?? statusList)), fetchDid()]);
      const ri = cred.credentialStatus ? Number(cred.credentialStatus.statusListIndex) : NaN;
      if (alive) setData({ list, did, receiptBit: Number.isFinite(ri) ? { index: ri, set: list ? list.bit(ri) : false } : null });
    })();
    return () => {
      alive = false;
    };
  }, [open, data, sample, cred, statusList]);

  const key = typeof data === 'object' && data ? data.did?.verificationMethod?.[0]?.publicKeyMultibase : undefined;

  return (
    <section className="surface" aria-label={t('verify.how')} data-testid="how-checked">
      <button type="button" className="vp-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span className="flex items-center gap-2 font-semibold">
          <Radio size={16} className="text-sun" aria-hidden /> {t('verify.how')}
        </span>
        <ChevronDown size={18} aria-hidden data-open={open} className="vp-chevron" />
      </button>
      <div id={id} className="vp-panel" data-open={open}>
        <div>
          <div className="vp-body">
            <ol className="vp-steps">
              <li>
                <Check size={14} aria-hidden /> {t('verify.step.fetch')}
              </li>
              <li>
                <Check size={14} aria-hidden /> {t('verify.step.sig')}: <span className="mono">{cred.proof.cryptosuite}</span> · <span className="mono">{cred.proof.verificationMethod}</span>
              </li>
              <li>
                <Check size={14} aria-hidden /> {t('verify.step.status')}
              </li>
            </ol>
            {sample ? (
              <p className="m-0 text-sm text-dim">{t('verify.sampleBanner')}</p>
            ) : data === 'loading' || data === null ? (
              <p className="m-0 flex items-center gap-2 text-sm text-dim">
                <span className="spinner" aria-hidden /> {t('common.loading')}
              </p>
            ) : (
              <dl className="vd-meta">
                {data.receiptBit ? (
                  <div>
                    <dt>{t('verify.statusBit', { n: data.receiptBit.index })}</dt>
                    <dd>
                      <span className="chip" data-tone={data.receiptBit.set ? 'stop' : 'go'}>
                        {data.receiptBit.set ? t('verify.bit.set') : t('verify.bit.clear')}
                      </span>
                    </dd>
                  </div>
                ) : null}
                {data.list ? (
                  <div>
                    <dt>{t('verify.liveTotal')}</dt>
                    <dd className="mono">
                      {fmtNum(data.list.withdrawn, lang)} / {fmtNum(data.list.size, lang)}
                    </dd>
                  </div>
                ) : null}
                {key ? (
                  <div>
                    <dt className="flex items-center gap-1.5">
                      <KeyRound size={13} aria-hidden /> {t('verify.key')}
                    </dt>
                    <dd className="mono">{key}</dd>
                  </div>
                ) : null}
              </dl>
            )}
            {!sample ? <p className="m-0 text-xs text-dim">{t('verify.keyNote')}</p> : null}
            <p className="m-0 text-xs text-dim">
              {verdict === 'authentic' ? t('verify.copyNote') : null}
            </p>
            <RawCredential cred={cred} />
          </div>
        </div>
      </div>
    </section>
  );
}

function RawCredential({ cred }: { cred: Credential }) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  const json = JSON.stringify(cred, null, 2);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-quiet btn-sm" aria-expanded={show} onClick={() => setShow((s) => !s)}>
          {t('verify.raw')}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            void navigator.clipboard?.writeText(json).then(() => toast(t('common.copied')));
          }}
        >
          <Copy size={14} aria-hidden /> {t('common.copy')}
        </button>
      </div>
      {show ? <pre className="vp-json" tabIndex={0}>{json}</pre> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ the demo control */
/**
 * Demo control (judges and developers, not farmers): withdraw the rule behind this receipt and watch every receipt that
 * used it turn Recalled. Live, it works only inside the visitor's own demo sandbox (POST /api/demo/{sid}/recall): no token,
 * and an official receipt cannot be touched. Sample receipts use a simulated recall in this browser.
 */
export function RecallPanel({ receipt, cred, sample, sandbox, verdict, onChanged, statusList }: { receipt: Receipt; cred: Credential; sample: boolean; sandbox: boolean; verdict: Verdict; onChanged: () => void; statusList?: string }) {
  const { t } = useI18n();
  const refs = receipt.rule_refs;
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecallResult | null>(null);
  const [reason, setReason] = useState('');
  const rule = refs[Math.min(pick, refs.length - 1)];
  if (!rule) return null;

  const mine = !sample && sandbox && isMySandboxCredential(cred.credentialStatus?.statusListCredential ?? statusList);
  const canRecall = sample || mine;

  const go = async () => {
    setBusy(true);
    setResult(null);
    const r = await recallRule(rule.rule_id, rule.version, { reason: reason.trim() || t('verify.demo.reasonDefault'), sample });
    setBusy(false);
    setResult(r);
    if (r.ok) onChanged();
  };

  return (
    <section className="surface surface-pad recall-panel" aria-labelledby="recall-t" data-testid="recall-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recall-t" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <ShieldAlert size={18} className="text-stop" aria-hidden /> {t('verify.demo.title')}
        </h2>
        <span className="chip chip-sample">{t('verify.demo.tag')}</span>
      </div>
      <p className="mt-2 mb-3 text-sm text-chrome">{t('verify.demo.lead')}</p>
      <p className="sandbox-note" data-testid="sandbox-note">
        <FlaskConical size={14} aria-hidden /> {t('verify.demo.sandboxNote')}
      </p>

      {!canRecall ? (
        <p className="m-0 mt-4 text-sm text-chrome" data-testid="recall-unavailable">
          {sandbox ? t('verify.demo.otherSession') : t('verify.demo.official')}
        </p>
      ) : (
        <>
          {refs.length > 1 ? (
            <div className="mt-4 max-w-xs">
              <label className="field-label" htmlFor="recall-rule">
                {t('receipt.rule')}
              </label>
              <select id="recall-rule" className="select" value={pick} onChange={(e) => setPick(Number(e.target.value))}>
                {refs.map((r, i) => (
                  <option key={r.credential_id} value={i}>
                    {r.rule_id} v{r.version}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {!sample ? (
            <div className="mt-4 max-w-md">
              <label className="field-label" htmlFor="recall-reason">
                {t('verify.demo.reason')}
              </label>
              <input id="recall-reason" className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('verify.demo.reasonDefault')} autoComplete="off" />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-danger" onClick={() => void go()} disabled={busy || verdict === 'recalled'} data-testid="recall-button">
              {busy ? <span className="spinner" aria-hidden /> : <ShieldAlert size={16} aria-hidden />}
              {t('verify.demo.button', { rule: rule.rule_id, ver: rule.version })}
            </button>
            {sample ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  resetSampleRecalls();
                  setResult(null);
                  onChanged();
                }}
              >
                {t('verify.demo.reset')}
              </button>
            ) : null}
          </div>
        </>
      )}

      {result ? (
        <p className="m-0 mt-3 text-sm" role="status" data-tone={result.ok ? 'go' : 'stop'}>
          {result.ok ? t('verify.demo.done') : `${t('verify.demo.failed')} ${result.message ?? ''}`}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ what people get when a rule is withdrawn */
export function NotificationPreview({ receipt, rules }: { receipt: Receipt; rules: string[] }) {
  const { t, lang } = useI18n();
  const list = rules.length ? rules.join(', ') : receipt.rule_refs.map((r) => `${r.rule_id} v${r.version}`).join(', ');
  return (
    <section className="surface surface-pad" aria-labelledby="notif-t" data-testid="notification-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="notif-t" className="text-lg font-semibold tracking-tight">
          {t('verify.notif.title')}
        </h2>
        <PreviewBadge label={t('verify.notif.tag')} />
      </div>
      <div className="notif-grid">
        <div>
          <p className="eyebrow mb-2 flex items-center gap-2">
            <Smartphone size={13} aria-hidden /> {t('verify.notif.farmer')}
          </p>
          <div className="phone" aria-label={t('verify.notif.farmer')}>
            <div className="phone-bar" />
            <p className="sms">{t('verify.notif.sms', { date: fmtDate(receipt.created_at, lang, 'short') })}</p>
          </div>
        </div>
        <div>
          <p className="eyebrow mb-2 flex items-center gap-2">
            <MessageSquareText size={13} aria-hidden /> {t('verify.notif.officer')}
          </p>
          <div className="inbox-row">
            <span className="inbox-dot" aria-hidden />
            <p className="m-0 text-sm">{t('verify.notif.inbox', { rules: list })}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
