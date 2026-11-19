/**
 * The botanic background's sway runs only while its section is on screen (kit.css, `.botanic-bg` / `.botanic-art`):
 * one IntersectionObserver for the whole site sets `data-art-on`, and a MutationObserver picks up sections that pages
 * add later. Started once by SiteLayout. Nothing runs under reduced motion (the art is still there, it just stays put).
 */
let started = false;

export function startBotanicArt() {
  if (started || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  started = true;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) e.target.setAttribute('data-art-on', '');
        else e.target.removeAttribute('data-art-on');
      }
    },
    { rootMargin: '80px 0px' },
  );
  const seen = new WeakSet<Element>();
  const scan = (root: ParentNode) => {
    root.querySelectorAll('.botanic-bg, .botanic-art').forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      io.observe(el);
    });
  };
  scan(document);
  new MutationObserver((records) => {
    for (const r of records)
      r.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n.matches('.botanic-bg, .botanic-art')) scan(n.parentElement ?? document);
        else scan(n);
      });
  }).observe(document.body, { childList: true, subtree: true });
}
