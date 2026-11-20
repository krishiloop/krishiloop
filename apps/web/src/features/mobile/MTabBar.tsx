import { useRef, useState, type KeyboardEvent } from 'react';
import { CircleHelp, House, Mic, ReceiptText, ScanLine, type LucideIcon } from 'lucide-react';
import { useI18n, type Key } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';

export const M_TABS = ['home', 'leaf', 'ask', 'receipts', 'help'] as const;
export type MTab = (typeof M_TABS)[number];
export const isMTab = (v: string | null | undefined): v is MTab => !!v && (M_TABS as readonly string[]).includes(v);
export const mTabId = (id: MTab) => `m-tab-${id}`;
export const mPanelId = (id: MTab) => `m-panel-${id}`;

const ICON: Record<MTab, LucideIcon> = { home: House, leaf: ScanLine, ask: Mic, receipts: ReceiptText, help: CircleHelp };
const LABEL: Record<MTab, Key> = { home: 'm.tab.home', leaf: 'm.tab.leaf', ask: 'm.tab.ask', receipts: 'm.tab.receipts', help: 'm.tab.help' };

/**
 * The five tabs at the bottom of the screen, in thumb reach, clear of the home bar. Each is at least 56 px tall with its
 * word under its icon (no icon-only buttons). "Check a leaf" is the raised one: the camera is the app's main tool.
 * Accessible tabs: roving tabindex, arrow keys, Home and End; a keyboard choice moves the marker without animation.
 */
export function MTabBar({ value, onChange, recalled }: { value: MTab; onChange: (t: MTab) => void; recalled: number }) {
  const { t, lang } = useI18n();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [input, setInput] = useState<'pointer' | 'key'>('pointer');

  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % M_TABS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + M_TABS.length) % M_TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = M_TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setInput('key');
    onChange(M_TABS[n]!);
    refs.current[n]?.focus();
  };

  return (
    <nav className="m-tabbar" data-input={input} aria-label={t('m.tabs')}>
      <div role="tablist" aria-label={t('m.tabs')} className="m-tabs">
        {M_TABS.map((id, i) => {
          const Icon = ICON[id];
          const selected = id === value;
          return (
            <button
              key={id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={mTabId(id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={selected ? mPanelId(id) : undefined}
              tabIndex={selected ? 0 : -1}
              className="m-tab"
              data-tab={id}
              data-main={id === 'leaf' || undefined}
              data-testid={`m-tab-${id}`}
              onPointerDown={() => setInput('pointer')}
              onClick={() => onChange(id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              <span className="m-tab-icon">
                <Icon size={id === 'leaf' ? 24 : 22} strokeWidth={selected ? 2.2 : 1.8} aria-hidden />
                {id === 'receipts' && recalled > 0 && (
                  <span className="m-tab-badge" aria-hidden>
                    {fmtNum(recalled, lang)}
                  </span>
                )}
              </span>
              <span className="m-tab-word">{t(LABEL[id])}</span>
              {id === 'receipts' && recalled > 0 && <span className="sr-only-live">{t('m.tab.recalledN', { n: recalled })}</span>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
