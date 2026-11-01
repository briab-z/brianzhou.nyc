/*
 * WebGL2 painter for the landscape: sky, clouds, rock walls, scree, lake,
 * forests and meadows, composited front to back in a single pass.
 *
 * Surfaces carry their own colour (albedo) and a surface normal; the light
 * comes from uniforms set by sky.js, so the same valley works at noon, at
 * sunset and under the moon.
 */
(function () {
  'use strict';

  const D = (window.Dolo = window.Dolo || {});

  const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

  const FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPar;
uniform vec3 uView;      // vertical offset, scale, camera s
uniform float uDpr;
uniform sampler2D uRidge;
uniform vec3 uRidgeInfo; // s min, s max, samples
uniform vec4 uLake;      // s, y, half width, foot of the massif (mirror base)
uniform vec2 uHut;
uniform vec4 uRip[8];    // s, y, start time, strength
uniform int uPass;       // 0: the scene; 1, 2: bake meadow or forest trees; 3: bake the far scene
uniform sampler2D uTreesP;
uniform sampler2D uTreesF;
uniform sampler2D uFar;
uniform float uBakeM;    // margin in device px around the baked layers
uniform float uCoverF;   // device px per cell of the tree cover map

uniform vec3 uSunDir;    // key light, view space: x right, y up, z toward us
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uZen;
uniform vec3 uMid;
uniform vec3 uHor;
uniform vec4 uGlow;      // colour, strength
uniform float uGlowX;    // screen x of the glow, 0..1
uniform vec3 uHaze;
uniform vec4 uMoon;      // css px x, y from top, radius, phase
uniform float uMoonK;
uniform float uStars;
uniform float uLamp;
uniform float uDay;
uniform float uMist;

out vec4 outColor;

float PX = 0.001;

const vec2 PARK = vec2(0.02, 0.008);
const float D0 = 0.03;
const float D1 = 0.07;
const float D2 = 0.12;
const float D3 = 0.32;
const float D4 = 0.55;
const float D5 = 0.8;

// Albedo, as the surfaces would look under plain white light.
const vec3 LIME = vec3(0.83, 0.80, 0.74);
const vec3 LIME_GREY = vec3(0.67, 0.66, 0.64);
const vec3 OCHRE = vec3(0.86, 0.63, 0.44);
const vec3 STREAK = vec3(0.32, 0.31, 0.32);
const vec3 SNOW = vec3(0.95, 0.96, 0.99);
const vec3 SCREE = vec3(0.64, 0.62, 0.59);
const vec3 GRASS_G = vec3(0.33, 0.44, 0.19);
const vec3 GRASS_Y = vec3(0.60, 0.55, 0.27);
const vec3 GRASS_R = vec3(0.62, 0.42, 0.24);
const vec3 SPRUCE = vec3(0.085, 0.16, 0.11);
const vec3 MUGO = vec3(0.16, 0.25, 0.13);
const vec3 SPRUCE_TIP = vec3(0.17, 0.27, 0.15);
const vec3 LARCH = vec3(0.82, 0.64, 0.30);
const vec3 TRUNK = vec3(0.26, 0.19, 0.13);
const vec3 LARCH_DEEP = vec3(0.6, 0.42, 0.18);
const vec3 WATER_DEEP = vec3(0.025, 0.12, 0.11);
const vec3 WATER_SHALLOW = vec3(0.17, 0.38, 0.31);
const vec3 SAND = vec3(0.64, 0.59, 0.50);
const vec3 F_CREAM = vec3(0.96, 0.93, 0.87);
const vec3 F_PINK = vec3(0.89, 0.63, 0.65);
const vec3 F_VIOLET = vec3(0.66, 0.55, 0.77);
const vec3 F_YELLOW = vec3(0.92, 0.78, 0.37);
const vec3 HUT_WOOD = vec3(0.50, 0.33, 0.22);
const vec3 HUT_ROOF = vec3(0.30, 0.24, 0.21);
const vec3 HUT_STONE = vec3(0.72, 0.68, 0.62);
const vec3 LAMP = vec3(1.0, 0.70, 0.36);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return s / 0.96875;
}

float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p = p * 2.07 + vec2(5.3, 11.7);
    a *= 0.5;
  }
  return s / 0.875;
}

float ridgedN(vec2 p) {
  return 1.0 - abs(vnoise(p) * 2.0 - 1.0);
}

vec4 ridge(int row, float s) {
  float u = (s - uRidgeInfo.x) / (uRidgeInfo.y - uRidgeInfo.x) * (uRidgeInfo.z - 1.0);
  u = clamp(u, 0.0, uRidgeInfo.z - 1.001);
  float fi = floor(u);
  int i = int(fi);
  vec4 a = texelFetch(uRidge, ivec2(i, row), 0);
  vec4 b = texelFetch(uRidge, ivec2(i + 1, row), 0);
  return mix(a, b, u - fi);
}

void comp(inout vec3 acc, inout float A, vec3 c, float a) {
  acc += (1.0 - A) * a * c;
  A += (1.0 - A) * a;
}

// Direct light plus light from the open sky. ao darkens crevices, sh is the
// share of direct light that is not blocked.
vec3 shade(vec3 alb, vec3 N, float ao, float sh) {
  float d = clamp(dot(N, uSunDir), 0.0, 1.0) * sh;
  float sky = ao * (0.5 + 0.32 * clamp(N.y, -0.5, 1.0));
  return alb * (uSunCol * d * 0.78 + uAmb * sky);
}

/* Sky ------------------------------------------------------------------- */

vec3 skyBase(float y) {
  vec3 c = mix(uZen, uMid, smoothstep(-0.3, 0.3, y));
  return mix(c, uHor, smoothstep(0.26, 0.6, y));
}

float starField(vec2 cp, float cell, float dens, float seed) {
  vec2 g = cp / cell;
  vec2 id = floor(g);
  float h = hash12(id + seed);
  if (h > dens) return 0.0;
  vec2 pos = vec2(hash12(id + seed + 3.1), hash12(id + seed + 7.7)) * 0.7 + 0.15;
  float d = length((fract(g) - pos) * cell);
  float b = pow(hash12(id + seed + 13.3), 4.0);
  float r = 0.45 + 1.1 * b;
  float tw = 0.72 + 0.28 * sin(uTime * (0.8 + 2.6 * hash12(id + 5.5)) + h * 60.0);
  return smoothstep(r + 0.7, r - 0.3, d) * (0.3 + 0.9 * b) * tw;
}

vec3 sky(float s, float y, vec2 fc) {
  vec3 c = skyBase(y);

  // Afterglow on the horizon where the sun went down (or will come up).
  float gs = (uGlowX - 0.5) * uRes.x / uRes.y / uView.y + uView.z;
  float gd = length(vec2((s - gs) * 0.5, (y - 0.62) * 1.5));
  c = mix(c, uGlow.rgb, clamp(exp(-gd * 2.2) * uGlow.a, 0.0, 1.0));

  // Stars and the Milky Way.
  if (uStars > 0.01) {
    vec2 cp = vec2(fc.x, uRes.y - fc.y) / uDpr;
    float fade = uStars * smoothstep(0.62, 0.3, y) * (1.0 - 0.55 * uMoonK);
    vec2 mw = vec2(s, y) - vec2(0.3, 0.1);
    float band = exp(-pow(dot(mw, normalize(vec2(0.55, 1.0))) / 0.13, 2.0));
    float dust = fbm(vec2(s * 5.0, y * 5.0) + 3.0);
    float lane = smoothstep(0.45, 0.7, fbm3(vec2(s * 9.0 + 2.0, y * 9.0)));
    float milky = band * smoothstep(0.35, 0.8, dust) * (1.0 - 0.6 * lane);
    c += vec3(0.62, 0.6, 0.72) * milky * 0.09 * fade;
    float st = starField(cp, 9.0, 0.16 + 0.25 * band, 1.0) + starField(cp, 23.0, 0.35, 41.0) * 1.2;
    c += vec3(0.95, 0.93, 1.0) * st * fade;
  }

  // The moon, with its real phase.
  if (uMoonK > 0.01) {
    vec2 mp = vec2(fc.x, uRes.y - fc.y) / uDpr;
    float r = uMoon.z;
    vec2 dv = (mp - uMoon.xy) / r;
    float d = length(dv);
    float halo = exp(-max(d - 1.0, 0.0) * 1.7) * 0.28 + exp(-max(d - 1.0, 0.0) * 0.35) * 0.08;
    float full = 1.0 - abs(uMoon.w - 0.5) * 2.0;
    c += vec3(0.75, 0.78, 0.9) * halo * uMoonK * uStars * (0.3 + 0.7 * smoothstep(0.1, 0.6, full));
    if (d < 1.0 + 1.5 / r) {
      vec3 n = vec3(dv, sqrt(max(0.0, 1.0 - d * d)));
      float ang = uMoon.w * 6.2831853;
      vec3 l = vec3(sin(ang), 0.0, -cos(ang));
      float lit = smoothstep(-0.06, 0.08, dot(n, l));
      float maria = smoothstep(0.45, 0.75, fbm3(dv * 2.2 + 7.0));
      vec3 face = vec3(0.97, 0.95, 0.88) * (1.0 - 0.18 * maria);
      vec3 m = mix(c + vec3(0.02, 0.025, 0.04) * uStars, face, lit * mix(0.55, 1.0, uStars));
      float a = clamp((1.0 - d) * r + 0.5, 0.0, 1.0) * uMoonK;
      c = mix(c, m, a);
    }
  }

  float t = uTime;
  vec3 cloudLit = uAmb * 0.7 + uSunCol * mix(0.92, 0.4, uStars);
  vec3 cloudSh = uAmb * mix(0.95, 0.6, uStars) + uSunCol * 0.18;
  float cloudK = 1.0 - 0.45 * uStars;

  // High drifting streaks.
  vec2 p = vec2(s * 1.15 + t * 0.0045, y * 6.5);
  vec2 w = vec2(fbm3(p * 0.8 + vec2(0.0, t * 0.003)), fbm3(p * 0.8 + vec2(4.7, 1.3)));
  float n = fbm(p + w * 0.9);
  float bandA = smoothstep(0.02, 0.16, y) * (1.0 - smoothstep(0.4, 0.6, y));
  float dA = smoothstep(0.56, 0.78, n + bandA * 0.1) * bandA;
  if (dA > 0.002) {
    float nl = fbm(p + w * 0.9 + vec2(-0.12 * sign(uSunDir.x + 1e-4), -0.3));
    float lit = clamp((n - nl) * 3.5 + 0.55, 0.0, 1.0);
    vec3 cc = mix(cloudSh, cloudLit, lit);
    c = mix(c, mix(cc, skyBase(y), 0.2), dA * 0.6 * cloudK);
  }

  // Heaped cumulus resting low behind the peaks, flat based, lit on top.
  float lowBand = smoothstep(0.22, 0.34, y) * smoothstep(0.55, 0.5, y);
  if (lowBand > 0.0) {
    vec2 q = vec2(s * 2.3 + t * 0.0028, y * 5.2);
    float rise = (0.53 - y) / 0.22;
    float patchy = smoothstep(0.3, 0.62, vnoise(vec2(s * 1.4 + t * 0.0015, 3.0)));
    float k = fbm(q) * 1.15 - rise * 0.55 - 0.12;
    float dc = smoothstep(0.18, 0.34, k * patchy) * lowBand;
    if (dc > 0.002) {
      float kl = fbm(q + vec2(-0.18 * sign(uSunDir.x + 1e-4), -0.22)) * 1.15 - (rise + 0.04) * 0.55 - 0.12;
      float lit = clamp((k - kl) * 4.0 + 0.45 + (rise - 0.5) * 0.4, 0.0, 1.0);
      vec3 cc = mix(cloudSh, cloudLit, lit);
      c = mix(c, mix(cc, skyBase(y), 0.25), dc * 0.9 * cloudK);
    }
  }
  return c;
}

/* Rock ------------------------------------------------------------------ */

// Voronoi cells in a stretched space: the faces of broken limestone.
// Returns the nearest cell's id and the gap to the next cell (0 on a joint).
vec3 facet(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash12(n + g), hash12(n + g + 17.7)) * 0.8 + 0.1;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = n + g;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec3(id, sqrt(d2) - sqrt(d1));
}

// Grass below the walls, with dark mats of mountain pine.
vec3 slopeColor(float s, float y, float freq, float nxMacro, vec3 meadow, float ao, float belt) {
  float gl = vnoise(vec2(s * 40.0 * freq, y * 30.0));
  vec3 N = normalize(vec3(nxMacro * 0.15 + (gl - 0.5) * 0.5, 0.55, 0.85));
  vec3 alb = meadow * 0.92;
  float mugo = smoothstep(0.58, 0.66, fbm3(vec2(s * 90.0 * freq, y * 210.0 * freq) + 7.0))
             * smoothstep(0.45, 0.65, vnoise(vec2(s * 14.0 * freq, 4.0))) * belt;
  if (mugo > 0.0) {
    float bump = vnoise(vec2(s * 1400.0 * freq, y * 1600.0 * freq));
    alb = mix(alb, MUGO * (0.8 + 0.4 * bump), mugo);
    N = normalize(N + vec3((bump - 0.5) * 0.8 * mugo, 0.0, 0.0));
    ao *= 1.0 - 0.2 * mugo * (1.0 - bump);
  }
  return shade(alb, N, ao, 1.0);
}

// s, y: position. top, cb, sb: crest, foot of the cliffs, foot of the scree.
// row: the layer's relief row. freq: detail scale (higher for far layers).
vec3 rockLayerColor(float s, float y, float top, float cb, float sb, int row, float freq) {
  float depth = y - top;
  float wallH = max(cb - top, 0.012);
  float v = clamp(depth / wallH, 0.0, 1.0);

  // The broad shape: the face under each tower follows the crest's slope.
  float h = 0.0025;
  vec4 Ea = ridge(row, s - h);
  vec4 Eb = ridge(row, s + h);
  vec3 dE = (Eb.yzw - Ea.yzw) / (2.0 * h);
  float slope = mix(mix(dE.x, dE.y, smoothstep(0.0, 0.3, v)), dE.z, smoothstep(0.25, 0.85, v));
  float nxMacro = clamp(-slope * 0.8, -1.5, 1.5);

  // Columns of rock, taller than wide, leaning with the wall.
  float warp = (vnoise(vec2(y * 18.0 * freq, s * 7.0)) - 0.5) * 0.9;
  vec2 q = vec2(s * 62.0 * freq + warp, y * 9.0 * freq);
  vec3 F1 = facet(q);
  vec3 F2 = facet(q * vec2(2.6, 2.2) + 31.0);
  float f1a = hash12(F1.xy + 3.7);
  float f1b = hash12(F1.xy + 9.1);
  float f2a = hash12(F2.xy + 5.3);
  float f2b = hash12(F2.xy + 1.9);

  // Talus fans spill from the gullies; between them grass climbs to the
  // foot of the walls. Each gully cuts a narrow notch up into the cliff.
  float reach = sb - cb;
  float cf = 7.0 * freq;
  float ci = floor(s * cf);
  float notch = 0.0;
  float gul = 0.0;
  float fan = -1.0;
  float fanU = 0.0;
  float fanV = 1.0;
  float fanA = 0.0;
  for (int k = -1; k <= 1; k++) {
    float id = ci + float(k);
    float ax = (id + 0.2 + 0.6 * hash12(vec2(id, 5.0 + freq))) / cf;
    float hN = hash12(vec2(id, 2.0 + freq));
    float ds = s - ax;
    // Only a real wall sheds a fan.
    vec4 W = ridge(row - 1, ax);
    float shed = smoothstep(0.01, 0.035, W.y - W.x) * step(0.3, hash12(vec2(id, 11.0 + freq)));
    float nw = (0.004 + 0.005 * hN) / freq;
    notch = max(notch, (1.0 - abs(ds) / nw) * shed);
    // Above it a shadowed couloir climbs part way up the wall.
    float vc = smoothstep(0.55 - 0.4 * hN, 0.75 - 0.4 * hN, v);
    float wC = nw * (0.25 + 0.45 * vc);
    gul = max(gul, smoothstep(wC, wC * 0.7, abs(ds)) * vc * shed);
    float apex = cb + wallH * (0.04 - 0.1 * shed);
    float dA = y - apex;
    if (dA > 0.0) {
      float len = reach * (0.35 + 1.5 * pow(hash12(vec2(id, 8.0 + freq)), 1.5)) * shed / sqrt(freq);
      float hw = 0.0012 / freq + dA * (0.3 + 0.25 * hN) + dA * dA / max(reach, 0.01) * (0.9 + 0.6 * hN);
      float rr = length(vec2(ds * 0.7, dA));
      float d = min(hw - abs(ds), len - rr);
      if (d > fan) {
        fan = d;
        fanU = ds / hw;
        fanV = rr / len;
        fanA = ds / (dA + 0.002);
      }
    }
  }
  float cbL = cb + wallH * (0.04 - 0.1 * notch)
            + (vnoise(vec2(s * 90.0 * freq, 5.0)) - 0.5) * wallH * 0.1
            + (vnoise(vec2(s * 260.0 * freq, 5.0)) - 0.5) * 0.004 / freq;

  if (y < cbL) {
    float nx = nxMacro + (f1a - 0.5) * 1.15 + (f2a - 0.5) * 0.5;
    float ny = 0.08 + (f1b - 0.45) * 0.42 + (f2b - 0.5) * 0.2;
    vec3 N = normalize(vec3(nx, ny, 1.0));

    // Neighbouring towers block a low sun.
    float sideLight = uSunDir.x / max(0.2, abs(uSunDir.z) + 0.15);
    float sh = 1.0 - gul * 0.4;
    float e0 = ridge(row, s).z;
    for (int i = 1; i <= 3; i++) {
      float k = float(i) * 0.011;
      float e = ridge(row, s + sign(uSunDir.x) * k).z;
      sh = min(sh, smoothstep(-0.004, 0.006, k * 0.5 / max(abs(sideLight), 0.05) - (e - e0) * 1.6));
    }
    sh = mix(1.0, sh, smoothstep(0.02, 0.15, v));

    // Joints between blocks are dark cracks; the big ones run deep.
    float jw = 0.06 * freq;
    float crack = smoothstep(jw, 0.0, F1.z) * 0.6 + smoothstep(jw * 0.6, 0.0, F2.z) * 0.25;
    float ao = (1.0 - crack * 0.75) * (1.0 - gul * 0.35);

    float big = fbm3(vec2(s * 5.0 * freq, y * 2.5 * freq));
    vec3 alb = mix(LIME, LIME_GREY, smoothstep(0.4, 0.85, big));
    float och = smoothstep(0.6, 0.8, fbm3(vec2(s * 9.0 * freq + 4.0, y * 3.0 * freq)));
    alb = mix(alb, OCHRE, och * 0.45);
    alb *= 0.9 + 0.16 * f1b;
    // Black water stains running down below a few blocks.
    float st = smoothstep(0.62, 0.9, vnoise(vec2(s * 380.0 * freq, y * 5.0 * freq)))
             * step(0.62, hash12(vec2(F1.x, 3.3))) * smoothstep(0.1, 0.5, v);
    alb = mix(alb, STREAK, st * 0.5);
    alb *= 0.93 + 0.1 * vnoise(vec2(s * 1200.0 * freq, y * 300.0 * freq));

    // First snow of the season on the tops of blocks, high up.
    float snowy = smoothstep(0.25, 0.45, N.y) * smoothstep(0.7, 0.2, v) * 0.7;
    snowy *= smoothstep(0.35, 0.55, vnoise(vec2(s * 70.0 * freq, y * 24.0 * freq) + 9.0));
    alb = mix(alb, SNOW, clamp(snowy, 0.0, 1.0) * 0.8);

    vec3 c = shade(alb, N, ao, sh);
    // Early snow lies on the flatter tops and ledges just below them.
    float flatTop = smoothstep(0.8, 0.2, abs(dE.x));
    float capD = (0.0025 + 0.006 * vnoise(vec2(s * 150.0 * freq, 1.7)) + 0.002 * vnoise(vec2(s * 900.0 * freq, 3.1))) / sqrt(freq) * flatTop;
    float cap = clamp((capD - depth) / PX + 0.5, 0.0, 1.0) * smoothstep(0.3, 0.5, vnoise(vec2(s * 400.0 * freq, y * 200.0 * freq)));
    c = mix(c, shade(SNOW, normalize(vec3(nx * 0.3, 0.75, 0.65)), 1.0, sh), cap * 0.9);
    // Thin bright line along the crest when lit from the side.
    c += alb * uSunCol * exp(-depth * 1400.0 / freq) * 0.25 * abs(uSunDir.x);
    return c;
  }

  float m = fbm3(vec2(s * 30.0, y * 60.0));
  vec3 meadow = mix(GRASS_G, GRASS_Y, 0.25 + 0.35 * m);
  float dy = y - cbL;
  if (dy < reach * 2.0) {
    // A thin apron of rubble along the whole foot, and the fans below.
    float patchy = (fbm3(vec2(s * 60.0 * freq, y * 12.0 * freq)) - 0.5) * reach * 0.3;
    float apron = reach * (0.02 + 0.22 * smoothstep(0.35, 0.8, vnoise(vec2(s * 45.0 * freq, 3.0)))) * smoothstep(0.01, 0.035, cb - top) - dy;
    float rag = (vnoise(vec2(s * 700.0 * freq, y * 300.0 * freq)) - 0.5) * 0.003 / freq;
    float d = max(fan - patchy * (0.35 + 0.65 * smoothstep(0.3, 1.0, fanV)), apron - patchy * 0.3) + rag;
    // Grass and stones mingle at the edge.
    float tuft = hash12(floor(vec2(s, y) / (PX * vec2(2.0, 1.5))));
    float inScree = clamp(d / (PX * 1.5) + 0.5 + (tuft - 0.5) * 0.8 * smoothstep(0.004, 0.0, abs(d)), 0.0, 1.0);

    vec3 grassC = slopeColor(s, y, freq, nxMacro, meadow, 0.85 + 0.15 * smoothstep(0.0, reach, dy), smoothstep(reach * 0.4, reach * 1.2, dy));
    if (inScree > 0.0) {
      bool onFan = fan > apron;
      float u = onFan ? fanU : 0.0;
      float vv = onFan ? fanV : 0.2;
      // Cones: rounded across, steepest near the apex.
      vec3 N = normalize(vec3(u * 0.4 + nxMacro * 0.1, 0.36 + 0.2 * vv, 0.85));
      vec3 alb = SCREE * (0.9 + 0.06 * vnoise(vec2(s * 40.0 * freq, 1.0)));
      // Stones roll along the fall line, the big ones furthest.
      float runnel = vnoise(vec2(fanA * 9.0, vv * 2.0 + floor(s * cf)));
      alb *= 0.88 + 0.18 * runnel;
      alb *= mix(1.03, 0.9, vv);
      alb *= 0.95 + 0.08 * hash12(floor(vec2(s, y) / (PX * vec2(1.5, 1.0))));
      alb *= 0.96 + 0.06 * vnoise(vec2(s * 1500.0, y * 1100.0));
      alb = mix(alb, meadow * 0.85, smoothstep(0.65, 1.0, vv) * 0.3);
      // The wall shades the top of the fan.
      float foot = smoothstep(reach * 0.2, 0.0, dy);
      vec3 sc = shade(alb, N, 1.0 - foot * 0.1, 1.0 - foot * 0.15);
      return mix(grassC, sc, inScree);
    }
    return grassC;
  }
  return slopeColor(s, y, freq, nxMacro, meadow, 1.0, smoothstep(reach * 4.0, reach * 2.5, dy));
}

void layerFar(float s, float y, inout vec3 acc, inout float A) {
  float ss = s + uPar.x * PARK.x * D0;
  float yy = y + uPar.y * PARK.y * D0;
  float top = ridge(0, ss).x + (vnoise(vec2(ss * 400.0, 0.5)) - 0.5) * 0.0015;
  float a = clamp((yy - top) / PX + 0.5, 0.0, 1.0);
  if (a <= 0.0) return;
  float d = yy - top;
  // Distant ranges: snowy tops lit faintly, the rest lost in haze.
  float face = vnoise(vec2(ss * 60.0, yy * 8.0));
  float lit = smoothstep(0.35, 0.65, face) * smoothstep(0.03, 0.0, d);
  vec3 alb = mix(LIME, SNOW, 0.5);
  vec3 c = shade(alb, normalize(vec3(face - 0.5, 0.4, 1.0)), 0.9, 1.0);
  c = mix(c, uHaze, 0.72 - 0.12 * lit);
  c = mix(c, skyBase(yy) * 0.97, 0.18 * smoothstep(0.0, 0.05, d));
  comp(acc, A, c, a);
}

void layerMidfar(float s, float y, inout vec3 acc, inout float A) {
  float ss = s + uPar.x * PARK.x * D1;
  float yy = y + uPar.y * PARK.y * D1;
  vec4 r = ridge(2, ss);
  float top = r.x + (vnoise(vec2(ss * 700.0, 2.1)) - 0.5) * 0.002;
  float a = clamp((yy - top) / PX + 0.5, 0.0, 1.0);
  if (a <= 0.0) return;
  vec3 c = rockLayerColor(ss, yy, top, r.y, r.z, 3, 1.7);
  c = mix(c, uHaze, 0.38 + 0.12 * smoothstep(0.5, 0.6, yy));
  comp(acc, A, c, a);
}

void layerHero(float s, float y, inout vec3 acc, inout float A) {
  float ss = s + uPar.x * PARK.x * D2;
  float yy = y + uPar.y * PARK.y * D2;
  vec4 r = ridge(4, ss);
  float top = r.x + (vnoise(vec2(ss * 700.0, 1.3)) - 0.5) * 0.0025
                  + (vnoise(vec2(ss * 2400.0, 7.1)) - 0.5) * 0.0008;
  float a = clamp((yy - top) / PX + 0.5, 0.0, 1.0);
  if (a <= 0.0) return;
  vec3 c = rockLayerColor(ss, yy, top, r.y, r.z, 5, 1.0);
  c = mix(c, uHaze, 0.06 + 0.2 * smoothstep(0.45, 0.62, yy));
  comp(acc, A, c, a);
}

vec3 farScene(float s, float y, vec2 fc) {
  vec3 acc = vec3(0.0);
  float A = 0.0;
  layerHero(s, y, acc, A);
  if (A < 0.995) layerMidfar(s, y, acc, A);
  if (A < 0.995) layerFar(s, y, acc, A);
  if (A < 0.995) comp(acc, A, sky(s, y, fc), 1.0);
  return acc;
}

float mistAt(float s, float y) {
  float band = smoothstep(0.53, 0.59, y) * (1.0 - smoothstep(0.605, 0.635, y));
  if (band <= 0.0) return 0.0;
  float n = fbm(vec2(s * 4.0 - uTime * 0.007, y * 16.0 + sin(s * 3.0 + uTime * 0.05) * 0.4));
  return band * smoothstep(0.42, 0.78, n) * 0.4 * uMist;
}

float cloudShadow(float s, float y) {
  float n = vnoise(vec2(s * 1.6 + uTime * 0.008, y * 6.0)) * 0.6
          + vnoise(vec2(s * 3.4 + uTime * 0.011, y * 13.0) + 5.0) * 0.4;
  return smoothstep(0.5, 0.72, n) * uDay;
}

/* Hut ------------------------------------------------------------------- */

vec4 hut(float s, float y) {
  float sc = 0.0155;
  vec2 p = vec2(s - uHut.x, uHut.y - y) / sc;
  if (abs(p.x) > 1.5 || p.y < -0.2 || p.y > 2.0) return vec4(0.0);
  float px = PX / sc;

  float ry = 1.5 - abs(p.x) * 0.68;
  float roofD = max(max(p.y - ry, (ry - 0.26) - p.y), abs(p.x) - 1.12);
  float bodyD = max(abs(p.x) - 0.86, max(-p.y, p.y - (ry - 0.2)));
  float chD = max(abs(p.x - 0.48) - 0.08, max(p.y - 1.62, 0.9 - p.y));

  vec3 acc = vec3(0.0);
  float A = 0.0;

  float aRoof = clamp(-roofD / px + 0.5, 0.0, 1.0);
  if (aRoof > 0.0) {
    vec3 N = normalize(vec3(p.x < 0.0 ? -0.55 : 0.55, 0.75, 0.35));
    vec3 rc = shade(HUT_ROOF, N, 1.0, 1.0);
    float edge = smoothstep(0.1, 0.0, ry - p.y);
    rc += HUT_ROOF * uSunCol * edge * 0.3;
    comp(acc, A, rc, aRoof);
  }
  float aCh = clamp(-chD / px + 0.5, 0.0, 1.0);
  if (aCh > 0.0 && A < 0.99) comp(acc, A, shade(HUT_STONE * 0.7, vec3(0.0, 0.2, 1.0), 1.0, 1.0), aCh);

  float aBody = clamp(-bodyD / px + 0.5, 0.0, 1.0);
  if (aBody > 0.0 && A < 0.99) {
    vec3 alb = HUT_WOOD * (0.9 + 0.1 * step(0.5, fract(p.y * 7.0)));
    float eave = smoothstep(0.15, 0.0, (ry - 0.2) - p.y);
    if (p.y < 0.32) alb = HUT_STONE * (0.9 + 0.12 * vnoise(p * 6.0));
    vec3 bc = shade(alb, vec3(0.0, 0.1, 1.0), 1.0 - eave * 0.6, 1.0 - eave);
    bool win = p.x > -0.58 && p.x < -0.22 && p.y > 0.46 && p.y < 0.76;
    if (win) bc = mix(shade(vec3(0.1, 0.1, 0.12), vec3(0.0, 0.3, 1.0), 1.0, 1.0), LAMP * 1.25, uLamp);
    bool door = p.x > 0.16 && p.x < 0.5 && p.y < 0.7;
    if (door) bc = shade(HUT_WOOD * 0.5, vec3(0.0, 0.1, 1.0), 0.8, 0.8);
    comp(acc, A, bc, aBody);
  }
  return vec4(acc, A);
}

/* Trees ----------------------------------------------------------------- */

// Edge of the forest band: it wanders, so the trees there thin out unevenly.
float forestEdge(float x) {
  return (vnoise(vec2(x * 11.0, 4.0)) - 0.5) * 0.03 + (vnoise(vec2(x * 37.0, 9.0)) - 0.5) * 0.012;
}

// Groves in the forest band. The noise is warped so their outlines meander.
float grove(float x, float y) {
  vec2 q = vec2(x * 8.0, y * 26.0);
  q += (vec2(vnoise(q * 1.6 + 11.0), vnoise(q * 1.6 + 23.0)) - 0.5) * 1.4;
  return vnoise(q) * 0.65 + vnoise(q * 2.4 + 5.0) * 0.35;
}

// Where trees grow. Groves and forest thin out at their edges rather than
// stopping, and lone trees stand out in the meadow.
float treeDensity(float x, float y, bool forest, float g) {
  if (forest) {
    // Groves close up toward the viewer; near the edge they break apart.
    float e = y - g - forestEdge(x);
    float deep = smoothstep(0.0, 0.08, e);
    float d = smoothstep(0.58 - 0.12 * deep, 0.7 - 0.12 * deep, grove(x, y));
    // Small gaps where an old tree fell.
    float gap = smoothstep(0.62, 0.78, vnoise(vec2(x * 16.0, y * 48.0) + 3.0));
    return (0.045 + 0.875 * d * (1.0 - 0.6 * gap)) * smoothstep(-0.015, 0.01, e);
  }
  vec4 lk = ridge(6, x);
  bool lake = lk.z > lk.y;
  if (lake && y > lk.y - 0.0015 && y < lk.z + 0.008) return 0.0;
  float n = vnoise(vec2(x * 7.0, y * 28.0)) * 0.55 + vnoise(vec2(x * 19.0, y * 70.0) + 3.0) * 0.3
          + vnoise(vec2(x * 53.0, y * 160.0) + 8.0) * 0.15;
  float d = smoothstep(0.5, 0.7, n) * 0.92 + 0.022;
  // A dark belt of forest along the foot of the massif.
  float belt = smoothstep(0.022, 0.004, y - g) * smoothstep(0.32, 0.5, vnoise(vec2(x * 8.0, 2.0)));
  d = max(d, belt * 0.95);
  if (lake) {
    // Spruce crowding the far shore.
    float fringe = smoothstep(0.03, 0.004, lk.y - y) * smoothstep(0.25, 0.45, vnoise(vec2(x * 30.0, 5.0)));
    d = max(d, fringe * 0.9);
  }
  vec2 hp = vec2((x - uHut.x) / 0.05, (y - uHut.y) / 0.02);
  d *= smoothstep(0.9, 1.3, length(hp));
  return d;
}

// Trees on a layer, nearest rows first. Only drawn while baking.
void trees(float s, float y, bool forest, inout vec3 acc, inout float A) {
  float cw = forest ? 0.022 : 0.0092;
  float ch = forest ? 0.0042 : 0.0027;
  float maxH = forest ? 0.095 : 0.038;
  int row = forest ? 8 : 6;
  vec2 seed = forest ? vec2(311.0, 173.0) : vec2(0.0);
  float ic = floor(s / cw);
  float g0 = ridge(row, (ic - 0.5) * cw).x;
  float g1 = ridge(row, (ic + 0.5) * cw).x;
  float g2 = ridge(row, (ic + 1.5) * cw).x;
  if (y < min(g0, min(g1, g2)) - maxH) return;
  // No trees stand in the lake: skip those rows before any other work.
  vec3 lkLo = vec3(9.0);
  vec3 lkHi = vec3(-9.0);
  if (!forest) {
    for (int k = 0; k < 3; k++) {
      vec4 lk = ridge(6, (ic + float(k) - 0.5) * cw);
      if (lk.z > lk.y + 0.004) {
        lkLo[k] = lk.y + 0.002;
        lkHi[k] = lk.z + 0.006;
      }
    }
  }
  // The tallest tree that could reach this pixel, given how size grows
  // toward the viewer.
  float hBase = forest ? 0.05 * 1.37 : 0.021 * 1.37;
  float yP = y + maxH;
  float pMax = forest ? mix(0.75, 1.3, smoothstep(0.66, 0.95, yP)) : mix(0.55, 1.3, smoothstep(0.6, 0.84, yP));
  float reachH = min(maxH, hBase * pMax);
  float jTop = floor(y / ch);
  float jBot = floor((y + reachH) / ch);
  for (int jj = 0; jj < 28; jj++) {
    float j = jBot - float(jj);
    if (j < jTop) break;
    for (int k = 0; k < 3; k++) {
      float i = ic + float(k - 1);
      vec2 cell = vec2(i, j) + seed;
      float r2 = hash12(cell + 19.19);
      float ty = (j + 0.05 + 0.9 * r2) * ch;
      if (ty > lkLo[k] && ty < lkHi[k]) continue;
      float up = ty - y;
      if (up < 0.0) continue;
      float g = k == 0 ? g0 : (k == 1 ? g1 : g2);
      if (ty < g + 0.002) continue;
      // Cheap tests first: is this pixel inside the tree's box at all?
      float r1 = hash12(cell);
      float tx = (i + 0.05 + 0.9 * r1) * cw;
      float r4 = hash12(cell + 71.3);
      float persp = forest ? mix(0.75, 1.3, smoothstep(0.66, 0.95, ty)) : mix(0.55, 1.3, smoothstep(0.6, 0.84, ty));
      // Mostly middling trees, some saplings, now and then an old giant.
      float size = 0.55 + 0.6 * r4 * r4 + 0.22 * step(0.93, hash12(cell + 2.9));
      float hgt = (forest ? 0.05 : 0.021) * persp * size * 1.12;
      if (up > hgt) continue;
      float dx = s - tx;
      if (abs(dx) > hgt * 0.42 + PX) continue;
      float r3 = hash12(cell + 47.7);
      float dens = treeDensity(tx, ty, forest, g);
      if (r3 > dens) continue;
      // Young trees at a grove's ragged edge, older ones in its heart; lone
      // trees in the open grow full.
      if (forest) hgt *= dens < 0.1 ? 0.95 : mix(0.66, 1.0, smoothstep(0.15, 0.85, dens));
      else hgt /= 1.12;
      if (up > hgt) continue;
      float f = up / hgt;
      // Larches mix in with the spruce, thicker in some stands than others.
      float stand = smoothstep(0.4, 0.75, vnoise(vec2(tx * 5.0, ty * 15.0) + seed * 0.01));
      bool larch = hash12(cell + 5.1) < 0.07 + 0.38 * stand;
      float r5 = hash12(cell + 33.3);
      // A slight lean, different for each tree.
      float ax = dx - (r5 - 0.5) * 0.06 * f * hgt;
      float sd = step(0.0, ax);
      float w = hgt * (larch ? 0.25 + 0.07 * r5 : 0.2 + 0.06 * r5);
      float env = w * pow(max(1.0 - f, 0.0), larch ? 0.9 : 0.95);
      // Detail scale, so texture never gets finer than a few pixels.
      float tf = clamp(hgt / PX / 12.0, 1.5, 8.0);
      float crown = larch ? 0.1 : 0.05;
      float hw;
      float lit;
      float gapA = 1.0;
      if (larch) {
        // Fewer, sparser rows than a spruce, with a feathery edge and light
        // showing through under each row.
        float T = 6.0 + 3.0 * r4;
        float ph = f * T + r2 * 5.0 + sd * (0.25 + 0.5 * r5);
        float q = fract(ph);
        float len = 0.7 + 0.5 * hash12(cell + vec2(floor(ph), sd * 7.0));
        float prof = q < 0.14 ? mix(0.55, 1.0, q / 0.14) : mix(1.0, 0.5, pow((q - 0.14) / 0.86, 0.7));
        hw = env * prof * len * (0.85 + 0.3 * vnoise(vec2(f * 5.0 + r2 * 17.0, sd * 5.3 + r4 * 11.0)));
        hw += env * 0.2 * (vnoise(vec2(f * tf * 9.0, sd * 3.1 + r5 * 13.0)) - 0.5);
        float q2 = fract(f * T + r2 * 5.0 + 0.6 * vnoise(vec2(ax / w * 2.0 + r4 * 9.0, floor(f * T))));
        float uo = abs(ax) / max(hw, 1e-5);
        gapA = q2 < 0.16 ? mix(1.0, 0.0, smoothstep(0.3, 0.6, uo) * smoothstep(0.0, 0.08, q2) * smoothstep(0.16, 0.1, q2)) : 1.0;
        lit = q2 < 0.16 ? 0.35 : mix(1.0, 0.55, (q2 - 0.16) / 0.84);
      } else {
        // Rows of drooping branches. Each side has its own rhythm and its own
        // branch lengths; a branch is widest at its tip, its top slopes in.
        float T = 9.0 + 4.0 * r4;
        float ph = f * T + r2 * 5.0 + sd * (0.3 + 0.4 * r5);
        float q = fract(ph);
        float len = 0.78 + 0.36 * hash12(cell + vec2(floor(ph), sd * 7.0));
        float prof = q < 0.1 ? mix(0.62, 1.0, q / 0.1) : mix(1.0, 0.4, pow((q - 0.1) / 0.9, 0.8));
        hw = env * prof * len;
        hw += env * 0.12 * (vnoise(vec2(f * tf * 6.0, sd * 9.0 + r4 * 7.0)) - 0.5);
        // Across the face the branches overlap at staggered heights.
        float q2 = fract(f * T + r2 * 5.0 + 0.7 * vnoise(vec2(ax / w * 2.2 + r4 * 9.0, floor(f * T))));
        lit = q2 < 0.12 ? 0.2 : mix(1.0, 0.45, (q2 - 0.12) / 0.88);
      }
      hw = f < crown ? 0.0 : max(hw, 0.0) + PX * 0.3;
      float u = clamp(ax / max(hw, 1e-5), -1.0, 1.0);
      float a = clamp((hw - abs(ax)) / PX + 0.5, 0.0, 1.0) * gapA;
      if (a > 0.0) {
        vec3 N = normalize(vec3(u * 0.85, mix(-0.35, 0.75, lit), 0.55));
        float tex = 0.88 + 0.24 * vnoise(vec2(ax / hgt * tf * 4.0 + r5 * 5.0, f * tf * 3.0));
        vec3 alb = larch ? mix(LARCH_DEEP, LARCH, lit) : mix(SPRUCE, SPRUCE_TIP, lit * 0.7);
        alb *= tex * (0.84 + 0.32 * hash12(cell + 61.7));
        // Some spruce run olive, some blue-dark; larches from lemon to rust.
        float hue = hash12(cell + 88.1);
        alb *= larch ? mix(vec3(1.06, 1.04, 0.86), vec3(0.98, 0.84, 0.78), hue) : mix(vec3(1.06, 1.04, 0.9), vec3(0.92, 0.97, 1.08), hue);
        if (larch) alb = mix(alb, GRASS_Y, 0.25 * (1.0 - stand) * r5);
        float ao = mix(0.5, 1.0, lit) * (0.6 + 0.4 * smoothstep(0.0, 0.5, f));
        vec3 c = shade(alb, N, ao, 1.0);
        if (!forest) c = mix(c, uHaze, 0.32 * (1.0 - smoothstep(0.6, 0.76, ty)));
        comp(acc, A, c, a);
      }
      // The trunk, under the crown and through a larch's gaps.
      float tw = w * 0.07 * (1.0 - 0.7 * f) + PX * 0.35;
      float at = clamp((tw - abs(ax)) / PX + 0.5, 0.0, 1.0) * step(f, larch ? 0.8 : crown + 0.03);
      if (at > 0.0) {
        vec3 c = shade(TRUNK * (0.8 + 0.4 * hash12(cell + 9.9)), vec3(sign(ax) * 0.6, 0.2, 0.75), 0.6, 1.0);
        if (!forest) c = mix(c, uHaze, 0.32 * (1.0 - smoothstep(0.6, 0.76, ty)));
        comp(acc, A, c, at);
      }
      if (A > 0.995) return;
    }
  }
}

// Slow or still layers are drawn ahead into textures (premultiplied, without
// parallax) and looked up at a layer's shifted position.
vec4 bakedAt(sampler2D tex, float s, float y) {
  vec2 px = vec2((s - uView.z) * uView.y * uRes.y + 0.5 * uRes.x, uRes.y - (y * uView.y + uView.x) * uRes.y);
  return texture(tex, (px + uBakeM) / (uRes + 2.0 * uBakeM));
}

/* Lake ------------------------------------------------------------------ */

vec3 lakeColor(float s, float y, float far, float near, vec2 fc) {
  float t = uTime;
  float u = clamp((y - far) / max(near - far, 1e-3), 0.0, 1.0);
  float du = y - far;

  // Cat's paws: drifting patches where the breeze roughens the water.
  float wind = smoothstep(0.5, 0.78, fbm3(vec2(s * 2.6 + t * 0.011, y * 42.0 - t * 0.015)));
  float persp = mix(0.4, 1.0, u);
  vec2 wp = vec2(s * 70.0 / persp, y * 1100.0 / persp);
  float w1 = vnoise(wp + vec2(t * 0.45, -t * 1.3));
  float w2 = vnoise(wp * vec2(2.2, 1.8) + vec2(-t * 0.8, -t * 2.1) + 5.0);
  float wv = (w1 - 0.5) * 0.6 + (w2 - 0.5) * 0.4;
  float amp = mix(0.3, 1.0, wind);

  float rip = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 R = uRip[i];
    float age = t - R.z;
    if (R.w <= 0.0 || age < 0.0 || age > 6.0) continue;
    vec2 dv = vec2(s - R.x, (y - R.y) * 4.5);
    float dist = length(dv);
    float rad = age * 0.045;
    float x = (dist - rad) * 340.0;
    float env = exp(-x * x * 0.035) * exp(-age * 0.7) * R.w * smoothstep(0.0, 0.15, age);
    rip += sin(x) * env;
  }
  float slope = wv * amp + rip;

  // Reflections. Trees and the hut mirror about their own base; the massif
  // mirrors about its foot, which hides behind the far shore.
  float sr = s + slope * 0.0025;
  vec3 racc = vec3(0.0);
  float rA = 0.0;
  // Only the trees along the far shore are close enough to mirror whole.
  vec4 mt = bakedAt(uTreesP, sr, 2.0 * far - (y + slope * 0.003)) * 0.92 * smoothstep(0.026, 0.016, du);
  racc = mt.rgb;
  rA = mt.a;
  if (rA < 0.99) {
    vec4 hc = hut(sr, 2.0 * uHut.y - y);
    racc += (1.0 - rA) * hc.rgb;
    rA += (1.0 - rA) * hc.a;
  }
  float yr = uLake.w - du * 2.5 - slope * (0.01 + 0.012 * u);
  vec3 refl = bakedAt(uFar, sr, yr).rgb;
  refl = racc + (1.0 - rA) * refl;

  // Looking across the water it is a mirror; looking down it is dark green.
  float fres = mix(0.93, 0.5, u * u) * mix(1.0, 0.82, wind);
  vec3 body = mix(WATER_DEEP, WATER_SHALLOW, smoothstep(0.7, 1.0, u)) * (uAmb * 0.75 + uSunCol * 0.35 * max(uSunDir.y, 0.0));
  vec3 c = mix(body, refl * vec3(0.84, 0.89, 0.88), fres);
  // Roughened patches pick up a little more of the sky.
  c = mix(c, skyBase(0.15) * 0.82, wind * 0.12 * (1.0 - u * 0.5));

  // Glints on the wavelets, brighter where the breeze is.
  float glint = smoothstep(0.78, 0.95, w2) * smoothstep(0.55, 0.75, w1);
  c += (uSunCol * 0.5 + uAmb * 0.15) * glint * (0.15 + 0.5 * wind) * (1.0 - u * 0.6);
  // Ripple rings catch the light on one side and darken on the other.
  c += (uAmb * 0.3 + uSunCol * 0.25) * max(rip, 0.0) * 0.35;
  c -= c * max(-rip, 0.0) * 0.25;

  // Near shore: the stony bottom shows through the shallows.
  float shallow = smoothstep(0.006, 0.0, near - y);
  vec3 bed = shade(SAND * (0.75 + 0.3 * vnoise(vec2(s * 600.0, y * 1200.0))), vec3(0.0, 1.0, 0.3), 1.0, 1.0);
  c = mix(c, mix(bed, WATER_SHALLOW * uAmb, 0.45), shallow * 0.55);
  // A dark lip where the far bank meets the water.
  c *= 1.0 - 0.35 * smoothstep(0.0012, 0.0, du);
  return c;
}

/* Ground ---------------------------------------------------------------- */

vec3 meadowAlb(float s, float y) {
  float n1 = vnoise(vec2(s * 9.0 + 9.0, y * 40.0));
  float n2 = vnoise(vec2(s * 16.0, y * 70.0) + 4.0);
  vec3 a = mix(GRASS_G, GRASS_Y, smoothstep(0.35, 0.85, n1) * 0.75);
  a = mix(a, GRASS_R, smoothstep(0.62, 0.86, n2) * 0.35);
  return a * (0.92 + 0.14 * vnoise(vec2(s * 700.0, y * 2600.0)));
}

float hills(vec2 p) {
  return vnoise(p) * 0.6 + vnoise(p * 2.1 + 3.7) * 0.4;
}

vec3 plateauGround(float s, float y, float top, vec2 fc) {
  float d = y - top;
  vec2 p = vec2(s * 5.0, y * 34.0);
  float gx = hills(p + vec2(0.15, 0.0)) - hills(p - vec2(0.15, 0.0));
  float gy = hills(p + vec2(0.0, 0.15)) - hills(p - vec2(0.0, 0.15));
  vec3 N = normalize(vec3(-gx * 2.4, 1.0, 0.35 + gy * 1.2));
  vec3 alb = meadowAlb(s, y);
  vec3 c = shade(alb, N, 1.0, 1.0 - 0.55 * cloudShadow(s, y));

  vec4 lk = ridge(6, s);
  if (lk.z > lk.y) {
    float far = lk.y;
    float near = lk.z;
    float slope = abs(ridge(6, s + 0.002).y - ridge(6, s - 0.002).y) / 0.004 + abs(ridge(6, s + 0.002).z - ridge(6, s - 0.002).z) / 0.004;
    float dist = max(far - y, y - near) / sqrt(1.0 + slope * slope * 0.25);
    // Pebbles along the near bank, broken up so they never read as a ring.
    float onNear = step(0.5 * (far + near), y);
    float shoreW = 0.004 * onNear * smoothstep(0.3, 0.6, vnoise(vec2(s * 40.0, 4.0)));
    vec3 peb = SAND * (0.8 + 0.35 * vnoise(vec2(s * 900.0, y * 1800.0)));
    vec3 shore = shade(peb, vec3(0.0, 1.0, 0.4), 1.0, 1.0);
    float sa = clamp((shoreW - dist) / PX + 0.5, 0.0, 1.0);
    c = mix(c, shore, sa * 0.8);
    c *= 1.0 - 0.3 * clamp((0.001 - abs(dist)) / 0.001, 0.0, 1.0);
    float wa = clamp(-dist / PX + 0.5, 0.0, 1.0);
    if (wa > 0.0) c = mix(c, lakeColor(s, y, far, near, fc), wa);
  }

  // Warm light spilling from the hut window after dark.
  vec2 hp = vec2((s - uHut.x + 0.004) / 0.03, (y - uHut.y - 0.003) / 0.012);
  c += LAMP * uLamp * exp(-dot(hp, hp) * 1.5) * 0.12;

  c = mix(c, uHaze, 0.3 * (1.0 - smoothstep(0.0, 0.06, d)));
  return c;
}

void layerPlateau(float s, float y, vec2 fc, inout vec3 acc, inout float A) {
  float ss = s + uPar.x * PARK.x * D3;
  float yy = y + uPar.y * PARK.y * D3;
  vec4 tc = bakedAt(uTreesP, ss, yy);
  acc += (1.0 - A) * tc.rgb;
  A += (1.0 - A) * tc.a;
  if (A > 0.995) return;
  vec4 hc = hut(ss, yy);
  if (hc.a > 0.0) {
    acc += (1.0 - A) * hc.rgb;
    A += (1.0 - A) * hc.a;
  }
  if (A > 0.995) return;
  float top = ridge(6, ss).x + (vnoise(vec2(ss * 900.0, 2.0)) - 0.5) * 0.0012;
  float a = clamp((yy - top) / PX + 0.5, 0.0, 1.0);
  if (a <= 0.0) return;
  comp(acc, A, plateauGround(ss, yy, top, fc), a);
}

void layerForest(float s, float y, inout vec3 acc, inout float A) {
  float ss = s + uPar.x * PARK.x * D4;
  float yy = y + uPar.y * PARK.y * D4;
  vec4 tc = bakedAt(uTreesF, ss, yy);
  acc += (1.0 - A) * tc.rgb;
  A += (1.0 - A) * tc.a;
  if (A > 0.995) return;
}

void layerNear(float s, float y, inout vec3 acc, inout float A) {
  float ss = s + uPar.x * PARK.x * D5;
  float yy = y + uPar.y * PARK.y * D5;
  float top = ridge(10, ss).x + (vnoise(vec2(ss * 500.0, 4.0)) - 0.5) * 0.004
                              + (vnoise(vec2(ss * 1800.0, 2.0)) - 0.5) * 0.002;
  float a = clamp((yy - top) / PX + 0.5, 0.0, 1.0);
  if (a <= 0.0) return;
  float d = yy - top;
  float hgt = fbm3(vec2(ss * 5.0, yy * 18.0));
  vec3 alb = mix(GRASS_G * 1.05, GRASS_Y, smoothstep(0.45, 0.75, hgt) * 0.6);
  alb *= 0.88 + 0.2 * vnoise(vec2(ss * 420.0, yy * 90.0));
  // The bank rolls away from us: its top catches the light, its face less so.
  vec3 N = normalize(vec3((hgt - 0.5) * 0.6, mix(1.0, 0.45, smoothstep(0.0, 0.12, d)), 0.6));
  vec3 c = shade(alb, N, mix(1.0, 0.7, smoothstep(0.0, 0.2, d)), 1.0 - 0.5 * cloudShadow(ss, yy));

  vec2 cs = vec2(0.0045, 0.003);
  vec2 fi = floor(vec2(ss, yy) / cs);
  float patchN = smoothstep(0.5, 0.72, vnoise(vec2(ss * 12.0, yy * 30.0)));
  if (hash12(fi + 3.3) < 0.3 * patchN) {
    vec2 fpos = (fi + vec2(0.2 + 0.6 * hash12(fi + 7.1), 0.2 + 0.6 * hash12(fi + 9.7))) * cs;
    float rad = 0.0008 * (0.7 + 1.3 * smoothstep(0.84, 1.0, yy));
    float dd = length((vec2(ss, yy) - fpos) * vec2(1.0, 1.3));
    float fa = clamp((rad - dd) / PX + 0.5, 0.0, 1.0);
    float pick = hash12(fi + 1.7);
    vec3 fcol = pick < 0.35 ? F_CREAM : (pick < 0.6 ? F_PINK : (pick < 0.82 ? F_VIOLET : F_YELLOW));
    c = mix(c, shade(fcol, vec3(0.0, 0.8, 0.6), 1.0, 1.0), fa * 0.85);
  }
  c += alb * uSunCol * exp(-d * 260.0) * 0.18;
  comp(acc, A, c, a);
}

void main() {
  if (uPass == 4) {
    // How much of each cell the baked trees cover, so animals keep clear.
    vec2 base = floor(gl_FragCoord.xy) * uCoverF;
    vec2 size = vec2(textureSize(uTreesP, 0));
    float p = 0.0;
    float q = 0.0;
    for (int i = 0; i < 8; i++) {
      for (int j = 0; j < 8; j++) {
        vec2 uv = (base + (vec2(float(i), float(j)) + 0.5) * uCoverF / 8.0) / size;
        p = max(p, texture(uTreesP, uv).a);
        q = max(q, texture(uTreesF, uv).a);
      }
    }
    outColor = vec4(p, q, 0.0, 1.0);
    return;
  }
  vec2 fc = gl_FragCoord.xy;
  if (uPass > 0) fc -= uBakeM;
  float H = uRes.y;
  float sy = (H - fc.y) / H;
  float sx = (fc.x - 0.5 * uRes.x) / H;
  float y = (sy - uView.x) / uView.y;
  float s = sx / uView.y + uView.z;
  PX = 1.0 / (H * uView.y);

  vec3 acc = vec3(0.0);
  float A = 0.0;
  if (uPass == 3) {
    // Below the meadow's edge only the lake's reflection needs it.
    bool hidden = y > max(ridge(6, s).x + 0.01, uLake.w + 0.004);
    outColor = vec4(hidden ? uHaze : farScene(s, y, fc), 1.0);
    return;
  }
  if (uPass > 0) {
    trees(s, y, uPass == 2, acc, A);
    if (uPass == 2 && A < 0.995) {
      // Shade under the thick of a grove, so it reads as one dark mass.
      float g = ridge(8, s).x;
      // It stops short of the grove's front row, whose trees hide its edge.
      float dn = min(treeDensity(s, y, true, g), treeDensity(s, y + 0.012, true, g));
      float fa = smoothstep(0.55, 0.9, dn) * 0.8;
      if (fa > 0.0) {
        vec3 fl = SPRUCE * (0.62 + 0.25 * vnoise(vec2(s * 260.0, y * 400.0)));
        comp(acc, A, shade(fl, vec3(0.0, 0.5, 0.8), 0.6, 0.6), fa);
      }
    }
    outColor = vec4(acc, A);
    return;
  }
  layerNear(s, y, acc, A);
  if (A < 0.995) layerForest(s, y, acc, A);
  if (A < 0.995) layerPlateau(s, y, fc, acc, A);
  if (A < 0.995) {
    float m = mistAt(s + uPar.x * PARK.x * 0.2, y);
    if (m > 0.0) comp(acc, A, uHaze * 1.04 + uSunCol * 0.06, m);
  }
  if (A < 0.995) {
    // The far layers shift with the massif, a whole pixel at a time.
    vec2 shift = floor(vec2(uPar.x * PARK.x, -uPar.y * PARK.y) * D2 * uView.y * H + 0.5);
    acc += (1.0 - A) * texture(uFar, (fc + shift + uBakeM) / (uRes + 2.0 * uBakeM)).rgb;
  }

  vec3 c = acc;
  vec2 cp = fc / uDpr;
  c += (hash12(floor(cp)) - 0.5) * 0.024;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  float hl = abs(fract((cp.x + cp.y) / 3.2) - 0.5) * 2.0;
  c *= 1.0 - smoothstep(0.7, 1.0, hl) * smoothstep(0.62, 0.3, lum) * smoothstep(0.02, 0.12, lum) * 0.06;
  vec2 uv = fc / uRes;
  float vig = smoothstep(1.25, 0.45, length((uv - vec2(0.5, 0.55)) * vec2(1.0, 1.1)));
  c *= mix(mix(0.9, 0.78, uStars), 1.0, vig);
  outColor = vec4(c, 1.0);
}
`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(log);
    }
    return sh;
  }

  const UNIFORMS = [
    'uRes', 'uTime', 'uPar', 'uView', 'uDpr', 'uRidge', 'uRidgeInfo', 'uLake', 'uHut', 'uRip',
    'uPass', 'uTreesP', 'uTreesF', 'uFar', 'uBakeM', 'uCoverF',
    'uSunDir', 'uSunCol', 'uAmb', 'uZen', 'uMid', 'uHor', 'uGlow', 'uGlowX', 'uHaze',
    'uMoon', 'uMoonK', 'uStars', 'uLamp', 'uDay', 'uMist',
  ];

  D.createLandscape = function (canvas, ridgeData) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return null;

    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (err) {
      console.error('Landscape shader failed', err);
      return null;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, D.NS, D.NL * 2, 0, gl.RGBA, gl.FLOAT, ridgeData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const u = {};
    UNIFORMS.forEach((n) => {
      u[n] = gl.getUniformLocation(prog, n);
    });
    gl.uniform1i(u.uRidge, 0);
    gl.uniform3f(u.uRidgeInfo, D.S_MIN, D.S_MAX, D.NS);
    gl.uniform4f(u.uLake, D.LAKE.s, D.LAKE.y, D.LAKE.a, D.LAKE.foot);
    gl.uniform2f(u.uHut, D.HUT.s, D.HUT.y);

    let ratio = 1;

    // Layers drawn ahead of time: the meadow and forest trees, baked when the
    // view or the light changes, and the far scene, redrawn a band of rows
    // each frame so its clouds and stars keep moving.
    function target(unit) {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return { t, fb: gl.createFramebuffer(), unit, w: 0, h: 0 };
    }
    const layers = [target(1), target(2), target(3)];
    gl.uniform1i(u.uTreesP, 1);
    gl.uniform1i(u.uTreesF, 2);
    gl.uniform1i(u.uFar, 3);
    const FAR_BANDS = 4;
    // A coarse map of where trees stand, read back for the animals.
    const cover = { t: gl.createTexture(), fb: gl.createFramebuffer(), w: 0, h: 0, f: 1, m: 0, data: null };
    let geoKey = '';
    let treesVer = -1;
    let band = 0;
    let lightVer = 0;
    let lastLight = null;

    function size(b, w, h) {
      if (b.w === w && b.h === h) return;
      gl.activeTexture(gl.TEXTURE0 + b.unit);
      gl.bindTexture(gl.TEXTURE_2D, b.t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, b.t, 0);
      b.w = w;
      b.h = h;
    }

    // Draws one pass into a layer, or only the rows from y0 to y1.
    function draw(b, pass, y0, y1) {
      // A texture can't be read while it is being drawn into.
      gl.activeTexture(gl.TEXTURE0 + b.unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
      gl.viewport(0, 0, b.w, b.h);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, y0, b.w, y1 - y0);
      gl.uniform1i(u.uPass, pass);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
      gl.activeTexture(gl.TEXTURE0 + b.unit);
      gl.bindTexture(gl.TEXTURE_2D, b.t);
    }

    function bake(view, full) {
      const geo = [canvas.width, canvas.height, view.off, view.scale, view.cam].join();
      // Room for the furthest any layer shifts with the pointer.
      const m = Math.ceil(0.012 * view.scale * canvas.height) + 2;
      const w = canvas.width + 2 * m;
      const h = canvas.height + 2 * m;
      gl.uniform1f(u.uBakeM, m);
      gl.uniform2f(u.uPar, 0, 0);
      let moved = false;
      if (geo !== geoKey) {
        geoKey = geo;
        layers.forEach((b) => size(b, w, h));
        treesVer = -1;
        full = true;
        moved = true;
      }
      if (treesVer !== lightVer) {
        treesVer = lightVer;
        draw(layers[0], 1, 0, h);
        draw(layers[1], 2, 0, h);
      }
      if (moved) readCover(m, w, h);
      if (full) {
        draw(layers[2], 3, 0, h);
      } else {
        band = (band + 1) % FAR_BANDS;
        draw(layers[2], 3, Math.floor((h * band) / FAR_BANDS), Math.floor((h * (band + 1)) / FAR_BANDS));
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1i(u.uPass, 0);
    }

    function readCover(m, w, h) {
      const f = Math.max(1, Math.round(4 * ratio));
      const cw = Math.ceil(w / f);
      const ch = Math.ceil(h / f);
      if (cover.w !== cw || cover.h !== ch) {
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, cover.t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, cover.fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cover.t, 0);
        cover.w = cw;
        cover.h = ch;
        cover.data = new Uint8Array(cw * ch * 4);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, cover.fb);
      gl.viewport(0, 0, cw, ch);
      gl.uniform1f(u.uCoverF, f);
      gl.uniform1i(u.uPass, 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, cover.data);
      cover.f = f;
      cover.m = m;
      D.coverVer = (D.coverVer || 0) + 1;
    }

    // How much tree stands at a point on screen (css px), 0 to 1, ignoring
    // the pointer's parallax.
    D.treeCover = function (x, y) {
      if (!cover.data) return 0;
      const i = Math.floor((x * ratio + cover.m) / cover.f);
      const j = Math.floor((canvas.height - y * ratio + cover.m) / cover.f);
      if (i < 0 || j < 0 || i >= cover.w || j >= cover.h) return 0;
      const k = (j * cover.w + i) * 4;
      return Math.max(cover.data[k], cover.data[k + 1]) / 255;
    };

    // Light drifts slowly; bake again only once the trees would look different.
    function lightChanged(L) {
      const v = [...L.sunDir, ...L.sunCol, ...L.amb, ...L.haze];
      if (lastLight && v.every((x, i) => Math.abs(x - lastLight[i]) < 0.004)) return;
      lastLight = v;
      lightVer++;
    }

    return {
      gl,
      resize(w, h, r) {
        ratio = r;
        canvas.width = Math.max(1, Math.round(w * r));
        canvas.height = Math.max(1, Math.round(h * r));
        gl.viewport(0, 0, canvas.width, canvas.height);
      },
      // Light from sky.js plus the moon's place on screen (css px).
      setLight(L, moon) {
        lightChanged(L);
        gl.uniform3fv(u.uSunDir, L.sunDir);
        gl.uniform3fv(u.uSunCol, L.sunCol);
        gl.uniform3fv(u.uAmb, L.amb);
        gl.uniform3fv(u.uZen, L.zen);
        gl.uniform3fv(u.uMid, L.mid);
        gl.uniform3fv(u.uHor, L.hor);
        gl.uniform4f(u.uGlow, L.glow[0], L.glow[1], L.glow[2], L.glowK);
        gl.uniform1f(u.uGlowX, L.glowX);
        gl.uniform3fv(u.uHaze, L.haze);
        gl.uniform4f(u.uMoon, moon.x, moon.y, moon.r, L.moonPhase);
        gl.uniform1f(u.uMoonK, L.moonUp * (moon.visible ? 1 : 0));
        gl.uniform1f(u.uStars, L.stars);
        gl.uniform1f(u.uLamp, L.lamp);
        gl.uniform1f(u.uDay, L.day);
        gl.uniform1f(u.uMist, L.mist);
      },
      // still: redraw everything at once, for a frame that stays up.
      render(t, view, ripples, still) {
        gl.uniform2f(u.uRes, canvas.width, canvas.height);
        gl.uniform1f(u.uTime, t);
        gl.uniform3f(u.uView, view.off, view.scale, view.cam);
        gl.uniform1f(u.uDpr, ratio);
        bake(view, still);
        gl.uniform2f(u.uPar, view.parX, view.parY);
        gl.uniform4fv(u.uRip, ripples);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      // Milliseconds the GPU takes per frame, waiting for each to finish.
      measure(t, view, ripples, n) {
        const px = new Uint8Array(4);
        this.render(t, view, ripples);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          this.render(t + i * 0.016, view, ripples);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        return (performance.now() - t0) / n;
      },
    };
  };
})();
