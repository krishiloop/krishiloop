import { useEffect, useId, useRef, useState } from 'react';
import { Check, Feather, Globe, Moon, Pause, Play, Sun } from 'lucide-react';
import { LANGS, setLang, useI18n, type Lang } from '../../lib/i18n';
import { toggleTheme, useTheme } from '../../lib/theme';
import { setMotionPaused, useMotionPaused } from '../../lib/motionPref';
import { dismissLiteHint, setModePref, useMode } from '../../lib/device';
import { useApiState } from '../../lib/api/client';
import { cx } from '../../lib/cx';
import { PreviewBadge } from '../ui/Badges';

/** Language switch: English + Bangla, Hindi and Swahili marked "preview". */
export function LangMenu() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useId();

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

  const current = LANGS.find((l) => l.code === lang)!;
  const choose = (code: Lang) => {
    void setLang(code);
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <div ref={wrap} className="relative">
      <button
        ref={btn}
        type="button"
        className="btn btn-ghost btn-sm gap-1.5 px-3"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${t('lang.label')}: ${current.english}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Globe size={15} aria-hidden />
        <span lang={current.code}>{current.native}</span>
      </button>
      <div id={menuId} className="menu glass" data-open={open} aria-hidden={!open} {...(open ? {} : { inert: true })}>
        <ul className="m-0 list-none p-0">
          {LANGS.map((l) => (
            <li key={l.code}>
              <button type="button" className="menu-item" aria-checked={lang === l.code} role="menuitemradio" onClick={() => choose(l.code)}>
                <span className="flex items-center gap-2">
                  <span lang={l.code} className="font-medium">
                    {l.native}
                  </span>
                  {l.preview ? <PreviewBadge /> : null}
                </span>
                {lang === l.code ? <Check size={16} className="text-sun" aria-hidden /> : null}
              </button>
            </li>
          ))}
        </ul>
        <p className="m-0 px-3 pt-2 pb-2 text-[0.72rem] leading-snug text-dim">{lang === 'hi' || lang === 'sw' ? t('lang.previewNote') : t('lang.bnNote')}</p>
      </div>
    </div>
  );
}

export function ThemeToggle() {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={t('theme.toggle')} title={theme === 'dark' ? t('theme.light') : t('theme.dark')}>
      {theme === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}

/** WCAG 2.2.2: anything that moves by itself for more than five seconds needs a visible pause control. */
export function MotionToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const paused = useMotionPaused();
  return (
    <button
      type="button"
      className={cx('icon-btn', className)}
      aria-pressed={paused}
      onClick={() => setMotionPaused(!paused)}
      aria-label={paused ? t('motion.play') : t('motion.pause')}
      title={paused ? t('motion.play') : t('motion.pause')}
    >
      {paused ? <Play size={17} aria-hidden /> : <Pause size={17} aria-hidden />}
    </button>
  );
}

/** Lite = no 3D, no blur, lighter on a phone. Rich = the full cinematic version. */
export function ModeToggle() {
  const { t } = useI18n();
  const mode = useMode();
  const lite = mode.resolved === 'lite';
  return (
    <button type="button" className="btn btn-ghost btn-sm gap-1.5 px-3" aria-pressed={lite} onClick={() => setModePref(lite ? 'rich' : 'lite')} title={t('mode.toggle')} data-testid="mode-toggle">
      <Feather size={15} aria-hidden />
      <span>{t('mode.lite')}</span>
    </button>
  );
}

/** Where the data on this screen comes from: the live API or bundled samples. */
export function DataBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  const s = useApiState();
  if (s.mode === 'sample')
    return (
      <span className={cx('chip chip-sample', className)} title={t('data.sampleTip')} data-testid="data-badge" data-mode="sample">
        <span className="size-1.5 rounded-full bg-wait" aria-hidden />
        {t('data.sample')}
      </span>
    );
  if (s.mode === 'live')
    return (
      <span className={cx('chip', className)} title={t('data.liveTip')} data-testid="data-badge" data-mode="live" data-tone="go">
        <span className="size-1.5 rounded-full bg-go" aria-hidden />
        {t('data.live')}
      </span>
    );
  return (
    <span className={cx('chip', className)} data-testid="data-badge" data-mode="unknown">
      <span className="size-1.5 rounded-full bg-dim" aria-hidden />
      {t('data.checking')}
    </span>
  );
}

/** One line explaining why Lite is on, or offering it when the device looks borderline. */
export function ModeBanner() {
  const { t } = useI18n();
  const mode = useMode();
  const reasonKey = mode.resolved === 'lite' && mode.pref === 'auto' ? ({ 'no-webgl': 'mode.noWebgl', 'data-saver': 'mode.dataSaver', 'low-memory': 'mode.lowMemory', 'slow-network': 'mode.slowNetwork' } as const)[mode.reason as 'no-webgl' | 'data-saver' | 'low-memory' | 'slow-network'] : undefined;
  if (reasonKey)
    return (
      <div className="mode-banner glass" role="status">
        <p className="m-0 flex items-center gap-2 text-sm">
          <Feather size={16} className="text-sun" aria-hidden />
          {t(reasonKey)}
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModePref('rich')}>
          {t('mode.useRich')}
        </button>
      </div>
    );
  if (mode.suggestLite && mode.resolved === 'rich')
    return (
      <div className="mode-banner glass" role="status">
        <p className="m-0 flex items-center gap-2 text-sm">
          <Feather size={16} className="text-sun" aria-hidden />
          {t('mode.suggest')}
        </p>
        <span className="flex gap-2">
          <button type="button" className="btn btn-sun btn-sm" onClick={() => setModePref('lite')}>
            {t('mode.switch')}
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={dismissLiteHint}>
            {t('mode.dismiss')}
          </button>
        </span>
      </div>
    );
  return null;
}
