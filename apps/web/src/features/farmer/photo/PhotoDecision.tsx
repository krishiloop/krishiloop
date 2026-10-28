import { ArrowRight, CircleDashed, RotateCcw, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ActionList } from '../ActionList';
import { SampleBadge } from '../../../components/ui/Badges';
import { useI18n, type Key } from '../../../lib/i18n';
import type { Action, DataSource, DiagnosisNote } from '../../../lib/api/types';

/**
 * What the planner did with a photo reading. The SERVER decides (`diagnosis_used` / `diagnosis_note` on the plan):
 *  - cited:     used, and a receipt names the on-device diagnosis -> show that receipted decision
 *  - used:      passed the gate, but no rule uses a photo reading yet -> the plan did not change because of it
 *  - not-used:  the gate said no (uncalibrated, low confidence, unfamiliar photo, model abstained): the case went to the officer
 *  - unknown:   the answer did not say either way (older server) -> never imply the photo mattered
 *  - offline:   sample data is on or the service was unreachable, so nothing was used
 *  - sample:    a sample diagnosis never goes to the planner
 *  - failed:    the call itself failed -> retry
 */
export type DecisionState =
  | { state: 'idle' }
  | { state: 'planning' }
  | { state: 'cited'; actions: Action[]; source: DataSource }
  | { state: 'used'; source: DataSource }
  | { state: 'not-used'; note: DiagnosisNote; caseId: string | null }
  | { state: 'unknown'; source: DataSource }
  | { state: 'offline' }
  /** a SAMPLE diagnosis: nothing was sent, because a scripted result must never reach the planner */
  | { state: 'sample' }
  | { state: 'failed' };

const NOT_USED_KEY: Record<DiagnosisNote, Key> = {
  ok: 'photo.decision.notUsed.none',
  none: 'photo.decision.notUsed.none',
  uncalibrated: 'photo.decision.notUsed.uncalibrated',
  low_confidence: 'photo.decision.notUsed.low_confidence',
  out_of_distribution: 'photo.decision.notUsed.out_of_distribution',
  model_abstained: 'photo.decision.notUsed.model_abstained',
};

export function PhotoDecision({ decision, officerCase, onSend, onRetry }: { decision: DecisionState; officerCase: string | null; onSend: () => void; onRetry: () => void }) {
  const { t } = useI18n();
  if (decision.state === 'idle') return null;

  if (decision.state === 'planning') {
    return (
      <p className="photo-busy" role="status" data-testid="photo-planning">
        <span className="spinner" aria-hidden /> {t('photo.decision.planning')}
      </p>
    );
  }

  if (decision.state === 'cited') {
    return (
      <section className="photo-decision" aria-labelledby="photo-decision-t" data-testid="photo-decision" data-state="cited">
        <h3 id="photo-decision-t" className="photo-decision-h">
          {t('photo.decision.title')}
        </h3>
        <ActionList actions={decision.actions} source={decision.source} />
      </section>
    );
  }

  if (decision.state === 'sample') {
    return (
      <section className="photo-decision photo-plain" data-state="sample" data-testid="photo-decision">
        <div className="flex flex-wrap items-center gap-2">
          <SampleBadge />
          <h3 className="photo-decision-h !m-0">{t('photo.decision.sample.title')}</h3>
        </div>
        <p className="m-0 mt-2 text-sm text-chrome">{t('photo.decision.sample.body')}</p>
      </section>
    );
  }

  const officer = officerCase ? (
    <p className="m-0 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-go">{t('photo.sentShort')}</span>
      <span className="chip chip-mono" data-testid="photo-case">
        {officerCase}
      </span>
      <Link to={`/officer/${encodeURIComponent(officerCase)}`} className="link inline-flex items-center gap-1">
        {t('photo.inbox.open')} <ArrowRight size={13} aria-hidden />
      </Link>
    </p>
  ) : (
    <button type="button" className="btn btn-quiet btn-sm" onClick={onSend} data-testid="photo-send">
      <Send size={14} aria-hidden /> {t('photo.send')}
    </button>
  );

  if (decision.state === 'failed') {
    return (
      <section className="photo-decision photo-plain" data-state="failed" data-testid="photo-decision" role="alert">
        <p className="m-0">{t('photo.error.plan')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
            <RotateCcw size={15} aria-hidden /> {t('common.retry')}
          </button>
          {officer}
        </div>
      </section>
    );
  }

  if (decision.state === 'not-used') {
    const sent = decision.note !== 'none' && decision.note !== 'ok';
    return (
      <section className="photo-decision photo-plain" data-state="not-used" data-note={decision.note} data-testid="photo-decision" aria-labelledby="photo-notused-t">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip" data-status="planned">
            <CircleDashed size={12} aria-hidden /> {t('photo.decision.notUsed.chip')}
          </span>
          <h3 id="photo-notused-t" className="photo-decision-h !m-0" data-testid="photo-notused-title">
            {t(NOT_USED_KEY[decision.note])}
          </h3>
        </div>
        <p className="m-0 mt-2 text-sm text-chrome">{t('photo.decision.notUsed.body')}</p>
        {sent ? (
          <p className="m-0 mt-3 flex flex-wrap items-center gap-2 text-sm">
            <Link to={decision.caseId ? `/officer/${encodeURIComponent(decision.caseId)}` : '/officer'} className="link inline-flex items-center gap-1" data-testid="photo-open-inbox">
              {t('photo.inbox.open')} <ArrowRight size={13} aria-hidden />
            </Link>
            {decision.caseId ? (
              <span className="chip chip-mono" data-testid="photo-case">
                {decision.caseId}
              </span>
            ) : null}
          </p>
        ) : null}
      </section>
    );
  }

  const key = decision.state === 'used' ? 'used' : decision.state === 'offline' ? 'offline' : 'unknown';
  return (
    <section className="photo-decision photo-plain" data-state={decision.state} data-testid="photo-decision" aria-labelledby="photo-planned-t">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip" data-status="planned">
          <CircleDashed size={12} aria-hidden /> {t('photo.decision.planned.chip')}
        </span>
        <h3 id="photo-planned-t" className="photo-decision-h !m-0">
          {t(`photo.decision.${key}.title` as Key)}
        </h3>
      </div>
      <p className="m-0 mt-2 text-sm text-chrome">{t(`photo.decision.${key}.body` as Key)}</p>
      <div className="mt-3">{officer}</div>
    </section>
  );
}
