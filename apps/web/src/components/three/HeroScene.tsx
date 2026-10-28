import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { RiceScene } from './RiceScene';
import type { LightMode } from './lightModes';
import { useMotionReduced } from '../../lib/motionPref';
import { useOnScreen } from '../../lib/hooks';
import { profileDevice } from '../../lib/device';

export interface HeroSceneProps {
  mode: LightMode;
  scanKey: number;
  compact?: boolean;
  onReady?: () => void;
  onScan?: (active: boolean) => void;
}

function level(): 'high' | 'mid' | 'low' {
  const p = profileDevice();
  if (p.software) return 'low';
  if (p.coarse || (p.memory !== null && p.memory <= 4) || (p.cores !== null && p.cores <= 4)) return 'mid';
  return 'high';
}

function Ready({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    if (done.current) return;
    // two animation frames after mount: the shaders have compiled and one real frame has been drawn
    let a = requestAnimationFrame(() => {
      a = requestAnimationFrame(() => {
        done.current = true;
        gl.render(scene, camera);
        onReady?.();
      });
    });
    return () => cancelAnimationFrame(a);
  }, [gl, scene, camera, onReady]);
  return null;
}

function DprDriver({ dpr }: { dpr: number }) {
  const setDpr = useThree((s) => s.setDpr);
  useEffect(() => setDpr(dpr), [dpr, setDpr]);
  return null;
}

/**
 * The living rice field (React Three Fiber). Lazy-loaded; renders only while on screen; a still frame when motion is
 * reduced or paused; thins itself and lowers resolution when the GPU struggles (PerformanceMonitor).
 */
export default function HeroScene({ mode, scanKey, compact = false, onReady, onScan }: HeroSceneProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(wrap, '120px');
  const still = useMotionReduced();
  const [quality, setQuality] = useState(1);
  const [lvl] = useState(level);
  const maxDpr = lvl === 'high' ? 1.6 : lvl === 'mid' ? 1.25 : 1;
  const dpr = Math.max(0.75, Math.min(maxDpr, 0.75 + (maxDpr - 0.75) * quality));

  return (
    <div ref={wrap} className="absolute inset-0" aria-hidden>
      <Canvas
        dpr={dpr}
        frameloop={!onScreen ? 'never' : still ? 'demand' : 'always'}
        camera={{ fov: compact ? 52 : 40, near: 0.1, far: 500, position: [0, 1.75, 8.6] }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        style={{ touchAction: 'pan-y' }}
      >
        <PerformanceMonitor onChange={({ factor }) => setQuality(Math.min(1, Math.max(0.2, 0.4 + 1.2 * factor)))} flipflops={4} />
        <DprDriver dpr={dpr} />
        <RiceScene mode={mode} still={still} quality={quality} level={lvl} scanKey={scanKey} compact={compact} onScan={onScan} />
        <Ready onReady={onReady} />
      </Canvas>
    </div>
  );
}
