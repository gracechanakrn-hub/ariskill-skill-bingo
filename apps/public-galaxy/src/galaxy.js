// Galaxy orchestrator: renderer selection (three -> webgl2 -> canvas2d -> static, D-22), scene + entrance
// queue, animation loop, performance auto-downgrade, resize, context-loss hand-over. The Three.js module is
// imported lazily so a failed vendor import degrades to the raw WebGL2 / Canvas 2D renderers. The panel is
// independent of this module: if the Galaxy throws, the container keeps its flat --color-bg background.
import { createScene, DEFAULT_SCENE_CONFIG, DEFAULT_RINGS } from './renderer/scene.js';
import { createAtlas, loadImage } from './renderer/atlas.js';
import { createWebgl2Renderer } from './renderer/webgl2.js';
import { createCanvas2dRenderer } from './renderer/canvas2d.js';
import { createStaticRenderer } from './renderer/static.js';
import { createEntranceQueue } from './entrance-queue.js';
import { pumpBudget } from './renderer/impostor-plan.js';
import { track } from '../../../packages/ui/telemetry.js';

const FRAME_BUDGET_MS = 25;      // auto-downgrade when the 2 s average exceeds this
const DOWNGRADE_WINDOW_MS = 2000;
const MIN_SAMPLES = 8;
const WARMUP_MS = 3000;          // ignore samples right after start / renderer switch
const MAX_SAMPLE_MS = 100;       // a single hitch counts at most this much
const QUALITY_ORDER = ['high', 'medium', 'low'];
export const RENDERER_KINDS = Object.freeze(['three', 'webgl2', 'canvas2d', 'static']);
export const DEFAULT_ORDER = Object.freeze(['three', 'webgl2', 'canvas2d', 'static']);
export const SCENE_SEED = 'arise-galaxy-2026';

/** `?mode=` normalisation: `webgl2` is accepted as the legacy alias of the primary GL path (`three`). */
export function normaliseMode(mode) {
  if (mode === 'three' || mode === 'webgl2') return 'three';
  if (mode === 'canvas2d' || mode === 'static') return mode;
  return null;
}

/** Renderer order to try (pure). scene-config#fallback still lists `webgl2` first: it is mapped onto the Three tier. */
export function rendererOrder({ mode = null, reducedMotion = false, fallback = null } = {}) {
  const m = normaliseMode(mode);
  if (m === 'static') return ['static'];
  if (m === 'canvas2d') return ['canvas2d', 'static'];
  if (m === 'three') return [...DEFAULT_ORDER];
  if (reducedMotion) return ['static'];
  const configured = Array.isArray(fallback) && fallback.length ? fallback : DEFAULT_ORDER;
  const out = [];
  for (const k of configured) {
    const kind = k === 'webgl2' ? 'three' : k;
    if (RENDERER_KINDS.includes(kind) && !out.includes(kind)) out.push(kind);
    if (k === 'webgl2' && !out.includes('webgl2')) out.push('webgl2');
  }
  if (!out.includes('static')) out.push('static');
  return out;
}

/** Entrance timings: tokens/motion.json#interactions.galaxyEntrance wins over scene-config#entrance. */
export function entranceTimings(config = DEFAULT_SCENE_CONFIG, motion = null) {
  const g = motion && motion.interactions && motion.interactions.galaxyEntrance;
  const e = (config && config.entrance) || DEFAULT_SCENE_CONFIG.entrance;
  const pick = (a, b) => (Number.isFinite(a) && a > 0 ? a : b);
  return { arcMs: pick(g && g.arcMs, e.arcDurationMs), pulseMs: pick(g && g.pulseMs, e.pulseDurationMs), settleMs: pick(g && g.settleMs, e.settleDurationMs) };
}

/** Loads scene-config.json and the files it links (star layers, orbit rings, nebula) plus the motion tokens. */
export async function loadSceneAssets(base = '/assets/scene', tokensBase = '/tokens') {
  let config = DEFAULT_SCENE_CONFIG;
  try { config = await (await fetch(`${base}/scene-config.json`)).json(); } catch { /* defaults */ }
  const layerFiles = (config.starfield || []).map(l => l.file.replace(/^assets\/scene/, base));
  const starLayers = [];
  for (const f of layerFiles) { try { starLayers.push(await (await fetch(f)).json()); } catch { /* skip layer */ } }
  let rings = DEFAULT_RINGS;
  try { rings = await (await fetch(`${base}/orbit-rings.json`)).json(); } catch { /* defaults */ }
  let nebula = null;
  try { nebula = await loadImage(`${base}/nebula.svg`); } catch { nebula = null; }
  let motion = null;
  try { motion = await (await fetch(`${tokensBase}/motion.json`)).json(); } catch { motion = null; }
  return { config, starLayers, rings, nebula, motion };
}

let threeModule = null;
async function loadThree() {
  if (threeModule) return threeModule;
  threeModule = await import('./renderer/three.js');
  return threeModule;
}

export function createGalaxy({ container, assets, mode = null, quality = 'high', reducedMotion = false, onModeChange = null, onQualityChange = null, monoNow = () => performance.now() }) {
  const { config, starLayers, rings, nebula, motion = null } = assets;
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const timings = entranceTimings(config, motion);
  const queue = createEntranceQueue({
    maxConcurrent: config.entrance.maxConcurrent, maxQueued: 12,
    arcMs: timings.arcMs, pulseMs: timings.pulseMs, settleMs: timings.settleMs,
    reducedMotion,
  });
  const scene = createScene({ config, rings, starLayers, quality: QUALITY_ORDER.includes(quality) ? quality : 'high', reducedMotion, queue });
  const atlas = createAtlas({ maxDetail: 'simple' }); // art direction v2: the Galaxy atlas is the 'simple' sticker
  let renderer = null;
  let raf = 0, running = false, startedAt = 0, lastFrameAt = 0;
  const frameTimes = [];
  let lastDowngradeAt = -Infinity;
  let threeFactory = null;
  const isStatic = () => renderer && renderer.kind === 'static';
  const stats = { avgMs: 0, maxMs: 0, frames: 0, mode: null, quality: scene.quality, timings };

  function order() { return rendererOrder({ mode, reducedMotion, fallback: config.fallback && config.fallback.order }); }

  function make(kind) {
    const common = { container, atlas, nebula, background: config.background, dpr, starLayers };
    if (kind === 'three') {
      if (!threeFactory) throw new Error('three module not loaded');
      return threeFactory({ ...common, quality: scene.quality, reducedMotion, seed: SCENE_SEED, pulseMs: timings.pulseMs, onLost: () => switchTo('canvas2d', 'context-lost') });
    }
    if (kind === 'webgl2') return createWebgl2Renderer({ ...common, onLost: () => switchTo('canvas2d', 'context-lost') });
    if (kind === 'canvas2d') return createCanvas2dRenderer(common);
    return createStaticRenderer(common);
  }

  function select(from = order()) {
    for (const kind of from) {
      try {
        renderer = make(kind);
        stats.mode = kind;
        track('client.renderer_mode', { mode: kind, quality: scene.quality });
        if (onModeChange) onModeChange(kind);
        return renderer;
      } catch (err) {
        track('client.renderer_mode', { mode: kind, failed: true, error: String(err && err.message) });
        renderer = null;
        atlas.setImpostors(null); // decorated Souls fall back to the 2D composition on the next tier
      }
    }
    return null;
  }

  function switchTo(kind, reason) {
    const prev = renderer;
    if (prev) { try { prev.dispose(); } catch { /* ignore */ } }
    renderer = null;
    track('client.renderer_mode', { mode: kind, reason });
    const rest = order();
    const from = rest.slice(Math.max(0, rest.indexOf(kind)));
    const next = select(from.length ? from : [kind, 'static']);
    if (next) { fit(); if (next.kind === 'static') renderOnce(); }
  }

  function fit() {
    if (!renderer) return;
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.resize(w, h);
    scene.resize(w, h);
  }

  function renderOnce() {
    if (!renderer) return;
    try {
      const f = scene.frame(0, monoNow());
      renderer.render(f);
      // the atlas fills asynchronously: redraw once the sprites landed
      atlas.preload(f.souls.concat(f.entrances), 'simple', scene.spritePx() * dpr).then(() => { if (isStatic() && renderer) renderer.render(scene.frame(0, monoNow())); });
    } catch (err) { console.error('[galaxy] static render failed', err); }
  }

  function loop(now) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const dt = lastFrameAt ? now - lastFrameAt : 16.7;
    lastFrameAt = now;
    scene.tick(dt);
    queue.update(now);
    const t0 = performance.now();
    try {
      renderer.render(scene.frame((now - startedAt) / 1000, now));
    } catch (err) {
      console.error('[galaxy] render failed, falling back', err);
      const idx = order().indexOf(renderer ? renderer.kind : 'static');
      switchTo(order()[Math.min(order().length - 1, idx + 1)] || 'static', 'render-error');
      if (isStatic()) { running = false; cancelAnimationFrame(raf); }
      return;
    }
    const cost = performance.now() - t0;
    sample(now, cost);
    // background work the frame itself does not wait for (decorated Souls' 3D impostors), in what is left of the budget
    if (renderer && typeof renderer.afterFrame === 'function') {
      try { renderer.afterFrame(pumpBudget(cost)); } catch (err) { console.warn('[galaxy] impostor bake failed', err); }
    }
  }

  function sample(now, cost) {
    // Warm-up (shader compile, atlas upload) and one-off hitches must not read as sustained slowness.
    if (now - startedAt < WARMUP_MS) return;
    frameTimes.push({ at: now, ms: Math.min(cost, MAX_SAMPLE_MS) });
    while (frameTimes.length && now - frameTimes[0].at > DOWNGRADE_WINDOW_MS) frameTimes.shift();
    stats.frames++;
    stats.maxMs = Math.max(stats.maxMs, cost);
    // >= 8 samples: a renderer crawling at 4-8 fps must still be able to trigger the downgrade (30 would need 15 fps)
    if (frameTimes.length >= MIN_SAMPLES) {
      const avg = frameTimes.reduce((a, s) => a + s.ms, 0) / frameTimes.length;
      stats.avgMs = avg;
      const span = now - frameTimes[0].at;
      if (avg > FRAME_BUDGET_MS && span >= DOWNGRADE_WINDOW_MS * 0.9 && now - lastDowngradeAt > config.performance.autoDowngrade.cooldownSeconds * 1000) {
        const idx = QUALITY_ORDER.indexOf(scene.quality);
        if (idx < QUALITY_ORDER.length - 1) {
          scene.setQuality(QUALITY_ORDER[idx + 1]); lastDowngradeAt = now; stats.quality = scene.quality;
          track('client.renderer_mode', { mode: renderer.kind, quality: scene.quality, reason: 'auto-downgrade', avgMs: Math.round(avg) });
          if (onQualityChange) onQualityChange(scene.quality);
          frameTimes.length = 0;
        }
      }
    }
  }

  const api = {
    scene, queue, atlas, stats,
    /** Selects the renderer (loading the Three module lazily when it is in the order) and starts the loop. */
    async start() {
      if (!renderer) {
        const wanted = order();
        if (wanted.includes('three') && !threeFactory) {
          try { threeFactory = (await loadThree()).createThreeRenderer; }
          catch (err) { track('client.renderer_mode', { mode: 'three', failed: true, error: 'import: ' + String(err && err.message) }); console.warn('[galaxy] three import failed; falling back', err); }
        }
        select(wanted.filter(k => k !== 'three' || threeFactory));
      }
      if (!renderer) return false;
      fit();
      if (isStatic()) { renderOnce(); return true; }
      running = true; startedAt = performance.now(); lastFrameAt = 0;
      raf = requestAnimationFrame(loop);
      return true;
    },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); },
    /** Snapshot Souls: render in orbit, no entrance. */
    setSouls(list) { scene.setSouls(list); if (isStatic()) renderOnce(); },
    /** Live Float: add and animate once (celebrate === true) or add silently. */
    enter(entrance, { celebrate = false, notBefore = null } = {}) {
      const added = scene.addSoul(entrance);
      if (celebrate && !isStatic()) queue.enqueue(entrance.soulId, monoNow(), notBefore ?? monoNow());
      if (isStatic()) renderOnce();
      return added;
    },
    ripple() { if (!reducedMotion) scene.ripple(); },
    /** A round ended: decorated Souls are about to Float, so the renderer may load their 3D stage now (Three tier only). */
    prewarm() { if (renderer && typeof renderer.prewarm === 'function') { try { renderer.prewarm(); } catch { /* the stage loads on demand instead */ } } },
    /** Winner moment (guarded by the caller): restrained radial burst + warm firefly tint on renderers that support it;
     *  `soulIds` (from result.published) adds the 250 ms outline flash on the winning Souls (Three tier). */
    winner({ soulIds = [] } = {}) { if (reducedMotion || !renderer || typeof renderer.winner !== 'function') return false; renderer.winner(scene.layout, { soulIds }); return true; },
    /** Outline flash only (when the winner ids arrive after the burst already fired). */
    flash(soulIds) { if (reducedMotion || !renderer || typeof renderer.flash !== 'function') return false; return renderer.flash(soulIds); },
    /** Container resized: refit; the static tier paints once, and resizing its canvas clears it, so it repaints. */
    resize() { fit(); if (isStatic()) renderOnce(); },
    get mode() { return renderer ? renderer.kind : null; },
    get quality() { return scene.quality; },
    setQuality(q) { scene.setQuality(q); stats.quality = scene.quality; },
    /** Rehearsal instrumentation: renderer internals (doodad homes, aurora cap, flash state) when the renderer exposes them. */
    debug() { return renderer && typeof renderer.debug === 'function' ? renderer.debug() : null; },
    /** Rehearsal instrumentation: simulate a GPU context loss (hand-over to canvas2d). */
    loseContext() { if (renderer && typeof renderer.loseContext === 'function') { renderer.loseContext(); return true; } return false; },
    dispose() { api.stop(); if (renderer) renderer.dispose(); renderer = null; },
  };
  return api;
}
