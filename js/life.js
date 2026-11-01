/*
 * Everything that moves on top of the painted landscape: a flock of alpine
 * choughs and a golden eagle in the sky, marmots at their burrows, a few
 * flocks of sheep on the plateau, smoke from the hut, butterflies and grass in the foreground.
 * Each of them reacts to the pointer.
 */
(function () {
  'use strict';

  const D = (window.Dolo = window.Dolo || {});
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;

  const BIRD_INK = 'rgba(43, 36, 32, 0.92)';
  const BAT_INK = 'rgba(12, 11, 20, 0.95)';
  const EAGLE = { body: 'rgba(46, 33, 25, 0.96)', flight: 'rgba(74, 62, 54, 0.94)', head: 'rgba(104, 76, 46, 0.96)' };
  const MARMOT = { fur: '#8c6a4b', shade: 'rgba(58, 38, 24, 0.32)', belly: '#c29e78', face: '#5e4635', muzzle: '#dcc29c', dark: '#2a211b', paw: '#6b4f38' };
  const SOIL = { back: '#8b7a52', hole: '#33281d', lip: '#6f5f40', lit: '#a8966a' };
  const SHEEP = { wool: '#ece5d6', under: '#b9ae9c', face: '#f3eee4', dark: '#2f2a26' };
  const GRASS = ['#b0b26a', '#98a35c', '#82924f', '#6c8046', '#566d3c', '#435a32', '#364b2a'];
  const FLOWERS = ['#f5eddf', '#e3a0a6', '#a88cc4', '#eac75e', '#f2d7c9'];

  // The colours above are as they look by day. Under other light they are
  // scaled by how much light falls on open ground, as the shader does.
  const rgbOf = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  function groundLight(L) {
    const N = [0, 0.8, 0.6];
    const d = Math.max(0, N[0] * L.sunDir[0] + N[1] * L.sunDir[1] + N[2] * L.sunDir[2]);
    return [0, 1, 2].map((i) => L.sunCol[i] * d * 0.78 + L.amb[i] * 0.756);
  }
  const DAY_LIGHT = 1.12;

  D.createLife = function (canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0;
    let H = 0;
    let ratio = 1;
    let unit = 1;
    let built = false;

    const birds = [];
    const marmots = [];
    const sheep = [];
    const smoke = [];
    const puffs = [];
    const flies = [];
    let grass = [];
    let eagle = null;
    let smokeClock = 0;
    const meteors = [];
    let nextMeteor = 0;

    let light = null;
    let nightMode = false;
    const pal = { grass: GRASS, flowers: FLOWERS, sheep: { ...SHEEP, shadow: 'rgba(40, 46, 24, 0.22)' }, marmot: MARMOT, soil: SOIL, smoke: [242, 232, 220], dust: [150, 130, 95], fly: null };
    function tint(hex, m, a) {
      const c = rgbOf(hex);
      const r = Math.round(Math.min(255, c[0] * m[0]));
      const g = Math.round(Math.min(255, c[1] * m[1]));
      const b = Math.round(Math.min(255, c[2] * m[2]));
      return a === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    const scaleK = () => clamp(H / 900, 0.75, 1.35);

    // Vertical band the flock keeps to: below the text, around the summits.
    function skyBand() {
      const v = D.view;
      const top = Math.max(v.textBottom + 28, H * 0.1);
      const peaks = (v.off + 0.34 * v.scale) * H;
      const bottom = Math.max(top + 90, peaks + H * 0.12);
      return [top, bottom];
    }

    /* Birds ------------------------------------------------------------- */

    function spawnBirds() {
      birds.length = 0;
      // Choughs roost after dusk; a few bats come out instead.
      const n = nightMode ? (W < 720 ? 4 : 7) : W < 720 ? 11 : 18;
      const [top, bottom] = skyBand();
      const cx = W * 0.52;
      const cy = lerp(top, bottom, 0.5);
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU);
        const r = rand(0, 80);
        birds.push({
          x: cx + Math.cos(a) * r * 1.8,
          y: cy + Math.sin(a) * r * 0.5,
          vx: rand(30, 50),
          vy: rand(-8, 8),
          phase: rand(0, TAU),
          rate: rand(3.2, 4.3),
          flap: 1,
          gliding: Math.random() < 0.4,
          glideT: rand(0.5, 2.5),
          size: rand(0.82, 1.15),
          seed: rand(0, 100),
          alarm: 0,
          bat: nightMode,
        });
      }
      eagle = { ang: rand(0, TAU), ox: 0, oy: 0, alarm: 0, phase: 0, flapT: rand(4, 9), flapping: 0, x: 0, y: 0, vx: 0, prevX: 0 };
    }

    function updateBirds(dt, t, p) {
      const [top, bottom] = skyBand();
      const R = clamp(H * 0.13, 90, 150);
      const vmax = clamp(H * 0.095, 65, 105);
      const vmin = vmax * 0.45;
      const hx = W * (0.5 + 0.33 * Math.sin(t * 0.043) + 0.08 * Math.sin(t * 0.17 + 1));
      const hy = lerp(top, bottom, 0.5 + 0.28 * Math.sin(t * 0.081));

      for (const b of birds) {
        let ax = 0, ay = 0, n = 0, cx = 0, cy = 0, avx = 0, avy = 0;
        for (const o of birds) {
          if (o === b) continue;
          const dx = o.x - b.x;
          const dy = o.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 8100) {
            n++;
            cx += o.x;
            cy += o.y;
            avx += o.vx;
            avy += o.vy;
            if (d2 < 484 && d2 > 1e-4) {
              const d = Math.sqrt(d2);
              const k = ((22 - d) * 7) / d;
              ax -= dx * k;
              ay -= dy * k;
            }
          }
        }
        if (n) {
          ax += (cx / n - b.x) * 0.5 + (avx / n - b.vx) * 0.8;
          ay += (cy / n - b.y) * 0.5 + (avy / n - b.vy) * 0.8;
        }
        ax += (hx - b.x) * 0.04;
        ay += (hy - b.y) * 0.1;
        // Bats flit: quick, jagged turns and little cohesion.
        const jitter = b.bat ? 5 : 1;
        const wa = D.noise1(t * 0.35 * jitter + b.seed) * TAU * 2;
        ax += Math.cos(wa) * 20 * jitter;
        ay += Math.sin(wa) * 14 * jitter;
        if (b.y < top) ay += (top - b.y) * 3;
        if (b.y > bottom) ay -= (b.y - bottom) * 3;

        // Flow around the pointer instead of bouncing off it.
        if (p.active) {
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < R && d > 0.5) {
            const k = 1 - d / R;
            const push = k * k * 3400;
            const side = Math.sign(-b.vx * dy + b.vy * dx) || 1;
            ax += (dx / d) * push + (-dy / d) * push * 0.75 * side;
            ay += (dy / d) * push + (dx / d) * push * 0.75 * side;
            b.alarm = Math.max(b.alarm, k);
          }
        }
        b.alarm = Math.max(0, b.alarm - dt * 0.7);

        b.vx += ax * dt;
        b.vy += ay * dt;
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const max = vmax * (1 + b.alarm * 1.3);
        if (sp > max) {
          b.vx *= max / sp;
          b.vy *= max / sp;
        } else if (sp < vmin) {
          b.vx *= vmin / sp;
          b.vy *= vmin / sp;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        b.glideT -= dt;
        if (b.glideT <= 0) {
          b.gliding = !b.gliding && b.alarm < 0.2;
          b.glideT = b.gliding ? rand(1.0, 2.8) : rand(0.8, 2.2);
        }
        const target = b.gliding && b.alarm < 0.2 ? 0.1 : 1;
        b.flap += (target - b.flap) * Math.min(1, dt * 4);
        b.phase += dt * TAU * b.rate * (1 + b.alarm * 0.9);
      }

      updateEagle(dt, t, p, top, bottom);
    }

    function updateEagle(dt, t, p, top, bottom) {
      const e = eagle;
      const r = clamp(W * 0.07, 50, 120);
      const cx = W * (0.83 + 0.04 * Math.sin(t * 0.031)) + e.ox;
      const cy = lerp(top, bottom, 0.2) + e.oy;
      e.ang += dt * (0.2 + e.alarm * 0.5);
      const nx = cx + Math.cos(e.ang) * r;
      const ny = cy + Math.sin(e.ang) * r * 0.32;

      if (p.active) {
        const dx = nx - p.x;
        const dy = ny - p.y;
        const d = Math.hypot(dx, dy);
        const R = clamp(H * 0.17, 110, 190);
        if (d < R && d > 0.5) {
          const k = 1 - d / R;
          e.ox += (dx / d) * k * 260 * dt;
          e.oy += (dy / d) * k * 160 * dt;
          e.alarm = Math.max(e.alarm, k);
          e.flapping = Math.max(e.flapping, 1.2);
        }
      }
      e.ox *= 1 - Math.min(1, dt * 0.25);
      e.oy *= 1 - Math.min(1, dt * 0.25);
      e.alarm = Math.max(0, e.alarm - dt * 0.4);

      e.flapT -= dt;
      if (e.flapT <= 0) {
        e.flapping = 1.4;
        e.flapT = rand(6, 12);
      }
      e.flapping = Math.max(0, e.flapping - dt);
      e.phase += dt * TAU * 1.6;
      e.vx = dt > 0 ? (nx - e.x) / dt : 0;
      e.x = nx;
      e.y = ny;
      e.depth = Math.sin(e.ang);
    }

    function drawBat(b, k) {
      const s = 4.6 * b.size * k;
      const f = Math.sin(b.phase * 1.8);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.2);
      ctx.quadraticCurveTo(-s * 0.5, -s * 0.5 - f * s * 0.6, -s, -f * s * 0.7);
      ctx.lineTo(-s * 0.7, s * 0.05);
      ctx.lineTo(-s * 0.45, -s * 0.05);
      ctx.lineTo(-s * 0.2, s * 0.2);
      ctx.lineTo(0, s * 0.3);
      ctx.lineTo(s * 0.2, s * 0.2);
      ctx.lineTo(s * 0.45, -s * 0.05);
      ctx.lineTo(s * 0.7, s * 0.05);
      ctx.lineTo(s, -f * s * 0.7);
      ctx.quadraticCurveTo(s * 0.5, -s * 0.5 - f * s * 0.6, 0, -s * 0.2);
      ctx.fill();
      ctx.restore();
    }

    function drawChough(b, k) {
      const s = 6.2 * b.size * k;
      const f = Math.sin(b.phase) * b.flap;
      const tip = -f * s * 0.72 - (1 - b.flap) * s * 0.16;
      const elbow = -f * s * 0.24 - s * 0.08;
      const tilt = clamp(b.vy / 170, -0.35, 0.35) * (b.vx >= 0 ? 1 : -1);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(tilt);
      ctx.beginPath();
      ctx.moveTo(-s, tip);
      ctx.quadraticCurveTo(-s * 0.5, elbow - s * 0.12, 0, s * 0.04);
      ctx.quadraticCurveTo(s * 0.5, elbow - s * 0.12, s, tip);
      ctx.quadraticCurveTo(s * 0.5, elbow + s * 0.1, 0, s * 0.28);
      ctx.quadraticCurveTo(-s * 0.5, elbow + s * 0.1, -s, tip);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // A golden eagle soaring, seen from below: broad wings held in a shallow
    // V, long fingered primaries, a fanned tail and the head jutting ahead.
    function drawEagle(k) {
      const e = eagle;
      const persp = 1 + e.depth * 0.08;
      const s = 17 * k * persp;
      const f = e.flapping > 0 ? Math.sin(e.phase) * Math.min(1, e.flapping) : 0;
      const bank = clamp(-Math.cos(e.ang) * 0.22, -0.25, 0.25);
      // Dihedral: how far the wing rises per unit out from the body.
      const lift = 0.12 + f * 0.5;
      const fold = 1 - 0.25 * Math.max(0, -f);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(bank);
      for (const side of [-1, 1]) {
        // The wing turned toward us in a bank looks a little longer.
        const span = s * (1 + side * bank * 0.5);
        const P = (x, y) => [side * x * span, (y - lift * x) * s];
        ctx.fillStyle = EAGLE.flight;
        ctx.beginPath();
        ctx.moveTo(...P(0.05, -0.06));
        ctx.quadraticCurveTo(...P(0.3, -0.12), ...P(0.58, -0.08));
        ctx.lineTo(...P(0.72, 0.1));
        // Secondaries bulge behind, pinched in where they meet the body.
        ctx.quadraticCurveTo(...P(0.42, 0.3), ...P(0.07, 0.17));
        ctx.closePath();
        ctx.fill();
        // Six primaries spread like fingers, tips curling up.
        for (let i = 0; i < 6; i++) {
          const t = i / 5;
          const [bx, by] = [lerp(0.57, 0.71, t), lerp(-0.07, 0.08, t)];
          const ang = lerp(-0.2, 0.42, t);
          const len = (0.36 - 0.12 * t) * fold;
          const w = 0.03;
          const tx = bx + Math.cos(ang) * len;
          const ty = by + Math.sin(ang) * len - len * 0.12;
          ctx.beginPath();
          ctx.moveTo(...P(bx - Math.sin(ang) * w, by - w));
          ctx.quadraticCurveTo(...P(lerp(bx, tx, 0.6), lerp(by, ty, 0.6) - w * 0.9), ...P(tx, ty));
          ctx.quadraticCurveTo(...P(lerp(bx, tx, 0.6), lerp(by, ty, 0.6) + w * 0.9), ...P(bx + Math.sin(ang) * w, by + w));
          ctx.closePath();
          ctx.fill();
        }
        // The darker coverts along the leading edge.
        ctx.fillStyle = EAGLE.body;
        ctx.beginPath();
        ctx.moveTo(...P(0.04, -0.07));
        ctx.quadraticCurveTo(...P(0.3, -0.13), ...P(0.6, -0.08));
        ctx.quadraticCurveTo(...P(0.36, 0.02), ...P(0.06, 0.07));
        ctx.closePath();
        ctx.fill();
      }
      // Tail, fanned and rounded.
      ctx.fillStyle = EAGLE.flight;
      ctx.beginPath();
      ctx.moveTo(-0.055 * s, 0.14 * s);
      ctx.lineTo(-0.12 * s, 0.4 * s);
      ctx.quadraticCurveTo(0, 0.47 * s, 0.12 * s, 0.4 * s);
      ctx.lineTo(0.055 * s, 0.14 * s);
      ctx.closePath();
      ctx.fill();
      // Body and head.
      ctx.fillStyle = EAGLE.body;
      ctx.beginPath();
      ctx.ellipse(0, 0.03 * s, 0.075 * s, 0.17 * s, 0, 0, TAU);
      ctx.moveTo(0.05 * s, -0.15 * s);
      ctx.ellipse(0, -0.15 * s, 0.05 * s, 0.07 * s, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = EAGLE.head;
      ctx.beginPath();
      ctx.ellipse(0, -0.17 * s, 0.035 * s, 0.045 * s, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    /* Marmots ----------------------------------------------------------- */

    function placeMarmots() {
      const fr = W < 720 ? [0.22, 0.8] : [0.17, 0.63, 0.88];
      const dy = [0.024, 0.032, 0.02];
      while (marmots.length < fr.length) {
        marmots.push({ state: 'hidden', t: rand(1.5, 5), rise: 0, target: 0, pose: 0, poseT: rand(2, 5), look: 0, lookTo: 0, lookT: 1, s: 0, y: 0 });
      }
      marmots.length = fr.length;
      marmots.forEach((m, i) => {
        const p = D.toScene(fr[i] * W, 0, 0);
        m.s = p.s;
        m.y = D.topAt(D.L.NEAR, p.s) + dy[i];
      });
    }

    function updateMarmots(dt, p) {
      const R = clamp(unit * 0.15, 100, 170);
      const depth = D.DEPTH[D.L.NEAR];
      for (const m of marmots) {
        const pos = D.toScreen(m.s, m.y, depth);
        const k = unit * 0.032;
        const d = p.active ? Math.hypot(p.x - pos.x, p.y - (pos.y - k * 0.6)) : Infinity;

        if (d < R && m.rise > 0.05 && m.state !== 'dive') {
          m.state = 'dive';
          m.target = 0;
          puff(pos.x, pos.y, k);
        }

        m.t -= dt;
        switch (m.state) {
          case 'hidden':
            if (m.t <= 0 && d > R * 1.4 && !nightMode) {
              m.state = 'peek';
              m.target = 0.42;
              m.t = rand(1.2, 2.2);
            }
            break;
          case 'peek':
            if (m.t <= 0) {
              m.state = 'up';
              m.target = 0.8;
              m.t = rand(5, 11);
            }
            break;
          case 'up':
            if (d < R * 2.1) {
              // Sentinel: stand tall and watch the pointer.
              m.pose = Math.min(1, m.pose + dt * 3);
              m.lookTo = clamp((p.x - pos.x) / 60, -1, 1);
              m.target = 1;
            } else {
              m.target = lerp(0.8, 1, m.pose);
              m.poseT -= dt;
              if (m.poseT <= 0) {
                m.pose = m.pose > 0.5 ? 0 : 1;
                m.poseT = rand(2, 5);
              }
            }
            if (m.t <= 0 || nightMode) {
              m.state = 'leave';
              m.target = 0;
            }
            break;
          case 'leave':
          case 'dive':
            if (m.rise < 0.02) {
              m.t = m.state === 'dive' ? rand(2.5, 5) : rand(3, 9);
              m.state = 'hidden';
            }
            break;
        }

        m.lookT -= dt;
        if (m.lookT <= 0 && !(m.state === 'up' && d < R * 2.1)) {
          m.lookTo = rand(-1, 1);
          m.lookT = rand(0.8, 2.6);
        }
        m.look += (m.lookTo - m.look) * Math.min(1, dt * 6);
        const speed = m.state === 'dive' ? 7 : m.target > m.rise ? 1.4 : 2.2;
        m.rise += clamp(m.target - m.rise, -speed * dt, speed * dt);
        if (m.state !== 'up') m.pose = Math.max(0, m.pose - dt * 2);
      }
    }

    function puff(x, y, k) {
      for (let i = 0; i < 6; i++) {
        puffs.push({ x: x + rand(-k * 0.3, k * 0.3), y: y - rand(0, k * 0.1), vx: rand(-14, 14), vy: rand(-12, -4), r: rand(1.5, 3) * (k / 28), age: 0, life: rand(0.6, 1.1) });
      }
    }

    function drawMarmot(m) {
      const depth = D.DEPTH[D.L.NEAR];
      const pos = D.toScreen(m.s, m.y, depth);
      const k = unit * 0.032;
      const x = pos.x;
      const y = pos.y;

      const SOIL = pal.soil;
      const MARMOT = pal.marmot;
      // Spoil heap behind the hole.
      ctx.fillStyle = SOIL.back;
      ctx.beginPath();
      ctx.ellipse(x, y - k * 0.03, k * 0.62, k * 0.13, 0, Math.PI, TAU);
      ctx.fill();
      ctx.fillStyle = SOIL.hole;
      ctx.beginPath();
      ctx.ellipse(x, y, k * 0.36, k * 0.085, 0, 0, TAU);
      ctx.fill();

      if (m.rise > 0.01) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - k, y - k * 2, k * 2, k * 2 + k * 0.02);
        ctx.clip();
        ctx.translate(x, y + (1 - m.rise) * k * 1.08);

        const up = m.pose;
        const bh = k * (0.64 + 0.16 * up);
        const bw = k * (0.3 - 0.05 * up);
        const sw = k * 0.16;
        const look = m.look;

        ctx.beginPath();
        ctx.moveTo(-bw, 0);
        ctx.bezierCurveTo(-bw * 1.08, -bh * 0.45, -sw * 1.15, -bh * 0.82, 0, -bh);
        ctx.bezierCurveTo(sw * 1.15, -bh * 0.82, bw * 1.08, -bh * 0.45, bw, 0);
        ctx.closePath();
        ctx.fillStyle = MARMOT.fur;
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = MARMOT.belly;
        ctx.beginPath();
        ctx.ellipse(look * k * 0.03, -bh * 0.4, bw * 0.5, bh * 0.34, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = MARMOT.shade;
        ctx.fillRect(bw * 0.25, -bh * 1.1, bw, bh * 1.2);
        ctx.restore();

        if (up > 0.4) {
          ctx.globalAlpha = Math.min(1, (up - 0.4) * 2.5);
          ctx.fillStyle = MARMOT.paw;
          ctx.beginPath();
          ctx.ellipse(-k * 0.06 + look * k * 0.02, -bh * 0.62, k * 0.04, k * 0.055, 0, 0, TAU);
          ctx.ellipse(k * 0.06 + look * k * 0.02, -bh * 0.62, k * 0.04, k * 0.055, 0, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        const hx = look * k * 0.05;
        const hy = -bh - k * 0.09;
        ctx.fillStyle = MARMOT.fur;
        ctx.beginPath();
        ctx.arc(hx - k * 0.11, hy - k * 0.1, k * 0.042, 0, TAU);
        ctx.arc(hx + k * 0.11, hy - k * 0.1, k * 0.042, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(hx, hy, k * 0.165, k * 0.14, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = MARMOT.face;
        ctx.beginPath();
        ctx.ellipse(hx + look * k * 0.03, hy - k * 0.03, k * 0.11, k * 0.07, 0, Math.PI, TAU);
        ctx.fill();
        ctx.fillStyle = MARMOT.muzzle;
        ctx.beginPath();
        ctx.ellipse(hx + look * k * 0.06, hy + k * 0.045, k * 0.075, k * 0.055, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = MARMOT.dark;
        ctx.beginPath();
        ctx.arc(hx + look * k * 0.09, hy + k * 0.02, k * 0.02, 0, TAU);
        ctx.arc(hx - k * 0.06 + look * k * 0.05, hy - k * 0.025, k * 0.017, 0, TAU);
        ctx.arc(hx + k * 0.06 + look * k * 0.05, hy - k * 0.025, k * 0.017, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // Front lip of the burrow.
      ctx.fillStyle = SOIL.lip;
      ctx.beginPath();
      ctx.ellipse(x, y + k * 0.01, k * 0.46, k * 0.075, 0, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = SOIL.lit;
      ctx.lineWidth = Math.max(1, k * 0.03);
      ctx.beginPath();
      ctx.ellipse(x, y + k * 0.01, k * 0.46, k * 0.075, 0, Math.PI * 0.08, Math.PI * 0.55);
      ctx.stroke();
    }

    /* Sheep ------------------------------------------------------------ */

    // Villnöss sheep: white wool, black ears, a dark ring round each eye.
    // They keep to small flocks on the open plateau and out of the trees.
    const SHEEP_DEPTH = () => D.DEPTH[D.L.PLATEAU];
    const sheepK = (y) => unit * 0.0092 * lerp(0.6, 1.3, clamp((y - 0.62) / 0.22, 0, 1));
    let coverSeen = -1;

    // True when no tree stands over the spot a sheep at (s, y) would cover,
    // with a few px to spare for the pointer's parallax.
    function clearOfTrees(s, y) {
      if (!D.treeCover) return true;
      const v = D.view;
      const x = (s - v.cam) * v.scale * v.H + v.W / 2;
      const py = (y * v.scale + v.off) * v.H;
      const k = sheepK(y);
      const m = 5;
      for (let yy = py - 1.2 * k - m; yy <= py + 2; yy += 3) {
        for (let xx = x - k - m; xx <= x + k + m; xx += 3) {
          if (D.treeCover(xx, yy) > 0.1) return false;
        }
      }
      return true;
    }

    function sheepOk(s, y) {
      if (y < D.topAt(D.L.PLATEAU, s) + 0.03) return false;
      if (y > D.topAt(D.L.FOREST, s) - 0.016 || y > D.topAt(D.L.NEAR, s) - 0.016) return false;
      if (D.lakeDist(s, y) < 0.45) return false;
      if (Math.abs(s - D.HUT.s) < 0.07 && Math.abs(y - D.HUT.y) < 0.035) return false;
      const p = D.toScreen(s, y, SHEEP_DEPTH());
      if (p.x < 24 || p.x > W - 24) return false;
      return clearOfTrees(s, y);
    }

    function newSheep(s, y, home) {
      return { s, y, home, dir: Math.random() < 0.5 ? -1 : 1, state: 'graze', t: rand(2, 8), leg: 0, head: 0, lie: nightMode ? 1 : 0 };
    }

    // A flock gathers round a clear spot; each sheep finds its own patch.
    function placeFlock(n) {
      for (let i = 0; i < 300; i++) {
        const p = D.toScene(rand(0.06, 0.94) * W, 0, SHEEP_DEPTH());
        const y = rand(0.64, 0.82);
        // Flocks graze well apart.
        if (sheep.some((o) => Math.abs(o.home.s - p.s) * unit < W * 0.18)) continue;
        if (!sheepOk(p.s, y)) continue;
        const home = { s: p.s, y };
        const flock = [newSheep(p.s, y, home)];
        for (let j = 0; j < 60 && flock.length < n; j++) {
          const ns = p.s + rand(-0.035, 0.035);
          const ny = y + rand(-0.008, 0.01);
          const k = sheepK(ny);
          if (flock.some((o) => Math.abs(o.s - ns) * unit < 1.6 * k && Math.abs(o.y - ny) * unit < 0.9 * k)) continue;
          if (sheepOk(ns, ny)) flock.push(newSheep(ns, ny, home));
        }
        if (flock.length >= Math.min(2, n)) return flock;
      }
      return [];
    }

    function spawnSheep() {
      sheep.length = 0;
      const flocks = W < 720 ? [3] : [4, 3];
      for (const n of flocks) sheep.push(...placeFlock(n));
      sheep.sort((a, b) => a.y - b.y);
    }

    function updateSheep(dt) {
      // The trees moved (a new size or view): flocks standing in them move on.
      if (D.coverVer !== coverSeen) {
        coverSeen = D.coverVer;
        if (sheep.some((o) => !sheepOk(o.s, o.y))) spawnSheep();
      }
      for (const o of sheep) {
        o.lie += ((nightMode ? 1 : 0) - o.lie) * Math.min(1, dt * 0.8);
        if (nightMode) {
          o.head += (0.5 - o.head) * Math.min(1, dt * 2);
          continue;
        }
        o.t -= dt;
        if (o.state === 'graze') {
          o.head += (0 - o.head) * Math.min(1, dt * 2);
          if (o.t <= 0) {
            o.state = Math.random() < 0.55 ? 'walk' : 'look';
            o.t = o.state === 'walk' ? rand(1.5, 3.5) : rand(1.5, 3);
            // Turn back toward the flock if straying.
            if (Math.random() < 0.3 || (o.s - o.home.s) * o.dir > 0.03) o.dir *= -1;
          }
        } else {
          o.head += (1 - o.head) * Math.min(1, dt * 3);
          if (o.state === 'walk') {
            const ns = o.s + o.dir * 0.004 * dt;
            if (Math.abs(ns - o.home.s) < 0.05 && sheepOk(ns, o.y)) {
              o.s = ns;
              o.leg += dt * 9;
            } else {
              o.dir *= -1;
              o.state = 'graze';
              o.t = rand(2, 5);
            }
          }
          if (o.t <= 0) {
            o.state = 'graze';
            o.t = rand(4, 10);
          }
        }
      }
    }

    // The fleece: a row of curls over a rounded body.
    function fleece(k) {
      ctx.beginPath();
      ctx.ellipse(0, -0.68 * k, 0.62 * k, 0.32 * k, 0, 0, TAU);
      for (const [cx, cy, r] of [[-0.5, -0.76, 0.26], [-0.22, -0.9, 0.27], [0.1, -0.92, 0.27], [0.38, -0.84, 0.26], [0.56, -0.7, 0.2]]) {
        ctx.moveTo((cx + r) * k, cy * k);
        ctx.arc(cx * k, cy * k, r * k, 0, TAU);
      }
    }

    function drawSheep(o) {
      const p = D.toScreen(o.s, o.y, SHEEP_DEPTH());
      const k = sheepK(o.y);
      const walking = o.state === 'walk' && !nightMode;
      const swing = walking ? Math.sin(o.leg) * k * 0.1 : 0;
      const bob = walking ? Math.abs(Math.cos(o.leg)) * k * 0.04 : 0;
      const C = pal.sheep;
      ctx.save();
      ctx.translate(p.x, p.y);
      // A soft shadow on the grass.
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(0.05 * k, 0, 0.7 * k, 0.11 * k, 0, 0, TAU);
      ctx.fill();
      // Lying down, the body settles on the grass and the legs fold away.
      ctx.translate(0, o.lie * 0.34 * k - bob);
      ctx.scale(o.dir, 1);
      if (o.lie < 0.9) {
        ctx.strokeStyle = C.dark;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(0.7, k * 0.085);
        ctx.beginPath();
        for (const [lx, sw] of [[-0.4, 1], [-0.27, -1], [0.27, 1], [0.4, -1]]) {
          ctx.moveTo(lx * k, -0.46 * k);
          ctx.lineTo(lx * k + swing * sw, -0.34 * k * o.lie + bob);
        }
        ctx.stroke();
      }
      // Wool, darker underneath where the light doesn't reach.
      ctx.fillStyle = C.wool;
      fleece(k);
      ctx.fill();
      ctx.save();
      fleece(k);
      ctx.clip();
      ctx.fillStyle = C.under;
      ctx.beginPath();
      ctx.ellipse(0, -0.32 * k, 0.9 * k, 0.26 * k, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      // Head: down in the grass, or raised and looking about.
      const hx = lerp(0.74, 0.8, o.head) * k;
      const hy = lerp(-0.32, -1.02, o.head) * k;
      const tilt = lerp(1.2, 0.35, o.head);
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(tilt);
      ctx.fillStyle = C.face;
      ctx.beginPath();
      ctx.ellipse(0.06 * k, 0, 0.26 * k, 0.15 * k, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = C.dark;
      // The spectacles, a dark nose, and an ear hanging back.
      ctx.beginPath();
      ctx.ellipse(0.02 * k, -0.04 * k, 0.07 * k, 0.055 * k, 0, 0, TAU);
      ctx.ellipse(0.27 * k, 0.01 * k, 0.05 * k, 0.07 * k, 0, 0, TAU);
      ctx.ellipse(-0.14 * k, 0.05 * k, 0.15 * k, 0.05 * k, 0.5, 0, TAU);
      ctx.fill();
      ctx.restore();
      // A tuft of wool on the crown, over where the head meets the fleece.
      ctx.fillStyle = C.wool;
      ctx.beginPath();
      ctx.arc(hx - 0.14 * k, hy - 0.08 * k + (1 - o.head) * 0.1 * k, 0.11 * k, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    /* Smoke from the hut ---------------------------------------------- */

    function updateSmoke(dt) {
      smokeClock += dt;
      if (smokeClock > 0.5) {
        smokeClock = 0;
        smoke.push({ age: 0, life: rand(6, 9), drift: rand(0.7, 1.3), seed: rand(0, 100) });
      }
      for (let i = smoke.length - 1; i >= 0; i--) {
        smoke[i].age += dt;
        if (smoke[i].age > smoke[i].life) smoke.splice(i, 1);
      }
    }

    function drawSmoke() {
      const p = D.toScreen(D.HUT.s + 0.0074, D.HUT.y - 0.0251, D.DEPTH[D.L.PLATEAU]);
      const k = unit / 900;
      for (const q of smoke) {
        const a = q.age;
        const x = p.x + (a * 3.2 * q.drift + Math.sin(a * 0.9 + q.seed) * 2.2 * Math.sqrt(a)) * k;
        const y = p.y - a * 6.5 * k;
        const r = (1.1 + a * 1.25) * k;
        const alpha = 0.32 * (1 - a / q.life) * Math.min(1, a * 2);
        ctx.fillStyle = `rgba(${pal.smoke[0]}, ${pal.smoke[1]}, ${pal.smoke[2]}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    }

    /* Butterflies ------------------------------------------------------ */

    function spawnFlies() {
      flies.length = 0;
      const n = W < 720 ? 1 : 3;
      const colors = ['#f2cf6b', '#e9965a', '#f4ecd8'];
      for (let i = 0; i < n; i++) {
        flies.push({ x: rand(0.1, 0.9) * W, y: rand(0.84, 0.94) * H, vx: 0, vy: 0, ang: rand(0, TAU), phase: rand(0, TAU), color: colors[i % colors.length], scare: 0 });
      }
    }

    function updateFlies(dt, t, p) {
      const topY = (D.view.off + 0.8 * D.view.scale) * H;
      for (const f of flies) {
        f.ang += (D.noise1(t * 0.8 + f.phase * 10) - 0.5) * dt * 7;
        let tx = Math.cos(f.ang) * 26;
        let ty = Math.sin(f.ang) * 14;
        if (f.y < topY) ty += 40;
        if (f.y > H - 30) ty -= 40;
        if (f.x < 30) tx += 40;
        if (f.x > W - 30) tx -= 40;
        if (p.active) {
          const dx = f.x - p.x;
          const dy = f.y - p.y;
          const d = Math.hypot(dx, dy);
          if (d < 110 && d > 0.5) {
            const k = 1 - d / 110;
            tx += (dx / d) * 260 * k;
            ty += (dy / d) * 200 * k;
            f.scare = Math.max(f.scare, k);
          }
        }
        f.scare = Math.max(0, f.scare - dt);
        f.vx += (tx - f.vx) * Math.min(1, dt * 3);
        f.vy += (ty - f.vy) * Math.min(1, dt * 3);
        f.phase += dt * (14 + f.scare * 10);
        f.x += f.vx * dt;
        f.y += (f.vy + Math.sin(f.phase * 0.5) * 18) * dt;
      }
    }

    function drawFly(f, k) {
      const w = Math.abs(Math.sin(f.phase)) * 4.2 * k + 0.6;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(clamp(f.vx / 120, -0.4, 0.4));
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.ellipse(-w * 0.55, -1.4 * k, w * 0.6, 2.6 * k, -0.3, 0, TAU);
      ctx.ellipse(w * 0.55, -1.4 * k, w * 0.6, 2.6 * k, 0.3, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    /* Foreground grass ------------------------------------------------- */

    function buildGrass() {
      grass = [];
      const n = Math.round(W / 2.4);
      for (let i = 0; i < n; i++) {
        const row = Math.random();
        const tall = Math.random() < 0.06;
        grass.push({
          x: rand(-20, W + 20),
          row,
          h: H * rand(0.025, 0.065) * (0.6 + 0.6 * row) * (tall ? 1.45 : 1),
          w: rand(1.3, 2.4) * (0.75 + 0.5 * row),
          lean: rand(-0.22, 0.22),
          bend: 0,
          tone: Math.min(GRASS.length - 1, Math.floor(row * GRASS.length)),
          bloom: tall || Math.random() < 0.03 ? Math.floor(Math.random() * FLOWERS.length) : -1,
        });
      }
      grass.sort((a, b) => a.row - b.row);
    }

    function drawGrass(dt, t, p) {
      const R = clamp(H * 0.12, 80, 130);
      const shift = -D.view.parX * D.PAR.x * unit;
      let current = null;
      for (const g of grass) {
        const base = H + 3 - (1 - g.row) * H * 0.035;
        const x = g.x + shift * (0.6 + 0.4 * g.row);
        const wind = 0.13 * Math.sin(t * 0.9 + x * 0.008) + 0.06 * Math.sin(t * 2.1 + x * 0.031) + 0.05 * Math.sin(t * 0.37);
        let target = 0;
        if (p.active) {
          const mx = x + Math.sin(g.lean) * g.h * 0.5;
          const my = base - g.h * 0.6;
          const dx = mx - p.x;
          const dy = my - p.y;
          const d = Math.hypot(dx, dy);
          if (d < R) target = Math.sign(dx || 1) * Math.pow(1 - d / R, 1.5) * 1.1;
        }
        g.bend += (target - g.bend) * Math.min(1, dt * 7);
        const ang = g.lean + wind * (0.6 + 0.4 * g.row) + g.bend;
        const tx = x + Math.sin(ang) * g.h;
        const ty = base - Math.cos(ang) * g.h;
        const cx = x + Math.sin(ang * 0.5) * g.h * 0.5;
        const cy = base - g.h * 0.55;
        const color = pal.grass[g.tone];
        if (color !== current) {
          current = color;
          ctx.fillStyle = current;
        }
        ctx.beginPath();
        ctx.moveTo(x - g.w, base);
        ctx.quadraticCurveTo(cx - g.w * 0.35, cy, tx, ty);
        ctx.quadraticCurveTo(cx + g.w * 0.35, cy, x + g.w, base);
        ctx.fill();
        if (g.bloom >= 0) {
          ctx.fillStyle = pal.flowers[g.bloom];
          ctx.beginPath();
          ctx.arc(tx, ty, 1.6 + g.row * 1.4, 0, TAU);
          ctx.fill();
          ctx.fillStyle = current;
        }
      }
    }

    /* Lifecycle -------------------------------------------------------- */

    function resize(w, h, r) {
      const sx = W ? w / W : 1;
      const sy = H ? h / H : 1;
      W = w;
      H = h;
      ratio = r;
      canvas.width = Math.round(w * r);
      canvas.height = Math.round(h * r);
      unit = D.view.scale * H;
      if (!built) {
        built = true;
        spawnBirds();
        spawnSheep();
        spawnFlies();
      } else {
        for (const b of birds) {
          b.x *= sx;
          b.y *= sy;
        }
        for (const f of flies) {
          f.x *= sx;
          f.y *= sy;
        }
        if (sheep.some((o) => !sheepOk(o.s, o.y))) spawnSheep();
      }
      placeMarmots();
      buildGrass();
    }

    let lastDt = 0;
    function update(dt, t, p) {
      lastDt = dt;
      if (dt <= 0) return;
      updateBirds(dt, t, p);
      updateMarmots(dt, p);
      updateSheep(dt);
      updateSmoke(dt);
      updateFlies(dt, t, p);
      updateMeteors(dt, t);
      for (let i = puffs.length - 1; i >= 0; i--) {
        const q = puffs[i];
        q.age += dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        if (q.age > q.life) puffs.splice(i, 1);
      }
      pointerRef = p;
    }

    /* Shooting stars ---------------------------------------------------- */

    function launchMeteor(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const ang = rand(0.35, 0.65) * (Math.random() < 0.5 ? 1 : -1) + (Math.random() < 0.5 ? 0 : Math.PI);
      const sp = rand(520, 760);
      meteors.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.abs(Math.sin(ang)) * sp * 0.6 + 60, age: 0, life: rand(0.55, 0.9) });
    }

    function updateMeteors(dt, t) {
      const stars = light ? light.stars : 0;
      if (stars > 0.6 && t > nextMeteor) {
        nextMeteor = t + rand(14, 30);
        if (nextMeteor - t < 40) {
          const [top, bottom] = skyBand();
          launchMeteor(rand(0.2, 0.9) * W, rand(Math.max(20, top - 140), bottom - 60));
        }
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.age += dt;
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        if (m.age > m.life) meteors.splice(i, 1);
      }
    }

    function drawMeteors() {
      ctx.lineCap = 'round';
      for (const m of meteors) {
        const k = m.age / m.life;
        const a = Math.sin(Math.PI * Math.min(1, k * 1.2)) * 0.9;
        const tail = 0.12;
        const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail);
        g.addColorStop(0, `rgba(255, 250, 240, ${a.toFixed(3)})`);
        g.addColorStop(1, 'rgba(255, 250, 240, 0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - m.vx * tail, m.y - m.vy * tail);
        ctx.stroke();
      }
    }

    let pointerRef = { active: false, x: -9999, y: -9999 };
    function draw(t) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const k = scaleK();

      drawMeteors();
      drawSmoke();
      for (const o of sheep) drawSheep(o);
      for (const m of marmots) drawMarmot(m);
      for (const q of puffs) {
        ctx.fillStyle = `rgba(${pal.dust[0]}, ${pal.dust[1]}, ${pal.dust[2]}, ${(0.45 * (1 - q.age / q.life)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r * (1 + q.age * 2), 0, TAU);
        ctx.fill();
      }
      drawGrass(lastDt, t, pointerRef);
      const day = light ? light.day : 1;
      if (day > 0.5) for (const f of flies) drawFly(f, k);

      if (day > 0.3) drawEagle(k);
      ctx.fillStyle = nightMode ? BAT_INK : BIRD_INK;
      for (const b of birds) (b.bat ? drawBat : drawChough)(b, k);
    }

    // A still frame for reduced motion: animals out and visible.
    function still() {
      for (const m of marmots) {
        m.state = 'up';
        m.rise = 0.85;
        m.target = 0.85;
        m.t = 9999;
      }
      smoke.length = 0;
      for (let i = 0; i < 12; i++) {
        smoke.push({ age: i * 0.6, life: 99, drift: 1, seed: i });
      }
      updateEagle(0, 0, { active: false }, ...skyBand());
    }

    function startle(x, y) {
      if (light && light.stars > 0.6) {
        const [, bottom] = skyBand();
        if (y < bottom) launchMeteor(x, y);
      }
      for (const b of birds) {
        const dx = b.x - x;
        const dy = b.y - y;
        const d = Math.hypot(dx, dy);
        if (d < 260 && d > 0.5) {
          b.alarm = 1;
          b.vx += (dx / d) * 160;
          b.vy += (dy / d) * 160;
        }
      }
      const R = clamp(unit * 0.22, 140, 240);
      for (const m of marmots) {
        const pos = D.toScreen(m.s, m.y, D.DEPTH[D.L.NEAR]);
        if (Math.hypot(pos.x - x, pos.y - y) < R && m.rise > 0.05 && m.state !== 'dive') {
          m.state = 'dive';
          m.target = 0;
          puff(pos.x, pos.y, unit * 0.032);
        }
      }
      for (const o of sheep) {
        o.state = 'look';
        o.t = rand(2, 3.5);
      }
    }

    function setLight(L) {
      light = L;
      const g = groundLight(L).map((v) => v / DAY_LIGHT);
      pal.grass = GRASS.map((h) => tint(h, g));
      pal.flowers = FLOWERS.map((h) => tint(h, g));
      const sh = {};
      for (const key in SHEEP) sh[key] = tint(SHEEP[key], g);
      sh.shadow = `rgba(40, 46, 24, ${(0.22 * Math.min(1, L.day + 0.3)).toFixed(3)})`;
      pal.sheep = sh;
      pal.soil = { back: tint(SOIL.back, g), hole: tint(SOIL.hole, g), lip: tint(SOIL.lip, g), lit: tint(SOIL.lit, g) };
      const m = {};
      for (const key in MARMOT) m[key] = MARMOT[key].startsWith('#') ? tint(MARMOT[key], g) : MARMOT[key];
      pal.marmot = m;
      pal.smoke = rgbOf('#f2e8dc').map((v, i) => Math.round(Math.min(255, v * Math.max(0.35, g[i]))));
      pal.dust = rgbOf('#96825f').map((v, i) => Math.round(v * g[i]));
      const wantNight = L.night > 0.6;
      if (wantNight !== nightMode) {
        nightMode = wantNight;
        if (built) spawnBirds();
      }
    }

    return { resize, update, draw, still, startle, setLight };
  };
})();
