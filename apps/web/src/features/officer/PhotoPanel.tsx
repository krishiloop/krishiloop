import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Camera, ChevronDown, CircleCheck, CircleX, ImageOff, Leaf } from 'lucide-react';
import type { PhotoCase } from '../../lib/api/types';
import { useApiState } from '../../lib/api/client';
import { photoImageUrl, useAreaStats, type PhotoErrorKind } from '../../lib/api/trust';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtDate, humanize } from '../../lib/format';
import { cx } from '../../lib/cx';
import { Sheet } from '../../ui/Sheet';
import { Button, LinkButton } from '../../ui/Button';
import { caseStatus, newestFirst, otherLabels, reviewVerdict } from '../trust/gate';
import { POLICY_V1 } from '../trust/policy';
import { judge, usePhotoCases } from './photoCases';
import { AreaGauge } from './AreaGauge';
import { useMedia, WIDE } from './useMedia';

/** The labels the server's photo model chooses between (its `core` list). A label not here is shown humanised. */
const LABELS = ['healthy', 'blast', 'brown_spot', 'tungro', 'sheath_blight'] as const;
const LABEL_KEY: Record<(typeof LABELS)[number], Key> = {
  healthy: 'off.label.healthy',
  blast: 'off.label.blast',
  brown_spot: 'off.label.brown_spot',
  tungro: 'off.label.tungro',
  sheath_blight: 'off.label.sheath_blight',
};
export function labelName(label: string, t: (k: Key) => string): string {
  return (LABELS as readonly string[]).includes(label) ? t(LABEL_KEY[label as (typeof LABELS)[number]]) : humanize(label);
}
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Photo cases from the server's photo check, as a grid, with the case beside it (a sheet on phones). */
export function PhotoPanel({ selectedId, onSelect, onClose }: { selectedId: string | null; onSelect: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const api = useApiState();
  const photo = usePhotoCases();
  const wide = useMedia(WIDE);
  const cases = newestFirst(photo.cases);
  const autoId = wide && !selectedId ? ((cases.find((c) => caseStatus(c) === 'open') ?? cases[0])?.case_id ?? null) : null;
  const activeId = selectedId ?? autoId;
  const selected = activeId ? (cases.find((c) => c.case_id === activeId) ?? null) : null;
  const recorded = api.forced || api.mode === 'sample';

  if (recorded) {
    return (
      <Empty icon={<Leaf size={28} strokeWidth={1.5} aria-hidden />} title={t('off.photo.recordedTitle')} body={t('off.photo.recorded')} testId="photo-recorded">
        <LinkButton to="/trust" variant="secondary" size="sm" arrow>
          {t('off.photo.toTrust')}
        </LinkButton>
      </Empty>
    );
  }
  if (photo.load === 'idle' || (photo.load === 'loading' && !cases.length)) {
    return (
      <div className="off-grid" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton aspect-[4/5]" />
        ))}
      </div>
    );
  }
  if (photo.load === 'unavailable') return <Empty icon={<ImageOff size={28} strokeWidth={1.5} aria-hidden />} title={t('off.photo.unavailableTitle')} body={t('off.photo.unavailable')} testId="photo-cases-unavailable" />;
  if (photo.load === 'offline') return <Empty icon={<ImageOff size={28} strokeWidth={1.5} aria-hidden />} title={t('off.photo.offlineTitle')} body={t('off.photo.offline')} testId="photo-offline" />;
  if (!cases.length) {
    return (
      <Empty icon={<Camera size={28} strokeWidth={1.5} aria-hidden />} title={t('off.photo.emptyTitle')} body={t('off.photo.empty')} testId="photo-empty">
        <LinkButton to="/app?field=BD-SAMPLE-02&profile=demo-farmer-d" variant="secondary" size="sm" arrow>
          {t('off.photo.toApp')}
        </LinkButton>
      </Empty>
    );
  }

  const open = cases.filter((c) => caseStatus(c) === 'open');
  return (
    <div className="off-split off-split-photo">
      <section aria-labelledby="off-photo-h">
        <h2 id="off-photo-h" className="sr-only-live">
          {t('off.tab.photos')}
        </h2>
        <p className="m-0 text-sm text-ink-3">{t('off.photo.lead')}</p>
        <ul className="off-grid mt-4" data-testid="photo-grid">
          {cases.map((c, i) => (
            <li key={c.case_id} className="off-in" style={{ ['--i' as string]: Math.min(i, 8) }}>
              <PhotoCard c={c} active={c.case_id === activeId} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      </section>
      {wide ? (
        <section className="off-detail" aria-label={t('off.photo.detail')}>
          {selected ? (
            <PhotoDetail
              key={selected.case_id}
              c={selected}
              next={open.find((c) => c.case_id !== selected.case_id) ?? null}
              onSelect={onSelect}
              onPin={selectedId === selected.case_id ? undefined : () => onSelect(selected.case_id)}
              withTitle
            />
          ) : (
            <div className="off-placeholder" data-testid="select-photo">
              <Camera size={22} strokeWidth={1.6} aria-hidden />
              <p className="m-0">{t('off.photo.pick')}</p>
            </div>
          )}
        </section>
      ) : (
        <Sheet open={!!selected} onClose={onClose} title={selected ? t('off.photo.caseTitle', { area: selected.area }) : ''} subtitle={selected ? <span className="mono">{selected.case_id}</span> : undefined}>
          {selected && <PhotoDetail key={selected.case_id} c={selected} next={open.find((c) => c.case_id !== selected.case_id) ?? null} onSelect={onSelect} />}
        </Sheet>
      )}
    </div>
  );
}

function Empty({ icon, title, body, children, testId }: { icon: ReactNode; title: string; body: string; children?: ReactNode; testId?: string }) {
  return (
    <div className="off-empty" data-testid={testId}>
      {icon}
      <p className="m-0 font-medium text-ink">{title}</p>
      <p className="m-0 max-w-[48ch] text-sm text-ink-3">{body}</p>
      {children}
    </div>
  );
}

function PhotoCard({ c, active, onSelect }: { c: PhotoCase; active: boolean; onSelect: (id: string) => void }) {
  const { t, lang } = useI18n();
  const status = caseStatus(c);
  const src = c.photo_available ? photoImageUrl(c.case_id) : null;
  const top = c.suggestion[0];
  return (
    <Link
      to={`/officer/${encodeURIComponent(c.case_id)}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onSelect(c.case_id);
      }}
      className={cx('off-photo', active && 'is-active')}
      aria-current={active ? 'true' : undefined}
      data-testid="photo-card"
      data-status={status}
    >
      <span className="off-photo-img">
        {src ? <img src={src} alt="" loading="lazy" decoding="async" width={320} height={320} /> : <ImageOff size={26} strokeWidth={1.5} aria-hidden />}
      </span>
      <span className="grid gap-1 p-3">
        <span className="flex items-center justify-between gap-2">
          <span className={cx('off-status', status === 'open' ? 'is-open' : status === 'auto' ? 'is-auto' : 'is-done')}>{t(`off.photo.status.${status}`)}</span>
          <span className="mono text-xs text-ink-3">{fmtDate(c.created_at, lang, 'short')}</span>
        </span>
        <span className="truncate text-sm font-semibold text-ink">{c.verdict ? labelName(c.verdict, t) : top ? t('off.photo.guess', { label: labelName(top.label, t), p: pct(top.prob) }) : '—'}</span>
        <span className="mono truncate text-xs text-ink-3">
          {c.area} · {c.field_id}
        </span>
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ one photo case: the frozen top-2 as one-tap verdicts */
const ERR: Record<PhotoErrorKind, Key> = {
  unavailable: 'off.photo.err.unavailable',
  unreadable: 'off.photo.err.other',
  rate: 'off.photo.err.rate',
  judged: 'off.photo.err.judged',
  offline: 'off.photo.err.offline',
  other: 'off.photo.err.other',
};

export function PhotoDetail({ c, next, onSelect, onPin, withTitle }: { c: PhotoCase; next: PhotoCase | null; onSelect: (id: string) => void; onPin?: () => void; withTitle?: boolean }) {
  const { t } = useI18n();
  const photo = usePhotoCases();
  const outcome = photo.outcomes[c.case_id] ?? null;
  const stats = useAreaStats(c.area);
  const status = caseStatus(c);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<PhotoErrorKind | null>(null);
  const [more, setMore] = useState(false);
  const result = useRef<HTMLDivElement>(null);
  const review = reviewVerdict(c);
  const src = c.photo_available ? photoImageUrl(c.case_id) : null;
  const top2 = c.suggestion.slice(0, 2);
  const others = otherLabels(c, LABELS);

  useEffect(() => {
    if (outcome) result.current?.focus({ preventScroll: false });
  }, [outcome]);

  const pick = async (label: string) => {
    onPin?.(); // the case opened by itself beside the grid: keep it open while its verdict lands
    setBusy(label);
    setError(null);
    const r = await judge(c.case_id, label);
    setBusy(null);
    if (!r.ok) setError(r.error);
  };

  return (
    <article className="off-case" data-testid="photo-detail" aria-labelledby={withTitle ? `off-pc-${c.case_id}` : undefined}>
      {withTitle && (
        <header>
          <p className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={cx('off-status', status === 'open' ? 'is-open' : status === 'auto' ? 'is-auto' : 'is-done')} data-testid="pc-status">
              {t(`off.photo.status.${status}`)}
            </span>
            <span className="mono normal-case tracking-normal">{c.case_id}</span>
          </p>
          <h3 id={`off-pc-${c.case_id}`} className="off-case-title">
            {t('off.photo.caseTitle', { area: c.area })}
          </h3>
        </header>
      )}
      <p className="m-0 mt-2 text-sm text-ink-3">{t('off.photo.youPlay')}</p>

      <div className={cx('off-pc-img mt-4', !src && 'is-empty')}>
        {src ? (
          <img src={src} alt={t('off.photo.alt', { field: c.field_id })} data-testid="pc-photo-img" />
        ) : (
          <span className="flex items-center gap-3 px-4 py-3.5 text-sm text-ink-3" data-testid="pc-photo-empty">
            <ImageOff size={22} strokeWidth={1.5} aria-hidden className="flex-none" />
            {!c.consent ? t('off.photo.noConsent') : t('off.photo.deleted')}
          </span>
        )}
      </div>

      {status === 'open' && !outcome ? (
        <section className="off-block" aria-labelledby={`off-pc-q-${c.case_id}`}>
          <h4 id={`off-pc-q-${c.case_id}`} className="eyebrow">
            {t('off.photo.frozen')}
          </h4>
          <div className="off-verdicts mt-3">
            {top2.map((s, i) => (
              <button key={s.label} type="button" className="off-verdict" disabled={!!busy} onClick={() => void pick(s.label)} data-testid={`pc-choice-${s.label}`}>
                <span className="text-[1.05rem] font-semibold text-ink">{labelName(s.label, t)}</span>
                <span className="mono text-sm text-ink-2">
                  {pct(s.prob)}
                  {i === 0 && <span className="text-ink-3"> · {c.sure ? t('off.photo.sure', { bar: pct(POLICY_V1.sure) }) : t('off.photo.notSure')}</span>}
                </span>
                {busy === s.label && <span className="sr-only-live">{t('ui.loading')}</span>}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm mt-2 -ml-2" aria-expanded={more} onClick={() => setMore((v) => !v)} data-testid="pc-else">
            <ChevronDown size={16} aria-hidden className={cx('transition-transform duration-200', more && 'rotate-180')} />
            {t('off.photo.else')}
          </button>
          {more && (
            <div className="mt-2 flex flex-wrap gap-2" data-testid="pc-others">
              {others.map((l) => (
                <Button key={l} size="sm" variant="secondary" disabled={!!busy} onClick={() => void pick(l)} data-testid={`pc-choice-${l}`}>
                  {labelName(l, t)}
                </Button>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="m-0 mt-3 text-sm text-stop">
              {t(ERR[error])}
            </p>
          )}
          <p className="m-0 mt-3 text-xs text-ink-3">{t('off.photo.frozenNote')}</p>
        </section>
      ) : status === 'auto' && !c.verdict ? (
        <p className="off-block m-0 text-ink-2">{t('off.photo.autoNote')}</p>
      ) : null}

      {review && (
        <div ref={result} tabIndex={-1} className="off-block off-review" data-testid="pc-review" data-right={review.right}>
          <p className="m-0 flex items-center gap-2 font-semibold" data-testid="pc-review-result">
            {review.right ? <CircleCheck size={18} aria-hidden className="text-go" /> : <CircleX size={18} aria-hidden className="text-stop" />}
            {review.right ? t('off.review.right') : review.rank === 1 ? t('off.review.second') : t('off.review.wrong')}
          </p>
          <p className="m-0 mt-1 text-sm text-ink-2">
            {t('off.review.chosen', { label: labelName(review.chosen, t), guess: labelName(review.suggested, t), p: pct(review.suggestedProb) })}
          </p>
          <p className="m-0 mt-1 text-sm text-ink-3" data-testid="pc-review-counts">
            {review.countsTowardGate ? t('off.review.counts') : t('off.review.notCounts', { bar: pct(POLICY_V1.sure) })}
          </p>
        </div>
      )}

      {stats && (
        <section className="off-block" aria-label={t('off.photo.area', { area: c.area })}>
          <h4 className="eyebrow">{t('off.photo.area', { area: c.area })}</h4>
          <div className="mt-3">
            <AreaGauge stats={stats} before={outcome?.before ?? null} moment={outcome?.event ?? null} />
          </div>
        </section>
      )}

      {outcome && next && (
        <Button variant="primary" className="mt-6" onClick={() => onSelect(next.case_id)} data-testid="pc-next" arrow>
          {t('off.photo.next')}
        </Button>
      )}
    </article>
  );
}
