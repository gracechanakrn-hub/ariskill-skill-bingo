// apps/employee-mobile/src/scene/loader.js - lazy access to the vendored Three.js (packages/vendor/three, D-22).
// Nothing here runs at startup: `loadThree()` imports on demand (Join / Soul screens) and `prefetchThree()` warms the
// module cache during the Playing screen from an idle callback so the reveal opens instantly - including the baseline
// Soul GLBs for the device tier (D-27: fetched + parsed once, cached by soul-model.js). Once the round-end config is
// known the Soul's own models follow: the v3 body of a v3 Soul (`prefetchSoulBody`, D-31) and its charm, face-kit,
// plate, eyes and antenna-charm models (`prefetchSoulDecor`, D-29 / D-31). No import maps, no CDN.

const CORE_URL = '/packages/vendor/three/index.js';
const ADDONS_URL = '/packages/vendor/three/addons.js';   // post-processing (bloom)
const LOADERS_URL = '/packages/vendor/three/loaders.js'; // GLTFLoader for the baseline Soul GLBs

let loading = null;
let prefetched = false;

/** Resolves { THREE, addons }; rejects when the modules cannot be loaded (callers fall back to SVG / CSS). */
export function loadThree() {
  if (!loading) {
    loading = Promise.all([import(CORE_URL), import(ADDONS_URL), import(LOADERS_URL)])
      .then(([THREE, post, loaders]) => ({ THREE, addons: { ...post, ...loaders } }))
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

/** Runs `fn` from an idle callback (at most `timeout` ms late), or after `fallbackMs` where there is none. */
function whenIdle(fn, timeout, fallbackMs) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout });
  else setTimeout(fn, fallbackMs);
}

/**
 * Warm the Soul body cache for this device's tier (lite always; hero on the high tier): the baseline, or the body of
 * `config`'s variant (soulBodyVariant: the v3 body for a v3 Soul).
 */
function prefetchModels(mods, config = null) {
  return Promise.all([import('./soul-model.js'), import('./capability.js')]).then(([model, cap]) => {
    const tier = cap.detectQuality();
    if (tier !== 'off') model.prefetchSoulModels(mods, tier === 'high' ? ['lite', 'hero'] : ['lite'], model.soulBodyVariant(config));
  });
}

/** Idle-time prefetch (module fetch + compile, then the baseline Soul models); safe to call many times. */
export function prefetchThree() {
  if (prefetched) return;
  prefetched = true;
  whenIdle(() => { loadThree().then((mods) => prefetchModels(mods)).catch(() => { prefetched = false; }); }, 2500, 1200);
}

/**
 * Warm the v3 body (stage 13, D-31: every v3 Soul stands on it) once the round-end config is known, so the reveal of a
 * v3 Soul opens without waiting on the network; the baseline of v1 / v2 Souls is already warm from prefetchThree.
 * Idle-time, once per session, only when the device runs the 3D scene. Safe to call many times.
 */
let bodyPrefetched = false;
export function prefetchSoulBody(config) {
  if (!config || typeof config !== 'object' || Number(config.version) < 3 || bodyPrefetched) return;
  bodyPrefetched = true;
  whenIdle(() => { loadThree().then((mods) => prefetchModels(mods, config)).catch(() => { bodyPrefetched = false; }); }, 1500, 300);
}

/**
 * Warm the decoration cache (the charm and face-kit GLBs of a decorated v2 Soul, D-29; for a v3 Soul also its face
 * plate, eyes, refitted kit and antenna charm, D-31) once the round-end config is known, so the reveal opens decorated.
 * Idle-time, once per decoration set, only when the device runs the 3D scene (the SVG fallback draws the PNG sprites
 * itself). Safe to call many times.
 */
const decorPrefetched = new Set();
export function prefetchSoulDecor(config) {
  if (!config || typeof config !== 'object' || Number(config.version) < 2 || (!config.face && !(Array.isArray(config.charms) && config.charms.length))) return;
  const key = JSON.stringify([Number(config.version), config.face, config.charms, config.plate, config.eyes, config.topper]);
  if (decorPrefetched.has(key)) return;
  decorPrefetched.add(key);
  const go = () => {
    Promise.all([loadThree(), import('./soul-model.js'), import('./capability.js')])
      .then(([mods, model, cap]) => (cap.detectQuality() === 'off' ? null : model.prefetchSoulDecor(mods, config)))
      .catch(() => { decorPrefetched.delete(key); });
  };
  whenIdle(go, 1500, 300);
}

export function threeReady() { return !!loading; }
