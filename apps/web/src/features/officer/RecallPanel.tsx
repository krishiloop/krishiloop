import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Inbox, RefreshCw, Smartphone, TriangleAlert } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum, pickText, shortId } from '../../lib/format';
import { useMotionReduced } from '../../lib/motionPref';
import { verifyUrl } from '../../lib/qr';
import { cx } from '../../lib/cx';
import { Button, LinkButton } from '../../ui/Button';
import { Stamp } from '../../ui/Stamp';
import { DecisionPictogram, KindIcon } from '../../ui/Pictogram';
import { toast } from '../../ui/Toast';
import { citesRule, recall, resetSandbox, rulesOf, useLedger, type LedgerReceipt, type RecallRecord, type RuleRow } from './ledger';
import { loadInbox } from './inboxStore';
import { loadStats } from './stats';
import { reasonTitle } from './reasons';
import { Roll } from './Roll';

const verifyPath = (id: string) => `/verify/${encodeURIComponent(id.replace(/^urn:uuid:/, ''))}`;
const RIPPLE_MS = 130;

/** A translated line with a rule id put back in, kept on one line ("R-BDR-002 v1" must not break at its hyphens). */
function withRule(line: string, rule: string) {
  const [a, b = ''] = line.split('\u0000');
  return (
    <>
      {a}
      <span className="whitespace-nowrap">{rule}</span>
      {b}
    </>
  );
}

/**
 * Rules & recall, the console's key moment. Left: the rule versions behind this sandbox's receipts. Right: every receipt
 * issued here, as a wall of small paper slips. Recalling a rule (with a reason) withdraws it in the sandbox; the verifier is
 * then asked again about each receipt that cites it, and a RECALLED stamp lands on each one it now calls recalled, in a
 * ripple outward from the first. The farmer plans that used the rule are built again and now abstain to the inbox.
 */
export function RecallPanel({ focusRule }: { focusRule: string | null }) {
  const { t, lang } = useI18n();
  const st = useLedger();
  const reduced = useMotionReduced();
  const rules = useMemo(() => rulesOf(st), [st]);
  const [hl, setHl] = useState<string | null>(focusRule);
  const [confirm, setConfirm] = useState<RuleRow | null>(null);
  const [phase, setPhase] = useState<'idle' | 'recalling' | 'done' | 'error'>('idle');
  const [last, setLast] = useState<RecallRecord | null>(null);
  const [message, setMessage] = useState('');
  const [resetting, setResetting] = useState(false);
  const wall = useRef<HTMLElement>(null);
  const recorded = st.source === 'recorded';

  useEffect(() => {
    if (!focusRule) return;
    setHl(focusRule);
    document.getElementById(`rule-${focusRule}`)?.scrollIntoView({ block: 'center' });
  }, [focusRule, rules.length]);

  const run = async (row: RuleRow, reason: string) => {
    setConfirm(null);
    setPhase('recalling');
    setHl(row.key);
    const r = await recall(row.rule_id, row.version, reason);
    if (!r.ok) {
      setPhase('error');
      setMessage(r.message);
      return;
    }
    setLast(r.record);
    setPhase('done');
    if (!window.matchMedia('(min-width: 1024px)').matches) wall.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    void loadInbox();
    void loadStats();
  };

  const groups = useMemo(() => {
    const m = new Map<string, RuleRow[]>();
    for (const r of rules) m.set(r.pack, [...(m.get(r.pack) ?? []), r]);
    return [...m.entries()];
  }, [rules]);

  if ((st.status === 'idle' || st.status === 'loading') && !st.receipts.length) {
    return (
      <div className="off-recall-grid" aria-busy="true">
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-[104px]" />
          ))}
        </div>
        <div className="off-wall">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="skeleton aspect-[4/5]" />
          ))}
        </div>
        <p className="sr-only-live">{t('off.recall.building')}</p>
      </div>
    );
  }
  if (st.status === 'error' && !st.receipts.length) {
    return (
      <div className="off-empty" data-testid="recall-error">
        <TriangleAlert size={28} strokeWidth={1.5} aria-hidden />
        <p className="m-0 font-medium text-ink">{t('off.recall.failed')}</p>
        <p className="m-0 max-w-[48ch] text-sm text-ink-3">{t('off.recall.failedSub')}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="off-recall-head">
        <div className="min-w-0">
          <h2 className="off-h2">{t('off.recall.title')}</h2>
          <p className="m-0 mt-2 max-w-[60ch] text-ink-2">{t('off.recall.lead')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-ink-3">{recorded ? t('off.recall.simulated') : t('off.recall.sandboxOnly')}</span>
          {(!recorded || st.recalls.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              disabled={resetting || phase === 'recalling'}
              onClick={async () => {
                setResetting(true);
                setLast(null);
                setPhase('idle');
                await resetSandbox();
                void loadInbox();
                void loadStats();
                setResetting(false);
                toast(recorded ? t('off.recall.resetDoneRecorded') : t('off.recall.resetDone'), { tone: 'info' });
              }}
              data-testid="reset-sandbox"
            >
              <RefreshCw size={15} aria-hidden className={cx(resetting && 'off-spin')} />
              {recorded ? t('off.recall.resetRecorded') : t('off.recall.reset')}
            </Button>
          )}
        </div>
      </div>

      <div className="off-recall-grid">
        <section aria-labelledby="off-rules-h">
          <h3 id="off-rules-h" className="sr-only-live">
            {t('off.recall.rules')}
          </h3>
          {groups.map(([pack, rows]) => (
            <div key={pack} className="off-pack">
              <p className="eyebrow">
                {rows[0]?.crop} · {pack}
              </p>
              <ul className="off-rule-list" data-testid="rule-list">
                {rows.map((row, i) => (
                  <li key={row.key} id={`rule-${row.key}`} className="off-in" style={{ ['--i' as string]: Math.min(i, 8) }}>
                    <RuleItem row={row} hl={hl === row.key} onHl={setHl} onRecall={() => setConfirm(row)} busy={phase === 'recalling'} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section ref={wall} className="off-wall-wrap" aria-labelledby="off-wall-h">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 id="off-wall-h" className="eyebrow">
              {t('off.recall.wall', { n: fmtNum(st.receipts.length, lang) })}
            </h3>
            <p className="m-0 flex items-center gap-3 text-xs text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="off-key is-ok" aria-hidden />
                {t('ui.stamp.authentic')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="off-key is-stop" aria-hidden />
                {t('ui.stamp.recalled')}
              </span>
            </p>
          </div>
          <Wall receipts={st.receipts} states={st.states} hl={rules.find((r) => r.key === hl) ?? null} ripple={last} />
          <div aria-live="polite" className="mt-6">
            {phase === 'recalling' && (
              <p className="off-working m-0" data-testid="recall-working">
                <span className="off-dot-pulse" aria-hidden />
                {t('off.recall.working')}
              </p>
            )}
            {phase === 'error' && (
              <p role="alert" className="m-0 text-stop" data-testid="recall-failed">
                {t('off.recall.error', { message })}
              </p>
            )}
            {phase === 'done' && last && <RecallResult record={last} receipts={st.receipts} />}
          </div>
        </section>
      </div>

      <ConfirmRecall row={confirm} recorded={recorded} onCancel={() => setConfirm(null)} onConfirm={run} />
    </div>
  );
}

/* ------------------------------------------------------------------ one rule version */
function RuleItem({ row, hl, onHl, onRecall, busy }: { row: RuleRow; hl: boolean; onHl: (k: string | null) => void; onRecall: () => void; busy: boolean }) {
  const { t, lang } = useI18n();
  const title = pickText(row.title, lang);
  const recalled = !!row.recall;
  return (
    <div
      className={cx('off-rule', hl && 'is-hl', recalled && 'is-recalled')}
      data-testid="rule-row"
      data-rule={row.key}
      data-state={recalled ? 'recalled' : 'active'}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') onHl(row.key); // a finger on a phone does not hover
      }}
      onFocus={() => onHl(row.key)}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cx('mono text-[1.02rem] font-semibold text-ink', recalled && 'text-stop line-through decoration-2')}>
          {row.rule_id} v{row.version}
        </span>
        <span className="text-xs text-ink-3">{t(`ui.review.${row.review_level}`)}</span>
      </div>
      <p lang={title.lang} className="off-rule-text">
        {title.text}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm text-ink-2">
          <span className="off-chits" aria-hidden>
            {row.receipts.slice(0, 6).map((r) => (
              <span key={r.id} />
            ))}
          </span>
          {t(row.receipts.length === 1 ? 'off.recall.cites1' : 'off.recall.cites', { n: fmtNum(row.receipts.length, lang) })}
        </span>
        {recalled ? (
          <span className="inline-flex items-center gap-3">
            <span className="mono text-xs text-ink-3">{fmtDate(row.recall!.at, lang, 'time')}</span>
            <Stamp kind="recalled" size="sm" />
          </span>
        ) : (
          <Button variant="secondary" size="sm" className="off-recall-btn" onClick={onRecall} disabled={busy} data-testid={`recall-${row.key}`}>
            {t('off.recall.do')}
          </Button>
        )}
      </div>
      {recalled && row.recall!.reason && (
        <p className="m-0 mt-2 text-sm text-ink-2">
          {t('off.recall.reasonWas')} <q className="text-ink">{row.recall!.reason}</q>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the wall of receipts, and the ripple */
function Wall({ receipts, states, hl, ripple }: { receipts: LedgerReceipt[]; states: Record<string, string>; hl: RuleRow | null; ripple: RecallRecord | null }) {
  const { t, lang } = useI18n();
  const grid = useRef<HTMLUListElement>(null);
  const [cols, setCols] = useState(4);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const read = () => setCols(Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the ripple: rings of distance from the first receipt the verifier now calls recalled
  const delays = useMemo(() => {
    const out = new Map<string, number>();
    if (!ripple?.recalledNow.length) return out;
    const index = new Map(receipts.map((r, i) => [r.id, i]));
    const src = Math.min(...ripple.recalledNow.map((id) => index.get(id) ?? 0));
    const sx = src % cols;
    const sy = Math.floor(src / cols);
    for (const id of ripple.recalledNow) {
      const i = index.get(id);
      if (i == null) continue;
      const ring = Math.max(Math.abs((i % cols) - sx), Math.abs(Math.floor(i / cols) - sy));
      out.set(id, 120 + ring * RIPPLE_MS);
    }
    return out;
  }, [ripple, receipts, cols]);

  return (
    <ul ref={grid} className={cx('off-wall', hl && 'has-hl')} data-testid="receipt-wall">
      {receipts.map((r, i) => {
        const state = states[r.id] ?? 'authentic';
        const on = !!hl && citesRule(r, hl.rule_id, hl.version);
        const delay = delays.get(r.id);
        const rule = r.rules[0];
        const title = pickText(r.title, lang);
        const word = state === 'recalled' ? t('ui.stamp.recalled') : state === 'authentic' ? t('ui.stamp.authentic') : t('ui.stamp.checking');
        return (
          <li key={r.id} className="off-in" style={{ ['--i' as string]: Math.min(i, 12) }}>
            <Link
              to={verifyPath(r.id)}
              className={cx('off-tile paper-object', on && 'is-hl')}
              data-state={state}
              data-testid="receipt-tile"
              data-rippled={delay != null || undefined}
              style={delay != null ? ({ '--d': `${delay}ms` } as CSSProperties) : undefined}
            >
              {/* the visible text stays part of the link's name (WCAG 2.5.3); the verdict and the advice are added for screen readers */}
              <span className="sr-only-live">{t('off.tile.sr', { state: word, title: title.text })}</span>
              <span className="off-tile-top">
                <span className={cx('off-tile-pict', r.light === 'green' ? 'text-go' : r.light === 'red' ? 'text-stop' : r.light === 'amber' ? 'text-wait' : 'text-ink-2')}>
                  {r.decision ? <DecisionPictogram decision={r.decision} size={26} /> : <KindIcon kind={r.kind} size={18} />}
                </span>
                <span className="mono text-[0.6rem] text-ink-3">…{shortId(r.id, 4)}</span>
              </span>
              <span className={cx('mono block text-[0.68rem] font-semibold leading-tight text-ink', state === 'recalled' && 'text-stop line-through')}>
                {rule ? `${rule.rule_id.replace(/^R-/, '')} v${rule.version}` : '—'}
              </span>
              <span className="mono block truncate text-[0.6rem] leading-tight text-ink-3">{r.field.replace('-SAMPLE-', '·')}</span>
              <span className="off-tile-stamp" aria-hidden>
                {state === 'recalled' && delay != null ? (
                  <>
                    {/* the green stamp stays until the red one lands on top of it */}
                    <Stamp key={`a-${ripple?.at}`} kind="authentic" size="inherit" className="off-stamp-out" style={{ animationDelay: `${delay + 120}ms` }} />
                    <Stamp key={`r-${ripple?.at}`} kind="recalled" size="inherit" land style={{ animationDelay: `${delay}ms` }} />
                  </>
                ) : state === 'recalled' ? (
                  <Stamp kind="recalled" size="inherit" />
                ) : (
                  <Stamp kind={state === 'authentic' ? 'authentic' : 'checking'} size="inherit" />
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ what the recall did */
function RecallResult({ record, receipts }: { record: RecallRecord; receipts: LedgerReceipt[] }) {
  const { t, lang } = useI18n();
  const n = record.recalledNow.length;
  const first = record.recalledNow[0] ?? record.affected[0];
  const r0 = receipts.find((r) => r.id === first) ?? null;
  const title = r0 ? pickText(r0.title, lang) : null;
  return (
    <div className="off-result" data-testid="recall-result">
      <p className="off-result-line" data-testid="recall-line">
        <Roll value={fmtNum(n, lang)} className="off-result-n" />
        <span>{withRule(t(n === 1 ? 'off.result.line1' : 'off.result.line', { rule: '\u0000' }), `${record.rule_id} v${record.version}`)}</span>
      </p>
      {record.affected.length > n && <p className="m-0 mt-2 text-sm text-wait">{t('off.result.some', { n: fmtNum(record.affected.length - n, lang) })}</p>}
      <p className="m-0 mt-2 text-sm text-ink-3">
        {fmtDate(record.at, lang, 'datetime')} · <q>{record.reason}</q>
        {record.mode === 'sample' && <> · {t('off.recall.simulatedShort')}</>}
      </p>

      {record.replans.length > 0 && (
        <ul className="off-replans" data-testid="replans">
          {record.replans.map((p) => (
            <li key={`${p.field}|${p.profile}`}>
              <span className="mono text-xs text-ink-2">
                {p.profile} · {p.field}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm">
                <ArrowRight size={14} aria-hidden className="text-ink-3" />
                {p.status === 'abstained' ? (
                  <strong className="font-semibold text-ink">{p.reason_code && p.reason_code !== 'rule_recalled' ? `${t('off.result.abstains')} · ${reasonTitle(p.reason_code, t)}` : t('off.result.abstains')}</strong>
                ) : (
                  <span className="text-ink-2">{t('off.result.planOk')}</span>
                )}
              </span>
              {p.status === 'abstained' && p.inbox_item_id && (
                <Link className="link inline-flex items-center gap-1 text-sm" to={`/officer/${encodeURIComponent(p.inbox_item_id)}`}>
                  <Inbox size={13} aria-hidden />
                  {t('off.result.case')}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {first && (
        <LinkButton to={verifyPath(first)} variant="primary" className="mt-5" data-testid="recheck-one" arrow>
          {t('off.result.recheck')}
        </LinkButton>
      )}

      {title && first && (
        <figure className="off-sms" data-testid="notification-preview">
          <figcaption className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <Smartphone size={14} aria-hidden />
            <span className="chip">{t('off.sms.planned')}</span>
          </figcaption>
          <p className="off-sms-bubble" lang={title.lang === lang ? undefined : lang}>
            {t('off.sms.body', { title: title.text, rule: `${record.rule_id} v${record.version}`, url: verifyUrl(first).replace(/^https?:\/\//, '') })}
          </p>
        </figure>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the confirm dialog (native <dialog>: focus trap, Escape) */
function ConfirmRecall({ row, recorded, onCancel, onConfirm }: { row: RuleRow | null; recorded: boolean; onCancel: () => void; onConfirm: (row: RuleRow, reason: string) => void }) {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const titleId = useId();
  const keep = useRef<RuleRow | null>(null);
  if (row) keep.current = row;
  const shown = row ?? keep.current;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (row && !d.open) {
      setReason('');
      setTouched(false);
      d.showModal();
    }
    if (!row && d.open) d.close();
  }, [row]);

  const quick = [t('off.confirm.q1'), t('off.confirm.q2'), t('off.confirm.q3')];
  const ok = reason.trim().length >= 3;
  const title = shown ? pickText(shown.title, lang) : null;
  return (
    <dialog
      ref={ref}
      className="off-dialog"
      aria-labelledby={titleId}
      onClose={onCancel}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      data-testid="recall-dialog"
    >
      {shown && (
        <form
          className="p-6 sm:p-7"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (ok) onConfirm(shown, reason.trim());
          }}
        >
          <p className="eyebrow">{t('off.confirm.eyebrow')}</p>
          <h2 id={titleId} className="off-dialog-title">
            {t('off.confirm.title', { rule: `${shown.rule_id} v${shown.version}` })}
          </h2>
          <p className="m-0 mt-3 text-ink-2">{t(shown.receipts.length === 1 ? 'off.confirm.body1' : 'off.confirm.body', { n: fmtNum(shown.receipts.length, lang) })}</p>
          {title && (
            <p lang={title.lang} className="m-0 mt-4 border-l-2 border-rule-2 pl-3 text-sm text-ink-2">
              {title.text}
            </p>
          )}
          <label htmlFor={`${titleId}-reason`} className="eyebrow mt-6 block">
            {t('off.confirm.reason')}
          </label>
          <textarea
            id={`${titleId}-reason`}
            className="off-textarea mt-2"
            rows={2}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('off.confirm.reasonPh')}
            aria-invalid={touched && !ok ? true : undefined}
            aria-describedby={`${titleId}-hint`}
            data-testid="recall-reason"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {quick.map((q) => (
              <button key={q} type="button" className="off-quick" onClick={() => setReason(q)}>
                {q}
              </button>
            ))}
          </div>
          <p id={`${titleId}-hint`} className={cx('m-0 mt-3 text-xs', touched && !ok ? 'text-stop' : 'text-ink-3')}>
            {touched && !ok ? t('off.confirm.need') : recorded ? t('off.confirm.recorded') : t('off.confirm.sandbox')}
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={onCancel}>
              {t('off.confirm.cancel')}
            </Button>
            <Button type="submit" variant="danger" data-testid="recall-confirm">
              {t('off.confirm.go')}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
