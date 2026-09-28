// packages/ui/soul3d idle micro actions on the rig (stage 15, D-36), in Node with the shipped bodies and stub decoration
// models: rigs without actions are exactly today's rigs (no skeleton, no skinned mesh, the plain die-cut shader); an
// acting rig at rest draws exactly what a plain rig draws (the same visible meshes, buffers, materials and bit-identical
// world matrices), also after an action, so the hand-off to a baked impostor is seamless; while acting, the skinned
// twins of the body and the die-cut deform with the bones, the charms ride their dominant bone, plate / face kit /
// antenna charm / orb ride the head, the eye halves ride the eye bones (a wink squashes one of them) and the turn yaws
// the figure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as THREE from '../../vendor/three/index.js';
import * as loaders from '../../vendor/three/loaders.js';
import { extractSoulModel } from '../soul3d/model.js';
import { buildSoulRig } from '../soul3d/rig.js';
import { buildSoulFigure, RENDER_ORDER } from '../soul3d/figure.js';
import { loadSoulDecor, clearSoulDecorCache } from '../soul3d/decor.js';
import { SOUL_BONES, dominantBone, boneWeights, bonePivots } from '../soul3d/skeleton.js';
import { REST_POSE, SOUL_ACTIONS, actionPose, actionDuration } from '../soul3d/actions.js';
import { soulModelUrl } from '../asset-map.js';
import { SOUL_FACE } from '../soul-face-data.js';
import { decorFixture, faceDataFixture, v2Config, v3Config } from './decor-fixture.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DECOR = decorFixture(), FACE = faceDataFixture();
const PLAIN_HULL_VERTEX = 'uniform float uThickness;\nvoid main() {\n\tvec3 p = position + normalize(normal) * uThickness;\n\tgl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);\n}';
const parse = (url) => { const b = readFileSync(join(ROOT, url.split('?')[0].replace(/^\//, ''))); return new Promise((res, rej) => new loaders.GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej)); };
const models = {};
/** The shipped bodies: the v3 body when the face data is built, and the baseline. */
async function bodies(variant) {
  if (!models[variant]) {
    const v3 = variant === 'v3' && SOUL_FACE.stub !== true && SOUL_FACE.body;
    const url = (lod) => (v3 ? SOUL_FACE.body[lod] : soulModelUrl(lod));
    models[variant] = { body: extractSoulModel(THREE, await parse(url('hero')), 'hero', variant), hull: extractSoulModel(THREE, await parse(url('lite')), 'lite', variant) };
  }
  return models[variant];
}
const meshes = (o) => { const out = []; o.traverse((x) => { if (x.isMesh) out.push(x); }); return out; };

/** Two eye discs at x = +-0.145 in model space, in one geometry (like a real eyes GLB: one primitive per colour). */
function twoDiscs() {
  const a = new THREE.CircleGeometry(0.2, 12).translate(0.58, 0, 0), b = new THREE.CircleGeometry(0.2, 12).translate(-0.58, 0, 0);
  const g = new THREE.BufferGeometry(), n = a.attributes.position.count;
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([...a.attributes.normal.array, ...b.attributes.normal.array], 3));
  g.setIndex([...a.index.array, ...Array.from(b.index.array, (i) => i + n)]);
  return g;
}
/** A stand-in for GLTFLoader: textured charm discs; plate, eyes (both eyes in one mesh) and kits under a dequantising node. */
function stubMods() {
  class GLTFLoader {
    load(url, onLoad) {
      const path = url.split('?')[0], scene = new THREE.Group();
      const node = new THREE.Group(); node.position.set(0, 1.175, 0.39); node.scale.setScalar(0.25); scene.add(node);
      if (path.includes('/charms/')) { scene.remove(node); const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 12); geo.rotateX(Math.PI / 2); scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: new THREE.Texture() }))); }
      else if (/\/eyes-/.test(path)) node.add(new THREE.Mesh(twoDiscs(), new THREE.MeshStandardMaterial({ color: 0x223344, name: 'eyes' })));
      else node.add(new THREE.Mesh(new THREE.CircleGeometry(0.9, 16), new THREE.MeshStandardMaterial({ color: 0xf7f8ff, name: path.split('/').pop() })));
      setTimeout(() => onLoad({ scene, asset: {} }), 1);
    }
  }
  return { THREE, addons: { GLTFLoader } };
}
async function decorFor(config) { clearSoulDecorCache(); return loadSoulDecor(stubMods(), config, { decor: DECOR, face: FACE }); }

/** A geometry by content (per-rig geometries such as the badge's differ in uuid only): count, index, position sum. */
function geometryKey(g) {
  const p = g.attributes.position.array;
  let sum = 0; for (let i = 0; i < p.length; i++) sum += p[i] * ((i % 7) + 1);
  return `${g.attributes.position.count}:${g.index ? g.index.count : 0}:${sum}`;
}
/**
 * What a renderer would draw from a rig: every visible mesh / sprite (all ancestors visible) as a signature of its kind,
 * render order, geometry (the shared body / hull buffers by name), material and bit-exact world matrix. Sorted, so the
 * scene-graph layout (anchors) does not matter, only what is drawn and where.
 */
function draws(rig, { body, hull }) {
  rig.soul.updateMatrixWorld(true);
  const out = [];
  const visit = (o) => {
    if (!o.visible) return;
    if (o.isMesh || o.isSprite) {
      const pos = o.geometry.attributes.position;
      const geo = pos === body.geometry.attributes.position ? 'body' : pos === hull.geometry.attributes.position ? 'hull' : geometryKey(o.geometry);
      const m = o.material;
      out.push([o.type, o.renderOrder, geo, o.geometry.index ? o.geometry.index.count : pos.count, m.type, m.name, m.vertexShader || '', Array.from(o.matrixWorld.elements).join(',')].join('|'));
    }
    for (const c of o.children) visit(c);
  };
  visit(rig.soul);
  return out.sort();
}

test('rigs without actions are today\'s rigs: no skeleton, no skinned mesh, no setPose, the plain die-cut shader, decorations on the model', async () => {
  const m = await bodies('v3');
  const decor = await decorFor(v3Config());
  const rig = buildSoulRig(THREE, { ...m, config: v3Config(), decor, badge: 'bingo-star', decorMaterials: 'shared' });
  let bones = 0, skinned = 0;
  rig.soul.traverse((o) => { if (o.isBone) bones++; if (o.isSkinnedMesh) skinned++; });
  assert.deepEqual([bones, skinned, rig.setPose, rig.rest, rig.figure.actor, rig.figure.setPose], [0, 0, undefined, undefined, undefined, undefined]);
  assert.equal(rig.figure.materials.hull.vertexShader, PLAIN_HULL_VERTEX, 'the die-cut shader of stage 13');
  for (const o of [...rig.figure.charms, rig.figure.topper, rig.figure.plate, rig.figure.eyes, rig.figure.face]) assert.equal(o.parent, rig.figure.model);
  assert.equal(rig.figure.root.rotation.y, 0);
  rig.dispose();
});

test('an acting rig at rest draws exactly the plain rig (v3 and baseline, with the orb glow), and again after every action', async () => {
  for (const [variant, config] of [['v3', v3Config({ face: 'angel' })], ['v2', v2Config({ face: 'pirate' })]]) {
    const m = await bodies(variant);
    const decor = await decorFor(config);
    const glowTexture = new THREE.Texture();
    const make = (actions) => buildSoulRig(THREE, { ...m, config, decor, badge: 'bingo-star', decorMaterials: 'shared', glowTexture, actions });
    const plain = make(false), actor = make(true);
    const want = draws(plain, m);
    assert.ok(want.length > 10, `${variant}: ${want.length} draws`);
    assert.deepEqual(draws(actor, m), want, `${variant}: fresh acting rig at rest`);
    assert.equal(actor.figure.actor.acting, false);
    for (const a of SOUL_ACTIONS) {
      for (const t of [0.3, actionDuration(a) / 2]) assert.equal(actor.setPose(actionPose(a, t, { side: 'right' })), true);
      assert.notDeepEqual(draws(actor, m), want, `${variant} ${a}: the pose shows`);
      assert.equal(actor.setPose(actionPose(a, actionDuration(a), { side: 'right' })), false, 'the end of an action is the rest pose');
      assert.deepEqual(draws(actor, m), want, `${variant}: at rest again after ${a}`);
    }
    actor.setPose(actionPose('sway', 1));
    actor.rest();
    assert.deepEqual(draws(actor, m), want, `${variant}: rest()`);
    for (const a of Object.values(actor.figure.actor.anchors)) assert.ok(a.matrix.equals(new THREE.Matrix4()), 'anchors exactly the identity');
    assert.equal(actor.setPose(actionPose('wave', 1.2, { reducedMotion: true })), false, 'reduced motion: the rest figure');
    plain.dispose(); actor.dispose();
  }
});

test('acting: the skinned body and die-cut twins show and deform with the bones exactly as their weights say', async () => {
  const { hull } = await bodies('v3');
  // the lite LOD as both body and hull, so the two twins share vertex indices
  const fig = buildSoulFigure(THREE, { body: hull, hull, config: v3Config(), actions: true });
  const { body: skBody, hull: skHull } = fig.actor.skinned;
  assert.ok(skBody.isSkinnedMesh && skHull.isSkinnedMesh && !skBody.visible && fig.body.visible);
  assert.match(skHull.material.vertexShader, /#include <skinning_vertex>/);
  assert.equal(skHull.material.uniforms, fig.materials.hull.uniforms, 'the twin die-cut shares opacity, colour and width');
  assert.equal(skBody.material, fig.materials.body, 'one body material (one program with and without skinning)');
  const angle = 0.8;
  const pose = { yaw: 0, bones: Object.fromEntries(SOUL_BONES.map((b) => [b, { rot: [0, 0, b === 'armL' ? angle : 0], pos: [0, 0, 0], scale: [1, 1, 1] }])) };
  assert.equal(fig.setPose(pose), true);
  assert.ok(skBody.visible && skHull.visible && !fig.body.visible && !fig.hull.visible);
  fig.root.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().compose(hull.position, hull.quaternion, hull.scale);
  const pivot = bonePivots(hull.landmarks).armL;
  const rotZ = new THREE.Matrix4().makeTranslation(...pivot).multiply(new THREE.Matrix4().makeRotationZ(angle)).multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
  let moved = 0, still = 0;
  const w = new Float64Array(SOUL_BONES.length);
  for (let i = 0; i < hull.count; i++) {
    const rest = new THREE.Vector3().fromBufferAttribute(hull.geometry.attributes.position, i);
    const pModel = rest.clone().applyMatrix4(toModel);
    const got = new THREE.Vector3(); skBody.getVertexPosition(i, got);
    const gotHull = new THREE.Vector3(); skHull.getVertexPosition(i, gotHull);
    assert.ok(got.distanceTo(gotHull) < 1e-9, 'the die-cut deforms exactly like the body');
    boneWeights(pModel.x, pModel.y, pModel.z, w);
    const armL = w[SOUL_BONES.indexOf('armL')];
    const expect = armL === 1 ? pModel.clone().applyMatrix4(rotZ) : armL === 0 ? pModel : null;
    if (!expect) continue;
    const gotModel = got.clone().applyMatrix4(toModel);
    assert.ok(gotModel.distanceTo(expect) < 1e-5, `vertex ${i} (arm weight ${armL}) at ${gotModel.toArray()} vs ${expect.toArray()}`);
    if (armL === 1) moved++; else still++;
  }
  assert.ok(moved > 100 && still > 1000, `${moved} arm-lobe vertices swung, ${still} others stayed`);
  // at the bind pose the skinned twins sit exactly on the rest positions
  fig.setPose({ ...pose, bones: { ...pose.bones, armL: { rot: [0, 0, 1e-9], pos: [0, 0, 0], scale: [1, 1, 1] } } });
  fig.root.updateMatrixWorld(true);
  for (let i = 0; i < hull.count; i += 7) { const got = new THREE.Vector3(); skBody.getVertexPosition(i, got); assert.ok(got.distanceTo(new THREE.Vector3().fromBufferAttribute(hull.geometry.attributes.position, i)) < 1e-6); }
  fig.dispose();
});

test('decorations ride their bones: charms their dominant bone, plate / kit / antenna charm / orb the head, eye halves the eye bones', async () => {
  const m = await bodies('v3');
  const config = v3Config();
  const decor = await decorFor(config);
  const rig = buildSoulRig(THREE, { ...m, config, decor, decorMaterials: 'shared', actions: true });
  const f = rig.figure, A = f.actor.anchors;
  f.charms.forEach((holder, i) => assert.equal(holder.parent, A[dominantBone(decor.charms[i].place.position)], holder.name));
  for (const o of [f.topper, f.plate, f.face, f.eyes]) assert.equal(o.parent, A.head, o.name);
  const [left, right] = f.actor.eyeHalves;
  assert.deepEqual([left.parent, right.parent, left.visible, right.visible, f.eyes.visible], [A.eyeL, A.eyeR, false, false, true], 'the whole eyes model at rest');
  // each half holds one eye: the left half's triangles all sit at +X (the character's left)
  rig.soul.updateMatrixWorld(true);
  /** Model-space box of the vertices a part actually draws (its index; the halves share the eye model's buffer). */
  const inModel = (o) => {
    const box = new THREE.Box3(), toModel = new THREE.Matrix4().copy(f.model.matrixWorld).invert(), v = new THREE.Vector3();
    o.traverse((x) => { if (!x.isMesh) return; const idx = x.geometry.index.array; for (const i of idx) box.expandByPoint(v.fromBufferAttribute(x.geometry.attributes.position, i).applyMatrix4(x.matrixWorld).applyMatrix4(toModel)); });
    return box;
  };
  assert.ok(inModel(left).min.x > 0 && inModel(right).max.x < 0);
  // a wink squashes one eye to a tenth of its height about its centre; the other eye and the rest of the face stay
  const pose = JSON.parse(JSON.stringify(REST_POSE)); pose.bones.eyeL.scale = [1, 0.1, 1];
  rig.setPose(pose); rig.soul.updateMatrixWorld(true);
  assert.deepEqual([left.visible, right.visible, f.eyes.visible], [true, true, false], 'the halves while acting');
  const hL = inModel(left).getSize(new THREE.Vector3()).y, hR = inModel(right).getSize(new THREE.Vector3()).y;
  assert.ok(Math.abs(hL / hR - 0.1) < 1e-6, `left eye ${hL} vs right ${hR}`);
  assert.ok(Math.abs(inModel(left).getCenter(new THREE.Vector3()).y - bonePivots(m.body.landmarks).eyeL[1]) < 0.02, 'squashed about the eye centre');
  // the head carries plate, kit and antenna charm rigidly
  const tilt = JSON.parse(JSON.stringify(REST_POSE)); tilt.bones.head.rot = [0, 0, 0.1];
  rig.setPose(tilt);
  const pv = bonePivots(m.body.landmarks).head;
  const want = new THREE.Matrix4().makeTranslation(...pv).multiply(new THREE.Matrix4().makeRotationZ(0.1)).multiply(new THREE.Matrix4().makeTranslation(-pv[0], -pv[1], -pv[2]));
  assert.ok(A.head.matrix.elements.every((v, i) => Math.abs(v - want.elements[i]) < 1e-12), 'the head anchor is the head bone\'s move');
  // the turn yaws the whole figure about its vertical axis; the Bingo Star badge never acts
  rig.setPose(actionPose('turn', 2, { side: 'left' }));
  assert.ok(Math.abs(f.root.rotation.y - actionPose('turn', 2, { side: 'left' }).yaw) < 1e-12 && f.root.rotation.y > 1);
  rig.rest();
  assert.equal(f.root.rotation.y, 0);
  // a late decoration joins the current pose: eyes shown as halves while acting
  rig.setPose(pose);
  rig.setDecor(decor);
  assert.deepEqual([f.actor.eyeHalves[0].visible, f.eyes.visible], [true, false]);
  rig.dispose();
  // the baseline's orb glow follows the head
  const b = await bodies('v2');
  const v2 = buildSoulRig(THREE, { ...b, config: v2Config(), glowTexture: new THREE.Texture(), actions: true });
  assert.equal(v2.figure.orbSprite.parent, v2.figure.actor.anchors.head);
  assert.equal(RENDER_ORDER.glow, v2.figure.orbSprite.renderOrder);
  v2.dispose();
});

test('skin attributes are computed once per body model and shared; disposing an acting rig frees only its own objects', async () => {
  const m = await bodies('v3');
  const a = buildSoulFigure(THREE, { ...m, config: v3Config(), actions: true }), b = buildSoulFigure(THREE, { ...m, config: v3Config({ seed: 'b' }), actions: true });
  const skin = (f) => f.actor.skinned.body.geometry.attributes.skinIndex;
  assert.equal(skin(a), skin(b), 'one skinIndex per model');
  assert.equal(a.actor.skinned.hull.geometry.attributes.skinWeight, b.actor.skinned.hull.geometry.attributes.skinWeight);
  assert.notEqual(skin(a), a.actor.skinned.hull.geometry.attributes.skinIndex, 'the hull (lite) has its own');
  let freed = 0;
  a.actor.skinned.hull.material.addEventListener('dispose', () => { freed++; });
  a.dispose();
  assert.equal(freed, 1, 'the twin die-cut material');
  assert.equal(skin(b).count, m.body.count, 'the shared skin buffers stay with the other figure');
  assert.ok(m.body.geometry.attributes.position.array.length > 0);
  b.dispose();
});

test('dieCut: false leaves out only the white die-cut hull (the big screen); the default keeps it exactly (the phone)', async () => {
  const m = await bodies('v3');
  const config = v3Config({ face: 'pirate' });
  const decor = await decorFor(config);
  const make = (over = {}) => buildSoulRig(THREE, { ...m, config, decor, badge: 'bingo-star', decorMaterials: 'shared', ...over });
  const phone = make(), explicit = make({ dieCut: true }), big = make({ dieCut: false });
  const want = draws(phone, m);
  assert.deepEqual(draws(explicit, m), want, 'true is the default, unchanged');
  const hulls = want.filter((d) => d.split('|')[2] === 'hull');
  assert.equal(hulls.length, 1); assert.ok(hulls[0].includes(PLAIN_HULL_VERTEX), 'the phone keeps its die-cut shader');
  assert.deepEqual(draws(big, m), want.filter((d) => d.split('|')[2] !== 'hull'), 'everything else is drawn exactly the same');
  assert.deepEqual([big.figure.hull, big.figure.materials.hull], [null, null]);
  big.figure.setOpacity(0.5, 0.5); big.figure.setOutline(1.7);   // no hull to touch
  // an acting rig without the die-cut: no skinned hull either, and at rest it draws exactly the plain big-screen rig
  const acting = make({ dieCut: false, actions: true });
  assert.equal(acting.figure.actor.skinned.hull, null);
  assert.deepEqual(draws(acting, m), draws(big, m));
  acting.setPose(actionPose('wave', 1.2, { side: 'left' }));
  assert.ok(acting.figure.actor.skinned.body.visible);
  acting.rest();
  assert.deepEqual(draws(acting, m), draws(big, m));
  for (const r of [phone, explicit, big, acting]) r.dispose();
  // D-58: the phone reveal now leaves the die-cut out too (it read as a white border around the Soul)
  const scene = readFileSync(join(ROOT, 'apps/employee-mobile/src/scene/soul-scene.js'), 'utf8');
  assert.match(scene, /buildSoulRig\(THREE, \{[^}]*dieCut: false/);
});
