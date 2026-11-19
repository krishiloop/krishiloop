import { useEffect, useId, useState } from 'react';
import { EyeOff, MapPin, Users } from 'lucide-react';
import { useI18n, type Key, type Lang } from '../../../lib/i18n';
import { fmtNum, humanize } from '../../../lib/format';
import { SimChip } from './SimChip';
import { fetchRadar } from './api';
import type { RadarCell, RadarData } from './types';

export function problemName(p: string, t: (k: Key) => string): string {
  const key = `fa.radar.p.${p}` as Key;
  const s = t(key);
  return s === key ? humanize(p) : s;
}

export function agoText(n: number, t: (k: Key, p?: Record<string, string | number>) => string, lang: Lang): string {
  return n <= 0 ? t('fa.radar.today') : n === 1 ? t('fa.radar.oneDayAgo') : t('fa.radar.daysAgo', { n: fmtNum(n, lang) });
}

/**
 * "Near you": the outbreak radar from the farmer's side, for the district or county of their field. Real cells only
 * when at least k farmers (devices) reported; the simulated scenario is shown apart and labelled. Never one farmer.
 */
export function NearYou({ fieldId }: { fieldId: string }) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<RadarData | null>(null);
  const [failed, setFailed] = useState(false);
  const headId = useId();

  useEffect(() => {
    let alive = true;
    fetchRadar()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return null;
  if (!data) {
    return (
      <section className="kg-card kg-near" aria-busy="true" data-testid="kg-near">
        <p className="sr-only-live" role="status">
          {t('fa.radar.loading')}
        </p>
        <div className="skeleton h-5 w-1/2" />
        <div className="skeleton mt-3 h-12" />
      </section>
    );
  }
  const area = data.fieldAreas[fieldId];
  if (!area) return null;
  const k = data.simulated.k;
  const days = data.simulated.window_days;
  const real = (data.real?.cells ?? []).filter((c) => c.area === area.code);
  const sim = data.simulated.cells.filter((c) => c.area === area.code);

  return (
    <section className="kg-card kg-near" aria-labelledby={headId} data-testid="kg-near">
      <p className="eyebrow">{t('fa.radar.eyebrow', { days: fmtNum(days, lang) })}</p>
      <h2 id={headId} className="kg-near-title">
        <MapPin size={18} aria-hidden className="flex-none text-ink-2" />
        <span>{t('fa.radar.area', { area: area.name, level: t(`fa.radar.level.${area.level}`) })}</span>
      </h2>

      <div className="kg-near-block">
        <p className="kg-near-label">{t('fa.radar.real')}</p>
        {data.real === null ? (
          <p className="kg-near-empty">{t('fa.radar.realOff')}</p>
        ) : real.length ? (
          <CellList cells={real} />
        ) : (
          <p className="kg-near-empty" data-testid="kg-near-real-none">
            <EyeOff size={15} aria-hidden className="mr-1.5 inline align-[-2px]" />
            {t('fa.radar.realNone', { k: fmtNum(k, lang) })}
          </p>
        )}
      </div>

      <div className="kg-near-block is-sim" data-testid="kg-near-sim">
        <p className="kg-near-label flex flex-wrap items-center gap-2">
          <span>{t('fa.radar.sim')}</span>
          <SimChip />
        </p>
        {sim.length ? <CellList cells={sim} /> : <p className="kg-near-empty">{t('fa.radar.simNone')}</p>}
      </div>

      <p className="kg-near-privacy">
        <Users size={14} aria-hidden className="mr-1.5 inline align-[-2px]" />
        {t('fa.radar.privacy', { k: fmtNum(k, lang) })}
      </p>
    </section>
  );
}

function CellList({ cells }: { cells: RadarCell[] }) {
  const { t, lang } = useI18n();
  return (
    <ul className="kg-near-cells">
      {cells.slice(0, 3).map((c) => (
        <li key={`${c.area}-${c.problem}`} className="kg-near-cell">
          <span className="kg-near-count" aria-hidden>
            {fmtNum(c.reporters, lang)}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold leading-snug">{t('fa.radar.cell', { n: fmtNum(c.reporters, lang), problem: problemName(c.problem, t) })}</span>
            <span className="block text-xs text-ink-3">{t('fa.radar.cellMeta', { reports: fmtNum(c.reports, lang), ago: agoText(c.last_days_ago, t, lang) })}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
