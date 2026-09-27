// Decorated Souls on the public Galaxy (D-29): the node-testable parts of the 3D impostors and the Float entrance -
// plan (keys, tiles, uv, poses, queue, budget), the atlas's 2D v4 composition (SVG without image layers + drawImage of
// the face / charm sprites) and its hand-off to and from the impostor stage, the entrance data the stage poses from, and
// the source-level guarantees (one shared soul3d rig with the phone, GLTFLoader only on demand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { IMPOSTOR, wantsImpostor, impostorKey, tileRect, tileUv, liveTileSize, entrancePose, ENTRANCE_POSE, createBakeQueue, pumpBudget } from '../src/renderer/impostor-plan.js';
import { createAtlas, spriteRects } from '../src/renderer/atlas.js';
import { createScene } from '../src/renderer/scene.js';
import { createEntranceQueue } from '../src/entrance-queue.js';
import { soulSpriteLayers, VIEWBOX } from '../../../packages/ui/soul-renderer.js';
import { decorFixture, v2Config, neutralV2 } from '../../../packages/ui/test/decor-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(resolve(here, '../src', p), 'utf8');
const v1 = { seed: 'v1soul', body: 0, palette: 2, eyes: 0, antenna: 0, mouth: 0, glow: 0, constellation: [], driftPhase: 0.1 };

test('plan: only decorated (v2) Souls at a sprite level get impostors; the key ignores the detail level', () => {
  assert.equal(wantsImpostor({ soulId: 'a', config: v2Config() }), true);
  assert.equal(wantsImpostor({ soulId: 'a', config: neutralV2() }), true, 'the neutral v2 Soul is still the 3D gradient Soul');
  assert.equal(wantsImpostor({ soulId: 'a', config: v1 }), false, 'v1 Souls keep their 2D sprite (exactly as before)');
  assert.equal(wantsImpostor({ soulId: 'a', config: v2Config() }, 'dot'), false, 'dots stay 2D');
  assert.equal(wantsImpostor(null), false);
  assert.equal(impostorKey('soul_1', 'bingo-star', 96), 'soul_1|3d|bingo-star|96');
  assert.equal(impostorKey('soul_1', null, 96), 'soul_1|3d||96');
  assert.notEqual(impostorKey('soul_1', null, 96), impostorKey('soul_1', null, 128), 'cached per cell');
});

test('plan: tiles tile the square stage, uv rects map back to the rendered squares, live tiles are supersampled and capped', () => {
  const per = IMPOSTOR.stage / IMPOSTOR.tile;
  assert.equal(per, 3); assert.equal(IMPOSTOR.bakeTile, per * per - 1);
  const seen = new Set();
  for (let i = 0; i < per * per; i++) {
    const r = tileRect(i, { size: 200 });
    assert.ok(r.x + r.size <= IMPOSTOR.stage && r.y + r.size <= IMPOSTOR.stage && r.x >= 0 && r.y >= 0);
    assert.equal(r.glY, IMPOSTOR.stage - r.y - r.size, 'GL rows count from the bottom');
    seen.add(`${r.x},${r.y}`);
    const uv = tileUv(r);
    assert.equal(uv.u0 * IMPOSTOR.stage, r.x); assert.equal(uv.u1 * IMPOSTOR.stage, r.x + r.size);
    assert.equal(uv.v1 * IMPOSTOR.stage, r.y, 'v1 = the top row (flipY false, like the atlas pages)');
    assert.equal(uv.v0 * IMPOSTOR.stage, r.y + r.size);
  }
  assert.equal(seen.size, per * per, 'no two tiles overlap');
  assert.equal(tileRect(0, { size: 999 }).size, IMPOSTOR.tile);
  assert.equal(liveTileSize(72, 1, 1), 108, '1.5 x like the atlas cells');
  assert.equal(liveTileSize(72, 1.12, 2), 242);
  assert.equal(liveTileSize(128, 1, 2), IMPOSTOR.tile, 'capped by the tile');
  assert.ok(liveTileSize(0) >= 8);
});

test('entrance pose: turns from side-on to rest along the arc, one die-cut flash at the pulse, exactly at rest while settling', () => {
  const a0 = entrancePose('arc', 0), a1 = entrancePose('arc', 1);
  assert.equal(a0.yaw, ENTRANCE_POSE.turnRad); assert.equal(a0.outline, 1);
  assert.equal(a1.yaw, 0); assert.ok(Math.abs(a1.lift) < 1e-12, 'the arc ends at rest');
  let prev = Infinity;
  for (let t = 0; t <= 1.0001; t += 0.05) { const y = entrancePose('arc', t).yaw; assert.ok(y <= prev + 1e-12); prev = y; }
  for (let t = 0; t <= 1; t += 0.05) assert.ok(Math.abs(entrancePose('arc', t).lift) <= ENTRANCE_POSE.bobAmplitude + 1e-12);
  const flashes = []; for (let t = 0; t <= 1.0001; t += 0.01) flashes.push(entrancePose('pulse', t).outline);
  assert.equal(flashes[0], 1); assert.ok(Math.abs(flashes.at(-1) - 1) < 1e-9);
  const peak = flashes.indexOf(Math.max(...flashes));
  assert.ok(flashes.slice(0, peak).every((v, i, arr) => i === 0 || v >= arr[i - 1]) && flashes.slice(peak).every((v, i, arr) => i === 0 || v <= arr[i - 1]), 'one rise, one fall (flash-safe)');
  assert.ok(Math.max(...flashes) <= 1 + ENTRANCE_POSE.flashBoost + 1e-12);
  for (const phase of ['settle', 'fade', 'done', 'waiting']) assert.deepEqual(entrancePose(phase, 0.4), { yaw: 0, lift: 0, outline: 1 }, `${phase}: the impostor pose`);
  assert.deepEqual(entrancePose('arc', 0.2, { reducedMotion: true }), { yaw: 0, lift: 0, outline: 1 }, 'reduced motion: no turn, no bob, no flash');
});

test('bake queue: one job per key, entrances first, FIFO otherwise, only jobs whose decorations are ready', () => {
  const q = createBakeQueue();
  q.add({ key: 'a', priority: 0 }); q.add({ key: 'b', priority: 0 }); q.add({ key: 'c', priority: 1 }); q.add({ key: 'a', priority: 0 });
  assert.equal(q.size, 3);
  assert.equal(q.take().key, 'c', 'the entrance first');
  assert.equal(q.take((j) => j.key !== 'a').key, 'b', 'a job still waiting on its decor is skipped');
  q.add({ key: 'a', priority: 1 });
  assert.equal(q.size, 1);
  assert.equal(q.take().priority, 1, 'a later entrance request raises the priority of a queued bake');
  assert.equal(q.take(), null);
  q.add({ key: 'x' }); q.add({ key: 'y' });
  assert.deepEqual(q.drain().map((j) => j.key), ['x', 'y']); assert.equal(q.size, 0);
  assert.equal(pumpBudget(2), IMPOSTOR.budgetMs, 'a light frame leaves the full bake budget');
  assert.equal(pumpBudget(30), 2, 'a heavy frame still bakes a little');
});

// ---- atlas with a minimal fake DOM (canvas 2D contexts that record drawImage, Images that load asynchronously) ----
function withFakeDom(fn) {
  const draws = [];
  const loads = [];
  const ctx = (canvas) => ({ canvas, clearRect() {}, drawImage(img, ...args) { draws.push({ src: img.src || img.tag, args }); }, getContext: null });
  globalThis.document = { createElement: () => { const c = { width: 0, height: 0, tag: 'canvas' }; c.getContext = () => ctx(c); return c; } };
  globalThis.Image = class { set src(v) { this._src = v; loads.push(v); setTimeout(() => (/missing/.test(v) ? this.onerror && this.onerror() : this.onload && this.onload()), 1); } get src() { return this._src; } };
  return fn({ draws, loads }).finally(() => { delete globalThis.document; delete globalThis.Image; });
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('atlas 2D v4 composition: the SVG rasterised without image layers, then the face and charm sprites drawn into the cell', () => withFakeDom(async ({ draws, loads }) => {
  const atlas = createAtlas({ maxDetail: 'simple' });
  const soul = { soulId: 'soul_v2', config: v2Config(), badge: null };
  const e = atlas.get(soul, 'full', 72);
  assert.equal(e.impostor, false, 'no impostor stage attached: 2D');
  await settle();
  assert.equal(e.ready, true);
  const svgUrl = loads.find((u) => u.startsWith('data:image/svg+xml'));
  assert.ok(svgUrl && !decodeURIComponent(svgUrl).includes('<image'), 'SVG-as-image cannot load external images: the layers are not in it');
  const layers = soulSpriteLayers(soul.config);
  assert.deepEqual(loads.filter((u) => !u.startsWith('data:')), layers.map((l) => l.href), 'sprites loaded by URL (none while the decor data is the stub)');
  // with usable decor data the layers are drawn over the SVG at their viewBox rects scaled to the cell
  const fx = soulSpriteLayers(soul.config, { decor: decorFixture() });
  const rects = spriteRects(fx, 128, 256, 64);
  assert.equal(rects.length, 11);
  assert.deepEqual(rects[0], { href: fx[0].href, kind: 'face', x: 256, y: 64, w: 128, h: 128 }, 'the face sprite covers the whole cell');
  const k = 128 / VIEWBOX;
  rects.slice(1).forEach((r, i) => { assert.ok(Math.abs(r.x - (256 + fx[i + 1].x * k)) < 1e-9 && Math.abs(r.w - fx[i + 1].w * k) < 1e-9); });
  // v1 stays the plain v3 sprite: one SVG, no sprite loads
  const before = loads.length;
  atlas.get({ soulId: 'soul_v1', config: v1 }, 'full', 72);
  await settle();
  assert.equal(loads.length, before + 1);
  assert.ok(draws.length >= 2);
}));

test('atlas hands v2 cells to the impostor stage (cached by soul, badge, cell), falls back to 2D when the stage fails or leaves', () => withFakeDom(async ({ loads }) => {
  const jobs = [];
  const stage = { failed: false, accepts(soul, d) { return !this.failed && wantsImpostor(soul, d); }, request(job) { jobs.push(job); return true; } };
  const atlas = createAtlas({ maxDetail: 'simple' });
  atlas.setImpostors(stage);
  const soul = { soulId: 'soul_3d', config: v2Config({ face: 'angel' }), badge: 'bingo-star' };
  const e = atlas.get(soul, 'full', 72, { priority: 1 });
  assert.equal(e.impostor, true); assert.equal(e.key, impostorKey('soul_3d', 'bingo-star', 128));
  assert.equal(atlas.get(soul, 'simple', 72), e, 'one impostor for every sprite level at that cell');
  assert.equal(jobs.length, 1); assert.equal(jobs[0].priority, 1); assert.equal(jobs[0].cell, 128);
  assert.equal(e.ready, false, 'placeholder until baked');
  const v0 = atlas.version;
  jobs[0].draw({ tag: 'stage-canvas' }, 512, 512, 128);
  assert.equal(e.ready, true); assert.ok(atlas.version > v0);
  assert.equal(loads.length, 0, 'an impostor cell never rasterises the SVG');
  // v1 and dot Souls never go to the stage
  atlas.get({ soulId: 'old', config: v1 }, 'full', 72);
  atlas.get({ soulId: 'dense', config: v2Config() }, 'dot', 20);
  assert.equal(jobs.length, 1);
  // a failed bake falls back to the 2D composition in the same cell
  const other = atlas.get({ soulId: 'soul_b', config: v2Config() }, 'full', 72);
  jobs[1].fail();
  await settle();
  assert.equal(other.ready, true); assert.equal(other.impostor, false);
  // once the stage is detached (renderer switch), new cells are 2D
  atlas.setImpostors(null);
  const flat = atlas.get({ soulId: 'soul_c', config: v2Config() }, 'full', 72);
  assert.equal(flat.impostor, false); assert.ok(!flat.key.includes('|3d|'));
  assert.equal(jobs.length, 2);
}));

test('Float entrance items carry phase and t (the stage poses the live 3D Soul from them) and the settled Soul keeps its size', () => {
  const queue = createEntranceQueue({ arcMs: 1000, pulseMs: 400, settleMs: 600 });
  const scene = createScene({ queue });
  scene.resize(1248, 1080);
  scene.setSouls([{ soulId: 'a', config: v1 }]);
  scene.addSoul({ soulId: 'b', config: v2Config() });
  queue.enqueue('b', 0);
  const f = scene.frame(0.5, 500);
  const e = f.entrances.find((x) => x.soulId === 'b');
  assert.equal(e.phase, 'arc'); assert.equal(e.t, 0.5); assert.equal(e.detail, 'full');
  assert.equal(e.size, f.spritePx, 'same size as every settled Soul (BR-17)');
  const done = scene.frame(3, 3000);
  assert.ok(done.souls.some((x) => x.soulId === 'b' && x.size === done.spritePx), 'settled: a normal orbit item (drawn from the impostor)');
});

test('source guarantees: the Galaxy renders decorated Souls with the phone\'s soul3d rig and card studio; GLTFLoader loads only on demand', () => {
  const impostor = src('renderer/impostor.js'), three = src('renderer/three.js'), atlas = src('renderer/atlas.js');
  const phone = readFileSync(resolve(here, '../../employee-mobile/src/scene/soul-scene.js'), 'utf8');
  assert.match(impostor, /import \{[^}]*buildSoulRig[^}]*createSoulCardStage[^}]*\} from '\.\.\/\.\.\/\.\.\/\.\.\/packages\/ui\/soul3d\/index\.js'/);
  assert.match(phone, /buildSoulRig\(THREE/, 'the phone reveal builds the same rig');
  assert.match(impostor, /const LOADERS_URL = '\/packages\/vendor\/three\/loaders\.js';/);
  assert.match(impostor, /import\(LOADERS_URL\)/, 'dynamic import, only when a v2 Soul asks');
  for (const s of [three, atlas, impostor]) assert.doesNotMatch(s, /^import[^;]*loaders\.js/m, 'no static loader import on the public screen');
  assert.match(three, /atlas\.setImpostors\(impostors\)/);
  assert.match(three, /afterFrame/);
  assert.match(src('galaxy.js'), /renderer\.afterFrame\(pumpBudget\(cost\)\)/, 'bakes run after the measured frame');
  assert.match(atlas, /images: false/, 'data: URL rasterisation omits the image layers');
  assert.doesNotMatch(impostor + atlas, /https?:\/\/|innerHTML|eval\(/);
});
