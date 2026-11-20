import { scaleBand, scaleLinear } from 'd3-scale';
import { max } from 'd3-array';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';

/**
 * GBIF sightings per country, from the DuckDB warehouse (tools/warehouse.py).
 * Source: ml/warehouse/report.json -> results.sightings_per_country. The web app cannot import from ml/, so the six
 * numbers are copied here. d3-scale does the scaling; the bars are plain SVG.
 */
export const WAREHOUSE_ROWS: readonly { country: string; n: number }[] = [
  { country: 'KE', n: 4076 },
  { country: 'IN', n: 2652 },
  { country: 'BR', n: 1761 },
  { country: 'ES', n: 843 },
  { country: 'BD', n: 354 },
  { country: 'PT', n: 76 },
];

const W = 640;
const ROW = 34;
const LEFT = 104;
const RIGHT = 64;

export default function WarehouseChart() {
  const { t, lang } = useI18n();
  const name = (c: string) => t(`proof.wh.c.${c}` as Parameters<typeof t>[0]);
  const H = WAREHOUSE_ROWS.length * ROW + 8;
  const x = scaleLinear()
    .domain([0, max(WAREHOUSE_ROWS, (r) => r.n) ?? 1])
    .range([0, W - LEFT - RIGHT]);
  const y = scaleBand<string>()
    .domain(WAREHOUSE_ROWS.map((r) => r.country))
    .range([4, H - 4])
    .padding(0.28);
  const summary = WAREHOUSE_ROWS.map((r) => `${name(r.country)}: ${fmtNum(r.n, lang)}`).join('; ');
  return (
    <figure className="pf-chart" data-reveal data-testid="warehouse-chart">
      <figcaption>
        <h4 className="pf-card-k">{t('proof.wh.kicker')}</h4>
        <p className="pf-chart-title">{t('proof.wh.title')}</p>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${t('proof.wh.title')} ${summary}`} style={{ width: '100%', height: 'auto' }}>
        {WAREHOUSE_ROWS.map((r) => (
          <g key={r.country} transform={`translate(0 ${y(r.country)})`}>
            <text x={LEFT - 10} y={y.bandwidth() / 2} textAnchor="end" dominantBaseline="central" fill="var(--color-ink)" fontSize="14" fontWeight="600">
              {name(r.country)}
            </text>
            <rect x={LEFT} width={x(r.n)} height={y.bandwidth()} rx="4" fill="var(--color-moss-ink)" />
            <text x={LEFT + x(r.n) + 8} y={y.bandwidth() / 2} dominantBaseline="central" fill="var(--color-ink)" fontSize="13" fontWeight="600">
              {fmtNum(r.n, lang)}
            </text>
          </g>
        ))}
      </svg>
      <details className="pf-chart-table">
        <summary>{t('proof.wh.table')}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{t('proof.wh.col.country')}</th>
              <th scope="col">{t('proof.wh.col.n')}</th>
            </tr>
          </thead>
          <tbody>
            {WAREHOUSE_ROWS.map((r) => (
              <tr key={r.country}>
                <th scope="row">{name(r.country)}</th>
                <td>{fmtNum(r.n, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="pf-chart-note">
        {t('proof.wh.note')} {t('proof.wh.source')}{' '}
        <a className="link" href="https://github.com/krishiloop/krishiloop/blob/main/ml/warehouse/report.json" target="_blank" rel="noreferrer">
          ml/warehouse/report.json
        </a>
      </p>
    </figure>
  );
}
