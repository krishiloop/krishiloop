/**
 * Live events from the API (GET /api/events?sid=..., Server-Sent Events): a new officer case, a recall, a photo
 * event. They carry ids and codes only, so the caller just refetches what it shows. Only used with a live API and a
 * sandbox session; in recorded sample mode nobody calls this, and without EventSource it does nothing.
 */
export type LiveEventKind = 'inbox' | 'recall' | 'photo';
export interface LiveEvent {
  kind: LiveEventKind;
  data: Record<string, unknown>;
}

const KINDS: LiveEventKind[] = ['inbox', 'recall', 'photo'];

/** Open the stream; reconnects with backoff (1 s to 30 s) after an error. Returns a function that closes it for good. */
export function connectEvents(sid: string, onEvent: (e: LiveEvent) => void): () => void {
  if (typeof EventSource === 'undefined' || !sid) return () => {};
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wait = 1000;
  let closed = false;
  const open = () => {
    if (closed) return;
    es = new EventSource(`/api/events?sid=${encodeURIComponent(sid)}`);
    es.addEventListener('ready', () => {
      wait = 1000;
    });
    for (const kind of KINDS) {
      es.addEventListener(kind, (m) => {
        try {
          onEvent({ kind, data: JSON.parse((m as MessageEvent<string>).data) as Record<string, unknown> });
        } catch {
          /* a malformed event is ignored */
        }
      });
    }
    es.onerror = () => {
      es?.close();
      es = null;
      if (closed) return;
      timer = setTimeout(open, wait);
      wait = Math.min(wait * 2, 30000);
    };
  };
  open();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    es?.close();
  };
}
