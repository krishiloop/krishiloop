/**
 * The five chapters (SEE, DECIDE, SPEAK, PROVE, LEARN) as ONE liquid object. It is a ray-marched signed-distance
 * field: the distance functions of two neighbouring shapes are blended, so the thing really melts from one form
 * into the next as you scroll (not a cross-fade). Each form carries meaning:
 *   SEE     a planet with a satellite on its orbit
 *   DECIDE  the traffic light, answer lamp lit
 *   SPEAK   voice bars
 *   PROVE   the seal with the tick (the stamp of a receipt)
 *   LEARN   the loop, with a new rule travelling round it
 */
export const CHAPTER_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const CHAPTER_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uProg;
uniform vec2 uMouse;
varying vec2 vUv;

mat2 rot(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
float sdSphere(vec3 p, float r){ return length(p) - r; }
float sdTorus(vec3 p, vec2 t){ vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float sdRoundBox(vec3 p, vec3 b, float r){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }

// material ids: 0 liquid metal, 1 red lamp, 2 amber lamp, 3 green (lit), 4 gold

vec2 shSee(vec3 p){
  float bump = 0.016 * sin(5.0 * p.x + uTime * 0.3) * sin(5.0 * p.y) * sin(5.0 * p.z);
  float d = sdSphere(p, 0.72) + bump;
  vec3 q = p; q.yz *= rot(0.55); q.xz *= rot(0.35);
  float ring = sdTorus(q, vec2(1.12, 0.014));
  float a = uTime * 0.7;
  vec3 sp = vec3(cos(a) * 1.12, 0.0, sin(a) * 1.12);
  float sat = sdRoundBox(q - sp, vec3(0.1, 0.03, 0.05), 0.02);
  vec2 r = vec2(min(d, ring), 0.0);
  if (sat < r.x) r = vec2(sat, 4.0);
  return r;
}

vec2 shDecide(vec3 p){
  float body = sdRoundBox(p, vec3(0.3, 0.8, 0.2), 0.16);
  vec2 r = vec2(body, 0.0);
  for (int i = 0; i < 3; i++) {
    float y = (1.0 - float(i)) * 0.55;
    float lamp = sdSphere(p - vec3(0.0, y, 0.22), 0.2);
    if (lamp < r.x) r = vec2(lamp, float(i) + 1.0);
  }
  return r;
}

vec2 shSpeak(vec3 p){
  float d = 1e9;
  for (int i = 0; i < 9; i++) {
    float fi = float(i) - 4.0;
    float h = 0.14 + 0.46 * abs(sin(uTime * 2.1 + fi * 0.85)) * (0.55 + 0.45 * cos(fi * 1.1 + uTime * 0.7));
    d = smin(d, sdCapsule(p, vec3(fi * 0.19, -h, 0.0), vec3(fi * 0.19, h, 0.0), 0.07), 0.07);
  }
  return vec2(d, 0.0);
}

vec2 shProve(vec3 p){
  vec3 q = p; q.xy *= rot(-0.12);
  float r = length(q.xy);
  float a = atan(q.y, q.x);
  float R = 0.8 + 0.03 * cos(a * 20.0);
  vec2 d2 = vec2(r - R, abs(q.z) - 0.085);
  float disc = min(max(d2.x, d2.y), 0.0) + length(max(d2, 0.0)) - 0.035;
  float groove = length(vec2(r - 0.62, q.z - 0.085)) - 0.026;
  disc = max(disc, -groove);
  float tick = smin(
    sdCapsule(q, vec3(-0.27, -0.01, 0.09), vec3(-0.08, -0.23, 0.09), 0.058),
    sdCapsule(q, vec3(-0.08, -0.23, 0.09), vec3(0.3, 0.25, 0.09), 0.058), 0.04);
  vec2 res = vec2(disc, 4.0);
  if (tick < disc + 0.03) res = vec2(smin(disc, tick, 0.03), 3.0);
  return res;
}

vec2 shLearn(vec3 p){
  float torus = sdTorus(p.xzy, vec2(0.72, 0.15));
  float a = uTime * 0.9;
  vec3 b = vec3(cos(a) * 0.72, sin(a) * 0.72, 0.0);
  float bulb = sdSphere(p - b, 0.26);
  float d = smin(torus, bulb, 0.14);
  float a2 = -uTime * 0.55 + 2.0;
  vec3 g = vec3(cos(a2) * 0.36, sin(a2) * 0.36, 0.0);
  float seed = sdSphere(p - g, 0.07);
  vec2 r = vec2(d, 0.0);
  if (seed < r.x) r = vec2(seed, 4.0);
  return r;
}

vec2 shape(int id, vec3 p){
  vec2 r = vec2(1e9, 0.0);
  if (id == 0) r = shSee(p);
  else if (id == 1) r = shDecide(p);
  else if (id == 2) r = shSpeak(p);
  else if (id == 3) r = shProve(p);
  else r = shLearn(p);
  return r;
}

vec2 map(vec3 p){
  p.xz *= rot(0.38 * sin(uTime * 0.35) + uMouse.x * 0.55);
  p.yz *= rot(0.12 * sin(uTime * 0.27) - uMouse.y * 0.3);
  float s = clamp(uProg, 0.0, 4.0);
  float fi = floor(min(s, 3.9999));
  float f = smoothstep(0.24, 0.76, s - fi);
  vec2 a = shape(int(fi), p);
  if (f < 0.002) return a;
  vec2 b = shape(int(fi) + 1, p);
  return vec2(mix(a.x, b.x, f), f < 0.5 ? a.y : b.y);
}

vec3 calcNormal(vec3 p){
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0011;
  return normalize(k.xyy * map(p + k.xyy * e).x + k.yyx * map(p + k.yyx * e).x + k.yxy * map(p + k.yxy * e).x + k.xxx * map(p + k.xxx * e).x);
}

vec3 envMap(vec3 r){
  vec3 sky = mix(vec3(0.015, 0.03, 0.025), vec3(0.42, 0.52, 0.45), smoothstep(-0.35, 1.0, r.y));
  float b1 = smoothstep(0.62, 0.92, dot(r, normalize(vec3(-0.6, 0.7, 0.55))));
  float b2 = smoothstep(0.8, 0.96, dot(r, normalize(vec3(0.85, 0.25, 0.4))));
  float rim = smoothstep(0.7, 1.0, dot(r, normalize(vec3(0.0, -0.4, -1.0))));
  return sky + vec3(1.0, 0.94, 0.82) * b1 * 1.25 + vec3(0.75, 0.88, 1.0) * b2 * 0.7 + vec3(0.94, 0.79, 0.42) * rim * 0.5;
}

vec3 shade(vec3 p, vec3 rd, float m){
  vec3 n = calcNormal(p);
  vec3 L = normalize(vec3(-0.5, 0.8, 0.6));
  float dif = clamp(dot(n, L), 0.0, 1.0);
  float ndv = clamp(dot(n, -rd), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 refl = envMap(reflect(rd, n));
  float ao = clamp(map(p + n * 0.08).x / 0.08, 0.35, 1.0);
  vec3 base = vec3(0.05, 0.13, 0.09);
  vec3 col;
  if (m < 0.5) {
    col = base * (0.35 + 0.9 * dif) + refl * (0.28 + 0.6 * fres);
  } else if (m > 3.5) {
    vec3 gold = vec3(0.94, 0.79, 0.42);
    col = gold * (0.25 + 0.75 * dif) * 0.8 + refl * gold * (0.55 + 0.5 * fres);
  } else {
    vec3 lamp = m < 1.5 ? vec3(1.0, 0.34, 0.26) : m < 2.5 ? vec3(1.0, 0.69, 0.18) : vec3(0.26, 0.92, 0.46);
    float lit = m > 2.5 ? 0.9 + 0.1 * sin(uTime * 2.4) : 0.1;
    col = lamp * (0.12 + lit * 1.15) * (0.6 + 0.4 * dif) + refl * 0.25 * fres;
  }
  col *= mix(0.55, 1.0, ao);
  col += vec3(0.94, 0.79, 0.42) * fres * 0.18;
  return col;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  vec3 ro = vec3(0.0, 0.0, 4.75);
  vec3 rd = normalize(vec3(uv, -1.9));
  float t = 0.0;
  float minD = 1e9;
  float tMin = 0.0;
  vec2 h = vec2(1.0, 0.0);
  float hitT = -1.0;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    h = map(p);
    if (h.x < minD) { minD = h.x; tMin = t; }
    if (h.x < 0.0009 * t) { hitT = t; break; }
    t += h.x * 0.72;
    if (t > 9.0) break;
  }
  float pw = max(tMin, 1.0) / (1.9 * min(uRes.x, uRes.y));
  float cover = hitT > 0.0 ? 1.0 : (1.0 - smoothstep(0.0, pw * 1.6, minD));
  if (cover <= 0.001) { gl_FragColor = vec4(0.0); return; }
  float ts = hitT > 0.0 ? hitT : tMin;
  vec3 p = ro + rd * ts;
  float m = map(p).y;
  vec3 col = shade(p, rd, m);
  col = 1.0 - exp(-col * 1.5);
  gl_FragColor = vec4(col * cover, cover);
}
`;
