// apps/employee-mobile/src/scene/loader.js - lazy access to the vendored Three.js (packages/vendor/three, D-22).
// Nothing here runs at startup: `loadThree()` imports on demand (Join / Soul screens) and `prefetchThree()` warms the
// module cache during the Playing screen from an idle callback so the reveal opens instantly. No import maps, no CDN.

const CORE_URL = '/packages/vendor/three/index.js';
const ADDONS_URL = '/packages/vendor/three/addons.js';

let loading = null;
let prefetched = false;

/** Resolves { THREE, addons }; rejects when the modules cannot be loaded (callers fall back to SVG / CSS). */
export function loadThree() {
  if (!loading) {
    loading = Promise.all([import(CORE_URL), import(ADDONS_URL)])
      .then(([THREE, addons]) => ({ THREE, addons }))
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

/** Idle-time prefetch (module fetch + compile); safe to call many times. */
export function prefetchThree() {
  if (prefetched || loading) return;
  prefetched = true;
  const go = () => { loadThree().catch(() => { prefetched = false; }); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 2500 });
  else setTimeout(go, 1200);
}

export function threeReady() { return !!loading; }
