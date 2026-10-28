/**
 * The five chapter forms as plain SVG, for Lite mode, browsers without WebGL, and while the 3D chunk loads.
 * They cross-fade with a touch of blur. Same five ideas as the liquid object: planet + satellite, traffic light,
 * voice bars, seal with tick, loop.
 */
export function ChapterFallback({ active }: { active: number }) {
  const bars = [28, 54, 84, 60, 100, 64, 88, 48, 26];
  return (
    <div className="chapter-fallback" aria-hidden>
      <svg viewBox="0 0 200 200" data-on={active === 0} className="cf cf-see" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <circle cx="100" cy="100" r="46" />
        <path d="M78 84c10-8 22-8 32 2M92 118c8 4 18 2 24-4" opacity=".5" />
        <ellipse cx="100" cy="100" rx="82" ry="30" transform="rotate(-24 100 100)" opacity=".7" />
        <rect x="160" y="52" width="20" height="10" rx="2.5" transform="rotate(-24 170 57)" fill="var(--color-sun)" stroke="none" />
      </svg>
      <svg viewBox="0 0 200 200" data-on={active === 1} className="cf cf-decide" fill="none" stroke="currentColor" strokeWidth="3">
        <rect x="64" y="22" width="72" height="156" rx="36" />
        <circle cx="100" cy="62" r="15" opacity=".55" />
        <circle cx="100" cy="100" r="15" opacity=".55" />
        <circle cx="100" cy="138" r="15" fill="var(--color-go)" stroke="none" />
        <path d="M93 138l5 5 10-11" stroke="#08130d" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 200 200" data-on={active === 2} className="cf cf-speak" fill="currentColor">
        {bars.map((h, i) => (
          <rect key={i} x={36 + i * 16.5} y={100 - h / 2} width="9" height={h} rx="4.5" className="cf-bar" style={{ ['--i' as string]: i }} />
        ))}
      </svg>
      <svg viewBox="0 0 200 200" data-on={active === 3} className="cf cf-prove" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <circle cx="100" cy="100" r="68" strokeDasharray="2 6.4" opacity=".7" />
        <circle cx="100" cy="100" r="54" />
        <path d="M70 102l22 22 40-50" stroke="var(--color-sun)" strokeWidth="11" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 200 200" data-on={active === 4} className="cf cf-learn" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M100 36a64 64 0 1 1-56 33" />
        <path d="M38 46l6 24 24-7" />
        <circle cx="156" cy="72" r="9" fill="var(--color-sun)" stroke="none" />
        <circle cx="100" cy="100" r="7" opacity=".55" />
      </svg>
    </div>
  );
}
