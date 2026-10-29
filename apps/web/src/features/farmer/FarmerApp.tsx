// this page's words (English loads per screen)
import '../../lib/i18n/strings.farmer';
import '../../lib/i18n/strings.trust';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import { LOCALES } from '../../lib/format';
import { Sheet } from '../../ui/Sheet';
import { IphoneFrame } from '../../ui/kit/IphoneFrame';
import { SignalBeam } from '../../ui/kit/SignalBeam';
import { attach, init, loadPlan, useFarmer } from './farmerStore';
import { useHeld } from './receipts';
import { useMedia } from './voice';
import { useInspector, useWorking } from './inspector';
import { AppHeader } from './AppHeader';
import { isTab, panelId, TabBar, tabId, type TabId } from './TabBar';
import { TodayTab } from './TodayTab';
import { AskTab } from './AskTab';
import { PhotoTab } from './PhotoTab';
import { ReceiptsTab } from './ReceiptsTab';
import { ReceiptSheet, type ReceiptRef } from './ReceiptSheet';
import './farmer.css';

/*
 * The rails (demo controls, behind the tap, the inspector) are a separate chunk: a phone opens the app without them and
 * loads them only when the Guide opens; a wide screen loads them right after the phone has drawn.
 */
const DemoRail = lazy(() => import('./Rails').then((m) => ({ default: m.DemoRail })));
const TracePanel = lazy(() => import('./Rails').then((m) => ({ default: m.TracePanel })));
const InspectorPanel = lazy(() => import('./Rails').then((m) => ({ default: m.InspectorPanel })));

function initialTab(params: URLSearchParams): TabId {
  const q = params.get('tab');
  if (isTab(q)) return q;
  if (typeof window !== 'undefined' && window.location.hash === '#photo') return 'photo';
  return 'today';
}

/**
 * Keeps --scr-x/y/w/h on the stage: where the phone's screen is, in page coordinates. The receipt sheet (a top-layer
 * dialog, so it cannot live inside the phone's DOM) uses them to slide up inside the screen instead of over the page.
 */
function useScreenBox(stage: React.RefObject<HTMLDivElement | null>, screen: React.RefObject<HTMLDivElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const st = stage.current;
    const sc = screen.current;
    if (!on || !st || !sc) return;
    const put = () => {
      const r = sc.getBoundingClientRect();
      st.style.setProperty('--scr-x', `${r.left + window.scrollX}px`);
      st.style.setProperty('--scr-y', `${r.top + window.scrollY}px`);
      st.style.setProperty('--scr-w', `${r.width}px`);
      st.style.setProperty('--scr-h', `${r.height}px`);
    };
    put();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(put);
    ro?.observe(sc);
    ro?.observe(document.documentElement);
    window.addEventListener('resize', put);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', put);
    };
  }, [stage, screen, on]);
}

/**
 * /app: the farmer app.
 *  - Phones (below 1024 px): the app IS the screen: its own header, bottom tabs in thumb reach, readable in the sun, in
 *    Bangla or English. The demo controls, "behind the tap" and the inspector live in the Guide sheet.
 *  - 1024 px and wider: a showpiece. The app runs inside a phone; the left rail picks the sample field and farmer and
 *    lists what to try; the right rail shows what happened behind each tap (retrieval, rule, validator, receipt, or the
 *    officer), lit step by step, with the inspector's raw log under it. A hairline beam joins the phone to that rail and
 *    carries one light each time something happens.
 * Deep links: ?field=&profile=&tab=today|ask|photo|receipts (the URL follows the app, so any state can be shared).
 */
export default function FarmerApp() {
  const { t, lang } = useI18n();
  const st = useFarmer();
  const held = useHeld();
  const entries = useInspector();
  const working = useWorking();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>(() => initialTab(params));
  const [receipt, setReceipt] = useState<ReceiptRef | null>(null);
  const [guide, setGuide] = useState(false);
  const wide = useMedia('(min-width: 1024px)');
  const scroller = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  // the trace panel arrives with the lazy rails: a state ref, so the beam is drawn again once it is there
  const [traceEl, setTraceEl] = useState<HTMLDivElement | null>(null);
  const traceBody = useMemo(() => ({ current: traceEl }), [traceEl]);

  useScreenBox(stage, screen, wide);

  useEffect(() => attach(), []);
  useEffect(() => {
    void init({ fieldId: params.get('field'), profileId: params.get('profile') });
    // once, on arrival: later changes of the URL come from the app itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // a recall reached this tab while the app was open: rebuild the plan now
  useEffect(() => {
    if (st.boot === 'ready' && st.status === 'idle') void loadPlan();
  }, [st.boot, st.status]);

  // the URL follows the app (replace, never push): a copied link opens the same field, farmer and tab
  useEffect(() => {
    if (st.boot !== 'ready') return;
    const next = new URLSearchParams(params);
    if (st.fieldId) next.set('field', st.fieldId);
    if (st.profileId) next.set('profile', st.profileId);
    next.set('tab', tab);
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [st.boot, st.fieldId, st.profileId, tab, params, setParams]);

  const go = useCallback(
    (next: TabId) => {
      setTab(next);
      setGuide(false);
      if (wide) scroller.current?.scrollTo({ top: 0 });
      else window.scrollTo({ top: 0 });
    },
    [wide],
  );

  const recalled = held.items.filter((x) => held.status[x.id]?.s === 'recalled').length;
  const latest = entries.find((e) => e.trace?.length);
  const busy = working ?? (st.status === 'loading' ? 'plan' : null);
  const pulse = busy ? `busy-${busy}` : (latest?.id ?? null);
  const last = latest?.trace?.[latest.trace.length - 1];
  const beamColor = !busy && last?.s === 'wait' ? 'var(--color-wait)' : !busy && last?.s === 'stop' ? 'var(--color-ember)' : undefined;

  const app: ReactNode = (
    <div className="fa-device" data-testid="farmer-app" data-sheet={receipt ? 'open' : undefined}>
      <AppHeader onGuide={() => setGuide(true)} />
      <div ref={scroller} className="fa-scroll">
        <div key={tab} role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="fa-panel">
          {tab === 'today' && <TodayTab onOpenReceipt={setReceipt} onTab={go} />}
          {tab === 'ask' && <AskTab onOpenReceipt={setReceipt} />}
          {tab === 'photo' && <PhotoTab onTab={go} />}
          {tab === 'receipts' && <ReceiptsTab onOpenReceipt={setReceipt} />}
        </div>
      </div>
      <TabBar value={tab} onChange={go} recalled={recalled} />
    </div>
  );

  return (
    <div ref={stage} className="fa-stage" data-wide={wide ? '' : undefined}>
      <h1 className="sr-only-live">{t('fa.h1')}</h1>
      {wide ? (
        <>
          <aside className="fa-rail fa-rail-l" aria-label={t('fa.rail.aria')}>
            <Suspense fallback={null}>
              <DemoRail onTab={go} />
            </Suspense>
          </aside>
          <div className="fa-phone-col">
            <IphoneFrame className="fa-iph" screenRef={screen} locale={LOCALES[lang]}>
              {app}
            </IphoneFrame>
          </div>
          <aside className="fa-rail fa-rail-r" aria-label={t('fa.tr.aria')}>
            <Suspense fallback={null}>
              <TracePanel bodyRef={setTraceEl} />
              <InspectorPanel />
            </Suspense>
          </aside>
          <SignalBeam containerRef={stage} fromRef={screen} toRef={traceBody} fromAt={[1, 0.3]} toAt={[0, 0.06]} pulse={pulse} color={beamColor} />
        </>
      ) : (
        <>
          {app}
          <Sheet open={guide} onClose={() => setGuide(false)} title={t('fa.guide')} subtitle={t('fa.guideSub')}>
            <Suspense fallback={<div className="skeleton h-64" aria-hidden />}>
              <DemoRail onTab={go} inSheet />
              <div className="mt-8 grid gap-6 border-t border-rule pt-6">
                <TracePanel />
                <InspectorPanel />
              </div>
            </Suspense>
          </Sheet>
        </>
      )}

      <ReceiptSheet value={receipt} onClose={() => setReceipt(null)} onToday={() => go('today')} />
    </div>
  );
}
