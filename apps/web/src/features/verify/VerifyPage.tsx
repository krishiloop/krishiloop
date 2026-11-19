// this page's words (English loads per screen)
import '../../lib/i18n/strings.verify';
import '../../lib/i18n/strings.trust';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronDown, ClipboardPaste, FileCheck2, FileJson, Link2, MessageSquareText, Printer, RotateCcw, ScanLine, X } from 'lucide-react';
import { apiStore, setForcedSample, type VerifyOutcome } from '../../lib/api/client';
import { isSampleId } from '../../lib/api/mocks';
import { RECORDED_AT } from '../../data/recorded';
import { useI18n } from '../../lib/i18n';
import { fmtDate, pickText, shortId } from '../../lib/format';
import { verifyUrl } from '../../lib/qr';
import { cx } from '../../lib/cx';
import { Button, LinkButton } from '../../ui/Button';
import { DataMark } from '../../ui/DataMark';
import { Stamp, type StampKind } from '../../ui/Stamp';
import { magnet } from './magnet';
import { toast } from '../../ui/Toast';
import { ScannerSheet, scanSupport } from './Scanner';
import { VerdictStage, useMeaning, verdictOf, type VerdictKind } from './VerdictStage';
import { useCheckRun } from './CheckRun';
import { ReceiptDoc } from './ReceiptDoc';
import { AreaDoc } from './AreaDoc';
import { clearChecks, downloadCredential, isAreaTrust, isReceipt, looksLikeReceipt, normalizeId, recentChecks, verifyPath, type RecentStatus } from './verifyUtil';
import { codePath, displayCode, lookupCode, normalizeCode, type CodeLookup } from './code';
import { Fold } from '../../ui/Fold';
import './verify.css';

/**
 * /verify (paste, scan, type an SMS code or try a recorded receipt), /verify/:id (the verdict, then the receipt as a
 * document) and /v/:code (a short code from an SMS: looked up, then the same check as /verify/:id).
 */
export default function VerifyPage() {
  const { id: raw, code } = useParams();
  const id = raw ? normalizeId(raw) : '';
  return <div className="vf-page">{code !== undefined ? <CodeOpen key={code} typed={code} /> : id ? <VerifyResult key={id} id={id} /> : <VerifyEntry />}</div>;
}

/* ================================================================== /v/:code */
/**
 * A short code is a lookup handle, not a proof: it finds the receipt's id (GET /api/code/{code}), then the verifier runs
 * as for any receipt, signature checked in this browser. The page it lands on says which code opened it.
 */
function CodeOpen({ typed }: { typed: string }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const code = normalizeCode(typed);
  const [state, setState] = useState<CodeLookup | { kind: 'looking' } | { kind: 'sample' }>({ kind: 'looking' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!code) return;
    if (apiStore.get().forced) {
      setState({ kind: 'sample' });
      return;
    }
    let alive = true;
    setState({ kind: 'looking' });
    void lookupCode(code).then((r) => {
      if (!alive) return;
      if (r.kind === 'found') nav(verifyPath(r.credentialId), { replace: true, state: { code } });
      else setState(r);
    });
    return () => {
      alive = false;
    };
  }, [code, nav, nonce]);

  const shown = code ? displayCode(code) : typed.slice(0, 24);
  const kind = !code ? 'unknown' : state.kind;
  return (
    <div className="wrap grid min-h-[50dvh] place-items-center py-16 text-center" data-testid="vf-code-open" data-state={kind}>
      <div className="max-w-md">
        <h1 className="label">{t('vf.code.label')}</h1>
        <p className="vf-code-big mono mt-4" translate="no">
          {shown}
        </p>
        <div className="mt-5" role="status" aria-live="polite">
          {kind === 'looking' || kind === 'found' ? (
            <p className="text-ink-2">{t('vf.code.looking', { code: shown })}</p>
          ) : kind === 'unknown' ? (
            <>
              <p className="t-head">{t('vf.code.unknown', { code: shown })}</p>
              <p className="mt-3 text-ink-2">{t('vf.code.unknownSub')}</p>
            </>
          ) : kind === 'sample' ? (
            <p className="text-ink-2">{t('vf.code.sample')}</p>
          ) : kind === 'busy' ? (
            <p className="text-ink-2">{t('vf.code.busy')}</p>
          ) : (
            <p className="text-ink-2">{t('vf.code.unreachable')}</p>
          )}
        </div>
        {kind !== 'looking' && kind !== 'found' && (
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {(kind === 'unreachable' || kind === 'busy') && (
              <Button variant="primary" onClick={() => setNonce((n) => n + 1)}>
                <RotateCcw size={17} aria-hidden />
                {t('vf.code.again')}
              </Button>
            )}
            <LinkButton to="/verify" variant={kind === 'unreachable' || kind === 'busy' ? 'ghost' : 'primary'} arrow={kind !== 'unreachable' && kind !== 'busy'}>
              {t('vf.act.other')}
            </LinkButton>
          </div>
        )}
      </div>
    </div>
  );
}

/** The SMS code box on /verify: 8 letters and digits, any case, with or without the dash. */
function CodeEntry() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeCode(value);
    if (!code) {
      setError(true);
      return;
    }
    nav(codePath(code));
  };
  return (
    <form onSubmit={submit} noValidate className="vf-code" data-testid="vf-code-form">
      <label htmlFor="vf-code" className="vf-code-label">
        <MessageSquareText size={18} aria-hidden />
        {t('vf.code.label')}
      </label>
      <div className="vf-code-row">
        <input
          id="vf-code"
          className="vf-input vf-code-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          placeholder="7KQ2-MX4P"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={16}
          aria-invalid={error || undefined}
          aria-describedby={error ? 'vf-code-err' : 'vf-code-hint'}
          data-testid="vf-code-input"
        />
        <Button type="submit" variant="secondary" size="lg" data-testid="vf-code-open-btn">
          {t('vf.code.open')}
        </Button>
      </div>
      {error ? (
        <p id="vf-code-err" role="alert" className="mt-2 text-sm text-stop">
          {t('vf.code.bad')}
        </p>
      ) : (
        <p id="vf-code-hint" className="mt-2 text-sm text-ink-3">
          {t('vf.code.hint')}
        </p>
      )}
    </form>
  );
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
    <div className="vf-entry-page botanic-bg">
      <div className="wrap pb-20 pt-10 sm:pt-14">
        <header className="vf-entry-head">
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

        <section className="vf-entry hero-rise" style={{ ['--i' as string]: 3 }} aria-labelledby="vf-zone-h">
          <h2 id="vf-zone-h" className="sr-only">
            {t('vf.zone.title')}
          </h2>

          {/* 1. scan: front and centre on a phone */}
          <div className="vf-card vf-card-scan" data-tone="monsoon">
            <div className="vf-scanart" aria-hidden>
              <svg viewBox="0 0 120 120" width="120" height="120">
                <rect x="28" y="28" width="64" height="64" rx="6" fill="var(--color-card)" />
                {/* a drawn QR: three finder squares and a scatter of modules (decoration, not a real code) */}
                {[
                  [33, 33],
                  [69, 33],
                  [33, 69],
                ].map(([x, y]) => (
                  <g key={`${x}-${y}`}>
                    <rect x={x} y={y} width="18" height="18" rx="2" fill="none" stroke="var(--color-ink)" strokeWidth="3" />
                    <rect x={x! + 6} y={y! + 6} width="6" height="6" fill="var(--color-ink)" />
                  </g>
                ))}
                {[
                  [56, 34], [61, 40], [56, 46], [56, 56], [62, 56], [68, 56], [74, 62], [80, 56], [86, 62], [56, 62],
                  [62, 68], [56, 74], [68, 74], [74, 80], [80, 74], [86, 80], [62, 86], [74, 86], [86, 86], [40, 56], [46, 62],
                ].map(([x, y]) => (
                  <rect key={`m${x}-${y}`} x={x} y={y} width="5" height="5" rx="1" fill="var(--color-ink)" />
                ))}
                <path d="M18 34 V22 a4 4 0 0 1 4 -4 H34 M86 18 H98 a4 4 0 0 1 4 4 V34 M102 86 V98 a4 4 0 0 1 -4 4 H86 M34 102 H22 a4 4 0 0 1 -4 -4 V86" fill="none" stroke="var(--color-monsoon-ink)" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span className="vf-scanline" />
            </div>
            <div className="min-w-0">
              <h3 className="vf-card-t">{t('vf.entry.scan')}</h3>
              {canScan === true ? (
                <button type="button" className="btn btn-primary btn-lg press mt-4" onClick={() => setScanning(true)} data-testid="vf-scan" {...magnet()}>
                  <ScanLine size={19} aria-hidden />
                  {t('vf.zone.scanGo')}
                </button>
              ) : canScan === false ? (
                <p className="vf-card-off" data-testid="vf-noscan">
                  {t('vf.entry.noScan')}
                </p>
              ) : (
                <span className="skeleton mt-4 inline-block h-12 w-48" aria-hidden />
              )}
            </div>
          </div>

          {/* 2. paste a link or an id */}
          <div className="vf-card" data-tone="butter">
            <form onSubmit={submit} noValidate>
              <label htmlFor="vf-id" className="vf-card-t block">
                <span className="vf-card-n" aria-hidden>
                  <Link2 size={17} />
                </span>
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
                <Button type="submit" variant="primary" size="lg" className="sm:min-w-[9.5rem]" data-testid="vf-check" arrow {...magnet()}>
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
            <button type="button" className="vf-paste press" onClick={() => void paste()} data-testid="vf-paste">
              <ClipboardPaste size={17} aria-hidden />
              <span>{t('vf.zone.paste')}</span>
            </button>
          </div>

          {/* 3. the code from an SMS */}
          <div className="vf-card" data-tone="lotus">
            <CodeEntry />
          </div>

          {/* no receipt at hand: a recorded one, one tap away */}
          <div className="vf-card vf-card-try" data-tone="moss">
            {!HERO_RECEIPT ? (
              <span className="skeleton block h-14 w-full" aria-hidden />
            ) : (
              <Link to={verifyPath(HERO_RECEIPT)} className="vf-try press" data-testid="vf-try">
                <FileCheck2 size={22} aria-hidden />
                <span className="min-w-0">
                  <span className="vf-card-t block">{t('vf.entry.try')}</span>
                </span>
                <DataMark kind="recorded" date={RECORDED_AT} />
              </Link>
            )}
          </div>
        </section>

        <section className="vf-legend-wrap" aria-labelledby="vf-legend-h" data-testid="vf-legend">
          <h2 id="vf-legend-h" className="sr-only">
            {t('vf.legend.title')}
          </h2>
          <Fold label={t('vf.legend.title')}>
          <ul className="vf-legend">
            {LEGEND.map((l, i) => (
              <li key={l.kind} data-reveal style={{ ['--i' as string]: i }} data-kind={l.kind}>
                <Stamp kind={l.kind} size="inherit" />
                <p className="m-0 text-sm leading-snug text-ink-2">{t(l.key)}</p>
              </li>
            ))}
          </ul>
          </Fold>
          <details className="vf-details vf-what">
            <summary>
              <ChevronDown size={18} aria-hidden className="vf-details-chev" />
              <span id="vf-chain-h">{t('vf.zone.steps')}</span>
            </summary>
            <ol className="vf-chain" aria-labelledby="vf-chain-h">
              {CHAIN.map((k, i) => (
                <li key={k} style={{ ['--i' as string]: i }}>
                  {t(k)}
                </li>
              ))}
            </ol>
          </details>
        </section>

        <Recent />
        <ScannerSheet open={scanning} onClose={closeScan} />
      </div>
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
  // opened from /v/:code: say which code found it, and that the code is not the proof
  const fromCode = (useLocation().state as { code?: unknown } | null)?.code;
  const code = typeof fromCode === 'string' ? normalizeCode(fromCode) : '';

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
      {code && (
        <p className="wrap vf-from-code" data-testid="vf-from-code">
          <MessageSquareText size={15} aria-hidden />
          <span>{t('vf.code.found', { code: displayCode(code) })}</span>
        </p>
      )}
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
