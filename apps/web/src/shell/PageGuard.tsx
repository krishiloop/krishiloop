import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { LinkButton } from '../ui/Button';

const STAMP = 'kl.reload-at';

/** A page's code chunk that no longer exists: an open tab from before a deploy asked for the old file. */
export function isChunkError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Unable to preload CSS/i.test(m);
}

/** Reload once to pick up the new version; a second failure within 30 s shows the card instead (no reload loop). */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(STAMP) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(STAMP, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

function Fallback() {
  const { t } = useI18n();
  return (
    <section className="wrap grid min-h-[60dvh] place-items-center py-24 text-center" role="alert" data-testid="page-guard">
      <div>
        <h1 className="t-title">{t('ui.guard.title')}</h1>
        <p className="t-lead mx-auto mt-4 max-w-md">{t('ui.guard.body')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            <RotateCw size={18} aria-hidden /> {t('ui.guard.reload')}
          </button>
          <LinkButton to="/" variant="secondary">
            {t('ui.goHome')}
          </LinkButton>
        </div>
      </div>
    </section>
  );
}

/**
 * Never a white screen (owner, 20 Nov: "/officer, nothing comes, just a white screen"). A page that throws while it
 * loads or renders shows a short message with Reload; a page whose code is gone after a deploy reloads once by itself.
 * `resetKey` (the route) clears the error when the visitor goes to another page.
 */
export class PageGuard extends Component<{ children: ReactNode; resetKey?: string }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkError(error) && reloadOnce()) return;
    console.error('page failed', error, info.componentStack);
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    return this.state.error ? <Fallback /> : this.props.children;
  }
}
