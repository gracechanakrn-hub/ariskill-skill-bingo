// packages/ui/soul3d/model.js - the Soul body GLBs for every 3D Soul: the phone reveal / Float and the public Galaxy's
// Float entrance and impostors. Two body variants share one format (KHR_mesh_quantization, POSITION / NORMAL / COLOR_0
// RGBA mask, asset.extras.landmarks): 'v2' is the baseline (D-27, docs/art/soul-baseline.md) that v1 and v2 Souls and
// the join mascot are drawn on; 'v3' is the stage-13 body with no orb and no button eyes (D-31, docs/art/soul-faces.md),
// drawn for v3 Souls (soulBodyVariant). Loads each variant's two levels of detail once per session (cached promise per
// variant + LOD; baseline URLs from the generated asset map, v3 URLs from packages/ui/soul-face-data.js, GLTFLoader
// passed in from the vendored loaders facade, D-28) and keeps what the figure needs: the shared index / position /
// normal buffers, the COLOR_0 mask, the landmarks, the node transform (it carries the dequantisation) and each vertex's
// height above the floor (the D-29 body gradient runs on it). Needs Three.js objects (passed in), no DOM:
// node-testable with the vendored loader.
import { soulModelUrl } from '../asset-map.js';
import { SOUL_FACE } from '../soul-face-data.js';

const cache = new Map();            // `${variant}:${lod}` -> Promise<model>

/** The body variants: 'v2' the baseline GLBs (D-27), 'v3' the stage-13 body (D-31). Anything else reads as 'v2'. */
export const SOUL_BODY_VARIANTS = Object.freeze(['v2', 'v3']);
const variantOf = (variant) => (variant === 'v3' ? 'v3' : 'v2');
const lodOf = (lod) => (lod === 'lite' ? 'lite' : 'hero');

/** The body a Soul config is drawn on: 'v3' for a v3 config (stage 13, D-31), else the baseline 'v2' (v1, v2, none). */
export function soulBodyVariant(config) {
  return !!config && typeof config === 'object' && Number(config.version) >= 3 ? 'v3' : 'v2';
}

/**
 * URL of a body GLB: the baseline from the asset map, the v3 body from SOUL_FACE.body (`face` is injectable for tests).
 * Null when there is none: the stub SOUL_FACE (not built yet) or a missing entry.
 */
export function soulBodyUrl(lod = 'hero', variant = 'v2', face = SOUL_FACE) {
  const key = lodOf(lod);
  if (variantOf(variant) === 'v2') return soulModelUrl(key) || null;
  const url = face && face.stub !== true && face.body ? face.body[key] : null;
  return typeof url === 'string' && url ? url : null;
}

/**
 * Landmarks from the GLB (asset.extras.landmarks), validated; the defaults are the v1 values so a stripped file still
 * frames. A v3 body carries `orb` = the antenna charm's centre (framing code keeps working), its own `eyes` and a
 * `topper` { centre, size } (null when absent, as on the baseline).
 */
export function readLandmarks(extras) {
  const L = extras && extras.landmarks;
  const vec3 = (v, d) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v.slice() : d);
  const eyes = Array.isArray(L?.eyes) ? L.eyes : [];
  const topperCentre = vec3(L?.topper?.centre, null);
  const topper = topperCentre && Number(L.topper.size) > 0 ? Object.freeze({ centre: topperCentre, size: Number(L.topper.size) }) : null;
  return Object.freeze({
    orb: Object.freeze({ centre: vec3(L?.orb?.centre, [0.105, 2.1, -0.065]), radius: Number.isFinite(L?.orb?.radius) ? L.orb.radius : 0.169 }),
    eyes: Object.freeze(eyes.map((e) => Object.freeze({ centre: vec3(e.centre, [0, 1.165, 0.35]), normal: vec3(e.normal, [0, 0, 1]), radius: Number(e.radius) || 0.148 }))),
    height: Number.isFinite(L?.height) && L.height > 0 ? L.height : 2.29087,
    floor: Number.isFinite(L?.floor) ? L.floor : -0.02189,
    badgeAnchor: vec3(L?.badge_anchor, [0.405, 1.62, -0.065]),
    topper,
  });
}

/**
 * Height of every vertex above the model floor, in model units: the node transform (position, quaternion, scale)
 * applied to the stored (dequantised) position, minus `floor`. Float32Array(count).
 */
export function vertexHeights(position, { position: t, quaternion: q, scale: s }, floor) {
  const n = position.count;
  const out = new Float32Array(n);
  // y row of the rotation matrix of q (x, y, z, w), so y' = R[1] . (s * p) + t.y
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
  for (let i = 0; i < n; i++) {
    const x = position.getX(i) * s.x, y = position.getY(i) * s.y, z = position.getZ(i) * s.z;
    out[i] = r10 * x + r11 * y + r12 * z + t.y - floor;
  }
  return out;
}

/**
 * Parsed GLB (GLTFLoader result) -> the cached, render-agnostic model { lod, variant, geometry, mask, heights, count,
 * landmarks, node TRS }.
 */
export function extractSoulModel(THREE, gltf, lod, variant = 'v2') {
  let mesh = null;
  gltf.scene.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  if (!mesh) throw new Error('soul-model: GLB has no mesh');
  const src = mesh.geometry;
  const { position, normal, color } = src.attributes;
  if (!position || !normal || !color || !src.index) throw new Error('soul-model: GLB lacks POSITION / NORMAL / COLOR_0 / indices');
  const count = position.count;
  const mask = new Float32Array(count * 4);   // COLOR_0 RGBA mask, 0..1 (getX..getW denormalise the uint8 data)
  for (let i = 0; i < count; i++) { mask[i * 4] = color.getX(i); mask[i * 4 + 1] = color.getY(i); mask[i * 4 + 2] = color.getZ(i); mask[i * 4 + 3] = color.getW(i); }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(src.index);
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  // GLTFLoader derives bounds from the accessor min/max; recomputing from the data keeps the scene right even for a
  // hand-edited or third-party GLB with loose min/max.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const landmarks = readLandmarks(gltf.asset && gltf.asset.extras);
  const node = { position: mesh.position.clone(), quaternion: mesh.quaternion.clone(), scale: mesh.scale.clone() };
  return Object.freeze({
    lod, variant: variantOf(variant), geometry, mask, count, landmarks,
    heights: vertexHeights(position, node, landmarks.floor),
    position: node.position, quaternion: node.quaternion, scale: node.scale,
  });
}

/**
 * One parse per variant and LOD for the whole session. `mods` = { THREE, addons: { GLTFLoader } }; `variant` 'v2' (the
 * baseline, default) or 'v3' (SOUL_FACE.body; opts.face injects the data for tests). Rejects (and forgets the attempt)
 * when there is no URL (the stub SOUL_FACE), or the file or the modules fail: callers fall back as for the baseline.
 */
export function loadSoulModel({ THREE, addons }, lod = 'hero', variant = 'v2', { face = SOUL_FACE } = {}) {
  const key = lodOf(lod), v = variantOf(variant), id = `${v}:${key}`;
  if (!cache.has(id)) {
    const url = soulBodyUrl(key, v, face);
    const p = new Promise((resolve, reject) => {
      if (!url || !addons || typeof addons.GLTFLoader !== 'function') { reject(new Error(`soul-model: no ${v} ${key} model URL or loader`)); return; }
      new addons.GLTFLoader().load(url, (gltf) => { try { resolve(extractSoulModel(THREE, gltf, key, v)); } catch (err) { reject(err); } }, undefined, reject);
    });
    p.catch(() => { if (cache.get(id) === p) cache.delete(id); });
    cache.set(id, p);
  }
  return cache.get(id);
}

/** Cached body models as `${variant}:${lod}` keys (instrumentation / tests). */
export function soulModelCacheKeys() { return [...cache.keys()]; }
/** Forget every cached body model (tests; a real session keeps them). */
export function clearSoulModelCache() { cache.clear(); }

/** Idle-time warm-up (fetch + parse) of one variant so the reveal opens without waiting on the network. Never throws. */
export function prefetchSoulModels(mods, lods = ['lite', 'hero'], variant = 'v2', opts) {
  for (const lod of lods) loadSoulModel(mods, lod, variant, opts).catch(() => { /* the scene retries and falls back */ });
}

/**
 * Body model of a variant for a tier (hero on high, lite on low), then that variant's lite hull (or the body itself).
 * Resolves { body, hull } or null when nothing loads (caller keeps its SVG / CSS fallback). opts: { variant ('v2' |
 * 'v3', from soulBodyVariant(config)), face (SOUL_FACE, injectable for tests) }.
 */
export async function loadSoulModels(mods, quality, { variant = 'v2', face = SOUL_FACE, hull: needHull = true } = {}) {
  const wantHero = quality === 'high';
  const load = (lod) => loadSoulModel(mods, lod, variant, { face });
  let body = await load(wantHero ? 'hero' : 'lite').catch(() => null);
  if (!body && wantHero) body = await load('lite').catch(() => null);
  if (!body) return null;
  // hull: false (no white die-cut, e.g. the phone since D-58) skips the extra lite download
  const hull = !needHull || body.lod === 'lite' ? body : await load('lite').catch(() => body);
  return { body, hull };
}
