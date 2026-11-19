import { useEffect, useState } from 'react';
import { Calculator as CalcIcon, CalendarCheck, ChevronRight, CloudLightning, CloudSun } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import '../../../lib/i18n/strings.krishiguard';
import { useFarmer } from '../farmerStore';
import { Drawer } from '../calc/Drawer';
import { Calculator } from '../calc/Calculator';
import { fetchShield, simulatedShield } from './api';
import { Shield } from './Shield';
import { NearYou } from './NearYou';
import { VisitForm } from './VisitForm';
import type { ClimateReport } from './types';
import './climate.css';

/**
 * The KrishiGuard pillars on Today (builder R), loaded lazily after the plan: the Climate-Smart Shield, "near you" from
 * the outbreak radar, and two tools in drawers (what skipping a spray saves; ask an officer to visit or call).
 */
export default function KrishiGuard() {
  const { t } = useI18n();
  const st = useFarmer();
  const plan = st.plan;
  const [real, setReal] = useState<{ report: ClimateReport | null; source: 'live' | 'recorded'; key: string } | null>(null);
  const [sim, setSim] = useState<ClimateReport | null>(null);
  const [showSim, setShowSim] = useState(false);
  const [drawer, setDrawer] = useState<'calc' | 'visit' | null>(null);
  const key = plan ? `${plan.plan_id}|${st.profileId}|${st.planSource}` : '';

  useEffect(() => {
    if (!plan) return;
    let alive = true;
    fetchShield(plan, st.profileId, st.planSource)
      .then((r) => alive && setReal({ ...r, key }))
      .catch(() => alive && setReal({ report: null, source: st.planSource === 'live' ? 'live' : 'recorded', key }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!showSim || !plan) return;
    let alive = true;
    void simulatedShield(plan.field_id, st.profileId).then((r) => alive && setSim(r));
    return () => {
      alive = false;
    };
  }, [showSim, plan?.field_id, st.profileId, plan]);

  if (!plan) return null;
  const loading = !real || real.key !== key;
  const report = showSim ? sim : loading ? null : real.report;
  const farmerLabel = st.profileId ?? plan.farmer_profile_id; // the server's inbox names the farmer by profile id too

  return (
    <div className="kg-root grid gap-4" data-testid="kg-root">
      <Shield report={report} source={real?.source ?? 'recorded'} simulated={showSim} loading={showSim ? !sim : loading} />
      <button type="button" className="kg-sim-toggle" aria-pressed={showSim} onClick={() => setShowSim((s) => !s)} data-testid="kg-sim-toggle">
        {showSim ? <CloudSun size={17} aria-hidden /> : <CloudLightning size={17} aria-hidden />}
        {showSim ? t('fa.climate.previewOff') : t('fa.climate.preview')}
      </button>

      <NearYou fieldId={plan.field_id} />

      <section className="kg-tools" aria-label={t('fa.climate.tools')}>
        <button type="button" className="kg-tool" onClick={() => setDrawer('calc')} data-testid="kg-open-calc">
          <span className="kg-tool-icon" aria-hidden>
            <CalcIcon size={20} />
          </span>
          <span className="flex-1 text-left">{t('fa.climate.openCalc')}</span>
          <ChevronRight size={18} aria-hidden className="text-ink-3" />
        </button>
        <button type="button" className="kg-tool" onClick={() => setDrawer('visit')} data-testid="kg-open-visit">
          <span className="kg-tool-icon" aria-hidden>
            <CalendarCheck size={20} />
          </span>
          <span className="flex-1 text-left">{t('fa.climate.openVisit')}</span>
          <ChevronRight size={18} aria-hidden className="text-ink-3" />
        </button>
      </section>

      <Drawer open={drawer === 'calc'} onClose={() => setDrawer(null)} title={t('fa.calc.title')} subtitle={t('fa.calc.sub')} testId="kg-calc-drawer">
        <Calculator fieldId={plan.field_id} />
      </Drawer>
      <Drawer open={drawer === 'visit'} onClose={() => setDrawer(null)} title={t('fa.visit.title')} subtitle={t('fa.visit.sub')} testId="kg-visit-drawer">
        <VisitForm fieldId={plan.field_id} profileId={st.profileId ?? plan.farmer_profile_id} farmerLabel={farmerLabel} onDone={() => setDrawer(null)} />
      </Drawer>
    </div>
  );
}
