import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, CircleDot, Inbox, MessageCircleQuestion, Undo2 } from 'lucide-react';
import type { InboxItem } from '../../lib/api/types';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum, humanize, pickText } from '../../lib/format';
import { cx } from '../../lib/cx';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { Button, LinkButton } from '../../ui/Button';
import { toast } from '../../ui/Toast';
import { isLocalCase, isRecordedCase, reopenCase, resolveCase, useInbox, useInboxMeta } from './inboxStore';
import { parseRuleLabel, reasonHint, reasonTitle } from './reasons';
import { useMedia, WIDE } from './useMedia';
import { AnimatedList } from '../../ui/kit/AnimatedList';

type Filter = 'open' | 'resolved' | 'all';

/** Inbox: filters + list + the case beside it (in a sheet on phones). `/officer/:id` opens a case. */
export function InboxPanel({ selectedId, onSelect, onClose }: { selectedId: string | null; onSelect: (id: string) => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const items = useInbox();
  const meta = useInboxMeta();
  const wide = useMedia(WIDE);
  const [filter, setFilter] = useState<Filter>('open');
  // on wide screens the newest open case is already open beside the list (no URL change until the officer picks one)
  const autoId = wide && !selectedId ? ((items.find((i) => i.status === filter || filter === 'all') ?? null)?.item_id ?? null) : null;
  const activeId = selectedId ?? autoId;
  const selected = activeId ? (items.find((i) => i.item_id === activeId) ?? null) : null;
  const counts = { open: items.filter((i) => i.status === 'open').length, resolved: items.filter((i) => i.status === 'resolved').length, all: items.length };
  const shown = items.filter((i) => filter === 'all' || i.status === filter);

  // a case opened by link stays in view even when the filter would hide it
  const linked = selectedId ? (items.find((i) => i.item_id === selectedId) ?? null) : null;
  useEffect(() => {
    if (linked && filter !== 'all' && linked.status !== filter) setFilter('all');
  }, [linked?.item_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = meta.load === 'idle' || (meta.load === 'loading' && !items.length);

  return (
    <div className="off-split">
      <section className="off-list" aria-labelledby="off-inbox-h">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="off-inbox-h" className="sr-only-live">
            {t('off.tab.inbox')}
          </h2>
          <Segmented
            label={t('off.inbox.filter')}
            value={filter}
            onChange={setFilter}
            options={(['open', 'resolved', 'all'] as const).map((f) => ({
              value: f,
              label: (
                <span className="inline-flex items-center gap-1.5" data-testid={`filter-${f}`}>
                  {t(`off.filter.${f}`)}
                  <span className="mono text-xs text-ink-3">{fmtNum(counts[f], lang)}</span>
                </span>
              ),
            }))}
          />
        </div>
        <p className="mt-3 text-sm text-ink-3">{t('off.inbox.local')}</p>
        {!wide && selectedId && !linked && !loading && (
          <div className="mt-4">
            <NotHere id={selectedId} />
          </div>
        )}

        {loading ? (
          <div className="mt-4 grid gap-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-[72px]" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="off-empty mt-4" data-testid="inbox-empty">
            <Inbox size={28} strokeWidth={1.5} aria-hidden />
            <p className="m-0 font-medium text-ink">{filter === 'open' ? t('off.inbox.emptyOpen') : t('off.inbox.empty')}</p>
            <p className="m-0 max-w-[40ch] text-sm text-ink-3">{t('off.inbox.emptyHint')}</p>
            <LinkButton to="/officer?tab=recall" variant="secondary" size="sm" arrow>
              {t('off.inbox.toRecall')}
            </LinkButton>
          </div>
        ) : (
          <AnimatedList key={filter} className="off-rows mt-4" testId="case-list">
            {shown.map((it) => (
              <CaseRow key={it.item_id} item={it} active={it.item_id === activeId} onSelect={onSelect} />
            ))}
          </AnimatedList>
        )}
      </section>

      {wide ? (
        <section className="off-detail" aria-label={t('off.inbox.detail')} aria-live="polite">
          {selected ? (
            <CaseDetail key={selected.item_id} item={selected} withTitle />
          ) : selectedId && !loading ? (
            <NotHere id={selectedId} />
          ) : (
            <div className="off-placeholder" data-testid="select-case">
              <CircleDot size={22} strokeWidth={1.6} aria-hidden />
              <p className="m-0">{t('off.inbox.pick')}</p>
            </div>
          )}
        </section>
      ) : (
        <Sheet open={!!selected} onClose={onClose} title={selected ? reasonTitle(selected.reason_code, t) : ''} subtitle={selected ? <span className="mono">{selected.item_id}</span> : undefined}>
          {selected && <CaseDetail key={selected.item_id} item={selected} />}
        </Sheet>
      )}
    </div>
  );
}

function CaseRow({ item, active, onSelect }: { item: InboxItem; active: boolean; onSelect: (id: string) => void }) {
  const { t, lang } = useI18n();
  return (
    <Link
      to={`/officer/${encodeURIComponent(item.item_id)}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onSelect(item.item_id);
      }}
      className={cx('off-row', active && 'is-active')}
      aria-current={active ? 'true' : undefined}
      data-testid="case-row"
      data-status={item.status}
    >
      <span className="off-row-mark" data-status={item.status} aria-hidden>
        {item.status === 'resolved' ? <CheckCheck size={14} strokeWidth={2.4} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            {item.priority === 'urgent' && <span className="chip chip-stop flex-none">{t('off.urgent')}</span>}
            <span className="truncate font-semibold text-ink">{reasonTitle(item.reason_code, t)}</span>
          </span>
          <span className="mono flex-none text-xs text-ink-3">{fmtDate(item.created_at, lang, 'short')}</span>
        </span>
        <span className="mono mt-1 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
          <span>{item.farmer_display_name}</span>
          <span aria-hidden>·</span>
          <span>{item.field_id}</span>
          {item.question && (
            <span className="inline-flex items-center gap-1 text-ink-2">
              <MessageCircleQuestion size={13} aria-hidden />
              <span className="sr-only-live">{t('off.case.question')}</span>
            </span>
          )}
        </span>
        <span className="sr-only-live">{item.status === 'open' ? t('off.filter.open') : t('off.filter.resolved')}</span>
      </span>
    </Link>
  );
}

function NotHere({ id }: { id: string }) {
  const { t } = useI18n();
  return (
    <div className="off-placeholder">
      <Inbox size={22} strokeWidth={1.6} aria-hidden />
      <p className="m-0 max-w-[42ch]">{t('off.inbox.notHere', { id })}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ one case */
const show = (v: unknown): string => {
  if (v == null) return '—';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : '—';
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${show(x)}`).join(' · ');
  return String(v);
};
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

interface Retrieved {
  rule_id: string;
  confidence: number;
}
const asRetrieved = (v: unknown): Retrieved[] =>
  Array.isArray(v) ? v.filter((x): x is Retrieved => !!x && typeof x === 'object' && typeof (x as Retrieved).rule_id === 'string' && typeof (x as Retrieved).confidence === 'number').slice(0, 4) : [];

export function CaseDetail({ item, withTitle }: { item: InboxItem; withTitle?: boolean }) {
  const { t, lang } = useI18n();
  const told = pickText(item.reason, lang);
  const details = item.details ?? {};
  const recalled = Array.isArray(details.recalled) ? (details.recalled as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const retrieved = asRetrieved(details.top_retrieved);
  const threshold = typeof details.threshold === 'number' ? details.threshold : null;
  const unknownRules = Array.isArray(details.unknown_rules) ? (details.unknown_rules as unknown[]).filter((x): x is [string, string[]] => Array.isArray(x) && typeof x[0] === 'string' && Array.isArray(x[1])) : [];
  const shownKeys = new Set(['recalled', 'top_retrieved', 'threshold', 'unknown_rules', 'candidates']);
  const rest = Object.entries(details).filter(([k]) => !shownKeys.has(k));
  const hint = reasonHint(item.reason_code, t);

  return (
    <article className="off-case" data-testid="case-detail" aria-labelledby={withTitle ? `off-case-${item.item_id}` : undefined}>
      {withTitle && (
        <header>
          <p className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cx('off-status', item.status === 'open' ? 'is-open' : 'is-done')}>{item.status === 'open' ? t('off.filter.open') : t('off.filter.resolved')}</span>
            <span className="mono normal-case tracking-normal">{item.item_id}</span>
          </p>
          <h3 id={`off-case-${item.item_id}`} className="off-case-title">
            {reasonTitle(item.reason_code, t)}
          </h3>
        </header>
      )}
      {hint && <p className="m-0 mt-2 max-w-[58ch] text-ink-2">{hint}</p>}

      <dl className="off-kv mt-5">
        <dt>{t('off.case.farmer')}</dt>
        <dd className="mono">{item.farmer_display_name}</dd>
        <dt>{t('off.case.field')}</dt>
        <dd className="mono">{item.field_id}</dd>
        <dt>{t('off.case.received')}</dt>
        <dd className="mono">{fmtDate(item.created_at, lang, 'datetime')}</dd>
        {item.diagnosis_id && (
          <>
            <dt>{t('off.case.diagnosis')}</dt>
            <dd className="mono break-all">{item.diagnosis_id}</dd>
          </>
        )}
      </dl>

      {item.question && (
        <section className="off-block">
          <h4 className="eyebrow">{t('off.case.question')}</h4>
          <p className="off-asked" lang={/[ঀ-৿]/.test(item.question) ? 'bn' : undefined} data-testid="case-question">
            {item.question}
          </p>
        </section>
      )}

      <section className="off-block">
        <h4 className="eyebrow">{t('off.case.told')}</h4>
        <p className="m-0 mt-2 text-ink" lang={told.lang}>
          {told.text}
        </p>
      </section>

      {recalled.length > 0 && (
        <section className="off-block" data-testid="case-recalled">
          <h4 className="eyebrow">{t('off.case.recalled')}</h4>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            {recalled.map((r) => {
              const p = parseRuleLabel(r);
              return (
                <Link key={r} to={p ? `/officer?tab=recall&rule=${encodeURIComponent(`${p.rule_id}@${p.version}`)}` : '/officer?tab=recall'} className="chip chip-stop mono normal-case tracking-normal no-underline">
                  {r}
                </Link>
              );
            })}
          </p>
        </section>
      )}

      {retrieved.length > 0 && (
        <section className="off-block" data-testid="case-retrieved">
          <h4 className="eyebrow">{t('off.case.closest')}</h4>
          <ul className="off-bars mt-3">
            {retrieved.map((r) => (
              <li key={r.rule_id}>
                <span className="mono text-sm text-ink">{r.rule_id}</span>
                <span className="off-bar" role="img" aria-label={t('off.case.conf', { rule: r.rule_id, conf: fmtNum(r.confidence, lang, { maximumFractionDigits: 2 }) })}>
                  <span className="off-bar-fill" style={{ transform: `scaleX(${Math.min(1, Math.max(0, r.confidence))})` }} />
                  {threshold != null && <span className="off-bar-mark" style={{ left: `${threshold * 100}%` }} />}
                </span>
                <span className="mono text-sm text-ink-2">{fmtNum(r.confidence, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </li>
            ))}
          </ul>
          {threshold != null && <p className="m-0 mt-2 text-sm text-ink-3">{t('off.case.bar', { bar: fmtNum(threshold, lang, { maximumFractionDigits: 2 }) })}</p>}
        </section>
      )}

      {unknownRules.length > 0 && (
        <section className="off-block" data-testid="case-missing">
          <h4 className="eyebrow">{t('off.case.missing')}</h4>
          <ul className="m-0 mt-2 grid list-none gap-1.5 p-0 text-sm">
            {unknownRules.map(([rule, inputs]) => (
              <li key={rule}>
                <span className="mono text-ink">{rule}</span> <span className="text-ink-3">←</span> <span className="mono text-ink-2">{inputs.map((x) => humanize(String(x))).join(', ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rest.length > 0 && (
        <section className="off-block" data-testid="case-details">
          <h4 className="eyebrow">{t('off.case.details')}</h4>
          <dl className="off-kv off-kv-sm mt-3">
            {rest.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{humanize(k)}</dt>
                <dd className="mono break-words" title={show(v)}>
                  {clip(show(v))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <Resolve item={item} />
    </article>
  );
}

function Resolve({ item }: { item: InboxItem }) {
  const { t, lang } = useI18n();
  const [note, setNote] = useState(item.resolution_note ?? '');
  const done = useRef<HTMLParagraphElement>(null);
  const local = isLocalCase(item.item_id);
  const recorded = isRecordedCase(item.item_id);
  const by = item.resolved_by === 'farmer-app' ? t('off.case.byFarmerApp') : t('off.case.byYou');
  const was = useRef(item.status);
  useEffect(() => {
    // focus follows the officer's own action (resolve), never a case that was already resolved when it opened
    if (was.current === 'open' && item.status === 'resolved') done.current?.focus({ preventScroll: true });
    was.current = item.status;
  }, [item.status]);
  return (
    <section className="off-block off-resolve" data-testid="case-resolve">
      {item.status === 'open' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            resolveCase(item.item_id, note.trim());
            toast(t('off.case.resolvedToast'));
          }}
        >
          <label htmlFor={`note-${item.item_id}`} className="eyebrow block">
            {t('off.case.note')}
          </label>
          <textarea id={`note-${item.item_id}`} className="off-textarea mt-2" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('off.case.notePh')} data-testid="case-note" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" data-testid="resolve-btn">
              <CheckCheck size={17} aria-hidden />
              {t('off.case.resolve')}
            </Button>
            <span className="text-xs text-ink-3">{local ? t('off.case.localCase') : recorded ? t('off.case.recordedCase') : t('off.case.browserOnly')}</span>
          </div>
        </form>
      ) : (
        <>
          <p ref={done} tabIndex={-1} className="m-0 flex items-center gap-2 font-semibold text-go" data-testid="case-resolved">
            <CheckCheck size={17} aria-hidden />
            {t('off.case.resolved', { who: by })}
            {item.resolved_at && <span className="mono text-xs font-normal text-ink-3">· {fmtDate(item.resolved_at, lang, 'datetime')}</span>}
          </p>
          {item.resolution_note && <p className="m-0 mt-2 text-ink-2">“{item.resolution_note}”</p>}
          <p className="m-0 mt-1 text-xs text-ink-3">{t('off.case.browserOnly')}</p>
          <Button variant="ghost" size="sm" className="mt-3 -ml-2" onClick={() => reopenCase(item.item_id)} data-testid="reopen-btn">
            <Undo2 size={16} aria-hidden />
            {t('off.case.reopen')}
          </Button>
        </>
      )}
    </section>
  );
}
