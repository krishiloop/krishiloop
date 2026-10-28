import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import * as THREE from 'three';
import { CHAPTER_FRAG, CHAPTER_VERT } from './chapterShader';
import { useMotionReduced } from '../../lib/motionPref';
import { useOnScreen } from '../../lib/hooks';

function Liquid({ progress, still, onFrame }: { progress: RefObject<number>; still: boolean; onFrame: () => void }) {
  const { size, gl, invalidate } = useThree();
  const cur = useRef(progress.current ?? 0);
  const mouse = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const t = useRef(1.3);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CHAPTER_VERT,
        fragmentShader: CHAPTER_FRAG,
        uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uProg: { value: 0 }, uMouse: { value: new THREE.Vector2() } },
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      mouse.current.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      mouse.current.ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      if (still) invalidate();
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [gl, still, invalidate]);

  useEffect(() => {
    const onScroll = () => invalidate();
    if (still) window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [still, invalidate]);

  useFrame((_, dt) => {
    const target = progress.current ?? 0;
    // critically damped chase: the form follows the scroll with a little weight, never overshooting
    cur.current += (target - cur.current) * (still ? 1 : 1 - Math.exp(-dt * 6));
    if (!still) t.current += dt;
    const m = mouse.current;
    m.x += (m.tx - m.x) * (1 - Math.exp(-dt * 4));
    m.y += (m.ty - m.y) * (1 - Math.exp(-dt * 4));
    const buf = gl.getDrawingBufferSize(new THREE.Vector2());
    mat.uniforms.uRes!.value.copy(buf);
    mat.uniforms.uTime!.value = t.current;
    mat.uniforms.uProg!.value = cur.current;
    mat.uniforms.uMouse!.value.set(still ? 0 : m.x, still ? 0 : m.y);
    onFrame();
    if (still && Math.abs(target - cur.current) > 0.001) invalidate();
  });
  void size;
  return (
    <mesh frustumCulled={false} material={mat}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}

/** The liquid chapter object. `progress` is 0..4 (the chapter index as a float), written by the scroll handler. */
export default function ChapterScene({ progress, onReady }: { progress: RefObject<number>; onReady?: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(wrap, '80px');
  const reduced = useMotionReduced();
  const [dpr, setDpr] = useState(1.25);
  const ready = useRef(false);

  return (
    <div ref={wrap} className="absolute inset-0" aria-hidden>
      <Canvas
        dpr={dpr}
        frameloop={!onScreen ? 'never' : reduced ? 'demand' : 'always'}
        camera={{ position: [0, 0, 1] }}
        gl={{ alpha: true, antialias: false, powerPreference: 'high-performance', premultipliedAlpha: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <PerformanceMonitor onChange={({ factor }) => setDpr(Math.max(0.75, Math.min(1.25, 0.6 + 1.3 * factor)))} flipflops={3} />
        <Liquid
          progress={progress}
          still={reduced}
          onFrame={() => {
            if (!ready.current) {
              ready.current = true;
              onReady?.();
            }
          }}
        />
      </Canvas>
    </div>
  );
}
