/**
 * GLSL for the living rice field (hero + farmer-app header). One shared block of uniforms drives every material,
 * so sky, fog, light and wind always agree. Colours are authored directly in display space (no tone mapping),
 * which keeps the look predictable on every GPU.
 *
 * What the scene shows (it is not decoration):
 *  - the light follows the FORECAST: sun / rain / dusk are real states of the weather calendar,
 *  - the expanding ring is the satellite pass ("SEE"): inside it the field turns into a false-colour greenness map,
 *  - blades part around your cursor like wind.
 */
export const NOISE = /* glsl */ `
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  float a = hash21(i), b = hash21(i + vec2(1., 0.)), c = hash21(i + vec2(0., 1.)), d = hash21(i + vec2(1., 1.));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; }
  return v;
}
`;

/** Uniforms every material reads. */
export const SHARED_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uWet;
uniform float uRain;
uniform float uDensity;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunPower;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uStars;
uniform float uCloud;
uniform vec3 uBladeBase;
uniform vec3 uBladeMid;
uniform vec3 uBladeTip;
uniform vec2 uPointer;
uniform float uPointerOn;
uniform vec4 uScan;
uniform vec2 uHill;
`;

export const SKY_FN = /* glsl */ `
vec3 skyColor(vec3 rd){
  float h = clamp(rd.y, -0.25, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.5));
  float sd = max(dot(rd, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 7.0) * 0.2 + pow(sd, 70.0) * 0.5 + pow(sd, 5200.0) * 3.2) * uSunPower;
  col = mix(col, uHorizon * 1.06, exp(-abs(rd.y) * 15.0) * 0.4);
  if (rd.y > 0.0) {
    vec2 cp = rd.xz / (rd.y + 0.22) * 1.1 + vec2(uTime * 0.012, 0.0);
    float c = smoothstep(0.5, 0.95, fbm(cp * 1.25));
    vec3 cloudCol = mix(uHorizon, vec3(1.0), 0.66) * (0.92 + 0.45 * sd);
    col = mix(col, cloudCol, c * uCloud * smoothstep(0.0, 0.28, rd.y));
  }
  if (uStars > 0.01 && rd.y > 0.02) {
    vec2 sp = floor(rd.xz / (rd.y + 0.2) * 70.0);
    float st = step(0.9965, hash21(sp));
    col += vec3(st) * uStars * smoothstep(0.05, 0.45, rd.y) * (0.5 + 0.5 * sin(uTime * 2.0 + hash21(sp) * 30.0));
  }
  return col;
}
`;

export const SCAN_FN = /* glsl */ `
float scanFront(vec2 wp){ float d = length(wp - uScan.xy); float x = d - uScan.z; return (exp(-x * x / 0.8) * 0.8 + exp(-x * x / 6.0) * 0.35) * uScan.w; }
float scanTrail(vec2 wp){
  float behind = uScan.z - length(wp - uScan.xy);
  return smoothstep(0.0, 0.6, behind) * (1.0 - smoothstep(9.0, 26.0, behind)) * uScan.w;
}
float ndviAt(vec2 p){
  float n = fbm(p * 0.07 + 3.1);
  float stress = smoothstep(0.38, 0.72, fbm(p * 0.032 + 9.0));
  return clamp(0.74 - stress * 0.6 + (n - 0.5) * 0.5, 0.0, 1.0);
}
// a viridis-like ramp: clearly a data layer (never confused with the green of the crop itself)
vec3 ndviRamp(float v){
  vec3 c = mix(vec3(0.27, 0.00, 0.33), vec3(0.23, 0.32, 0.55), smoothstep(0.0, 0.3, v));
  c = mix(c, vec3(0.13, 0.57, 0.55), smoothstep(0.3, 0.55, v));
  c = mix(c, vec3(0.36, 0.78, 0.39), smoothstep(0.55, 0.8, v));
  return mix(c, vec3(0.99, 0.91, 0.14), smoothstep(0.8, 1.0, v));
}
`;

export const BLADE_VERT = /* glsl */ `
${SHARED_UNIFORMS}
${NOISE}
attribute vec3 iPos;
attribute vec4 iRand;
varying float vT;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec4 vRand;
varying float vPush;
varying float vMacro;

void main(){
  float t = position.y;
  float side = position.x;
  float az = iRand.x * 6.2831853;
  float lean = mix(0.10, 0.62, iRand.y * iRand.y);
  float h = mix(0.8, 1.3, iRand.z);
  vec3 dir = vec3(cos(az), 0.0, sin(az));
  vec3 right = vec3(-dir.z, 0.0, dir.x);

  float bend = lean * pow(t, 1.35);
  float droop = lean * 0.55 * pow(t, 2.6);
  vec3 p = dir * (bend * h * 0.85 + 0.035) + vec3(0.0, h * t - droop * h * 0.45, 0.0);

  vec2 wp = iPos.xz;
  float gust = vnoise(wp * 0.11 + vec2(uTime * 0.42, uTime * 0.17));
  float gust2 = vnoise(wp * 0.37 - vec2(uTime * 0.9, 0.0));
  float flutter = sin(uTime * 2.1 + iRand.x * 40.0 + wp.x * 1.3) * 0.5 + 0.5;
  float amp = uWind * (0.25 + 0.95 * gust) + 0.12 * gust2 * uWind;
  vec2 wdir = normalize(vec2(1.0, 0.28));
  float tt = pow(t, 1.7);
  p.xz += wdir * amp * tt * 0.5 * h;
  p.xz += vec2(-wdir.y, wdir.x) * (flutter - 0.5) * 0.08 * uWind * tt * h;
  p.y -= amp * tt * 0.12 * h;

  vec2 dd = wp - uPointer;
  float pd = length(dd);
  float push = smoothstep(2.8, 0.0, pd) * uPointerOn;
  p.xz += normalize(dd + vec2(1e-4)) * push * pow(t, 1.5) * 0.75 * h;
  p.y -= push * pow(t, 1.3) * 0.2 * h;
  vPush = push;

  vec3 root = vec3(iPos.x, 0.0, iPos.z);
  float dist = length(cameraPosition - root);
  float w = (1.0 - pow(t, 1.15)) * 0.046 * mix(0.8, 1.3, iRand.w);
  w *= (1.0 + clamp(dist * 0.03, 0.0, 1.9)) * mix(1.0, 1.55, 1.0 - uDensity);
  p += right * side * w;

  vec3 world = iPos + p;
  vWorld = world; vT = t; vRand = iRand;
  vMacro = fbm(iPos.xz * 0.06 + 4.0);
  vec3 tang = normalize(vec3(
    dir.x * lean * 1.35 * pow(max(t, 0.001), 0.35) * h * 0.85,
    h * (1.0 - 0.6 * lean * pow(t, 1.6)),
    dir.z * lean * 1.35 * pow(max(t, 0.001), 0.35) * h * 0.85));
  vNormal = normalize(cross(right, tang));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const BLADE_FRAG = /* glsl */ `
${SHARED_UNIFORMS}
${NOISE}
${SCAN_FN}
varying float vT;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec4 vRand;
varying float vPush;
varying float vMacro;

void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormal);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(uSunDir);
  float t = vT;

  float wrap = max(dot(N, L) * 0.6 + 0.4, 0.0);
  vec3 base = mix(uBladeBase, uBladeMid, smoothstep(0.0, 0.38, t));
  base = mix(vec3(0.34, 0.44, 0.24), base, smoothstep(0.0, 0.2, t));
  base = mix(base, uBladeTip, smoothstep(0.45, 1.0, t) * (0.55 + 0.45 * vRand.w));
  base *= (0.82 + 0.34 * vRand.z) * mix(0.78, 1.22, vMacro);
  base = mix(base, base * vec3(0.85, 0.95, 1.05), uWet * 0.6);

  vec3 amb = mix(uHorizon, uZenith, 0.55) * 0.5;
  float ao = mix(0.5, 1.0, smoothstep(0.0, 0.32, t));
  vec3 col = base * (amb + uSunColor * wrap * uSunPower * 0.95) * ao;

  float back = pow(max(dot(-V, L), 0.0), 2.2) * smoothstep(0.25, 1.0, t);
  col += uSunColor * base * back * 0.9 * uSunPower;
  vec3 H = normalize(L + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 36.0) * (0.10 + uWet * 0.35) * uSunPower * ao;
  col += uHorizon * 0.12 * pow(1.0 - max(dot(N, V), 0.0), 2.0) * (0.4 + uWet);

  float front = scanFront(vWorld.xz);
  float trail = scanTrail(vWorld.xz);
  vec3 nd = ndviRamp(ndviAt(vWorld.xz)) * (0.7 + 0.55 * wrap);
  col = mix(col, nd, trail * 0.9);
  col += vec3(1.0, 0.86, 0.5) * front * 3.4 * (0.4 + 0.6 * smoothstep(0.0, 0.5, t));

  col += vec3(1.0, 0.9, 0.7) * vPush * 0.05;

  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.35));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  col = 1.0 - exp(-col * 1.35);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const WATER_FRAG = /* glsl */ `
${SHARED_UNIFORMS}
${NOISE}
${SKY_FN}
${SCAN_FN}
varying vec3 vWorld;

float rippleRings(vec2 p){
  float acc = 0.0;
  vec2 g = floor(p / 1.35);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = g + vec2(float(i), float(j));
      float r = hash21(c);
      float ph = fract(uTime * (0.55 + 0.4 * hash21(c + 7.7)) + r);
      vec2 ctr = (c + vec2(hash21(c + 1.3), hash21(c + 5.1))) * 1.35;
      float d = length(p - ctr);
      float ring = sin((d - ph * 0.9) * 46.0) * smoothstep(0.0, 0.05, ph * 0.9 - d) * (1.0 - ph) * smoothstep(0.95, 0.0, d);
      acc += ring;
    }
  }
  return acc;
}

void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  vec2 p = vWorld.xz;

  float t = uTime;
  vec2 n1 = vec2(vnoise(p * 1.6 + vec2(t * 0.18, t * 0.07)), vnoise(p * 1.6 + 31.0 - vec2(t * 0.11, t * 0.2)));
  vec2 n2 = vec2(vnoise(p * 4.1 - vec2(t * 0.3, 0.0)), vnoise(p * 4.1 + 11.0 + vec2(0.0, t * 0.27)));
  vec2 slope = ((n1 - 0.5) * 0.045 + (n2 - 0.5) * 0.022) * (0.6 + uWind);
  float rr = rippleRings(p);
  slope += vec2(rr) * 0.035 * uRain;
  vec3 N = normalize(vec3(slope.x, 1.0, slope.y));

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyColor(R);
  float fres = 0.10 + 0.90 * pow(1.0 - max(dot(N, V), 0.0), 3.4);
  vec3 deep = mix(vec3(0.035, 0.075, 0.05), uHorizon * 0.18, 0.35);

  // dark, green-tinted reflection around each hill (paddy rows)
  float hs = vWorld.z > -26.0 ? uHill.x : uHill.y;
  vec2 cell = floor(p / hs + 0.5);
  vec2 ctr = cell * hs;
  float hd = length(p - ctr);
  float wdist = length(cameraPosition - vWorld);
  float ao = smoothstep(0.36 * hs, 0.05 * hs, hd) * (1.0 - smoothstep(7.0, 26.0, wdist)) * step(abs(p.x), 20.0);
  vec3 col = mix(deep, refl * 0.72, clamp(fres, 0.0, 1.0));
  col = mix(col, uBladeBase * 0.30 + deep * 0.45, ao * 0.8);

  vec3 H = normalize(normalize(uSunDir) + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 520.0) * 3.0 * uSunPower;

  float front = scanFront(p);
  float trail = scanTrail(p);
  vec2 gp = p / 1.8;
  vec2 gq = abs(fract(gp - 0.5) - 0.5) / fwidth(gp);
  float grid = 1.0 - min(min(gq.x, gq.y), 1.0);
  col = mix(col, col + ndviRamp(ndviAt(p)) * 0.28, trail * 0.6);
  col += vec3(1.0, 0.82, 0.42) * (front * 1.2 + grid * trail * 0.5);

  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.35));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
  col = 1.0 - exp(-col * 1.35);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

export const SKY_FRAG = /* glsl */ `
${SHARED_UNIFORMS}
${NOISE}
${SKY_FN}
varying vec3 vDir;
void main(){
  vec3 rd = normalize(vDir);
  gl_FragColor = vec4(skyColor(rd), 1.0);
}
`;

/** Distant tree line: a soft silhouette lost in the haze. */
export const TREE_VERT = /* glsl */ `
${NOISE}
varying vec3 vWorld;
varying float vTop;
void main(){
  float x = position.x;
  float prof = 1.1 + 0.9 * vnoise(vec2(x * 0.05, 1.0)) + 0.5 * vnoise(vec2(x * 0.7, 3.0));
  for (int k = -3; k <= 3; k++) {
    float cell = floor(x / 6.0) + float(k);
    float c = cell * 6.0 + hash11(cell * 1.7) * 5.0;
    float r = 1.4 + 2.2 * hash11(cell * 3.1 + 2.0);
    float top = (0.9 + 2.4 * hash11(cell * 5.3 + 4.0)) ;
    float u = (x - c) / r;
    prof = max(prof, top * sqrt(max(0.0, 1.0 - u * u)) + 0.6);
  }
  float y = mix(-1.5, prof, position.y + 0.5);
  vec4 w = modelMatrix * vec4(x, y, 0.0, 1.0);
  vWorld = w.xyz; vTop = position.y + 0.5;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
export const TREE_FRAG = /* glsl */ `
${SHARED_UNIFORMS}
varying vec3 vWorld;
varying float vTop;
void main(){
  vec3 col = mix(uFogColor * 0.8, vec3(0.07, 0.11, 0.075), 0.6);
  float dist = length(cameraPosition - vWorld);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 1.35));
  col = mix(col, uFogColor, clamp(fog, 0.0, 1.0) * 0.45);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const RAIN_VERT = /* glsl */ `
${SHARED_UNIFORMS}
attribute float aSeed;
attribute float aEnd;
varying float vA;
void main(){
  float speed = 15.0 + aSeed * 7.0;
  float H = 16.0;
  vec3 p = position;
  p.y = mod(p.y - uTime * speed, H);
  p.x += uWind * 0.35 * (p.y) * 0.12;
  p.y += aEnd * 0.7;
  p.x += aEnd * 0.06 * uWind;
  vA = uRain * (0.12 + 0.2 * aSeed) * smoothstep(0.0, 1.5, p.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
export const RAIN_FRAG = /* glsl */ `
varying float vA;
void main(){ gl_FragColor = vec4(0.78, 0.86, 0.92, vA); }
`;
