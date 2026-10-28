import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { PRESETS, type LightMode, type Preset } from './lightModes';
import { BLADE_FRAG, BLADE_VERT, RAIN_FRAG, RAIN_VERT, SKY_FRAG, SKY_VERT, TREE_FRAG, TREE_VERT, WATER_FRAG, WATER_VERT } from './riceShaders';

/* ---------------------------------------------------------------- shared uniforms */
export interface SceneUniforms {
  [k: string]: { value: unknown };
  uTime: { value: number };
  uWind: { value: number };
  uWet: { value: number };
  uRain: { value: number };
  uDensity: { value: number };
  uZenith: { value: THREE.Color };
  uHorizon: { value: THREE.Color };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uSunPower: { value: number };
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
  uStars: { value: number };
  uCloud: { value: number };
  uBladeBase: { value: THREE.Color };
  uBladeMid: { value: THREE.Color };
  uBladeTip: { value: THREE.Color };
  uPointer: { value: THREE.Vector2 };
  uPointerOn: { value: number };
  uScan: { value: THREE.Vector4 };
  uHill: { value: THREE.Vector2 };
}

const col = (c: [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);

function makeUniforms(p: Preset): SceneUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: p.wind },
    uWet: { value: p.wet },
    uRain: { value: p.rain },
    uDensity: { value: 1 },
    uZenith: { value: col(p.zenith) },
    uHorizon: { value: col(p.horizon) },
    uSunDir: { value: new THREE.Vector3(...p.sunDir) },
    uSunColor: { value: col(p.sunColor) },
    uSunPower: { value: p.sunPower },
    uFogColor: { value: col(p.fogColor) },
    uFogDensity: { value: p.fogDensity },
    uStars: { value: p.stars },
    uCloud: { value: p.cloud },
    uBladeBase: { value: col(p.bladeBase) },
    uBladeMid: { value: col(p.bladeMid) },
    uBladeTip: { value: col(p.bladeTip) },
    uPointer: { value: new THREE.Vector2(0, -999) },
    uPointerOn: { value: 0 },
    uScan: { value: new THREE.Vector4(0, -18, 0, 0) },
    uHill: { value: new THREE.Vector2(0.56, 0.8) },
  };
}

/* ---------------------------------------------------------------- blades */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ribbon(seg = 5): THREE.InstancedBufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < seg; i++) {
    const t = i / seg;
    pos.push(-1, t, 0, 1, t, 0);
  }
  pos.push(0, 1, 0);
  const idx: number[] = [];
  for (let i = 0; i < seg - 1; i++) {
    const a = 2 * i;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const l = 2 * (seg - 1);
  idx.push(l, l + 1, 2 * seg);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

interface Field {
  geo: THREE.InstancedBufferGeometry;
  total: number;
  near: number;
  far: number;
}

/** Paddy rows: hills in a grid with a little jitter, several leaves per hill. Shuffled so thinning is uniform. */
function buildField(level: 'high' | 'mid' | 'low', seed = 11): Field {
  const rnd = mulberry32(seed);
  const cfg = { high: { nS: 0.56, nK: 8, fS: 0.8, fK: 5 }, mid: { nS: 0.66, nK: 7, fS: 0.95, fK: 4 }, low: { nS: 0.82, nK: 6, fS: 1.15, fK: 4 } }[level];
  const list: number[] = [];
  const zone = (z0: number, z1: number, S: number, K: number, W: number) => {
    for (let z = z0; z > z1; z -= S) {
      for (let x = -W / 2; x < W / 2; x += S) {
        const hx = x + (rnd() - 0.5) * S * 0.18;
        const hz = z + (rnd() - 0.5) * S * 0.18;
        for (let k = 0; k < K; k++) {
          list.push(hx + (rnd() - 0.5) * 0.12, hz + (rnd() - 0.5) * 0.12, rnd(), rnd(), rnd(), rnd());
        }
      }
    }
  };
  zone(3.5, -26, cfg.nS, cfg.nK, 40);
  zone(-26, -90, cfg.fS, cfg.fK, 110);
  const n = list.length / 6;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const iPos = new Float32Array(n * 3);
  const iRand = new Float32Array(n * 4);
  order.forEach((src, dst) => {
    const o = src * 6;
    iPos[dst * 3] = list[o]!;
    iPos[dst * 3 + 1] = 0;
    iPos[dst * 3 + 2] = list[o + 1]!;
    iRand[dst * 4] = list[o + 2]!;
    iRand[dst * 4 + 1] = list[o + 3]!;
    iRand[dst * 4 + 2] = list[o + 4]!;
    iRand[dst * 4 + 3] = list[o + 5]!;
  });
  const geo = ribbon(5);
  geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
  geo.setAttribute('iRand', new THREE.InstancedBufferAttribute(iRand, 4));
  geo.instanceCount = n;
  return { geo, total: n, near: cfg.nS, far: cfg.fS };
}

/* ---------------------------------------------------------------- scene */
export interface RiceSceneProps {
  mode: LightMode;
  /** freeze time and wind (reduced motion / paused): the scene renders a still frame */
  still: boolean;
  /** 0..1, from the performance monitor: thins the field and widens blades to compensate */
  quality: number;
  level: 'high' | 'mid' | 'low';
  scanKey: number;
  compact?: boolean;
  /** called when a satellite scan starts or ends */
  onScan?: (active: boolean) => void;
}

export function RiceScene({ mode, still, quality, level, scanKey, compact, onScan }: RiceSceneProps) {
  const { camera, invalidate, gl, size } = useThree();
  const U = useMemo(() => makeUniforms(PRESETS[mode]), []); // eslint-disable-line react-hooks/exhaustive-deps
  const field = useMemo(() => buildField(level), [level]);
  U.uHill.value.set(field.near, field.far);
  if (import.meta.env.DEV) (window as unknown as { __klU: SceneUniforms }).__klU = U;
  const target = useRef<Preset>(PRESETS[mode]);
  const pointer = useRef({ x: 0, y: 0, last: 0, moved: false });
  const scan = useRef({ start: -1, wasActive: false, nextAuto: 2.4 });
  const time = useRef(still ? 1.7 : 0);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const camBase = useMemo(() => (compact ? new THREE.Vector3(0, 1.25, 5.2) : new THREE.Vector3(0, 2.7, 8.6)), [compact]);
  const lookAt = useMemo(() => (compact ? new THREE.Vector3(0, 1.0, -12) : new THREE.Vector3(0, 1.0, -14)), [compact]);
  const rainRef = useRef<THREE.LineSegments>(null);

  useEffect(() => {
    target.current = PRESETS[mode];
    invalidate();
  }, [mode, invalidate]);

  useEffect(() => {
    // a click on "scan" starts a pass now
    if (scanKey > 0) {
      scan.current.start = time.current;
      invalidate();
    }
  }, [scanKey, invalidate]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect();
      pointer.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.current.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      pointer.current.last = performance.now();
      pointer.current.moved = true;
      if (still) invalidate();
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => window.removeEventListener('pointermove', move);
  }, [gl, still, invalidate]);

  // materials
  const bladeMat = useMemo(
    () => new THREE.ShaderMaterial({ uniforms: U, vertexShader: BLADE_VERT, fragmentShader: BLADE_FRAG, side: THREE.DoubleSide }),
    [U],
  );
  const waterMat = useMemo(() => new THREE.ShaderMaterial({ uniforms: U, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG }), [U]);
  const skyMat = useMemo(() => new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false }), [U]);
  const treeMat = useMemo(() => new THREE.ShaderMaterial({ uniforms: U, vertexShader: TREE_VERT, fragmentShader: TREE_FRAG, side: THREE.DoubleSide }), [U]);
  const rainGeo = useMemo(() => {
    const n = compact ? 700 : 1700;
    const rnd = mulberry32(5);
    const pos = new Float32Array(n * 2 * 3);
    const seed = new Float32Array(n * 2);
    const end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * 30;
      const y = rnd() * 16;
      const z = 7 - rnd() * 34;
      const s = rnd();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        seed[i * 2 + k] = s;
        end[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    return g;
  }, [compact]);
  const rainMat = useMemo(() => new THREE.ShaderMaterial({ uniforms: U, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false }), [U]);

  useEffect(
    () => () => {
      [bladeMat, waterMat, skyMat, treeMat, rainMat].forEach((m) => m.dispose());
      rainGeo.dispose();
    },
    [bladeMat, waterMat, skyMat, treeMat, rainMat, rainGeo],
  );
  useEffect(() => () => field.geo.dispose(), [field]);

  // satellite pass (decorative, ~5 s every ~16 s) — also drives the scan ring
  useFrame((state, dt) => {
    const t = target.current;
    const k = 1 - Math.exp(-dt * 2.4);
    const lerpC = (c: THREE.Color, v: [number, number, number]) => {
      c.r += (v[0] - c.r) * k;
      c.g += (v[1] - c.g) * k;
      c.b += (v[2] - c.b) * k;
    };
    lerpC(U.uZenith.value, t.zenith);
    lerpC(U.uHorizon.value, t.horizon);
    lerpC(U.uSunColor.value, t.sunColor);
    lerpC(U.uFogColor.value, t.fogColor);
    lerpC(U.uBladeBase.value, t.bladeBase);
    lerpC(U.uBladeMid.value, t.bladeMid);
    lerpC(U.uBladeTip.value, t.bladeTip);
    U.uSunDir.value.x += (t.sunDir[0] - U.uSunDir.value.x) * k;
    U.uSunDir.value.y += (t.sunDir[1] - U.uSunDir.value.y) * k;
    U.uSunDir.value.z += (t.sunDir[2] - U.uSunDir.value.z) * k;
    U.uSunDir.value.normalize();
    const lerpN = (cur: number, to: number) => cur + (to - cur) * k;
    U.uSunPower.value = lerpN(U.uSunPower.value, t.sunPower);
    U.uFogDensity.value = lerpN(U.uFogDensity.value, t.fogDensity);
    U.uStars.value = lerpN(U.uStars.value, t.stars);
    U.uCloud.value = lerpN(U.uCloud.value, t.cloud);
    U.uWet.value = lerpN(U.uWet.value, t.wet);
    U.uRain.value = lerpN(U.uRain.value, t.rain);
    const windTarget = still ? Math.min(t.wind, 0.18) : t.wind;
    U.uWind.value = lerpN(U.uWind.value, windTarget);
    U.uDensity.value = quality;

    if (!still) time.current += dt;
    U.uTime.value = time.current;

    // pointer -> ground
    const p = pointer.current;
    if (p.moved) {
      ndc.set(p.x, p.y);
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(plane, hit)) {
        const off = -999;
        const cur = U.uPointer.value;
        if (cur.y < -900) cur.set(hit.x, hit.z);
        else {
          const kk = 1 - Math.exp(-dt * 9);
          cur.x += (hit.x - cur.x) * kk;
          cur.y += (hit.z - cur.y) * kk;
        }
        void off;
      }
    }
    const active = performance.now() - p.last < 1500 && p.moved;
    U.uPointerOn.value += ((active ? 1 : 0) - U.uPointerOn.value) * (1 - Math.exp(-dt * (active ? 8 : 2.2)));

    // scan: auto pass a few seconds after load, then every ~16 s; never while motion is still
    const s = scan.current;
    if (!still && s.start < 0 && time.current > s.nextAuto) s.start = time.current;
    let intensity = 0;
    let radius = 0;
    if (s.start >= 0) {
      const age = time.current - s.start;
      radius = age * 7.5;
      intensity = Math.min(1, age / 0.5) * (1 - Math.min(1, Math.max(0, (age - 4.4) / 1.2)));
      if (age > 5.7) {
        s.start = -1;
        s.nextAuto = time.current + 16;
        intensity = 0;
      }
    }
    U.uScan.value.set(0, -17, radius, intensity);
    const nowActive = s.start >= 0;
    if (nowActive !== s.wasActive) {
      s.wasActive = nowActive;
      onScan?.(nowActive);
    }

    // camera: slow drift + parallax; a still scene holds one calm pose
    const drift = still ? 0 : Math.sin(time.current * 0.11) * 0.28;
    const tx = camBase.x + drift + p.x * (compact ? 0.25 : 0.55);
    const ty = camBase.y + Math.sin(time.current * 0.09) * (still ? 0 : 0.05) + p.y * 0.14;
    camera.position.x += (tx - camera.position.x) * (1 - Math.exp(-dt * 2.2));
    camera.position.y += (ty - camera.position.y) * (1 - Math.exp(-dt * 2.2));
    camera.position.z = camBase.z;
    camera.lookAt(lookAt.x + p.x * 0.4, lookAt.y + p.y * 0.1, lookAt.z);

    if (rainRef.current) rainRef.current.visible = U.uRain.value > 0.02;

    // while the scene is still, keep drawing only until it has settled on the new light
    if (still) {
      const settling = Math.abs(U.uSunPower.value - t.sunPower) > 0.004 || Math.abs(U.uFogDensity.value - t.fogDensity) > 0.0004 || Math.abs(U.uRain.value - t.rain) > 0.01 || Math.abs(U.uWind.value - windTarget) > 0.004 || U.uPointerOn.value > 0.02;
      if (settling) state.invalidate();
    }
  });

  // keep the first frame crisp after a resize in demand mode
  useEffect(() => {
    invalidate();
  }, [size.width, size.height, invalidate]);

  return (
    <>
      <mesh material={skyMat} renderOrder={-10} frustumCulled={false}>
        <sphereGeometry args={[300, 32, 16]} />
      </mesh>
      <mesh position={[0, 0, -92]} material={treeMat} frustumCulled={false}>
        <planeGeometry args={[340, 1, 700, 1]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -40]} material={waterMat} frustumCulled={false}>
        <planeGeometry args={[260, 260]} />
      </mesh>
      {new URLSearchParams(window.location.search).get('dbg') === 'water' ? null : <mesh geometry={field.geo} material={bladeMat} frustumCulled={false} />}
      <lineSegments ref={rainRef} geometry={rainGeo} material={rainMat} frustumCulled={false} />
      <DensityDriver geo={field.geo} total={field.total} quality={quality} />
    </>
  );
}

/** Thin the field when the GPU struggles: the instances are shuffled, so fewer = uniformly sparser. */
function DensityDriver({ geo, total, quality }: { geo: THREE.InstancedBufferGeometry; total: number; quality: number }) {
  useEffect(() => {
    geo.instanceCount = Math.max(1000, Math.floor(total * (0.35 + 0.65 * quality)));
  }, [geo, total, quality]);
  return null;
}
