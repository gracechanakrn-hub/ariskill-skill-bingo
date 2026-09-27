// v3 Souls on the public Galaxy (stage 13, D-31, docs/art/soul-faces.md "Rendering: one Soul everywhere"): the impostor
// stage loads both body variants (the baseline and the v3 body, each cached) and bakes / flies every decorated Soul on
// the body and hull of its own variant, with its v3 plate, eyes and antenna charm; a Soul whose variant did not load
// (the v3 body before the face data is built) keeps its 2D composition in the atlas and its sprite in the entrance.
// Node with the vendored Three.js, a stand-in WebGLRenderer / PMREM (no GPU) and a stub GLTFLoader; fixture face data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as REAL from '../../../packages/vendor/three/index.js';
import { createImpostorStage } from '../src/renderer/impostor.js';
import { wantsImpostor, impostorKey } from '../src/renderer/impostor-plan.js';
import { clearSoulModelCache, clearSoulDecorCache } from '../../../packages/ui/soul3d/index.js';
import { soulModelUrl } from '../../../packages/ui/asset-map.js';
import { v2Config, v3Config, faceDataFixture, stubFaceData } from '../../../packages/ui/test/decor-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const FACE = faceDataFixture();

/** Records what each render drew: the body and die-cut hull buffers and the names of the decoration parts. */
class FakeRenderer {
  static last = null;
  constructor({ canvas }) { this.canvas = canvas; this.renders = []; FakeRenderer.last = this; }
  setPixelRatio() {} setSize() {} setClearColor() {} setViewport() {} setScissor() {} setScissorTest() {} clear() {} dispose() {} forceContextLoss() {}
  render(scene) {
    const r = { body: null, hull: null, parts: [] };
    scene.traverse((o) => {
      if (o.isMesh && o.material.isMeshPhysicalMaterial) r.body = o.geometry.attributes.position;
      if (o.isMesh && o.material.isShaderMaterial && o.material.side === REAL.BackSide) r.hull = o.geometry.attributes.position;
      if (/^(plate|eyes|topper|face):/.test(o.name)) r.parts.push(o.name.split(':')[0]);
    });
    this.renders.push(r);
  }
}
class FakePMREM { fromScene() { return { texture: new REAL.Texture(), dispose() {} }; } dispose() {} }
const THREE = { ...REAL, WebGLRenderer: FakeRenderer, PMREMGenerator: FakePMREM };

/**
 * Stub GLTFLoader: bodies (one mesh per URL, remembered), textured charms, face kits, plates and eyes. A URL ending in
 * one of `hold` hangs until release().
 */
function stubLoader({ fail = [], hold = [] } = {}) {
  const calls = [], bodies = new Map(), held = [];
  class GLTFLoader {
    load(url, onLoad, _progress, onError) {
      calls.push(url);
      const path = url.split('?')[0];
      const finish = () => {
        if (fail.some((f) => path.endsWith(f))) { onError(new Error(`404 ${url}`)); return; }
        const scene = new REAL.Group();
        let asset = {};
        if (/\/body-[^/]+$/.test(path) || path.includes('/baseline/')) {
          const geo = new REAL.SphereGeometry(0.5, 8, 6);
          geo.setAttribute('color', new REAL.BufferAttribute(new Float32Array(geo.attributes.position.count * 4), 4));
          const mesh = new REAL.Mesh(geo, new REAL.MeshStandardMaterial());
          mesh.position.set(0, 1.12, 0); mesh.scale.setScalar(1.15);
          scene.add(mesh);
          bodies.set(url, geo.attributes.position);
          asset = { extras: { landmarks: { height: 2.29087, floor: -0.02189 } } };
        } else if (path.includes('/charms/')) {
          scene.add(new REAL.Mesh(new REAL.CircleGeometry(0.5, 8), new REAL.MeshStandardMaterial({ map: new REAL.Texture() })));
        } else {
          const mat = new REAL.MeshStandardMaterial({ color: 0xf7f8ff, emissive: /eyes-/.test(path) ? 0x333333 : 0, vertexColors: /eyes-/.test(path) });
          if (/eyes-/.test(path)) mat.userData.emissiveFromVertexColor = true;
          scene.add(new REAL.Mesh(new REAL.CircleGeometry(0.2, 8), mat));
        }
        onLoad({ scene, asset });
      };
      if (hold.some((h) => path.endsWith(h))) held.push(finish);
      else setTimeout(finish, 1);
    }
  }
  return { GLTFLoader, calls, bodies, release: () => { for (const f of held.splice(0)) f(); } };
}

async function until(fn, ms = 3000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
async function withStage(opts, fn) {
  globalThis.document = { createElement: () => ({ width: 0, height: 0, addEventListener() {}, removeEventListener() {} }) };
  clearSoulModelCache(); clearSoulDecorCache();
  const loader = stubLoader(opts.loader);
  const stage = createImpostorStage({ THREE, loadLoaders: async () => ({ GLTFLoader: loader.GLTFLoader }), faceData: opts.faceData, variantWaitMs: opts.variantWaitMs });
  try { await fn(stage, loader); } finally { stage.dispose(); delete globalThis.document; }
}
/** A bake job for the stage: records the render that drew it (or its failure). */
function job(soul, log) {
  return { key: impostorKey(soul.soulId, soul.badge, 96), soul, cell: 96, priority: 0, draw: () => log.push({ id: soul.soulId, drew: FakeRenderer.last.renders.at(-1) }), fail: () => log.push({ id: soul.soulId, failed: true }) };
}

test('impostor stage: both body variants load; each Soul bakes and flies on the body of its own variant (no die-cut hull on the big screen)', () => withStage({ faceData: FACE }, async (stage, loader) => {
  assert.equal(stage.warm(), 'loading');
  await until(() => stage.state === 'ready');
  for (const url of [soulModelUrl('hero'), soulModelUrl('lite'), FACE.body.hero, FACE.body.lite]) assert.equal(loader.calls.filter((u) => u === url).length, 1, `${url} loaded once`);
  const v3 = { soulId: 'soul_v3', config: v3Config(), badge: 'bingo-star' }, v2 = { soulId: 'soul_v2', config: v2Config(), badge: null };
  assert.equal(stage.accepts(v3, 'simple'), true); assert.equal(stage.accepts(v2, 'simple'), true);
  const log = [];
  stage.request(job(v3, log)); stage.request(job(v2, log));
  await until(() => { stage.pump(50); return log.length === 2; });
  const of = (id) => log.find((l) => l.id === id);
  assert.equal(of('soul_v3').drew.body, loader.bodies.get(FACE.body.hero), 'the v3 Soul on the v3 hero body');
  assert.equal(of('soul_v3').drew.hull, null, 'no white die-cut on the big screen (stage 15, D-36)');
  assert.deepEqual(of('soul_v3').drew.parts.sort(), ['eyes', 'face', 'plate', 'topper'], 'with its plate, eyes, refitted kit and antenna charm');
  assert.equal(of('soul_v2').drew.body, loader.bodies.get(soulModelUrl('hero')), 'the v2 Soul on the baseline');
  assert.equal(of('soul_v2').drew.hull, null);
  assert.deepEqual(of('soul_v2').drew.parts, ['face']);
  assert.equal(stage.stats.baked, 2); assert.equal(stage.stats.failed, 0);
  // the live Float entrance: the v3 figure on the v3 body
  const uv = stage.renderEntrances([{ ...v3, soulId: 'live_v3', phase: 'arc', t: 0.4, size: 72, scale: 1 }], 1);
  assert.ok(uv.has('live_v3'));
  assert.equal(FakeRenderer.last.renders.at(-1).body, loader.bodies.get(FACE.body.hero));
  assert.equal(loader.calls.filter((u) => u === FACE.body.hero).length, 1, 'cached: no second parse');
}));

test('impostor stage without the v3 body (stub face data): v2 Souls stay 3D, v3 Souls keep their 2D cell and entrance sprite', () => withStage({ faceData: stubFaceData() }, async (stage, loader) => {
  const v3 = { soulId: 'soul_v3', config: v3Config(), badge: null }, v2 = { soulId: 'soul_v2', config: v2Config(), badge: null };
  assert.equal(stage.accepts(v3, 'simple'), true, 'while loading the stage cannot tell yet');
  const log = [];
  stage.request(job(v3, log));
  await until(() => stage.state === 'ready');
  assert.ok(!loader.calls.some((u) => u.includes('/v3/body-')), 'no v3 body URL to ask for');
  assert.equal(stage.accepts(v3, 'simple'), false, 'ready without the v3 body: the atlas draws the 2D composition');
  assert.equal(stage.accepts(v2, 'simple'), true);
  stage.request(job(v2, log));
  await until(() => { stage.pump(50); return log.length === 2; });
  assert.deepEqual(log.find((l) => l.id === 'soul_v3'), { id: 'soul_v3', failed: true }, 'the queued v3 bake falls back to 2D');
  assert.equal(log.find((l) => l.id === 'soul_v2').drew.body, loader.bodies.get(soulModelUrl('hero')));
  const uv = stage.renderEntrances([{ ...v3, soulId: 'live_v3', phase: 'arc', t: 0.4, size: 72 }, { ...v2, soulId: 'live_v2', phase: 'arc', t: 0.4, size: 72 }], 1);
  assert.deepEqual([...uv.keys()], ['live_v2'], 'the v3 entrance flies its atlas sprite');
  assert.equal(stage.state, 'ready', 'one missing variant never fails the stage');
}));

test('impostor stage with no body at all fails as before (everything falls back to 2D)', () => withStage({ faceData: FACE, loader: { fail: ['.glb'] } }, async (stage) => {
  stage.warm();
  await until(() => stage.state === 'failed');
  assert.match(stage.stats.error, /Soul body models unavailable/);
  assert.equal(stage.accepts({ soulId: 'a', config: v3Config() }), false);
}));

test('impostor stage: a body download that hangs never fails the stage; the other variant makes it ready and the late one joins when it lands', () => withStage({ faceData: FACE, loader: { hold: ['/v3/body-hero.glb'] }, variantWaitMs: 60 }, async (stage, loader) => {
  const v3 = { soulId: 'soul_v3', config: v3Config(), badge: null }, v2 = { soulId: 'soul_v2', config: v2Config(), badge: null };
  stage.warm();
  await until(() => stage.state === 'ready');
  assert.equal(stage.accepts(v2, 'simple'), true, 'ready on the baseline alone');
  assert.equal(stage.accepts(v3, 'simple'), false, 'the v3 body is late: v3 Souls keep their 2D composition meanwhile');
  loader.release();
  await until(() => stage.accepts(v3, 'simple'));
  const log = [];
  stage.request(job(v3, log));
  await until(() => { stage.pump(50); return log.length === 1; });
  assert.equal(log[0].drew.body, loader.bodies.get(FACE.body.hero), 'the late v3 body is used once it lands');
  assert.equal(stage.state, 'ready');
}));

test('plan and source: v3 configs are decorated Souls for the impostor plan; the 3D Float entrance goes through the variant-aware stage', () => {
  assert.equal(wantsImpostor({ soulId: 'a', config: v3Config() }), true);
  assert.equal(wantsImpostor({ soulId: 'a', config: v3Config() }, 'dot'), false);
  const impostor = readFileSync(resolve(here, '../src/renderer/impostor.js'), 'utf8'), three = readFileSync(resolve(here, '../src/renderer/three.js'), 'utf8');
  assert.match(impostor, /loadSoulModels\(mods, 'high', \{ variant, face: faceData \}\)/);
  assert.match(impostor, /Promise\.all\(\[load\('v2'\), load\('v3'\)\]\)/);
  assert.match(impostor, /models\[soulBodyVariant\(soul && soul\.config\)\]/);
  assert.match(impostor, /const KEEPER_CONFIG = Object\.freeze\(\{ version: 2, /, 'the keeper config is unchanged');
  assert.match(three, /impostors\.renderLive\(liveItems, pr, \{ reducedMotion \}\)/, 'entrances, the visit and the performers go live through one stage');
  assert.match(three, /for \(const e of f\.entrances\) liveItems\.push\(\{ \.\.\.e, role: 'entrance' \}\)/);
});
