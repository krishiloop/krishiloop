// this app's words (English loads per screen): the farmer app's, the area-trust helpers', and the phone app's own
import '../../lib/i18n/strings.farmer';
import '../../lib/i18n/strings.trust';
import '../../lib/i18n/strings.mobile';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { Toaster } from '../../ui/Toast';
import { attach, init, loadPlan, useFarmer } from '../farmer/farmerStore';
import { useHeld } from '../farmer/receipts';
import type { TabId } from '../farmer/TabBar';
import { TodayTab } from '../farmer/TodayTab';
import { AskTab } from '../farmer/AskTab';
import { ReceiptSheet, type ReceiptRef } from '../farmer/ReceiptSheet';
import { shownVerdict, startSaving, useSaved, type SavedReceipt } from './saved';
import { useOnline, welcomed, setWelcomed } from './platform';
import { MHeader } from './MHeader';
import { isMTab, mPanelId, mTabId, MTabBar, type MTab } from './MTabBar';
import { MyReceipts, QrSheet } from './MyReceipts';
// Leaf and Help are small and come with the app; the heavy parts load on use: the leaf model when a photo is read
// (AiPhoto), the booking drawer on the first "Call my officer" (Booking). Measured: lazy Leaf and Help tabs made the
// bundler split the shared i18n module out of the entry chunk, +0.8 KB on every page's first visit.
import LeafTab from './LeafTab';
import HelpTab from './HelpTab';
import { Onboarding } from './Onboarding';
import '../farmer/farmer.css';
import './mobile.css';


/** The farmer app's tab names, as the reused screens (Today, Ask, the leaf check) ask for them. */
const FROM_FARMER: Record<TabId, MTab> = { today: 'home', ask: 'ask', photo: 'leaf', receipts: 'receipts' };

/**
 * /m: KrishiLoop as a phone app. No website header or footer: the whole screen (100dvh, notch and home bar kept clear),
 * an app bar with the farm (the site's cream and pastel look; forest only in the dark theme), one scrolling page, and
 * five tabs at the bottom in thumb reach (Home, Check a leaf,
 * Ask, My receipts, Help). It reuses the farmer app's screens and stores as they are (the same API and the same
 * recorded mode as /app), and adds what a phone needs: a first-run welcome, receipts saved on the phone (they show with
 * no internet), and a QR to show an officer. It is a web page in the phone's browser (Chrome, Safari): nothing to install.
 * Deep links: ?tab=home|leaf|ask|receipts|help, ?field=&profile=, ?welcome=0 skips the first-run screens.
 */
export default function MobileApp() {
  const { t } = useI18n();
  const st = useFarmer();
  const online = useOnline();
  const saved = useSaved();
  const { status } = useHeld();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<MTab>(() => {
    const q = params.get('tab');
    return isMTab(q) ? q : 'home';
  });
  const [welcome, setWelcome] = useState(() => params.get('welcome') !== '0' && !welcomed());
  const [receipt, setReceipt] = useState<ReceiptRef | null>(null);
  const [qr, setQr] = useState<SavedReceipt | null>(null);
  const scroller = useRef<HTMLElement>(null);

  useEffect(() => attach(), []);
  useEffect(() => startSaving(), []);
  useEffect(() => {
    void init({ fieldId: params.get('field'), profileId: params.get('profile') });
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // a recall reached this phone while the app was open: build this week's advice again
  useEffect(() => {
    if (st.boot === 'ready' && st.status === 'idle') void loadPlan();
  }, [st.boot, st.status]);

  // the tab's name follows the app. The phone's status bar is the site's: lib/theme.ts paints it the page colour (cream,
  // or forest in the dark theme), and the app bar's mesh starts from that same colour.
  useEffect(() => {
    document.title = t('m.title');
  }, [t]);
  // the deck's line art sways a degree while on screen, as on the site (its own tiny chunk; still under reduced motion)
  useEffect(() => {
    void import('../../shell/botanicArt').then((m) => m.startBotanicArt());
  }, []);

  const go = useCallback((next: MTab) => {
    setTab(next);
    scroller.current?.scrollTo({ top: 0 });
  }, []);
  const fromFarmer = useCallback((next: TabId) => go(FROM_FARMER[next]), [go]);

  const recalled = useMemo(() => saved.filter((x) => shownVerdict(x, status[x.id]).s === 'recalled').length, [saved, status]);

  if (welcome) {
    return (
      <div className="m-app m-app-welcome" data-testid="m-app">
        <Onboarding
          onDone={() => {
            setWelcomed(true);
            setWelcome(false);
            setTab('home');
          }}
        />
        <div className="m-toasts">
          <Toaster />
        </div>
      </div>
    );
  }

  return (
    <div className="m-app" data-testid="m-app" data-sheet={receipt || qr ? 'open' : undefined}>
      <MHeader />
      {!online && (
        <p className="m-offline" role="status" data-testid="m-offline">
          <WifiOff size={16} aria-hidden className="flex-none" />
          {t('m.offline')}
        </p>
      )}
      <main ref={scroller} className="m-scroll" id="main" tabIndex={-1}>
        <h1 className="sr-only-live">{t('m.h1')}</h1>
        <div key={tab} role="tabpanel" id={mPanelId(tab)} aria-labelledby={mTabId(tab)} className="m-panel" data-testid={`m-panel-${tab}`}>
          <div className="botanic-art botanic-bg--rice" aria-hidden />
          {tab === 'home' && (
            <TodayTab onOpenReceipt={setReceipt} onTab={fromFarmer} />
          )}
          {tab === 'leaf' && <LeafTab onTab={fromFarmer} />}
          {tab === 'ask' && <AskTab onOpenReceipt={setReceipt} />}
          {tab === 'receipts' && <MyReceipts onOpen={setReceipt} onQr={setQr} onHome={() => go('home')} />}
          {tab === 'help' && (
            <HelpTab
              onRestart={() => {
                setWelcomed(false);
                setWelcome(true);
              }}
            />
          )}
        </div>
      </main>
      <MTabBar value={tab} onChange={go} recalled={recalled} />

      <ReceiptSheet value={receipt} onClose={() => setReceipt(null)} onToday={() => go('home')} />
      <QrSheet value={qr} onClose={() => setQr(null)} />
      <div className="m-toasts">
        <Toaster />
      </div>
    </div>
  );
}
