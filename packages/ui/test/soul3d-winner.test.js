// packages/ui/soul3d winner.js (stage 15, D-36): the Bingo winner's gold crown on the big screen - built from primitives
// until the Blender GLB has loaded (the same crown), cloned from the GLB after; placed on the head; only a rig built
// with `winnerCrown` wears it (the public Galaxy), in place of the medallion - the phone's rigs keep the medallion; on an
// acting rig it rides the head. loadWinnerCrown never rejects: no asset-map entry, no loader or a failed load all
// resolve null (the procedural crown stands in), and a failure is retried only after CROWN_RETRY_MS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as THREE from '../../vendor/three/index.js';
import * as loaders from '../../vendor/three/loaders.js';
import { extractSoulModel } from '../soul3d/model.js';
import { buildSoulRig } from '../soul3d/rig.js';
import { actionPose } from '../soul3d/actions.js';
import { buildWinnerCrown, loadWinnerCrown, CROWN_PLACE, CROWN_RETRY_MS, WINNER_CROWN_ID } from '../soul3d/winner.js';
import { soulModelUrl, assetUrl } from '../asset-map.js';
import { v2Config } from './decor-fixture.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const parse = (url) => { const b = readFileSync(join(ROOT, url.split('?')[0].replace(/^\//, ''))); return new Promise((res, rej) => new loaders.GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej)); };
let baseline = null;
async function bodies() {
  if (!baseline) baseline = { body: extractSoulModel(THREE, await parse(soulModelUrl('hero')), 'hero', 'v2'), hull: extractSoulModel(THREE, await parse(soulModelUrl('lite')), 'lite', 'v2') };
  return baseline;
}
const meshes = (o) => { const out = []; o.traverse((x) => { if (x.isMesh) out.push(x); }); return out; };

test('the procedural crown: a gold band, five jewelled spikes across the front, four plain ones round the back; on the head', () => {
  const c = buildWinnerCrown(THREE);
  assert.equal(c.fromGlb, false);
  assert.equal(c.group.name, 'winner:crown');
  assert.deepEqual(c.group.position.toArray(), [...CROWN_PLACE.position]);
  assert.equal(c.group.rotation.z, CROWN_PLACE.rotationZ);
  const all = meshes(c.group);
  const kind = (t) => all.filter((m) => m.geometry.type === t).length;
  assert.equal(kind('LatheGeometry'), 1, 'the band');
  assert.equal(kind('ConeGeometry'), 5 + 4, 'the spikes');
  assert.equal(kind('SphereGeometry'), 5 + 3, 'a jewel on every front spike, gems on the band');
  for (const m of all) { assert.equal(m.renderOrder, 4); assert.ok(m.material.isMeshStandardMaterial); }
  const gold = all.find((m) => m.geometry.type === 'LatheGeometry').material;
  assert.equal(gold.color.getHex(), 0xf6c453); assert.ok(gold.metalness >= 0.8);
  // the middle spike faces the viewer (+Z)
  const spikes = all.filter((m) => m.geometry.type === 'ConeGeometry').slice(0, 5);
  assert.ok(Math.abs(spikes[2].position.x) < 1e-9 && spikes[2].position.z > 0.35);
  let disposed = 0;
  for (const m of all) m.geometry.addEventListener('dispose', () => { disposed++; });
  c.dispose();
  assert.equal(disposed, all.length, 'its own geometry is freed');
});

test('from the GLB: a clone of the template on the head, sharing its geometry and materials (dispose leaves them)', () => {
  const template = new THREE.Group(); template.name = 'winner-crown';
  const geo = new THREE.BoxGeometry(0.7, 0.3, 0.7), mat = new THREE.MeshStandardMaterial({ color: 0xf6c453 });
  template.add(new THREE.Mesh(geo, mat));
  let freed = false; geo.addEventListener('dispose', () => { freed = true; });
  const a = buildWinnerCrown(THREE, template), b = buildWinnerCrown(THREE, template);
  assert.equal(a.fromGlb, true);
  assert.deepEqual(a.group.position.toArray(), [...CROWN_PLACE.position]);
  const [ma] = meshes(a.group), [mb] = meshes(b.group);
  assert.equal(ma.geometry, geo); assert.equal(mb.material, mat, 'shared, not copied');
  assert.notEqual(ma, template.children[0], 'a clone, not the template itself');
  assert.equal(ma.renderOrder, 4);
  a.dispose(); b.dispose();
  assert.equal(freed, false, 'the template outlives every rig');
  assert.equal(template.parent, null, 'the template stays unattached');
});

test('the rig: the Galaxy (winnerCrown) crowns a winner instead of the medallion; the phone keeps the medallion; only winners', async () => {
  const m = await bodies();
  const config = v2Config({ face: 'pirate' });
  const phone = buildSoulRig(THREE, { ...m, config, badge: 'bingo-star' });
  assert.equal(phone.crown, null, 'the phone passes no winnerCrown');
  assert.equal(phone.badge.group.visible, true);
  const big = buildSoulRig(THREE, { ...m, config, badge: 'bingo-star', dieCut: false, winnerCrown: true });
  assert.ok(big.crown && big.crown.fromGlb === false);
  assert.equal(big.crown.group.parent, big.figure.model, 'on the model, so it turns and bobs with the Soul');
  assert.equal(big.badge.group.visible, false, 'the medallion gives way to the crown');
  const plain = buildSoulRig(THREE, { ...m, config, badge: null, dieCut: false, winnerCrown: true });
  assert.equal(plain.crown, null, 'no Bingo, no crown');
  const template = new THREE.Group(); template.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial()));
  const glb = buildSoulRig(THREE, { ...m, config, badge: 'bingo-star', dieCut: false, winnerCrown: template });
  assert.equal(glb.crown.fromGlb, true);
  for (const r of [phone, big, plain, glb]) r.dispose();
});

test('on an acting rig the crown rides the head: it moves with a sway and comes back exactly at rest', async () => {
  const m = await bodies();
  const rig = buildSoulRig(THREE, { ...m, config: v2Config({ face: 'pirate' }), badge: 'bingo-star', dieCut: false, actions: true, winnerCrown: true });
  assert.equal(rig.crown.group.parent, rig.figure.actor.anchors.head);
  const world = () => { rig.soul.updateMatrixWorld(true); return rig.crown.group.matrixWorld.elements.slice(); };
  const rest = world();
  rig.setPose(actionPose('sway', 1.2));
  const swayed = world();
  assert.ok(swayed.some((v, i) => Math.abs(v - rest[i]) > 1e-4), 'the crown follows the head');
  rig.rest();
  assert.deepEqual(world(), rest);
  rig.dispose();
});

test('loadWinnerCrown: the crown GLB once per session; no entry, no loader or a failed load resolve null and retry later', async () => {
  assert.equal(await loadWinnerCrown(null, { url: '/x/crown.glb' }), null, 'no loader');
  assert.equal(await loadWinnerCrown({ THREE, addons: { GLTFLoader: loaders.GLTFLoader } }, { url: null }), null, 'no asset-map entry');
  let calls = 0; const scene = new THREE.Group();
  class Ok { load(url, onLoad) { calls++; setTimeout(() => onLoad({ scene }), 1); } }
  const ok = { THREE, addons: { GLTFLoader: Ok } };
  const [a, b] = await Promise.all([loadWinnerCrown(ok, { url: '/t/ok.glb' }), loadWinnerCrown(ok, { url: '/t/ok.glb' })]);
  assert.equal(a, scene); assert.equal(b, scene); assert.equal(calls, 1, 'one load for the session');
  assert.equal(await loadWinnerCrown(ok, { url: '/t/ok.glb' }), scene); assert.equal(calls, 1);
  let tries = 0, clock = 1000;
  class Bad { load(url, onLoad, onProgress, onError) { tries++; setTimeout(() => onError(new Error('404')), 1); } }
  const bad = { THREE, addons: { GLTFLoader: Bad } };
  const now = () => clock;
  assert.equal(await loadWinnerCrown(bad, { url: '/t/bad.glb', now }), null);
  clock += CROWN_RETRY_MS - 1;
  assert.equal(await loadWinnerCrown(bad, { url: '/t/bad.glb', now }), null); assert.equal(tries, 1, 'not again right away');
  clock += 2;
  assert.equal(await loadWinnerCrown(bad, { url: '/t/bad.glb', now }), null); assert.equal(tries, 2, 'tried again later');
  class Throws { load() { throw new Error('boom'); } }
  assert.equal(await loadWinnerCrown({ THREE, addons: { GLTFLoader: Throws } }, { url: '/t/throws.glb' }), null, 'never rejects');
  assert.equal(WINNER_CROWN_ID, 'soul_winner_crown');
  assert.equal(typeof assetUrl(WINNER_CROWN_ID) === 'string' || assetUrl(WINNER_CROWN_ID) === null, true);
});

test('the shipped crown GLB (tools/ai/blender/winner_crown.py) builds the same crown: gold, ruby and sapphire, the size of the draft', async () => {
  const url = assetUrl(WINNER_CROWN_ID);
  assert.equal(url, '/assets/souls/winner/crown.glb', 'published in the asset map');
  const gltf = await parse(url);
  const c = buildWinnerCrown(THREE, gltf.scene);
  assert.equal(c.fromGlb, true);
  const all = meshes(c.group);
  assert.deepEqual([...new Set(all.map((m) => m.material.color.getHex()))].sort((a, b) => a - b), [0x4d7dff, 0xe0356b, 0xf6c453]);
  for (const m of all) { assert.ok(m.material.isMeshStandardMaterial); assert.equal(m.renderOrder, 4); }
  // the same size as the crown from primitives, in the crown frame (base at y 0)
  const frame = (g) => { const x = g.clone(); x.position.set(0, 0, 0); x.rotation.set(0, 0, 0); x.updateMatrixWorld(true); return new THREE.Box3().setFromObject(x); };
  const glb = frame(c.group), prim = frame(buildWinnerCrown(THREE).group);
  for (const k of ['min', 'max']) for (const a of ['x', 'y', 'z']) assert.ok(Math.abs(glb[k][a] - prim[k][a]) < 0.03, `${k}.${a}: ${glb[k][a].toFixed(3)} vs ${prim[k][a].toFixed(3)}`);
  c.dispose();
});

