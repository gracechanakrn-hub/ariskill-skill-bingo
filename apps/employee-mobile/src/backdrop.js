// apps/employee-mobile/src/backdrop.js - violet night-forest backdrop: a lightweight Canvas 2D aurora / star /
// firefly layer drawn behind every screen (the gradients, nebula and tree silhouettes are pure CSS in app.css
// `.cosmos`). Sticker art direction: one aurora band (teal -> lime) pre-rendered once and drawn with a bounded
// 0.01 rad/s drift (src/backdrop-params.js), static under reduced motion. Ambient only: slow twinkle (< 0.5 Hz),
// low-amplitude firefly drift, ~30 fps, paused when hidden, and a single static frame under reduced motion
// (OS preference or the in-app switch; watched live). No third-party code.
import { auroraState, AURORA } from './backdrop-params.js';

const STAR_COUNT = 110;
const FIREFLY_COUNT = 14;
const TARGET_FRAME_MS = 1000 / 30;
const MAX_DPR = 1.5;

function rand(seed) { // small deterministic PRNG so the sky looks the same on every open
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function reducedNow() {
  try {
    const attr = document.documentElement.getAttribute('data-reduced-motion');
    if (attr === 'true') return true;
    if (attr === 'false') return false;
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

/**
 * Mounts the layer on `canvas` (already in the DOM). Returns { dispose }.
 * Options (D-37 / D-38 backdrops): `aurora` / `fireflies` switch those layers off; `starCount` sets the twinkling stars.
 */
export function createBackdrop(canvas, { aurora: withAurora = true, fireflies = true, starCount = STAR_COUNT } = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') return { dispose() {} };
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { dispose() {} };
  const r = rand(0x5eed);
  const stars = Array.from({ length: starCount }, () => ({ x: r(), y: r() * 0.82, s: 0.6 + r() * 1.5, p: r() * Math.PI * 2, f: 0.15 + r() * 0.3, warm: r() < 0.12 }));
  const flies = Array.from({ length: fireflies ? FIREFLY_COUNT : 0 }, () => ({ x: r(), y: 0.35 + r() * 0.6, s: 2 + r() * 2.2, p: r() * Math.PI * 2, vx: (r() - 0.5) * 0.012, vy: (r() - 0.5) * 0.008, f: 0.2 + r() * 0.25, hue: r() < 0.7 ? 'gold' : 'cyan' }));
  let w = 0, h = 0, dpr = 1, raf = 0, last = 0, disposed = false, reduced = reducedNow();
  const glow = makeGlowSprite();
  let aurora = null; // { canvas, length, thickness } pre-rendered band, rebuilt on resize

  /** Aurora band: teal -> lime along its length, soft falloff across its thickness (drawn once per size). */
  function makeAuroraBand(length, thickness) {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(length)); c.height = Math.max(2, Math.round(thickness));
    const g = c.getContext('2d');
    const along = g.createLinearGradient(0, 0, c.width, 0);
    along.addColorStop(0, AURORA.teal); along.addColorStop(0.55, '#8CF2A8'); along.addColorStop(1, AURORA.lime);
    g.fillStyle = along; g.fillRect(0, 0, c.width, c.height);
    const across = g.createLinearGradient(0, 0, 0, c.height);
    across.addColorStop(0, 'rgba(0,0,0,0)'); across.addColorStop(0.35, 'rgba(0,0,0,0.85)'); across.addColorStop(0.55, 'rgba(0,0,0,1)'); across.addColorStop(0.8, 'rgba(0,0,0,0.5)'); across.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = across; g.fillRect(0, 0, c.width, c.height);
    const ends = g.createLinearGradient(0, 0, c.width, 0);
    ends.addColorStop(0, 'rgba(0,0,0,0)'); ends.addColorStop(0.18, 'rgba(0,0,0,1)'); ends.addColorStop(0.82, 'rgba(0,0,0,1)'); ends.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = ends; g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function makeGlowSprite() {
    const c = document.createElement('canvas'); c.width = c.height = 48;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 48, 48);
    return c;
  }

  function resize() {
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    w = Math.max(1, Math.round(window.innerWidth)); h = Math.max(1, Math.round(window.innerHeight));
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = auroraState(0, { width: w, height: h, reduced: true });
    aurora = withAurora ? { canvas: makeAuroraBand(a.length, a.thickness), length: a.length, thickness: a.thickness } : null;
    draw(performance.now(), true);
  }

  function draw(now, force = false) {
    if (!force && now - last < TARGET_FRAME_MS) return;
    last = now;
    const t = reduced ? 0 : now / 1000;
    ctx.clearRect(0, 0, w, h);
    // aurora band (behind the stars): bounded drift, one static pose under reduced motion
    if (aurora) {
      const a = auroraState(t, { width: w, height: h, reduced });
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = a.alpha;
      ctx.translate(a.cx + a.slide * Math.cos(a.angle), a.cy + a.slide * Math.sin(a.angle));
      ctx.rotate(a.angle);
      ctx.drawImage(aurora.canvas, -aurora.length / 2, -aurora.thickness / 2, aurora.length, aurora.thickness);
      ctx.restore();
    }
    // stars: gentle twinkle (frequency < 0.5 Hz, amplitude 0.35) - never a flash
    for (const s of stars) {
      const a = reduced ? 0.7 : 0.55 + 0.35 * Math.sin(t * s.f * Math.PI * 2 + s.p);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = s.warm ? '#ffe2b0' : '#e8ecff';
      ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.s, 0, Math.PI * 2); ctx.fill();
    }
    // fireflies: warm motes drifting slowly through the clearing
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flies) {
      const drift = reduced ? 0 : t;
      const x = ((f.x + f.vx * drift + 0.02 * Math.sin(drift * 0.7 + f.p)) % 1 + 1) % 1;
      const y = ((f.y + f.vy * drift + 0.015 * Math.cos(drift * 0.5 + f.p)) % 1 + 1) % 1;
      const pulse = reduced ? 0.75 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * f.f * Math.PI * 2 + f.p));
      const size = f.s * 6 * pulse;
      ctx.globalAlpha = 0.5 * pulse;
      ctx.filter = 'none';
      ctx.save();
      ctx.translate(x * w, y * h);
      ctx.fillStyle = f.hue === 'gold' ? '#ffb347' : '#7be3ff';
      ctx.beginPath(); ctx.arc(0, 0, f.s * 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.28 * pulse;
      ctx.drawImage(glow, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    raf = 0;
    if (disposed || reduced || document.hidden) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  }
  function start() { if (!raf && !disposed && !reduced && !document.hidden) raf = requestAnimationFrame(loop); }
  function onVisibility() { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else start(); }
  function onMotionChange() {
    const next = reducedNow();
    if (next === reduced) return;
    reduced = next;
    if (reduced) { cancelAnimationFrame(raf); raf = 0; draw(performance.now(), true); } else start();
  }

  const mq = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)'); } catch { return null; } })();
  const observer = new MutationObserver(onMotionChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
  if (mq && mq.addEventListener) mq.addEventListener('change', onMotionChange);
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  resize();
  start();

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onMotionChange);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
