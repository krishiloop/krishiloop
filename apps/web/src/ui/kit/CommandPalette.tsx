import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CornerDownLeft, Languages, Moon, Search, Sun } from 'lucide-react';
import { LANGS, setLang, useI18n, type Key } from '../../lib/i18n';
import { toggleTheme, useTheme } from '../../lib/theme';
import { cn } from './cn';

export const PALETTE_EVENT = 'kl:palette';
/** Open the palette from anywhere (the nav button, a hint on a page). */
export const openPalette = () => window.dispatchEvent(new Event(PALETTE_EVENT));

type Item = { id: string; label: string; hint?: string; icon: React.ReactNode; run: () => void };

/**
 * Ctrl/⌘ K: jump to any page, switch language or theme. It opens and closes with no animation (a keyboard tool,
 * used again and again). A native <dialog>: focus is trapped, Escape closes it, focus returns where it was.
 */
export function CommandPalette({ routes }: { routes: { to: string; key: Key }[] }) {
  const { t } = useI18n();
  const theme = useTheme();
  const nav = useNavigate();
  const dlg = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  const close = () => dlg.current?.close();
  const items: Item[] = useMemo(
    () => [
      ...routes.map((r) => ({ id: r.to, label: t(r.key), hint: r.to, icon: <ArrowRight size={16} aria-hidden />, run: () => nav(r.to) })),
      { id: 'theme', label: theme === 'dark' ? t('ui.theme.toLight') : t('ui.theme.toDark'), icon: theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />, run: toggleTheme },
      ...LANGS.map((l) => ({ id: `lang-${l.code}`, label: l.native, hint: l.english, icon: <Languages size={16} aria-hidden />, run: () => void setLang(l.code) })),
    ],
    [routes, t, theme, nav],
  );
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(s)) : items;
  }, [items, q]);

  useEffect(() => {
    const open = () => {
      const d = dlg.current;
      if (!d || d.open) return;
      setQ('');
      setActive(0);
      d.showModal();
      input.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (dlg.current?.open) close();
        else open();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, open);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(PALETTE_EVENT, open);
    };
  }, []);

  const run = (i: Item | undefined) => {
    if (!i) return;
    close();
    i.run();
  };

  return (
    <dialog
      ref={dlg}
      className="palette glass m-auto mt-[12vh] w-[min(560px,calc(100vw-24px))] rounded-[20px] p-0 text-ink backdrop:bg-black/50"
      aria-label={t('ui.palette.title')}
      onClick={(e) => {
        if (e.target === dlg.current) close();
      }}
    >
      <div className="flex items-center gap-3 border-b border-rule px-4">
        <Search size={18} className="text-ink-3" aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, shown.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(shown[active]);
            }
          }}
          placeholder={t('ui.palette.placeholder')}
          aria-label={t('ui.palette.placeholder')}
          aria-controls="palette-list"
          aria-activedescendant={shown[active] ? `pal-${shown[active].id}` : undefined}
          role="combobox"
          aria-expanded
          className="h-14 w-full bg-transparent text-[1rem] outline-none placeholder:text-ink-3"
        />
        <kbd className="mono rounded-md border border-rule px-1.5 py-0.5 text-[0.7rem] text-ink-3">Esc</kbd>
      </div>
      <ul id="palette-list" role="listbox" className="m-0 max-h-[52vh] list-none overflow-auto p-2">
        {shown.length === 0 && <li className="px-3 py-6 text-center text-ink-3">{t('ui.palette.empty')}</li>}
        {shown.map((i, n) => (
          <li
            key={i.id}
            id={`pal-${i.id}`}
            role="option"
            aria-selected={n === active}
            onPointerMove={() => setActive(n)}
            onClick={() => run(i)}
            className={cn('flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 text-[0.97rem]', n === active ? 'bg-ink/[0.08] text-ink' : 'text-ink-2')}
          >
            <span className="grid size-7 place-items-center rounded-full border border-rule text-ink-3">{i.icon}</span>
            <span className="flex-1">{i.label}</span>
            {i.hint && <span className="mono text-[0.72rem] text-ink-3">{i.hint}</span>}
            {n === active && <CornerDownLeft size={14} className="text-ink-3" aria-hidden />}
          </li>
        ))}
      </ul>
    </dialog>
  );
}
