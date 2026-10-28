import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Languages, Moon, Sun } from 'lucide-react';
import { LANGS, setLang, useI18n } from '../lib/i18n';
import { toggleTheme, useTheme } from '../lib/theme';
import { cx } from '../lib/cx';

/** Paper <-> Lantern. */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <button type="button" className={cx('btn btn-ghost btn-icon btn-sm', className)} onClick={toggleTheme} aria-label={theme === 'dark' ? t('ui.theme.toLight') : t('ui.theme.toDark')}>
      {theme === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}

/**
 * Language menu: English and Bangla, plus Hindi and Swahili marked "Preview" (machine-translated). One tap switches
 * the whole site. A disclosure (button + list): Escape and an outside click close it; focus returns to the button.
 */
export function LangSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0]!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className={cx('relative', className)}>
      <button
        ref={btn}
        type="button"
        className="btn btn-ghost btn-sm gap-1.5 px-2.5"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${t('ui.lang.label')}: ${current.native}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Languages size={17} aria-hidden />
        {!compact && <span lang={current.code}>{current.native}</span>}
        <ChevronDown size={15} className={cx('transition-transform duration-200', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul id={listId} className="panel absolute right-0 top-[calc(100%+6px)] z-[70] m-0 w-56 list-none p-1.5 shadow-[var(--shadow-pop)]" role="list">
          {LANGS.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                lang={l.code}
                aria-current={l.code === lang}
                className={cx('flex w-full items-center gap-2 rounded-[8px] px-3 py-2.5 text-left text-[0.95rem]', l.code === lang ? 'bg-sunk font-semibold' : 'hover:bg-sunk/70')}
                onClick={() => {
                  void setLang(l.code);
                  setOpen(false);
                  btn.current?.focus();
                }}
              >
                <span className="flex-1">{l.native}</span>
                {l.preview && <span className="chip chip-carbon">{t('ui.lang.preview')}</span>}
                {l.code === lang && <Check size={16} aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
