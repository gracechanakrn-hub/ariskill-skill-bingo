// node --test apps/employee-mobile/test - the baseline Soul model path in Node (no DOM, no WebGL): the vendored GLTFLoader
// parses the shipped GLBs, extractSoulModel keeps the mask + landmarks + real bounds, and buildSoulFigure assembles the
// tinted clay body, the lite die-cut hull and the orb glow uniforms exactly as the phone scenes use them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as THREE from '../../../packages/vendor/three/index.js';
import * as addons from '../../../packages/vendor/three/addons.js';
import * as loaders from '../../../packages/vendor/three/loaders.js';
import { extractSoulModel, buildSoulFigure, readLandmarks, LOOK, OUTLINE } from '../src/scene/soul-model.js';
import { tintColors } from '../src/scene/soul-tint.js';
import { BASELINE, baselineParams, mascotPalette } from '../src/scene/soul-params.js';
import { soulModelUrl, ASSETS } from '../../../packages/ui/asset-map.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fileFor = (url) => join(ROOT, url.replace(/^\//, ''));

function parse(url) {
  const buf = readFileSync(fileFor(url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => new loaders.GLTFLoader().parse(ab, '', resolve, reject));
}
const models = {};
async function model(lod) {
  if (!models[lod]) models[lod] = extractSoulModel(THREE, await parse(soulModelUrl(lod)), lod);
  return models[lod];
}

test('vendored loaders export GLTFLoader (addons stay post-processing only); VENDOR.json pins its files by sha256; the vendor tree stays under 3 MB', () => {
  assert.equal(typeof loaders.GLTFLoader, 'function');
  assert.equal(addons.GLTFLoader, undefined, 'the public Galaxy imports addons.js and must not pull the loader in');
  assert.deepEqual(Object.keys(addons).sort(), ['EffectComposer', 'OutputPass', 'RenderPass', 'ShaderPass', 'UnrealBloomPass']);
  const vendor = JSON.parse(readFileSync(join(ROOT, 'packages/vendor/three/VENDOR.json'), 'utf8'));
  assert.equal(vendor.version, '0.186.0');
  for (const f of ['examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/utils/SkeletonUtils.js', 'build/three.module.js']) {
    const entry = vendor.files.find((e) => e.path === `packages/vendor/three/${f}`);
    assert.ok(entry, `${f} listed`);
    assert.equal(createHash('sha256').update(readFileSync(join(ROOT, entry.path))).digest('hex'), entry.sha256, `${f} sha256`);
  }
  let bytes = 0;
  const walk = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else bytes += statSync(p).size; } };
  walk(join(ROOT, 'packages/vendor'));
  assert.ok(bytes <= 3 * 1024 * 1024, `vendor ${bytes} bytes`);
});

test('the asset map resolves both LODs and GLTFLoader parses them (KHR_mesh_quantization, RGBA mask, landmarks)', async () => {
  assert.equal(soulModelUrl('hero'), '/assets/souls/baseline/soul-baseline-hero.glb');
  assert.equal(soulModelUrl('lite'), ASSETS.souls.baseline.lite);
  for (const lod of ['hero', 'lite']) {
    const gltf = await parse(soulModelUrl(lod));
    const mesh = gltf.scene.children.find((o) => o.isMesh);
    assert.ok(mesh, `${lod} mesh`);
    const { position, normal, color } = mesh.geometry.attributes;
    assert.ok(position.normalized && normal.normalized, 'quantised attributes stay normalised (int16 / int8)');
    assert.equal(color.itemSize, 4); assert.ok(color.normalized); assert.ok(color.array instanceof Uint8Array);
    assert.equal(mesh.geometry.index.count, ASSETS.souls.baseline.triangles[lod] * 3);
    // GLTFLoader builds its bounds from the accessor min/max: the box must equal the data's box, and its sphere (the
    // box's circumsphere) must contain every vertex. With pre-normalised float min/max both collapsed to ~1e-5.
    const loaderBox = mesh.geometry.boundingBox.clone(), loaderSphere = mesh.geometry.boundingSphere.clone();
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
    assert.ok(loaderBox.min.distanceTo(mesh.geometry.boundingBox.min) < 1e-4 && loaderBox.max.distanceTo(mesh.geometry.boundingBox.max) < 1e-4, `${lod}: GLTFLoader box equals the data box`);
    assert.ok(loaderSphere.radius >= mesh.geometry.boundingSphere.radius - 1e-6 && loaderSphere.radius > 0.9, `${lod}: GLTFLoader sphere (${loaderSphere.radius}) contains the data`);
    assert.ok(gltf.asset.extras.landmarks.orb.radius > 0);
  }
});

test('extractSoulModel keeps the mask, landmarks and node transform, and recomputes real bounds', async () => {
  const hero = await model('hero');
  assert.equal(hero.lod, 'hero'); assert.equal(hero.count, 12002);
  assert.equal(hero.mask.length, hero.count * 4);
  assert.ok(hero.mask.every((v) => v >= 0 && v <= 1));
  const orb = []; for (let i = 0; i < hero.count; i++) if (hero.mask[i * 4 + 3] > 0.3) orb.push(hero.mask[i * 4 + 3]);
  assert.ok(orb.length > 700 && orb.length < 900, `orb vertices ${orb.length}`);
  assert.ok(Math.abs(orb[0] - 128 / 255) < 1e-6, 'orb mask peaks at 0.502 on the surface (a 50 % mix toward highlight)');
  assert.ok(hero.geometry.boundingSphere.radius > 0.9 && hero.geometry.boundingSphere.radius < 1.2, `local radius ${hero.geometry.boundingSphere.radius}`);
  assert.ok(Math.abs(hero.scale.x - 1.1456) < 1e-3 && Math.abs(hero.position.y - 1.1236) < 1e-3, 'node TRS carries the dequantisation');
  assert.equal(hero.landmarks.height, 2.29087); assert.equal(hero.landmarks.floor, -0.02189);
  assert.deepEqual(hero.landmarks.badgeAnchor, [0.405, 1.62, -0.065]);
  assert.equal(hero.landmarks.eyes.length, 2);
  // defaults when a file lost its extras (the scene still frames the v1 character)
  const d = readLandmarks(undefined);
  assert.equal(d.height, 2.29087); assert.deepEqual(d.orb.centre, [0.105, 2.1, -0.065]); assert.equal(d.eyes.length, 0);
  assert.deepEqual(readLandmarks({ landmarks: { height: -1, orb: { centre: [1, 'x', 2] } } }).orb.centre, [0.105, 2.1, -0.065]);
});

test('buildSoulFigure: tinted body (shared buffers, own colours), lite die-cut hull, orb glow, fit to the old framing', async () => {
  const hero = await model('hero'), lite = await model('lite');
  const P = baselineParams({ seed: 'soul_1', palette: 'lagoon', glow: 'halo' }, 'bingo-star');
  const fig = buildSoulFigure(THREE, { body: hero, hull: lite, palette: P.hex, quality: 'high', fitHeight: BASELINE.fitHeight, outline: 0.03, orbGlowStrength: BASELINE.orbGlow });
  assert.ok(Math.abs(fig.fit - BASELINE.fitHeight / hero.landmarks.height) < 1e-12);
  assert.equal(fig.root.scale.x, fig.fit); assert.equal(fig.model.position.y, -hero.landmarks.floor, 'feet on the origin');
  const g = fig.body.geometry;
  assert.equal(g.attributes.position, hero.geometry.attributes.position, 'position buffer shared with the cached model');
  assert.equal(g.index, hero.geometry.index);
  assert.equal(g.attributes.color.itemSize, 3);
  assert.deepEqual(Buffer.from(g.attributes.color.array.buffer), Buffer.from(tintColors(hero.mask, P.hex).buffer), 'colours = soul-tint output');
  assert.equal(g.attributes.soulGlow.count, hero.count);
  const m = fig.materials.body;
  assert.ok(m.isMeshPhysicalMaterial && m.vertexColors); assert.equal(m.clearcoat, 0.8); assert.ok(m.roughness < 0.4); assert.ok(m.sheen > 0);
  assert.equal(fig.body.position.y, hero.position.y);
  const h = fig.materials.hull;
  assert.equal(h.side, THREE.BackSide); assert.equal(h.depthWrite, false); assert.equal(fig.hull.renderOrder, -1);
  assert.equal(fig.hull.geometry.attributes.position, lite.geometry.attributes.position, 'die-cut from the lite LOD');
  assert.ok(Math.abs(h.uniforms.uThickness.value - 0.03 / lite.scale.x) < 1e-9);
  const white = new THREE.Color(OUTLINE).multiplyScalar(LOOK.outlineLevel);
  assert.ok(h.uniforms.uColor.value.equals(white));
  fig.setOutline(1.7); assert.ok(Math.abs(h.uniforms.uThickness.value - 1.7 * 0.03 / lite.scale.x) < 1e-9);
  fig.setOpacity(0.5, 0.25);
  assert.equal(m.opacity, 0.5); assert.equal(h.uniforms.uOpacity.value, 0.5);
  // low tier: no clearcoat; the mascot path uses the lite LOD for both
  const low = buildSoulFigure(THREE, { body: lite, hull: lite, palette: mascotPalette(), quality: 'low' });
  assert.equal(low.materials.body.clearcoat, 0);
  assert.notDeepEqual(Buffer.from(low.body.geometry.attributes.color.array.buffer).subarray(0, 64), Buffer.from(tintColors(lite.mask, P.hex).buffer).subarray(0, 64), 'lilac mascot differs from lagoon');
  fig.dispose(); low.dispose();
  assert.ok(hero.geometry.attributes.position.array.length > 0, 'disposing a figure leaves the cached model intact');
});
