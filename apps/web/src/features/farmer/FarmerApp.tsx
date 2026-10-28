// this page's words (English loads per screen)
import '../../lib/i18n/strings.farmer';
import '../../lib/i18n/strings.trust';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../../lib/i18n';
import { Sheet } from '../../ui/Sheet';
import { attach, init, loadPlan, useFarmer } from './farmerStore';
import { useHeld } from './receipts';
import { useMedia } from './voice';
import { AppHeader } from './AppHeader';
import { isTab, panelId, TabBar, tabId, type TabId } from './TabBar';
import { TodayTab } from './TodayTab';
import { AskTab } from './AskTab';
import { PhotoTab } from './PhotoTab';
import { ReceiptsTab } from './ReceiptsTab';
import { ReceiptSheet, type ReceiptRef } from './ReceiptSheet';
import { DemoRail, InspectorPanel } from './Rails';
import './farmer.css';

function initialTab(params: URLSearchParams): TabId {
  const q = params.get('tab');
  if (isTab(q)) return q;
  if (typeof window !== 'undefined' && window.location.hash === '#photo') return 'photo';
  return 'today';
}

/**
 * /app: the farmer app. Mobile-first: one column (at most 440 px) with its own header and bottom tabs, readable in the
 * sun, in Bangla or English. On screens 1024 px and wider it becomes a glass-box demo: the field and farmer picker with
 * "What to try" on the left, the app in a quiet device frame in the middle, and an inspector on the right that logs what
 * really happened (plan, rule versions, receipts and their signature suite, the Ask router's path, the photo route and
 * the area gate). On phones those two rails live in the Guide sheet.
 * Deep links: ?field=&profile=&tab=today|ask|photo|receipts (the URL follows the app, so any state can be shared).
 */
export default function FarmerApp() {
  const { t } = useI18n();
  const st = useFarmer();
  const held = useHeld();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>(() => initialTab(params));
  const [receipt, setReceipt] = useState<ReceiptRef | null>(null);
  const [guide, setGuide] = useState(false);
  const wide = useMedia('(min-width: 1024px)');
  const scroller = useRef<HTMLDivElement>(null);

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

  return (
    <div className="fa-stage">
      <h1 className="sr-only-live">{t('fa.h1')}</h1>
      {wide && (
        <aside className="fa-rail" aria-label={t('fa.rail.aria')}>
          <DemoRail onTab={go} />
        </aside>
      )}

      <div className="fa-device" data-testid="farmer-app">
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

      {wide && (
        <aside className="fa-rail fa-rail-ins" aria-label={t('fa.ins.title')}>
          <InspectorPanel />
        </aside>
      )}

      {!wide && (
        <Sheet open={guide} onClose={() => setGuide(false)} title={t('fa.guide')} subtitle={t('fa.guideSub')}>
          <DemoRail onTab={go} inSheet />
          <div className="mt-8 border-t border-rule pt-6">
            <InspectorPanel />
          </div>
        </Sheet>
      )}

      <ReceiptSheet value={receipt} onClose={() => setReceipt(null)} onToday={() => go('today')} />
    </div>
  );
}
