/**
 * autoTilt (builder H): showcase cards lean toward the mouse without wrapping them in TiltCard. One delegated pointer
 * listener for the whole site; it writes --rx/--ry (and --gx/--gy for a glare) on the nearest `[data-tilt]` element or
 * home showcase panel (`.pi-art`), and `data-tilt-on` while the mouse is over it. CSS does the rest (kit.css, home.css).
 * Mouse and fine pointer only; never on touch, pen or under reduced motion; never while a button is held (a drag).
 */
const SELECTOR = '[data-tilt], .pi-art';

export function startAutoTilt(max = 5): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  let cur: HTMLElement | null = null;
  let raf = 0;
  const reset = (el: HTMLElement) => {
    delete el.dataset.tiltOn;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };
  const onMove = (e: PointerEvent) => {
    const target = e.target instanceof Element ? (e.target.closest(SELECTOR) as HTMLElement | null) : null;
    const el = e.pointerType === 'mouse' && !e.buttons ? target : null;
    if (cur && cur !== el) reset(cur);
    cur = el;
    cancelAnimationFrame(raf);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const lim = Number(el.dataset.tilt) || max;
    raf = requestAnimationFrame(() => {
      el.dataset.tiltOn = '';
      el.style.setProperty('--ry', `${((px - 0.5) * 2 * lim).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${((0.5 - py) * 2 * lim).toFixed(2)}deg`);
      el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
      el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
    });
  };
  const onOut = (e: PointerEvent) => {
    if (!e.relatedTarget && cur) {
      reset(cur);
      cur = null;
    }
  };
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerout', onOut, { passive: true });
  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerout', onOut);
  };
}
