import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronDown, CircleCheck, CircleDot, CircleX, FlaskConical, ImageOff, Lock } from 'lucide-react';
import { judge, usePhotoCases } from './photoCases';
import { AreaMeter } from '../trust/AreaMeter';
import { GateMoment } from '../trust/GateMoment';
import { areaLabelName } from '../trust/labels';
import { caseStatus, evidenceDelta, otherLabels, reviewVerdict } from '../trust/gate';
import { useI18n } from '../../lib/i18n';
import { fmtDate, fmtNum } from '../../lib/format';
import { knownCredential, photoImageUrl, useAreaStats, type PhotoErrorKind } from '../../lib/api/trust';
import type { PhotoCase } from '../../lib/api/types';

/**
 * One photo case for the officer (in the demo, the visitor plays the officer, and the page says so).
 *
 *   open      the photo (only if the farmer agreed), the model's two best guesses as two big one-tap buttons, and "something
 *             else" for the other labels. The guesses were saved before this screen, so the tap is an honest test of them.
 *   resolved  was the suggestion right (recorded before the answer), did it count toward the gate, and the area's evidence
 *             moving. If the answer opened or closed the gate: the moment, with a link to verify the credential.
 *   auto      the gate was open and the suggestion sure: nothing for the officer to do.
 */
export function PhotoCaseDetail({ c, onBack }: { c: PhotoCase; onBack: () => void }) {
  const { t, lang } = useI18n();
  const { cases, outcomes } = usePhotoCases();
  const stats = useAreaStats(c.area);
  const status = caseStatus(c);
  const outcome = outcomes[c.case_id] ?? null;
  const review = reviewVerdict(c);
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<PhotoErrorKind | null>(null);
  const [photoBroken, setPhotoBroken] = useState(false);
  const reviewRef = useRef<HTMLDivElement>(null);
  const pct = (p: number) => `${fmtNum(Math.round(p * 100), lang)}%`;
  const label = (l: string) => areaLabelName(l, t);

  // a fresh verdict: bring the keyboard and the screen reader to what it did
  useEffect(() => {
    if (outcome) reviewRef.current?.focus({ preventScroll: false });
  }, [outcome]);

  const answer = async (l: string) => {
    setSaving(l);
    setError(null);
    const r = await judge(c.case_id, l);
    setSaving(null);
    if (!r.ok) setError(r.error);
  };

  const delta = outcome ? evidenceDelta(outcome.before, outcome.after) : null;
  const next = cases.find((x) => x.case_id !== c.case_id && caseStatus(x) === 'open');
  const imgSrc = c.photo_available && !photoBroken ? photoImageUrl(c.case_id) : null;
  const two = (n: number) => fmtNum(n, lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const credential = stats?.trust_credential_id ?? knownCredential(c.area);

  const photoNote = status === 'auto' ? t('officer.pc.autoNoPhoto') : status === 'resolved' ? (c.consent ? t('officer.pc.deleted') : t('officer.pc.noConsent')) : !c.consent ? t('officer.pc.noConsent') : t('officer.pc.noPhoto');

  return (
    <article className="surface surface-pad" aria-labelledby="pc-t" data-testid="photo-case-detail" data-status={status}>
      <button type="button" className="btn btn-quiet btn-sm mb-4 lg:hidden" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden /> {t('officer.back')}
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">
            {t('officer.pc.kind')} · {c.area}
          </p>
          <h2 id="pc-t" className="mono mt-1 !text-lg font-semibold">
            {c.case_id}
          </h2>
        </div>
        <div className="pcd-badges">
          <span className="chip" data-tone={status === 'open' ? 'wait' : status === 'resolved' ? 'go' : undefined} data-testid="pc-status">
            <CircleDot size={12} aria-hidden /> {status === 'open' ? t('officer.open') : status === 'resolved' ? t('officer.resolved') : t('officer.pc.auto')}
          </span>
          <span className="chip" data-tone="sun" data-testid="officer-role">
            <FlaskConical size={12} aria-hidden /> {t('officer.pc.demoRole')}
          </span>
        </div>
      </div>
      {status !== 'resolved' ? (
        <p className="pcd-demo" data-testid="pc-demo-note">
          <FlaskConical size={15} aria-hidden /> {t('officer.pc.demoNote')}
        </p>
      ) : null}

      {/* the photo (once the case is answered the photo is gone, and the answer comes first) */}
      {status !== 'resolved' ? (
        <section className="case-block" data-testid="pc-photo">
          <h3 className="eyebrow">{t('officer.pc.photo')}</h3>
          {imgSrc ? (
            <div className="pcd-photo">
              <img src={imgSrc} alt={t('officer.pc.photoAlt', { id: c.case_id })} onError={() => setPhotoBroken(true)} data-testid="pc-photo-img" />
            </div>
          ) : (
            <div className="pcd-photo-empty" data-testid="pc-photo-empty">
              {c.consent ? <ImageOff size={22} strokeWidth={1.4} aria-hidden /> : <Lock size={22} strokeWidth={1.4} aria-hidden />}
              <span>{photoNote}</span>
            </div>
          )}
        </section>
      ) : null}

      {/* waiting for the officer: the two best guesses as two big taps */}
      {status === 'open' ? (
        <section className="case-block" data-testid="pc-suggestion">
          <h3 className="eyebrow">{t('officer.pc.suggestion')}</h3>
          <p className="pcd-frozen">
            <Lock size={14} aria-hidden /> {t('officer.pc.frozen')}
          </p>
          <p className="pcd-pick">{t('officer.pc.pick')}</p>
          <div className="pcd-choices" role="group" aria-label={t('officer.pc.pick')}>
            {c.suggestion.slice(0, 2).map((s, i) => (
              <button key={s.label} type="button" className="pcd-btn" data-rank={i} disabled={!!saving} onClick={() => void answer(s.label)} data-testid={`pc-choice-${s.label}`}>
                <strong>{label(s.label)}</strong>
                <small>
                  <span className="tabular">{pct(s.prob)}</span>
                  {i === 0 ? <span>{c.sure ? t('officer.pc.sure') : t('officer.pc.unsure')}</span> : null}
                </small>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm pcd-else" aria-expanded={more} onClick={() => setMore((v) => !v)} disabled={!!saving} data-testid="pc-else">
            <ChevronDown size={15} aria-hidden style={{ transform: more ? 'rotate(180deg)' : undefined, transition: 'transform 200ms var(--ease-out)' }} /> {more ? t('officer.pc.elseHide') : t('officer.pc.else')}
          </button>
          {more ? (
            <>
              <div className="pcd-others" data-testid="pc-others">
                {otherLabels(c).map((l) => (
                  <button key={l} type="button" className="pcd-btn" data-size="sm" disabled={!!saving} onClick={() => void answer(l)} data-testid={`pc-choice-${l}`}>
                    <strong>{label(l)}</strong>
                  </button>
                ))}
              </div>
              <p className="pcd-hint">{t('officer.pc.elseHint')}</p>
            </>
          ) : null}
          {saving ? (
            <p className="photo-busy" role="status" data-testid="pc-saving">
              <span className="spinner" aria-hidden /> {t('officer.pc.saving')}
            </p>
          ) : null}
          {error ? (
            <p className="pcd-error" role="alert" data-testid="pc-error">
              {error === 'judged' ? t('officer.pc.judged') : t('officer.pc.error')}
            </p>
          ) : null}
        </section>
      ) : null}

      {status === 'auto' ? (
        <p className="pcd-demo" data-testid="pc-auto-note">
          <CircleCheck size={15} aria-hidden /> {t('officer.pc.autoNote')}
        </p>
      ) : null}

      {/* answered: was the suggestion right, and what moved */}
      {status === 'resolved' && review ? (
        <section className="pcd-review" aria-label={t('officer.pc.review.title', { label: label(review.chosen) })} data-testid="pc-review">
          <div ref={reviewRef} tabIndex={-1} className="pcd-verdict outline-none" data-right={review.right} data-testid="pc-verdict">
            {review.right ? <CircleCheck size={22} aria-hidden /> : <CircleX size={22} aria-hidden />}
            <div>
              <p className="eyebrow">{t('officer.pc.review.title', { label: label(review.chosen) })}</p>
              <p className="pcd-verdict-title" data-testid="pc-review-result">
                {review.right ? t('officer.pc.review.right') : review.rank === 1 ? t('officer.pc.review.second') : t('officer.pc.review.wrong')}
              </p>
              <p className="pcd-verdict-sub">{t('officer.pc.review.said', { label: label(review.suggested), pct: pct(review.suggestedProb) })}</p>
              <p className="pcd-verdict-sub" data-testid="pc-review-counts">
                {review.countsTowardGate ? t('officer.pc.review.counts') : t('officer.pc.review.notCounts')}
              </p>
            </div>
          </div>

          {outcome?.event ? <GateMoment event={outcome.event} area={c.area} credentialId={outcome.event.event === 'opened' ? (outcome.after.trust_credential_id ?? credential) : (knownCredential(c.area) ?? credential)} /> : null}

          {delta ? (
            <dl className="pcd-moves" aria-label={t('officer.pc.evidence.moved')} data-testid="pc-moves">
              <Move label={t('trust.meter.verdicts')} was={delta.before ? fmtNum(delta.before.verdicts, lang) : null} now={fmtNum(delta.after.verdicts, lang)} />
              <Move label={t('trust.meter.sure')} was={delta.before ? fmtNum(delta.before.sure, lang) : null} now={fmtNum(delta.after.sure, lang)} />
              <Move label={t('trust.meter.bound')} was={delta.before ? two(delta.before.lowerBound) : null} now={two(delta.after.lowerBound)} />
            </dl>
          ) : null}

          <p className="pcd-photo-note" data-testid="pc-photo-empty">
            {c.consent ? <ImageOff size={15} aria-hidden /> : <Lock size={15} aria-hidden />}
            {photoNote}
          </p>

          <div className="pcd-next">
            {next ? (
              <Link to={`/officer/${encodeURIComponent(next.case_id)}`} className="btn btn-primary btn-sm" data-testid="pc-next">
                {t('officer.pc.next')} <ArrowRight size={15} aria-hidden />
              </Link>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
                <ArrowLeft size={15} aria-hidden /> {t('officer.pc.backToList')}
              </button>
            )}
            <Link to="/trust" className="btn btn-quiet btn-sm">
              {t('officer.trust.link')}
            </Link>
          </div>
        </section>
      ) : null}

      {/* the area's evidence: what a verdict moves */}
      <section className="case-block" data-testid="pc-evidence">
        <h3 className="eyebrow">{t('officer.pc.evidence', { area: c.area })}</h3>
        <div className="mt-3">
          <AreaMeter area={c.area} stats={stats} />
        </div>
      </section>

      <dl className="case-meta">
        <div>
          <dt>{t('officer.pc.model')}</dt>
          <dd className="mono break-all">{c.model}</dd>
        </div>
        <div>
          <dt>{t('officer.pc.field')}</dt>
          <dd className="mono">{c.field_id}</dd>
        </div>
        <div>
          <dt>{t('officer.pc.received')}</dt>
          <dd>{fmtDate(c.created_at, lang, 'datetime')}</dd>
        </div>
      </dl>
    </article>
  );
}

function Move({ label, was, now }: { label: string; was: string | null; now: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="tabular">
        {was !== null && was !== now ? (
          <>
            <span className="pcd-was">{was}</span>
            <ArrowRight size={14} aria-hidden />
          </>
        ) : null}
        <span>{now}</span>
      </dd>
    </div>
  );
}
