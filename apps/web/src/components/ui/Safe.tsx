import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { hasWebGL } from '../../lib/device';
import { RotateCcw } from 'lucide-react';
import { useI18n } from '../../lib/i18n';

/* ------------------------------------------------------------------ error boundary */
interface BoundaryProps {
  fallback: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

/** Catches render errors below it so one broken part never blanks the page. */
export class ErrorBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }
  reset = () => this.setState({ error: null });
  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}

/**
 * Wrap every 3D canvas: without WebGL, if the scene throws, or if the browser drops the GPU context
 * (driver reset, too many tabs), show `fallback` and keep the rest of the page working. After a lost
 * context a button restarts the scene on a fresh context. (Pattern from ShadowAstra Atlas.)
 */
export function Scene({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  const { t } = useI18n();
  const [lost, setLost] = useState(false);
  const [round, setRound] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || lost) return;
    const onLost = (e: Event) => {
      e.preventDefault();
      console.warn('3D view paused: the graphics context was lost');
      setLost(true);
    };
    // the event does not bubble, so each canvas gets its own listener, including canvases added later
    const seen = new Set<HTMLCanvasElement>();
    const hook = () =>
      el.querySelectorAll('canvas').forEach((c) => {
        if (seen.has(c)) return;
        seen.add(c);
        c.addEventListener('webglcontextlost', onLost);
      });
    hook();
    const mo = new MutationObserver(hook);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      seen.forEach((c) => c.removeEventListener('webglcontextlost', onLost));
    };
  }, [lost, round]);

  if (!hasWebGL()) return <>{fallback}</>;
  if (lost)
    return (
      <div className="relative h-full w-full">
        {fallback}
        <button
          type="button"
          onClick={() => {
            setLost(false);
            setRound((r) => r + 1);
          }}
          className="btn btn-quiet btn-sm absolute bottom-4 left-1/2 z-10 -translate-x-1/2"
        >
          <RotateCcw size={14} aria-hidden /> {t('common.retry')}
        </button>
      </div>
    );
  return (
    <div ref={box} className="contents">
      <ErrorBoundary key={round} fallback={() => fallback} onError={(e) => console.warn('3D view stopped:', e.message)}>
        {children}
      </ErrorBoundary>
    </div>
  );
}

const CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;

/** After a new deploy an open tab may ask for chunks that no longer exist: reload once to get the new ones. */
function reloadOnceForChunk(error: Error) {
  if (!CHUNK.test(error.message)) return false;
  try {
    const key = 'kl.chunkReload';
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function PageBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      onError={(e) => {
        if (!reloadOnceForChunk(e)) console.error('Page error:', e);
      }}
      fallback={(error, reset) => <PageError chunk={CHUNK.test(error.message)} onRetry={reset} />}
    >
      {children}
    </ErrorBoundary>
  );
}

function PageError({ chunk, onRetry }: { chunk: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto grid min-h-[60dvh] max-w-md place-items-center px-6 py-24 text-center">
      <div>
        <p className="eyebrow text-sun">{chunk ? t('data.checking') : t('common.error')}</p>
        <h1 className="mt-4 text-h2 font-medium tracking-tight">{t('common.error')}</h1>
        <button type="button" className="btn btn-primary mt-8" onClick={() => (chunk ? window.location.reload() : onRetry())}>
          <RotateCcw size={16} aria-hidden /> {t('common.retry')}
        </button>
      </div>
    </div>
  );
}
