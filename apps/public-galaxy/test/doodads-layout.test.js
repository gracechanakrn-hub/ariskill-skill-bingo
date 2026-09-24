import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOODAD_SET, DOODAD_RULES, doodadsForTier, doodadLayout, doodadExclusions, doodadOffset, doodadRect, rectsIntersect } from '../src/renderer/doodads-layout.js';
import { DOODAD_NAMES } from '../../../packages/ui/doodads.js';
import { DEFAULT_RINGS, layoutViewport, ringAspect, activeRingCount } from '../src/renderer/scene.js';

const W = 1248, H = 1080;
function outerFor(count) {
  const L = layoutViewport(W, H);
  const i = activeRingCount(count) - 1;
  const r = DEFAULT_RINGS.rings[i];
  return { rx: r.radius * L.halfH * ringAspect(i, L, DEFAULT_RINGS, 30), ry: r.radius * L.halfH };
}

test('doodad set: 5-8 sticker props from packages/ui/doodads.js (rocket, ufo, planet, comet, star)', () => {
  assert.ok(DOODAD_SET.length >= DOODAD_RULES.count.min && DOODAD_SET.length <= DOODAD_RULES.count.max);
  for (const d of DOODAD_SET) assert.ok(DOODAD_NAMES.includes(d.name), d.name);
  for (const n of ['rocket', 'ufo', 'planet', 'comet', 'star']) assert.ok(DOODAD_SET.some(d => d.name === n), n);
  assert.ok(!DOODAD_SET.some(d => d.name === 'medallion'), 'the medallion carries constellation lines, not a sky prop');
});

test('tier gating: doodads on high only, none on medium / low', () => {
  assert.equal(doodadsForTier('high'), DOODAD_SET.length);
  assert.equal(doodadsForTier('medium'), 0);
  assert.equal(doodadsForTier('low'), 0);
  assert.equal(doodadsForTier('nope'), 0);
  assert.equal(doodadLayout({ quality: 'medium', outer: outerFor(12) }).length, 0);
  assert.equal(doodadLayout({ quality: 'low', outer: outerFor(12) }).length, 0);
  assert.equal(doodadLayout({ quality: 'high', outer: outerFor(12) }).length, DOODAD_SET.length);
});

test('placement: deterministic per seed, outside the outermost open orbit, inside the region margins', () => {
  const a = doodadLayout({ seed: 'arise-galaxy-2026', outer: outerFor(16) });
  const b = doodadLayout({ seed: 'arise-galaxy-2026', outer: outerFor(16) });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.notEqual(JSON.stringify(a), JSON.stringify(doodadLayout({ seed: 'other', outer: outerFor(16) })));
  for (const count of [1, 16, 22, 120, 300]) {
    const outer = outerFor(count);
    const list = doodadLayout({ outer, exclusions: doodadExclusions() });
    const visible = list.filter(d => d.visible);
    assert.ok(visible.length >= 5, `${count} Souls: ${visible.length} doodads visible`);
    for (const d of visible) {
      const r = doodadRect(d);
      assert.ok(r.x >= DOODAD_RULES.marginPx && r.y >= DOODAD_RULES.marginPx && r.x + r.w <= W - DOODAD_RULES.marginPx && r.y + r.h <= H - DOODAD_RULES.marginPx, `${d.name} inside margins at ${count}`);
      // the doodad's centre lies outside the ellipse of the outermost open ring (never over the Soul field)
      const e = ((d.x - W / 2) / outer.rx) ** 2 + ((d.y - H / 2) / outer.ry) ** 2;
      assert.ok(e > 1, `${d.name} outside the orbit field at ${count} Souls`);
    }
  }
});

test('exclusion zones: never over the title caption, cluster labels, the panel side (canvas-bound) - hidden, not moved', () => {
  const caption = DOODAD_RULES.titleCaption;
  // ring 8 open (450 Souls): the top-left doodad would sit on the caption -> hidden; out-of-bounds ones hidden too
  const full = doodadLayout({ outer: outerFor(450), exclusions: doodadExclusions() });
  const hidden = full.filter(d => !d.visible);
  assert.ok(hidden.some(d => d.reason === 'caption'), 'caption exclusion applied');
  assert.ok(hidden.some(d => d.reason === 'bounds'), 'bounds exclusion applied');
  for (const d of full.filter(d => d.visible)) assert.ok(!rectsIntersect(doodadRect(d), caption));
  // a cluster label box under a cluster at a doodad's spot hides that doodad
  const list = doodadLayout({ outer: outerFor(16) });
  const target = list[0];
  const zones = doodadExclusions({ clusters: [{ x: target.x, y: target.y - 20, size: 20, label: 'x 3' }] });
  assert.ok(zones.some(z => z.kind === 'label'));
  const withLabel = doodadLayout({ outer: outerFor(16), exclusions: zones });
  assert.equal(withLabel[0].visible, false); assert.equal(withLabel[0].reason, 'label');
  assert.equal(withLabel[0].x, target.x, 'hidden doodads keep their home (never nudged onto other text)');
  // unlabeled clusters (single Souls in the grid) add no zone
  assert.equal(doodadExclusions({ clusters: [{ x: 1, y: 1, size: 20, label: null }] }).length, 1);
  // the panel: every home stays left of the region's right margin (the canvas ends at panelX)
  for (const d of list.filter(d => d.visible)) assert.ok(d.x + d.size / 2 <= W - DOODAD_RULES.marginPx);
});

test('motion: bob +-6 px over 4-6 s, slow drift, none under reduced motion', () => {
  const [d] = doodadLayout({ outer: outerFor(16) });
  assert.ok(d.bobPeriod >= 4 && d.bobPeriod <= 6);
  assert.ok(d.driftPeriod >= 26 && d.driftPeriod <= 40);
  let maxDy = 0, maxDx = 0;
  for (let t = 0; t < 12; t += 0.05) { const o = doodadOffset(d, t); maxDy = Math.max(maxDy, Math.abs(o.dy)); maxDx = Math.max(maxDx, Math.abs(o.dx)); }
  assert.ok(maxDy <= 6 + 1e-9 && maxDy > 5.5, `bob amplitude ${maxDy}`);
  assert.ok(maxDx <= DOODAD_RULES.drift.amplitudePx + 1e-9);
  assert.deepEqual(doodadOffset(d, 3.3, true), { dx: 0, dy: 0 });
});
