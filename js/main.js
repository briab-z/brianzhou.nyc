/*
 * Boots the scene: lays out the camera around the text, sets the light from
 * the time in New York, feeds pointer input to the landscape and the
 * animals, and runs the frame loop.
 */
(function () {
  'use strict';

  const D = window.Dolo;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const phone = window.matchMedia('(max-width: 720px)');

  const bgCanvas = document.getElementById('landscape');
  // The scene is as tall as the largest viewport (see styles.css), so on a
  // phone the toolbar sliding in and out as you scroll doesn't resize it.
  const sceneEl = document.querySelector('.scene');
  const fgCanvas = document.getElementById('life');
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  const ridgeData = D.buildTerrain();
  const land = D.createLandscape(bgCanvas, ridgeData);
  // Without the painted ground the animals would float, so leave a quiet page.
  const life = land ? D.createLife(fgCanvas) : null;

  const view = (D.view = { W: 1, H: 1, scale: 1, off: 0, cam: 0, parX: 0, parY: 0, textBottom: 0, textRight: 0 });
  const pointer = { x: -9999, y: -9999, active: false, lastRipple: 0, rx: 0, ry: 0 };
  const moon = { x: 0, y: 0, r: 16, visible: false };
  let light = null;

  // Lake ripples: ring buffer of (s, y, start time, strength).
  const ripples = new Float32Array(32);
  let rippleSlot = 0;
  function addRipple(s, y, t, strength) {
    const k = rippleSlot * 4;
    ripples[k] = s;
    ripples[k + 1] = y;
    ripples[k + 2] = t;
    ripples[k + 3] = strength;
    rippleSlot = (rippleSlot + 1) % 8;
  }

  let renderScale = Math.min(window.devicePixelRatio || 1, 1.5);
  const started = performance.now();
  let clock = 40;

  // The middle of the massif's high crest, kept clear of the text.
  const SUMMIT = 0.15;
  const NEAR_Y = 0.846;
  const LAKE_NEAR = 0.75;

  function textBox() {
    const els = phone.matches ? [document.querySelector('.intro')] : [document.querySelector('.intro'), document.querySelector('.notes')];
    let right = 0;
    let bottom = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    return { right, bottom };
  }

  // Where the text sits now, for the stars to keep clear of. On a phone the
  // notes lie on paper further down, so only the intro and its cue count.
  function placeText() {
    if (!land) return;
    const sel = phone.matches ? ['.intro', '.more-cue'] : ['.intro', '.notes'];
    land.setText(sel.map((q) => document.querySelector(q)).filter(Boolean).map((el) => el.getBoundingClientRect()));
  }

  function rockTop(s) {
    return Math.min(D.topAt(D.L.HERO, s), D.topAt(D.L.MIDFAR, s), D.topAt(D.L.FAR, s));
  }

  // Make the mountains as large as possible while no peak sits behind the
  // text and the lake and meadow stay in view. The massif goes right of the
  // text on wide screens.
  function layout() {
    const W = sceneEl.clientWidth || window.innerWidth;
    const H = sceneEl.clientHeight || window.innerHeight;
    // A hidden or collapsed window has no size yet; wait for the resize.
    if (!W || !H) return;
    view.W = W;
    view.H = H;
    const box = textBox();
    view.textBottom = box.bottom;
    view.textRight = box.right;
    const narrow = phone.matches || W / H < 1.15;
    const clearText = (box.bottom + (narrow ? 24 : 32)) / H;
    const clearTop = Math.max(0.1, 72 / H);
    const textEdge = box.right + 48;

    let best = null;
    for (let scale = 1.5; scale >= 0.55; scale -= 0.02) {
      const summitX = narrow ? W * 0.56 : Math.min(W * 0.7, Math.max(W * 0.56, textEdge + (W - textEdge) * 0.38));
      const cam = SUMMIT - (summitX - W / 2) / (scale * H);
      let off = 0;
      for (let x = -40; x <= W + 40; x += 6) {
        const s = cam + (x - W / 2) / (scale * H);
        const clear = narrow || x < textEdge ? clearText : clearTop;
        off = Math.max(off, clear - (rockTop(s) - 0.006) * scale);
      }
      const maxOff = Math.min(0.94 - NEAR_Y * scale, 0.9 - LAKE_NEAR * scale);
      best = { scale, cam, off };
      if (off <= maxOff) break;
    }
    view.scale = best.scale;
    view.cam = best.cam;
    view.off = best.off;

    if (land) land.resize(W, H, renderScale);
    if (life) life.resize(W, H, Math.min(window.devicePixelRatio || 1, 2));
    placeMoon();
    placeText();
  }

  function toScene(x, y, depth) {
    const sx = (x - view.W / 2) / view.H;
    const s = sx / view.scale + view.cam + view.parX * D.PAR.x * depth;
    const yy = (y / view.H - view.off) / view.scale + view.parY * D.PAR.y * depth;
    return { s, y: yy };
  }
  D.toScene = toScene;
  D.toScreen = function (s, y, depth) {
    const sl = s - view.parX * D.PAR.x * depth;
    const yl = y - view.parY * D.PAR.y * depth;
    return { x: (sl - view.cam) * view.scale * view.H + view.W / 2, y: (yl * view.scale + view.off) * view.H };
  };

  /* Light ------------------------------------------------------------- */

  // The moon travels east (right) to west (left), rising with its altitude,
  // and keeps out of the text.
  function placeMoon() {
    if (!light) return;
    const W = view.W;
    const H = view.H;
    const narrow = phone.matches || W / H < 1.15;
    const lo = narrow ? 48 : Math.min(W - 160, view.textRight + 96);
    const hi = W - 56;
    const fx = Math.min(1, Math.max(0, 0.5 - ((light.moonAz - 180) / 180) * 1.1));
    moon.x = lo + (hi - lo) * fx;
    moon.r = Math.max(11, Math.min(20, H * 0.02));
    const p = toScene(moon.x, 0, 0);
    const horizon = rockTop(p.s) * view.scale * H + view.off * H - moon.r * 2.5;
    const top = narrow ? view.textBottom + moon.r * 3 : Math.max(64, H * 0.09);
    const k = Math.min(1, Math.max(0, light.moonAlt / 55));
    moon.y = horizon + (top - horizon) * Math.sqrt(k);
    moon.visible = horizon - top > moon.r * 2;
  }

  function hex(c) {
    return '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  }

  let lastTheme = '';
  function updateLight() {
    light = D.lightAt(D.sceneDate());
    placeMoon();
    if (land) land.setLight(light, moon);
    if (life) life.setLight(light);
    const sky = light.zen.map((v, i) => (v + light.mid[i]) / 2);
    const lum = 0.299 * sky[0] + 0.587 * sky[1] + 0.114 * sky[2];
    const theme = lum < 0.5 ? 'dark' : 'light';
    if (theme !== lastTheme) {
      lastTheme = theme;
      document.documentElement.dataset.light = theme;
    }
    themeMeta.setAttribute('content', hex(light.zen));
  }

  /* Pointer ----------------------------------------------------------- */

  function overLake(x, y) {
    const p = toScene(x, y, D.DEPTH[D.L.PLATEAU]);
    return D.lakeDist(p.s, p.y) < -0.05 && p.y < D.topAt(D.L.FOREST, p.s) && p.y < D.topAt(D.L.NEAR, p.s);
  }

  function onMove(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    if (reduceMotion.matches) return;
    const moved = Math.hypot(pointer.x - pointer.rx, pointer.y - pointer.ry);
    if (moved > 18 && clock - pointer.lastRipple > 0.12 && overLake(pointer.x, pointer.y)) {
      const p = toScene(pointer.x, pointer.y, D.DEPTH[D.L.PLATEAU]);
      addRipple(p.s, p.y, clock, 0.7);
      pointer.lastRipple = clock;
      pointer.rx = pointer.x;
      pointer.ry = pointer.y;
    }
  }

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', (e) => {
    onMove(e);
    if (reduceMotion.matches) return;
    if (overLake(e.clientX, e.clientY)) {
      const p = toScene(e.clientX, e.clientY, D.DEPTH[D.L.PLATEAU]);
      addRipple(p.s, p.y, clock, 1.6);
    }
    if (life) life.startle(e.clientX, e.clientY);
  }, { passive: true });
  window.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') pointer.active = false;
  }, { passive: true });
  document.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) pointer.active = false;
  });
  window.addEventListener('blur', () => {
    pointer.active = false;
  });

  // The place name opens the photo over the scene; a click anywhere but the
  // credit, or Escape, closes it. Without dialog support the link opens the
  // image itself.
  const place = document.querySelector('.place');
  const photo = document.getElementById('photo');
  if (place && photo && photo.showModal) {
    place.addEventListener('click', (e) => {
      e.preventDefault();
      photo.showModal();
      // Hold focus on the photo, not on the credit link.
      photo.focus();
    });
    photo.addEventListener('click', (e) => {
      if (!e.target.closest('a')) photo.close();
    });
  }

  // Resizing a canvas clears it. Lay out again at the start of the next
  // frame, so the scene is redrawn before that frame is shown; a cleared
  // canvas on screen flashes the page behind it.
  let relayout = false;
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (sceneEl.clientWidth === view.W && sceneEl.clientHeight === view.H) return;
    if (!reduceMotion.matches) {
      relayout = true;
      return;
    }
    cancelAnimationFrame(resizeTimer);
    resizeTimer = requestAnimationFrame(() => {
      layout();
      if (land && light) land.setLight(light, moon);
      drawStill();
    });
  });

  // Frames stall while a phone scrolls the page, whatever the GPU is doing.
  let lastScroll = -Infinity;
  let textMoved = true;
  window.addEventListener('scroll', () => {
    lastScroll = performance.now();
    textMoved = true;
  }, { passive: true });

  // Fish rising now and then.
  let nextFish = 44;
  function ambientRipples(t) {
    if (t < nextFish) return;
    nextFish = t + 5 + Math.random() * 7;
    const L = D.LAKE;
    for (let tries = 0; tries < 10; tries++) {
      const s = L.s + (Math.random() * 2 - 1) * L.a * 0.8;
      const y = L.y + (Math.random() * 2 - 1) * L.near * 0.6;
      if (D.lakeDist(s, y) < -0.3) {
        addRipple(s, y, t, 0.45);
        return;
      }
    }
  }

  // Pick the sharpest resolution the GPU can hold at a steady frame rate:
  // time a few frames once, then keep backing off if it struggles.
  const MAX_SCALE = Math.min(window.devicePixelRatio || 1, 2);
  const BUDGET_MS = 10;
  function calibrate() {
    if (!land) return;
    const ms = land.measure(clock, view, ripples, 4);
    const next = Math.max(0.75, Math.min(MAX_SCALE, renderScale * Math.sqrt(BUDGET_MS / ms)));
    if (Math.abs(next - renderScale) > 0.05) {
      renderScale = next;
      land.resize(view.W, view.H, renderScale);
    }
  }

  let slowFrames = 0;
  function adapt(dt, now) {
    if (now - lastScroll < 500) return;
    if (dt > 0.024) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 40 && renderScale > 0.75) {
      renderScale = Math.max(0.75, renderScale - 0.2);
      slowFrames = 0;
      relayout = true;
    }
  }

  let last = performance.now();
  let firstFrame = true;
  let nextLight = 0;
  function frame(now) {
    // Ask for the next frame first, so one bad frame can't stop the scene.
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Start the clouds mid drift rather than at the origin of their noise.
    clock = 40 + (now - started) / 1000;
    if (clock > nextLight) {
      nextLight = clock + 20;
      updateLight();
    }

    const tx = pointer.active ? (pointer.x / view.W - 0.5) * 2 : 0;
    const ty = pointer.active ? (pointer.y / view.H - 0.5) * 2 : 0;
    const k = 1 - Math.exp(-dt * 2.2);
    view.parX += (tx - view.parX) * k;
    view.parY += (ty - view.parY) * k;

    if (relayout) {
      relayout = false;
      layout();
      if (land && light) land.setLight(light, moon);
    }
    // The text rises into place as the page opens, and scrolls on a phone.
    if (textMoved || clock < 43) {
      textMoved = false;
      placeText();
    }

    ambientRipples(clock);
    if (land) land.render(clock, view, ripples);
    if (life) {
      life.update(dt, clock, pointer);
      life.draw(clock);
    }
    if (firstFrame) {
      firstFrame = false;
      bgCanvas.classList.add('ready');
    } else {
      adapt(dt, now);
    }
  }

  function drawStill() {
    if (land) land.render(40, view, ripples, true);
    if (life) {
      life.still();
      life.draw(0);
    }
    bgCanvas.classList.add('ready');
  }

  if (!land) bgCanvas.style.display = 'none';

  // Pick light or dark text before anything is shown.
  updateLight();

  function start() {
    layout();
    updateLight();
    calibrate();
    requestAnimationFrame(() => document.documentElement.classList.add('settled'));
    if (reduceMotion.matches) {
      drawStill();
      setInterval(() => {
        updateLight();
        drawStill();
      }, 60000);
    } else {
      requestAnimationFrame(frame);
    }
  }

  // Wait for the font so the text block (and the camera) settle once.
  if (document.fonts && document.fonts.ready) {
    Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 600))]).then(start);
  } else {
    start();
  }
})();
