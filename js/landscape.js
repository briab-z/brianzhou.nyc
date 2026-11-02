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
uniform vec4 uSpur[32];  // spurs down the massif's face: s and y of the top, lean, how far forward
uniform float uCoul[32]; // couloirs between the spurs: s at the foot of the walls
uniform vec2 uSlab;      // s range of Sassopiatto's slab
uniform vec3 uSella;     // s range of the Sella's walls, y of its terrace
uniform int uPass;       // 0: the scene; 1, 2: bake meadow or forest trees; 3: the far scene, sky
                         // over the baked rock; 4: tree cover for the animals; 5: where the meadow
                         // trees stand; 6: bake the rock walls
uniform sampler2D uTreesP;
uniform sampler2D uTreesF;
uniform sampler2D uFar;
uniform sampler2D uFoot;
uniform sampler2D uRock;
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
uniform vec4 uText[2];   // the text blocks on screen: css px left, top, right, bottom

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
const vec3 F_BUTTERCUP = vec3(0.97, 0.82, 0.26);
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
    // Few stars behind the text, where they would read as stray dots.
    for (int i = 0; i < 2; i++) {
      vec4 R = uText[i];
      vec2 out2 = max(R.xy - cp, cp - R.zw);
      fade *= 1.0 - 0.85 * smoothstep(32.0, 4.0, length(max(out2, 0.0)));
    }
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
  // Under a high sun the clouds' tops stop short of pure white, which would
  // only glare.
  vec3 cloudLit = uAmb * 0.7 + uSunCol * mix(0.92, 0.4, uStars) * mix(1.0, 0.74, smoothstep(0.2, 0.5, uSunDir.y));
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
    // Where the clouds gather: a broad 2D patchiness, so a bank thins out in
    // ragged billows rather than stopping at a vertical edge.
    float patchy = smoothstep(0.22, 0.7, fbm3(vec2(s * 1.4 + t * 0.0015, y * 4.0 + 3.0) + w * 0.6));
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

// How far the rock stands out toward us at p (the scene position times the
// layer's detail scale): weathered rock, as rain and frost carve it. Ribs
// and gullies branch and merge as they run down the wall, and finer ribs
// ride on the bigger ones. rib: how high the big ribs stand (0 in a gully).
float rockH(vec2 p, out float rib) {
  vec2 q = vec2(p.x * 24.0, p.y * 9.0);
  q += (vec2(vnoise(q * vec2(0.3, 0.5) + 3.1), vnoise(q * vec2(0.3, 0.5) + 7.7)) - 0.5) * vec2(1.4, 0.8);
  rib = ridgedN(q);
  float r2 = ridgedN(q * vec2(2.2, 1.7) + 5.2);
  float r3 = ridgedN(q * vec2(4.6, 3.1) + 9.4);
  return (rib * 0.6 + r2 * (0.18 + 0.2 * rib) + r3 * 0.1 + vnoise(q * vec2(9.5, 6.0) + 2.0) * 0.05) * 0.016;
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

// The massif's face, built from its spurs (see terrain.js): ridges that run
// down from each top and come toward us as they fall. Their slopes must
// match SPUR_FWD and SPUR_SIDE there.
const float SPUR_FWD = 0.5;
const float SPUR_SIDE = 1.4;

// Spurs bend a little as they fall.
float spurWander(float y, int i) {
  return (vnoise(vec2(y * 45.0, float(i) * 7.3)) - 0.5) * 0.012;
}

// Spurs swell and fall back as they run down, so the crests jog and the
// shadows they throw widen, narrow and break off rather than running straight
// down the whole wall. Nothing changes at a spur's top. d: the slope down it.
float spurSwell(float dy, int i, out float d) {
  float fi = float(i);
  float a = fi * 2.17 + 0.4;
  float b = fi * 4.31 + 1.9;
  float f1 = 24.0 + 9.0 * fract(fi * 0.618);
  float f2 = 61.0 + 17.0 * fract(fi * 0.382);
  d = 0.011 * (f1 * cos(dy * f1 + a) + 0.5 * f2 * cos(dy * f2 + b));
  return 0.011 * (sin(dy * f1 + a) - sin(a) + 0.5 * (sin(dy * f2 + b) - sin(b)));
}

// How far the face stands toward us at (s, y).
float spurZ(float s, float y) {
  float z = -9.0;
  float d;
  for (int i = 0; i < 32; i++) {
    vec4 P = uSpur[i];
    if (P.y > 5.0) break;
    float dy = y - P.y;
    z = max(z, P.w + SPUR_FWD * dy + spurSwell(dy, i, d) - SPUR_SIDE * abs(s - P.x - P.z * dy - spurWander(y, i)));
  }
  return z;
}

// The same, with the face's slope across and down, and how near (s, y)
// lies to a couloir, where one spur gives way to the next.
vec4 spurFace(float s, float y) {
  float z1 = -9.0;
  float z2 = -9.0;
  vec2 g1 = vec2(0.0);
  vec2 g2 = vec2(0.0);
  for (int i = 0; i < 32; i++) {
    vec4 P = uSpur[i];
    if (P.y > 5.0) break;
    // The face keeps its tilt above the spur's top too, so no spur takes
    // over from another along a level line.
    float dy = y - P.y;
    float dx = s - P.x - P.z * dy - spurWander(y, i);
    // Each spur's crest is rounded a little.
    float ad = sqrt(dx * dx + 4e-6);
    float sw;
    float z = P.w + SPUR_FWD * dy + spurSwell(dy, i, sw) - SPUR_SIDE * ad;
    vec2 g = vec2(-SPUR_SIDE * dx / ad, SPUR_FWD + sw + SPUR_SIDE * dx / ad * P.z);
    if (z > z1) {
      z2 = z1;
      g2 = g1;
      z1 = z;
      g1 = g;
    } else if (z > z2) {
      z2 = z;
      g2 = g;
    }
  }
  float t = smoothstep(0.0, 0.005, z1 - z2);
  // Couloirs are broad, shadowed channels rather than cracks.
  return vec4(z1, mix(0.5 * (g1 + g2), g1, t), 1.0 - smoothstep(0.0, 0.025, z1 - z2));
}

// Light left by the spurs standing between (s, y), on a face at depth z,
// and the sun. crestRow: the layer's silhouette, above which nothing stands.
float spurShadow(float s, float y, float z, int crestRow) {
  // The edge of a shadow on jointed rock steps and frays, never ruled.
  float fray = (vnoise(vec2(s * 300.0, y * 110.0)) + 0.5 * vnoise(vec2(s * 900.0, y * 500.0)) - 0.75) * 0.009;
  float sh = 1.0;
  for (int i = 1; i <= 4; i++) {
    float t = 0.006 * float(i * i);
    vec3 q = vec3(s + uSunDir.x * t, y - uSunDir.y * t, z + uSunDir.z * t);
    if (q.y < ridge(crestRow, q.x).x) break;
    sh = min(sh, smoothstep(-0.002, 0.005, q.z - spurZ(q.x, q.y) + fray));
  }
  return sh;
}

vec3 meadowAlb(float s, float y, float hl);

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
  // Less of it on the far walls, whose flat crests would only round it into domes.
  float nxMacro = clamp(-slope * 0.8 / freq, -1.5, 1.5);

  // Talus spills from the gullies; each gully cuts a notch up into the
  // foot of the wall.
  // On the main massif they come down the couloirs between its spurs;
  // elsewhere, one or none in each stretch of wall.
  bool hero = row == 5;
  float reach = sb - cb;
  // The foot of a tall wall is no more ragged than a short one's.
  float wf = min(wallH, 0.08);
  float cf = 7.0 * freq;
  float ci = floor(s * cf);
  float notch = 0.0;
  float gul = 0.0;
  float fan = -1.0;
  float fanU = 0.0;
  float fanV = 1.0;
  float fanA = 0.0;
  for (int k = 0; k < 32; k++) {
    if (!hero && k > 2) break;
    float id;
    float ax;
    if (hero) {
      ax = uCoul[k];
      if (ax < -5.0) break;
      if (abs(s - ax) > 0.09) continue;
      id = float(k) + 50.0;
    } else {
      id = ci + float(k - 1);
      ax = (id + 0.2 + 0.6 * hash12(vec2(id, 5.0 + freq))) / cf;
    }
    float hN = hash12(vec2(id, 2.0 + freq));
    float ds = s - ax;
    // Only a real wall sheds a fan.
    vec4 W = ridge(row - 1, ax);
    float shed = smoothstep(0.01, 0.035, W.y - W.x) * (hero ? 1.0 : step(0.25, hash12(vec2(id, 11.0 + freq))));
    float nw = (0.004 + 0.005 * hN) / freq;
    notch = max(notch, max(1.0 - ds * ds / (nw * nw), 0.0) * shed);
    // Above it a shadowed couloir climbs part way up the wall.
    float vc = smoothstep(0.55 - 0.4 * hN, 0.75 - 0.4 * hN, v);
    float wC = nw * (0.25 + 0.45 * vc);
    gul = max(gul, smoothstep(wC, wC * 0.6, abs(ds)) * vc * shed);
    float apex = cb + wf * (0.04 - 0.1 * shed);
    float dA = y - apex;
    if (dA > 0.0) {
      float len = reach * (0.4 + 1.0 * pow(hash12(vec2(id, 8.0 + freq)), 1.5)) * shed / sqrt(freq);
      ds -= dA * (hash12(vec2(id, 13.0 + freq)) - 0.5) * 0.6;
      float hw = 0.003 / freq + dA * (0.5 + 0.3 * hN) + dA * dA / max(reach, 0.01) * (0.7 + 0.5 * hN);
      hw *= 0.85 + 0.3 * vnoise(vec2(dA * 260.0 * freq, id * 3.1));
      float rr = length(vec2(ds * 0.55, dA));
      float d = min(hw - abs(ds), len - rr);
      if (d > fan) {
        fan = d;
        fanU = ds / hw;
        fanV = rr / max(len, 1e-4);
        fanA = ds / (dA + 0.002);
      }
    }
  }
  float cbL = cb + wf * (0.04 - 0.1 * notch)
            + (vnoise(vec2(s * 90.0 * freq, 5.0)) - 0.5) * wf * 0.1
            + (vnoise(vec2(s * 260.0 * freq, 5.0)) - 0.5) * 0.004 / freq;

  if (y < cbL) {
    vec2 p = vec2(s, y) * freq;
    // The main massif's relief comes from its spurs; Sassopiatto's slab
    // faces the sky, tilted toward us, its grain running down the dip.
    float nx = nxMacro;
    float ny = 0.0;
    float crease = 0.0;
    float zFace = 0.0;
    float slab = 0.0;
    if (hero) {
      vec4 F = spurFace(s, y);
      // The slab is the mountain's sloping top, seen edge on under the
      // skyline. The pillars of the wall below it (the spurs past its start,
      // see terrain.js) stand up into its lower edge, each to a point.
      // Their tops are blunt and uneven, some broader than others.
      float lip = 9.0;
      for (int i = 0; i < 32; i++) {
        vec4 P = uSpur[i];
        if (P.y > 5.0) break;
        if (P.x <= uSlab.x) continue;
        // A rounded cap hw either side of the pillar's line, then its flanks.
        float hw = 0.002 + 0.005 * hash12(vec2(float(i), 4.1));
        float d = abs(s - P.x);
        float t = min(d, hw);
        lip = min(lip, P.y + 0.6 * t * t / hw + 2.4 * max(d - hw, 0.0));
      }
      lip += (vnoise(vec2(s * 260.0, 1.0)) - 0.5) * 0.005 + (vnoise(vec2(s * 900.0, 2.0)) - 0.5) * 0.002;
      slab = smoothstep(lip + 0.0015, lip - 0.0015, y) * smoothstep(uSlab.x - 0.006, uSlab.x + 0.002, s)
           * smoothstep(uSlab.y + 0.012, uSlab.y - 0.008, s);
      vec2 fg = mix(F.yz, vec2(-0.12, 2.0), slab);
      // Gently: hard-turned flanks would light and darken every spur alike,
      // in stripes. The shadows they cast carry the big shapes instead.
      nx = clamp(-fg.x * 0.42, -1.2, 1.2);
      ny = fg.y * 0.4;
      crease = F.w * (1.0 - slab);
      zFace = F.x;
      // Past the saddle the grassy range's bands of rock have no spurs of
      // their own; they face the way its crest falls.
      float past = smoothstep(uSlab.y, uSlab.y + 0.03, s);
      nx = mix(nx, nxMacro, past);
      ny *= 1.0 - past;
      crease *= 1.0 - past;
    }
    float e = PX * freq;
    float rib;
    float rd;
    float h0 = rockH(p, rib);
    vec2 g = vec2(rockH(p + vec2(e, 0.0), rd) - h0, rockH(p + vec2(0.0, e), rd) - h0) / e;
    // The slab is far smoother than the walls; a low sun across it would
    // pick out any ribs as stripes.
    g *= 1.0 - 0.95 * slab;
    // The Sella's walls are bedded: ledges run along them and catch the sky,
    // and a terrace of scree and snow parts the lower wall from the upper.
    float bed = row == 3 ? smoothstep(uSella.x, uSella.x + 0.03, s) * smoothstep(uSella.y, uSella.y - 0.03, s) : 0.0;
    // How strongly the bedding shows: plainly on the Sella, less so on the
    // main massif, where its ledges dip gently west and cross the spurs.
    float bw = hero ? 0.75 * (1.0 - slab) : bed;
    float bedTone = 1.0;
    float ledge = 0.0;
    float joint = 0.0;
    float gully = 0.0;
    float terr = 0.0;
    float shelf = 0.0;
    // Which tier of the Sella: the upper wall stands back from the lower, so
    // their pillars and stains don't line up.
    float tier = 0.0;
    if (bw > 0.0) {
      // Beds, each a slightly different stone, and here and there the top
      // of one makes a ledge where scree lies.
      float tilt = hero ? 0.3 : 0.0;
      float yb = (y + tilt * s + (vnoise(vec2(s * 12.0, 6.0)) - 0.5) * 0.006) / (hero ? 0.014 : 0.011);
      float li = floor(yb);
      float lf = fract(yb);
      bedTone = 0.92 + 0.16 * mix(hash12(vec2(li, 3.7)), hash12(vec2(li + 1.0, 3.7)), smoothstep(0.8, 1.0, lf));
      float run = smoothstep(0.4, 0.65, vnoise(vec2(s * 22.0, li * 1.7)));
      ledge = smoothstep(0.22, 0.0, lf) * step(0.5, hash12(vec2(li, 8.1))) * run * bw;
      ny += 0.3 * ledge;
    }
    if (bed > 0.0) {
      float upper = smoothstep(0.004, 0.02, uSella.z - top);
      float ly = uSella.z + ((vnoise(vec2(s * 5.0, 1.0)) - 0.5) * 0.008 + (vnoise(vec2(s * 30.0, 1.0)) - 0.5) * 0.003) * upper;
      float lip = ly + (vnoise(vec2(s * 150.0, 8.0)) - 0.5) * 0.0025;
      // Where the upper tier has fallen back, the whole wall is the lower one.
      tier = mix(1.0, smoothstep(lip - 0.001, lip + 0.001, y), upper) * bed;
      // Broad pillars between the gullies, each with a face to the west and
      // one to the east, and joints cutting the beds into blocks.
      float pc = s * 15.0 + (vnoise(vec2(s * 5.0, 1.0)) - 0.5) * 1.6 + (vnoise(vec2(y * 30.0, 3.0)) - 0.5) * 0.08 + tier * 0.45;
      float pf = fract(pc);
      float ph = hash12(vec2(floor(pc), 4.4));
      float pa = 0.3 + 0.4 * ph;
      float amp = 0.1 + 0.3 * hash12(vec2(floor(pc), 6.2));
      nx += mix(-amp, amp, smoothstep(pa - 0.15, pa + 0.15, pf)) * bed;
      gully = smoothstep(0.08, 0.0, min(pf, 1.0 - pf)) * step(0.45, ph) * bed;
      float jx = s * 70.0 + 0.5 * hash12(vec2(floor(y / 0.011), 1.3));
      joint = smoothstep(0.1, 0.0, abs(fract(jx) - 0.5)) * step(0.6, hash12(vec2(floor(jx), floor(y / 0.011)))) * bed;
      g.x *= 1.0 - 0.6 * bed;
      // The terrace between the tiers: a shelf of scree and old snow that
      // rises and falls a little along the wall, widens and narrows, and is
      // broken where a gully comes down through it. Where the upper tier has
      // fallen back to nothing it is the lower tier's top, and lies level.
      float T = 0.004 + 0.009 * smoothstep(0.25, 0.85, vnoise(vec2(s * 8.0, 3.0)));
      // Cones of scree run up from it into the upper wall's gullies.
      float gs = min(pf, 1.0 - pf) / 15.0;
      float cone = max(0.0, (0.006 + 0.008 * ph) * step(0.45, ph) - gs * 1.4) * upper;
      float yt = ly - T - cone + (vnoise(vec2(s * 400.0, 7.0)) - 0.5) * 0.002;
      float cut = smoothstep(0.6, 0.8, vnoise(vec2(s * 36.0, 5.0)));
      terr = smoothstep(yt - 0.0015, yt + 0.0015, y) * smoothstep(lip + PX, lip - PX, y) * bed * (1.0 - 0.9 * cut);
      // The upper wall's foot stands in the shelf's shade, and the shelf's
      // lip shades the top of the wall below it.
      float above = yt - y;
      float below = y - lip;
      shelf = (smoothstep(0.012, 0.0, above) * step(0.0, above) * 0.15 + smoothstep(0.005, 0.0, below) * step(0.0, below) * 0.12)
            * bed * (1.0 - cut) * upper;
      ny = mix(ny, 0.55, terr);
      nx = mix(nx, sign(0.5 - pf) * 0.35 * smoothstep(0.0, 0.004, cone), terr);
    }
    // The slab swells and sags a little.
    nx += (vnoise(p * 7.0 + 5.0) - 0.5) * 0.25 * slab;
    vec3 N = normalize(vec3(nx - g.x, 0.12 + ny + g.y, 1.0));

    // Neighbouring towers block a low sun, and the ribs shade the gullies
    // beside them. On the main massif the spurs cast the towers' shadows
    // instead: this crude test, from the crest alone, shades a whole column
    // down to the foot and leaves a straight vertical edge.
    float sideLight = uSunDir.x / max(0.2, abs(uSunDir.z) + 0.15);
    float sh = 1.0;
    if (!hero) {
      float e0 = ridge(row, s).z;
      for (int i = 1; i <= 3; i++) {
        float k = float(i) * 0.011;
        float ek = ridge(row, s + sign(uSunDir.x) * k).z;
        sh = min(sh, smoothstep(-0.004, 0.006, k * 0.5 / max(abs(sideLight), 0.05) - (ek - e0) * 1.6));
      }
      sh = mix(1.0, sh, smoothstep(0.02, 0.15, v));
    }
    vec2 Lp = vec2(uSunDir.x, -uSunDir.y);
    float Ll = length(Lp);
    // Only a low sun, from the side, throws a rib's shadow far enough to see.
    float side = smoothstep(0.15, 0.5, abs(uSunDir.x)) * smoothstep(0.55, 0.25, uSunDir.y);
    if (Ll > 0.05 && side > 0.0) {
      vec2 dir = Lp / Ll;
      float rise = max(uSunDir.z, 0.0) / Ll;
      float rs = 1.0;
      for (int i = 1; i <= 3; i++) {
        float d = 0.0025 * float(i * i);
        rs = min(rs, smoothstep(-0.001, 0.001, h0 + d * rise - rockH(p + dir * d, rd)));
      }
      sh = min(sh, mix(1.0, rs, side * (1.0 - slab)));
    }
    sh *= 1.0 - gul * 0.12;
    // Spurs throw their shadows across the faces beside them.
    // The slab lies above them all, a plane open to the sun.
    if (hero) sh = min(sh, mix(spurShadow(s, y, zFace, row - 1), 1.0, slab));

    // Gullies and couloirs lie in their own shade.
    float ao = mix(0.7 + 0.3 * smoothstep(0.2, 0.75, rib), 0.85, max(0.6 * bed, slab))
             * (1.0 - gul * 0.15) * (1.0 - 0.2 * crease) * (1.0 - (0.22 * gully + 0.12 * joint) * (1.0 - terr)) * (1.0 - shelf);

    // Pale dolomite, cream to grey, with rust where blocks broke away. The
    // tones run down the wall, as the weather stains it.
    vec2 pt = p + vec2(tier * 3.7, 0.0);
    float big = fbm3(vec2(pt.x * 9.0, pt.y * 2.4));
    vec3 alb = mix(LIME, LIME_GREY, smoothstep(0.4, 0.85, big));
    float och = smoothstep(0.58, 0.8, fbm3(vec2(pt.x * 14.0 + 4.0, pt.y * 1.8)));
    alb = mix(alb, OCHRE, och * (0.45 - 0.25 * bed));
    // Dark streaks where water runs down, mostly in the gullies.
    float st = smoothstep(0.62, 0.9, vnoise(vec2(pt.x * 260.0, pt.y * 7.0)))
             * smoothstep(0.35, 0.6, vnoise(vec2(pt.x * 40.0, pt.y * 1.5) + 3.0));
    st *= (1.0 - 0.7 * smoothstep(0.3, 0.8, rib)) * smoothstep(0.05, 0.3, v) * (1.0 - slab);
    alb = mix(alb, STREAK, st * 0.5);
    // Lichen low on the wall, and the grain of the stone.
    alb = mix(alb, vec3(0.58, 0.6, 0.53), smoothstep(0.65, 1.0, v) * 0.25);
    if (slab > 0.0) {
      // The slab's stone is pale and mottled, finely lined along its dip
      // where one bed shows under the next. Where its tail runs down to the
      // Alpe the meadow climbs onto it from below, in strips along the slope.
      float mot = fbm3(vec2(p.x * 20.0, p.y * 15.0) + 2.0);
      vec3 sa = mix(LIME, LIME_GREY, smoothstep(0.3, 0.75, mot));
      float lines = vnoise(vec2(s * 30.0, depth * 650.0)) * smoothstep(0.3, 0.6, vnoise(vec2(s * 45.0, depth * 90.0)));
      sa *= (0.94 + 0.1 * vnoise(vec2(p.x * 150.0, p.y * 120.0))) * (1.0 - 0.12 * lines);
      float gn = fbm3(vec2(s * 32.0, depth * 110.0) + 4.0) + 0.1 * vnoise(vec2(s * 200.0, depth * 500.0));
      float turf = smoothstep(0.66, 0.8, v + 0.3 * (gn - 0.5));
      // The same grass as on the slopes below the walls.
      vec3 grass = mix(GRASS_G, GRASS_Y, 0.25 + 0.35 * fbm3(vec2(s * 30.0, y * 60.0))) * 0.84;
      sa = mix(sa, grass, turf);
      alb = mix(alb, sa, slab);
      // Turf lies flatter than the rock and takes the light as the meadow does.
      N = normalize(mix(N, normalize(vec3(N.x * 0.3, 0.55, 0.85)), turf * slab));
    }
    alb *= 0.94 + 0.09 * vnoise(vec2(p.x * 600.0, p.y * 250.0));
    // Paler and greyer beds, and scree on the ledges.
    alb *= mix(1.0, bedTone, bw);
    alb = mix(alb, SCREE * 1.1, ledge * 0.3);
    if (bed > 0.0) {
      // The terrace's scree, with snow lying in it.
      vec3 tc = SCREE * (0.88 + 0.16 * vnoise(vec2(s * 700.0, y * 500.0)));
      tc = mix(tc, SNOW, smoothstep(0.6, 0.85, vnoise(vec2(s * 90.0, y * 300.0) + 2.0)) * 0.3);
      alb = mix(alb, tc, terr);
    }

    // First snow lying in patches where the rock is flatter, up high.
    float snowy = smoothstep(0.55, 0.85, N.y) * smoothstep(0.75, 0.15, v) * (1.0 - 0.8 * slab);
    snowy *= smoothstep(0.4, 0.6, vnoise(p * vec2(60.0, 40.0) + 9.0));
    alb = mix(alb, SNOW, clamp(snowy, 0.0, 1.0) * 0.85);

    vec3 c = shade(alb, N, ao, sh);
    // The pale rock in the sun lights the faces turned from it, so shade on
    // these walls is grey, never black.
    float lit = clamp(dot(N, uSunDir), 0.0, 1.0) * sh;
    c += alb * (uSunCol * 0.16 + uAmb * 0.15) * (1.0 - lit) * mix(1.0, ao, 0.5);
    // A low sun sets the pale rock glowing.
    c += alb * uSunCol * max(dot(N, uSunDir), 0.0) * sh * 0.25 * smoothstep(0.4, 0.06, uSunDir.y) * (1.0 - uStars);
    // Early snow lies on the flatter tops and ledges just below them.
    float flatTop = smoothstep(0.8, 0.2, abs(dE.x));
    float capD = (0.0025 + 0.006 * vnoise(vec2(s * 150.0 * freq, 1.7)) + 0.002 * vnoise(vec2(s * 900.0 * freq, 3.1))) / sqrt(freq) * flatTop;
    float cap = clamp((capD - depth) / PX + 0.5, 0.0, 1.0) * smoothstep(0.3, 0.5, vnoise(vec2(s * 400.0 * freq, y * 200.0 * freq)));
    // On the Sella's long level rim it lies only here and there, and none on
    // a sliver of rock, where it would only frost the crest.
    cap *= mix(1.0, smoothstep(0.6, 0.75, vnoise(vec2(s * 45.0, 4.0))), bed) * smoothstep(0.02, 0.05, cb - top) * (1.0 - 0.85 * slab);
    c = mix(c, shade(SNOW, normalize(vec3(N.x * 0.3, 0.75, 0.65)), 1.0, sh), cap * 0.9);
    // Thin bright line along the crest when lit from the side.
    c += alb * uSunCol * exp(-depth * 1400.0 / freq) * 0.25 * abs(uSunDir.x);
    return c;
  }

  float m = fbm3(vec2(s * 30.0, y * 60.0));
  vec3 meadow = mix(GRASS_G, GRASS_Y, 0.25 + 0.35 * m);
  float dy = y - cbL;
  float present = smoothstep(0.01, 0.035, cb - top);
  vec3 grassC = slopeColor(s, y, freq, nxMacro, meadow, 0.85 + 0.15 * smoothstep(0.0, reach, dy), smoothstep(reach * 0.3, reach * 1.1, dy) * smoothstep(reach * 5.0, reach * 2.5, dy));
  if (dy < reach * 2.4 && present > 0.0) {
    // A skirt of scree along the whole foot of the walls; the cones below
    // the gullies run out further and merge into it.
    float sk = fbm3(vec2(s * 16.0 * freq, 1.3));
    float skirt = reach * (0.04 + 0.75 * sk * sk) * present;
    float scal = (vnoise(vec2(s * 150.0 * freq, 2.0)) - 0.5) * reach * 0.22 + (vnoise(vec2(s * 600.0 * freq, 6.0)) - 0.5) * reach * 0.07;
    float dS = skirt + scal - dy;
    float k = reach * 0.4;
    float hh = clamp(0.5 + 0.5 * (fan - dS) / k, 0.0, 1.0);
    float d = mix(dS, fan, hh) + k * hh * (1.0 - hh);
    // Ragged edge where grass creeps up into the stones.
    float patchy = (fbm3(vec2(s * 90.0 * freq, y * 40.0 * freq)) - 0.5) * reach * 0.3;
    float rag = (vnoise(vec2(s * 700.0 * freq, y * 300.0 * freq)) - 0.5) * 0.003 / freq;
    d += patchy * smoothstep(0.0, reach * 0.4, dy) + rag;
    float tuft = hash12(floor(vec2(s, y) / (PX * vec2(2.0, 1.5))));
    float inScree = clamp(d / (PX * 1.5) + 0.5 + (tuft - 0.5) * 1.2 * smoothstep(0.005, 0.0, abs(d)), 0.0, 1.0);

    if (inScree > 0.0) {
      float u = fanU * hh;
      float vv = mix(clamp(dy / max(skirt + scal, 1e-3), 0.0, 1.0), clamp(fanV, 0.0, 1.0), hh);
      // Cones are rounded across, steepest near the apex.
      vec3 N = normalize(vec3(u * 0.22 + nxMacro * 0.1, 0.42 + 0.25 * vv, 0.85));
      // Fresh pale stone down the active channel, older grey at the sides
      // and the toe.
      vec3 alb = SCREE * mix(1.1, 0.88, smoothstep(0.15, 1.0, vv));
      alb *= 1.0 + 0.08 * (1.0 - abs(u)) * hh;
      alb *= 0.94 + 0.08 * vnoise(vec2(s * 40.0 * freq, 1.0));
      // Stones run down the fall line in streaks.
      float fall = mix(vnoise(vec2(s * 320.0 * freq, dy * 18.0 * freq)), vnoise(vec2(fanA * 14.0, vv * 3.0 + floor(s * cf))), hh);
      alb *= 0.86 + 0.22 * fall;
      // Small stones near the top, bigger ones toward the toe.
      float sz = PX * mix(1.2, 2.6, vv);
      vec2 cid = floor(vec2(s, y) / (sz * vec2(1.0, 0.7)));
      alb *= 1.0 + (hash12(cid) - 0.6) * 0.18 / freq;
      alb *= 0.96 + 0.06 * vnoise(vec2(s * 1500.0, y * 1100.0));
      // Lichen and grass on the old toe.
      float veg = smoothstep(0.38, 0.7, fbm3(vec2(s * 120.0 * freq, y * 200.0 * freq))) * smoothstep(0.3, 0.95, vv);
      alb = mix(alb, meadow * 0.8, veg * 0.7);
      // The wall shades the top of the skirt.
      float foot = smoothstep(reach * 0.25, 0.0, dy);
      vec3 sc = shade(alb, N, 1.0 - foot * 0.15, 1.0 - foot * 0.25);
      return mix(grassC, sc, inScree * (1.0 - 0.45 * smoothstep(0.6, 1.0, vv)));
    }
  }
  return grassC;
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

// Slow or still layers are drawn ahead into textures (premultiplied, without
// parallax) and looked up at a layer's shifted position.
vec4 bakedAt(sampler2D tex, float s, float y) {
  vec2 px = vec2((s - uView.z) * uView.y * uRes.y + 0.5 * uRes.x, uRes.y - (y * uView.y + uView.x) * uRes.y);
  return texture(tex, (px + uBakeM) / (uRes + 2.0 * uBakeM));
}

/* Trees ----------------------------------------------------------------- */

// Edge of the forest band: it wanders, so the trees there thin out unevenly.
float forestEdge(float x) {
  return (vnoise(vec2(x * 11.0, 4.0)) - 0.5) * 0.03 + (vnoise(vec2(x * 37.0, 9.0)) - 0.5) * 0.012;
}

// Groves in the forest band. The noise is warped so their outlines meander.
float grove(float x, float y) {
  vec2 q = vec2(x * 8.0, y * 44.0);
  q += (vec2(vnoise(q * 1.6 + 11.0), vnoise(q * 1.6 + 23.0)) - 0.5) * 1.8;
  return vnoise(q) * 0.65 + vnoise(q * 2.4 + 5.0) * 0.35;
}

// Where trees grow. Groves and forest thin out at their edges rather than
// stopping, and lone trees stand out in the meadow.
vec2 meadowDensity(float x, float y, float g);

float treeDensity(float x, float y, bool forest, float g) {
  if (forest) {
    // Groves close up toward the viewer; near the edge they break apart.
    float e = y - g - forestEdge(x);
    float deep = smoothstep(0.0, 0.08, e);
    float d = smoothstep(0.4 - 0.1 * deep, 0.68 - 0.1 * deep, grove(x, y));
    // Small gaps where an old tree fell, and within a grove the trees stand
    // in knots and thin patches rather than in even ranks.
    float gap = smoothstep(0.62, 0.78, vnoise(vec2(x * 16.0, y * 48.0) + 3.0));
    float knot = mix(0.5, 1.0, smoothstep(0.32, 0.62, vnoise(vec2(x * 52.0, y * 150.0) + 17.0)));
    return (0.025 + 0.9 * d * knot * (1.0 - 0.5 * gap)) * smoothstep(-0.015, 0.01, e);
  }
  return meadowDensity(x, y, g).x;
}

// Meadow groves: how likely a tree is here, and how tall it may grow. Groves
// are domed, the young trees at the edge shorter than the old ones inside;
// lone trees in the open grow full.
vec2 meadowDensity(float x, float y, float g) {
  vec4 lk = ridge(6, x);
  bool lake = lk.z > lk.y;
  if (lake && y > lk.y - 0.0015 && y < lk.z + 0.008) return vec2(0.0, 1.0);
  // Groves with meandering outlines and open pasture between them; a few
  // stragglers just outside each grove, and now and then a lone tree.
  vec2 q = vec2(x * 8.0, y * 26.0);
  q += (vec2(vnoise(q * 1.7 + 11.0), vnoise(q * 1.7 + 23.0)) - 0.5) * 1.6;
  float n = vnoise(q) * 0.58 + vnoise(q * 2.3 + 5.0) * 0.27 + vnoise(q * 5.3 + 9.0) * 0.15;
  // Inside a grove the trees bunch up and thin out; the pasture between
  // groves stays mostly open.
  float knot = mix(0.55, 1.0, smoothstep(0.3, 0.62, vnoise(vec2(x * 70.0, y * 210.0) + 17.0)));
  float d = smoothstep(0.47, 0.62, n) * 0.95 * knot + smoothstep(0.38, 0.48, n) * 0.06 + 0.007;
  float hs = n < 0.44 ? 1.0 : mix(0.45, 1.0, smoothstep(0.47, 0.72, n));
  // A dark belt of forest along the foot of the massif, deeper and closer
  // where it climbs over the foothills.
  float knoll = clamp((0.608 - g) / 0.04, 0.0, 1.0);
  float bd = 0.022 + 0.03 * knoll;
  float belt = smoothstep(bd, bd * mix(0.2, 0.5, knoll), y - g + (vnoise(vec2(x * 40.0, 4.0)) - 0.5) * 0.01)
             * smoothstep(0.32 - 0.25 * knoll, 0.5 - 0.25 * knoll, vnoise(vec2(x * 8.0, 2.0)));
  if (lake) {
    // Spruce crowding the far shore.
    float far = lk.y - y + (vnoise(vec2(x * 22.0, 7.0)) - 0.5) * 0.01;
    belt = max(belt, smoothstep(0.03, 0.004, far) * step(0.0, lk.y - y) * smoothstep(0.25, 0.45, vnoise(vec2(x * 30.0, 5.0))));
  }
  hs = mix(hs, 1.0, smoothstep(0.3, 0.8, belt));
  d = max(d, belt * 0.92);
  vec2 hp = vec2((x - uHut.x) / 0.05, (y - uHut.y) / 0.02);
  d *= smoothstep(0.9, 1.3, length(hp));
  return vec2(d, hs);
}

// How big a tree grows, against the tallest a tree can be (1.37, which
// trees() allows for). Mostly middling trees, some saplings, now and then an
// old giant; and whole stands run a little older or younger than the next.
float treeSize(vec2 cell, float r4, float tx, float ty) {
  float age = 0.84 + 0.16 * vnoise(vec2(tx * 14.0, ty * 50.0) + 31.0);
  return (0.5 + 0.65 * r4 * r4 + 0.22 * step(0.93, hash12(cell + 2.9))) * age;
}

// The meadow tree in grid cell (i, j), if one grows there: its base and
// height, or zero height where none does. Must match trees().
vec3 meadowTree(float i, float j) {
  const float cw = 0.0092;
  const float ch = 0.0027;
  vec2 cell = vec2(i, j);
  float ty = (j + 0.05 + 0.9 * hash12(cell + 19.19)) * ch;
  vec4 lk = ridge(6, (i + 0.5) * cw);
  if (ty < lk.x + 0.002) return vec3(0.0);
  if (lk.z > lk.y + 0.004 && ty > lk.y + 0.002 && ty < lk.z + 0.006) return vec3(0.0);
  float tx = (i + 0.05 + 0.9 * hash12(cell)) * cw;
  float r4 = hash12(cell + 71.3);
  float persp = mix(0.55, 1.3, smoothstep(0.6, 0.84, ty));
  float size = treeSize(cell, r4, tx, ty);
  vec2 dens = meadowDensity(tx, ty, lk.x);
  if (hash12(cell + 47.7) > dens.x) return vec3(0.0);
  return vec3(tx, ty, 0.021 * persp * size * dens.y);
}

// Shade the meadow trees cast: walk over the ground toward the sun and look
// for a tree tall enough to stand in the way.
float treeShadow(float s, float y) {
  vec2 Lg = vec2(uSunDir.x, uSunDir.z);
  float lg = length(Lg);
  if (lg < 1e-3) return 0.0;
  float tanA = max(uSunDir.y, 0.05) / lg;
  // How much the ground is foreshortened, more so further away.
  float f = mix(0.08, 0.3, smoothstep(0.62, 0.86, y));
  vec2 dir = vec2(Lg.x, Lg.y * f) / lg;
  float sh = 0.0;
  for (int k = 1; k <= 12; k++) {
    float t = 0.0035 * float(k);
    float H = bakedAt(uFoot, s + dir.x * t, y + dir.y * t).r * 0.06;
    // The shadow's edge softens, and it fades, the further it falls.
    sh = max(sh, smoothstep(t * tanA, t * tanA + 0.003 + 0.0006 * float(k), H) * (1.0 - 0.065 * float(k)));
  }
  // Only the direct light is blocked; the sky still lights the shade.
  float d = max(dot(vec3(0.0, 0.8, 0.6), uSunDir), 0.0) * 0.78;
  float sun = dot(uSunCol, vec3(0.3, 0.5, 0.2)) * d;
  float amb = dot(uAmb, vec3(0.3, 0.5, 0.2)) * 0.75;
  // Far off, a shadow is thinner than a pixel and would read as a line.
  sh *= mix(0.3, 1.0, smoothstep(0.66, 0.76, y));
  return sh * sun / (sun + amb + 1e-4);
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
      float size = treeSize(cell, r4, tx, ty);
      float hgt = (forest ? 0.05 : 0.021) * persp * size * 1.12;
      if (up > hgt) continue;
      float dx = s - tx;
      if (abs(dx) > hgt * 0.42 + PX) continue;
      float r3 = hash12(cell + 47.7);
      vec2 md = forest ? vec2(treeDensity(tx, ty, true, g), 1.0) : meadowDensity(tx, ty, g);
      float dens = md.x;
      if (r3 > dens) continue;
      // Young trees at a grove's ragged edge, older ones in its heart; lone
      // trees in the open grow full.
      // Groves are domed: their trees get shorter well before the edge.
      if (forest) hgt *= dens < 0.1 ? 0.8 : mix(0.4, 1.0, smoothstep(0.42, 0.9, grove(tx, ty)));
      else hgt *= md.y / 1.12;
      if (up > hgt) continue;
      float f = up / hgt;
      // Larches mix in with the spruce, thicker in some stands than others.
      vec2 sq = vec2(tx * 5.0, ty * (forest ? 34.0 : 14.0)) + seed * 0.01;
      sq += (vnoise(sq * 2.1 + 4.0) - 0.5) * 1.2;
      float stand = smoothstep(0.42, 0.75, vnoise(sq));
      bool larch = hash12(cell + 5.1) < 0.03 + 0.72 * stand;
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
        c = forest ? mix(c, uHaze, 0.16 * (1.0 - smoothstep(0.7, 0.9, ty))) : mix(c, uHaze, 0.32 * (1.0 - smoothstep(0.6, 0.76, ty)));
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

/* Lake ------------------------------------------------------------------ */

// How far the shores sit from the lake's centre line. Must match D.LAKE.
const vec2 LAKE_HALF = vec2(0.024, 0.062);

// Toward the ends of the lake, 0 to 1.
float lakeTip(float s) {
  return smoothstep(0.78, 0.99, abs(s - uLake.x) / uLake.z);
}

// How far (s, y) lies from the water, as if measured on the ground from
// above, in units of s; negative in the lake. It follows the outline
// terrain.js draws, shifted onto the baked shore, so it carries on past
// the ends of the lake.
float lakeDist(float s, float y, vec4 lk) {
  float x = abs(s - uLake.x) / uLake.z;
  float t = max(1.0 - x * x, 0.0);
  float tipY = uLake.y - LAKE_HALF.x * 0.5;
  bool open = lk.z > lk.y;
  bool farSide = y < (open ? 0.5 * (lk.y + lk.z) : tipY);
  float yy = y;
  if (open) yy -= farSide ? lk.y - (tipY - LAKE_HALF.x * 0.5 * pow(t, 0.35))
                          : lk.z - (tipY + (LAKE_HALF.y + LAKE_HALF.x * 0.5) * pow(t, 0.75));
  float v = farSide ? (tipY - yy) / (LAKE_HALF.x * 0.5) : (yy - tipY) / (LAKE_HALF.y + LAKE_HALF.x * 0.5);
  float r = sqrt(x * x + pow(max(v, 0.0), farSide ? 1.0 / 0.35 : 1.0 / 0.75));
  return (r - 1.0) * uLake.z;
}

// Reeds standing in the shallows toward each end of the lake, with their
// reflections where the water lies under them. Premultiplied.
vec4 reeds(float s, float y, float wa) {
  const float cw = 0.0013;
  float ic = floor(s / cw);
  vec4 o = vec4(0.0);
  for (int i = -1; i <= 1; i++) {
    float cs = (ic + float(i) + 0.5) * cw;
    // They grow in clumps, thickest where the water runs out.
    float tipK = lakeTip(cs);
    float dens = tipK * smoothstep(0.45, 0.7, vnoise(vec2(cs * 160.0, 3.0)) + 0.4 * tipK * tipK);
    if (dens <= 0.0) continue;
    vec4 lk = ridge(6, cs);
    if (lk.z <= lk.y) continue;
    for (int k = 0; k < 4; k++) {
      vec2 cell = vec2(ic + float(i), float(k) * 17.0);
      if (hash12(cell + 3.7) > dens) continue;
      float rx = (cell.x + 0.1 + 0.8 * hash12(cell + 1.3)) * cw;
      // Rooted in the shallows on either side, or anywhere across the
      // narrow water at the very end.
      float hs = hash12(cell + 8.1);
      float wd = lk.z - lk.y;
      float base = hs < 0.4 ? lk.y + hs * min(wd, 0.006) : lk.z - (hs - 0.4) * min(wd, 0.006);
      float near = smoothstep(lk.y, lk.z, base);
      float h = (0.0018 + 0.0045 * pow(hash12(cell + 2.2), 1.5)) * mix(0.6, 1.0, near) * mix(0.6, 1.0, dens);
      float lean = (hash12(cell + 6.6) - 0.5) * 0.5;
      float up = base - y;
      float tt = abs(up) / h;
      if (tt > 1.0 || (up < 0.0 && wa <= 0.0)) continue;
      float w = PX * mix(0.8, 0.3, tt);
      // Each blade bows as it rises.
      float a = clamp((w - abs(s - rx - lean * abs(up) * (0.4 + 0.8 * tt))) / PX + 0.5, 0.0, 1.0);
      if (a <= 0.0) continue;
      float hue = hash12(cell + 9.4);
      vec3 alb = mix(mix(GRASS_Y, GRASS_R, hue), GRASS_G, 0.25 * step(0.7, hue)) * mix(0.5, 1.0, tt);
      vec3 col = shade(alb, normalize(vec3(sign(lean) * 0.5, 0.35, 0.8)), 0.85, 1.0);
      // Upside down in the water, dimmer.
      if (up < 0.0) {
        a *= wa * 0.55;
        col *= 0.7;
      }
      o.rgb += (1.0 - o.a) * col * a;
      o.a += (1.0 - o.a) * a;
    }
  }
  return o;
}


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
  // Close under the far bank, and across the narrow ends, the water mirrors
  // the meadow rising from the shore rather than the mountains and sky.
  float tip = lakeTip(s);
  float hb = (0.0035 + 0.02 * tip) * (0.55 + 0.9 * vnoise(vec2(sr * 80.0, 1.0)));
  float dw = du + slope * 0.002;
  if (dw < hb) {
    vec3 land = shade(meadowAlb(sr, far - dw * 0.8, 0.45) * vec3(0.78, 0.9, 0.84), vec3(0.0, 1.0, 0.45), 0.9, 1.0);
    refl = mix(refl, land * 0.78, smoothstep(hb, hb * 0.5, dw));
  }
  refl = racc + (1.0 - rA) * refl;

  // Looking across the water it is a mirror; looking down it is dark green.
  float fres = mix(0.93, 0.5, u * u) * mix(1.0, 0.82, wind);
  vec3 body = mix(WATER_DEEP, WATER_SHALLOW, smoothstep(0.7, 1.0, u)) * (uAmb * 0.75 + uSunCol * 0.35 * max(uSunDir.y, 0.0));
  vec3 c = mix(body, refl * vec3(0.84, 0.89, 0.88), fres);
  // Roughened patches pick up a little more of the sky, more so at night,
  // when it is the brightest thing about.
  c = mix(c, skyBase(0.15) * 0.82, wind * (0.12 + 0.12 * uStars) * (1.0 - u * 0.5));

  // Glints on the wavelets, brighter where the breeze is.
  float glint = smoothstep(0.78, 0.95, w2) * smoothstep(0.55, 0.75, w1);
  c += (uSunCol * 0.5 + uAmb * 0.15) * glint * (0.15 + 0.5 * wind) * (1.0 - u * 0.6);

  // After dark the hut's lit window lays a broken path of light across the
  // water toward us, widening and fading as it comes.
  float dh = y - uHut.y;
  if (uLamp > 0.01 && dh > 0.0) {
    float pw = 0.0022 + dh * 0.22;
    float path = exp(-pow((s + slope * 0.004 - uHut.x + 0.0062) / pw, 2.0)) * exp(-dh * 30.0);
    float spark = smoothstep(0.45, 0.8, w1 * 0.55 + w2 * 0.65 - 0.1 + rip * 0.3);
    c += LAMP * uLamp * path * (0.18 + 1.3 * spark) * 0.6;
  }
  // Ripple rings catch the light on one side and darken on the other.
  c += (uAmb * 0.3 + uSunCol * 0.25) * max(rip, 0.0) * 0.35;
  c -= c * max(-rip, 0.0) * 0.25;

  // Near shore: right under the bank the water lies in its shade, and a
  // little further out the stony bottom shows through the shallows.
  float nd = near - y;
  float shallow = smoothstep(0.001, 0.003, nd) * smoothstep(0.009, 0.004, nd) * (1.0 - tip);
  shallow *= smoothstep(0.35, 0.7, vnoise(vec2(s * 35.0, 6.0)));
  vec3 bed = shade(SAND * (0.6 + 0.35 * vnoise(vec2(s * 600.0, y * 1200.0))), vec3(0.0, 1.0, 0.3), 1.0, 1.0);
  c = mix(c, mix(bed, WATER_SHALLOW * uAmb, 0.7), shallow * 0.3);
  c *= 1.0 - 0.5 * smoothstep(0.0028, 0.0, nd);
  // A dark lip where the far bank meets the water.
  c *= 1.0 - 0.35 * smoothstep(0.0012, 0.0, du);
  return c;
}

/* Ground ---------------------------------------------------------------- */

// Late-season pasture: tawny on the rises, still green in the hollows, with
// russet patches of bilberry turning. hl is the lie of the land, 0 to 1.
vec3 meadowAlb(float s, float y, float hl) {
  vec2 q = vec2(s * 9.0, y * 40.0);
  q += (vnoise(q * 1.9 + 3.0) - 0.5) * 0.9;
  float n1 = vnoise(q + 9.0);
  float n2 = vnoise(vec2(s * 22.0, y * 90.0) + 4.0);
  float dry = smoothstep(0.4, 0.85, n1 * 0.7 + hl * 0.45);
  vec3 a = mix(GRASS_G, GRASS_Y, dry * 0.8);
  a = mix(a, GRASS_R, smoothstep(0.6, 0.8, n2) * (0.2 + 0.3 * dry));
  a = mix(a, GRASS_G * 0.82, smoothstep(0.42, 0.18, hl) * 0.55);
  // Tussocks, coarser than the grain.
  a *= 0.9 + 0.16 * vnoise(vec2(s * 80.0, y * 300.0));
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
  vec3 N = normalize(vec3(-gx * 2.6, 1.0, 0.35 + gy * 1.3));
  // Along the meadow's far edge the foothills' flanks turn toward the sun or
  // away from it as the edge rises and falls.
  if (d < 0.045) {
    float fl = clamp((ridge(6, s + 0.004).x - ridge(6, s - 0.004).x) / 0.008, -2.0, 2.0) * smoothstep(0.045, 0.0, d);
    N = normalize(N + vec3(fl * 0.9, 0.0, -0.25 * abs(fl)));
  }
  float hl = 0.5 + (hills(p) - 0.5) * 1.6;
  vec3 alb = meadowAlb(s, y, clamp(hl, 0.0, 1.0));
  // The forest on the foothills is dense: between its trees only the dark
  // of the wood beneath them. The same belt as in meadowDensity().
  float knoll = clamp((0.608 - top) / 0.04, 0.0, 1.0);
  if (knoll > 0.0 && d < 0.06) {
    float bd = 0.022 + 0.03 * knoll;
    float wood = smoothstep(bd, bd * mix(0.2, 0.5, knoll), d + (vnoise(vec2(s * 40.0, 4.0)) - 0.5) * 0.01)
               * smoothstep(0.32 - 0.25 * knoll, 0.5 - 0.25 * knoll, vnoise(vec2(s * 8.0, 2.0))) * knoll;
    alb = mix(alb, mix(SPRUCE, MUGO, vnoise(vec2(s * 260.0, y * 400.0))), wood * 0.85);
  }

  // The lake lies in a hollow: the ground falls to it, lush and damp near the
  // water, and where it runs out at either end the shallows fill with sedge.
  vec4 lk = ridge(6, s);
  float lx = (s - uLake.x) / uLake.z;
  bool byLake = lk.z > lk.y ? y > lk.y - 0.006 && y < lk.z + 0.012
                            : abs(lx) < 1.15 && abs(y - uLake.y + LAKE_HALF.x * 0.5) < 0.025;
  float tip = 0.0;
  float ld = 1.0;
  if (byLake) {
    ld = lakeDist(s, y, lk);
    tip = lakeTip(s);
    bool farSide = y < (lk.z > lk.y ? 0.5 * (lk.y + lk.z) : uLake.y);
    float wn = vnoise(vec2(s * 70.0, y * 260.0));
    float wet = smoothstep((farSide ? 0.05 : 0.03) * (0.4 + wn), 0.0, ld);
    alb = mix(alb, GRASS_G * vec3(0.8, 0.92, 0.8), wet * 0.55);
    float sn = vnoise(vec2(s * 45.0, y * 150.0));
    float sedge = tip * smoothstep(0.05 * (0.3 + sn), 0.0, ld);
    vec3 sed = mix(GRASS_Y, GRASS_R, vnoise(vec2(s * 350.0, y * 900.0))) * (0.7 + 0.35 * vnoise(vec2(s * 1600.0, y * 300.0)));
    alb = mix(alb, sed, sedge * 0.75);
    float fall = smoothstep(0.03, 0.0, ld) * (0.3 + 0.4 * wn);
    N = normalize(N + fall * vec3(-sign(lx) * tip, 0.0, (farSide ? 1.0 : -1.0) * (1.0 - tip)));
  }
  vec3 c = shade(alb, N, 1.0, 1.0 - 0.55 * cloudShadow(s, y));

  float wa = 0.0;
  if (lk.z > lk.y) {
    float far = lk.y;
    float near = lk.z;
    vec4 la = ridge(6, s - 0.002);
    vec4 lb = ridge(6, s + 0.002);
    float slope = abs(lb.y - la.y) / 0.004 + abs(lb.z - la.z) / 0.004;
    float sk = 1.0 / sqrt(1.0 + slope * slope * 0.25);
    // Tufts of grass on the near bank hang out over the water.
    float tuft = (vnoise(vec2(s * 2200.0, 3.0)) * 0.6 + vnoise(vec2(s * 700.0, 5.0)) * 0.4) * 0.0012;
    float dist = max(far - y, y - near + tuft) * sk;
    // The far shore is only meadow meeting the water: no bank, so it stays soft.
    if (y > 0.5 * (far + near)) {
      // The turf curls over the edge, in its own shade.
      c *= 1.0 - 0.3 * clamp((0.0014 - dist) / 0.0014, 0.0, 1.0);
      // Now and then a short beach of pale stones.
      float beachW = 0.003 * smoothstep(0.6, 0.72, vnoise(vec2(s * 30.0, 4.0))) * (1.0 - tip);
      vec3 peb = SAND * (0.7 + 0.4 * vnoise(vec2(s * 900.0, y * 1800.0)));
      float sa = clamp((beachW - dist) / PX + 0.5, 0.0, 1.0);
      c = mix(c, shade(peb, vec3(0.0, 1.0, 0.2), 1.0, 1.0), sa * 0.7);
    }
    wa = clamp(-dist / PX + 0.5, 0.0, 1.0);
    if (tip > 0.0 && wa > 0.0) {
      // Sedge creeps out over the water's last reach.
      float reach = 0.03 * tip * tip * (0.3 + 0.7 * vnoise(vec2(s * 260.0, y * 700.0)));
      float ldAA = length(vec2(lakeDist(s + PX, y, lk), lakeDist(s, y + PX, lk)) - ld);
      wa *= clamp(-(ld + reach) / max(ldAA, 1e-6) + 0.5, 0.0, 1.0);
    }
    if (wa > 0.0) c = mix(c, lakeColor(s, y, far, near, fc), wa);
  }
  if (tip > 0.0 && abs(y - uLake.y) < 0.05) {
    vec4 rd = reeds(s, y, wa);
    c = c * (1.0 - rd.a) + rd.rgb;
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

  // Flowers in drifts, buttercups most of all, with daisies, clover and
  // bellflowers among them; nearer, they are bigger.
  vec2 cs = vec2(0.0042, 0.0028);
  vec2 fi = floor(vec2(ss, yy) / cs);
  float patchN = smoothstep(0.38, 0.62, vnoise(vec2(ss * 12.0, yy * 30.0)));
  float drift = smoothstep(0.4, 0.62, vnoise(vec2(ss * 5.0, yy * 14.0) + 7.0));
  float near = smoothstep(0.84, 1.0, yy);
  vec3 lit = shade(vec3(1.0), vec3(0.0, 0.8, 0.6), 1.0, 1.0);
  if (hash12(fi + 3.3) < 0.06 + 0.5 * patchN) {
    vec2 fpos = (fi + vec2(0.2 + 0.6 * hash12(fi + 7.1), 0.2 + 0.6 * hash12(fi + 9.7))) * cs;
    float rad = 0.0013 * (0.75 + 0.5 * hash12(fi + 5.9)) * (0.8 + 1.6 * near);
    float dd = length((vec2(ss, yy) - fpos) * vec2(1.0, 1.3));
    float fa = clamp((rad - dd) / PX + 0.5, 0.0, 1.0);
    float pick = hash12(fi + 1.7);
    float py = mix(0.45, 0.9, drift);
    float q = (pick - py) / (1.0 - py);
    vec3 fcol = pick < py ? F_BUTTERCUP : (q < 0.4 ? F_CREAM : (q < 0.7 ? F_PINK : F_VIOLET));
    c = mix(c, fcol * lit, fa * 0.9);
  }
  // A dusting of small buttercups through the drifts.
  vec2 cs2 = cs * 0.5;
  vec2 fj = floor(vec2(ss, yy) / cs2);
  if (hash12(fj + 13.1) < 0.32 * drift * drift) {
    vec2 fpos = (fj + vec2(0.2 + 0.6 * hash12(fj + 2.3), 0.2 + 0.6 * hash12(fj + 4.1))) * cs2;
    float rad = 0.0008 * (0.8 + 1.4 * near);
    float dd = length((vec2(ss, yy) - fpos) * vec2(1.0, 1.3));
    c = mix(c, F_BUTTERCUP * lit, clamp((rad - dd) / PX + 0.5, 0.0, 1.0) * 0.85);
  }
  c += alb * uSunCol * exp(-d * 260.0) * 0.18;
  comp(acc, A, c, a);
}

// Each program is built with only the passes it draws, so the scene drawn
// every frame doesn't carry the registers the bakes need.
void main() {
#if PROG == 2
  if (uPass == 4) {
    // How much of each cell the baked trees cover, so animals keep clear.
    vec2 base = floor(gl_FragCoord.xy) * uCoverF;
    vec2 size = vec2(textureSize(uTreesP, 0));
    float p = 0.0;
    float q = 0.0;
    for (int i = 0; i < 8; i++) {
      for (int j = 0; j < 8; j++) {
        vec2 uv = (base + (vec2(float(i), float(j)) + 0.5) * uCoverF / 8.0) / size;
        // Cast shade is not a tree.
        p = max(p, smoothstep(0.7, 0.95, texture(uTreesP, uv).a));
        q = max(q, texture(uTreesF, uv).a);
      }
    }
    outColor = vec4(p, q, 0.0, 1.0);
    return;
  }
#endif
  vec2 fc = gl_FragCoord.xy;
#if PROG != 0
  if (uPass == 5) fc = fc * 2.0;
  fc -= uBakeM;
#endif
  float H = uRes.y;
  float sy = (H - fc.y) / H;
  float sx = (fc.x - 0.5 * uRes.x) / H;
  float y = (sy - uView.x) / uView.y;
  float s = sx / uView.y + uView.z;
  PX = 1.0 / (H * uView.y);

  vec3 acc = vec3(0.0);
  float A = 0.0;
#if PROG == 1
  // The far scene: the baked rock walls over the moving sky. Below the
  // meadow's edge only the lake's reflection needs it.
  if (y > max(ridge(6, s).x + 0.01, uLake.w + 0.004)) {
    outColor = vec4(uHaze, 1.0);
    return;
  }
  vec4 rk = texelFetch(uRock, ivec2(gl_FragCoord.xy), 0);
  acc = rk.rgb;
  A = rk.a;
  if (A < 0.995) comp(acc, A, sky(s, y, fc), 1.0);
  outColor = vec4(acc, 1.0);
#elif PROG == 2
  if (uPass == 6) {
    if (y > max(ridge(6, s).x + 0.01, uLake.w + 0.004)) {
      outColor = vec4(0.0);
      return;
    }
    layerHero(s, y, acc, A);
    if (A < 0.995) layerMidfar(s, y, acc, A);
    if (A < 0.995) layerFar(s, y, acc, A);
    outColor = vec4(acc, A);
    return;
  }
  if (uPass == 5) {
    // Where each meadow tree stands, and how tall it is, for their shadows.
    float ic = floor(s / 0.0092);
    float jc = floor(y / 0.0027);
    float Hm = 0.0;
    for (int a = -1; a <= 1; a++) {
      for (int b = -1; b <= 1; b++) {
        vec3 T = meadowTree(ic + float(a), jc + float(b));
        if (T.z <= 0.0) continue;
        float r = max(T.z * 0.3, 0.0025);
        float dd = length(vec2(s - T.x, (y - T.y) * 2.5)) / r;
        // A cone, so each shadow narrows to a point as the crown does.
        Hm = max(Hm, T.z * min(1.0, 1.3 * (1.0 - dd)));
      }
    }
    outColor = vec4(Hm / 0.06, 0.0, 0.0, 1.0);
    return;
  }
  {
    trees(s, y, uPass == 2, acc, A);
    if (uPass == 1 && A < 0.99) {
      vec4 lk = ridge(6, s);
      bool wet = lk.z > lk.y && y > lk.y - 0.001 && y < lk.z + 0.001;
      if (y > lk.x && !wet) comp(acc, A, vec3(0.0), treeShadow(s, y) * 0.85);
    }
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
#else
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
#endif
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
    'uSpur', 'uCoul', 'uSlab', 'uSella',
    'uPass', 'uTreesP', 'uTreesF', 'uFar', 'uFoot', 'uRock', 'uBakeM', 'uCoverF',
    'uSunDir', 'uSunCol', 'uAmb', 'uZen', 'uMid', 'uHor', 'uGlow', 'uGlowX', 'uHaze',
    'uMoon', 'uMoonK', 'uStars', 'uLamp', 'uDay', 'uMist', 'uText',
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

    // Three programs from the one source: the scene drawn every frame, the
    // sky behind the far rock (a band of rows each frame), and the bakes.
    let progs;
    try {
      const vert = compile(gl, gl.VERTEX_SHADER, VERT);
      progs = [0, 1, 2].map((k) => {
        const prog = gl.createProgram();
        gl.attachShader(prog, vert);
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG.replace('\n', `\n#define PROG ${k}\n`)));
        gl.bindAttribLocation(prog, 0, 'aPos');
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        const loc = {};
        UNIFORMS.forEach((n) => {
          loc[n] = gl.getUniformLocation(prog, n);
        });
        return { prog, loc, seen: {} };
      });
    } catch (err) {
      console.error('Landscape shader failed', err);
      return null;
    }
    const [SCENE, SKY, BAKE] = progs;

    // Uniforms are kept here and handed to a program just before it draws.
    const vals = {};
    let valVer = 0;
    function set(name, fn, ...args) {
      vals[name] = { fn, args, v: ++valVer };
    }
    function use(P) {
      gl.useProgram(P.prog);
      for (const n in vals) {
        const x = vals[n];
        if (P.seen[n] === x.v) continue;
        P.seen[n] = x.v;
        if (P.loc[n]) gl[x.fn](P.loc[n], ...x.args);
      }
    }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, D.NS, D.NL * 2, 0, gl.RGBA, gl.FLOAT, ridgeData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    set('uRidge', 'uniform1i', 0);
    set('uText', 'uniform4fv', new Float32Array(8).fill(-1e4));
    set('uRidgeInfo', 'uniform3f', D.S_MIN, D.S_MAX, D.NS);
    set('uLake', 'uniform4f', D.LAKE.s, D.LAKE.y, D.LAKE.a, D.LAKE.foot);
    set('uHut', 'uniform2f', D.HUT.s, D.HUT.y);
    set('uSpur', 'uniform4fv', D.spurs);
    set('uCoul', 'uniform1fv', D.couloirs);
    set('uSlab', 'uniform2f', D.SLAB[0], D.SLAB[1]);
    set('uSella', 'uniform3f', D.SELLA.s0, D.SELLA.s1, D.SELLA.ledge);

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
    set('uTreesP', 'uniform1i', 1);
    set('uTreesF', 'uniform1i', 2);
    set('uFar', 'uniform1i', 3);
    // Where the meadow trees stand, at half resolution, for their shadows.
    const foot = target(5);
    set('uFoot', 'uniform1i', 5);
    // The rock walls, which only change with the light.
    const rock = target(6);
    set('uRock', 'uniform1i', 6);
    const FAR_BANDS = 4;
    // When the light moves, the trees and rock are shaded again a band of rows
    // a frame rather than all at once, so the page never stalls.
    const RELIGHT_BANDS = 32;
    let relightBand = 0;
    let relightLeft = 0;
    // A coarse map of where trees stand, read back for the animals.
    const cover = { t: gl.createTexture(), fb: gl.createFramebuffer(), w: 0, h: 0, f: 1, m: 0, data: null };
    let geoKey = '';
    let litVer = -1;
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
      set('uPass', 'uniform1i', pass);
      use(pass === 3 ? SKY : BAKE);
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
      set('uBakeM', 'uniform1f', m);
      set('uPar', 'uniform2f', 0, 0);
      let moved = false;
      if (geo !== geoKey) {
        geoKey = geo;
        layers.forEach((b) => size(b, w, h));
        size(rock, w, h);
        size(foot, Math.ceil(w / 2), Math.ceil(h / 2));
        draw(foot, 5, 0, foot.h);
        litVer = -1;
        full = true;
        moved = true;
      }
      if (litVer !== lightVer) {
        litVer = lightVer;
        relightLeft = RELIGHT_BANDS;
      }
      if (relightLeft > 0) {
        let y0 = 0;
        let y1 = h;
        if (full) {
          relightLeft = 0;
        } else {
          relightBand = (relightBand + 1) % RELIGHT_BANDS;
          y0 = Math.floor((h * relightBand) / RELIGHT_BANDS);
          y1 = Math.floor((h * (relightBand + 1)) / RELIGHT_BANDS);
          relightLeft--;
        }
        draw(layers[0], 1, y0, y1);
        draw(layers[1], 2, y0, y1);
        draw(rock, 6, y0, y1);
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
      set('uPass', 'uniform1i', 0);
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
      set('uCoverF', 'uniform1f', f);
      set('uPass', 'uniform1i', 4);
      use(BAKE);
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
        set('uSunDir', 'uniform3fv', L.sunDir);
        set('uSunCol', 'uniform3fv', L.sunCol);
        set('uAmb', 'uniform3fv', L.amb);
        set('uZen', 'uniform3fv', L.zen);
        set('uMid', 'uniform3fv', L.mid);
        set('uHor', 'uniform3fv', L.hor);
        set('uGlow', 'uniform4f', L.glow[0], L.glow[1], L.glow[2], L.glowK);
        set('uGlowX', 'uniform1f', L.glowX);
        set('uHaze', 'uniform3fv', L.haze);
        set('uMoon', 'uniform4f', moon.x, moon.y, moon.r, L.moonPhase);
        set('uMoonK', 'uniform1f', L.moonUp * (moon.visible ? 1 : 0));
        set('uStars', 'uniform1f', L.stars);
        set('uLamp', 'uniform1f', L.lamp);
        set('uDay', 'uniform1f', L.day);
        set('uMist', 'uniform1f', L.mist);
      },
      // Where the text sits (css px rects), so the stars keep clear of it.
      setText(rects) {
        const a = new Float32Array(8).fill(-1e4);
        rects.slice(0, 2).forEach((r, i) => a.set([r.left, r.top, r.right, r.bottom], i * 4));
        set('uText', 'uniform4fv', a);
      },
      // still: redraw everything at once, for a frame that stays up.
      render(t, view, ripples, still) {
        set('uRes', 'uniform2f', canvas.width, canvas.height);
        set('uTime', 'uniform1f', t);
        set('uView', 'uniform3f', view.off, view.scale, view.cam);
        set('uDpr', 'uniform1f', ratio);
        bake(view, still);
        set('uPar', 'uniform2f', view.parX, view.parY);
        set('uRip', 'uniform4fv', ripples);
        use(SCENE);
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
