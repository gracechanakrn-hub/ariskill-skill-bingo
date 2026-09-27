// packages/ui/soul3d for the v3 Soul (stage 13, D-31 docs/art/soul-faces.md "Rendering: one Soul everywhere"), in Node
// with stub loaders and fixture data shaped like packages/ui/soul-face-data.js (the checked-in module may still be the
// stub placeholder, or already the Blender build): the body variant (v3 URLs from SOUL_FACE.body, cached per variant +
// LOD, a stub rejects), the v3 decor plan and loader (the v2 charms plus face plate, eyes, refitted face kit and the
// antenna charm at the SOUL_FACE.topper slot; each piece skipped on its own; stub face data -> charms only), the plate /
// eyes extractor (no face-glow boost, emissive x vertex colour through one shader line), and the figure (gradient tint,
// no orb sprite or orb emissive, plate / eyes / kit at identity, the antenna charm at its slot, draw order, fade,
// dispose) and rig (medallion badge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as THREE from '../../vendor/three/index.js';
import * as loaders from '../../vendor/three/loaders.js';
import {
  SOUL_BODY_VARIANTS, soulBodyVariant, soulBodyUrl, readLandmarks, extractSoulModel, loadSoulModel, loadSoulModels,
  prefetchSoulModels, soulModelCacheKeys, clearSoulModelCache,
} from '../soul3d/model.js';
import {
  soulDecorPlan, loadSoulDecor, clearSoulDecorCache, soulDecorCacheKeys, hasDecor, faceDataUsable, extractFacePartModel,
  extractFaceModel, FACE_GLOW_INTENSITY, EMISSIVE_FROM_VERTEX_COLOR, EMISSIVE_FROM_VERTEX_COLOR_KEY,
} from '../soul3d/decor.js';
import { buildSoulFigure, figureColours, RENDER_ORDER } from '../soul3d/figure.js';
import { buildSoulRig } from '../soul3d/rig.js';
import { charmPlacement } from '../soul3d/placement.js';
import { tintGradientColors } from '../soul3d/tint.js';
import { soulModelUrl } from '../asset-map.js';
import { GRADIENTS, CHARMS_BY_KIND } from '../../game-rules/src/soul-catalog.js';
import { decorFixture, v2Config, neutralV2, faceDataFixture, stubFaceData, v3Config } from './decor-fixture.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DECOR = decorFixture();
const FACE = faceDataFixture();
const near = (a, b, eps = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
const meshes = (o) => { const out = []; o.traverse((x) => { if (x.isMesh) out.push(x); }); return out; };
const V3_LANDMARKS = Object.freeze({
  orb: { centre: [0.1027, 2.09, -0.02], radius: 0.18 },
  eyes: [{ side: 'left', centre: [0.16, 1.18, 0.4], normal: [0.3, 0, 0.95], radius: 0.085 }, { side: 'right', centre: [-0.16, 1.18, 0.4], normal: [-0.3, 0, 0.95], radius: 0.085 }],
  height: 2.29087, floor: -0.02189, badge_anchor: [0.405, 1.62, -0.065], topper: { centre: [0.1027, 2.09, -0.02], size: 0.36 },
});

/** The shipped baseline GLBs, parsed once (the figure only needs a real mesh with a mask and landmarks). */
const models = {};
async function baseline(lod) {
  if (!models[lod]) {
    const buf = readFileSync(join(ROOT, soulModelUrl(lod).replace(/^\//, '')));
    const gltf = await new Promise((resolve, reject) => new loaders.GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject));
    models[lod] = extractSoulModel(THREE, gltf, lod);
  }
  return models[lod];
}

/** A glTF part template: a node carrying a dequantising TRS, like the Blender exports. */
function node(...children) { const n = new THREE.Group(); n.position.set(0, 1.17, 0.39); n.scale.setScalar(0.25); n.add(...children); return n; }
function colouredDisc() {
  const geo = new THREE.CircleGeometry(0.2, 12);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 4).fill(0.8), 4));
  return geo;
}

/**
 * A stand-in for GLTFLoader: charms are 1.0-wide textured discs, face kits two parts (one glowing), plates two plain
 * parts, eyes a gradient part flagged emissiveFromVertexColor plus a wall, bodies a small sphere with an RGBA mask and
 * v3 landmarks. Records every URL; `fail` lists file names that 404.
 */
function stubMods({ fail = [], delayMs = 1 } = {}) {
  const calls = [];
  class GLTFLoader {
    load(url, onLoad, _progress, onError) {
      calls.push(url);
      const path = url.split('?')[0];
      setTimeout(() => {
        if (fail.some((f) => path.endsWith(f))) { onError(new Error(`404 ${url}`)); return; }
        const scene = new THREE.Group();
        let asset = {};
        if (path.includes('/charms/')) {
          const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 12); geo.rotateX(Math.PI / 2); geo.translate(0, 0, 0.1);
          scene.add(node(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: new THREE.Texture() }))));
        } else if (/\/plate-[^/]+$/.test(path)) {
          scene.add(node(new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), new THREE.MeshStandardMaterial({ color: 0xf7f8ff, name: 'plate_top' })),
            new THREE.Mesh(new THREE.RingGeometry(0.3, 0.32, 12), new THREE.MeshStandardMaterial({ color: 0x9aa0c0, name: 'plate_wall' }))));
        } else if (/\/eyes-[^/]+$/.test(path)) {
          const top = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x404040, vertexColors: true, name: 'base_eye_top' });
          top.userData.emissiveFromVertexColor = true;
          const inset = new THREE.MeshStandardMaterial({ color: 0xff3366, emissive: 0x42070f, name: 'inset_heart_top' });
          scene.add(node(new THREE.Mesh(colouredDisc(), top), new THREE.Mesh(new THREE.CircleGeometry(0.05, 8), inset),
            new THREE.Mesh(new THREE.RingGeometry(0.2, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0x222244, name: 'base_eye_wall' }))));
        } else if (/\/body-[^/]+$/.test(path) || path.includes('/baseline/')) {
          const geo = new THREE.SphereGeometry(0.5, 8, 6);
          geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 4), 4));
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
          mesh.position.set(0, 1.12, 0); mesh.scale.setScalar(1.15);
          scene.add(mesh);
          asset = { extras: { landmarks: path.includes('/baseline/') ? { height: 2.29087, floor: -0.02189 } : V3_LANDMARKS } };
        } else {
          scene.add(node(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 16), new THREE.MeshStandardMaterial({ color: 0x333333 })),
            new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.01, 6, 16), new THREE.MeshStandardMaterial({ color: 0xffefd2, emissive: 0xffefd2, name: 'halo' }))));
        }
        onLoad({ scene, asset });
      }, delayMs);
    }
  }
  return { mods: { THREE, addons: { GLTFLoader } }, calls };
}

// ---- body variant ---------------------------------------------------------------------------------------------

test('body variant: a v3 config stands on the v3 body, whose URLs come from SOUL_FACE.body; the stub face data has none', () => {
  assert.deepEqual([...SOUL_BODY_VARIANTS], ['v2', 'v3']);
  assert.equal(soulBodyVariant(v3Config()), 'v3');
  for (const c of [v2Config(), neutralV2(), { seed: 'v1', palette: 2 }, null, undefined, 'x', 3, {}]) assert.equal(soulBodyVariant(c), 'v2', JSON.stringify(c));
  assert.equal(soulBodyVariant({ ...v3Config(), version: '3' }), 'v3', 'as resolveSoul reads the version');
  for (const lod of ['hero', 'lite']) {
    assert.equal(soulBodyUrl(lod, 'v2'), soulModelUrl(lod), 'the baseline from the asset map');
    assert.equal(soulBodyUrl(lod), soulModelUrl(lod), 'v2 by default');
    assert.equal(soulBodyUrl(lod, 'v3', FACE), FACE.body[lod]);
  }
  assert.equal(soulBodyUrl('anything', 'v3', FACE), FACE.body.hero, 'an unknown LOD reads as hero');
  assert.equal(soulBodyUrl('hero', 'nope', FACE), soulModelUrl('hero'), 'an unknown variant reads as the baseline');
  for (const face of [stubFaceData(), { ...FACE, stub: true }, { ...FACE, body: { hero: '', lite: null } }, { ...FACE, body: null }, null]) {
    assert.equal(soulBodyUrl('hero', 'v3', face), null); assert.equal(soulBodyUrl('lite', 'v3', face), null);
  }
});

test('readLandmarks: a v3 body keeps the framing (orb = the antenna charm centre), its own eyes and the topper landmark', () => {
  const L = readLandmarks({ landmarks: V3_LANDMARKS });
  assert.deepEqual(L.orb, { centre: [0.1027, 2.09, -0.02], radius: 0.18 });
  assert.deepEqual(L.eyes.map((e) => e.radius), [0.085, 0.085]);
  assert.deepEqual(L.eyes[0].centre, [0.16, 1.18, 0.4]);
  assert.deepEqual(L.topper, { centre: [0.1027, 2.09, -0.02], size: 0.36 });
  assert.ok(Object.isFrozen(L.topper));
  assert.equal(readLandmarks(undefined).topper, null, 'the baseline has no topper');
  assert.equal(readLandmarks({ landmarks: { topper: { centre: [1, 'x', 2], size: 0.3 } } }).topper, null);
  assert.equal(readLandmarks({ landmarks: { topper: { centre: [0, 2, 0], size: 0 } } }).topper, null);
});

test('loadSoulModel(s): each variant + LOD parsed once, v3 from the SOUL_FACE URLs; a stub rejects (callers fall back)', async () => {
  clearSoulModelCache();
  const { mods, calls } = stubMods();
  const [a, b] = await Promise.all([loadSoulModel(mods, 'hero', 'v3', { face: FACE }), loadSoulModel(mods, 'hero', 'v3', { face: FACE })]);
  assert.equal(a, b, 'one parse per variant + LOD');
  assert.deepEqual(calls, [FACE.body.hero]);
  assert.deepEqual([a.lod, a.variant], ['hero', 'v3']);
  assert.deepEqual(a.landmarks.topper, V3_LANDMARKS.topper);
  assert.deepEqual(a.landmarks.orb.centre, V3_LANDMARKS.topper.centre, 'framing code keeps working on the antenna charm');
  const high = await loadSoulModels(mods, 'high', { variant: 'v3', face: FACE });
  assert.equal(high.body, a);
  assert.deepEqual([high.hull.lod, high.hull.variant], ['lite', 'v3'], 'the die-cut hull from the v3 lite LOD');
  const low = await loadSoulModels(mods, 'low', { variant: 'v3', face: FACE });
  assert.equal(low.body, high.hull); assert.equal(low.hull, low.body);
  const base = await loadSoulModels(mods, 'high');
  assert.deepEqual([base.body.variant, base.body.lod, base.hull.variant], ['v2', 'hero', 'v2'], 'the baseline by default');
  assert.notEqual(base.body, a, 'cached per variant');
  assert.deepEqual(calls, [FACE.body.hero, FACE.body.lite, soulModelUrl('hero'), soulModelUrl('lite')]);
  assert.deepEqual(soulModelCacheKeys().sort(), ['v2:hero', 'v2:lite', 'v3:hero', 'v3:lite']);
  // the stub face data (the checked-in placeholder): no URL, no request, the attempt is forgotten, the caller gets null
  clearSoulModelCache();
  const stub = stubMods();
  await assert.rejects(loadSoulModel(stub.mods, 'hero', 'v3', { face: stubFaceData() }), /no v3 hero model URL/);
  assert.equal(await loadSoulModels(stub.mods, 'high', { variant: 'v3', face: stubFaceData() }), null);
  assert.equal(stub.calls.length, 0);
  assert.deepEqual(soulModelCacheKeys(), []);
  prefetchSoulModels(stub.mods, ['lite', 'hero'], 'v3', { face: stubFaceData() }); // never throws
  // a v3 hero that 404s: the high tier falls back to the v3 lite
  clearSoulModelCache();
  const broken = stubMods({ fail: ['body-hero.glb'] });
  const fb = await loadSoulModels(broken.mods, 'high', { variant: 'v3', face: FACE });
  assert.deepEqual([fb.body.lod, fb.body.variant, fb.hull === fb.body], ['lite', 'v3', true]);
  assert.deepEqual(soulModelCacheKeys(), ['v3:lite'], 'the failed hero is forgotten (a later Soul retries it)');
  prefetchSoulModels(broken.mods, ['hero'], 'v3', { face: FACE });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(broken.calls.filter((u) => u === FACE.body.hero).length, 2);
});

// ---- decor plan ------------------------------------------------------------------------------------------------

test('v3 decor plan: the v2 charms, plus plate, eyes and the refitted kit from the face data and the antenna charm at its slot', () => {
  const cfg = v3Config();
  const plan = soulDecorPlan(cfg, DECOR, FACE);
  assert.deepEqual([plan.usable, plan.reason, plan.skipped], [true, null, []]);
  assert.deepEqual(plan.charms, soulDecorPlan(v2Config(), DECOR).charms, 'the 10 charms exactly as v2');
  assert.deepEqual(plan.plate, { id: 'bean', glb: FACE.plates.bean.glb });
  assert.deepEqual(plan.eyes, { id: 'hearts', glb: FACE.eyes.hearts.glb });
  assert.deepEqual(plan.face, { face: 'nerdy', glb: FACE.faces.nerdy.glb }, 'the v3 kit replaces the v2 kit');
  assert.notEqual(plan.face.glb, DECOR.faces.nerdy.glb);
  assert.deepEqual(plan.topper, { id: cfg.topper, glb: DECOR.charm.files[cfg.topper].glb, place: charmPlacement(FACE.topper, DECOR.charm.thickness) });
  // the antenna charm sinks by the charm thickness of the decor data, like every charm
  const sunk = faceDataFixture({ topper: { ...FACE.topper, sink: 0.4 } });
  const p = soulDecorPlan(cfg, DECOR, sunk).topper.place;
  assert.deepEqual(p, charmPlacement(sunk.topper, DECOR.charm.thickness));
  const nn = Math.hypot(...FACE.topper.normal);
  assert.ok(near(p.position, FACE.topper.centre.map((c, i) => c - (FACE.topper.normal[i] / nn) * 0.4 * DECOR.charm.thickness * 0.36)));
  assert.equal(p.scale, 0.36);
  // other v3 picks resolve their own files; unknown ids resolve to nothing to draw (not a missing piece)
  const other = soulDecorPlan(v3Config({ plate: 'skull-x', eyes: 'fierce-red', face: 'pirate' }), DECOR, FACE);
  assert.deepEqual([other.plate.glb, other.eyes.glb, other.face.glb], [FACE.plates['skull-x'].glb, FACE.eyes['fierce-red'].glb, FACE.faces.pirate.glb]);
  const unknown = soulDecorPlan(v3Config({ plate: 'nope', eyes: 'nope' }), DECOR, FACE);
  assert.deepEqual([unknown.plate, unknown.eyes, unknown.skipped, unknown.usable], [null, null, [], true]);
  // v2 plans never look at the face data
  for (const face of [FACE, stubFaceData()]) {
    const v2 = soulDecorPlan(v2Config({ face: 'angel' }), DECOR, face);
    assert.deepEqual([v2.plate, v2.eyes, v2.topper, v2.face], [null, null, null, { face: 'angel', glb: DECOR.faces.angel.glb }]);
  }
  assert.equal(soulDecorPlan(v3Config(), { ...DECOR, stub: true }, FACE).reason, 'stub', 'no decor data: the plain gradient Soul');
});

test('v3 decor plan: each missing piece is skipped on its own; unusable face data leaves the charms only, with a reason', () => {
  const cfg = v3Config();
  const T = `topper:${cfg.topper}`;
  const without = (map, key) => Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
  const cases = [
    [faceDataFixture({ plates: without(FACE.plates, 'bean') }), DECOR, ['plate:bean'], 'plate'],
    [faceDataFixture({ eyes: without(FACE.eyes, 'hearts') }), DECOR, ['eyes:hearts'], 'eyes'],
    [faceDataFixture({ faces: without(FACE.faces, 'nerdy') }), DECOR, ['face:nerdy'], 'face'],
    [faceDataFixture({ topper: null }), DECOR, [T], 'topper'],
    [faceDataFixture({ topper: { ...FACE.topper, size: 0 } }), DECOR, [T], 'topper'],
    [FACE, decorFixture({ charm: { thickness: 0.2, files: DECOR.charm.files, missing: [cfg.topper] } }), [T], 'topper'],
    [FACE, decorFixture({ charm: { thickness: 0.2, files: without(DECOR.charm.files, cfg.topper) } }), [T], 'topper'],
  ];
  for (const [face, decor, skipped, piece] of cases) {
    const plan = soulDecorPlan(cfg, decor, face);
    assert.deepEqual([plan.usable, plan.reason, plan.skipped], [true, null, skipped], skipped[0]);
    assert.equal(plan[piece], null);
    for (const k of ['plate', 'eyes', 'face', 'topper'].filter((x) => x !== piece)) assert.ok(plan[k], `${k} stays when ${piece} is missing`);
    assert.equal(plan.charms.length, 10);
  }
  // a missing body charm is skipped on its own too; everything missing at once keeps the paint order
  const partial = soulDecorPlan(cfg, decorFixture({ charm: { thickness: 0.2, files: without(DECOR.charm.files, cfg.charms[3]) } }), FACE);
  assert.deepEqual([partial.skipped, partial.charms.length, !!partial.plate], [[cfg.charms[3]], 9, true]);
  const bare = faceDataFixture({ plates: {}, eyes: {}, faces: {}, topper: null });
  assert.deepEqual(soulDecorPlan(cfg, DECOR, bare).skipped, ['plate:bean', 'eyes:hearts', 'face:nerdy', T]);
  // unusable face data (the stub placeholder, or missing maps): the charms only, and why
  assert.equal(faceDataUsable(FACE), true);
  for (const face of [stubFaceData(), { ...FACE, stub: true }, faceDataFixture({ eyes: null }), faceDataFixture({ plates: undefined }), faceDataFixture({ faces: [] }), null]) {
    assert.equal(faceDataUsable(face), false);
    const plan = soulDecorPlan(cfg, DECOR, face);
    assert.deepEqual([plan.usable, plan.reason, plan.charms.length], [true, 'face-stub', 10]);
    assert.deepEqual([plan.plate, plan.eyes, plan.face, plan.topper], [null, null, null, null], 'no plate, eyes, face kit (not even the v2 kit) or topper');
    assert.deepEqual(plan.skipped, ['plate:bean', 'eyes:hearts', 'face:nerdy', T]);
  }
  const nothing = soulDecorPlan(cfg, decorFixture({ charm: { thickness: 0.2, files: {} } }), stubFaceData());
  assert.deepEqual([nothing.usable, nothing.reason], [false, 'face-stub']);
  assert.deepEqual(soulDecorPlan(cfg, decorFixture({ charm: { thickness: 0.2, files: {} } }), bare).reason, 'no-files');
});

// ---- decor loader ----------------------------------------------------------------------------------------------

test('loadSoulDecor v3: every piece loads once (the antenna charm through the charm cache) and resolves plate / eyes / topper', async () => {
  clearSoulDecorCache();
  const { mods, calls } = stubMods();
  const cfg = v3Config({ face: 'angel' });
  const d = await loadSoulDecor(mods, cfg, { decor: DECOR, face: FACE });
  assert.deepEqual([d.complete, d.partial, d.reason, d.missing], [true, false, null, []]);
  assert.ok(hasDecor(d));
  assert.deepEqual(d.charms.map((c) => [c.slot, c.id]), cfg.charms.map((id, i) => [i, id]));
  assert.deepEqual([d.plate.kind, d.plate.id, d.eyes.kind, d.eyes.id, d.face.face], ['plate', 'bean', 'eyes', 'hearts', 'angel']);
  assert.equal(d.topper.id, cfg.topper);
  assert.equal(d.topper.model.id, cfg.topper, 'a charm model');
  assert.deepEqual(d.topper.place, charmPlacement(FACE.topper, DECOR.charm.thickness));
  assert.ok(calls.includes(FACE.faces.angel.glb) && !calls.includes(DECOR.faces.angel.glb), 'the refitted v3 kit, never the v2 one');
  assert.equal(calls.length, 14, '10 charms + plate + eyes + kit + antenna charm');
  const keys = soulDecorCacheKeys();
  assert.equal(keys.charms.length, 11); assert.ok(keys.charms.includes(DECOR.charm.files[cfg.topper].glb));
  assert.deepEqual([keys.faces, keys.plates, keys.eyes, keys.failed], [[FACE.faces.angel.glb], [FACE.plates.bean.glb], [FACE.eyes.hearts.glb], []]);
  // another Soul with the same pieces: served from the cache, one template per URL
  const again = await loadSoulDecor(mods, v3Config({ face: 'angel', seed: 'another' }), { decor: DECOR, face: FACE });
  assert.equal(calls.length, 14);
  assert.deepEqual([again.plate, again.eyes, again.face, again.topper.model], [d.plate, d.eyes, d.face, d.topper.model]);
  // a Soul whose antenna charm is another Soul's body charm reuses that template
  const own = CHARMS_BY_KIND.technical.slice(10, 20);
  assert.ok(!own.some((id) => cfg.charms.includes(id)));
  const shared = await loadSoulDecor(mods, v3Config({ face: 'angel', charms: own, topper: cfg.charms[0] }), { decor: DECOR, face: FACE });
  assert.equal(calls.length, 24, 'only its 10 new body charms are fetched');
  assert.equal(shared.topper.model, d.charms[0].model);
  // v2 results carry the new keys as null
  const v2 = await loadSoulDecor(mods, v2Config({ face: 'angel' }), { decor: DECOR, face: FACE });
  assert.deepEqual([v2.complete, v2.plate, v2.eyes, v2.topper, v2.face.face], [true, null, null, null, 'angel']);
});

test('loadSoulDecor v3 never rejects: each failing piece is left out on its own; stub face data gives the charms only', async () => {
  const cfg = v3Config();
  const T = `topper:${cfg.topper}`;
  const cases = [['plate-bean.glb', 'plate', 'plate:bean'], ['eyes-hearts.glb', 'eyes', 'eyes:hearts'], ['v3/face-nerdy.glb', 'face', 'face:nerdy'], [`${cfg.topper}.glb`, 'topper', T]];
  for (const [file, piece, key] of cases) {
    clearSoulDecorCache();
    const d = await loadSoulDecor(stubMods({ fail: [file] }).mods, cfg, { decor: DECOR, face: FACE });
    assert.deepEqual([d.complete, d.partial, d.reason, d.missing], [false, true, 'partial', [key]], key);
    assert.equal(d[piece], null);
    for (const k of ['plate', 'eyes', 'face', 'topper'].filter((x) => x !== piece)) assert.ok(d[k], `${k} still loads without ${piece}`);
    assert.equal(d.charms.length, 10);
    assert.match(d.error, /404/);
    assert.ok(soulDecorCacheKeys().failed.some((u) => u.includes(file)), 'the failure is remembered');
  }
  // within the retry window another Soul with that antenna charm does not ask again; after it, it does
  const soon = stubMods();
  const again = await loadSoulDecor(soon.mods, v3Config({ seed: 'b' }), { decor: DECOR, face: FACE });
  assert.deepEqual([again.missing, again.topper], [[T], null]);
  assert.ok(!soon.calls.some((u) => u.includes(`${cfg.topper}.glb`)));
  const later = stubMods();
  const retry = await loadSoulDecor(later.mods, cfg, { decor: DECOR, face: FACE, retryAfterMs: 0 });
  assert.equal(retry.complete, true); assert.deepEqual(later.calls, [DECOR.charm.files[cfg.topper].glb]);
  // the stub face data: charms only (no v2 kit either), and the reason says why
  clearSoulDecorCache();
  const stub = stubMods();
  const plain = await loadSoulDecor(stub.mods, cfg, { decor: DECOR, face: stubFaceData() });
  assert.deepEqual([plain.complete, plain.partial, plain.reason], [false, true, 'face-stub']);
  assert.deepEqual([plain.charms.length, plain.face, plain.plate, plain.eyes, plain.topper], [10, null, null, null, null]);
  assert.deepEqual(plain.missing, ['plate:bean', 'eyes:hearts', 'face:nerdy', T]);
  assert.equal(stub.calls.length, 10, 'only the charms are fetched');
  // nothing loads at all: the plain gradient Soul
  clearSoulDecorCache();
  const none = await loadSoulDecor({ THREE, addons: {} }, cfg, { decor: DECOR, face: FACE, retryAfterMs: 0 });
  assert.deepEqual([none.complete, none.reason, hasDecor(none), none.missing.length], [false, 'load-failed', false, 14]);
  // hasDecor counts every piece
  const blank = { charms: [], face: null, plate: null, eyes: null, topper: null };
  assert.equal(hasDecor(blank), false);
  for (const k of ['face', 'plate', 'eyes', 'topper']) assert.equal(hasDecor({ ...blank, [k]: {} }), true, k);
});

// ---- plate / eyes models ---------------------------------------------------------------------------------------

/** A tiny binary glTF: one triangle drawn twice, with a COLOR_0 gradient part flagged emissiveFromVertexColor and a wall. */
function tinyEyesGlb() {
  const bin = Buffer.alloc(128);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4));
  [0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((v, i) => bin.writeFloatLE(v, 36 + i * 4));
  [1, 0.2, 0.2, 1, 0.2, 1, 0.2, 1, 0.2, 0.2, 1, 1].forEach((v, i) => bin.writeFloatLE(v, 72 + i * 4));
  [0, 1, 2].forEach((v, i) => bin.writeUInt16LE(v, 120 + i * 2));
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'eyes-test', mesh: 0, translation: [0, 1.17, 0.39], scale: [0.25, 0.25, 0.25] }],
    meshes: [{ primitives: [
      { attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 },
      { attributes: { POSITION: 0, NORMAL: 1 }, indices: 3, material: 1 },
    ] }],
    materials: [
      { name: 'base_eye_top', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.4 }, emissiveFactor: [0.25, 0.25, 0.25], extras: { emissiveFromVertexColor: true } },
      { name: 'base_eye_wall', pbrMetallicRoughness: { baseColorFactor: [0.1, 0.1, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.4 }, emissiveFactor: [0.1, 0.1, 0.1] },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 }, { buffer: 0, byteOffset: 36, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 72, byteLength: 48, target: 34962 }, { buffer: 0, byteOffset: 120, byteLength: 6, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
  const glb = Buffer.concat([head, chunk(0x4e4f534a, text), chunk(0x004e4942, bin)]);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
}

/** Runs a material's onBeforeCompile on the real physical shader source; returns the patched fragment shader. */
function compiledFragment(mat) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  mat.onBeforeCompile(shader, null);
  return shader.fragmentShader;
}

test('plate / eyes models: authored emissive (no face-glow boost); emissiveFromVertexColor multiplies it by the vertex colour', async () => {
  // GLTFLoader copies material extras to userData (the flag survives its vertex-colour material clone)
  const gltf = await new Promise((resolve, reject) => new loaders.GLTFLoader().parse(tinyEyesGlb(), '', resolve, reject));
  const part = extractFacePartModel(THREE, gltf, 'eyes', 'hearts');
  assert.deepEqual([part.kind, part.id, part.scene], ['eyes', 'hearts', gltf.scene]);
  assert.ok(Object.isFrozen(part));
  const mats = meshes(part.scene).map((m) => m.material);
  const top = mats.find((m) => m.name === 'base_eye_top'), wall = mats.find((m) => m.name === 'base_eye_wall');
  assert.deepEqual([top.userData.emissiveFromVertexColor, top.vertexColors, wall.vertexColors], [true, true, false]);
  for (const m of mats) assert.equal(m.emissiveIntensity, 1, `${m.name}: no FACE_GLOW_INTENSITY boost`);
  assert.equal(top.customProgramCacheKey(), EMISSIVE_FROM_VERTEX_COLOR_KEY, 'its own program');
  assert.notEqual(wall.customProgramCacheKey(), EMISSIVE_FROM_VERTEX_COLOR_KEY);
  assert.ok(!Object.hasOwn(wall, 'onBeforeCompile'), 'an unflagged part is untouched');
  // the one line, right after <emissivemap_fragment> (guarded like three's colour chunk)
  const frag = compiledFragment(top);
  const at = frag.indexOf('#include <emissivemap_fragment>');
  assert.equal(frag.indexOf('#include <emissivemap_fragment>', at + 1), -1);
  assert.equal(frag.slice(at).split('\n').slice(0, 4).join('\n'), `#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )\n\t${EMISSIVE_FROM_VERTEX_COLOR}\n#endif`);
  assert.equal(EMISSIVE_FROM_VERTEX_COLOR, 'totalEmissiveRadiance *= vColor.rgb;');
  assert.equal(frag.split(EMISSIVE_FROM_VERTEX_COLOR).length, 2, 'exactly once');
  // a plate from the stub loader: nothing flagged, nothing patched; a face kit still glows at FACE_GLOW_INTENSITY
  clearSoulDecorCache();
  const d = await loadSoulDecor(stubMods().mods, v3Config({ face: 'angel' }), { decor: DECOR, face: FACE });
  for (const m of meshes(d.plate.scene)) assert.ok(!Object.hasOwn(m.material, 'onBeforeCompile'));
  const flagged = meshes(d.eyes.scene).map((m) => m.material).filter((m) => m.userData.emissiveFromVertexColor);
  assert.equal(flagged.length, 1); assert.equal(flagged[0].customProgramCacheKey(), EMISSIVE_FROM_VERTEX_COLOR_KEY);
  assert.ok(meshes(d.eyes.scene).every((m) => m.material.emissiveIntensity === 1));
  assert.ok(meshes(d.face.scene).some((m) => m.material.emissiveIntensity === FACE_GLOW_INTENSITY), 'the v3 halo keeps its glow');
  assert.throws(() => extractFacePartModel(THREE, {}, 'plate', 'x'), /plate x has no mesh/);
  assert.throws(() => extractFacePartModel(THREE, { scene: new THREE.Group() }, 'eyes', 'y'), /eyes y has no mesh/);
  assert.ok(extractFaceModel(THREE, { scene: node(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ emissive: 0xffffff }))) }, 'angel'));
});

// ---- figure and rig ----------------------------------------------------------------------------------------------

test('figure v3: gradient tint, no orb glow sprite and no orb emissive, one body shader with v2', async () => {
  const hero = await baseline('hero'), lite = await baseline('lite');
  const glowTexture = new THREE.Texture();
  const cfg = v3Config({ gradient: 4 });
  const fig = buildSoulFigure(THREE, { body: hero, hull: lite, config: cfg, glowTexture });
  assert.equal(fig.look.version, 3);
  assert.deepEqual(Buffer.from(fig.body.geometry.attributes.color.array.buffer), Buffer.from(tintGradientColors(hero.mask, hero.heights, GRADIENTS[4]).buffer), 'the v2 gradient maths');
  const colours = figureColours({ config: cfg });
  assert.deepEqual([colours.v2, colours.v3, colours.gradient], [true, true, GRADIENTS[4]]);
  assert.deepEqual([figureColours({ config: v2Config() }).v3, figureColours({ palette: { fill: '#000000' } }).v3], [false, false]);
  assert.equal(fig.orbSprite, null, 'no orb, no glow sprite');
  let orbMeshes = 0; fig.model.traverse((o) => { if (o.isSprite) orbMeshes++; });
  assert.equal(orbMeshes, 0);
  const v2 = buildSoulFigure(THREE, { body: hero, hull: lite, config: v2Config({ gradient: 4 }), glowTexture });
  assert.ok(v2.orbSprite, 'a v2 Soul keeps its orb glow');
  // the orb emissive: zero for v3 at any feature opacity (even on a mesh whose mask still has an orb), lit for v2
  const orbOf = (f) => { const s = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader }; f.materials.body.onBeforeCompile(s); return s.uniforms.uOrbGlow.value; };
  const u3 = orbOf(fig), u2 = orbOf(v2);
  assert.deepEqual(u3.toArray(), [0, 0, 0]);
  fig.setOpacity(1, 1); assert.deepEqual(u3.toArray(), [0, 0, 0]);
  fig.setOpacity(0.4, 0.7); assert.deepEqual(u3.toArray(), [0, 0, 0]);
  assert.ok(u2.x + u2.y + u2.z > 0);
  assert.equal(fig.materials.body.customProgramCacheKey(), v2.materials.body.customProgramCacheKey(), 'one body program for every Soul');
  fig.dispose(); v2.dispose();
});

test('figure v3 decorations: plate / eyes / kit at identity, the antenna charm at its slot, draw order, fade, clear and dispose', async () => {
  clearSoulDecorCache();
  const hero = await baseline('hero'), lite = await baseline('lite');
  const cfg = v3Config({ face: 'angel', gradient: 2 });
  const decor = await loadSoulDecor(stubMods().mods, cfg, { decor: DECOR, face: FACE });
  const fig = buildSoulFigure(THREE, { body: hero, hull: lite, config: cfg, decor });
  fig.root.updateMatrixWorld(true);
  assert.equal(fig.charms.length, 10);
  const identity = (o) => o.position.equals(new THREE.Vector3()) && o.quaternion.equals(new THREE.Quaternion()) && o.scale.equals(new THREE.Vector3(1, 1, 1));
  for (const [o, name, order] of [[fig.plate, 'plate:bean', RENDER_ORDER.plate], [fig.eyes, 'eyes:hearts', RENDER_ORDER.eyes], [fig.face, 'face:angel', RENDER_ORDER.face]]) {
    assert.equal(o.parent, fig.model, `${name} in model space`);
    assert.equal(o.name, name);
    assert.ok(identity(o), `${name} at identity`);
    for (const m of meshes(o)) assert.equal(m.renderOrder, order, name);
  }
  // the antenna charm: a holder with the slot placement, like a body charm
  const holder = fig.topper, place = decor.topper.place;
  assert.deepEqual([holder.parent, holder.name], [fig.model, `topper:${cfg.topper}`]);
  assert.ok(near(holder.position.toArray(), place.position) && near(holder.quaternion.toArray(), place.quaternion));
  assert.deepEqual(holder.scale.toArray(), [place.scale, place.scale, place.scale]);
  assert.deepEqual(place, charmPlacement(FACE.topper, DECOR.charm.thickness));
  const world = new THREE.Vector3().setFromMatrixPosition(holder.matrixWorld);
  assert.ok(world.distanceTo(new THREE.Vector3(...place.position).add(new THREE.Vector3(0, -hero.landmarks.floor, 0)).multiplyScalar(fig.fit)) < 1e-9);
  for (const m of meshes(holder)) assert.equal(m.renderOrder, RENDER_ORDER.topper);
  // draw order: body < charms and topper < plate < eyes < face kit
  const R = RENDER_ORDER;
  assert.ok(R.body < R.charm && R.charm === R.topper && R.topper < R.plate && R.plate < R.eyes && R.eyes < R.face);
  assert.equal(fig.body.renderOrder, R.body);
  // own materials (the phone): clones that keep the eyes' emissive patch; the templates stay untouched
  const tmplTop = meshes(decor.eyes.scene).find((m) => m.material.userData.emissiveFromVertexColor).material;
  const ownTop = meshes(fig.eyes).find((m) => m.material.userData.emissiveFromVertexColor).material;
  assert.notEqual(ownTop, tmplTop);
  assert.equal(ownTop.onBeforeCompile, tmplTop.onBeforeCompile);
  assert.equal(ownTop.customProgramCacheKey(), EMISSIVE_FROM_VERTEX_COLOR_KEY, 'the clone keeps the patch');
  assert.ok(compiledFragment(ownTop).includes(EMISSIVE_FROM_VERTEX_COLOR));
  // the features fade: every decoration layer follows orbO
  fig.setOpacity(1, 0.5);
  const decoMeshes = [...fig.charms, fig.topper, fig.plate, fig.eyes, fig.face].flatMap(meshes);
  assert.ok(decoMeshes.length >= 16 && decoMeshes.every((m) => m.material.opacity === 0.5 && m.material.transparent));
  assert.equal(tmplTop.opacity, 1); assert.equal(tmplTop.transparent, false);
  // a late decoration joins at the current feature opacity; a partial one draws what loaded; null clears everything
  const late = buildSoulFigure(THREE, { body: lite, hull: lite, config: cfg });
  late.setOpacity(1, 0.25);
  assert.equal(late.setDecor({ charms: [], face: null, plate: decor.plate, eyes: null, topper: decor.topper }), true);
  assert.deepEqual([late.charms.length, !!late.plate, late.eyes, late.face, !!late.topper], [0, true, null, null, true]);
  assert.ok([late.plate, late.topper].flatMap(meshes).every((m) => m.material.opacity === 0.25));
  assert.equal(late.setDecor(null), false);
  assert.deepEqual([late.plate, late.eyes, late.face, late.topper, late.charms.length], [null, null, null, null, 0]);
  assert.deepEqual(late.model.children.map((c) => c.type), ['Mesh', 'Mesh'], 'only the body and the hull are left');
  // dispose frees this Soul's own materials only
  let disposed = 0;
  for (const m of decoMeshes) m.material.addEventListener('dispose', () => { disposed++; });
  fig.dispose(); late.dispose();
  assert.equal(disposed, decoMeshes.length);
  assert.ok(meshes(decor.plate.scene)[0].geometry.attributes.position.array.length > 0, 'the cached templates stay usable');
  // shared materials (the Galaxy card): the template materials themselves, nothing to release per Soul
  const card = buildSoulFigure(THREE, { body: lite, hull: lite, config: cfg, decor, decorMaterials: 'shared' });
  assert.equal(meshes(card.eyes).find((m) => m.material.userData.emissiveFromVertexColor).material, tmplTop);
  card.dispose();
});

test('rig: the medallion Bingo Star for v3 Souls as for v2; v1 keeps the plain star', async () => {
  const hero = await baseline('hero'), lite = await baseline('lite');
  const rigs = [v3Config({ gradient: 7 }), v2Config(), { seed: 'x', palette: 2 }].map((config) => buildSoulRig(THREE, { body: hero, hull: lite, config, badge: 'bingo-star' }));
  assert.deepEqual(rigs.map((r) => r.badge.group.children.length), [5, 5, 2], 'star + hull (+ medallion disc, ring and die-cut)');
  assert.equal(rigs[0].colors.glow, GRADIENTS[7].glow);
  assert.equal(rigs[0].figure.orbSprite, null);
  for (const r of rigs) r.dispose();
});
