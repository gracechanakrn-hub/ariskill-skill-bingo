// packages/ui/soul3d/decor.js - the decoration models of a decorated Soul. v2 (D-29 docs/art/soul-decorations.md): the
// 10 skill charms (assets/souls/charms/<id>.glb, puffy stickers whose texture <id>.png is an external URI so the page
// CSP never needs blob: fetches) and the face kit (assets/souls/faces/face-<face>.glb, authored in model space). v3
// (D-31 docs/art/soul-faces.md): the same 10 charms, plus the face plate and the eyes (assets/souls/v3/plate-<id>.glb /
// eyes-<id>.glb, model space), the refitted v3 face kit (assets/souls/v3/face-<face>.glb, which replaces the v2 kit)
// and the antenna charm ("topper": a catalog charm model at the SOUL_FACE.topper slot). File URLs and the slots come
// from packages/ui/soul-decor-data.js and packages/ui/soul-face-data.js; nothing here hard-codes them.
//
// loadSoulDecor(mods, config) never rejects and never blocks: it resolves { charms, face, plate, eyes, topper,
// thickness, complete, partial, missing, reason }. Each GLB is fetched and parsed once per session (cached promise per
// URL). A missing piece never breaks the Soul: a charm with no file entry, an unusable slot, a 404, a charm whose texture
// did not load or a loader failure skips that one charm (the face kit, plate, eyes and antenna charm likewise), and the
// rest of the decoration still renders; with nothing left the Soul is the plain gradient Soul. A failed URL is not asked
// for again for DECOR_RETRY_MS, so hundreds of Galaxy Souls sharing a missing charm do not each re-request it; after
// that a later Soul retries. Stub decor data, v1 configs and the neutral fallback (face null, charms []) resolve
// undecorated at once; a v3 Soul whose face data is the stub (not built yet) gets its charms only.
// Needs Three.js objects (passed in), no DOM of its own: node-testable with a stub loader.
import { resolveSoul, decorUsable } from '../soul-renderer.js';
import { SOUL_DECOR } from '../soul-decor-data.js';
import { SOUL_FACE } from '../soul-face-data.js';
import { charmPlacement } from './placement.js';

/** How long a failed decoration URL is treated as missing before a later Soul retries it. */
export const DECOR_RETRY_MS = 60000;
/**
 * Emissive intensity of a face kit's glowing part (the angel halo, #FFEFD2 emissive): about 3, so the phone's bloom
 * picks it up like the Blender renders' emission strength 3.2. The GLB keeps factor 1; parts without emission are
 * untouched. Plates and eyes never get it (their emissive values are authored as they should render).
 */
export const FACE_GLOW_INTENSITY = 3;
/**
 * The shader line of a plate / eyes material whose glTF extras say `emissiveFromVertexColor` (D-31): its emissive is
 * multiplied by the vertex colour (the eye gradients in COLOR_0), right after <emissivemap_fragment>.
 */
export const EMISSIVE_FROM_VERTEX_COLOR = 'totalEmissiveRadiance *= vColor.rgb;';
/** Program cache key of those materials (one program for every patched part, never shared with an unpatched one). */
export const EMISSIVE_FROM_VERTEX_COLOR_KEY = 'arise-soul-emissive-from-vertex-colour';
const charmCache = new Map();       // glb url -> Promise<{ id, scene }> (the body charms and the antenna charms)
const faceCache = new Map();        // glb url -> Promise<{ face, scene }> (v2 and v3 kits)
const plateCache = new Map();       // glb url -> Promise<{ kind: 'plate', id, scene }>
const eyesCache = new Map();        // glb url -> Promise<{ kind: 'eyes', id, scene }>
const failedAt = new Map();         // glb url -> time of the last failure

/** Forget every cached decoration and failure (tests; a real session keeps them). */
export function clearSoulDecorCache() { charmCache.clear(); faceCache.clear(); plateCache.clear(); eyesCache.clear(); failedAt.clear(); }
/** Cached decoration URLs and recent failures (instrumentation / tests). */
export function soulDecorCacheKeys() {
  return { charms: [...charmCache.keys()], faces: [...faceCache.keys()], plates: [...plateCache.keys()], eyes: [...eyesCache.keys()], failed: [...failedAt.keys()] };
}

const isMap = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
/**
 * True when the v3 face data can be drawn: generated (never the checked-in stub) with its plates, eyes and faces maps.
 * Otherwise a v3 Soul gets its charms only (no plate, eyes, face kit or antenna charm).
 */
export function faceDataUsable(face = SOUL_FACE) {
  return !!(face && face.stub !== true && isMap(face.plates) && isMap(face.eyes) && isMap(face.faces));
}

function meshesOf(scene) {
  const out = [];
  scene.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}
const materialsOf = (mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean);

/** Parsed charm GLB -> { id, scene } (the template every Soul clones). Throws when it has no mesh or lost its texture. */
export function extractCharmModel(THREE, gltf, id) {
  const scene = gltf && gltf.scene;
  if (!scene) throw new Error(`soul-decor: charm ${id} has no scene`);
  const meshes = meshesOf(scene);
  if (!meshes.length) throw new Error(`soul-decor: charm ${id} has no mesh`);
  const textured = meshes.some((m) => materialsOf(m).some((mat) => mat.map));
  if (!textured) throw new Error(`soul-decor: charm ${id} has no texture (its .png did not load)`);
  scene.updateMatrixWorld(true);
  return Object.freeze({ id, scene });
}

/**
 * Parsed face-kit GLB (v2 or the refitted v3 kit) -> { face, scene }. Throws when it has no mesh. One node (its TRS is
 * the dequantisation) and one mesh with a primitive per part; GLTFLoader keeps only mesh-level extras, so the glowing
 * part is found by its material: any emissive part gets FACE_GLOW_INTENSITY. Blended parts (the blush: alpha in
 * COLOR_0) stay as GLTFLoader builds them (transparent, depthWrite off, vertex colours with alpha); the figure draws the
 * face after the body.
 */
export function extractFaceModel(THREE, gltf, face) {
  const scene = gltf && gltf.scene;
  const meshes = scene ? meshesOf(scene) : [];
  if (!meshes.length) throw new Error(`soul-decor: face kit ${face} has no mesh`);
  for (const m of meshes) for (const mat of materialsOf(m)) {
    if (mat.emissive && (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0)) mat.emissiveIntensity = FACE_GLOW_INTENSITY;
  }
  scene.updateMatrixWorld(true);
  return Object.freeze({ face, scene });
}

/**
 * Multiplies a material's emissive by its vertex colour: EMISSIVE_FROM_VERTEX_COLOR right after
 * <emissivemap_fragment> (guarded like three's own colour chunk, so a part without COLOR_0 still compiles), under its own
 * program cache key. Returns the material.
 */
export function patchEmissiveFromVertexColor(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )\n\t${EMISSIVE_FROM_VERTEX_COLOR}\n#endif`);
  };
  mat.customProgramCacheKey = () => EMISSIVE_FROM_VERTEX_COLOR_KEY;
  mat.needsUpdate = true;
  return mat;
}

/**
 * Parsed face-plate or eyes GLB (D-31; `kind` 'plate' | 'eyes') -> { kind, id, scene }, placed at identity in model
 * space like a face kit. Throws when it has no mesh. The parts keep their authored emissive values (no
 * FACE_GLOW_INTENSITY boost); a material whose glTF extras set `emissiveFromVertexColor` (GLTFLoader copies material
 * extras to userData) gets patchEmissiveFromVertexColor.
 */
export function extractFacePartModel(THREE, gltf, kind, id) {
  const scene = gltf && gltf.scene;
  const meshes = scene ? meshesOf(scene) : [];
  if (!meshes.length) throw new Error(`soul-decor: ${kind} ${id} has no mesh`);
  for (const m of meshes) for (const mat of materialsOf(m)) {
    if (mat.userData && mat.userData.emissiveFromVertexColor === true) patchEmissiveFromVertexColor(mat);
  }
  scene.updateMatrixWorld(true);
  return Object.freeze({ kind, id, scene });
}

function loadOnce(cache, url, mods, extract, retryAfterMs) {
  const failed = failedAt.get(url);
  if (failed !== undefined && Date.now() - failed < retryAfterMs) return Promise.reject(new Error(`soul-decor: ${url} failed recently`));
  if (!cache.has(url)) {
    const p = new Promise((resolve, reject) => {
      const Loader = mods && mods.addons && mods.addons.GLTFLoader;
      if (typeof Loader !== 'function' || !mods.THREE) { reject(new Error('soul-decor: no GLTFLoader')); return; }
      new Loader().load(url, (gltf) => { try { resolve(extract(gltf)); } catch (err) { reject(err); } }, undefined, reject);
    });
    p.then(() => failedAt.delete(url), () => { if (cache.get(url) === p) cache.delete(url); failedAt.set(url, Date.now()); });
    cache.set(url, p);
  }
  return cache.get(url);
}

/**
 * What a Soul needs, without loading anything: { look, usable, reason, charms: [{ slot, id, glb, place }], face:
 * { face, glb } | null, plate: { id, glb } | null, eyes: { id, glb } | null, topper: { id, glb, place } | null,
 * skipped: [charm ids / 'face:<face>' / 'plate:<id>' / 'eyes:<id>' / 'topper:<id>'], thickness }. A charm without a
 * file entry or a usable slot (a partial catalog) is skipped on its own, and so is each v3 piece. v2 draws the
 * SOUL_DECOR face kit; v3 draws the SOUL_FACE kit, plate and eyes and the antenna charm (a SOUL_DECOR charm file placed
 * with charmPlacement(SOUL_FACE.topper, charm thickness)). `reason` explains a plan with nothing to load ('v1',
 * 'plain', 'stub', 'no-files', 'face-stub'), or, on a usable plan, 'face-stub' when a v3 Soul gets its charms only
 * because the face data is the stub or lacks its maps; otherwise null. `face` injects the SOUL_FACE data (tests).
 */
export function soulDecorPlan(config, decor = SOUL_DECOR, face = SOUL_FACE) {
  const look = resolveSoul(config);
  const v3 = look.version >= 3;
  const none = (reason, skipped = []) => ({ look, usable: false, reason, charms: [], face: null, plate: null, eyes: null, topper: null, skipped, thickness: 0 });
  if (look.version < 2) return none('v1');
  if (!look.face && !look.charms.length && !(v3 && (look.plate || look.eyes || look.topper))) return none('plain');
  if (!decorUsable(decor)) return none('stub');
  const thickness = Number(decor.charm.thickness) || 0;
  const notBuilt = new Set(Array.isArray(decor.charm.missing) ? decor.charm.missing : []);
  const charmFile = (id) => (notBuilt.has(id) ? null : decor.charm.files[id]);
  const charms = [], skipped = [];
  for (const ch of look.charms) {
    const file = charmFile(ch.id);
    const slot = decor.slots.find((s) => s.index === ch.slot) || decor.slots[ch.slot];
    const place = file && file.glb ? charmPlacement(slot, thickness) : null;
    if (!place) { skipped.push(ch.id); continue; }
    charms.push({ slot: ch.slot, id: ch.id, glb: file.glb, place });
  }
  let kit = null, plate = null, eyes = null, topper = null, reason = null;
  if (!v3) {
    if (look.face) {
      const file = decor.faces[look.face];
      if (file && file.glb) kit = { face: look.face, glb: file.glb }; else skipped.push(`face:${look.face}`);
    }
  } else if (!faceDataUsable(face)) {
    // the v3 pieces all come from the face data: without it the Soul keeps its charms (the plain gradient Soul else)
    reason = 'face-stub';
    if (look.plate) skipped.push(`plate:${look.plate}`);
    if (look.eyes) skipped.push(`eyes:${look.eyes}`);
    if (look.face) skipped.push(`face:${look.face}`);
    if (look.topper) skipped.push(`topper:${look.topper.id}`);
  } else {
    const glbOf = (file) => (file && typeof file.glb === 'string' && file.glb ? file.glb : null);
    if (look.plate) { const glb = glbOf(face.plates[look.plate]); if (glb) plate = { id: look.plate, glb }; else skipped.push(`plate:${look.plate}`); }
    if (look.eyes) { const glb = glbOf(face.eyes[look.eyes]); if (glb) eyes = { id: look.eyes, glb }; else skipped.push(`eyes:${look.eyes}`); }
    if (look.face) { const glb = glbOf(face.faces[look.face]); if (glb) kit = { face: look.face, glb }; else skipped.push(`face:${look.face}`); }
    if (look.topper) {
      const glb = glbOf(charmFile(look.topper.id));
      const place = glb ? charmPlacement(face.topper, thickness) : null;
      if (place) topper = { id: look.topper.id, glb, place }; else skipped.push(`topper:${look.topper.id}`);
    }
  }
  if (!charms.length && !kit && !plate && !eyes && !topper) return none(reason || 'no-files', skipped);
  return { look, usable: true, reason, charms, face: kit, plate, eyes, topper, skipped, thickness };
}

/**
 * Loads a Soul's decoration. mods = { THREE, addons: { GLTFLoader } }; opts { decor (SOUL_DECOR), face (SOUL_FACE),
 * retryAfterMs }. Resolves (never rejects) { charms: [{ slot, id, model, place }], face: model | null, plate: model |
 * null, eyes: model | null, topper: { id, model, place } | null, thickness, complete (everything the config asks for
 * loaded), partial (some of it did), missing: [charm ids / 'face:<face>' / 'plate:<id>' / 'eyes:<id>' /
 * 'topper:<id>'], reason, error? }. `reason` is null when complete, else the plan's reason for a Soul with nothing to
 * load, 'load-failed' when nothing loaded, 'face-stub' for a v3 Soul drawn with its charms only, or 'partial'.
 */
export async function loadSoulDecor(mods, config, { decor = SOUL_DECOR, face: faceData = SOUL_FACE, retryAfterMs = DECOR_RETRY_MS } = {}) {
  const empty = { charms: [], face: null, plate: null, eyes: null, topper: null, thickness: 0 };
  let plan;
  try { plan = soulDecorPlan(config, decor, faceData); } catch (err) { return { ...empty, complete: false, partial: false, missing: [], reason: 'plan', error: String(err && err.message) }; }
  if (!plan.usable) {
    const nothingNeeded = plan.reason === 'v1' || plan.reason === 'plain';
    return { ...empty, complete: nothingNeeded, partial: false, missing: plan.skipped, reason: plan.reason };
  }
  const THREE = mods && mods.THREE;
  const settle = (p) => p.then((value) => ({ ok: true, value }), (err) => ({ ok: false, err }));
  const load = (cache, url, extract) => settle(loadOnce(cache, url, mods, extract, retryAfterMs));
  const none = Promise.resolve(null);
  const [results, kitResult, plateResult, eyesResult, topperResult] = await Promise.all([
    Promise.all(plan.charms.map((c) => load(charmCache, c.glb, (gltf) => extractCharmModel(THREE, gltf, c.id)))),
    plan.face ? load(faceCache, plan.face.glb, (gltf) => extractFaceModel(THREE, gltf, plan.face.face)) : none,
    plan.plate ? load(plateCache, plan.plate.glb, (gltf) => extractFacePartModel(THREE, gltf, 'plate', plan.plate.id)) : none,
    plan.eyes ? load(eyesCache, plan.eyes.glb, (gltf) => extractFacePartModel(THREE, gltf, 'eyes', plan.eyes.id)) : none,
    plan.topper ? load(charmCache, plan.topper.glb, (gltf) => extractCharmModel(THREE, gltf, plan.topper.id)) : none,
  ]);
  const charms = [], missing = [...plan.skipped];
  let error = null;
  /** A settled piece's model, or null (recorded in `missing` under `key` when it failed). */
  const take = (r, key) => {
    if (!r) return null;
    if (r.ok) return r.value;
    missing.push(key);
    error = error || String((r.err && r.err.message) || r.err);
    return null;
  };
  plan.charms.forEach((c, i) => { const model = take(results[i], c.id); if (model) charms.push({ slot: c.slot, id: c.id, model, place: c.place }); });
  const plate = take(plateResult, plan.plate && `plate:${plan.plate.id}`);
  const eyes = take(eyesResult, plan.eyes && `eyes:${plan.eyes.id}`);
  const face = take(kitResult, plan.face && `face:${plan.face.face}`);
  const topperModel = take(topperResult, plan.topper && `topper:${plan.topper.id}`);
  const topper = topperModel ? { id: plan.topper.id, model: topperModel, place: plan.topper.place } : null;
  const any = charms.length > 0 || !!(face || plate || eyes || topper);
  const complete = missing.length === 0;
  const reason = complete ? null : !any ? 'load-failed' : plan.reason || 'partial';
  return { charms, face, plate, eyes, topper, thickness: plan.thickness, complete, partial: !complete && any, missing, reason, ...(error ? { error } : {}) };
}

/** True when a loadSoulDecor result has something to draw (all of it or part of it). */
export function hasDecor(decor) {
  return !!(decor && ((decor.charms && decor.charms.length) || decor.face || decor.plate || decor.eyes || decor.topper));
}

/** Warm the cache for a Soul (phone: as soon as the round-end config is known). Never throws. */
export function prefetchSoulDecor(mods, config, opts) { return loadSoulDecor(mods, config, opts).catch(() => null); }
