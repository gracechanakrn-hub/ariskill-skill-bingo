import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATLAS_CELLS, ATLAS_SUPERSAMPLE, ATLAS_MAX_PAGES, DEPTH, atlasCellFor, atlasFootprint, atlasCellPlan, stickerFeaturePx, bucketFor } from '../src/renderer/scene.js';
import { capDetail } from '../src/renderer/atlas.js';
import { outlineFlash, OUTLINE_FLASH, hullPx, HULL, pixelRatioFor } from '../src/renderer/three-quality.js';

test('atlas cells: 2 x the device size in 48..256 px steps (D-57: crisp on a 4K screen), capped by the crowd', () => {
  assert.deepEqual([...ATLAS_CELLS], [48, 64, 96, 128, 192, 256]);
  assert.equal(ATLAS_SUPERSAMPLE, 2);
  assert.equal(atlasCellFor(72), 192, '12-16 Souls at 1080p draw at 72 px');
  assert.equal(atlasCellFor(61), 128);
  assert.equal(atlasCellFor(46), 96, '120 Souls');
  assert.equal(atlasCellFor(34), 96, '300 Souls');
  assert.equal(atlasCellFor(26), 64, '450 Souls');
  assert.equal(atlasCellFor(72 * 2), 256, 'a 72 px Soul at dpr 2 (144 device px) gets the 256 px cell');
  assert.equal(atlasCellFor(72 * 2, 16), 256, '... also with its crowd of 16');
  assert.equal(atlasCellFor(400), 256, 'the largest cell caps');
  assert.equal(atlasCellFor(0), 48);
  for (const px of [20, 26, 34, 46, 61, 72, 100]) {
    const cell = atlasCellFor(px);
    // at least 2 x (D-57); at most 2 x the 1.5 x step between cells
    assert.ok(cell / px <= 3 && cell / px >= 2, `cell ${cell} for ${px} px is 2..3 x the device size`);
  }
  // memory guard: a crowd steps the cell down until it fits the page budget (no count: no cap)
  assert.equal(atlasCellFor(26 * DEPTH.scale[1] * 2), 192, '450 near-depth Souls at dpr 2 would want 192 px');
  assert.equal(atlasCellFor(26 * DEPTH.scale[1] * 2, 600), 128, '600 of them step down to 128 px (3 pages)');
  assert.equal(atlasCellFor(26 * DEPTH.scale[1] * 2, 450), 128);
  assert.equal(atlasCellFor(26 * DEPTH.scale[1] * 2, 300), 192, 'up to 300 Souls fit 192 px cells in 3 pages');
  assert.equal(atlasCellFor(26 * DEPTH.scale[1] * 2, 301), 128);
  // the legacy bucket table used by the raw renderers' tests is untouched
  assert.equal(bucketFor(20), 32);
});

test('atlas cells: measured plan for the venue layout (1248 x 1080, dpr 1) and the 450-Soul memory check', () => {
  const plan = Object.fromEntries([12, 16, 22, 120, 300, 450].map(n => [n, atlasCellPlan(n)]));
  assert.equal(plan[12].spritePx, 72); assert.equal(plan[12].cell, 192);
  assert.equal(plan[16].cell, 192);
  assert.equal(plan[22].cell, 128);
  assert.equal(plan[120].cell, 96);
  assert.equal(plan[300].cell, 96);
  assert.equal(plan[450].spritePx, 26); assert.equal(plan[450].cell, 64); assert.equal(plan[450].detail, 'simple');
  // 96-128 px cells keep the 3 px (at 240) die-cut >= 1.2 px and the large speckles >= 2.4 px in the texture
  assert.ok(stickerFeaturePx(96).dieCut >= 1.2 && stickerFeaturePx(128).speckleLarge >= 3.0);
  // memory: 450 Souls at their 64 px cell fit one 2048^2 page (16 MB), far under the 64 MB budget (3 pages)
  const fp = atlasFootprint(450, plan[450].cell);
  assert.equal(fp.pages, 1); assert.equal(fp.rows, 15); assert.ok(fp.usedBytes < 8 * 1024 * 1024);
  assert.ok(atlasFootprint(450, 128).pages <= 2, 'even 128 px cells for 450 Souls stay within two pages');
  // dpr 2 (a 4K screen): 12 Souls get 256 px cells; 600 Souls (high maxSouls) at 2 x 26 px -> 128 px cells -> 3 pages
  assert.equal(atlasCellPlan(12, 1248, 1080, 2).cell, 256);
  const dpr2 = atlasCellPlan(600, 1248, 1080, 2);
  assert.equal(dpr2.cell, 128); assert.ok(dpr2.footprint.pages <= ATLAS_MAX_PAGES, `dpr 2 worst case ${dpr2.footprint.pages} pages`);
  // three.js asks orbit cells at the near depth size (DEPTH.scale[1]) x its pixel ratio: every crowd up to 600 fits the
  // page budget at every quality level on a dpr 2 screen (uncapped, 193..600 Souls would need up to 6 pages)
  for (const q of ['high', 'medium', 'low']) {
    const k = DEPTH.scale[1] * pixelRatioFor(q, 2);
    for (let n = 1; n <= 600; n++) {
      const p = atlasCellPlan(n, 1248, 1080, k);
      if (p.footprint.pages > ATLAS_MAX_PAGES) assert.fail(`${q}: ${n} Souls need ${p.footprint.pages} pages of ${p.cell} px cells`);
    }
  }
  assert.equal(atlasCellPlan(600, 1248, 1080, DEPTH.scale[1] * 2).cell, 128, 'the full venue on 4K keeps 128 px cells (was 128 at 1.5 x)');
});

test('atlas detail cap: the Galaxy atlas renders the v2 simple sticker (full -> simple), dot stays dot', () => {
  assert.equal(capDetail('full'), 'simple');
  assert.equal(capDetail('simple'), 'simple');
  assert.equal(capDetail('dot'), 'dot');
  assert.equal(capDetail('full', 'full'), 'full');
  assert.equal(capDetail('simple', 'dot'), 'dot');
});

test('winner outline flash: 250 ms, one flip (hold then monotone fade, never re-rises), off outside the window', () => {
  assert.equal(OUTLINE_FLASH.ms, 250);
  assert.equal(outlineFlash(NaN, 100), 0);
  assert.equal(outlineFlash(1000, 999), 0);
  assert.equal(outlineFlash(1000, 1000), 1);
  assert.equal(outlineFlash(1000, 1100), 1, 'held for the first 60 %');
  let prev = 1;
  for (let t = 1150; t < 1250; t += 5) { const v = outlineFlash(1000, t); assert.ok(v <= prev && v >= 0, 'monotone fade'); prev = v; }
  assert.equal(outlineFlash(1000, 1250), 0);
  assert.equal(outlineFlash(1000, 5000), 0);
});

test('die-cut hull width scales with the sprite (3D spec 1.06 hull) between 1.5 and 4.5 screen px', () => {
  assert.equal(hullPx(72), Math.min(HULL.maxPx, 72 * HULL.ratio));
  assert.equal(hullPx(26), HULL.minPx);
  assert.equal(hullPx(400), HULL.maxPx);
  assert.ok(hullPx(46) > hullPx(26) && hullPx(72) > hullPx(46));
});
