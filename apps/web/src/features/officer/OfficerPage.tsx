import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Camera, Inbox, Leaf, Undo2 } from 'lucide-react';
import { currentSessionId, useApiState } from '../../lib/api/client';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { caseStatus } from '../trust/gate';
import { loadInbox, useInbox, useInboxMeta } from './inboxStore';
import { loadPhotoCases, usePhotoCases } from './photoCases';
import { ledger, loadLedger, useLedger } from './ledger';
import { loadStats, receiptsSigned, useConsoleStats } from './stats';
import { ConsoleTabs, panelId, tabId, type ConsoleTab } from './ConsoleTabs';
import { TopStrip, type Counters } from './TopStrip';
import { InboxPanel } from './InboxPanel';
import { PhotoPanel } from './PhotoPanel';
import { RecallPanel } from './RecallPanel';
import { AreaPanel } from './AreaPanel';
import './officer.css';

type Tab = 'inbox' | 'photos' | 'recall' | 'trust';
const TABS: Tab[] = ['inbox', 'photos', 'recall', 'trust'];
const isTab = (v: string | null): v is Tab => !!v && (TABS as string[]).includes(v);

/**
 * The officer console (/officer, /officer/:id): a demo officer working in the visitor's own sandbox. Inbox, photo cases,
 * rules & recall, area trust. Deep links: ?tab=inbox|photos|recall|trust; /officer/<case id> opens a case (photo cases
 * start with "pc-"). In-console navigation adds a #fragment so the site shell keeps the scroll position and the focus.
 */
export default function OfficerPage() {
  const { t, lang } = useI18n();
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const api = useApiState();
  const caseId = id ?? null;
  const tab: Tab = caseId ? (caseId.startsWith('pc-') ? 'photos' : 'inbox') : isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'inbox';
  const focusRule = params.get('rule');

  useEffect(() => {
    let alive = true;
    void loadPhotoCases();
    void loadLedger().then(async () => {
      if (!alive) return;
      // the plans may have sent new cases (abstentions) and they changed the counters
      await loadInbox();
      // the server may have forgotten an old sandbox (24 h): the inbox call made a new one, so build its plans
      const s = ledger.get();
      if (alive && s.source === 'live' && s.sid !== currentSessionId()) await loadLedger({ rebuild: true });
      if (alive) void loadStats();
    });
    void loadInbox();
    return () => {
      alive = false;
    };
  }, [api.forced]);

  const inbox = useInbox();
  const inboxMeta = useInboxMeta();
  const photo = usePhotoCases();
  const st = useLedger();
  const stats = useConsoleStats();

  const openCases = inbox.filter((i) => i.status === 'open').length;
  const openPhotos = photo.cases.filter((c) => caseStatus(c) === 'open').length;
  const counters: Counters = useMemo(() => {
    const listReady = inboxMeta.load === 'ready' || inboxMeta.load === 'error';
    if (st.source === 'recorded') return { open: listReady ? openCases : null, receipts: st.receipts.length, recalled: st.recalls.length, source: 'recorded' };
    if (st.source === 'live' && stats.load === 'none') return { open: listReady ? openCases : null, receipts: st.receipts.length, recalled: st.recalls.length, source: 'live' };
    return {
      open: listReady ? openCases : stats.stats ? stats.stats.inbox_open : null,
      receipts: stats.stats ? receiptsSigned(stats.stats) : null,
      recalled: stats.stats ? stats.stats.rule_versions_recalled : null,
      source: st.source === 'live' ? 'live' : null,
    };
  }, [st.source, st.receipts.length, st.recalls.length, stats, inboxMeta.load, openCases]);

  const setTab = useCallback((v: Tab) => nav(`/officer?tab=${v}`, { replace: true }), [nav]);
  const select = useCallback((caseKey: string) => nav(`/officer/${encodeURIComponent(caseKey)}#case`), [nav]);
  const close = useCallback(() => nav(`/officer?tab=${tab}#cases`), [nav, tab]);

  const badge = (n: number, key: 'off.tab.openN' | 'off.tab.openPhotos') =>
    n > 0 ? (
      <span className="off-badge">
        {fmtNum(n, lang)}
        <span className="sr-only-live"> {t(key)}</span>
      </span>
    ) : null;
  const tabs: ConsoleTab<Tab>[] = [
    { id: 'inbox', label: t('off.tab.inbox'), short: t('off.tab.inboxShort'), icon: <Inbox size={17} aria-hidden />, badge: badge(openCases, 'off.tab.openN') },
    { id: 'photos', label: t('off.tab.photos'), short: t('off.tab.photosShort'), icon: <Camera size={17} aria-hidden />, badge: badge(openPhotos, 'off.tab.openPhotos') },
    { id: 'recall', label: t('off.tab.recall'), short: t('off.tab.recallShort'), icon: <Undo2 size={17} aria-hidden /> },
    { id: 'trust', label: t('off.tab.trust'), short: t('off.tab.trustShort'), icon: <Leaf size={17} aria-hidden /> },
  ];

  return (
    <div className="off-root">
      <div className="wrap pt-8 sm:pt-12">
        <TopStrip counters={counters} />
        <ConsoleTabs tabs={tabs} value={tab} onChange={setTab} label={t('off.tabs')} />
      </div>
      <div className="wrap pb-24 pt-7 sm:pt-9">
        <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} key={tab} className="off-panel" data-testid={`panel-${tab}`}>
          {tab === 'inbox' && <InboxPanel selectedId={caseId} onSelect={select} onClose={close} />}
          {tab === 'photos' && <PhotoPanel selectedId={caseId} onSelect={select} onClose={close} />}
          {tab === 'recall' && <RecallPanel focusRule={focusRule} />}
          {tab === 'trust' && <AreaPanel />}
        </div>
      </div>
    </div>
  );
}
