import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Leaf, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react';
import type { Credential, DidDocument, Receipt } from '../../lib/api/types';
import { fetchDid, type VerifyOutcome } from '../../lib/api/client';
import recordedDid from '../../data/recorded/did.json';
import { RECORDED_AT } from '../../data/recorded';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { ReceiptCard } from '../../ui/Receipt';
import { Quote } from '../../ui/Quote';
import { DataMark } from '../../ui/DataMark';
import { readingLines, sourceLabel } from '../../ui/receiptView';
import { splitRecalled } from '../trust/gate';
import { recallOf } from '../officer/recallLog';
import { checkInBrowser, type LocalCheckState } from './localCheck';
import { readingRows, verifyPath } from './verifyUtil';
import type { VerdictKind } from './VerdictStage';
import { currentSessionId } from '../../lib/api/client';

/** A numbered section of the receipt document: hairline on top, mono eyebrow, then the content. */
export function DocSection({ n, title, children, testId, aside }: { n: string; title: string; children: ReactNode; testId?: string; aside?: ReactNode }) {
  return (
    <section className="vf-sec" data-testid={testId} aria-labelledby={`vf-sec-${n}`}>
      <header className="flex items-baseline justify-between gap-3">
        <h2 id={`vf-sec-${n}`} className="vf-sec-h">
          <span className="mono text-ink-3" aria-hidden>
            {n}
          </span>
          {title}
        </h2>
        {aside}
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ sources */
const LICENCE: Record<string, Key> = {
  cleared: 'vf.src.licence.cleared',
  permitted: 'vf.src.licence.permitted',
  cited_permission_requested: 'vf.src.licence.requested',
};

function Sources({ receipt }: { receipt: Receipt }) {
  const { t } = useI18n();
  return (
    <ol className="m-0 grid list-none gap-6 p-0">
      {receipt.sources.map((s) => (
        <li key={`${s.doc_id}-${s.page}`} className="grid gap-3">
          <Quote source={s} className="border-l-2 border-rule-2 pl-4" />
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-3">
            <span className="text-ink-2">{s.title}</span>
            <span className="mono text-xs">{s.doc_id}</span>
            <span>{t(LICENCE[s.licence_status] ?? 'vf.src.licence.requested')}</span>
            {s.url && (
              <a className="link inline-flex items-center gap-1" href={s.url} target="_blank" rel="noreferrer">
                {t('vf.src.open')}
                <ArrowUpRight size={14} aria-hidden />
              </a>
            )}
          </p>
          {s.acknowledgement && <p className="m-0 text-xs leading-relaxed text-ink-3">{s.acknowledgement}</p>}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ readings: every signed reading, in a table */
const FIRST_ROWS = 8;

function Readings({ receipt }: { receipt: Receipt }) {
  const { t, lang } = useI18n();
  const rows = readingRows(receipt.data);
  const [all, setAll] = useState(false);
  if (!rows.length) return <p className="m-0 text-ink-3">{t('vf.data.none')}</p>;
  const shown = all ? rows : rows.slice(0, FIRST_ROWS);
  return (
    <>
      <div className="vf-table-wrap" tabIndex={0} role="region" aria-label={t('vf.data.title')}>
        <table className="vf-table">
          <thead>
            <tr>
              <th scope="col">{t('vf.data.variable')}</th>
              <th scope="col" className="text-right">
                {t('vf.data.value')}
              </th>
              <th scope="col">{t('vf.data.unit')}</th>
              <th scope="col">{t('vf.data.source')}</th>
              <th scope="col">{t('vf.data.observed')}</th>
              <th scope="col">{t('vf.data.retrieved')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  <span className="block font-medium text-ink">{readingLines([{ source: r.source, variable: r.variable, value: 0, unit: '', observed_at: r.observed_at, retrieved_at: r.retrieved_at }])[0]?.label}</span>
                  <span className="mono block text-[0.7rem] text-ink-3">{r.variable}</span>
                </th>
                <td className="mono text-right text-ink">{r.value}</td>
                <td className="mono text-ink-3">{r.unit}</td>
                <td className={cx(r.derived && 'text-carbon')}>{sourceLabel(r.source)}</td>
                <td className="mono whitespace-nowrap text-ink-2">{r.day ? fmtDate(r.day, lang) : fmtDate(r.observed_at, lang, 'datetime')}</td>
                <td className="mono whitespace-nowrap text-ink-3">{fmtDate(r.retrieved_at, lang, 'datetime')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > FIRST_ROWS && (
        <button type="button" className="btn btn-ghost btn-sm mt-3 -ml-2" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? t('ui.less') : t('vf.data.showAll', { n: fmtNum(rows.length, lang) })}
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ numbers people set */
function Params({ receipt }: { receipt: Receipt }) {
  const { t } = useI18n();
  const params = receipt.reviewer_parameters ?? [];
  if (!params.length) return <p className="m-0 text-ink-3">{t('vf.params.none')}</p>;
  return (
    <>
      <p className="m-0 text-sm text-ink-2">{t('vf.params.lead')}</p>
      <ul className="m-0 mt-4 grid list-none gap-3 p-0">
        {params.map((p) => (
          <li key={p.name} className="vf-param">
            <span className="mono text-[0.95rem] text-ink">
              {p.name} = {String(p.value)}
              {p.unit ? ` ${p.unit}` : ''}
            </span>
            <span className="chip chip-wait">{t('ui.receipt.notSource')}</span>
            <span className="text-sm text-ink-3">
              {t(p.set_by === 'expert' ? 'vf.params.byExpert' : 'vf.params.byTeam')} · {p.note}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ confidence */
function Confidence({ receipt }: { receipt: Receipt }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const c = receipt.confidence;
  return (
    <div>
      <p className="m-0 flex flex-wrap items-baseline gap-x-3">
        <span className="text-[1.15rem] font-semibold">{t(`ui.conf.${c.level}`)}</span>
        {typeof c.score === 'number' && <span className="mono text-sm text-ink-3">{t('vf.conf.score', { score: fmtNum(c.score, lang, { maximumFractionDigits: 2 }) })}</span>}
      </p>
      <button type="button" className="btn btn-ghost btn-sm mt-2 -ml-2" aria-expanded={open} aria-controls="vf-conf-basis" onClick={() => setOpen((v) => !v)}>
        {open ? t('ui.less') : t('ui.more')}
      </button>
      <p id="vf-conf-basis" hidden={!open} className="m-0 mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-2">
        {c.basis}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ the signature, and the check in this browser */
/** `local`: the in-browser check the verdict stage already ran (src/features/verify/CheckRun.tsx); without it, it runs here. */
export function Signature({ cred, statusList, recorded, local }: { cred: Credential; statusList?: string; recorded: boolean; local?: LocalCheckState | null }) {
  const { t, lang } = useI18n();
  const [own, setCheck] = useState<LocalCheckState>({ state: 'checking' });
  const check = local ?? own;
  useEffect(() => {
    if (local) return;
    let alive = true;
    setCheck({ state: 'checking' });
    void (async () => {
      const did = recorded ? (recordedDid as unknown as DidDocument) : await fetchDid();
      const r = await checkInBrowser(cred, did);
      if (alive) setCheck(r);
    })();
    return () => {
      alive = false;
    };
  }, [cred, recorded, local]);

  // "unsupported": this browser has no WebCrypto Ed25519 here. That says nothing about the signature, so it is not shown as invalid.
  const cannot = check.state === 'done' && !check.result.ok && /^(unsupported|no-did-document)$/.test(check.result.reason);
  const status = cred.credentialStatus;
  const list = status?.statusListCredential ?? statusList;
  const p = cred.proof;
  return (
    <>
      <dl className="vf-dl">
        <dt>{t('vf.sig.issuer')}</dt>
        <dd className="mono break-all">{cred.issuer}</dd>
        <dt>{t('vf.sig.suite')}</dt>
        <dd className="mono">{p.cryptosuite} · Ed25519</dd>
        <dt>{t('vf.sig.method')}</dt>
        <dd className="mono break-all">{p.verificationMethod}</dd>
        <dt>{t('vf.sig.created')}</dt>
        <dd className="mono">{fmtDate(p.created, lang, 'datetime')}</dd>
        <dt>{t('vf.sig.id')}</dt>
        <dd className="mono break-all">{cred.id}</dd>
        {list && (
          <>
            <dt>{t('vf.sig.list')}</dt>
            <dd className="mono break-all">
              {list}
              {status?.statusListIndex != null && <span className="text-ink-3"> · {t('vf.sig.index', { n: status.statusListIndex })}</span>}
            </dd>
          </>
        )}
      </dl>
      <div className="vf-local" data-state={cannot ? 'unavailable' : check.state === 'done' ? (check.result.ok ? 'ok' : 'bad') : check.state} role="status" aria-live="polite" data-testid="local-check">
        {cannot ? (
          <>
            <ShieldQuestion size={20} aria-hidden className="flex-none" />
            <span>{t('vf.local.unsupported')}</span>
          </>
        ) : check.state === 'checking' ? (
          <>
            <ShieldQuestion size={20} aria-hidden className="flex-none" />
            <span>{t('vf.local.checking')}</span>
          </>
        ) : check.state === 'unavailable' ? (
          <>
            <ShieldQuestion size={20} aria-hidden className="flex-none" />
            <span>{check.reason === 'no-did' ? t('vf.local.noDid') : t('vf.local.unavailable')}</span>
          </>
        ) : check.result.ok ? (
          <>
            <ShieldCheck size={20} aria-hidden className="flex-none" />
            <span>
              <strong className="font-semibold">{t('vf.local.ok', { suite: check.result.suite })}</strong>
              <span className="mono mt-1 block break-all text-xs">{t('vf.local.key', { key: check.result.keyId })}</span>
              {recorded && <span className="mt-1 block text-xs">{t('vf.local.recordedKey')}</span>}
            </span>
          </>
        ) : (
          <>
            <ShieldAlert size={20} aria-hidden className="flex-none" />
            <span>
              <strong className="font-semibold">{t('vf.local.bad')}</strong> <span className="mono text-xs">{check.result.reason}</span>
            </span>
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ timeline: issued -> (week) -> (recalled) -> checked */
export function Timeline({ cred, receipt, kind, outcome, recorded, checkedAt }: { cred: Credential; receipt: Receipt | null; kind: VerdictKind; outcome: VerifyOutcome | null; recorded: boolean; checkedAt: Date }) {
  const { t, lang } = useI18n();
  const plan = receipt?.plan;
  const split = splitRecalled(outcome?.rules);
  const sid = currentSessionId();
  const known = split.rules.map((r) => recallOf(r, recorded ? 'sample' : 'sandbox', sid)).find(Boolean) ?? null;
  const items: { key: string; tone: 'ink' | 'stop' | 'wait' | 'go'; title: string; when?: string; detail?: ReactNode }[] = [];
  items.push({ key: 'issued', tone: 'ink', title: t('vf.tl.issued'), when: fmtDate(cred.proof.created, lang, 'datetime') });
  if (plan) items.push({ key: 'week', tone: 'ink', title: t('vf.tl.week', { from: fmtDate(plan.valid_from, lang), to: fmtDate(plan.valid_to, lang) }) });
  if (kind === 'expired') items.push({ key: 'expired', tone: 'wait', title: t('vf.tl.expired') });
  if (kind === 'recalled') {
    items.push({
      key: 'recalled',
      tone: 'stop',
      title: split.rules.length ? t('vf.tl.recalled', { rules: split.rules.join(', ') }) : t('vf.tl.photo'),
      when: known ? fmtDate(known.at, lang, 'datetime') : undefined,
      detail: known ? (
        <>
          {t('vf.tl.reason', { reason: known.reason })} <span className="text-ink-3">· {t('vf.tl.byYou')}</span>
        </>
      ) : outcome?.reason ? (
        <span className="mono text-xs">{outcome.reason}</span>
      ) : undefined,
    });
  }
  items.push({ key: 'checked', tone: kind === 'authentic' ? 'go' : kind === 'recalled' ? 'stop' : kind === 'expired' ? 'wait' : 'ink', title: t('vf.tl.checked', { verdict: t(`ui.stamp.${kind === 'unreachable' ? 'checking' : kind}`) }), when: fmtDate(checkedAt, lang, 'datetime') });
  return (
    <ol className="vf-tl" data-testid="timeline">
      {items.map((it) => (
        <li key={it.key} data-tone={it.tone}>
          <span className="vf-tl-dot" aria-hidden />
          <p className="m-0 font-medium text-ink">{it.title}</p>
          {it.when && <p className="mono m-0 text-xs text-ink-3">{it.when}</p>}
          {it.detail && <p className="m-0 mt-1 text-sm text-ink-2">{it.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ the whole document */
export function ReceiptDoc({
  cred,
  receipt,
  kind,
  outcome,
  recorded,
  checkedAt,
  local,
}: {
  cred: Credential;
  receipt: Receipt;
  kind: VerdictKind;
  outcome: VerifyOutcome | null;
  recorded: boolean;
  checkedAt: Date;
  local?: LocalCheckState | null;
}) {
  const { t } = useI18n();
  const ref = receipt.area_trust_ref;
  return (
    <div className="wrap vf-doc" data-testid="receipt-doc">
      <div className="vf-doc-card">
        <ReceiptCard receipt={receipt} credentialId={cred.id} struck={kind === 'recalled'} mark={recorded ? <DataMark kind="recorded" date={RECORDED_AT} /> : undefined} />
        {ref && (
          <p className="mt-5 flex items-start gap-2 text-sm text-ink-2" data-testid="receipt-photo-trust">
            <Leaf size={16} aria-hidden className="mt-0.5 flex-none text-ink-3" />
            <span>
              {t('vf.photoRef', { area: ref.area })}{' '}
              <Link className="link" to={verifyPath(ref.credential_id)} data-testid="receipt-photo-trust-link">
                {t('vf.photoRef.link')}
              </Link>
            </span>
          </p>
        )}
      </div>
      <div className="vf-doc-body">
        <DocSection n="01" title={t('vf.src.title')} testId="doc-sources">
          <Sources receipt={receipt} />
        </DocSection>
        <DocSection n="02" title={t('vf.data.title')} testId="doc-data">
          <Readings receipt={receipt} />
        </DocSection>
        <DocSection n="03" title={t('vf.params.title')} testId="doc-params">
          <Params receipt={receipt} />
        </DocSection>
        <DocSection n="04" title={t('vf.conf.title')} testId="doc-confidence">
          <Confidence receipt={receipt} />
        </DocSection>
        <DocSection n="05" title={t('vf.sig.title')} testId="doc-signature">
          <Signature cred={cred} statusList={outcome?.status_list} recorded={recorded} local={local} />
        </DocSection>
        <DocSection n="06" title={t('vf.tl.title')} testId="doc-timeline">
          <Timeline cred={cred} receipt={receipt} kind={kind} outcome={outcome} recorded={recorded} checkedAt={checkedAt} />
        </DocSection>
      </div>
    </div>
  );
}
