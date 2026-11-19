import { useId } from 'react';

/**
 * A drawn rice-blast-like leaf (an ILLUSTRATION, labelled wherever it is shown): the site may not re-host dataset
 * photos (their licences are unchecked), so the home page draws how the "where it looked" map reads. The real map is
 * computed on the farmer's own photo in the app. `map` adds the attention layer over the lesions.
 */
export function LeafArt({ map, className }: { map?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 400 300" className={className} role="presentation" aria-hidden preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d3324" />
          <stop offset="1" stopColor="#0c1610" />
        </linearGradient>
        <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#4f8a3c" />
          <stop offset="0.55" stopColor="#6fa94a" />
          <stop offset="1" stopColor="#9cc560" />
        </linearGradient>
        <radialGradient id={`${id}-heat`}>
          <stop offset="0" stopColor="#ff6b3d" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="#f0b9b4" stopOpacity="0.75" />
          <stop offset="0.75" stopColor="#f0b9b4" stopOpacity="0.15" />
          <stop offset="1" stopColor="#f0b9b4" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <path d="M18 214 C 92 120, 238 70, 388 52 C 330 120, 206 206, 18 214 Z" />
        </clipPath>
      </defs>
      <rect width="400" height="300" fill={`url(#${id}-bg)`} />
      {/* a second blade behind, out of focus */}
      <path d="M-10 290 C 80 230, 200 210, 410 236 C 300 262, 150 280, -10 290 Z" fill="#2c4d2c" opacity="0.7" />
      <g clipPath={`url(#${id}-clip)`}>
        <path d="M18 214 C 92 120, 238 70, 388 52 C 330 120, 206 206, 18 214 Z" fill={`url(#${id}-leaf)`} />
        {/* parallel veins of a grass leaf */}
        {[-14, -7, 0, 7, 14, 21].map((o) => (
          <path key={o} d={`M18 ${214 + o * 0.2} C 100 ${150 + o}, 240 ${98 + o * 0.8}, 388 ${52 + o * 0.3}`} fill="none" stroke="#c9e39a" strokeOpacity={o === 0 ? 0.55 : 0.18} strokeWidth={o === 0 ? 1.6 : 0.8} />
        ))}
        {/* spindle lesions: grey centres, brown rims */}
        {(
          [
            [148, 150, 26, 8, -24],
            [214, 122, 32, 9, -20],
            [262, 104, 18, 6, -18],
            [120, 172, 14, 5, -26],
          ] as const
        ).map(([x, y, rx, ry, r]) => (
          <g key={`${x}-${y}`} transform={`rotate(${r} ${x} ${y})`}>
            <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#7a4a24" />
            <ellipse cx={x} cy={y} rx={rx * 0.62} ry={ry * 0.5} fill="#cfc4a8" />
          </g>
        ))}
        {map && (
          <g style={{ mixBlendMode: 'screen' }}>
            <ellipse cx="214" cy="122" rx="78" ry="46" fill={`url(#${id}-heat)`} />
            <ellipse cx="150" cy="150" rx="64" ry="40" fill={`url(#${id}-heat)`} opacity="0.9" />
            <ellipse cx="262" cy="104" rx="40" ry="26" fill={`url(#${id}-heat)`} opacity="0.7" />
            <ellipse cx="120" cy="174" rx="30" ry="20" fill={`url(#${id}-heat)`} opacity="0.55" />
          </g>
        )}
      </g>
      {map && <rect width="400" height="300" fill="#0c1610" opacity="0.18" />}
    </svg>
  );
}
