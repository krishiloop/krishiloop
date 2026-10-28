import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { useResize } from '../../lib/hooks';

export interface ConsoleTab<T extends string> {
  id: T;
  label: ReactNode;
  /** a shorter label for phones (shown below 640 px) */
  short?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
}

export const tabId = (id: string) => `off-tab-${id}`;
export const panelId = (id: string) => `off-panel-${id}`;

/**
 * Tabs with an ink indicator that slides to the chosen tab (transform only: translateX + scaleX of a fixed 100 px bar).
 * Accessible tabs: roving tabindex, arrows, Home/End, and each tab names its panel (`panelId`). Nothing moves on keyboard
 * use (DESIGN.md): a change made with the keyboard jumps the indicator instead of sliding it.
 * (src/ui's Tabs keeps its ids private, so a panel could not point back at its tab; this one exposes them.)
 */
export function ConsoleTabs<T extends string>({ tabs, value, onChange, label }: { tabs: ConsoleTab<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const list = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [ink, setInk] = useState<{ x: number; w: number } | null>(null);
  const [instant, setInstant] = useState(true);
  const viaKey = useRef(false);

  const measure = () => {
    const i = tabs.findIndex((tab) => tab.id === value);
    const el = refs.current[i];
    if (!el) return;
    setInk({ x: el.offsetLeft, w: el.offsetWidth });
  };
  useLayoutEffect(() => {
    measure();
    // first paint and keyboard changes jump; pointer changes slide
    const jump = viaKey.current || ink === null;
    setInstant(jump);
    viaKey.current = false;
  }, [value, tabs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useResize(() => {
    setInstant(true);
    measure();
  });

  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault();
    viaKey.current = true;
    onChange(tabs[n]!.id);
    refs.current[n]?.focus();
  };

  return (
    <div className="off-tabs">
      <div role="tablist" aria-label={label} className="off-tablist" ref={list}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={tabId(tab.id)}
            type="button"
            role="tab"
            aria-selected={tab.id === value}
            aria-controls={panelId(tab.id)}
            tabIndex={tab.id === value ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKey(e, i)}
            className="off-tab"
            data-testid={`tab-${tab.id}`}
          >
            {tab.icon}
            {tab.short ? (
              <>
                <span className="sm:hidden">{tab.short}</span>
                <span className="max-sm:hidden">{tab.label}</span>
              </>
            ) : (
              <span>{tab.label}</span>
            )}
            {tab.badge}
          </button>
        ))}
        <span
          className={cx('off-tab-ink', instant && 'is-instant')}
          aria-hidden
          style={ink ? { transform: `translateX(${ink.x}px) scaleX(${ink.w / 100})` } : { opacity: 0 }}
        />
      </div>
    </div>
  );
}
