import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forestLayout, forestWithinLimits, seededRandom, FOREST_LAYERS, FOREST_LIMITS } from '../src/renderer/forest.js';

test('seeded PRNG is deterministic and uniform-ish in [0,1)', () => {
  const a = seededRandom('arise-galaxy-2026'), b = seededRandom('arise-galaxy-2026');
  const seqA = Array.from({ length: 50 }, () => a()), seqB = Array.from({ length: 50 }, () => b());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every(v => v >= 0 && v < 1));
  const c = seededRandom('other');
  assert.notDeepEqual(seqA, Array.from({ length: 50 }, () => c()));
});

test('forest layout is deterministic per seed and layer, and differs across seeds / layers', () => {
  for (let layer = 0; layer < FOREST_LAYERS.length; layer++) {
    const x = forestLayout('arise-galaxy-2026', 1248, 1080, layer);
    const y = forestLayout('arise-galaxy-2026', 1248, 1080, layer);
    assert.equal(JSON.stringify(x), JSON.stringify(y), `layer ${layer} reproducible`);
    assert.equal(x.layer, FOREST_LAYERS[layer].name);
  }
  assert.notEqual(JSON.stringify(forestLayout('a', 1248, 1080, 2)), JSON.stringify(forestLayout('b', 1248, 1080, 2)));
  assert.notEqual(JSON.stringify(forestLayout('a', 1248, 1080, 1)), JSON.stringify(forestLayout('a', 1248, 1080, 2)));
});

test('forest shapes frame the left / top / bottom edges only and never reach the panel side', () => {
  for (let layer = 0; layer < FOREST_LAYERS.length; layer++) {
    const l = forestLayout('arise-galaxy-2026', 1248, 1080, layer);
    assert.ok(l.trees.length >= 2 && l.canopy.length >= 5 && l.bushes.length >= 6, `layer ${layer} has content`);
    assert.ok(forestWithinLimits(l), `layer ${layer} within limits`);
    // everything that could touch the right edge is a bottom bush (allowed, below the bottom limit)
    const rightMost = Math.max(...l.trees.flatMap(t => t.canopy.map(c => c.cx + c.r)), ...l.canopy.map(c => c.cx + c.r));
    assert.ok(rightMost <= 1248, 'canopy never exceeds the Galaxy width');
    assert.ok(l.trees.every(t => t.x + t.trunkW <= 1248 * FOREST_LIMITS.leftFraction));
  }
  assert.equal(forestLayout('s', 1248, 1080, 0).grass.length, 0, 'far layer has no grass');
  assert.ok(forestLayout('s', 1248, 1080, 2).grass.length > 50, 'near layer has grass');
});

test('forestWithinLimits rejects a shape that crosses into the Soul field', () => {
  const l = forestLayout('arise-galaxy-2026', 1248, 1080, 2);
  const bad = { ...l, canopy: [...l.canopy, { cx: 600, cy: 500, r: 80 }] };
  assert.equal(forestWithinLimits(bad), false);
});
