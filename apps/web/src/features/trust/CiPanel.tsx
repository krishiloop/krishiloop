import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { cx } from '../../lib/cx';
import { DataMark } from '../../ui/DataMark';
import { blob } from '../proof/repo';

type Triple = [number | null, number | null, number | null];
export interface CiArea {
  name: string;
  runs: number;
  photos: number;
  opened_runs: number;
  answers_to_open: Triple;
  auto_share: Triple;
  auto_precision: Triple;
  runs_with_auto: number;
  closing_runs: number;
  seed0: { answers_to_open: number | null; auto_share: number; auto_precision: number; percentile: { confirmations_until_open: number; auto_share_of_all_photos: number; auto_precision: number } };
}
export interface CiFile {
  source: string;
  seeds_per_area: number;
  areas: Record<string, CiArea>;
}

let cache: Promise<CiFile> | null = null;
/** The bundled, trimmed copy of ml/vision/artifacts/earned_trust_ci.json (its own lazy chunk: the first paint never waits). */
export function loadCi(): Promise<CiFile> {
  cache ??= import('../../data/recorded/earned-trust-ci.json').then((m) => m.default as unknown as CiFile);
  return cache;
}
export function useCi(): CiFile | null {
  const [ci, setCi] = useState<CiFile | null>(null);
  useEffect(() => {
    let alive = true;
    void loadCi().then((c) => alive && setCi(c));
    return () => {
      alive = false;
    };
  }, []);
  return ci;
}

/** the three metrics, each on its own scale shared by every area so the rows compare */
const METRICS = [
  { key: 'open', field: 'answers_to_open', seed: 'answers_to_open', lo: 0, hi: 650 },
  { key: 'auto', field: 'auto_share', seed: 'auto_share', lo: 0, hi: 1 },
  { key: 'right', field: 'auto_precision', seed: 'auto_precision', lo: 0.8, hi: 1 },
] as const;

/**
 * "Across 200 orders": the replay above is one stream order (seed 0). This panel shows, for every area, the median and
 * the 95% range (2.5th to 97.5th percentile) of the same replay re-run over 200 random orders (ml/vision/artifacts/
 * earned_trust_ci.json, BioCLIP 2, protocol 2 unchanged), with the replay's own value as a dot, so seed 0 is never read
 * as typical. A range that runs past the stream means the gate never opened in some runs.
 */
export function CiPanel({ selected }: { selected: string }) {
  const { t, lang } = useI18n();
  const ci = useCi();
  if (!ci) return <div className="skeleton h-[320px] w-full" aria-hidden />;
  const n = fmtNum(ci.seeds_per_area, lang);
  const num = (v: number) => fmtNum(Math.round(v), lang);
  const pct = (v: number, d = 1) => `${fmtNum(v * 100, lang, { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
  const show = (key: (typeof METRICS)[number]['key'], v: number | null) => (v === null ? '' : key === 'open' ? num(v) : key === 'auto' ? pct(v) : pct(v));
  const sel = ci.areas[selected] ?? ci.areas['BD-D'];
  const rank = (p: number) => fmtNum(Math.round(p * 100), lang);

  return (
    <section className="tp-ci" aria-labelledby="tp-ci-h" data-testid="ci-panel">
      <div className="flex flex-wrap items-center gap-3">
        <p className="label m-0">{t('tp.ci.eyebrow', { n })}</p>
        <DataMark kind="replay" />
      </div>
      <h3 id="tp-ci-h" className="t-head mt-3 max-w-[26ch]">
        {t('tp.ci.title', { n })}
      </h3>
      <p className="mt-2 max-w-[70ch] text-[0.95rem] text-ink-2">{t('tp.ci.lead', { n })}</p>

      <ul className="tp-ci-legend" aria-hidden>
        <li>
          <i className="is-range" />
          {t('tp.ci.legend.range')}
        </li>
        <li>
          <i className="is-median" />
          {t('tp.ci.legend.median')}
        </li>
        <li>
          <i className="is-seed" />
          {t('tp.ci.legend.seed')}
        </li>
      </ul>

      <div className="tp-ci-head" aria-hidden>
        <span />
        {METRICS.map((m) => (
          <span key={m.key}>{t(`tp.ci.m.${m.key}`)}</span>
        ))}
      </div>
      <ul className="tp-ci-rows">
        {Object.entries(ci.areas).map(([key, a], i) => (
          <li key={key} className={cx('tp-ci-row', key === selected && 'is-sel')} data-area={key} data-reveal style={{ '--i': i } as CSSProperties}>
            <div className="tp-ci-area">
              <p className="m-0">
                <span className="mono mr-2 text-[0.72rem] text-ink-3">{key}</span>
                <span className="font-[580]">{a.name}</span>
              </p>
              <p className="m-0 mt-1 text-[0.8rem] text-ink-3">
                {t('tp.ci.opened', { k: fmtNum(a.opened_runs, lang), n: fmtNum(a.runs, lang) })}
                {' · '}
                {a.closing_runs > 0 ? <span className="text-wait">{t('tp.ci.closed', { k: fmtNum(a.closing_runs, lang), n: fmtNum(a.runs, lang) })}</span> : t('tp.ci.noClose')}
              </p>
            </div>
            <dl className="tp-ci-metrics">
              {METRICS.map((m) => {
                const [lo, med, hi] = a[m.field];
                const seed = a.seed0[m.seed];
                const x = (v: number) => Math.min(1, Math.max(0, (v - m.lo) / (m.hi - m.lo)));
                const beyond = hi === null;
                return (
                  <div key={m.key} className="tp-ci-metric" data-testid={`ci-${key}-${m.key}`}>
                    <dt>{t(`tp.ci.m.${m.key}`)}</dt>
                    <dd>
                      <span className="tp-ci-val">
                        <b>{med === null ? '—' : show(m.key, med)}</b>{' '}
                        <span className="text-ink-3">{lo === null ? '' : beyond ? t('tp.ci.rangeOpen', { lo: show(m.key, lo) }) : t('tp.ci.range', { lo: show(m.key, lo), hi: show(m.key, hi) })}</span>
                      </span>
                      {lo !== null ? (
                        <span className={cx('tp-ci-bar', beyond && 'is-open')} aria-hidden style={{ '--a': x(lo), '--b': beyond ? 1 : x(hi!), '--m': med === null ? -1 : x(med), '--s': seed === null ? -1 : x(seed) } as CSSProperties}>
                          <i className="r" />
                          {med !== null ? <i className="m" /> : null}
                          {seed !== null ? <i className="s" /> : null}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ul>

      {sel ? (
        <p className="tp-ci-seed" data-testid="ci-seed">
          <span className="tp-ci-seeddot" aria-hidden />
          {t('tp.ci.seed', { area: selected, open: rank(sel.seed0.percentile.confirmations_until_open), prec: rank(sel.seed0.percentile.auto_precision) })}
        </p>
      ) : null}
      <p className="mt-3 flex flex-wrap gap-x-2 text-[0.8rem] text-ink-3">
        <span>{t('tp.ci.source')}</span>
        <a className="link mono text-[0.78rem]" href={blob(ci.source)} target="_blank" rel="noreferrer">
          {ci.source}
        </a>
        <span>· {t('tp.ci.copy')}</span>
      </p>
    </section>
  );
}
