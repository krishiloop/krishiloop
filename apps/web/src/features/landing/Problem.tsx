import { useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import { AdviceGap } from './AdviceGap';
import { BLAST, CALLS, FARMS, HOUSEHOLDS, HOUSEHOLDS_PER_CALL, PHONES, RICE_LOSS, SMALL, type Fact } from './facts';
import { Reveal } from '../../components/ui/Reveal';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { useCountUp, useInViewOnce } from '../../lib/hooks';

function Stat({ fact, label, note, delay }: { fact: Fact; label: string; note?: string; delay: number }) {
  const { lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(box);
  const num = useCountUp(fact.value, seen, (n) => fmtNum(Math.round(n), lang), 1400);
  return (
    <Reveal delay={delay}>
      <div ref={box} className="stat" data-testid={`stat-${fact.id}`}>
        <p className="stat-num display" aria-label={`${fmtNum(fact.value, lang)}${fact.suffix ?? ''} ${fact.unit ?? ''}`}>
          <span ref={num} className="tabular" aria-hidden>
            0
          </span>
          {fact.suffix ? <span className="stat-suffix">{fact.suffix}</span> : null}
          {fact.unit ? <span className="stat-unit">{fact.unit}</span> : null}
        </p>
        <p className="stat-label">{label}</p>
        <p className="stat-source">
          <a href={fact.href} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">
            {fact.source} <ExternalLink size={12} aria-hidden />
          </a>
          {note ? <span> · {note}</span> : null}
        </p>
      </div>
    </Reveal>
  );
}

/**
 * The problem, told only with VERIFIED facts (research/fact_register*.md). Ids in comments next to each value:
 * GL-01, GL-02, GL-14 (global), A3, D4, D1, B2 (Bangladesh). The glowing-dot chart is drawn to scale from A3 and D4.
 */
export function Problem() {
  const { t, lang } = useI18n();
  return (
    <section id="problem" className="story-section">
      <div className="story-wrap">
        <Reveal>
          <p className="eyebrow">{t('l.problem.eyebrow')}</p>
          <h2 className="display story-title">{t('l.problem.title')}</h2>
        </Reveal>

        <div className="stat-row">
          <Stat fact={FARMS} label={t('l.problem.stat1')} delay={0} />
          <Stat fact={SMALL} label={t('l.problem.stat2')} delay={80} />
          <Stat fact={RICE_LOSS} label={t('l.problem.stat3')} note={t('l.problem.estimate')} delay={160} />
        </div>

        <div className="gap-grid">
          <Reveal className="gap-card surface">
            <h3 className="text-h3 font-semibold tracking-tight">{t('l.problem.gap.title')}</h3>
            <p className="mt-2 mb-5 max-w-[60ch] text-chrome">{t('l.problem.gap.body')}</p>
            <AdviceGap label={t('l.problem.gap.alt')} />
            <p className="gap-legend">
              <span className="gap-key" aria-hidden />
              {t('l.problem.gap.legend')}
            </p>
            <p className="m-0 text-sm text-dim">
              {t('l.problem.gap.ratio', { n: fmtNum(HOUSEHOLDS_PER_CALL, lang) })}{' '}
              <a href={HOUSEHOLDS.href} target="_blank" rel="noopener noreferrer" className="link">
                {HOUSEHOLDS.source}
              </a>
              {' · '}
              <a href={CALLS.href} target="_blank" rel="noopener noreferrer" className="link">
                {CALLS.source}
              </a>
            </p>
          </Reveal>

          <div className="gap-side">
            <Reveal className="surface mini" delay={80}>
              <h3 className="text-lg font-semibold tracking-tight">{t('l.problem.phones.title')}</h3>
              <div className="phones" role="img" aria-label={`${PHONES.rural}% / ${PHONES.urban}%`}>
                <div>
                  <span className="phones-bar" style={{ ['--p' as string]: PHONES.rural / 100 }} />
                  <span className="phones-val tabular">{fmtNum(PHONES.rural, lang)}%</span>
                </div>
                <div>
                  <span className="phones-bar is-urban" style={{ ['--p' as string]: PHONES.urban / 100 }} />
                  <span className="phones-val tabular">{fmtNum(PHONES.urban, lang)}%</span>
                </div>
              </div>
              <p className="m-0 mt-3 text-sm text-chrome">{t('l.problem.phones.body', { rural: fmtNum(PHONES.rural, lang), urban: fmtNum(PHONES.urban, lang) })}</p>
              <p className="m-0 mt-2 text-xs text-dim">
                <a href={PHONES.href} target="_blank" rel="noopener noreferrer" className="link">
                  {PHONES.source}
                </a>
              </p>
            </Reveal>
            <Reveal className="surface mini" delay={160}>
              <h3 className="text-lg font-semibold tracking-tight">{t('l.problem.blast.title')}</h3>
              <p className="stat-num display mt-3" style={{ fontSize: 'clamp(2.6rem, 2rem + 3vw, 4rem)' }}>
                {t('l.problem.upto')} {fmtNum(BLAST.value, lang)}%
              </p>
              <p className="m-0 mt-2 text-sm text-chrome">{t('l.problem.blast.body')}</p>
              <p className="m-0 mt-2 text-xs text-dim">
                <a href={BLAST.href} target="_blank" rel="noopener noreferrer" className="link">
                  {BLAST.source}
                </a>
              </p>
            </Reveal>
          </div>
        </div>

        <Reveal>
          <p className="story-bridge display">{t('l.problem.bridge')}</p>
        </Reveal>
      </div>
    </section>
  );
}
