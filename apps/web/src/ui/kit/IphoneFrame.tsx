/** A phone in a CSS frame: titanium edge, side buttons, the Dynamic Island, rounded screen and home bar (Magic UI iPhone mockup, MIT; rebuilt in CSS, no images). */
import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { cn } from './cn';
import './IphoneFrame.css';

/** The visitor's own clock (minutes), not a staged "9:41": nothing in the frame is made up. */
function useClock(locale?: string) {
  const fmt = () => {
    try {
      return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date()).replace(/\s?[AP]M$/i, '');
    } catch {
      return new Date().toTimeString().slice(0, 5);
    }
  };
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    const id = window.setInterval(() => setNow(fmt()), 20_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);
  return now;
}

/**
 * The frame is a physical object, so it stays dark titanium in both themes (like the paper receipt stays paper); the
 * screen inside follows the theme. `screenRef` is the screen (the live app's box), for things that must sit on it.
 * The status bar shows only the local time: no made-up signal or battery.
 */
export function IphoneFrame({ children, className, screenRef, locale, screenProps }: { children: ReactNode; className?: string; screenRef?: Ref<HTMLDivElement>; locale?: string; screenProps?: Record<string, string | undefined> }) {
  const time = useClock(locale);
  return (
    <div className={cn('iph', className)}>
      <span className="iph-btn iph-btn-action" aria-hidden />
      <span className="iph-btn iph-btn-up" aria-hidden />
      <span className="iph-btn iph-btn-down" aria-hidden />
      <span className="iph-btn iph-btn-power" aria-hidden />
      <div ref={screenRef} className="iph-screen" {...screenProps}>
        <div className="iph-status" aria-hidden>
          <span className="mono">{time}</span>
          <span className="iph-island" />
        </div>
        {children}
        <span className="iph-home" aria-hidden />
      </div>
    </div>
  );
}
