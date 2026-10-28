import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Check, Copy, Printer, QrCode, RotateCcw, ScanLine } from 'lucide-react';
import { InkFilter } from './Stamp';
import { VerdictStage, type Verdict } from './VerdictStage';
import { ReceiptDetails } from './ReceiptDetails';
import { HowChecked, NotificationPreview, RecallPanel } from './VerifyParts';
import { SAMPLE_RECEIPT_IDS, isReceipt, normalizeId, receiptsOnDevice } from './verifyUtil';
import { toast } from '../../components/ui/Toaster';
import { SampleBadge } from '../../components/ui/Badges';
import { useI18n } from '../../lib/i18n';
import { fmtNum, shortId } from '../../lib/format';
import { useMotionReduced } from '../../lib/motionPref';
import { verifyReceipt, type VerifyOutcome } from '../../lib/api/client';
import { useStats } from '../../lib/api/hooks';
import { isSampleId } from '../../lib/api/mocks';
import { verifyUrl } from '../../lib/qr';

export default function VerifyPage() {
  const { id: raw } = useParams();
  const id = raw ? normalizeId(raw) : null;
  return (
    <>
      <InkFilter />
      {id ? <VerifyResult key={id} id={id} /> : <VerifyEntry />}
    </>
  );
}

/* ------------------------------------------------------------------ entry: paste an id or open a sample */
function VerifyEntry() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const [value, setValue] = useState('');
  const stats = useStats();
  const mine = useMemo(() => receiptsOnDevice(), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = normalizeId(value);
    if (id) nav(`/verify/${encodeURIComponent(id.replace(/^urn:uuid:/, ''))}`);
  };

  return (
    <div className="mx-auto max-w-[920px] px-4 pt-8 pb-8 sm:px-6 sm:pt-14">
      <p className="eyebrow">KrishiLoop · {t('nav.verify')}</p>
      <h1 className="mt-3 text-h1 font-medium tracking-tight">{t('verify.title')}</h1>
      <p className="mt-3 max-w-[56ch] text-lg text-chrome">{t('verify.lead')}</p>

      <div className="vp-entry">
        <div className="vp-finder" aria-hidden>
          <span className="vp-corner" data-p="tl" />
          <span className="vp-corner" data-p="tr" />
          <span className="vp-corner" data-p="bl" />
          <span className="vp-corner" data-p="br" />
          <QrCode size={64} strokeWidth={1.1} />
          <span className="vp-scanline" />
        </div>
        <div className="grid content-center gap-5">
          <form onSubmit={submit} className="grid gap-3">
            <label className="field-label" htmlFor="rid">
              {t('verify.idLabel')}
            </label>
            <input id="rid" className="input input-mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('verify.idPlaceholder')} autoComplete="off" spellCheck={false} data-testid="receipt-id" />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn btn-sun" disabled={!value.trim()} data-testid="check-btn">
                <ScanLine size={16} aria-hidden /> {t('verify.check')}
              </button>
              <Link to={`/verify/${SAMPLE_RECEIPT_IDS[0]}`} className="btn btn-ghost" data-testid="try-sample">
                {t('verify.trySample')} <ArrowRight size={16} aria-hidden />
              </Link>
            </div>
          </form>

          {mine.length ? (
            <div>
              <h2 className="eyebrow mb-2">{t('verify.onDevice')}</h2>
              <ul className="m-0 grid list-none gap-2 p-0">
                {mine.map((r) => (
                  <li key={r.id}>
                    <Link to={`/verify/${encodeURIComponent(r.id.replace(/^urn:uuid:/, ''))}`} className="vp-receipt-link">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.title}</span>
                        <span className="mono text-dim">
                          {r.rule} · …{shortId(r.id, 8)}
                        </span>
                      </span>
                      {r.sample ? <SampleBadge /> : null}
                      <ArrowRight size={16} aria-hidden className="flex-none" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <p className="mt-10 max-w-[64ch] text-sm text-chrome">{t('verify.copyNote')}</p>
      {stats ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-dim" data-testid="live-list">
          <span className="chip" data-tone="go">
            <span className="size-1.5 rounded-full bg-go" aria-hidden /> {stats.scope === 'session' ? t('stats.session') : t('stats.official')}
          </span>
          <span>
            {t('stats.credentials')}: <span className="mono">{fmtNum(stats.stats.credentials_stored, lang)}</span>
          </span>
          <span>
            {t('stats.recalled')}: <span className="mono">{fmtNum(stats.stats.rule_versions_recalled, lang)}</span>
          </span>
          <span>
            {t('stats.open')}: <span className="mono">{fmtNum(stats.stats.inbox_open, lang)}</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ the result */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function VerifyResult({ id }: { id: string }) {
  const { t } = useI18n();
  const reduced = useMotionReduced();
  const [nonce, setNonce] = useState(0);
  const [phase, setPhase] = useState<'checking' | 'done' | 'error'>('checking');
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPhase('checking');
    setStep(0);
    setErr(null);
    const timers: number[] = [];
    const minMs = reduced ? 0 : nonce > 0 ? 1100 : 1500;
    const t0 = performance.now();
    if (!reduced) [1, 2, 3].forEach((i) => timers.push(window.setTimeout(() => alive && setStep(i), i * (minMs / 3.2))));
    void (async () => {
      try {
        // ONE call: GET /api/verify/{id}. Only the `credential` it returns is rendered; nothing else is fetched for display.
        const o = await verifyReceipt(id);
        await sleep(Math.max(0, minMs - (performance.now() - t0)));
        if (!alive) return;
        setOutcome(o);
        setStep(3);
        setPhase('done');
      } catch (e) {
        if (alive) {
          setErr(e instanceof Error ? e.message : String(e));
          setPhase('error');
        }
      }
    })();
    return () => {
      alive = false;
      timers.forEach((x) => window.clearTimeout(x));
    };
  }, [id, nonce, reduced]);

  if (phase === 'checking') return <Checking id={id} step={step} />;
  const verdict: Verdict = phase === 'error' || !outcome ? 'unreachable' : outcome.status;
  const cred = outcome?.credential ?? null;
  const receipt = isReceipt(cred) ? cred.credentialSubject : null;
  const sample = outcome?.source === 'sample' || isSampleId(id);

  return (
    <div className="verify-result">
      <VerdictStage status={verdict} receipt={receipt} sample={sample} sandbox={!!outcome?.sandbox} expired={!!outcome?.expired} reason={outcome?.reason} rules={outcome?.rules} play={phase === 'done'} />

      <div className="mx-auto grid max-w-[920px] gap-5 px-4 pt-8 sm:px-6">
        {sample && verdict !== 'unreachable' ? <p className="m-0 rounded-xl border border-dashed border-line-2 p-3 text-sm text-chrome">{t('verify.sampleBanner')}</p> : null}
        {err ? <p className="m-0 rounded-xl bg-bone/5 p-3 font-mono text-xs text-dim">{err}</p> : null}

        <div className="no-print flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNonce((n) => n + 1)}>
            <RotateCcw size={15} aria-hidden /> {t('verify.again')}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}>
            <Printer size={15} aria-hidden /> {t('verify.print')}
          </button>
          <CopyLink id={id} />
          <Link to="/verify" className="btn btn-quiet btn-sm">
            {t('verify.otherReceipt')}
          </Link>
        </div>

        {verdict === 'recalled' && receipt ? <NotificationPreview receipt={receipt} rules={outcome?.rules ?? []} /> : null}
        {receipt && cred ? <ReceiptDetails receipt={receipt} cred={cred} /> : null}
        {receipt && cred ? <HowChecked cred={cred} sample={sample} verdict={verdict} statusList={outcome?.status_list} /> : null}
        {receipt && cred ? (
          <div className="no-print">
            <RecallPanel receipt={receipt} cred={cred} sample={isSampleId(id)} sandbox={!!outcome?.sandbox} verdict={verdict} statusList={outcome?.status_list} onChanged={() => setNonce((n) => n + 1)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CopyLink({ id }: { id: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        void navigator.clipboard?.writeText(verifyUrl(id)).then(() => {
          setDone(true);
          toast(t('common.copied'));
          setTimeout(() => setDone(false), 1600);
        });
      }}
    >
      {done ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {t('verify.copyLink')}
    </button>
  );
}

/** The short "checking" sequence: a viewfinder and the three things the verifier really does. */
function Checking({ id, step }: { id: string; step: number }) {
  const { t } = useI18n();
  const steps = ['verify.step.fetch', 'verify.step.sig', 'verify.step.status'] as const;
  return (
    <div className="mx-auto max-w-[620px] px-4 pt-14 pb-10 sm:px-6 sm:pt-24" aria-busy="true" data-testid="checking">
      <p className="eyebrow">KrishiLoop · {t('nav.verify')}</p>
      <h1 className="mt-3 text-h2 font-medium tracking-tight">{t('verify.checking')}</h1>
      <p className="mono mt-2 text-dim">…{shortId(id, 14)}</p>
      <div className="vp-finder vp-finder-live mt-8" aria-hidden>
        <span className="vp-corner" data-p="tl" />
        <span className="vp-corner" data-p="tr" />
        <span className="vp-corner" data-p="bl" />
        <span className="vp-corner" data-p="br" />
        <QrCode size={64} strokeWidth={1.1} />
        <span className="vp-scanline" />
      </div>
      <ol className="vp-checklist" aria-live="polite">
        {steps.map((s, i) => (
          <li key={s} data-state={step > i ? 'done' : step === i ? 'active' : 'idle'}>
            <span className="vp-tick" aria-hidden>
              {step > i ? <Check size={14} strokeWidth={3} /> : step === i ? <span className="spinner" /> : null}
            </span>
            {t(s)}
          </li>
        ))}
      </ol>
    </div>
  );
}

