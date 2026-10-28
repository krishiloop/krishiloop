import { useEffect } from 'react';
import { Check } from 'lucide-react';
import { createStore } from '../../lib/store';

interface ToastItem {
  id: number;
  text: string;
}
const store = createStore<ToastItem[]>([]);
let seq = 0;

/** Show a short confirmation. Polite live region, auto-dismisses. */
export function toast(text: string, ms = 2600) {
  const id = ++seq;
  store.set((l) => [...l.slice(-2), { id, text }]);
  setTimeout(() => store.set((l) => l.filter((t) => t.id !== id)), ms);
}

export function Toaster() {
  const items = store.use();
  useEffect(() => undefined, []);
  return (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div key={t.id} className="toast glass">
          <Check size={16} className="text-go" aria-hidden />
          {t.text}
        </div>
      ))}
    </div>
  );
}
