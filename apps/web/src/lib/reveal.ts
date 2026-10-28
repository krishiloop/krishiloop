/**
 * Reveal-on-scroll for any element with `data-reveal` (optionally `style="--i: n"` for a 60 ms stagger).
 * One IntersectionObserver for the whole app plus a MutationObserver for elements added later, so a component only
 * has to set the attribute. Content is hidden only after this runs (html.reveal-ready), so nothing can stay invisible
 * without JavaScript, and reduced motion keeps a short fade only (index.css).
 */
let started = false;

export function startReveal() {
  if (started || typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
  started = true;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.01 },
  );
  const seen = new WeakSet<Element>();
  const scan = (root: ParentNode) => {
    root.querySelectorAll('[data-reveal]:not(.is-in)').forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      io.observe(el);
    });
  };
  scan(document);
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach((n) => n instanceof Element && (n.matches('[data-reveal]') ? scan(n.parentElement ?? document) : scan(n)));
  }).observe(document.body, { childList: true, subtree: true });
  document.documentElement.classList.add('reveal-ready');
}
