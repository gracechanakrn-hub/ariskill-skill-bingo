// packages/ui/soul3d in Node (no DOM, no WebGL): the baseline GLBs parsed by the vendored GLTFLoader give per-vertex
// heights; the figure tints v2 Souls with the body gradient; the decor loader resolves charms and face kits through a
// stub loader, caches them per URL, skips each missing piece on its own (a partial catalog never breaks the Soul),
// remembers failures for a while and draws the plain gradient Soul when nothing is left; the figure places charms with
// the spec basis / position / scale and the face kit at identity; the rig adds the medallion Bingo Star for v2.
// D-29 docs/art/soul-decorations.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as THREE from '../../vendor/three/index.js';
import * as loaders from '../../vendor/three/loaders.js';
import { extractSoulModel, vertexHeights } from '../soul3d/model.js';
import { buildSoulFigure, figureColours, RENDER_ORDER } from '../soul3d/figure.js';
import { buildSoulRig } from '../soul3d/rig.js';
import { SOUL_VIEW } from '../soul3d/studio.js';
import { loadSoulDecor, soulDecorPlan, clearSoulDecorCache, soulDecorCacheKeys, extractCharmModel, extractFaceModel, hasDecor } from '../soul3d/decor.js';
import { tintGradientColors, tintColors } from '../soul3d/tint.js';
import { soulModelUrl } from '../asset-map.js';
import { PALETTES } from '../soul-renderer.js';
import { GRADIENTS } from '../../game-rules/src/soul-catalog.js';
import { decorFixture, v2Config, neutralV2 } from './decor-fixture.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DECOR = decorFixture();
const models = {};
async function model(lod) {
  if (!models[lod]) {
    const buf = readFileSync(join(ROOT, soulModelUrl(lod).replace(/^\//, '')));
    const gltf = await new Promise((resolve, reject) => new loaders.GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject));
    models[lod] = extractSoulModel(THREE, gltf, lod);
  }
  return models[lod];
}

/** A stand-in for GLTFLoader: charms are 1.0-wide puffy discs (back face at z = 0, texture map), face kits two parts. */
function stubMods({ fail = [], untextured = [], delayMs = 1 } = {}) {
  const calls = [];
  class GLTFLoader {
    load(url, onLoad, _progress, onError) {
      calls.push(url);
      const path = url.split('?')[0];
      setTimeout(() => {
        if (fail.some((f) => path.endsWith(f))) { onError(new Error(`404 ${url}`)); return; }
        const scene = new THREE.Group();
        if (path.includes('/charms/')) {
          const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 12); geo.rotateX(Math.PI / 2); geo.translate(0, 0, 0.1);
          const node = new THREE.Group(); node.scale.setScalar(1); // a node transform like the dequantisation
          node.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: untextured.some((u) => path.endsWith(u)) ? null : new THREE.Texture() })));
          scene.add(node);
        } else {
          scene.add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.02, 6, 16), new THREE.MeshStandardMaterial({ color: 0x333333 })));
          scene.add(new THREE.Mesh(new THREE.CircleGeometry(0.08, 12), new THREE.MeshStandardMaterial({ color: 0xff8899, transparent: true, opacity: 0.6, depthWrite: false })));
        }
        onLoad({ scene, asset: {} });
      }, delayMs);
    }
  }
  return { mods: { THREE, addons: { GLTFLoader } }, calls };
}
const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

test('extractSoulModel adds each vertex\'s height above the floor (node transform applied, feet at 0, orb top at the height)', async () => {
  const hero = await model('hero');
  assert.equal(hero.heights.length, hero.count);
  const mesh = new THREE.Mesh(hero.geometry); mesh.position.copy(hero.position); mesh.quaternion.copy(hero.quaternion); mesh.scale.copy(hero.scale); mesh.updateMatrix();
  const p = hero.geometry.attributes.position;
  for (const i of [0, 17, 999, 5000, hero.count - 1]) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(mesh.matrix);
    assert.ok(Math.abs(hero.heights[i] - (v.y - hero.landmarks.floor)) < 1e-5, `vertex ${i}`);
  }
  let min = Infinity, max = -Infinity; for (const h of hero.heights) { min = Math.min(min, h); max = Math.max(max, h); }
  assert.ok(Math.abs(min) < 0.01, `feet at ${min}`);
  assert.ok(Math.abs(max - hero.landmarks.height) < 0.02, `orb top at ${max} vs height ${hero.landmarks.height}`);
  assert.deepEqual(vertexHeights(p, hero, hero.landmarks.floor), hero.heights);
});

test('buildSoulFigure: v2 configs tint the body with the gradient on the vertex heights; v1 configs and palettes keep the palette tint', async () => {
  const hero = await model('hero'), lite = await model('lite');
  const cfg = v2Config({ gradient: 9 });
  const fig = buildSoulFigure(THREE, { body: hero, hull: lite, config: cfg, quality: 'high' });
  assert.deepEqual(Buffer.from(fig.body.geometry.attributes.color.array.buffer), Buffer.from(tintGradientColors(hero.mask, hero.heights, GRADIENTS[9]).buffer));
  assert.equal(fig.look.version, 2);
  assert.deepEqual(figureColours({ config: cfg }).palette.glow, GRADIENTS[9].glow, 'the orb glows in the gradient glow');
  assert.equal(fig.charms.length, 0, 'no decor given: the plain gradient Soul');
  const v1 = buildSoulFigure(THREE, { body: hero, hull: lite, config: { seed: 'x', palette: 'coral' } });
  assert.deepEqual(Buffer.from(v1.body.geometry.attributes.color.array.buffer), Buffer.from(tintColors(hero.mask, PALETTES[5]).buffer));
  const mascot = buildSoulFigure(THREE, { body: lite, hull: lite, palette: PALETTES[7], quality: 'low' });
  assert.deepEqual(Buffer.from(mascot.body.geometry.attributes.color.array.buffer), Buffer.from(tintColors(lite.mask, PALETTES[7]).buffer), 'explicit palette (join mascot) unchanged');
  // every gradient gives its own colours, all from one shared mesh
  const seen = new Set(GRADIENTS.map((_, gi) => { const f = buildSoulFigure(THREE, { body: lite, hull: lite, config: v2Config({ gradient: gi }) }); const hex = Buffer.from(f.body.geometry.attributes.color.array.buffer).toString('hex'); assert.equal(f.body.geometry.attributes.position, lite.geometry.attributes.position); f.dispose(); return hex; }));
  assert.equal(seen.size, GRADIENTS.length);
  fig.dispose(); v1.dispose(); mascot.dispose();
});

test('decor plan: v1 / neutral / stub resolve undecorated; a partial catalog skips each missing charm or face on its own', () => {
  assert.equal(soulDecorPlan({ seed: 'x', palette: 1 }, DECOR).reason, 'v1');
  assert.equal(soulDecorPlan(neutralV2(), DECOR).reason, 'plain');
  assert.equal(soulDecorPlan(v2Config(), { ...DECOR, stub: true }).reason, 'stub');
  const cfg = v2Config();
  // some charm files missing (the Blender build still running): those charms are skipped, the rest and the face stay
  const partialFiles = { ...DECOR.charm.files }; delete partialFiles[cfg.charms[2]]; delete partialFiles[cfg.charms[7]];
  const part = soulDecorPlan(cfg, decorFixture({ charm: { thickness: 0.2, files: partialFiles } }));
  assert.equal(part.usable, true);
  assert.deepEqual(part.charms.map((c) => c.slot), [0, 1, 3, 4, 5, 6, 8, 9]);
  assert.deepEqual(part.skipped, [cfg.charms[2], cfg.charms[7]]);
  assert.ok(part.face);
  const noCharms = soulDecorPlan(cfg, decorFixture({ charm: { thickness: 0.2, files: {} } }));
  assert.deepEqual([noCharms.usable, noCharms.charms.length, !!noCharms.face], [true, 0, true], 'the face kit alone still decorates');
  const noFace = soulDecorPlan(cfg, decorFixture({ faces: {} }));
  assert.deepEqual([noFace.usable, noFace.charms.length, noFace.face, noFace.skipped], [true, 10, null, ['face:nerdy']]);
  const badSlots = soulDecorPlan(cfg, decorFixture({ slots: DECOR.slots.map((s) => (s.index === 4 ? { ...s, size: 0 } : s)) }));
  assert.deepEqual(badSlots.skipped, [cfg.charms[4]], 'an unusable slot skips its charm only');
  assert.equal(soulDecorPlan(cfg, decorFixture({ charm: { thickness: 0.2, files: {} }, faces: {} })).reason, 'no-files', 'nothing left: the plain gradient Soul');
  const plan = soulDecorPlan(v2Config({ face: 'angel' }), DECOR);
  assert.equal(plan.usable, true);
  assert.deepEqual(plan.charms.map((c) => c.slot), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(plan.charms.map((c) => c.glb), v2Config().charms.map((id) => DECOR.charm.files[id].glb));
  assert.deepEqual(plan.face, { face: 'angel', glb: DECOR.faces.angel.glb });
  assert.equal(new Set(plan.charms.map((c) => c.place.scale)).size, 1, 'one charm size (BR-17)');
});

test('loadSoulDecor: loads every charm + the face once, resolves them by slot, and serves later Souls from the cache', async () => {
  clearSoulDecorCache();
  const { mods, calls } = stubMods();
  const cfg = v2Config({ face: 'pirate' });
  const d = await loadSoulDecor(mods, cfg, { decor: DECOR });
  assert.equal(d.complete, true); assert.equal(d.reason, null); assert.ok(hasDecor(d));
  assert.deepEqual(d.charms.map((c) => [c.slot, c.id]), cfg.charms.map((id, i) => [i, id]));
  assert.equal(d.face.face, 'pirate');
  assert.equal(calls.length, 11);
  const again = await loadSoulDecor(mods, v2Config({ face: 'pirate', seed: 'other' }), { decor: DECOR });
  assert.equal(calls.length, 11, 'same charm ids and face: no new fetch');
  assert.equal(again.charms[0].model, d.charms[0].model, 'one template per charm id');
  assert.deepEqual(soulDecorCacheKeys().charms.length, 10);
  // v1 and the neutral fallback need nothing
  for (const c of [{ seed: 'v1', palette: 3 }, neutralV2()]) { const r = await loadSoulDecor(mods, c, { decor: DECOR }); assert.equal(r.complete, true); assert.equal(hasDecor(r), false); }
  assert.equal(calls.length, 11);
});

test('loadSoulDecor never rejects: a 404 or an untextured charm skips that charm only; failures wait before a retry; nothing left = plain Soul', async () => {
  clearSoulDecorCache();
  const cfg = v2Config();
  const stub = await loadSoulDecor(stubMods().mods, cfg, { decor: { ...DECOR, stub: true } });
  assert.deepEqual([stub.complete, stub.reason, stub.charms.length, stub.face], [false, 'stub', 0, null]);
  const missing = `${cfg.charms[4]}.glb`;
  const broken = stubMods({ fail: [missing] });
  const r404 = await loadSoulDecor(broken.mods, cfg, { decor: DECOR });
  assert.deepEqual([r404.complete, r404.partial, r404.reason], [false, true, 'partial']);
  assert.deepEqual(r404.charms.map((c) => c.slot), [0, 1, 2, 3, 5, 6, 7, 8, 9], 'the other nine charms still render');
  assert.ok(r404.face, 'and the face kit');
  assert.deepEqual(r404.missing, [cfg.charms[4]]);
  assert.match(r404.error, /404/);
  assert.ok(hasDecor(r404));
  assert.ok(soulDecorCacheKeys().failed.some((u) => u.includes(missing)), 'the failure is remembered');
  // within the retry window another Soul does not ask for the missing file again (hundreds of Galaxy Souls share charms)
  const soon = stubMods();
  const again = await loadSoulDecor(soon.mods, v2Config({ seed: 'another' }), { decor: DECOR });
  assert.equal(soon.calls.length, 0, 'no re-request of a file that just failed');
  assert.deepEqual(again.missing, [cfg.charms[4]]);
  const later = stubMods();
  const retry = await loadSoulDecor(later.mods, cfg, { decor: DECOR, retryAfterMs: 0 });
  assert.equal(retry.complete, true, 'after the window a later Soul retries the file');
  assert.equal(later.calls.length, 1, 'only the charm that failed is fetched again');
  assert.ok(!soulDecorCacheKeys().failed.length);
  clearSoulDecorCache();
  const bare = await loadSoulDecor(stubMods({ untextured: [`${cfg.charms[2]}.glb`] }).mods, cfg, { decor: DECOR });
  assert.deepEqual([bare.complete, bare.reason, bare.charms.length, bare.missing], [false, 'partial', 9, [cfg.charms[2]]], 'a charm whose .png did not load is skipped');
  clearSoulDecorCache();
  const faceGone = await loadSoulDecor(stubMods({ fail: ['face-nerdy.glb'] }).mods, cfg, { decor: DECOR, retryAfterMs: 0 });
  assert.deepEqual([faceGone.face, faceGone.charms.length, faceGone.missing], [null, 10, ['face:nerdy']], 'a missing face kit leaves the charms');
  clearSoulDecorCache();
  const noLoader = await loadSoulDecor({ THREE, addons: {} }, cfg, { decor: DECOR, retryAfterMs: 0 });
  assert.deepEqual([noLoader.complete, noLoader.reason, noLoader.charms.length, noLoader.face, hasDecor(noLoader)], [false, 'load-failed', 0, null, false], 'nothing loaded: the plain gradient Soul');
  for (const garbage of [null, undefined, 'x', 42, { version: 2, charms: 'nope' }]) {
    const r = await loadSoulDecor(stubMods().mods, garbage, { decor: DECOR });
    assert.ok(r && typeof r.complete === 'boolean');
  }
  assert.throws(() => extractCharmModel(THREE, { scene: new THREE.Group() }, 'x'), /no mesh/);
  assert.throws(() => extractFaceModel(THREE, {}, 'nerdy'), /no mesh/);
});

test('figure with decorations: charms at the slot basis / position / scale inside the model group, face kit at identity, own materials', async () => {
  clearSoulDecorCache();
  const hero = await model('hero'), lite = await model('lite');
  const { mods } = stubMods();
  const cfg = v2Config({ face: 'angel', gradient: 2 });
  const decor = await loadSoulDecor(mods, cfg, { decor: DECOR });
  const fig = buildSoulFigure(THREE, { body: hero, hull: lite, config: cfg, decor });
  assert.equal(fig.charms.length, 10);
  fig.root.updateMatrixWorld(true);
  fig.charms.forEach((holder, i) => {
    const place = decor.charms[i].place;
    assert.equal(holder.parent, fig.model, 'model space (the body mesh\'s sibling)');
    assert.ok(near(holder.position.toArray(), place.position, 1e-9));
    assert.ok(near(holder.quaternion.toArray(), place.quaternion, 1e-9));
    assert.equal(holder.scale.x, place.scale); assert.equal(holder.scale.z, place.scale);
    assert.equal(holder.name, `charm:${i}:${cfg.charms[i]}`);
    // the charm's back centre sits on the slot, sunk along the normal, in world space too
    const world = new THREE.Vector3().setFromMatrixPosition(holder.matrixWorld);
    const expect = new THREE.Vector3(...place.position).add(new THREE.Vector3(0, -hero.landmarks.floor, 0)).multiplyScalar(fig.fit);
    assert.ok(world.distanceTo(expect) < 1e-9);
    holder.traverse((o) => { if (o.isMesh) { assert.equal(o.renderOrder, RENDER_ORDER.charm); assert.notEqual(o.material, decor.charms[i].model.scene.children[0].children[0].material, 'own material'); assert.equal(o.material.map, decor.charms[i].model.scene.children[0].children[0].material.map, 'shared texture'); } });
  });
  assert.equal(fig.face.parent, fig.model);
  assert.ok(fig.face.position.equals(new THREE.Vector3()) && fig.face.quaternion.equals(new THREE.Quaternion()) && fig.face.scale.equals(new THREE.Vector3(1, 1, 1)), 'face kit at identity');
  fig.face.traverse((o) => { if (o.isMesh) assert.equal(o.renderOrder, RENDER_ORDER.face, 'after the body and the charms (blush is blended)'); });
  assert.ok(RENDER_ORDER.body < RENDER_ORDER.charm && RENDER_ORDER.charm < RENDER_ORDER.face);
  // features fade: decorations follow orbO, keeping each material's own opacity (blush 0.6)
  fig.setOpacity(1, 0.5);
  const opac = []; fig.model.traverse((o) => { if (o.isMesh && (o.renderOrder === RENDER_ORDER.charm || o.renderOrder === RENDER_ORDER.face)) opac.push(o.material.opacity); });
  assert.ok(opac.every((v) => v === 0.5 || Math.abs(v - 0.3) < 1e-12), `decor opacities ${[...new Set(opac)]}`);
  const tmpl = decor.charms[0].model.scene.children[0].children[0].material;
  assert.equal(tmpl.opacity, 1, 'the cached template is untouched');
  // decorations can arrive late and can be cleared; disposing leaves the templates usable
  const late = buildSoulFigure(THREE, { body: lite, hull: lite, config: cfg });
  late.setOpacity(1, 0.25);
  assert.equal(late.setDecor(decor), true);
  late.model.traverse((o) => { if (o.isMesh && o.renderOrder === RENDER_ORDER.charm) assert.equal(o.material.opacity, 0.25, 'joins at the current feature opacity'); });
  assert.equal(late.setDecor({ complete: false, charms: [], face: null }), false);
  assert.equal(late.charms.length, 0); assert.equal(late.face, null);
  // a partial decoration draws what loaded
  assert.equal(late.setDecor({ ...decor, complete: false, partial: true, charms: decor.charms.slice(0, 3), face: null }), true);
  assert.equal(late.charms.length, 3); assert.equal(late.face, null);
  fig.dispose(); late.dispose();
  assert.ok(decor.charms[0].model.scene.children[0].children[0].geometry.attributes.position.array.length > 0);
});

test('rig: the phone pose (3/4 yaw) and the medallion Bingo Star for v2 Souls; v1 keeps the plain star', async () => {
  const hero = await model('hero'), lite = await model('lite');
  const v2 = buildSoulRig(THREE, { body: hero, hull: lite, config: v2Config({ gradient: 5 }), badge: 'bingo-star' });
  assert.equal(v2.turn.rotation.y, SOUL_VIEW.yaw); assert.equal(v2.turn.parent, v2.soul); assert.equal(v2.figure.root.parent, v2.turn);
  assert.equal(v2.colors.glow, GRADIENTS[5].glow);
  assert.equal(v2.badge.group.parent, v2.soul, 'the badge stays upright outside the turn');
  const a = hero.landmarks.badgeAnchor, fit = v2.figure.fit;
  assert.ok(v2.badge.group.position.distanceTo(new THREE.Vector3((a[0] + SOUL_VIEW.badgeSize * 0.55) * fit, (a[1] + SOUL_VIEW.badgeSize * 0.2 - hero.landmarks.floor) * fit, (a[2] + SOUL_VIEW.badgeForward) * fit)) < 1e-9);
  const v1 = buildSoulRig(THREE, { body: hero, hull: lite, config: { seed: 'x', palette: 2 }, badge: 'bingo-star' });
  assert.equal(v2.badge.group.children.length, 5, 'star + hull + medallion disc, ring and die-cut');
  assert.equal(v1.badge.group.children.length, 2, 'star + hull');
  v2.badge.group.traverse((o) => { if (o.isMesh) assert.equal(o.material.opacity, 1, 'built visible (a card render never fades it in)'); });
  v2.badge.setOpacity(0.5);
  v2.badge.group.traverse((o) => { if (o.isMesh) assert.equal(o.material.opacity, 0.5); });
  assert.equal(buildSoulRig(THREE, { body: lite, hull: lite, config: v2Config() }).badge, null, 'no badge unless earned');
  v2.dispose(); v1.dispose();
});
