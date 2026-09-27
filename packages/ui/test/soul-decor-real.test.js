// The delivered decoration data and models as the renderers consume them (D-29, tools/ai/blender/soul_decor.py output):
// one charm size for every slot (BR-17), front2d on the model -> viewBox map, a partial catalog skipped per charm
// (charm.missing), charm GLBs whose node TRS is the dequantisation and whose texture loads by relative URI, face kits
// in model space with the halo glowing at FACE_GLOW_INTENSITY and the blush blended from vertex alpha. Skipped while
// packages/ui/soul-decor-data.js is still the hand-written stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as THREE from '../../vendor/three/index.js';
import * as loaders from '../../vendor/three/loaders.js';
import { SOUL_DECOR } from '../soul-decor-data.js';
import { soulSpriteLayers, decorUsable } from '../soul-renderer.js';
import { soulDecorPlan, extractCharmModel, extractFaceModel, FACE_GLOW_INTENSITY } from '../soul3d/decor.js';
import { buildSoulFigure, RENDER_ORDER } from '../soul3d/figure.js';
import { extractSoulModel } from '../soul3d/model.js';
import { charmPlacement } from '../soul3d/placement.js';
import { CHARMS, FACES } from '../../game-rules/src/soul-catalog.js';
import { soulModelUrl } from '../asset-map.js';
import { v2Config } from './decor-fixture.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const skip = SOUL_DECOR.stub === true ? 'soul-decor-data.js is still the stub' : false;
const fileOf = (url) => join(ROOT, url.split('?')[0].replace(/^\//, ''));
const glbJson = (url) => { const b = readFileSync(fileOf(url)); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')); };
function parse(url, path = '') {
  const buf = readFileSync(fileOf(url));
  return new Promise((resolve, reject) => new loaders.GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path, resolve, reject));
}
/** Just enough of an <img> for three's ImageLoader in Node: records the URL and "loads" it. */
function withFakeImages(fn) {
  const urls = [];
  const hadSelf = 'self' in globalThis;
  if (!hadSelf) globalThis.self = globalThis; // GLTFLoader reads self.URL
  globalThis.document = { createElementNS: () => {
    const listeners = {};
    return { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: () => {}, set src(u) { urls.push(u); this._src = u; setTimeout(() => listeners.load && listeners.load.call(this), 1); }, get src() { return this._src; }, width: 128, height: 128 };
  } };
  return fn(urls).finally(() => { delete globalThis.document; if (!hadSelf) delete globalThis.self; });
}

test('decor data contract: one charm size and seat for every slot, front2d on the model -> viewBox map, files + missing = the catalog', { skip }, () => {
  assert.equal(decorUsable(SOUL_DECOR), true);
  const S = SOUL_DECOR.slots;
  assert.equal(S.length, 10);
  assert.equal(new Set(S.map((s) => s.size)).size, 1, 'BR-17: one charm size');
  assert.equal(new Set(S.map((s) => s.sink)).size, 1);
  assert.equal(new Set(S.map((s) => s.front2d.r)).size, 1);
  const m = SOUL_DECOR.sprite2d.map, T = SOUL_DECOR.charm.thickness;
  for (const s of S) {
    // front2d is where the seated charm's front face shows in the front view: centre + normal * (1 - sink) * thickness * size
    const n = Math.hypot(...s.normal), out = (1 - s.sink) * T * s.size;
    const fx = s.centre[0] + (s.normal[0] / n) * out, fy = s.centre[1] + (s.normal[1] / n) * out;
    assert.ok(Math.abs(s.front2d.x - (m.x0 + m.sx * fx)) < 0.15 && Math.abs(s.front2d.y - (m.y0 + m.sy * fy)) < 0.15, `slot ${s.index} front2d`);
    assert.ok(Math.abs(s.front2d.r - (s.size * m.sx) / 2) < 0.01);
    const p = charmPlacement(s, SOUL_DECOR.charm.thickness);
    assert.ok(p && p.basis.z[2] > 0, `slot ${s.index} faces the front`);
  }
  const files = Object.keys(SOUL_DECOR.charm.files), missing = SOUL_DECOR.charm.missing || [];
  assert.deepEqual([...files, ...missing].sort(), CHARMS.map((c) => c.id).sort());
  assert.ok(missing.every((id) => !files.includes(id)));
  for (const id of files) {
    const f = SOUL_DECOR.charm.files[id];
    assert.ok(existsSync(fileOf(f.glb)) && existsSync(fileOf(f.png)), `${id} files on disk`);
  }
  for (const face of FACES) assert.ok(existsSync(fileOf(SOUL_DECOR.faces[face].glb)) && existsSync(fileOf(SOUL_DECOR.faces[face].sprite)), face);
});

test('a partial catalog is skipped per charm, in 3D and in 2D: a missing soft charm never breaks the Soul', { skip }, () => {
  const missing = SOUL_DECOR.charm.missing || [];
  if (!missing.length) return;
  const cfg = v2Config({ face: 'angel' });
  const charms = cfg.charms.slice(); charms[6] = missing[0];
  const plan = soulDecorPlan({ ...cfg, charms });
  assert.equal(plan.usable, true);
  assert.deepEqual(plan.skipped, [missing[0]]);
  assert.equal(plan.charms.length, 9); assert.ok(!plan.charms.some((c) => c.id === missing[0]));
  const layers = soulSpriteLayers({ ...cfg, charms });
  assert.equal(layers.length, 10, 'face sprite + nine charm sprites');
  assert.ok(!layers.some((l) => l.id === missing[0]));
  for (const l of layers.filter((x) => x.kind === 'charm')) assert.equal(l.w, 2 * SOUL_DECOR.slots[l.slot].front2d.r, 'drawn 2r wide');
  assert.deepEqual(layers[0], { kind: 'face', face: 'angel', href: SOUL_DECOR.faces.angel.sprite, x: 0, y: 0, w: 200, h: 200 });
});

test('charm GLBs: node TRS = the dequantisation (placement goes on a parent), texture by relative URI, base + emissive the same map', { skip }, async () => {
  const ids = Object.keys(SOUL_DECOR.charm.files).filter((_, i) => i % 29 === 0);
  for (const id of ids) {
    const j = glbJson(SOUL_DECOR.charm.files[id].glb);
    assert.equal(j.nodes.length, 1); assert.ok(j.nodes[0].scale && j.nodes[0].translation, `${id} node TRS`);
    const mat = j.materials[0];
    assert.equal(j.images[0].uri, `${id}.png`);
    assert.equal(mat.pbrMetallicRoughness.baseColorTexture.index, mat.emissiveTexture.index);
  }
  await withFakeImages(async (urls) => {
    const id = ids[0];
    const gltf = await parse(SOUL_DECOR.charm.files[id].glb, '/assets/souls/charms/');
    const model = extractCharmModel(THREE, gltf, id);
    let mesh = null; model.scene.traverse((o) => { if (o.isMesh) mesh = o; });
    assert.ok(mesh.material.map && mesh.material.emissiveMap === mesh.material.map);
    assert.equal(mesh.material.map.colorSpace, THREE.SRGBColorSpace);
    assert.deepEqual(urls, [`/assets/souls/charms/${id}.png`], 'resolved next to the GLB');
    assert.ok(mesh.parent !== model.scene || !mesh.scale.equals(new THREE.Vector3(1, 1, 1)), 'the dequantising node transform is kept inside the template');
  });
});

test('face kits: model space at identity, the halo glows at FACE_GLOW_INTENSITY, the blush blends from vertex alpha after the body', { skip }, async () => {
  const hero = extractSoulModel(THREE, await parse(soulModelUrl('hero')), 'hero');
  for (const face of FACES) {
    const kit = extractFaceModel(THREE, await parse(SOUL_DECOR.faces[face].glb), face);
    const mats = []; kit.scene.traverse((o) => { if (o.isMesh) mats.push([o, o.material]); });
    assert.ok(mats.length >= 3, `${face} parts`);
    for (const [o, mat] of mats) {
      const glowing = mat.emissive.r + mat.emissive.g + mat.emissive.b > 0;
      assert.equal(mat.emissiveIntensity, glowing ? FACE_GLOW_INTENSITY : 1, `${face} ${mat.name}`);
      if (mat.transparent) { assert.equal(mat.depthWrite, false); assert.equal(mat.vertexColors, true); assert.equal(o.geometry.attributes.color.itemSize, 4, 'alpha in COLOR_0'); }
    }
    if (face === 'angel') { assert.ok(mats.some(([, m]) => m.name === 'halo' && m.emissiveIntensity === FACE_GLOW_INTENSITY)); assert.ok(mats.some(([, m]) => m.name === 'blush' && m.transparent)); }
    const fig = buildSoulFigure(THREE, { body: hero, hull: hero, config: v2Config({ face }), decor: { complete: true, charms: [], face: kit } });
    assert.equal(fig.face.parent, fig.model); assert.ok(fig.face.position.equals(new THREE.Vector3()) && fig.face.scale.equals(new THREE.Vector3(1, 1, 1)));
    fig.face.traverse((o) => { if (o.isMesh) assert.equal(o.renderOrder, RENDER_ORDER.face, 'after the body'); });
    fig.dispose();
  }
});
