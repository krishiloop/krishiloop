import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { BANGLA_TEST, TEST_TALLY } from './facts';
import { ReceiptPass } from '../farmer/ReceiptPass';
import { ensureDemoPlan } from '../farmer/farmerStore';
import { Reveal } from '../../components/ui/Reveal';
import { useI18n } from '../../lib/i18n';
import type { Action, DataSource } from '../../lib/api/types';

/**
 * W4: "AI vs KrishiLoop". Left: what four chatbots did with ONE Bangla question in our dated test (25 Oct 2026,
 * research/llm_bangla_smoke_test.md). Right: a real receipt from our planner. Doses and model names are left out on purpose.
 */
export function Versus() {
  const { t } = useI18n();
  const [demo, setDemo] = useState<{ action: Action; source: DataSource } | null>(null);

  useEffect(() => {
    let alive = true;
    void ensureDemoPlan()
      .then((p) => {
        const a = p.data.actions?.find((x) => x.kind === 'input_decision') ?? p.data.actions?.[0];
        if (alive && a) setDemo({ action: a, source: p.source });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section id="versus" className="story-section">
      <div className="story-wrap">
        <Reveal>
          <p className="eyebrow">{t('l.vs.eyebrow')}</p>
          <h2 className="display story-title">{t('l.vs.title')}</h2>
        </Reveal>

        <div className="vs-grid">
          <Reveal className="vs-col vs-bot surface">
            <p className="vs-label">{t('l.vs.question.label')}</p>
            <p className="vs-q" lang="en">
              “{t('l.vs.question')}”
            </p>
            <h3 className="vs-h3">{t('l.vs.bot.title')}</h3>
            <ul className="vs-models">
              {BANGLA_TEST.map((m) => (
                <li key={m.n} data-right={m.rightDisease}>
                  <div className="vs-model-head">
                    <span className="mono">{t('l.vs.bot.model', { n: m.n })}</span>
                    <span className="vs-said">
                      {t('l.vs.bot.said')} <b>{m.diagnosis}</b>
                    </span>
                    <span className="chip" data-tone={m.rightDisease ? 'go' : 'stop'}>
                      {m.rightDisease ? <Check size={12} strokeWidth={3} aria-hidden /> : <X size={12} strokeWidth={3} aria-hidden />}
                      {m.rightDisease ? t('l.vs.bot.right') : t('l.vs.bot.wrong')}
                    </span>
                  </div>
                  <ul className="vs-problems">
                    {m.problems.map((p) => (
                      <li key={p}>
                        <X size={13} strokeWidth={2.6} aria-hidden /> {p}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            <p className="vs-tally" data-testid="vs-tally">
              {t('l.vs.tally')}
            </p>
            <p className="vs-caveat">{t('l.vs.caveat')}</p>
            <span className="sr-only">
              {TEST_TALLY.rightDisease}/{TEST_TALLY.models}, {TEST_TALLY.unsourcedDose}/{TEST_TALLY.models}
            </span>
          </Reveal>

          <Reveal className="vs-col vs-kl" delay={120}>
            <h3 className="vs-h3 !mt-0">{t('l.vs.kl.title')}</h3>
            <p className="vs-label">{t('l.vs.kl.live')}</p>
            {demo ? <ReceiptPass action={demo.action} source={demo.source} index={0} total={1} /> : <div className="skeleton h-80 w-full rounded-3xl" aria-hidden />}
            <ul className="vs-checks">
              {(['l.vs.kl.1', 'l.vs.kl.2', 'l.vs.kl.3', 'l.vs.kl.4', 'l.vs.kl.5'] as const).map((k) => (
                <li key={k}>
                  <Check size={15} strokeWidth={3} aria-hidden /> {t(k)}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
