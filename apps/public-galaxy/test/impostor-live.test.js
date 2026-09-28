// Stage 15 (D-36) on the public Galaxy: the impostor stage renders more than Float entrances live - the Soul visiting the
// front to say hi and the Souls doing an idle micro action in orbit - in tile priority order (entrances, the visit, the
// performers), the visit in a 2 x 2 block that shrinks when entrances need the room, on acting rigs posed by
// actionPose (rest when there is no act), and nothing on the big screen has the white die-cut. Node with the vendored
// Three.js, a stand-in WebGLRenderer / PMREM and a stub GLTFLoader, plus source checks of the renderers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as REAL from '../../../packages/vendor/three/index.js';
import { createImpostorStage } from '../src/renderer/impostor.js';
import { IMPOSTOR, LIVE_ROLES, allocateLiveTile, blockTiles, tileRect, tileUv, liveTileSize } from '../src/renderer/impostor-plan.js';
import { createAtlas } from '../src/renderer/atlas.js';
import { atlasCellFor } from '../src/renderer/scene.js';
import { WINNER_LOOK } from '../src/renderer/three-quality.js';
import { clearSoulModelCache, clearSoulDecorCache, actionDuration } from '../../../packages/ui/soul3d/index.js';
import { renderSoulSvg } from '../../../packages/ui/soul-renderer.js';
import { v2Config, v3Config, faceDataFixture } from '../../../packages/ui/test/decor-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(resolve(here, '../src', p), 'utf8');
const FACE = faceDataFixture();

/** Records what each render drew: a die-cut hull? a skinned (acting) body? how many visible meshes. */
class FakeRenderer {
  static last = null;
  constructor({ canvas }) { this.canvas = canvas; this.renders = []; FakeRenderer.last = this; }
  setPixelRatio() {} setSize() {} setClearColor() {} setViewport(x, y, w) { this.viewport = w; } setScissor() {} setScissorTest() {} clear() {} dispose() {} forceContextLoss() {}
  render(scene) {
    const r = { hull: false, skinned: false, size: this.viewport };
    const visit = (o) => { if (!o.visible) return; if (o.isMesh && o.material.isShaderMaterial && o.material.side === REAL.BackSide) r.hull = true; if (o.isSkinnedMesh) r.skinned = true; for (const c of o.children) visit(c); };
    visit(scene);
    this.renders.push(r);
  }
}
class FakePMREM { fromScene() { return { texture: new REAL.Texture(), dispose() {} }; } dispose() {} }
const THREE = { ...REAL, WebGLRenderer: FakeRenderer, PMREMGenerator: FakePMREM };

/** Stub GLTFLoader: bodies (a sphere with an RGBA mask), textured charm discs, plain face parts. */
function stubLoader() {
  class GLTFLoader {
    load(url, onLoad) {
      const path = url.split('?')[0], scene = new REAL.Group();
      let asset = {};
      if (/\/body-[^/]+$/.test(path) || path.includes('/baseline/')) {
        const geo = new REAL.SphereGeometry(0.5, 8, 6);
        geo.setAttribute('color', new REAL.BufferAttribute(new Float32Array(geo.attributes.position.count * 4), 4));
        const mesh = new REAL.Mesh(geo, new REAL.MeshStandardMaterial()); mesh.position.set(0, 1.12, 0); mesh.scale.setScalar(1.15);
        scene.add(mesh);
        asset = { extras: { landmarks: { height: 2.29087, floor: -0.02189, eyes: [{ centre: [0.145, 1.175, 0.38] }, { centre: [-0.145, 1.175, 0.38] }] } } };
      } else if (path.includes('/charms/')) scene.add(new REAL.Mesh(new REAL.CircleGeometry(0.5, 8), new REAL.MeshStandardMaterial({ map: new REAL.Texture() })));
      else scene.add(new REAL.Mesh(new REAL.CircleGeometry(0.2, 8), new REAL.MeshStandardMaterial({ color: 0xf7f8ff })));
      setTimeout(() => onLoad({ scene, asset }), 1);
    }
  }
  return GLTFLoader;
}
async function until(fn, ms = 3000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); } }
async function withStage(fn) {
  globalThis.document = { createElement: () => ({ width: 0, height: 0, addEventListener() {}, removeEventListener() {} }) };
  clearSoulModelCache(); clearSoulDecorCache();
  const GLTFLoader = stubLoader();
  const stage = createImpostorStage({ THREE, loadLoaders: async () => ({ GLTFLoader }), faceData: FACE });
  try { stage.warm(); await until(() => stage.state === 'ready'); await fn(stage); } finally { stage.dispose(); delete globalThis.document; }
}
const soul = (id, over = {}) => ({ soulId: id, config: v3Config({ seed: id }), badge: null, x: 0, y: 0, size: 72, scale: 1, ...over });
const entrance = (id) => ({ ...soul(id), role: 'entrance', phase: 'arc', t: 0.4 });
const visit = (id, act = { action: 'wave', t: 1.2, side: 'left' }) => ({ ...soul(id), role: 'visit', scale: 3.2, phase: 'hi', t: 0.3, act });
const performer = (id, act = { action: 'sway', t: 1, side: 'right' }) => ({ ...soul(id), role: 'performer', act });
const tileOf = (uv) => { const x = Math.round(uv.u0 * IMPOSTOR.stage), y = Math.round(uv.v1 * IMPOSTOR.stage); return (y / IMPOSTOR.tile) * (IMPOSTOR.stage / IMPOSTOR.tile) + x / IMPOSTOR.tile; };

test('plan: 8 live tiles (never the bake tile), 2 x 2 blocks for the visit, a single tile when no block is free', () => {
  assert.deepEqual([...LIVE_ROLES], ['entrance', 'visit', 'performer']);
  assert.equal(IMPOSTOR.visitSpan, 2);
  assert.deepEqual(blockTiles(0, 2), [0, 1, 3, 4]); assert.deepEqual(blockTiles(3, 2), [3, 4, 6, 7]); assert.equal(blockTiles(2, 2), null, 'off the grid');
  assert.deepEqual(allocateLiveTile([], 2), { index: 0, span: 2, tiles: [0, 1, 3, 4] });
  assert.deepEqual(allocateLiveTile([0, 2], 2), { index: 3, span: 2, tiles: [3, 4, 6, 7] });
  assert.deepEqual(allocateLiveTile([0, 2, 4, 6], 2), { index: 1, span: 1, tiles: [1] }, 'no block free: one tile');
  assert.deepEqual(allocateLiveTile([3], 2).tiles, [1, 2, 4, 5]);
  const all = []; let t; while ((t = allocateLiveTile(all, 1))) all.push(...t.tiles);
  assert.deepEqual(all.sort(), [0, 1, 2, 3, 4, 5, 6, 7], 'every tile but the bake tile');
  assert.ok(!all.includes(IMPOSTOR.bakeTile));
  // a block renders up to 512 px; a visit at 3.2 x wants more than a tile
  assert.deepEqual(tileRect(3, { size: 999, span: 2 }), { x: 0, y: 256, glY: 0, size: 512 });
  assert.equal(tileRect(3, { size: 999 }).size, IMPOSTOR.tile);
  assert.equal(liveTileSize(72, 3.2, 1, { tile: 512 }), 461, 'D-57: 2 x supersampled, still inside the 512 px block');
  assert.equal(liveTileSize(72, 3.2, 2, { tile: 512 }), 512);
  assert.deepEqual(tileUv(tileRect(3, { size: 400, span: 2 })), { u0: 0, v0: 656 / 768, u1: 400 / 768, v1: 256 / 768 });
});

test('renderLive: entrances first, then the visit (2 x 2 block), then performers; the rest keep their atlas sprite; tiles stay put', () => withStage(async (stage) => {
  const R = () => FakeRenderer.last.renders;
  assert.ok(R().some((r) => r.skinned), 'the acting keeper was drawn mid-action once: the skinned program is compiled at init');
  assert.ok(R().every((r) => !r.hull), 'no die-cut hull on the big screen, not even in the keepers');
  const items = [entrance('e1'), entrance('e2'), entrance('e3'), visit('v1'), performer('p1'), performer('p2'), performer('p3')];
  // the order in which they arrive does not matter between roles: roles decide (within a role, first come first served)
  const uv = stage.renderLive([...items].reverse(), 1);
  assert.deepEqual(['e1', 'e2', 'e3'].map((id) => tileOf(uv.get(id))).sort(), [0, 1, 2]);
  assert.equal(tileOf(uv.get('v1')), 3, 'the visit takes the free block 3 4 6 7');
  assert.equal(uv.get('v1').size, liveTileSize(72, 3.2, 1, { tile: 512 }), 'rendered bigger than a tile');
  const lucky = ['p1', 'p2', 'p3'].filter((id) => uv.has(id));
  assert.equal(lucky.length, 1, 'one tile left: one performer; the others keep their baked sprite');
  assert.equal(tileOf(uv.get(lucky[0])), 5);
  assert.deepEqual(stage.stats.live.last, { entrance: 3, visit: 1, performer: 1, noTile: 2 });
  // next frame: the same items keep their tiles
  const again = stage.renderLive(items, 1);
  for (const id of ['e1', 'e2', 'e3', 'v1', lucky[0]]) assert.deepEqual(again.get(id), uv.get(id), `${id} stays put`);
  // two more entrances: the visit gives back three of its four tiles (the hero moment first), one entrance fits
  const more = stage.renderLive([...items, entrance('e4'), entrance('e5')], 1);
  assert.equal(tileOf(more.get('v1')), 3); assert.ok(more.get('v1').size <= IMPOSTOR.tile, 'the visit now in one tile');
  assert.deepEqual(['e4', 'e5'].map((id) => tileOf(more.get(id))).sort(), [4, 6]);
  // items that leave free their tiles: the next performer gets one
  const newcomer = ['p1', 'p2', 'p3'].find((id) => id !== lucky[0]);
  const later = stage.renderLive([entrance('e1'), visit('v1'), performer(newcomer)], 1);
  assert.equal(later.size, 3);
  assert.ok(later.has(newcomer), 'a performer that had no tile gets one once others leave');
  assert.equal(tileOf(later.get('e1')), tileOf(uv.get('e1')), 'e1 kept its tile');
}));

test('renderLive: performers and the visit act on acting rigs (rest pose without an act); entrances pose as before; no hull anywhere', () => withStage(async (stage) => {
  const R = FakeRenderer.last.renders;
  const n0 = R.length;
  stage.renderLive([performer('p1')], 1);
  assert.equal(R.at(-1).skinned, true, 'mid-action: the skinned figure');
  stage.renderLive([performer('p1', null)], 1);
  assert.equal(R.at(-1).skinned, false, 'no act: exactly the rest figure (its baked impostor)');
  stage.renderLive([performer('p1', { action: 'turn', t: actionDuration('turn'), side: 'left' })], 1);
  assert.equal(R.at(-1).skinned, false, 'an action at its end is the rest pose');
  stage.renderLive([visit('v1', null)], 1);
  assert.equal(R.at(-1).skinned, false, 'floating out and back: at rest');
  stage.renderLive([visit('v1')], 1);
  assert.equal(R.at(-1).skinned, true, 'waving hi');
  stage.renderLive([entrance('e1')], 1);
  assert.equal(R.at(-1).skinned, false, 'an entrance is a plain figure');
  assert.ok(R.slice(n0).every((r) => !r.hull));
  // unknown actions rest; a v1 Soul or a dot never goes live; reduced motion keeps only the entrances
  stage.renderLive([performer('p9', { action: 'dance', t: 1, side: 'left' })], 1);
  assert.equal(R.at(-1).skinned, false);
  const v1 = { ...performer('old'), config: { seed: 'old', palette: 2 } };
  assert.equal(stage.renderLive([v1], 1).size, 0);
  const calm = stage.renderLive([entrance('e1'), visit('v1'), performer('p1')], 1, { reducedMotion: true });
  assert.deepEqual([...calm.keys()], ['e1']);
  // a v2 Soul acts on the baseline body too
  const v2 = stage.renderLive([{ ...performer('b1'), config: v2Config({ seed: 'b1' }) }], 1);
  assert.ok(v2.has('b1') && R.at(-1).skinned);
}));

test('three.js: one live call for entrances, the visit and the performers; performers keep their depth place; the visit is drawn front-most', () => {
  const three = src('renderer/three.js');
  assert.match(three, /for \(const item of f\.souls\) if \(item\.act\) liveItems\.push\(\{ \.\.\.item, role: 'performer' \}\)/);
  assert.match(three, /for \(const v of visits\) liveItems\.push\(\{ \.\.\.v, role: 'visit' \}\)/);
  assert.match(three, /impostors\.renderLive\(liveItems, pr, \{ reducedMotion \}\)/);
  const souls = three.indexOf('for (const item of f.souls) drawSoul('), ents = three.indexOf('for (const e of f.entrances) {', souls), vis = three.indexOf('for (const v of visits) drawSoul(');
  assert.ok(three.indexOf('impostors.renderLive(') < souls && souls < ents && ents < vis, 'live renders first, then souls (far to near), entrances, the visit');
  assert.match(three, /drawSoul\(item, \{ detail: item\.detail, alpha: item\.alpha \?\? 1, scale: item\.scale \?\? 1, now, live: item\.act \? liveOf\(item\) : null, cellScale: [^}]*DEPTH\.scale\[1\], count: f\.souls\.length \}\)/, 'D-57: the orbit count caps the cell to the atlas pages');
  assert.match(three, /glow: VISIT_GLOW, now, priority: 1, live: liveOf\(v\)/);
  assert.doesNotMatch(three.slice(vis, three.indexOf('\n', vis)), /trail/, 'no trail for the visit');
  // one run per texture change keeps the draw order: an acting Soul among the others, not after all of them
  assert.match(three, /if \(!b \|\| b\.material\.uniforms\.uMap\.value !== tex \|\| b\.full\)/);
  // no white die-cut: the hull only during the winner flash, and premultiplied page / live textures (no fringe)
  assert.match(three, /const hull = \(texelsPerPx\) => \(flash > 0 \? hullPx\(size\) \* texelsPerPx : 0\)/);
  assert.match(three, /vec3 base = c\.a > 0\.0 \? c\.rgb \/ c\.a : vec3\(0\.0\);/);
  assert.match(three, /vec3 rgb = base;\n  float outA = a;\n  if \(r > 0\.0\)/);
  assert.match(three, /canvasTexture\(p\.canvas, \{ flipY: false, premultiplied: true \}\)/);
  assert.match(three, /canvasTexture\(impostors\.canvas, \{ flipY: false, premultiplied: true \}\)/);
  // the fallbacks draw the visit as a scaled sprite (no live actions there)
  assert.match(src('renderer/canvas2d.js'), /drawVisits\(f\);/);
  assert.match(src('renderer/webgl2.js'), /drawSpriteList\(visits, \(\) => 'full'\)/);
  for (const r of ['canvas2d.js', 'webgl2.js']) assert.doesNotMatch(src(`renderer/${r}`), /renderLive|actionPose/);
});

// ---- the atlas's 2D composition has no die-cut either (a minimal fake DOM, as in impostor.test.js) ----
test('atlas: the 2D cell is the SVG without the die-cut', async () => {
  const loads = [];
  globalThis.document = { createElement: () => { const c = { width: 0, height: 0 }; c.getContext = () => ({ clearRect() {}, drawImage() {} }); return c; } };
  globalThis.Image = class { set src(v) { this._src = v; loads.push(v); setTimeout(() => this.onload && this.onload(), 1); } get src() { return this._src; } };
  try {
    const cfg = v2Config();
    createAtlas({ maxDetail: 'simple' }).get({ soulId: 'soul_2d', config: cfg }, 'simple', 72);
    await new Promise((r) => setTimeout(r, 10));
    const svg = decodeURIComponent(loads.find((u) => u.startsWith('data:image/svg+xml')).split(',').slice(1).join(','));
    const cell = atlasCellFor(72);
    assert.equal(cell, 192, 'D-57: a 72 px Soul at dpr 1 gets a 192 px cell (2 x)');
    const opts = { size: cell, detail: 'simple', badge: null, reducedMotion: true, images: false, idPrefix: `pg-soul_2d-simple-${cell}` };
    assert.equal(svg, renderSoulSvg(cfg, { ...opts, dieCut: false }));
    assert.notEqual(svg, renderSoulSvg(cfg, opts), 'the default (phone) SVG keeps its die-cut');
  } finally { delete globalThis.document; delete globalThis.Image; }
});

// ---- the Bingo winner on the big screen (D-36): the gold crown on the stage's rigs, bigger and in gold in three.js ----
test('winner: every Galaxy rig crowns a winner (the GLB once loaded, primitives until then); three.js draws it 1.3x in gold', () => {
  const stage = src('renderer/impostor.js');
  assert.match(stage, /loadWinnerCrown\(mods\)\.then\(\(scene\) => \{ if \(scene\) crown = scene; \}\);/, 'the crown never holds up the stage');
  assert.equal((stage.match(/winnerCrown: crown \|\| true/g) || []).length, 2, 'the keeper (its shader program) and every Soul rig');
  const three = src('renderer/three.js');
  assert.match(three, /const won = item\.badge === 'bingo-star';/);
  assert.match(three, /const size = item\.size \* \(scale \|\| 1\) \* \(won \? WINNER_LOOK\.scale : 1\);/);
  assert.match(three, /if \(won\) halo\.push\(item\.x, item\.y \+ size \* 0\.04, size \* WINNER_LOOK\.halo, 0, 0, 1, 1, \.\.\.WINNER_LOOK\.rgb, \(WINNER_LOOK\.alpha \+ 0\.25 \* flash\) \* alpha\);/);
  assert.deepEqual({ ...WINNER_LOOK, rgb: [...WINNER_LOOK.rgb] }, { scale: 1.3, halo: 3.4, rgb: [1, 0.76, 0.28], alpha: 0.72 });
  assert.ok(WINNER_LOOK.halo > 2.1, 'wider than the palette light every Soul has (2.1 sizes)');
  // the 2D fallback tiers keep every Soul equal (the medallion on its sprite)
  for (const r of ['canvas2d.js', 'webgl2.js', 'static.js']) assert.doesNotMatch(src(`renderer/${r}`), /WINNER_LOOK|winnerCrown/);
});
