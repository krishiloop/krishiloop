/** localStorage / sessionStorage can throw (private windows, blocked site data). Every access goes through here. */
type Kind = 'local' | 'session';
const memory: Record<Kind, Map<string, string>> = { local: new Map(), session: new Map() };

function area(kind: Kind): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readStore(key: string, kind: Kind = 'local'): string | null {
  try {
    const v = area(kind)?.getItem(key);
    if (v != null) return v;
  } catch {
    /* fall through to memory */
  }
  return memory[kind].get(key) ?? null;
}

export function writeStore(key: string, value: string | null, kind: Kind = 'local') {
  if (value == null) memory[kind].delete(key);
  else memory[kind].set(key, value);
  try {
    const a = area(kind);
    if (!a) return;
    if (value == null) a.removeItem(key);
    else a.setItem(key, value);
  } catch {
    /* private mode: the in-memory copy still serves this visit */
  }
}

export function readJSON<T>(key: string, kind: Kind = 'local'): T | null {
  const raw = readStore(key, kind);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown, kind: Kind = 'local') {
  try {
    writeStore(key, JSON.stringify(value), kind);
  } catch {
    /* too large or circular: skip */
  }
}

/** URL query flag helper (?theme=light, ?mode=lite, ?sample=1 ...) used by tests and screenshots. */
export function queryParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}
