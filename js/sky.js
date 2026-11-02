/*
 * Time of day. The light in the valley follows the real sun and moon over
 * New York, so the page is bright at noon there and starlit after dark.
 * Positions use the low precision formulas from SunCalc (Vladimir Agafonkin).
 */
(function () {
  'use strict';

  const D = (window.Dolo = window.Dolo || {});

  const NYC = { lat: 40.7128, lng: -74.006 };
  const RAD = Math.PI / 180;
  const DAY_MS = 864e5;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const OBLIQ = RAD * 23.4397;

  const toDays = (date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  const rightAscension = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBLIQ) - Math.tan(b) * Math.sin(OBLIQ), Math.cos(l));
  const declination = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBLIQ) + Math.cos(b) * Math.sin(OBLIQ) * Math.sin(l));
  // Azimuth is measured from south, turning west.
  const azimuth = (H, phi, dec) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const altitude = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const sidereal = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;

  function sunCoords(d) {
    const M = RAD * (357.5291 + 0.98560028 * d);
    const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const L = M + C + RAD * 102.9372 + Math.PI;
    return { dec: declination(L, 0), ra: rightAscension(L, 0) };
  }

  function moonCoords(d) {
    const L = RAD * (218.316 + 13.176396 * d);
    const M = RAD * (134.963 + 13.064993 * d);
    const F = RAD * (93.272 + 13.22935 * d);
    const l = L + RAD * 6.289 * Math.sin(M);
    const b = RAD * 5.128 * Math.sin(F);
    return { ra: rightAscension(l, b), dec: declination(l, b), dist: 385001 - 20905 * Math.cos(M) };
  }

  function ephemeris(date) {
    const lw = RAD * -NYC.lng;
    const phi = RAD * NYC.lat;
    const d = toDays(date);
    const sc = sunCoords(d);
    const Hs = sidereal(d, lw) - sc.ra;
    const mc = moonCoords(d);
    const Hm = sidereal(d, lw) - mc.ra;
    const sdist = 149598000;
    const ph = Math.acos(Math.sin(sc.dec) * Math.sin(mc.dec) + Math.cos(sc.dec) * Math.cos(mc.dec) * Math.cos(sc.ra - mc.ra));
    const inc = Math.atan2(sdist * Math.sin(ph), mc.dist - sdist * Math.cos(ph));
    const angle = Math.atan2(
      Math.cos(sc.dec) * Math.sin(sc.ra - mc.ra),
      Math.sin(sc.dec) * Math.cos(mc.dec) - Math.cos(sc.dec) * Math.sin(mc.dec) * Math.cos(sc.ra - mc.ra)
    );
    return {
      sunAlt: altitude(Hs, phi, sc.dec) / RAD,
      sunAz: azimuth(Hs, phi, sc.dec) / RAD + 180,
      moonAlt: altitude(Hm, phi, mc.dec) / RAD,
      moonAz: azimuth(Hm, phi, mc.dec) / RAD + 180,
      moonFrac: (1 + Math.cos(inc)) / 2,
      moonPhase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI,
    };
  }

  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

  // Sky and light by solar altitude in degrees. Between rows the values blend.
  // zen/mid/hor: sky from the top down. glow: the bright patch where the sun
  // set or will rise. sun: direct light. amb: light from the open sky.
  // haze: the air between us and the far ridges.
  const KEYS = [
    { alt: -90, zen: '#08091a', mid: '#111328', hor: '#22233f', glow: '#000000', sun: '#000000', amb: '#262b47', haze: '#1c1e37' },
    { alt: -16, zen: '#0a0b1a', mid: '#13152a', hor: '#262541', glow: '#120c16', sun: '#000000', amb: '#282c48', haze: '#201f39' },
    { alt: -10, zen: '#0f1024', mid: '#1c1c38', hor: '#3a2e4a', glow: '#4a2c3e', sun: '#000000', amb: '#2b2d4a', haze: '#2a2840' },
    { alt: -5, zen: '#22264a', mid: '#3e3c66', hor: '#a77a86', glow: '#d98a74', sun: '#000000', amb: '#4a4a72', haze: '#6a5c7a' },
    { alt: -1.5, zen: '#3f4570', mid: '#857796', hor: '#ec9f84', glow: '#f8a77c', sun: '#5a2a3a', amb: '#6e6a8e', haze: '#a98c9a' },
    { alt: 1, zen: '#666f94', mid: '#bb9fa6', hor: '#f6bb94', glow: '#ffc488', sun: '#ff8d5c', amb: '#8a84a2', haze: '#d8b2a6' },
    { alt: 5, zen: '#a9abbd', mid: '#e3cbbd', hor: '#f6cfab', glow: '#ffdcaa', sun: '#ffb37a', amb: '#a29cb0', haze: '#e8ccba' },
    { alt: 12, zen: '#c5c9d2', mid: '#ecdccc', hor: '#f3dac2', glow: '#fbe7cd', sun: '#ffd7a8', amb: '#aeacbb', haze: '#e8d6c6' },
    { alt: 25, zen: '#bec7d1', mid: '#e2dace', hor: '#e9dccb', glow: '#f2e8da', sun: '#fff0dc', amb: '#b2b6c2', haze: '#dbd3c8' },
    { alt: 90, zen: '#b9c4d0', mid: '#e0dcd5', hor: '#e6ded2', glow: '#efe9df', sun: '#fff5e8', amb: '#b6bbc6', haze: '#d9d4cc' },
  ].map((k) => {
    const o = { alt: k.alt };
    for (const n of ['zen', 'mid', 'hor', 'glow', 'sun', 'amb', 'haze']) o[n] = hex(k[n]);
    return o;
  });

  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  function sample(alt) {
    let i = 0;
    while (i < KEYS.length - 2 && alt > KEYS[i + 1].alt) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = Math.min(1, Math.max(0, (alt - a.alt) / (b.alt - a.alt)));
    const o = {};
    for (const n of ['zen', 'mid', 'hor', 'glow', 'sun', 'amb', 'haze']) o[n] = mix3(a[n], b[n], t);
    return o;
  }

  // Compass azimuth (degrees, 0 = north) and altitude to a direction in view
  // space. We look north: east is to the right, south is behind the viewer.
  function dir(az, alt) {
    const A = az * RAD;
    const h = alt * RAD;
    return [Math.sin(A) * Math.cos(h), Math.sin(h), -Math.cos(A) * Math.cos(h)];
  }

  D.lightAt = function (date) {
    const e = ephemeris(date);
    const k = sample(e.sunAlt);

    const moonUp = smooth(-1, 6, e.moonAlt);
    const dark = smooth(-3, -12, e.sunAlt);
    const moonLight = moonUp * (0.2 + 0.8 * e.moonFrac) * dark;

    // Key light: the sun while it reaches the peaks, the moon after dark.
    let sunDir = dir(e.sunAz, Math.max(e.sunAlt, 1.5));
    let sunCol = k.sun;
    if (e.sunAlt < -3) {
      sunDir = dir(e.moonAz, Math.max(e.moonAlt, 4));
      sunCol = mix3([0, 0, 0], [0.42, 0.48, 0.66], moonLight);
    }
    const amb = mix3(k.amb, [0.27, 0.3, 0.44], moonLight * 0.6);

    // Where the glow sits along the horizon: west is to the left.
    const glowX = 0.5 + Math.max(-1.4, Math.min(1.4, -(e.sunAz - 180) / 75)) * 0.62;
    const glowK = smooth(-14, -3, e.sunAlt) * (1 - smooth(4, 24, e.sunAlt)) * smooth(15, 55, Math.abs(e.sunAz - 180));

    return {
      eph: e,
      sunAlt: e.sunAlt,
      zen: k.zen,
      mid: k.mid,
      hor: k.hor,
      glow: k.glow,
      glowX,
      glowK,
      sunDir,
      sunCol,
      amb,
      haze: k.haze,
      stars: smooth(-6, -15, e.sunAlt),
      lamp: smooth(1, -5, e.sunAlt),
      moonUp,
      moonFrac: e.moonFrac,
      moonPhase: e.moonPhase,
      moonAz: e.moonAz,
      moonAlt: e.moonAlt,
      moonLight,
      // 0 at noon, 1 at night: used for the animals and the text.
      // Valley mist: thick around dawn, a trace at noon, some under the moon.
      mist: e.sunAz < 180 ? 0.14 + 0.86 * smooth(24, 4, e.sunAlt) : 0.16 + 0.14 * smooth(14, 2, e.sunAlt) + 0.35 * smooth(0, -10, e.sunAlt),
      night: smooth(2, -8, e.sunAlt),
      day: smooth(-2, 8, e.sunAlt),
    };
  };

  // "?time=6:40" previews another hour today in New York.
  D.sceneDate = function () {
    const q = new URLSearchParams(window.location.search).get('time');
    const now = new Date();
    if (!q) return now;
    const m = /^(\d{1,2}):?(\d{2})?$/.exec(q);
    if (!m) return now;
    const want = (+m[1] % 24) * 60 + (+(m[2] || 0));
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now);
    const h = +parts.find((p) => p.type === 'hour').value;
    const mi = +parts.find((p) => p.type === 'minute').value;
    return new Date(now.valueOf() + (want - (h * 60 + mi)) * 60000);
  };
})();
