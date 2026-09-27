import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floatParams, floatOffset } from '../src/renderer/scene.js';
import { layoutViewport, selectLod, bucketFor, placeSouls, orbitPosition, spriteSizePx, cameraOffset, starAlpha, clusterSouls, createScene, activeRingCount, DEFAULT_RINGS, DEFAULT_SCENE_CONFIG, entranceStart, arcPoint } from '../src/renderer/scene.js';
import { soulOrbitSlot, ORBIT_RINGS } from '../../../packages/ui/soul-renderer.js';
import { createEntranceQueue } from '../src/entrance-queue.js';

const souls = (n) => Array.from({ length: n }, (_, i) => ({ soulId: `soul_${i}`, config: { seed: `s${i}`, body: i % 6, palette: i % 8, driftPhase: (i % 10) / 10 }, badge: null, edge: 'bottom' }));

test('layout: galaxy region is 70 % of 1920 (D-52) and scales by height', () => {
  const g = layoutViewport(1344, 1080);
  assert.equal(g.cx, 672); assert.equal(g.cy, 540); assert.equal(g.scale, 1);
  const l = layoutViewport(1248, 1080);
  assert.equal(l.cx, 624); assert.equal(l.cy, 540); assert.equal(l.halfH, 540); assert.equal(l.scale, 1); assert.equal(l.innerMargin, 32);
  assert.equal(layoutViewport(624, 540).scale, 0.5);
  assert.equal(DEFAULT_SCENE_CONFIG.safeZone.panelX, 1344); assert.equal(DEFAULT_SCENE_CONFIG.safeZone.galaxyWidthPx, 1344);
});

test('LOD selection follows scene-config thresholds (count and sprite size)', () => {
  assert.equal(selectLod(10, 30), 'full');
  assert.equal(selectLod(120, 30), 'full');
  assert.equal(selectLod(121, 30), 'simple');
  assert.equal(selectLod(121, 56), 'full');
  assert.equal(selectLod(300, 10), 'simple');
  assert.equal(selectLod(301, 10), 'dot');
  assert.equal(selectLod(301, 24), 'simple');
  assert.equal(bucketFor(20), 32); assert.equal(bucketFor(33), 64); assert.equal(bucketFor(128), 128); assert.equal(bucketFor(500), 192);
});

test('sprite size is identical for every Soul and shrinks as rings open', () => {
  const l = layoutViewport(1248, 1080);
  const s6 = spriteSizePx(l, 6), s40 = spriteSizePx(l, 40), s300 = spriteSizePx(l, 300), s588 = spriteSizePx(l, 588);
  assert.ok(s6 >= s40 && s40 >= s300 && s300 >= s588, `${s6} ${s40} ${s300} ${s588}`);
  assert.ok(s588 >= 20 && s6 <= 140);
  assert.equal(activeRingCount(6), 1); assert.equal(activeRingCount(7), 2); assert.equal(activeRingCount(588), 9);
});

test('orbit placement resolves collisions by scanning forward in the ring and is deterministic', () => {
  const list = souls(80);
  const a = placeSouls(list);
  const b = placeSouls(list);
  assert.equal(a.size, 80);
  const keys = new Set();
  for (const [id, p] of a) {
    assert.ok(!keys.has(`${p.ring}:${p.slot}`), `duplicate slot for ${id}`);
    keys.add(`${p.ring}:${p.slot}`);
    assert.deepEqual(p, b.get(id));
    assert.ok(p.slot < ORBIT_RINGS[p.ring].capacity);
  }
  // force a collision: two ids that hash to the same ring/slot get distinct slots, the later one scans forward
  const ids = new Map();
  let pair = null;
  for (let i = 0; i < 5000 && !pair; i++) {
    const s = soulOrbitSlot(`c${i}`, 6); // single ring active -> ring 0, 6 slots
    const k = `${s.ring}:${s.slot}`;
    if (ids.has(k)) pair = [ids.get(k), `c${i}`]; else ids.set(k, `c${i}`);
  }
  assert.ok(pair, 'expected a colliding pair');
  const p = placeSouls([{ soulId: pair[0] }, { soulId: pair[1] }]);
  const first = p.get(pair[0]), second = p.get(pair[1]);
  assert.equal(first.ring, second.ring);
  assert.notEqual(first.slot, second.slot);
  assert.equal(second.slot, (first.slot + 1) % ORBIT_RINGS[first.ring].capacity);
});

test('existing placements stay stable when new Souls arrive; overflow spills outward', () => {
  const first = placeSouls(souls(10));
  const more = placeSouls(souls(30), first);
  for (const [id, p] of first) assert.deepEqual(more.get(id), p);
  const full = placeSouls(souls(600));
  assert.equal(full.size, 600);
});

test('every orbit position stays inside the Galaxy viewport (never crosses the panel)', () => {
  const l = layoutViewport(1248, 1080);
  const list = souls(588);
  const p = placeSouls(list);
  const size = spriteSizePx(l, list.length);
  for (const [id, pl] of p) {
    for (const t of [0, 10, 100, 1000]) {
      const pos = orbitPosition(pl, t, l, { spriteHalf: size / 2, driftPhase: 0.3 });
      assert.ok(pos.x >= -size && pos.x <= l.width, `${id} x=${pos.x} at t=${t}`);
      assert.ok(pos.y >= -size - 20 && pos.y <= l.height + size + 20, `${id} y=${pos.y}`);
    }
  }
});

test('reduced motion freezes orbit, bob and camera', () => {
  const l = layoutViewport(1248, 1080);
  const pl = placeSouls(souls(3)).get('soul_0');
  const a = orbitPosition(pl, 0, l, { reducedMotion: true }), b = orbitPosition(pl, 500, l, { reducedMotion: true });
  assert.deepEqual(a, b);
  assert.deepEqual(cameraOffset(12, l, DEFAULT_SCENE_CONFIG.camera, true), { dx: 0, dy: 0 });
  const c = cameraOffset(12, l);
  assert.ok(Math.abs(c.dx) <= 0.015 * 1080 + 1e-9 && Math.abs(c.dy) <= 0.015 * 1080 + 1e-9);
});

test('float (D-36): every Soul drifts on its own path, within +-22 % of its size, slowly, and not in step with its neighbours', () => {
  const l = layoutViewport(1248, 1080);
  const list = souls(40);
  const p = placeSouls(list);
  const size = spriteSizePx(l, list.length);
  const a = placeSouls(list);
  const params = new Set();
  for (const [id, pl] of p) {
    assert.deepEqual(pl.float, a.get(id).float, 'fixed by the id');
    params.add(JSON.stringify(pl.float));
    let maxSpeed = 0, prev = null;
    for (let t = 0; t <= 60; t += 0.05) {
      const o = floatOffset(pl.float, t, size);
      assert.ok(Math.abs(o.dx) <= 0.22 * size + 1e-9 && Math.abs(o.dy) <= 0.22 * size + 1e-9, `${id} offset ${o.dx},${o.dy}`);
      if (prev) maxSpeed = Math.max(maxSpeed, Math.hypot(o.dx - prev.dx, o.dy - prev.dy) / 0.05);
      prev = o;
    }
    assert.ok(maxSpeed <= 0.5 * size, `${id} drifts at most half its size per second (${maxSpeed.toFixed(1)} px/s)`);
    assert.ok(pl.float.bob >= 5 && pl.float.bob <= 8);
  }
  assert.equal(params.size, p.size, 'no two Souls share a float');
  // neighbours move differently: the same instant gives different offsets
  const [first, second] = [...p.values()];
  assert.notDeepEqual(floatOffset(first.float, 7, size), floatOffset(second.float, 7, size));
  // placements made before D-36 (no float) keep the old ring turn and 6 s bob
  const bare = { ...first }; delete bare.float;
  const pos = orbitPosition(bare, 3, l, { spriteHalf: size / 2 });
  assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y));
  assert.deepEqual(floatParams('soul_x'), floatParams('soul_x'));
});

test('float + orbit stay inside the Galaxy viewport, and reduced motion freezes the float too', () => {
  const l = layoutViewport(1248, 1080);
  for (const n of [6, 40, 120, 588]) {
    const list = souls(n);
    const p = placeSouls(list);
    const size = spriteSizePx(l, n);
    for (const pl of p.values()) {
      for (let t = 0; t <= 300; t += 7.3) {
        const pos = orbitPosition(pl, t, l, { spriteHalf: size / 2, driftPhase: 0.3 });
        assert.ok(pos.x >= -size / 2 && pos.x <= l.width + size / 2, `x=${pos.x} (n=${n}, t=${t})`);
      }
      assert.deepEqual(orbitPosition(pl, 0, l, { reducedMotion: true, spriteHalf: size / 2 }), orbitPosition(pl, 123, l, { reducedMotion: true, spriteHalf: size / 2 }));
    }
  }
});

test('star twinkle stays within the layer amplitude', () => {
  const layer = { twinkleAmplitude: 0.08, twinklePeriodSeconds: 9 };
  const star = { b: 0.5, t: 0.3 };
  for (let t = 0; t < 20; t += 0.37) { const a = starAlpha(star, t, layer); assert.ok(a >= 0.5 * 0.92 - 1e-9 && a <= 0.5 * 1.08 + 1e-9); }
  assert.equal(starAlpha(star, 4, layer, false), 0.5);
});

test('clusters aggregate rings 7-8 into 96 px cells and keep inner rings individual', () => {
  const items = [
    { ring: 8, x: 10, y: 10, soulId: 'a', config: {} }, { ring: 8, x: 20, y: 20, soulId: 'b', config: {} }, { ring: 7, x: 500, y: 500, soulId: 'c', config: {} }, { ring: 2, x: 15, y: 15, soulId: 'd', config: {} },
  ];
  const { souls: rest, clusters } = clusterSouls(items, 96);
  assert.equal(rest.length, 1); assert.equal(rest[0].soulId, 'd');
  assert.equal(clusters.length, 2);
  assert.equal(clusters.find(c => c.count === 2).x, 15);
});

test('entrance geometry starts 8 % outside the chosen edge and ends at the slot', () => {
  const l = layoutViewport(1248, 1080);
  const target = { x: 600, y: 500 };
  assert.ok(entranceStart('bottom', target, l).y > l.height);
  assert.ok(entranceStart('left', target, l).x < 0);
  assert.ok(entranceStart('right', target, l).x > l.width);
  assert.ok(entranceStart('top', target, l).y < 0);
  const s = entranceStart('bottom', target, l);
  assert.deepEqual(arcPoint(s, target, 0, l), s);
  const end = arcPoint(s, target, 1, l);
  assert.ok(Math.abs(end.x - target.x) < 1e-6 && Math.abs(end.y - target.y) < 1e-6);
});

test('scene frame: snapshot Souls orbit without entrance; live Float animates once then settles', () => {
  const queue = createEntranceQueue({ maxConcurrent: 6, arcMs: 2200, pulseMs: 600, settleMs: 1200 });
  const scene = createScene({ config: DEFAULT_SCENE_CONFIG, rings: DEFAULT_RINGS, starLayers: [{ layer: 1, parallax: 0.15, twinkleAmplitude: 0.08, twinklePeriodSeconds: 9, color: '#fff', stars: [{ x: 0.5, y: 0.5, r: 1, b: 0.5, t: 0 }] }], queue });
  scene.resize(1248, 1080);
  scene.setSouls(souls(5));
  let f = scene.frame(0, 0);
  assert.equal(f.souls.length, 5); assert.equal(f.entrances.length, 0); assert.equal(f.detail, 'full');
  assert.equal(f.stars[0].points.length, 1);
  assert.ok(f.rings.length === 9);
  assert.ok(scene.addSoul({ soulId: 'new', config: { seed: 'n' }, edge: 'left' }));
  assert.equal(queue.enqueue('new', 1000), 'active');
  f = scene.frame(1, 1500);
  assert.equal(f.entrances.length, 1); assert.equal(f.entrances[0].phase, 'arc'); assert.equal(f.entrances[0].detail, 'full');
  f = scene.frame(3, 1000 + 2500);
  assert.equal(f.entrances[0].phase, 'pulse'); assert.ok(f.entrances[0].scale > 1 && f.entrances[0].scale <= 1.12);
  queue.update(1000 + 5000);
  f = scene.frame(5, 1000 + 5000);
  assert.equal(f.entrances.length, 0); assert.equal(f.souls.length, 6);
  // duplicate add is ignored
  assert.equal(scene.addSoul({ soulId: 'new', config: {} }), false);
});

test('scene: clusters kick in above 300 Souls and low quality drops rings/twinkle', () => {
  const scene = createScene({ config: DEFAULT_SCENE_CONFIG, rings: DEFAULT_RINGS, starLayers: [], quality: 'low' });
  scene.resize(1248, 1080);
  scene.setSouls(souls(320));
  const f = scene.frame(0, 0);
  assert.equal(f.rings.length, 0);
  assert.ok(['simple', 'dot'].includes(f.detail)); // 45 px sprite at 320 Souls -> simple per lod.simpleMinPx
  assert.ok(f.clusters.length > 0);
  assert.equal(f.souls.length + f.clusters.reduce((a, c) => a + c.count, 0), 320);
});
