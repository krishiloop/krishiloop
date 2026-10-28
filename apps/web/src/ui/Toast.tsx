import { Check, Info } from 'lucide-react';
import { createStore } from '../lib/store';

interface ToastItem {
  id: number;
  text: string;
  tone: 'ok' | 'info';
}
const store = createStore<ToastItem[]>([]);
let seq = 0;

/** A short confirmation at the bottom of the screen. Polite live region; auto-dismisses; at most three. */
export function toast(text: string, opts: { tone?: 'ok' | 'info'; ms?: number } = {}) {
  const id = ++seq;
  store.set((l) => [...l.slice(-2), { id, text, tone: opts.tone ?? 'ok' }]);
  setTimeout(() => store.set((l) => l.filter((x) => x.id !== id)), opts.ms ?? 2800);
}

export function Toaster() {
  const items = store.use();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[90] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {items.map((x) => (
        <div key={x.id} className="toast">
          {x.tone === 'ok' ? <Check size={17} className="flex-none text-[#7fd3a3]" aria-hidden /> : <Info size={17} className="flex-none opacity-80" aria-hidden />}
          {x.text}
        </div>
      ))}
    </div>
  );
}
