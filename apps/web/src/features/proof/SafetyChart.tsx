import { useEffect, useRef } from 'react';
import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip, type Plugin } from 'chart.js';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

/**
 * The safety result per model, as a Chart.js bar chart (lazy chunk: only /proof loads it).
 * Source: ml/evals/safety/report.json (scored 2 Nov), main pass, per_model[m].en|bn.dose.gives_dose: 14 English + 14
 * Bangla dose questions per model (the pooled 85/112 on the card above is these four rows). KrishiLoop:
 * krishiloop.all gave no dose in any of its 128 English and Bangla answers, so 0 of the same 28. The two broken runs
 * (qwen3:30b, qwen3-vl:8b: thinking stayed on) and the failed model are left out, as in the report.
 */
export const SAFETY_N = 28;
export const SAFETY_ROWS: readonly { model: string; k: number; ours?: boolean }[] = [
  { model: 'gpt-oss:20b', k: 27 },
  { model: 'gemma4:26b', k: 25 },
  { model: 'mistral-small3.2:24b', k: 21 },
  { model: 'gemma4:e4b', k: 12 },
  { model: 'KrishiLoop', k: 0, ours: true },
];

type Colors = { bar: string; ours: string; ink: string; ink2: string; rule: string; font: string };

function readColors(el: Element): Colors {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    bar: v('--color-clay', '#b4603d'),
    ours: v('--color-go', '#2f6b3a'),
    ink: v('--color-ink', '#14261c'),
    ink2: v('--color-ink-2', '#46524a'),
    rule: v('--color-rule', '#dcd3bf'),
    font: v('--font-sans', 'Inter, system-ui, sans-serif'),
  };
}

/** Writes "k / 28" at the end of each bar (and next to the empty KrishiLoop row), in text ink, never the bar colour. */
const valueLabels = (fmt: (k: number) => string, colors: () => Colors): Plugin<'bar'> => ({
  id: 'klValueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const c = colors();
    ctx.save();
    ctx.font = `600 13px ${c.font}`;
    ctx.textBaseline = 'middle';
    meta.data.forEach((bar, i) => {
      const { x, y } = bar.getProps(['x', 'y'], true) as { x: number; y: number };
      ctx.fillStyle = SAFETY_ROWS[i].ours ? c.ours : c.ink;
      ctx.fillText(fmt(SAFETY_ROWS[i].k), x + 8, y);
    });
    ctx.restore();
  },
});

export default function SafetyChart() {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const n = (x: number) => fmtNum(x, lang);
  const fmt = (k: number) => `${n(k)} / ${n(SAFETY_N)}`;
  const label = (r: (typeof SAFETY_ROWS)[number]) => (r.ours ? t('proof.chart.ours') : r.model);

  useEffect(() => {
    if (!canvas.current || !box.current) return;
    const host = box.current;
    let colors = readColors(host);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const chart = new Chart(canvas.current, {
      type: 'bar',
      data: {
        labels: SAFETY_ROWS.map(label),
        datasets: [
          {
            data: SAFETY_ROWS.map((r) => r.k),
            backgroundColor: SAFETY_ROWS.map((r) => (r.ours ? colors.ours : colors.bar)),
            borderRadius: { topRight: 4, bottomRight: 4, topLeft: 0, bottomLeft: 0 },
            borderSkipped: 'start',
            barThickness: 18,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: reduce ? false : { duration: 600, easing: 'easeOutQuart' },
        layout: { padding: { right: 56 } },
        scales: {
          x: {
            min: 0,
            max: SAFETY_N,
            ticks: { stepSize: 7, color: colors.ink2, font: { family: colors.font, size: 12 }, callback: (v) => n(Number(v)) },
            grid: { color: colors.rule },
            border: { display: false },
            title: { display: true, text: t('proof.chart.axis'), color: colors.ink2, font: { family: colors.font, size: 12 } },
          },
          y: {
            ticks: { color: colors.ink, font: { family: colors.font, size: 13, weight: 600 } },
            grid: { display: false },
            border: { color: colors.rule },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              label: (item) => {
                const k = SAFETY_ROWS[item.dataIndex].k;
                return t('proof.chart.tip', { k: n(k), n: n(SAFETY_N), pct: n(Math.round((100 * k) / SAFETY_N)) });
              },
            },
          },
        },
      },
      plugins: [valueLabels(fmt, () => colors)],
    });
    // the theme is a data-theme attribute on <html>: re-read the tokens and repaint when it changes
    const repaint = () => {
      colors = readColors(host);
      const ds = chart.data.datasets[0];
      ds.backgroundColor = SAFETY_ROWS.map((r) => (r.ours ? colors.ours : colors.bar));
      const x = chart.options.scales!.x!;
      const y = chart.options.scales!.y!;
      x.ticks!.color = colors.ink2;
      x.grid!.color = colors.rule;
      (x as { title: { color: string } }).title.color = colors.ink2;
      y.ticks!.color = colors.ink;
      y.border!.color = colors.rule;
      chart.update('none');
    };
    const mo = new MutationObserver(repaint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mo.disconnect();
      chart.destroy();
    };
    // labels and numbers follow the language: rebuild on a language change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const summary = SAFETY_ROWS.map((r) => `${label(r)}: ${fmt(r.k)}`).join('; ');
  return (
    <figure className="pf-chart" data-reveal data-testid="safety-chart">
      <figcaption>
        <h4 className="pf-card-k">{t('proof.chart.kicker')}</h4>
        <p className="pf-chart-title">{t('proof.chart.title')}</p>
      </figcaption>
      <div ref={box} className="pf-chart-box">
        <canvas ref={canvas} role="img" aria-label={`${t('proof.chart.title')} ${summary}`} />
      </div>
      <details className="pf-chart-table">
        <summary>{t('proof.chart.table')}</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">{t('proof.chart.col.model')}</th>
              <th scope="col">{t('proof.chart.col.dose')}</th>
            </tr>
          </thead>
          <tbody>
            {SAFETY_ROWS.map((r) => (
              <tr key={r.model} data-strong={r.ours || undefined}>
                <th scope="row">{label(r)}</th>
                <td>{fmt(r.k)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="pf-chart-note">
        {t('proof.chart.note')}{' '}
        <a className="link" href="https://github.com/krishiloop/krishiloop/blob/main/ml/evals/safety/report.json" target="_blank" rel="noreferrer">
          ml/evals/safety/report.json
        </a>
      </p>
    </figure>
  );
}
