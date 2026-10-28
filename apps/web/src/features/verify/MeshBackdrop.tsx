import { MeshGradient } from '@paper-design/shaders-react';

/** Slow, calm colour field behind the verdict (Paper Shaders). Lazy-loaded; Lite mode uses a CSS gradient instead. */
export default function MeshBackdrop({ colors, speed }: { colors: string[]; speed: number }) {
  return (
    <MeshGradient
      colors={colors}
      distortion={0.85}
      swirl={0.3}
      grainMixer={0.12}
      grainOverlay={0.05}
      speed={speed}
      maxPixelCount={700_000}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  );
}
