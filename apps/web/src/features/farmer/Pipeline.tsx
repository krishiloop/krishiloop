import { Fragment } from 'react';
import { useI18n, type Key } from '../../lib/i18n';
import { readPipeline, type StageId } from './askPath';

const LABEL: Record<StageId, Key> = {
  normalise: 'fa.pipe.normalise',
  bm25: 'fa.pipe.bm25',
  dense: 'fa.pipe.dense',
  fuse: 'fa.pipe.fuse',
  rerank: 'fa.pipe.rerank',
  match: 'fa.pipe.match',
  decide: 'fa.pipe.decide',
  render: 'fa.pipe.render',
  validate: 'fa.pipe.validate',
  receipt: 'fa.pipe.receipt',
  abstain: 'fa.pipe.abstain',
};

/**
 * "How this was answered", drawn from the Ask router's own LangGraph path: each stage that ran in ink, a skipped stage
 * greyed and struck through, and the stages an abstention never reached faded. The stages appear in order (60 ms apart),
 * which is the order they ran in.
 */
export function Pipeline({ path }: { path: string[] }) {
  const { t } = useI18n();
  const stages = readPipeline(path);
  return (
    <section aria-labelledby="fa-pipe-title" data-testid="fa-pipeline">
      <h3 id="fa-pipe-title" className="eyebrow">
        {t('fa.pipe.title')}
      </h3>
      <ol className="fa-pipe">
        {stages.map((s, i) => {
          const label = s.unknown ? String(s.id) : t(LABEL[s.id as StageId]);
          return (
            <Fragment key={`${s.id}-${i}`}>
              {i > 0 && (
                <li className="fa-pipe-arrow" aria-hidden style={{ ['--i' as string]: i }}>
                  →
                </li>
              )}
              <li className="fa-pipe-stage" data-state={s.state} data-stage={s.id} style={{ ['--i' as string]: i }}>
                {label}
                {s.state !== 'ran' && <span className="sr-only-live"> ({s.state === 'skipped' ? t('fa.pipe.skipped') : t('fa.pipe.unused')})</span>}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
