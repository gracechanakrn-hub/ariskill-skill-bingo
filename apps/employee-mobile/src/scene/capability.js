// apps/employee-mobile/src/scene/capability.js - device capability heuristics for the phone hero scenes.
// `sceneQuality` is pure (node-testable); the browser probes live below it and never throw.

export const FRAME_BUDGET_MS = 33; // 30 fps floor for the phone hero scene (game-experience brief, Performance)

/**
 * Decide the scene tier from plain inputs. Pure.
 *  - 'off'  : no WebGL, or the user/QA forced it off -> existing SVG / CSS path
 *  - 'low'  : small screens, low core count / memory, high DPR -> no bloom, pixel ratio 1, fewer motes
 *  - 'high' : bloom via EffectComposer, pixel ratio up to 1.5
 * Reduced motion never disables the scene by itself (it only stops ambient movement); the scene stays static.
 */
export function sceneQuality({ webgl = false, dpr = 1, cores = 4, memoryGb = 4, forced = null } = {}) {
  if (forced === 'off') return 'off';
  if (!webgl) return 'off';
  if (forced === 'high' || forced === 'force') return 'high';
  if (forced === 'low') return 'low';
  if (cores <= 4 || memoryGb <= 2 || dpr >= 3) return 'low';
  return 'high';
}

/** True when the median of the sampled frame intervals exceeds the budget (a single hitch never trips it). Pure. */
export function frameBudgetExceeded(samplesMs, budgetMs = FRAME_BUDGET_MS) {
  const list = Array.isArray(samplesMs) ? samplesMs.filter((n) => Number.isFinite(n) && n > 0) : [];
  if (list.length < 10) return false; // not enough evidence: keep the scene
  const sorted = list.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return median > budgetMs;
}

/** Pixel ratio cap per tier (kept small: the hero canvas is ~360 px wide). Pure. */
export function pixelRatioFor(quality, dpr = 1) {
  if (quality === 'high') return Math.min(dpr || 1, 1.5);
  return 1;
}

// ---- browser probes (best effort, never throw) ----------------------------------------------------------------

export function webglAvailable() {
  try {
    if (typeof document === 'undefined') return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    return true;
  } catch { return false; }
}

/** QA / dev override from the URL (`?scene=off|low|force`), read once. Not a product feature. */
export function forcedQuality() {
  try {
    const v = new URL(location.href).searchParams.get('scene');
    return v === 'off' || v === 'low' || v === 'force' || v === 'high' ? v : null;
  } catch { return null; }
}

/** Current tier from the live environment. */
export function detectQuality() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  return sceneQuality({
    webgl: webglAvailable(),
    dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    cores: nav.hardwareConcurrency || 4,
    memoryGb: nav.deviceMemory || 4,
    forced: forcedQuality(),
  });
}

/**
 * Frame-time probe: collects up to `count` rAF intervals after a short warm-up and calls `onResult(exceeded, mean)`.
 * Returns a cancel function. Skipped (never reports) when the QA override forces the scene on.
 */
export function probeFrameTime(onResult, { count = 45, warmup = 12, budgetMs = FRAME_BUDGET_MS } = {}) {
  if (typeof requestAnimationFrame !== 'function' || forcedQuality() === 'force') return () => {};
  const samples = [];
  let seen = 0, last = 0, raf = 0, done = false;
  function tick(now) {
    if (done) return;
    if (last && seen >= warmup && !document.hidden) samples.push(now - last);
    last = now; seen++;
    if (samples.length >= count) { done = true; const mean = samples.reduce((a, b) => a + b, 0) / samples.length; onResult(frameBudgetExceeded(samples, budgetMs), mean); return; }
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
  return () => { done = true; cancelAnimationFrame(raf); };
}
