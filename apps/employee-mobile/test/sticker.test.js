// node --test apps/employee-mobile/test - sticker language helpers (pure; no DOM, no Three.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  soulMeshParams, speckleLayout, speckleCount, outlineScale, stickerPeel, revealScale, radiusAt,
  SPECKLE_COLORS, SPECKLE_SIZES, SPECKLE_COUNT, OUTLINE_SCALE, PEEL,
} from '../src/scene/soul-params.js';
import { auroraState, AURORA, doodadPlan, DOODAD_MIN_WIDTH, DOODAD_SLOTS, DOODAD_BOB } from '../src/backdrop-params.js';
import { TRAITS } from '../../../packages/ui/soul-renderer.js';

const cfg = (over = {}) => ({ seed: 'soul_42', body: 'drop', palette: 'aurora', eyes: 'dot', antenna: 'orb', mouth: 'smile', glow: 'soft', constellation: [], driftPhase: 0.3, ...over });

test('speckle placement is deterministic from the seed and differs between seeds', () => {
  const p = soulMeshParams(cfg());
  const a = speckleLayout(p.seed, p.profile, 14, { headY: p.headY, headR: p.headR });
  const b = speckleLayout(p.seed, p.profile, 14, { headY: p.headY, headR: p.headR });
  assert.deepEqual(a, b);
  const other = speckleLayout('soul_43', p.profile, 14, { headY: p.headY, headR: p.headR });
  assert.notDeepEqual(a, other);
  assert.ok(Object.isFrozen(a));
});

test('speckles sit on the body surface, use the sticker colours / two sizes and keep the face clear', () => {
  for (const body of TRAITS.body) {
    const p = soulMeshParams(cfg({ body, seed: `sp-${body}` }));
    const list = speckleLayout(p.seed, p.profile, 14, { headY: p.headY, headR: p.headR });
    assert.ok(list.length > 0 && list.length <= 14, `${body}: ${list.length}`);
    for (const sp of list) {
      assert.ok(sp.theta >= 0 && sp.theta < Math.PI * 2);
      assert.ok(sp.y > 0 && sp.y < p.topY, `${body} y ${sp.y}`);
      assert.ok(Math.abs(sp.r - radiusAt(p.profile, sp.y)) < 1e-3, 'radius follows the profile');
      assert.ok(SPECKLE_COLORS.includes(sp.color));
      assert.ok(sp.size === SPECKLE_SIZES.small || sp.size === SPECKLE_SIZES.large);
      const onFace = Math.abs(sp.y - p.headY) < p.headR * 0.85 && Math.sin(sp.theta) > 0.2;
      assert.equal(onFace, false, `${body}: speckle on the face`);
    }
  }
});

test('speckle count per tier stays within the sticker budget (<= 14, fewer on low)', () => {
  assert.equal(speckleCount('high'), SPECKLE_COUNT.high);
  assert.equal(speckleCount('low'), SPECKLE_COUNT.low);
  assert.equal(speckleCount('nope'), SPECKLE_COUNT.low);
  assert.ok(SPECKLE_COUNT.high <= 14 && SPECKLE_COUNT.low < SPECKLE_COUNT.high);
  const p = soulMeshParams(cfg());
  assert.equal(speckleLayout(p.seed, p.profile, 40).length, 14, 'never more than 14 even when asked');
  assert.equal(speckleLayout(p.seed, p.profile, 0).length, 0);
});

test('outline scale per tier: ~1.06 on high, thinner on low, low as the fallback', () => {
  assert.equal(outlineScale('high'), 1.06);
  assert.equal(outlineScale('low'), OUTLINE_SCALE.low);
  assert.ok(OUTLINE_SCALE.low > 1 && OUTLINE_SCALE.low < OUTLINE_SCALE.high);
  assert.equal(outlineScale(undefined), OUTLINE_SCALE.low);
});

test('sticker peel: 0.92 -> 1 scale, 6 deg -> 0 tilt, one 250 ms flash, and a continuous reveal scale', () => {
  const start = stickerPeel(0), end = stickerPeel(1);
  assert.equal(start.scale, PEEL.scaleFrom);
  assert.ok(Math.abs(start.tilt - 6 * Math.PI / 180) < 1e-9);
  assert.equal(end.scale, 1); assert.equal(end.tilt, 0); assert.equal(end.flash, 0);
  const mid = stickerPeel(0.5);
  assert.ok(mid.scale > 0.92 && mid.scale < 1 && mid.tilt > 0 && mid.tilt < start.tilt);
  // flash peaks inside the first 250 ms of the 700 ms stage and is over afterwards (flash-safety: a single pulse)
  assert.ok(stickerPeel(125 / PEEL.stageMs).flash > 0.99);
  assert.equal(stickerPeel(300 / PEEL.stageMs).flash, 0);
  assert.equal(stickerPeel(2).scale, 1, 'clamped');
  // reveal scale: 0.25 at dark, 0.92 when the silhouette has formed, 1 after the peel - no jump between stages
  assert.equal(revealScale(0, 0), 0.25);
  assert.equal(revealScale(1, 0), PEEL.scaleFrom);
  assert.equal(revealScale(1, 1), 1);
  let prev = revealScale(0, 0);
  for (let t = 0; t <= 1.0001; t += 0.01) { const v = revealScale(Math.min(1, t * 2), Math.max(0, t * 2 - 1)); assert.ok(v >= prev - 1e-9); prev = v; }
});

test('aurora: teal -> lime, drift bounded by 0.01 rad/s, static under reduced motion', () => {
  assert.equal(AURORA.teal, '#4FE3C1'); assert.equal(AURORA.lime, '#B6FF5C');
  assert.equal(AURORA.driftRadPerSec, 0.01);
  const vp = { width: 390, height: 844 };
  const a0 = auroraState(0, vp);
  assert.ok(a0.length > vp.width && a0.thickness >= 48 && a0.alpha > 0 && a0.alpha < 0.5);
  let maxRate = 0;
  for (let t = 0; t < 120; t += 0.5) { maxRate = Math.max(maxRate, Math.abs(auroraState(t + 1, vp).angle - auroraState(t, vp).angle)); }
  assert.ok(maxRate <= AURORA.driftRadPerSec + 1e-9, `peak rate ${maxRate}`);
  assert.ok(maxRate > AURORA.driftRadPerSec * 0.5, 'it does drift');
  for (let t = 0; t < 600; t += 7) assert.ok(Math.abs(auroraState(t, vp).angle - AURORA.baseAngleRad) <= AURORA.swingRad + 1e-9, 'bounded swing');
  assert.deepEqual(auroraState(37, { ...vp, reduced: true }), auroraState(0, { ...vp, reduced: true }));
  assert.deepEqual(auroraState(0, vp), auroraState(999, { ...vp, reduced: true }));
});

test('doodad placement rules: rocket by the join orb, planet on waiting screens, none on dense screens or at 320 px', () => {
  assert.deepEqual(doodadPlan('join', 390), [{ kind: 'rocket', slot: 'hero-corner', size: 46 }]);
  for (const s of ['board', 'locked', 'deferred']) assert.deepEqual(doodadPlan(s, 390).map((d) => d.kind), ['planet'], s);
  for (const s of ['select', 'playing', 'result', 'soul', 'floated', 'profile']) assert.deepEqual(doodadPlan(s, 390), [], s);
  assert.equal(DOODAD_MIN_WIDTH, 360);
  assert.deepEqual(doodadPlan('join', 320), []);
  assert.deepEqual(doodadPlan('locked', 359), []);
  assert.deepEqual(doodadPlan('join', NaN), []);
  // every slot is a reserved decoration area (never a text container) and each screen parks at most one doodad
  for (const list of Object.values(DOODAD_SLOTS)) { assert.equal(list.length, 1); assert.ok(['hero-corner', 'waiting-sky'].includes(list[0].slot)); }
  assert.equal(DOODAD_BOB.amplitudePx, 6);
  for (const ms of Object.values(DOODAD_BOB.periodMs)) assert.ok(ms >= 4000 && ms <= 6000);
});
