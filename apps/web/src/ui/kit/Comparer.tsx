import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { fmtNum } from '../../lib/format';
import { cn } from './cn';

/**
 * Comparer: drag to compare two layers of the same picture (a leaf photo and the map of where the model looked; a
 * field before and after rain). The "after" layer is clipped from the left at the handle (clip-path, no layout).
 * Pointer: drag anywhere on it. Keyboard: the handle is a slider (arrows 2 %, Page Up/Down 10 %, Home/End).
 *
 *   <Comparer before={<img src=… alt=""/>} after={<img src=… alt=""/>} beforeLabel="Photo" afterLabel="Where it looked"
 *             label="Compare the photo with the attention map" initial={55} />
 *
 * Both layers fill the same box: give the wrapper an aspect ratio (className="aspect-[4/3]") or a sized child.
 */
export function Comparer({
  before,
  after,
  beforeLabel,
  afterLabel,
  label,
  initial = 50,
  className,
  onChange,
}: {
  before: ReactNode;
  after: ReactNode;
  beforeLabel?: ReactNode;
  afterLabel?: ReactNode;
  /** the slider's accessible name */
  label?: string;
  initial?: number;
  className?: string;
  onChange?: (pct: number) => void;
}) {
  const { t, lang } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(initial);
  const dragging = useRef(false);

  const set = useCallback(
    (v: number) => {
      const n = Math.min(100, Math.max(0, v));
      setPct(n);
      onChange?.(n);
    },
    [onChange],
  );
  const fromX = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    set(((clientX - r.left) / r.width) * 100);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'PageUp' || e.key === 'PageDown' ? 10 : 2;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') set(pct - step);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') set(pct + step);
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(100);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={box}
      className={cn('cmp', className)}
      style={{ '--cmp': `${pct}%` } as React.CSSProperties}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        fromX(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && fromX(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <div className="absolute inset-0 [&>*]:h-full [&>*]:w-full [&>img]:object-cover">{before}</div>
      <div className="cmp-after [&>*]:h-full [&>*]:w-full [&>img]:object-cover">{after}</div>
      {beforeLabel && <span className="cmp-tag chip glass left-3">{beforeLabel}</span>}
      {afterLabel && <span className="cmp-tag chip glass right-3">{afterLabel}</span>}
      <span className="cmp-line" aria-hidden />
      <span
        role="slider"
        tabIndex={0}
        aria-label={label ?? t('ui.cmp.label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-valuetext={`${fmtNum(Math.round(pct), lang)}%`}
        className="cmp-handle glass"
        onKeyDown={onKey}
      >
        <ChevronsLeftRight size={20} aria-hidden />
      </span>
    </div>
  );
}
