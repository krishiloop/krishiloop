// this page's words (English loads per screen)
import '../../lib/i18n/strings.verify';
import '../../lib/i18n/strings.trust';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, ClipboardPaste, FileCheck2, FileJson, Link2, Printer, RotateCcw, ScanLine, X } from 'lucide-react';
import { setForcedSample, type VerifyOutcome } from '../../lib/api/client';
import { isSampleId } from '../../lib/api/mocks';
import { RECORDED_AT } from '../../data/recorded';
import { useI18n } from '../../lib/i18n';
import { fmtDate, pickText, shortId } from '../../lib/format';
import { verifyUrl } from '../../lib/qr';
import { cx } from '../../lib/cx';
import { Button, LinkButton } from '../../ui/Button';
import { DataMark } from '../../ui/DataMark';
import { Stamp, type StampKind } from '../../ui/Stamp';
import { spotlight } from '../../ui/kit/hooks';
import { toast } from '../../ui/Toast';
import { ScannerSheet, scanSupport } from './Scanner';
import { VerdictStage, useMeaning, verdictOf, type VerdictKind } from './VerdictStage';
import { useCheckRun } from './CheckRun';
import { ReceiptDoc } from './ReceiptDoc';
import { AreaDoc } from './AreaDoc';
import { clearChecks, downloadCredential, isAreaTrust, isReceipt, looksLikeReceipt, normalizeId, recentChecks, verifyPath, type RecentStatus } from './verifyUtil';
import './verify.css';

/** /verify (paste, scan or try a recorded receipt) and /verify/:id (the verdict, then the receipt as a document). */
export default function VerifyPage() {
  const { id: raw } = useParams();
  const id = raw ? normalizeId(raw) : '';
  return <div className="vf-page">{id ? <VerifyResult key={id} id={id} /> : <VerifyEntry />}</div>;
}

/* ================================================================== entry */
/**
 * The story's recorded "no spray needed" receipt, for "Try a recorded receipt". Loaded after the first paint: the story
 * data is about 4.7 KB gzipped, too much to pull into this page's first visit for one id.
 */
let heroId = '';
function useHeroReceipt() {
  const [id, setId] = useState(heroId);
  useEffect(() => {
    if (heroId) return;
    let alive = true;
    void import('../story/storyData').then((m) => {
      heroId = m.STORY.calm.action.receipt_credential_id ?? '';
      if (alive) setId(heroId);
    });
    return () => {
      alive = false;
    };
  }, []);
  return id;
}

const LEGEND: { kind: StampKind; key: 'vf.legend.authentic' | 'vf.legend.recalled' | 'vf.legend.expired' | 'vf.legend.invalid' }[] = [
  { kind: 'authentic', key: 'vf.legend.authentic' },
  { kind: 'recalled', key: 'vf.legend.recalled' },
  { kind: 'expired', key: 'vf.legend.expired' },
  { kind: 'invalid', key: 'vf.legend.invalid' },
];

function VerifyEntry() {
  const { t } = useI18n();
  const HERO_RECEIPT = useHeroReceipt();
  const nav = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [clipNote, setClipNote] = useState(false);
  const [canScan, setCanScan] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const closeScan = useCallback(() => setScanning(false), []);

  useEffect(() => {
    let alive = true;
    void scanSupport().then((ok) => alive && setCanScan(ok));
    return () => {
      alive = false;
    };
  }, []);

  const open = useCallback(
    (text: string) => {
      setValue(text);
      setClipNote(false);
      if (!looksLikeReceipt(text)) {
        setError(true);
        return false;
      }
      nav(verifyPath(normalizeId(text)));
      return true;
    },
    [nav],
  );

  // a receipt link pasted anywhere on the page (not into a field) is checked at once
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return;
      const text = e.clipboardData?.getData('text') ?? '';
      if (!text.trim()) return;
      e.preventDefault();
      if (!open(text)) input.current?.focus();
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!looksLikeReceipt(value)) {
      setError(true);
      return;
    }
    nav(verifyPath(normalizeId(value)));
  };

  // "Paste a link": read the clipboard when the browser allows it; otherwise put the cursor in the box
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        if (!open(text)) input.current?.focus();
        return;
      }
    } catch {
      /* permission refused or no clipboard API: fall through */
    }
    setClipNote(true);
    input.current?.focus();
  };

  return (
    <div className="wrap pb-20 pt-10 sm:pt-14">
      <header className="max-w-3xl">
        <p className="label hero-rise flex items-center gap-2.5">
          <span className="h-px w-8 bg-ink-3" aria-hidden />
          {t('vf.entry.eyebrow')}
        </p>
        <h1 className="t-title hero-rise mt-5" style={{ ['--i' as string]: 1 }}>
          {t('vf.entry.title')}
        </h1>
        <p className="t-lead hero-rise mt-4 max-w-[46ch]" style={{ ['--i' as string]: 2 }}>
          {t('vf.entry.lead')}
        </p>
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] lg:items-start lg:gap-14">
        <section className="vf-zone surface hero-rise" style={{ ['--i' as string]: 3 }} aria-labelledby="vf-zone-h" {...spotlight()}>
          <h2 id="vf-zone-h" className="sr-only">
            {t('vf.zone.title')}
          </h2>
          <form onSubmit={submit} noValidate>
            <label htmlFor="vf-id" className="label">
              {t('vf.entry.label')}
            </label>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                ref={input}
                id="vf-id"
                className="vf-input"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(false);
                  setClipNote(false);
                }}
                placeholder={t('vf.entry.placeholder')}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                inputMode="url"
                aria-invalid={error || undefined}
                aria-describedby={error ? 'vf-id-err' : clipNote ? 'vf-id-clip' : undefined}
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
            {clipNote && !error && (
              <p id="vf-id-clip" className="mt-2.5 text-sm text-ink-2">
                {t('vf.zone.noClip')}
              </p>
            )}
          </form>

          <div className="vf-ways">
            {canScan === true ? (
              <button type="button" className="vf-way press" onClick={() => setScanning(true)} data-testid="vf-scan">
                <ScanLine size={22} aria-hidden />
                <span>
                  <span className="vf-way-t">{t('vf.entry.scan')}</span>
                  <span className="vf-way-s">{t('vf.zone.scanSub')}</span>
                </span>
              </button>
            ) : canScan === false ? (
              <div className="vf-way" data-off="">
                <ScanLine size={22} aria-hidden />
                <span>
                  <span className="vf-way-t">{t('vf.zone.scanOff')}</span>
                  <span className="vf-way-s" data-testid="vf-noscan">
                    {t('vf.entry.noScan')}
                  </span>
                </span>
              </div>
            ) : (
              <div className="vf-way skeleton" aria-hidden />
            )}
            <button type="button" className="vf-way press" onClick={() => void paste()} data-testid="vf-paste">
              <ClipboardPaste size={22} aria-hidden />
              <span>
                <span className="vf-way-t">{t('vf.zone.paste')}</span>
                <span className="vf-way-s">{t('vf.zone.pasteSub')}</span>
              </span>
            </button>
            {!HERO_RECEIPT ? (
              <div className="vf-way skeleton" aria-hidden />
            ) : (
              <Link to={verifyPath(HERO_RECEIPT)} className="vf-way press" data-testid="vf-try">
                <FileCheck2 size={22} aria-hidden />
                <span>
                  <span className="vf-way-t">{t('vf.entry.try')}</span>
                  <span className="vf-way-s">
                    <DataMark kind="recorded" date={RECORDED_AT} />
                  </span>
                </span>
              </Link>
            )}
          </div>

          <div className="vf-what">
            <p className="label" id="vf-chain-h">
              {t('vf.zone.steps')}
            </p>
            <ol className="vf-chain" aria-labelledby="vf-chain-h">
              {CHAIN.map((k, i) => (
                <li key={k} style={{ ['--i' as string]: i }}>
                  {t(k)}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <aside aria-labelledby="vf-legend-h" data-testid="vf-legend" className="hero-rise" style={{ ['--i' as string]: 4 }}>
          <h2 id="vf-legend-h" className="label">
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

/** What a check does, in the order it runs (CheckRun.tsx): the chain, shown before anything is checked. */
const CHAIN = ['vf.run.fetch', 'vf.run.issuer', 'vf.run.canon', 'vf.run.hash', 'vf.run.sig', 'vf.run.status'] as const;

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
function VerifyResult({ id }: { id: string }) {
  const { t } = useI18n();
  const [nonce, setNonce] = useState(0);
  const { steps, result } = useCheckRun(id, nonce);
  const { phase, outcome, failed, checkedAt, local } = result;

  const kind: VerdictKind = verdictOf(outcome, failed);
  const cred = outcome?.credential ?? null;
  const receipt = isReceipt(cred) ? cred.credentialSubject : null;
  const area = isAreaTrust(cred) ? cred.credentialSubject : null;
  const recorded = outcome?.source === 'sample' || (isSampleId(id) && kind !== 'unreachable');
  const meaning = useMeaning(kind, receipt, area, outcome);
  const done = phase === 'done';

  return (
    <>
      <p className="sr-only-live" role="status" aria-live="polite">
        {done ? `${kind === 'unreachable' ? '' : `${t(`ui.stamp.${kind}`)}. `}${meaning.line}` : t('vf.checking.title')}
      </p>
      <VerdictStage
        phase={phase}
        steps={steps}
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
      {!done ? (
        // the document's place, held while the verdict comes (no jump when it arrives)
        <div className="wrap vf-doc" aria-hidden>
          <div className="skeleton h-[min(560px,70vh)]" />
          <div className="grid content-start gap-4">
            <div className="skeleton h-8 w-40" />
            <div className="skeleton h-28" />
            <div className="skeleton h-8 w-32" />
            <div className="skeleton h-40" />
          </div>
        </div>
      ) : cred && receipt ? (
        <ReceiptDoc cred={cred} receipt={receipt} kind={kind} outcome={outcome} recorded={recorded} checkedAt={checkedAt} local={local} />
      ) : cred && area ? (
        <AreaDoc cred={cred} area={area} kind={kind} outcome={outcome} checkedAt={checkedAt} local={local} />
      ) : (
        <NoDocument id={id} outcome={outcome} />
      )}
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
  const HERO_RECEIPT = useHeroReceipt();
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
