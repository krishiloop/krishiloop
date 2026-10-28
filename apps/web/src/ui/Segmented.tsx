import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
}

/**
 * A small set of exclusive choices (a radio group that looks like a segmented control). Arrow keys move the choice;
 * no animation on keyboard use (DESIGN.md).
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegOption<T>[];
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n]!.value);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx('seg', className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
}

/**
 * Accessible tabs (roving tabindex, arrow keys, Home/End). Render the active panel yourself and give it
 * `{...tabPanelProps(base, id)}` with the same `base` you pass here, so the tab and its panel point at each other.
 */
export const tabPanelProps = (base: string, id: string) => ({ id: `${base}-${id}-panel`, role: 'tabpanel' as const, 'aria-labelledby': `${base}-${id}`, tabIndex: 0 });
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idBase,
  className,
  itemClassName,
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  /** pass the same string to `tabPanelProps(idBase, id)` on the panel you render */
  idBase?: string;
  className?: string;
  itemClassName?: string;
}) {
  const auto = useId();
  const base = idBase ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    if (n < 0) return;
    e.preventDefault();
    onChange(tabs[n]!.id);
    refs.current[n]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={className}>
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={`${base}-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          aria-controls={`${base}-${tab.id}-panel`}
          tabIndex={tab.id === value ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => onKey(e, i)}
          className={itemClassName}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.badge}
        </button>
      ))}
    </div>
  );
}
