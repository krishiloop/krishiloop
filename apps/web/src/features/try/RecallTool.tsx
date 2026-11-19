import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw, Undo2 } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum, pickText } from '../../lib/format';
import { cx } from '../../lib/cx';
import { loadRecorded, RECORDED_AT } from '../../data/recorded';
import { mockVerify, resetSampleRecalls, sampleRecalls, simulateRecall } from '../../lib/api/mocks';
import type { Receipt, VerifyResponse } from '../../lib/api/types';
import { Stamp } from '../../ui/Stamp';
import { DataMark } from '../../ui/DataMark';
import { verifyPath } from '../verify/verifyUtil';
import { citing, recallPreview, ruleKey, SAMPLE_RECEIPTS } from './recall';

interface Item {
  id: string;
  receipt: Receipt;
}

/**
 * "Take advice back (recall)": three RECORDED receipts and the rules they cite. Taking a rule back runs the app's own
 * sample-mode recall (simulateRecall, this browser only); each receipt's stamp is the verifier's own answer
 * (mockVerify), and the stamp lands again when it changes. The farmer app and the checker in this tab follow it.
 */
export function RecallTool() {
  const { t, lang } = useI18n();
  const recalled = sampleRecalls.use();
  const [all, setAll] = useState<Item[] | null>(null);
  const [status, setStatus] = useState<Record<string, VerifyResponse['status']>>({});

  useEffect(() => {
    let live = true;
    void loadRecorded().then(({ verifyBefore }) => {
      if (!live) return;
      setAll(Object.entries(verifyBefore).map(([id, v]) => ({ id, receipt: v.credential!.credentialSubject as unknown as Receipt })));
    });
    return () => {
      live = false;
    };
  }, []);

  // the verdict each sample receipt gets from the same code the checker uses
  useEffect(() => {
    let live = true;
    void Promise.all(SAMPLE_RECEIPTS.map(async (id) => [id, (await mockVerify(id))?.status ?? 'invalid'] as const)).then((rows) => {
      if (live) setStatus(Object.fromEntries(rows));
    });
    return () => {
      live = false;
    };
  }, [recalled]);

  const samples = useMemo(() => (all ? SAMPLE_RECEIPTS.map((id) => all.find((x) => x.id === id)!).filter(Boolean) : []), [all]);
  const rules = useMemo(() => samples.map((s) => s.receipt.rule_refs[0]!), [samples]);
  const reach = useMemo(() => (all ? recallPreview(all, recalled).filter((r) => r.status === 'recalled').length : 0), [all, recalled]);

  if (!all) {
    return (
      <p className="text-sm text-ink-2" aria-busy="true">
        {t('try.recall.loading')}
      </p>
    );
  }
  return (
    <div className="try-recall">
      <p className="flex flex-wrap items-center gap-2">
        <DataMark kind="recorded" date={RECORDED_AT} />
        <span className="chip chip-carbon">{t('try.recall.sim')}</span>
      </p>

      <ul className="try-tickets">
        {samples.map((s, i) => {
          const st = status[s.id] ?? 'authentic';
          const title = pickText(s.receipt.advice?.title, lang);
          const ref = s.receipt.rule_refs[0]!;
          return (
            <li key={s.id} className={cx('try-ticket', st === 'recalled' && 'is-recalled')} data-testid={`recall-ticket-${i}`} data-status={st}>
              <p className="eyebrow">{t('try.recall.receipt', { n: fmtNum(i + 1, lang) })} · {t(`try.case.${s.receipt.plan?.crop === 'potato' ? 'potato-vegetative' : `rice-${s.receipt.plan?.stage ?? 'tillering'}`}` as Key)}</p>
              <p className="try-ticket-title" lang={title.lang}>
                {title.text}
              </p>
              <p className={cx('mono text-sm', st === 'recalled' && 'text-stop line-through decoration-2')}>
                {ref.rule_id} v{ref.version}
              </p>
              <div className="try-ticket-foot">
                <Link to={verifyPath(s.id)} className="try-link">
                  {t('try.recall.open')}
                </Link>
                <Stamp key={st} kind={st === 'recalled' ? 'recalled' : 'authentic'} land size="sm" />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="try-recall-actions" role="group" aria-label={t('try.recall.pick')}>
        <p className="try-slider-label">{t('try.recall.pick')}</p>
        {rules.map((r) => {
          const key = ruleKey(r);
          const done = recalled.includes(key);
          const name = `${r.rule_id} v${r.version}`;
          return (
            <button
              key={key}
              type="button"
              className={cx('try-recall-btn', done && 'is-done')}
              disabled={done}
              onClick={() => simulateRecall(r.rule_id, r.version)}
              data-testid={`recall-${r.rule_id}`}
            >
              <RotateCcw size={16} aria-hidden />
              <span className="min-w-0 flex-1 text-left">
                <span className="block font-semibold">{done ? t('try.recall.taken', { rule: name }) : t('try.recall.take', { rule: name })}</span>
                <span className="block text-xs text-ink-2">{t('try.recall.reach', { n: fmtNum(citing(all, key), lang), total: fmtNum(all.length, lang) })}</span>
              </span>
            </button>
          );
        })}
        <button type="button" className="try-chipbtn" onClick={() => resetSampleRecalls()} disabled={!recalled.length} data-testid="recall-undo">
          <Undo2 size={14} aria-hidden /> {t('try.recall.undo')}
        </button>
      </div>
      <p className="text-sm text-ink-2" aria-live="polite" data-testid="recall-reach">
        {recalled.length > 0 && t('try.recall.after', { n: fmtNum(reach, lang), total: fmtNum(all.length, lang) })}
      </p>
    </div>
  );
}
