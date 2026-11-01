/*
 * Scene geometry for the Dolomites landscape.
 *
 * Every layer is a silhouette described in scene units: s runs horizontally
 * (1 unit = viewport height, 0 = centre), y runs down from the top (0..1).
 * Heights are baked into a float texture the shader reads, and the same data
 * is used by the overlay to place animals on the ground.
 */
(function () {
  'use strict';

  const D = (window.Dolo = window.Dolo || {});

  D.S_MIN = -3;
  D.S_MAX = 3;
  D.NS = 4096;
  D.NL = 6;
  D.L = { FAR: 0, MIDFAR: 1, HERO: 2, PLATEAU: 3, FOREST: 4, NEAR: 5 };
  // Parallax weight per layer, far to near. Must match the shader.
  D.DEPTH = [0.03, 0.07, 0.12, 0.32, 0.55, 0.8];
  D.PAR = { x: 0.02, y: 0.008 };

  // The lake: centre, half width, and how far the far and near shores sit
  // from the centre line. The exact shoreline is baked per column below.
  D.LAKE = { s: 0.13, y: 0.682, a: 0.46, far: 0.024, near: 0.062, foot: 0.614 };
  D.HUT = { s: -0.27, y: 0.6585 };

  const BASE = { FAR: 0.585, MIDFAR: 0.605, HERO: 0.625 };

  // Deterministic 1D noise so the scene is identical on every load.
  function hash1(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return x - Math.floor(x);
  }
  function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return hash1(i) * (1 - u) + hash1(i + 1) * u;
  }
  function fbm1(x, oct) {
    let a = 0.5, s = 0, n = 0;
    for (let k = 0; k < (oct || 5); k++) {
      s += a * noise1(x);
      n += a;
      x = x * 2.07 + 13.1;
      a *= 0.5;
    }
    return s / n;
  }
  function ridged1(x, oct) {
    let a = 0.5, s = 0, n = 0;
    for (let k = 0; k < (oct || 4); k++) {
      s += a * (1 - Math.abs(noise1(x) * 2 - 1));
      n += a;
      x = x * 2.13 + 7.7;
      a *= 0.5;
    }
    return s / n;
  }
  function smooth(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function polyline(pts, s) {
    if (s <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (s <= pts[i][0]) {
        const [s0, e0] = pts[i - 1];
        const [s1, e1] = pts[i];
        return e0 + ((e1 - e0) * (s - s0)) / (s1 - s0);
      }
    }
    return pts[pts.length - 1][1];
  }

  // The main massif, loosely after Sassolungo seen from the Alpe di Siusi:
  // a tall block, a row of fingers, a sharp peak, then a long tilted slab.
  // Points are (s, elevation above the massif's base).
  const HERO_PTS = [
    [-0.66, 0.0], [-0.5, 0.012], [-0.38, 0.03], [-0.29, 0.05], [-0.225, 0.074],
    [-0.172, 0.098], [-0.138, 0.128], [-0.121, 0.172], [-0.108, 0.212], [-0.096, 0.229],
    [-0.082, 0.236], [-0.067, 0.248], [-0.051, 0.253], [-0.037, 0.261], [-0.025, 0.27],
    [-0.013, 0.276], [-0.004, 0.274], [0.006, 0.28], [0.018, 0.269], [0.029, 0.261],
    [0.035, 0.236], [0.042, 0.246], [0.049, 0.226], [0.057, 0.212],
    [0.063, 0.238], [0.068, 0.226], [0.073, 0.25], [0.078, 0.232], [0.083, 0.244],
    [0.089, 0.218], [0.095, 0.236], [0.102, 0.205],
    [0.114, 0.188], [0.125, 0.176],
    [0.137, 0.205], [0.147, 0.236], [0.157, 0.262], [0.163, 0.268], [0.17, 0.258],
    [0.179, 0.238], [0.189, 0.228], [0.197, 0.236], [0.206, 0.214], [0.215, 0.222],
    [0.225, 0.196], [0.237, 0.184], [0.25, 0.168], [0.27, 0.155], [0.29, 0.15],
    [0.305, 0.168], [0.315, 0.196], [0.322, 0.214], [0.33, 0.22],
    [0.36, 0.214], [0.42, 0.196], [0.5, 0.168], [0.58, 0.138], [0.66, 0.108],
    [0.74, 0.08], [0.84, 0.055], [0.96, 0.035], [1.1, 0.02], [1.3, 0.008], [1.6, 0.0],
  ];

  function heroE(s) {
    let e = polyline(HERO_PTS, s);
    // Broken rock along the high crest only.
    const rocky = smooth(0.1, 0.18, e);
    e += (ridged1(s * 150 + 4) - 0.55) * 0.007 * rocky;
    return e;
  }
  function heroCliff(s, e) {
    const cb = 0.062 + 0.02 * fbm1(s * 8 + 2);
    const slab = smooth(0.33, 0.42, s);
    return cb * (1 - slab) + Math.max(cb, e - 0.05) * slab;
  }
  function heroScree(s, e, cb) {
    const sb = 0.022 + 0.012 * fbm1(s * 13 + 9) + 0.01 * Math.pow(ridged1(s * 40 + 1), 3);
    return Math.max(sb, cb - 0.045);
  }

  // Irregular towers: some blocky, some needles, spaced unevenly.
  function makeTowers(from, to, seed, env) {
    const list = [];
    let c = from;
    let k = 0;
    while (c < to) {
      const r1 = hash1(seed + k * 3.1);
      const r2 = hash1(seed + k * 5.7 + 2);
      const r3 = hash1(seed + k * 7.3 + 3);
      const e = env(c);
      if (e > 0.01) {
        const p = r3 < 0.3 ? 2.6 : r3 < 0.75 ? 1.5 : 1.0;
        list.push({
          c,
          h: e * (0.62 + 0.38 * r1) * (p < 1.2 ? 0.85 : 1),
          w: 0.014 + 0.026 * r2,
          p,
        });
      }
      c += 0.026 + 0.06 * hash1(seed + k * 9.9 + 4);
      k++;
    }
    return list;
  }
  function towersAt(list, s) {
    let v = 0;
    for (const t of list) {
      const d = Math.abs(s - t.c) / t.w;
      if (d < 1) v = Math.max(v, t.h * (1 - Math.pow(d, t.p)));
    }
    return v;
  }

  // Odle style group on the left, lower towers behind the slab on the right.
  // Low towers behind the slab on the right.
  const EAST = makeTowers(0.4, 1.7, 37, (c) =>
    smooth(0.42, 0.7, c) * (1 - smooth(1.3, 1.7, c)) * (0.08 + 0.03 * Math.sin(c * 4.0)));

  // On the left, a fortress in the manner of the Sella: two tiers of wall
  // with a terrace between, a nearly flat top and a small dome on it.
  function sellaE(s) {
    const lower = smooth(-1.36, -1.3, s) * (1 - smooth(-0.4, -0.35, s));
    const upper = smooth(-1.27, -1.22, s) * (1 - smooth(-0.5, -0.45, s));
    const top = 0.084 + 0.006 * (fbm1(s * 14 + 3) - 0.5) + 0.016 * Math.exp(-Math.pow((s + 0.78) / 0.07, 2));
    return Math.max(lower * 0.052 * (1 + 0.04 * (fbm1(s * 20) - 0.5)), upper * top);
  }

  function midfarE(s) {
    let e = 0.022 + 0.03 * fbm1(s * 2.3 + 40);
    const right = smooth(0.42, 0.68, s) * (1 - smooth(1.3, 1.65, s));
    e += right * (0.035 + 0.02 * fbm1(s * 5 + 8));
    e = Math.max(e, 0.026 + sellaE(s), 0.03 + towersAt(EAST, s));
    // Broken, notched tops instead of smooth cones.
    e += (ridged1(s * 70 + 7) - 0.55) * 0.012 * smooth(0.06, 0.11, e);
    return e + (ridged1(s * 160 + 2) - 0.55) * 0.004;
  }
  function midfarCliff(s) {
    return 0.05 + 0.015 * fbm1(s * 6 + 11);
  }
  function midfarScree(s, e, cb) {
    return Math.max(0.016 + 0.01 * fbm1(s * 9 + 3), cb - 0.04);
  }

  function farE(s) {
    return 0.02 + 0.05 * fbm1(s * 2.2 + 80) + 0.045 * Math.pow(ridged1(s * 7 + 3), 2) * (0.4 + fbm1(s * 1.1 + 5));
  }

  function plateauTop(s) {
    return 0.621 - 0.007 * fbm1(s * 4 + 21) - 0.012 * Math.pow(fbm1(s * 1.7 + 3), 2);
  }

  function forestTop(s) {
    const l = Math.min(1, Math.max(0, (-0.3 - s) / 0.95));
    const r = Math.min(1, Math.max(0, (s - 0.56) / 0.9));
    let y = 0.92;
    if (l > 0) y = Math.min(y, 0.865 - 0.2 * Math.pow(l, 0.75));
    if (r > 0) y = Math.min(y, 0.875 - 0.16 * Math.pow(r, 0.8));
    return y + 0.01 * (fbm1(s * 9 + 33) - 0.5);
  }

  function nearTop(s) {
    return 0.846 + 0.012 * Math.sin(s * 3.1 + 0.6) + 0.012 * (fbm1(s * 6 + 70) - 0.5) - 0.022 * smooth(0.3, 1.3, s);
  }

  // Far and near shore of the lake at s, or [0, 0] outside it. The far shore
  // is long and nearly straight, as a lake looks from slightly above.
  function lakeShore(s) {
    const L = D.LAKE;
    const x = (s - L.s) / L.a;
    const ax = Math.abs(x);
    if (ax >= 1) return [0, 0];
    const core = Math.pow(1 - Math.pow(ax, 2.6), 1 / 2.6);
    const bay = 0.0045 * (fbm1(s * 9 + 61) - 0.5) + 0.006 * Math.exp(-Math.pow((s - 0.38) / 0.06, 2));
    const far = L.y - L.far * Math.pow(core, 0.45) + bay * core;
    const cove = 0.012 * (fbm1(s * 6 + 17) - 0.5) - 0.012 * Math.exp(-Math.pow((s + 0.12) / 0.07, 2));
    const near = L.y + L.near * Math.pow(core, 0.85) + cove * core;
    return near - far > 0.002 ? [far, near] : [0, 0];
  }

  function buildTerrain() {
    const NS = D.NS;
    const rows = D.NL * 2;
    const data = new Float32Array(NS * rows * 4);
    const ds = (D.S_MAX - D.S_MIN) / (NS - 1);
    const sAt = (i) => D.S_MIN + i * ds;
    const set = (row, i, a, b, c, d) => {
      const k = (row * NS + i) * 4;
      data[k] = a;
      data[k + 1] = b;
      data[k + 2] = c;
      data[k + 3] = d;
    };

    for (let i = 0; i < NS; i++) set(0, i, BASE.FAR - farE(sAt(i)), 0, 0, 0);

    function rockLayer(layer, eFn, base, cliffFn, screeFn) {
      const e = new Float32Array(NS);
      for (let i = 0; i < NS; i++) e[i] = eFn(sAt(i));

      // Lightly smoothed crest, for which way each flank faces.
      const sm = new Float32Array(NS);
      const w = 3;
      for (let i = 0; i < NS; i++) {
        let acc = 0, n = 0;
        for (let k = -w; k <= w; k++) {
          const j = Math.min(NS - 1, Math.max(0, i + k));
          acc += e[j];
          n++;
        }
        sm[i] = acc / n;
      }
      // The crest smoothed at three widths: the face below each tower follows
      // the fine crest near the top and the broad massif further down.
      const blur = (src, half) => {
        const out = new Float32Array(NS);
        const n = Math.max(1, Math.round(half / ds));
        let acc = 0;
        for (let k = -n; k <= n; k++) acc += src[Math.min(NS - 1, Math.max(0, k))];
        for (let i = 0; i < NS; i++) {
          out[i] = acc / (2 * n + 1);
          acc += src[Math.min(NS - 1, i + n + 1)] - src[Math.max(0, i - n)];
        }
        return out;
      };
      const e1 = blur(blur(e, 0.002), 0.002);
      const e2 = blur(blur(e, 0.007), 0.007);
      const e3 = blur(blur(e, 0.022), 0.022);
      // How far each column stands proud of its neighbours.
      const pw = Math.round(0.04 / ds);
      for (let i = 0; i < NS; i++) {
        let mn = Infinity;
        for (let k = -pw; k <= pw; k++) {
          const j = Math.min(NS - 1, Math.max(0, i + k));
          if (e[j] < mn) mn = e[j];
        }
        const a = sm[Math.max(0, i - 1)];
        const b = sm[Math.min(NS - 1, i + 1)];
        const slope = (b - a) / (2 * ds);
        const flank = Math.sign(slope) * smooth(0.6, 3.0, Math.abs(slope));
        const s = sAt(i);
        const cb = cliffFn(s, e[i]);
        const sb = screeFn(s, e[i], cb);
        set(layer * 2, i, base - e[i], base - cb, base - sb, flank);
        set(layer * 2 + 1, i, e[i] - mn, e1[i], e2[i], e3[i]);
      }
    }

    rockLayer(D.L.MIDFAR, midfarE, BASE.MIDFAR, midfarCliff, midfarScree);
    rockLayer(D.L.HERO, heroE, BASE.HERO, heroCliff, heroScree);

    for (let i = 0; i < NS; i++) {
      const s = sAt(i);
      const sh = lakeShore(s);
      // Outside the lake both shores sit on its centre line, so the shore
      // closes to a point between samples instead of jumping to zero.
      set(D.L.PLATEAU * 2, i, plateauTop(s), sh[0] || D.LAKE.y, sh[1] || D.LAKE.y, 0);
      set(D.L.FOREST * 2, i, forestTop(s), 0, 0, 0);
      set(D.L.NEAR * 2, i, nearTop(s), 0, 0, 0);
    }

    D.ridgeData = data;
    return data;
  }

  // Top edge (y) of a layer at scene position s.
  D.topAt = function (layer, s) {
    const NS = D.NS;
    let u = ((s - D.S_MIN) / (D.S_MAX - D.S_MIN)) * (NS - 1);
    u = Math.max(0, Math.min(NS - 1.001, u));
    const i = Math.floor(u);
    const f = u - i;
    const k = (layer * 2 * NS + i) * 4;
    return D.ridgeData[k] * (1 - f) + D.ridgeData[k + 4] * f;
  };

  // Negative inside the lake, positive outside, in half heights of the lake.
  D.lakeDist = function (s, y) {
    const L = D.LAKE;
    const sh = lakeShore(s);
    if (sh[1] <= sh[0]) {
      const ax = Math.abs((s - L.s) / L.a);
      return 1 + Math.max(0, ax - 1) * 8 + Math.abs(y - L.y) * 20;
    }
    const half = (sh[1] - sh[0]) / 2;
    return (Math.abs(y - (sh[0] + sh[1]) / 2) - half) / half;
  };
  D.lakeShore = lakeShore;

  D.buildTerrain = buildTerrain;
  D.noise1 = noise1;
})();
