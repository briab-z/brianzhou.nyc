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

  // The main massif, after Sassolungo and Sassopiatto seen from the Alpe di
  // Siusi: the great block with its crown of towers and high east shoulder,
  // a deep notch, the Five Fingers climbing to Sassopiatto, and
  // Sassopiatto's slab sloping away to green shoulders. Traced from the
  // photo as (s, elevation above the massif's base), then drawn larger: HX
  // across and HY up, about the block's summit.
  const HX = 1.12;
  const HY = 1.16;
  const hx = (s) => -0.028 + (s + 0.028) * HX;
  const traced = (pts) => pts.map(([s, e]) => [hx(s), e * HY]);
  const HERO_PTS = traced([
    [-0.66, 0.0], [-0.5, 0.008], [-0.36, 0.018], [-0.26, 0.03], [-0.2, 0.04], [-0.16, 0.05],
    [-0.145, 0.062], [-0.136, 0.078], [-0.13, 0.102], [-0.122, 0.126], [-0.11, 0.155],
    [-0.103, 0.177], [-0.096, 0.2], [-0.088, 0.205], [-0.08, 0.228], [-0.074, 0.246],
    [-0.067, 0.256], [-0.061, 0.257], [-0.055, 0.248], [-0.049, 0.265], [-0.043, 0.277],
    [-0.036, 0.281], [-0.028, 0.285], [-0.02, 0.283], [-0.012, 0.279], [-0.004, 0.273],
    [0.001, 0.263], [0.006, 0.252], [0.011, 0.258], [0.016, 0.265], [0.021, 0.257],
    [0.025, 0.237], [0.031, 0.23], [0.043, 0.224], [0.052, 0.218], [0.059, 0.217], [0.065, 0.221],
    [0.071, 0.212], [0.078, 0.206], [0.083, 0.205], [0.087, 0.21], [0.092, 0.2], [0.099, 0.186],
    [0.106, 0.168], [0.114, 0.148], [0.122, 0.13], [0.129, 0.119], [0.134, 0.116],
    [0.141, 0.14], [0.148, 0.165], [0.155, 0.183], [0.163, 0.19], [0.171, 0.194], [0.179, 0.19],
    [0.19, 0.184], [0.198, 0.178], [0.205, 0.172], [0.212, 0.166], [0.217, 0.163], [0.222, 0.175],
    [0.226, 0.194], [0.234, 0.21], [0.242, 0.216], [0.25, 0.22], [0.255, 0.211], [0.261, 0.221],
    [0.269, 0.218], [0.279, 0.212], [0.289, 0.204], [0.297, 0.194], [0.303, 0.186], [0.308, 0.19],
    [0.316, 0.204], [0.324, 0.207], [0.329, 0.209], [0.334, 0.199], [0.34, 0.203], [0.345, 0.209],
    [0.35, 0.226], [0.356, 0.238], [0.36, 0.242], [0.365, 0.24],
    [0.39, 0.219], [0.405, 0.207], [0.43, 0.188], [0.453, 0.173], [0.48, 0.156], [0.5, 0.143],
    [0.531, 0.127], [0.563, 0.11], [0.594, 0.093], [0.615, 0.085],
    // The slab runs out onto a lower range, mostly grass, that carries on to
    // the right; wooded hills in front hide the slab's foot and where the two
    // meet.
    [0.635, 0.083], [0.66, 0.087], [0.69, 0.084], [0.72, 0.091], [0.76, 0.1], [0.79, 0.096],
    [0.82, 0.106], [0.86, 0.1], [0.9, 0.11], [0.93, 0.102], [0.97, 0.106], [1.02, 0.092], [1.08, 0.084],
    [1.15, 0.07], [1.3, 0.04], [1.6, 0.0],
  ]);
  // Sassopiatto's slab: its face is a tilted sheet of rock, not a wall.
  D.SLAB = [hx(0.36), hx(0.62)];

  function heroE(s) {
    let e = polyline(HERO_PTS, s);
    // Broken rock along the high crest, but the slab's edge stays clean.
    const rocky = smooth(0.1 * HY, 0.18 * HY, e) * (1 - 0.8 * smooth(D.SLAB[0], D.SLAB[0] + 0.03, s));
    e += (ridged1(s * 110 + 4) - 0.55) * 0.006 * rocky;
    return e;
  }
  // How far the crest at s sits below the highest point nearby: deep in the
  // notches between towers, nothing on the summits.
  function recess(eFn, s) {
    let m = 0;
    for (let k = -6; k <= 6; k++) m = Math.max(m, eFn(s + k * 0.007) - 0.6 * Math.abs(k) * 0.007);
    return Math.max(0, m - eFn(s));
  }
  // Foot of the walls: low under the great block, high in the couloir below
  // the notch, and along the slab a thinning wedge above the grass. Past the
  // slab it rises nearly to the crest: on the grassy range beyond only bands
  // of rock show under its crest.
  const CLIFF_PTS = traced([
    [-0.3, 0.05], [-0.16, 0.036], [-0.13, 0.026], [-0.1, 0.024], [-0.05, 0.028], [0.0, 0.034],
    [0.04, 0.042], [0.08, 0.055], [0.11, 0.07], [0.134, 0.08], [0.15, 0.06], [0.17, 0.046],
    [0.2, 0.05], [0.24, 0.04], [0.28, 0.045], [0.32, 0.052], [0.36, 0.06], [0.42, 0.066],
    [0.5, 0.056], [0.58, 0.042], [0.61, 0.05], [0.64, 0.076], [0.68, 0.08], [0.72, 0.082],
    [0.76, 0.092], [0.8, 0.091], [0.86, 0.095], [0.92, 0.099], [1.0, 0.096], [1.1, 0.085], [1.6, 0.075],
  ]);
  function heroCliff(s, e) {
    const cb0 = polyline(CLIFF_PTS, s) + 0.012 * (fbm1(s * 14 + 2) - 0.5);
    const cb = cb0 + 0.3 * recess(heroE, s);
    // Wherever there is a wall, a little of it stays.
    return Math.min(cb, Math.max(e - 0.012, cb0));
  }
  function heroScree(s, e, cb) {
    const sb = 0.018 + 0.012 * fbm1(s * 13 + 9) + 0.01 * Math.pow(ridged1(s * 40 + 1), 3);
    return Math.max(sb, cb - 0.045 - 0.4 * recess(heroE, s));
  }

  // Spurs: ridges running down the face from each top, coming toward us as
  // they fall. The shader builds the relief of the walls from them: each
  // spur's two flanks, one in the sun and one in shade, and a couloir where
  // two meet. Per spur: s and y of its top, lean (s per unit of y), and how
  // far forward its top stands. Their slopes must match the shader.
  D.SPUR_N = 32;
  const SPUR_FWD = 0.5;
  const SPUR_SIDE = 1.4;
  function spurZ(p, s, y) {
    const dy = y - p.y;
    return p.z + SPUR_FWD * dy - SPUR_SIDE * Math.abs(s - p.s - p.lean * dy);
  }
  function heroSpurs() {
    const sm = (s) => {
      let a = 0;
      for (let k = -2; k <= 2; k++) a += heroE(s + k * 0.002);
      return a / 5;
    };
    const wall = (s) => heroE(s) - heroCliff(s, heroE(s)) > 0.03;
    // The great block stands forward, the Fingers a little back, and the
    // spurs lean down the broad slope of the crest, away from the high
    // ground. Neighbours lean alike: spurs that leaned toward each other
    // would cross, and the face would break along a level line where one
    // takes over from the other.
    const broad = (s) => {
      let a = 0;
      for (let k = -8; k <= 8; k++) a += polyline(HERO_PTS, s + k * 0.008);
      return a / 17;
    };
    const spur = (s, prom, z) => {
      const slope = (broad(s + 0.01) - broad(s - 0.01)) / 0.02;
      return {
        s,
        y: BASE.HERO - heroE(s),
        lean: Math.max(-0.35, Math.min(0.35, -0.5 * slope)) + (hash1(s * 377.1) - 0.5) * 0.06,
        z: z + 0.015 - 0.035 * smooth(hx(0.11), hx(0.16), s) + 0.015 * smooth(hx(0.3), hx(0.36), s) + (hash1(s * 211.3) - 0.5) * 0.016,
        prom,
      };
    };
    const step = 0.002;
    const S0 = hx(-0.16);
    let list = [];
    for (let s = S0; s < D.SLAB[0]; s += step) {
      if (!wall(s)) continue;
      const e = sm(s);
      let top = true;
      for (let k = 1; k <= 6 && top; k++) if (sm(s - k * step) > e || sm(s + k * step) >= e) top = false;
      if (!top) continue;
      let lo = e;
      for (let k = -15; k <= 15; k++) lo = Math.min(lo, sm(s + k * step));
      list.push(spur(s, e - lo, 0));
    }
    // Long walls without a top of their own still break into buttresses,
    // out to the ends of the walls.
    list.sort((a, b) => a.s - b.s);
    let w0 = S0;
    while (!wall(w0) && w0 < 0) w0 += step;
    const ends = [{ s: w0 - 0.012 }].concat(list, [{ s: D.SLAB[0] }]);
    const extra = [];
    for (let i = 0; i + 1 < ends.length; i++) {
      const gap = ends[i + 1].s - ends[i].s;
      const n = Math.floor(gap / 0.042);
      for (let k = 1; k <= n; k++) {
        const s = ends[i].s + (gap * k) / (n + 1) + (hash1(k * 7.7 + i) - 0.5) * 0.008;
        if (wall(s)) extra.push(spur(s, 0.001, -0.01));
      }
    }
    list = list.concat(extra);
    list.sort((a, b) => b.prom - a.prom);
    // Under Sassopiatto's slab the wall is a row of pillars standing up into
    // the slab's lower edge: just under the summit at first, then lower as
    // the slab grows deeper, until it runs out into the grass. The shader
    // knows them as the spurs past D.SLAB[0].
    const pillars = [];
    const [a, b] = D.SLAB;
    for (let k = 0, s = a + 0.004; s < a + (b - a) * 0.88; k++) {
      const u = (s - a) / (b - a);
      const crest = BASE.HERO - polyline(HERO_PTS, s);
      const wallH = polyline(HERO_PTS, s) - polyline(CLIFF_PTS, s);
      const f = 0.25 + 0.4 * smooth(0, 0.6, u) + (hash1(k * 5.3 + 1) - 0.5) * 0.22;
      pillars.push({ s, y: crest + wallH * f, lean: 0.08 + (hash1(k * 9.1) - 0.5) * 0.1, z: 0.03 + (hash1(k * 3.7) - 0.5) * 0.016, prom: 0 });
      s += 0.02 + 0.014 * hash1(k * 7.3 + 2);
    }
    list = list.slice(0, D.SPUR_N - pillars.length).concat(pillars);
    // Spurs on either side of a notch lean into it; ease them so they meet
    // no higher than the foot of the walls.
    const byS = list.slice().sort((a, b) => a.s - b.s);
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i + 1 < byS.length; i++) {
        const a = byS[i];
        const b = byS[i + 1];
        const foot = BASE.HERO - Math.min(heroCliff(a.s, heroE(a.s)), heroCliff(b.s, heroE(b.s)));
        const close = a.lean * (foot - a.y) - b.lean * (foot - b.y);
        const room = 0.7 * (b.s - a.s);
        if (close > room) {
          const k = room / close;
          a.lean *= k;
          b.lean *= k;
        }
      }
    }
    const out = new Float32Array(D.SPUR_N * 4);
    for (let i = 0; i < D.SPUR_N; i++) {
      const p = list[i];
      if (p) out.set([p.s, p.y, p.lean, p.z], i * 4);
      else out.set([0, 9, 0, -9], i * 4);
    }
    // Couloirs: where, along the foot of the walls, one spur gives way to
    // the next. Scree fans spill from them.
    const coul = new Float32Array(D.SPUR_N).fill(-9);
    let n = 0;
    let last = -1;
    for (let s = S0; s < D.SLAB[1] && n < D.SPUR_N; s += 0.0005) {
      const y = BASE.HERO - heroCliff(s, heroE(s));
      let best = -1;
      let bz = -Infinity;
      list.forEach((p, i) => {
        const z = spurZ(p, s, y);
        if (z > bz) {
          bz = z;
          best = i;
        }
      });
      if (last >= 0 && best !== last && wall(s)) {
        // A spur that wins only for a moment leaves one couloir, not two.
        if (n > 0 && s - coul[n - 1] < 0.012) coul[n - 1] = (coul[n - 1] + s) / 2;
        else coul[n++] = s;
      }
      last = best;
    }
    return { spurs: out, couloirs: coul };
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
        const p = r3 < 0.6 ? 3.2 : 2.0;
        list.push({
          c,
          h: e * (0.62 + 0.38 * r1) * (p < 1.6 ? 0.85 : 1),
          w: 0.022 + 0.034 * r2,
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
  // Behind the grassy range past Sassopiatto they fall away, so that range
  // makes the skyline there.
  const EAST_GAP = (c) => smooth(0.6, 0.7, c) * (1 - smooth(1.02, 1.2, c));
  const EAST = makeTowers(0.4, 1.7, 37, (c) =>
    smooth(0.42, 0.7, c) * (1 - smooth(1.3, 1.7, c)) * (1 - EAST_GAP(c)) * (0.08 + 0.03 * Math.sin(c * 4.0)));

  // On the left, a fortress in the manner of the Sella: a long lower wall,
  // a terrace where scree and snow lie, and an upper wall set back above it
  // under a nearly level rim. To the east it steps down, the upper wall
  // first, and runs out in a long shoulder, leaving a gap before the great
  // block where the far ranges show. The shader paints the terrace at
  // D.SELLA.ledge.
  const SELLA_LOW = 0.078;
  D.SELLA = { s0: -1.42, s1: -0.3, ledge: BASE.MIDFAR - 0.026 - SELLA_LOW };
  const sellaMask = (s) => smooth(-1.44, -1.36, s) * (1 - smooth(-0.38, -0.3, s));
  function sellaE(s) {
    const lower = smooth(-1.42, -1.39, s) * (1 - smooth(-0.5, -0.42, s));
    const upper = smooth(-1.34, -1.31, s) * (1 - smooth(-0.6, -0.565, s));
    const shoulder = 0.045 * smooth(-1.5, -1.42, s) * (1 - smooth(-0.47, -0.3, s));
    // Low humps along the rim, and a couloir notching it here and there.
    const hump = 0.018 * (fbm1(s * 6 + 3) - 0.5) + 0.004 * (fbm1(s * 34 + 7) - 0.5)
               + 0.008 * Math.exp(-Math.pow((s + 0.82) / 0.06, 2));
    let notch = 0;
    for (const [c, w] of [[-1.02, 0.012], [-0.72, 0.01]]) notch += Math.exp(-Math.pow((s - c) / w, 2));
    const top = 0.112 + hump - 0.012 * notch;
    return Math.max(lower * (SELLA_LOW + 0.0015 * (fbm1(s * 40) - 0.5)), upper * top, shoulder);
  }

  function midfarE(s) {
    let e = 0.022 + 0.03 * fbm1(s * 2.3 + 40);
    const right = smooth(0.42, 0.68, s) * (1 - smooth(1.3, 1.65, s));
    e += right * (0.035 + 0.02 * fbm1(s * 5 + 8)) * (1 - 0.6 * EAST_GAP(s));
    const sella = sellaE(s);
    e = Math.max(e, 0.026 + sella, 0.03 + towersAt(EAST, s));
    // Broken, notched tops instead of smooth cones, but the Sella's rim
    // stays level and its shoulder smooth.
    const level = Math.max(smooth(0.03, 0.06, sella), sellaMask(s));
    e += (ridged1(s * 70 + 7) - 0.55) * 0.012 * smooth(0.06, 0.11, e) * (1 - level);
    return e + (ridged1(s * 160 + 2) - 0.55) * 0.004 * (1 - 0.7 * level);
  }
  function midfarCliff(s) {
    return 0.05 + 0.015 * fbm1(s * 6 + 11) - 0.012 * sellaMask(s);
  }
  function midfarScree(s, e, cb) {
    return Math.max(0.016 + 0.01 * fbm1(s * 9 + 3), cb - 0.04);
  }

  function farE(s) {
    return 0.02 + 0.05 * fbm1(s * 2.2 + 80) + 0.045 * Math.pow(ridged1(s * 7 + 3), 2) * (0.4 + fbm1(s * 1.1 + 5));
  }

  // Low wooded hills in front of the far ranges hide their feet: under the
  // Sella, and below Sassopiatto's slab as it runs down to the Alpe. Each is
  // [s, height, half-width]; the forest along the massif's foot follows them.
  const FOOTHILLS = [
    [-1.15, 0.045, 0.1], [-0.9, 0.035, 0.09], [-0.66, 0.045, 0.1], [-0.45, 0.03, 0.08], [-0.65, 0.025, 0.3],
    [0.62, 0.05, 0.05], [0.72, 0.075, 0.07], [0.88, 0.035, 0.07], [1.03, 0.03, 0.1],
  ];
  function plateauTop(s) {
    let hill = 0;
    for (const [c, h, w] of FOOTHILLS) hill = Math.max(hill, h * Math.exp(-Math.pow((s - c) / w, 2)));
    hill *= 0.8 + 0.4 * fbm1(s * 11 + 5);
    return 0.621 - 0.007 * fbm1(s * 4 + 21) - 0.012 * Math.pow(fbm1(s * 1.7 + 3), 2) - hill;
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
  // is long and nearly straight, as a lake looks from slightly above, and
  // the near shore sweeps up to meet it in a point at either end. The shader
  // follows the same outline in lakeDist.
  function lakeShore(s) {
    const L = D.LAKE;
    const x = (s - L.s) / L.a;
    const ax = Math.abs(x);
    if (ax >= 1) return [0, 0];
    const t = 1 - ax * ax;
    const tip = L.y - L.far * 0.5;
    const bay = 0.0045 * (fbm1(s * 9 + 61) - 0.5) + 0.006 * Math.exp(-Math.pow((s - 0.38) / 0.06, 2));
    const far = tip - L.far * 0.5 * Math.pow(t, 0.35) + bay * t;
    const cove = 0.012 * (fbm1(s * 6 + 17) - 0.5) - 0.012 * Math.exp(-Math.pow((s + 0.12) / 0.07, 2));
    const near = tip + (L.near + L.far * 0.5) * Math.pow(t, 0.75) + cove * t;
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
    Object.assign(D, heroSpurs());

    for (let i = 0; i < NS; i++) {
      const s = sAt(i);
      const sh = lakeShore(s);
      // Outside the lake both shores sit where its ends meet, so the shore
      // closes to a point between samples instead of jumping to zero.
      const end = D.LAKE.y - D.LAKE.far * 0.5;
      set(D.L.PLATEAU * 2, i, plateauTop(s), sh[0] || end, sh[1] || end, 0);
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
      return 1 + Math.max(0, ax - 1) * 8 + Math.abs(y - (L.y - L.far * 0.5)) * 20;
    }
    const half = (sh[1] - sh[0]) / 2;
    return (Math.abs(y - (sh[0] + sh[1]) / 2) - half) / half;
  };
  D.lakeShore = lakeShore;

  D.buildTerrain = buildTerrain;
  D.noise1 = noise1;
})();
