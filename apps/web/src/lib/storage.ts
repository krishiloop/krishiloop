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

/** Remove every key that starts with `prefix`, from the real storage AND the in-memory copy (readStore falls back to it). */
export function removePrefix(prefix: string, kind: Kind = 'local') {
  for (const k of [...memory[kind].keys()]) if (k.startsWith(prefix)) memory[kind].delete(k);
  try {
    const a = area(kind);
    if (!a) return;
    for (const k of Object.keys(a)) if (k.startsWith(prefix)) a.removeItem(k);
  } catch {
    /* private mode: the in-memory copy is already cleared */
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
