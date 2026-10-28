import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChartLine, Leaf, WifiOff } from 'lucide-react';
import { fetchDemo, useApiState } from '../../lib/api/client';
import { loadAreaStats, photoErrorKind, useAreaStats } from '../../lib/api/trust';
import type { DemoField } from '../../lib/api/types';
import { useI18n } from '../../lib/i18n';
import { LinkButton } from '../../ui/Button';
import { AreaGauge, GateEvents } from './AreaGauge';
import { usePhotoCases } from './photoCases';

/** The area a field's photos belong to: crop and place (mirrors the planner's trust area). */
const areaOf = (f: Pick<DemoField, 'crop' | 'country' | 'area_code'>) => `${f.crop}@${f.area_code || f.country}`;
const verifyPath = (id: string) => `/verify/${encodeURIComponent(id.replace(/^urn:uuid:/, ''))}`;

type RowState = 'loading' | 'ready' | 'unavailable' | 'offline' | 'error';

/** One row per area of this sandbox: its gate, the lower bound against the bar, the verdicts, and the gate's events. */
export function AreaPanel() {
  const { t } = useI18n();
  const api = useApiState();
  const photo = usePhotoCases();
  const [areas, setAreas] = useState<string[] | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const recorded = api.forced || api.mode === 'sample';
  const caseAreas = [...new Set(photo.cases.map((c) => c.area))].join('|');

  useEffect(() => {
    if (recorded) return;
    let alive = true;
    void (async () => {
      const demo = await fetchDemo().catch(() => null);
      if (!alive) return;
      // areas with photo cases first, then the areas of the demo fields
      const list = [...new Set([...caseAreas.split('|').filter(Boolean), ...(demo && demo.source === 'live' ? demo.data.fields.map(areaOf) : [])])];
      setAreas(list);
      setRows(Object.fromEntries(list.map((a) => [a, 'loading' as RowState])));
      await Promise.all(
        list.map(async (a) => {
          try {
            await loadAreaStats(a);
            if (alive) setRows((r) => ({ ...r, [a]: 'ready' }));
          } catch (e) {
            const k = photoErrorKind(e);
            if (alive) setRows((r) => ({ ...r, [a]: k === 'unavailable' ? 'unavailable' : k === 'offline' ? 'offline' : 'error' }));
          }
        }),
      );
    })();
    return () => {
      alive = false;
    };
  }, [recorded, caseAreas]);

  if (recorded) {
    return (
      <div className="off-empty" data-testid="area-recorded">
        <Leaf size={28} strokeWidth={1.5} aria-hidden />
        <p className="m-0 font-medium text-ink">{t('off.area.recordedTitle')}</p>
        <p className="m-0 max-w-[50ch] text-sm text-ink-3">{t('off.area.recorded')}</p>
        <LinkButton to="/trust" variant="secondary" size="sm" arrow>
          {t('off.photo.toTrust')}
        </LinkButton>
      </div>
    );
  }

  return (
    <div>
      <div className="off-recall-head">
        <div className="min-w-0">
          <h2 className="off-h2">{t('off.area.title')}</h2>
          <p className="m-0 mt-2 max-w-[62ch] text-ink-2">{t('off.area.lead')}</p>
        </div>
        <Link to="/trust" className="btn btn-ghost btn-sm" data-testid="officer-trust-link">
          <ChartLine size={16} aria-hidden />
          {t('off.area.toTrust')}
        </Link>
      </div>
      {areas === null ? (
        <div className="grid gap-4" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-[220px]" />
          ))}
        </div>
      ) : areas.length === 0 ? (
        <div className="off-empty">
          <WifiOff size={28} strokeWidth={1.5} aria-hidden />
          <p className="m-0 font-medium text-ink">{t('off.area.none')}</p>
        </div>
      ) : (
        <ul className="off-areas" data-testid="area-rows">
          {areas.map((a, i) => (
            <li key={a} className="off-in" style={{ ['--i' as string]: i }}>
              <AreaRow area={a} state={rows[a] ?? 'loading'} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AreaRow({ area, state }: { area: string; state: RowState }) {
  const { t } = useI18n();
  const stats = useAreaStats(area);
  return (
    <article className="off-area" data-testid="area-row" data-area={area} aria-labelledby={`off-area-${area}`}>
      <header className="off-area-head">
        <h3 id={`off-area-${area}`} className="mono text-[1.35rem] font-semibold leading-none text-ink">
          {area}
        </h3>
        {stats?.trust_credential_id && (
          <Link className="link text-sm" to={verifyPath(stats.trust_credential_id)}>
            {t('off.area.credential')}
          </Link>
        )}
      </header>
      {stats ? (
        <div className="off-area-body">
          <AreaGauge stats={stats} compact />
          <div>
            <h4 className="eyebrow">{t('off.area.events')}</h4>
            <div className="mt-3">
              <GateEvents events={stats.events} />
            </div>
          </div>
        </div>
      ) : state === 'loading' ? (
        <div className="skeleton mt-4 h-[140px]" aria-busy="true" />
      ) : (
        <p className="m-0 mt-3 text-sm text-ink-3">{state === 'unavailable' ? t('off.area.noModel') : state === 'offline' ? t('off.area.offline') : t('off.area.error')}</p>
      )}
    </article>
  );
}
