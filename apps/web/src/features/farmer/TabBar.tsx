import { useRef, useState, type KeyboardEvent } from 'react';
import { Camera, Mic, ReceiptText, Sun, type LucideIcon } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';

export const TABS = ['today', 'ask', 'photo', 'receipts'] as const;
export type TabId = (typeof TABS)[number];
export const isTab = (v: string | null | undefined): v is TabId => !!v && (TABS as readonly string[]).includes(v);

const ICON: Record<TabId, LucideIcon> = { today: Sun, ask: Mic, photo: Camera, receipts: ReceiptText };
const LABEL: Record<TabId, Key> = { today: 'fa.tab.today', ask: 'fa.tab.ask', photo: 'fa.tab.photo', receipts: 'fa.tab.receipts' };
export const tabId = (id: TabId) => `fa-tab-${id}`;
export const panelId = (id: TabId) => `fa-panel-${id}`;

/**
 * The app's four tabs, at the bottom of the app column (thumb reach on a phone). Accessible tabs: roving tabindex,
 * arrow keys, Home and End. Only the chosen tab's panel is in the page, so only that tab names it in aria-controls. The ink indicator slides to the chosen tab (transform only); a keyboard choice moves it
 * without animation (DESIGN.md: nothing animates on keyboard actions).
 */
export function TabBar({ value, onChange, recalled }: { value: TabId; onChange: (t: TabId) => void; recalled: number }) {
  const { t, lang } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [input, setInput] = useState<'pointer' | 'key'>('pointer');
  const index = TABS.indexOf(value);

  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setInput('key');
    onChange(TABS[n]!);
    refs.current[n]?.focus();
  };

  return (
    <div className="fa-tabbar" data-input={input} data-on={value}>
      <span className="fa-tab-ind" style={{ transform: `translateX(${index * 100}%)` }} aria-hidden />
      <div role="tablist" aria-label={t('fa.tabs')} className="fa-tabs">
        {TABS.map((id, i) => {
          const Icon = ICON[id];
          const selected = id === value;
          return (
            <button
              key={id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={tabId(id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? panelId(id) : undefined}
              tabIndex={selected ? 0 : -1}
              className="fa-tab"
              data-tab={id}
              data-testid={`fa-tab-${id}`}
              onPointerDown={() => setInput('pointer')}
              onClick={() => onChange(id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className="relative">
                <Icon size={22} strokeWidth={selected ? 2.1 : 1.7} aria-hidden />
                {id === 'receipts' && recalled > 0 && (
                  <span className="fa-tab-badge" aria-hidden>
                    {fmtNum(recalled, lang)}
                  </span>
                )}
              </span>
              <span>{t(LABEL[id])}</span>
              {id === 'receipts' && recalled > 0 && <span className="sr-only-live">{t('fa.tab.recalledN', { n: recalled })}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
