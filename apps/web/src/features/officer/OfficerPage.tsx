import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, ChartLine, CircleDot, FlaskConical, Inbox, Leaf, Lock, LockOpen, MessageCircleQuestion, Undo2, CheckCheck, ShieldCheck } from 'lucide-react';
import { isLocalCase, isSampleCase, loadInbox, reopenCase, resolveCase, useInbox, useInboxMeta } from './inboxStore';
import { loadPhotoCases, usePhotoCases } from './photoCases';
import { PhotoCaseDetail } from './PhotoCaseDetail';
import { areaLabelName } from '../trust/labels';
import { caseStatus, meterView, type CaseStatus } from '../trust/gate';
import { areaCache, photoImageUrl, useAreaStats } from '../../lib/api/trust';
import { SampleBadge } from '../../components/ui/Badges';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate, fmtNum, humanize, pickText } from '../../lib/format';
import { cx } from '../../lib/cx';
import type { InboxItem, PhotoCase } from '../../lib/api/types';

type Filter = 'open' | 'resolved' | 'all';

const KNOWN_CODES = ['low_confidence', 'out_of_distribution', 'missing_source', 'validator_blocked', 'conflicting_rules', 'data_unavailable', 'farmer_requested', 'no_matching_rule', 'rule_recalled', 'data_stale'];
/** A reason code the UI has no word for is shown humanised, never as a missing key. */
const codeLabel = (code: string, t: (k: Key) => string) => (KNOWN_CODES.includes(code) ? t(`officer.code.${code}` as Key) : humanize(code));

/** `details` is free-form: show strings and numbers as they are and nested values as compact JSON. */
const detailValue = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));

/** One line of the list: an inbox item (an abstention, a question) or a photo case from the server's photo check. */
type Row = { kind: 'inbox'; id: string; created: string; status: CaseStatus; item: InboxItem } | { kind: 'photo'; id: string; created: string; status: CaseStatus; c: PhotoCase };

export default function OfficerPage() {
  const { t } = useI18n();
  const { id } = useParams();
  const items = useInbox();
  const photo = usePhotoCases();
  const { live } = useInboxMeta();
  const [filter, setFilter] = useState<Filter>('open');
  const nav = useNavigate();

  useEffect(() => {
    void loadInbox();
    void loadPhotoCases();
  }, []);

  const rows = useMemo<Row[]>(
    () =>
      [
        ...items.map((item): Row => ({ kind: 'inbox', id: item.item_id, created: item.created_at, status: item.status, item })),
        ...photo.cases.map((c): Row => ({ kind: 'photo', id: c.case_id, created: c.created_at, status: caseStatus(c), c })),
      ].sort((a, b) => b.created.localeCompare(a.created)),
    [items, photo.cases],
  );
  const counts = useMemo(() => ({ open: rows.filter((r) => r.status === 'open').length, resolved: rows.filter((r) => r.status === 'resolved').length, all: rows.length }), [rows]);
  const shown = rows.filter((r) => filter === 'all' || r.status === filter);
  const selectedRow = id ? (rows.find((r) => r.id === id) ?? null) : null;
  const photoPending = !!id && id.startsWith('pc-') && !selectedRow && (photo.load === 'idle' || photo.load === 'loading');

  // a case that is not in the current filter (e.g. just resolved) keeps its filter so it does not vanish under the officer
  useEffect(() => {
    if (selectedRow && filter !== 'all' && selectedRow.status !== filter) setFilter(selectedRow.status === 'auto' ? 'all' : selectedRow.status);
  }, [selectedRow, filter]);

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-6 pb-8 sm:px-6 sm:pt-10">
      <header className="mb-6">
        <p className="eyebrow">KrishiLoop · {t('nav.officer')}</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-h1 font-medium tracking-tight">{t('officer.title')}</h1>
          {live ? (
            <span className="chip" data-tone="sun" data-testid="officer-demo-badge">
              <FlaskConical size={12} aria-hidden /> {t('officer.demoBadge')}
            </span>
          ) : (
            <SampleBadge label={t('common.sample')} />
          )}
        </div>
        <p className="mt-3 max-w-[60ch] text-lg text-chrome">{t('officer.lead')}</p>
        <p className="mt-2 max-w-[70ch] text-sm text-dim">{live ? t('officer.demo') : t('officer.sample')}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link to="/trust" className="btn btn-ghost btn-sm" data-testid="officer-trust-link">
            <ChartLine size={15} aria-hidden /> {t('officer.trust.link')}
          </Link>
          <AreaStrip areas={[...new Set(photo.cases.map((c) => c.area))]} />
        </div>
      </header>

      <div className="officer" data-has-detail={!!id}>
        <section className="officer-list" aria-label={t('nav.officer')}>
          <div className="seg mb-4 w-full" role="group" aria-label={t('officer.title')}>
            {(['open', 'resolved', 'all'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className="flex-1" data-testid={`filter-${f}`}>
                {t(`officer.${f}` as Key)} <span className="tabular opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>
          {photo.load === 'unavailable' ? (
            <p className="pcd-demo mb-3" data-testid="photo-cases-unavailable">
              <Leaf size={15} aria-hidden /> {t('officer.pc.unavailable')}
            </p>
          ) : null}
          {shown.length === 0 ? (
            <div className="officer-empty surface">
              <Inbox size={26} strokeWidth={1.4} aria-hidden />
              <p className="m-0">{filter === 'open' ? t('officer.emptyOpen') : t('officer.empty')}</p>
              {photo.load === 'ready' && photo.cases.length === 0 ? <p className="m-0 text-sm text-dim">{t('officer.pc.none')}</p> : null}
            </div>
          ) : (
            <ul className="m-0 grid list-none gap-2 p-0" data-testid="case-list">
              {shown.map((r) => (
                <li key={r.id}>{r.kind === 'photo' ? <PhotoCaseRow c={r.c} active={r.id === id} /> : <CaseRow item={r.item} active={r.id === id} />}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="officer-detail" aria-live="polite">
          {id ? (
            selectedRow ? (
              selectedRow.kind === 'photo' ? (
                <PhotoCaseDetail key={selectedRow.id} c={selectedRow.c} onBack={() => nav('/officer')} />
              ) : (
                <CaseDetail key={selectedRow.id} item={selectedRow.item} onBack={() => nav('/officer')} />
              )
            ) : photoPending ? (
              <div className="officer-empty surface" aria-busy="true">
                <div className="skeleton h-6 w-1/2" />
                <div className="skeleton h-40 w-full" />
              </div>
            ) : (
              <div className="officer-empty surface">
                <Inbox size={26} strokeWidth={1.4} aria-hidden />
                <p className="m-0 max-w-[40ch]">{t('officer.notFound', { id })}</p>
                <Link to="/officer" className="btn btn-ghost btn-sm">
                  <ArrowLeft size={15} aria-hidden /> {t('officer.back')}
                </Link>
              </div>
            )
          ) : (
            <div className="officer-empty officer-placeholder surface" data-testid="select-case">
              <Inbox size={30} strokeWidth={1.3} aria-hidden />
              <p className="m-0">{t('officer.select')}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Where each area's photo check stands, one chip per area, each a way into the area trust panel. */
function AreaStrip({ areas }: { areas: string[] }) {
  const { t } = useI18n();
  if (!areas.length) return null;
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-label={t('officer.trust.strip')} data-testid="area-strip">
      {areas.map((a) => (
        <AreaStripChip key={a} area={a} />
      ))}
    </ul>
  );
}

function AreaStripChip({ area }: { area: string }) {
  const { t, lang } = useI18n();
  const stats = useAreaStats(area) ?? areaCache.get().areas[area] ?? null;
  const m = meterView(stats);
  return (
    <li>
      <Link to="/trust" className="chip chip-mono" data-tone={m.gateOpen ? 'go' : undefined} data-testid="area-strip-chip">
        {m.gateOpen ? <LockOpen size={12} aria-hidden /> : <Lock size={12} aria-hidden />}
        {t('officer.trust.chip', { area, gate: m.gateOpen ? t('trust.meter.gate.open') : t('trust.meter.gate.closed'), n: fmtNum(m.verdicts, lang) })}
      </Link>
    </li>
  );
}

/** A photo case in the list: the diamond marks it as the server's photo check, not an abstention. */
function PhotoCaseRow({ c, active }: { c: PhotoCase; active: boolean }) {
  const { t, lang } = useI18n();
  const status = caseStatus(c);
  const label = c.verdict ? areaLabelName(c.verdict, t) : '';
  return (
    <Link to={`/officer/${encodeURIComponent(c.case_id)}`} className={cx('case-row', active && 'is-active')} aria-current={active ? 'true' : undefined} data-testid="case-row" data-kind="photo">
      {c.photo_available && photoImageUrl(c.case_id) ? <img className="case-thumb" src={photoImageUrl(c.case_id)!} alt="" loading="lazy" decoding="async" width={48} height={48} /> : <span className="case-dot" data-status={status === 'open' ? 'open' : 'resolved'} aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">
            {t('officer.pc.kind')} · {c.area}
          </span>
          <span className="flex-none text-xs text-dim tabular">{fmtDate(c.created_at, lang, 'short')}</span>
        </span>
        <span className="mt-0.5 block truncate text-sm text-chrome">{status === 'open' ? t('officer.pc.open') : status === 'resolved' ? t('officer.pc.resolved', { label }) : t('officer.pc.auto')}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-dim">
          <span className="mono">{c.field_id}</span>
          {c.photo_available ? (
            <span className="inline-flex items-center gap-1">
              <Camera size={12} aria-hidden /> {t('officer.photo')}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

function CaseRow({ item, active }: { item: InboxItem; active: boolean }) {
  const { t, lang } = useI18n();
  return (
    <Link to={`/officer/${encodeURIComponent(item.item_id)}`} className={cx('case-row', active && 'is-active')} aria-current={active ? 'true' : undefined} data-testid="case-row">
      <span className="case-dot" data-status={item.status} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{item.farmer_display_name}</span>
          <span className="flex-none text-xs text-dim tabular">{fmtDate(item.created_at, lang, 'short')}</span>
        </span>
        <span className="mt-0.5 block truncate text-sm text-chrome">{codeLabel(item.reason_code, t)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-dim">
          <span className="mono">{item.field_id}</span>
          {item.photo_attached ? (
            <span className="inline-flex items-center gap-1">
              <Camera size={12} aria-hidden /> {t('officer.photo')}
            </span>
          ) : null}
          {item.question ? (
            <span className="inline-flex items-center gap-1">
              <MessageCircleQuestion size={12} aria-hidden /> ?
            </span>
          ) : null}
          <span className="sr-only">{item.status === 'open' ? t('officer.open') : t('officer.resolved')}</span>
        </span>
      </span>
    </Link>
  );
}

function CaseDetail({ item, onBack }: { item: InboxItem; onBack: () => void }) {
  const { t, lang } = useI18n();
  const reason = pickText(item.reason, lang);
  const [note, setNote] = useState(item.resolution_note ?? '');
  const sample = isSampleCase(item.item_id);
  const local = isLocalCase(item.item_id);
  const { live } = useInboxMeta();
  const details = Object.entries(item.details ?? {});
  return (
    <article className="surface surface-pad" aria-labelledby="case-t" data-testid="case-detail">
      <button type="button" className="btn btn-quiet btn-sm mb-4 lg:hidden" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden /> {t('officer.back')}
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{t('abstain.case')}</p>
          <h2 id="case-t" className="mono mt-1 !text-lg font-semibold">
            {item.item_id}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip" data-tone={item.status === 'open' ? 'wait' : 'go'}>
            <CircleDot size={12} aria-hidden /> {item.status === 'open' ? t('officer.open') : t('officer.resolved')}
          </span>
          {sample ? <SampleBadge /> : null}
          {local ? <span className="chip chip-sample">{t('officer.localOnly')}</span> : null}
        </div>
      </div>

      <dl className="case-meta">
        <div>
          <dt>{t('officer.farmer')}</dt>
          <dd>{item.farmer_display_name}</dd>
        </div>
        <div>
          <dt>{t('officer.field')}</dt>
          <dd className="mono">{item.field_id}</dd>
        </div>
        <div>
          <dt>{t('officer.receivedLabel')}</dt>
          <dd>{fmtDate(item.created_at, lang, 'datetime')}</dd>
        </div>
        {item.diagnosis_id ? (
          <div>
            <dt>{t('officer.diagnosisId')}</dt>
            <dd className="mono break-all">{item.diagnosis_id}</dd>
          </div>
        ) : null}
      </dl>

      <section className="case-block">
        <h3 className="eyebrow">{t('officer.reason')}</h3>
        <p className="m-0 mt-2" lang={reason.lang}>
          <span className="chip mr-2" data-tone="sun">
            {codeLabel(item.reason_code, t)}
          </span>
          {reason.text}
        </p>
      </section>

      {details.length ? (
        <section className="case-block" data-testid="case-details">
          <h3 className="eyebrow">{t('officer.details')}</h3>
          <dl className="case-details">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt>{humanize(k)}</dt>
                <dd className="mono">{detailValue(v)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="case-block">
        <h3 className="eyebrow">{t('officer.labels')}</h3>
        {item.top_labels?.length ? (
          <ul className="case-bars">
            {item.top_labels.map((l) => (
              <li key={l.label}>
                <span className="case-bar-label">{humanize(l.label)}</span>
                <span className="case-bar" role="img" aria-label={`${humanize(l.label)} ${Math.round(l.prob * 100)}%`}>
                  <span style={{ ['--p' as string]: l.prob }} />
                </span>
                <span className="tabular text-sm">{fmtNum(Math.round(l.prob * 100), lang)}%</span>
              </li>
            ))}
            <li className="text-xs text-dim">{t('officer.confidence')}</li>
          </ul>
        ) : (
          <p className="m-0 mt-2 text-chrome">{t('officer.noLabels')}</p>
        )}
      </section>

      {item.question ? (
        <section className="case-block">
          <h3 className="eyebrow">{t('officer.question')}</h3>
          <blockquote className="case-quote">“{item.question}”</blockquote>
        </section>
      ) : null}

      <section className="case-block">
        <h3 className="eyebrow">{t('officer.photo')}</h3>
        <div className="case-photo" data-attached={item.photo_attached}>
          <Camera size={22} strokeWidth={1.4} aria-hidden />
          <span>{item.photo_attached ? t('officer.photoYes') : t('officer.photoNo')}</span>
        </div>
        <p className="m-0 mt-2 flex items-center gap-1.5 text-xs text-dim">
          <ShieldCheck size={13} aria-hidden /> {t('officer.consentNote')}
        </p>
      </section>

      <section className="case-block">
        {item.status === 'open' ? (
          <>
            <label className="field-label" htmlFor="case-note">
              {t('officer.note')}
            </label>
            <textarea id="case-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('officer.notePlaceholder')} />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-primary" onClick={() => resolveCase(item.item_id, note.trim())} data-testid="resolve-btn">
                <CheckCheck size={16} aria-hidden /> {t('officer.resolve')}
              </button>
              <span className="text-xs text-dim">{live ? t('officer.savedDemo') : t('officer.savedSample')}</span>
            </div>
          </>
        ) : (
          <>
            <h3 className="eyebrow">{t('officer.note')}</h3>
            <p className="m-0 mt-2">{item.resolution_note || '—'}</p>
            <p className="m-0 mt-2 text-sm text-dim">
              {t('officer.resolvedBy', { who: item.resolved_by ?? '—' })}
              {item.resolved_at ? ` · ${fmtDate(item.resolved_at, lang, 'datetime')}` : ''}
            </p>
            <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => reopenCase(item.item_id)}>
              <Undo2 size={15} aria-hidden /> {t('officer.reopen')}
            </button>
          </>
        )}
      </section>
    </article>
  );
}
