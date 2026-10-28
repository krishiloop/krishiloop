import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, FileJson, Link2, Printer, RotateCcw, ScanLine, X } from 'lucide-react';
import { setForcedSample, verifyReceipt, type VerifyOutcome } from '../../lib/api/client';
import { isSampleId } from '../../lib/api/mocks';
import { RECORDED_AT } from '../../data/recorded';
import { useI18n } from '../../lib/i18n';
import { fmtDate, pickText, shortId } from '../../lib/format';
import { useMotionReduced } from '../../lib/motionPref';
import { verifyUrl } from '../../lib/qr';
import { cx } from '../../lib/cx';
import { Button, LinkButton } from '../../ui/Button';
import { DataMark } from '../../ui/DataMark';
import { Qr } from '../../ui/Qr';
import { Stamp, type StampKind } from '../../ui/Stamp';
import { toast } from '../../ui/Toast';
import { STORY } from '../story/storyData';
import { ScannerSheet, scanSupport } from './Scanner';
import { VerdictStage, useMeaning, verdictOf, type VerdictKind } from './VerdictStage';
import { ReceiptDoc } from './ReceiptDoc';
import { AreaDoc } from './AreaDoc';
import { clearChecks, downloadCredential, isAreaTrust, isReceipt, looksLikeReceipt, normalizeId, recentChecks, rememberCheck, verifyPath, type RecentStatus } from './verifyUtil';
import './verify.css';

/** /verify (paste, scan or try a recorded receipt) and /verify/:id (the verdict, then the receipt as a document). */
export default function VerifyPage() {
  const { id: raw } = useParams();
  const id = raw ? normalizeId(raw) : '';
  return <div className="vf-page">{id ? <VerifyResult key={id} id={id} /> : <VerifyEntry />}</div>;
}

/* ================================================================== entry */
const HERO_RECEIPT = STORY.calm.action.receipt_credential_id ?? '';

const LEGEND: { kind: StampKind; key: 'vf.legend.authentic' | 'vf.legend.recalled' | 'vf.legend.expired' | 'vf.legend.invalid' }[] = [
  { kind: 'authentic', key: 'vf.legend.authentic' },
  { kind: 'recalled', key: 'vf.legend.recalled' },
  { kind: 'expired', key: 'vf.legend.expired' },
  { kind: 'invalid', key: 'vf.legend.invalid' },
];

function VerifyEntry() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [canScan, setCanScan] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const closeScan = useCallback(() => setScanning(false), []);

  useEffect(() => {
    let alive = true;
    void scanSupport().then((ok) => alive && setCanScan(ok));
    return () => {
      alive = false;
    };
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!looksLikeReceipt(value)) {
      setError(true);
      return;
    }
    nav(verifyPath(normalizeId(value)));
  };

  return (
    <div className="wrap pb-20 pt-10 sm:pt-16">
      <div className="grid gap-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-20">
        <div>
          <p className="eyebrow hero-rise">{t('vf.entry.eyebrow')}</p>
          <h1 className="t-title hero-rise mt-4 max-w-[13ch]" style={{ ['--i' as string]: 1 }}>
            {t('vf.entry.title')}
          </h1>
          <p className="t-lead hero-rise mt-5 max-w-[44ch]" style={{ ['--i' as string]: 2 }}>
            {t('vf.entry.lead')}
          </p>

          <form className="hero-rise mt-9" style={{ ['--i' as string]: 3 }} onSubmit={submit} noValidate>
            <label htmlFor="vf-id" className="eyebrow">
              {t('vf.entry.label')}
            </label>
            <div className="mt-2.5 flex flex-col gap-3 sm:flex-row">
              <input
                id="vf-id"
                className="vf-input"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(false);
                }}
                placeholder={t('vf.entry.placeholder')}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                inputMode="url"
                aria-invalid={error || undefined}
                aria-describedby={error ? 'vf-id-err' : undefined}
                data-testid="vf-input"
              />
              <Button type="submit" variant="primary" size="lg" className="sm:min-w-[9.5rem]" data-testid="vf-check" arrow>
                {t('vf.entry.check')}
              </Button>
            </div>
            {error && (
              <p id="vf-id-err" role="alert" className="mt-2.5 text-sm text-stop">
                {t('vf.entry.bad')}
              </p>
            )}
          </form>

          <div className="hero-rise mt-6 flex min-h-11 flex-wrap items-center gap-x-4 gap-y-3" style={{ ['--i' as string]: 4 }}>
            {canScan === true && (
              <Button variant="secondary" onClick={() => setScanning(true)} data-testid="vf-scan">
                <ScanLine size={18} aria-hidden />
                {t('vf.entry.scan')}
              </Button>
            )}
            {HERO_RECEIPT && (
              <span className="inline-flex flex-wrap items-center gap-2">
                <LinkButton to={verifyPath(HERO_RECEIPT)} variant="ghost" className="-ml-3 sm:ml-0" data-testid="vf-try" arrow>
                  {t('vf.entry.try')}
                </LinkButton>
                <DataMark kind="recorded" date={RECORDED_AT} />
              </span>
            )}
          </div>
          {canScan === false && (
            <p className="mt-3 max-w-[52ch] text-sm text-ink-3" data-testid="vf-noscan">
              {t('vf.entry.noScan')}
            </p>
          )}
        </div>

        <aside aria-labelledby="vf-legend-h" data-testid="vf-legend">
          <h2 id="vf-legend-h" className="eyebrow">
            {t('vf.legend.title')}
          </h2>
          <ul className="vf-legend">
            {LEGEND.map((l, i) => (
              <li key={l.kind} data-reveal style={{ ['--i' as string]: i }}>
                <Stamp kind={l.kind} size="inherit" />
                <p className="m-0 text-sm leading-snug text-ink-2">{t(l.key)}</p>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <Recent />
      <ScannerSheet open={scanning} onClose={closeScan} />
    </div>
  );
}

const RECENT_STAMP: Record<RecentStatus, StampKind> = { authentic: 'authentic', recalled: 'recalled', invalid: 'invalid', expired: 'expired' };

function Recent() {
  const { t, lang } = useI18n();
  const items = recentChecks.use();
  if (!items.length) return null;
  return (
    <section className="mt-20" aria-labelledby="vf-recent-h" data-testid="vf-recent">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-3">
        <h2 id="vf-recent-h" className="eyebrow">
          {t('vf.recent.title')}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm -mr-2" onClick={clearChecks}>
          <X size={15} aria-hidden />
          {t('vf.recent.clear')}
        </button>
      </div>
      <ul className="m-0 list-none p-0">
        {items.map((c, i) => {
          const title = c.title ? pickText(c.title, lang) : null;
          return (
            <li key={c.id} className="vf-in" style={{ ['--i' as string]: i }}>
              <Link to={verifyPath(c.id)} className="vf-recent-row">
                <span className="vf-recent-stamp">
                  <Stamp kind={RECENT_STAMP[c.status]} size="inherit" />
                </span>
                <span className="min-w-0 flex-1">
                  <span lang={title?.lang} className="block truncate font-medium text-ink">
                    {title?.text || t(c.kind === 'area' ? 'vf.recent.area' : 'vf.recent.untitled')}
                  </span>
                  <span className="mono block text-xs text-ink-3">
                    № …{shortId(c.id, 10)} · {fmtDate(c.at, lang, 'datetime')}
                  </span>
                </span>
                {c.recorded && <DataMark kind="recorded" date={RECORDED_AT} className="max-sm:hidden" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ================================================================== result */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STEPS = ['vf.step.fetch', 'vf.step.sig', 'vf.step.status'] as const;

function VerifyResult({ id }: { id: string }) {
  const { t } = useI18n();
  const reduced = useMotionReduced();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const [nonce, setNonce] = useState(0);
  const [phase, setPhase] = useState<'checking' | 'done'>('checking');
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState(0);
  const [checkedAt, setCheckedAt] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    setPhase('checking');
    setStep(0);
    // one beam sweep (760 ms), so the verdict still lands within about a second of the scan
    const minMs = reducedRef.current ? 0 : nonce ? 520 : 760;
    const t0 = performance.now();
    const timers = reducedRef.current ? [] : [1, 2].map((i) => window.setTimeout(() => alive && setStep(i), (i * minMs) / 3));
    void (async () => {
      let o: VerifyOutcome | null = null;
      let bad = false;
      try {
        o = await verifyReceipt(id); // one call: GET /api/verify/{id}; only its `credential` is rendered
      } catch {
        bad = true;
      }
      await sleep(Math.max(0, minMs - (performance.now() - t0)));
      if (!alive) return;
      const at = new Date();
      setOutcome(o);
      setFailed(bad);
      setCheckedAt(at);
      setStep(3);
      setPhase('done');
      if (o && o.status !== 'unreachable') {
        const cred = o.credential;
        rememberCheck({
          id,
          status: o.status === 'authentic' && o.expired ? 'expired' : o.status,
          title: isReceipt(cred) ? (cred.credentialSubject.advice?.title ?? null) : null,
          kind: isReceipt(cred) ? 'receipt' : isAreaTrust(cred) ? 'area' : 'other',
          at: at.toISOString(),
          recorded: o.source === 'sample',
        });
      }
    })();
    return () => {
      alive = false;
      timers.forEach((x) => window.clearTimeout(x));
    };
  }, [id, nonce]);

  const kind: VerdictKind = verdictOf(outcome, failed);
  const cred = outcome?.credential ?? null;
  const receipt = isReceipt(cred) ? cred.credentialSubject : null;
  const area = isAreaTrust(cred) ? cred.credentialSubject : null;
  const recorded = outcome?.source === 'sample' || (isSampleId(id) && kind !== 'unreachable');
  const meaning = useMeaning(kind, receipt, area, outcome);

  return (
    <>
      <p className="sr-only-live" role="status" aria-live="polite">
        {phase === 'done' ? `${kind === 'unreachable' ? '' : `${t(`ui.stamp.${kind}`)}. `}${meaning.line}` : t('vf.checking.title')}
      </p>
      {phase === 'checking' ? (
        <Checking id={id} step={step} />
      ) : (
        <>
          <VerdictStage
            kind={kind}
            id={id}
            receipt={receipt}
            area={area}
            outcome={outcome}
            recorded={recorded}
            checkedAt={checkedAt}
            landKey={nonce}
            onUseLive={() => {
              setForcedSample(false);
              setNonce((n) => n + 1);
            }}
            actions={<Actions id={id} cred={cred} onAgain={() => setNonce((n) => n + 1)} />}
          />
          {cred && receipt ? (
            <ReceiptDoc cred={cred} receipt={receipt} kind={kind} outcome={outcome} recorded={recorded} checkedAt={checkedAt} />
          ) : cred && area ? (
            <AreaDoc cred={cred} area={area} kind={kind} outcome={outcome} checkedAt={checkedAt} />
          ) : (
            <NoDocument id={id} outcome={outcome} />
          )}
        </>
      )}
    </>
  );
}

/** The short check: this receipt's own QR under a scan beam, and the three things the verifier really does. */
function Checking({ id, step }: { id: string; step: number }) {
  const { t } = useI18n();
  return (
    <>
      <section className="vf-stage" data-kind="checking" aria-busy="true" data-testid="checking" aria-labelledby="vf-checking-h">
        <div className="wrap vf-stage-grid">
          <div className="vf-stamp-slot">
            <div className="vf-scan">
              <Qr value={verifyUrl(id)} size={136} label={t('vf.checking.qr')} />
              <span className="vf-beam" aria-hidden />
            </div>
          </div>
          <div className="vf-stage-copy">
            <p className="eyebrow">№ …{shortId(id, 10)}</p>
            <h1 id="vf-checking-h" className="vf-meaning">
              {t('vf.checking.title')}
            </h1>
            <ol className="vf-steps">
              {STEPS.map((s, i) => (
                <li key={s} data-state={step > i ? 'done' : step === i ? 'active' : 'idle'}>
                  <span className="vf-step-tick" aria-hidden>
                    {step > i && <Check size={13} strokeWidth={3} />}
                  </span>
                  {t(s)}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
      {/* the document's place, held while the verdict comes (no jump when it arrives) */}
      <div className="wrap vf-doc" aria-hidden>
        <div className="skeleton h-[min(560px,70vh)]" />
        <div className="grid content-start gap-4">
          <div className="skeleton h-8 w-40" />
          <div className="skeleton h-28" />
          <div className="skeleton h-8 w-32" />
          <div className="skeleton h-40" />
        </div>
      </div>
    </>
  );
}

function Actions({ id, cred, onAgain }: { id: string; cred: VerifyOutcome['credential'] | null; onAgain: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl(id));
      setCopied(true);
      toast(t('ui.copied'));
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast(t('vf.act.copyFailed'), { tone: 'info' });
    }
  };
  return (
    <>
      <Button variant="secondary" onClick={copy} data-testid="vf-copy">
        {copied ? <Check size={17} aria-hidden /> : <Link2 size={17} aria-hidden />}
        {t('vf.act.copy')}
      </Button>
      <Button variant="secondary" onClick={() => window.print()} data-testid="vf-print">
        <Printer size={17} aria-hidden />
        {t('vf.act.print')}
      </Button>
      {cred && (
        <Button variant="secondary" onClick={() => downloadCredential(cred)} data-testid="vf-json">
          <FileJson size={17} aria-hidden />
          {t('vf.act.json')}
        </Button>
      )}
      <Button variant="ghost" onClick={onAgain} data-testid="vf-again">
        <RotateCcw size={17} aria-hidden />
        {t('vf.act.again')}
      </Button>
    </>
  );
}

/** Cannot verify, or the verifier was not reachable: what was checked and what to do next. */
function NoDocument({ id, outcome }: { id: string; outcome: VerifyOutcome | null }) {
  const { t } = useI18n();
  const reason = outcome?.reason ?? '';
  return (
    <div className="wrap grid gap-6 py-12 sm:py-16 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-14" data-testid="no-doc">
      <dl className="vf-dl">
        <dt>{t('vf.sig.id')}</dt>
        <dd className="mono break-all">{id}</dd>
        {reason && (
          <>
            <dt>{t('vf.noDoc.answer')}</dt>
            <dd className="mono break-all text-ink-2">{reason}</dd>
          </>
        )}
      </dl>
      <div className={cx('flex flex-wrap items-start gap-3')}>
        <LinkButton to="/verify" variant="primary" arrow>
          {t('vf.act.other')}
        </LinkButton>
        {HERO_RECEIPT && (
          <LinkButton to={verifyPath(HERO_RECEIPT)} variant="ghost">
            {t('vf.entry.try')}
          </LinkButton>
        )}
      </div>
    </div>
  );
}
