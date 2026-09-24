// node --test apps/employee-mobile/test - pure helpers behind the phone hero scenes (no DOM, no Three.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { soulMeshParams, latheProfile, radiusAt, stageProgress, easeEmphasized, easeExit, BODY_PROFILES, hashSeed, ANTENNA } from '../src/scene/soul-params.js';
import { sceneQuality, frameBudgetExceeded, pixelRatioFor, FRAME_BUDGET_MS } from '../src/scene/capability.js';
import { TRAITS, PALETTES } from '../../../packages/ui/soul-renderer.js';

const cfg = (over = {}) => ({ seed: 'soul_42', body: 'drop', palette: 'aurora', eyes: 'dot', antenna: 'orb', mouth: 'smile', glow: 'soft', constellation: [], driftPhase: 0.3, ...over });

test('soulMeshParams is deterministic for equal config + badge', () => {
  const a = soulMeshParams(cfg(), 'bingo-star');
  const b = soulMeshParams(cfg(), 'bingo-star');
  assert.deepEqual(a, b);
  assert.equal(a.badge, true);
  assert.equal(soulMeshParams(cfg(), null).badge, false);
});

test('soulMeshParams never depends on Platform / Role / winner or any extra field (BR-17)', () => {
  const plain = soulMeshParams(cfg());
  const decorated = soulMeshParams({ ...cfg(), platformId: 'platform_x', roleId: 'role_y', isWinner: true, rank: 1, label: 'VIP' });
  assert.deepEqual(plain, decorated);
  // size and brightness are constants shared by every Soul
  for (const body of TRAITS.body) for (const palette of TRAITS.palette.slice(0, 3)) {
    const p = soulMeshParams(cfg({ body, palette, seed: `${body}-${palette}` }));
    assert.equal(p.scale, 1); assert.equal(p.glowStrength, 1);
  }
});

test('palette colours come from PALETTES (fill / highlight / outline / glow as integers)', () => {
  for (const pal of PALETTES) {
    const p = soulMeshParams(cfg({ palette: pal.name }));
    assert.equal(p.colors.fill, parseInt(pal.fill.slice(1), 16));
    assert.equal(p.colors.highlight, parseInt(pal.highlight.slice(1), 16));
    assert.equal(p.colors.outline, parseInt(pal.outline.slice(1), 16));
    assert.equal(p.colors.glow, parseInt(pal.glow.slice(1), 16));
  }
  // unknown palette / body fall back like the SVG renderer (first trait) instead of throwing
  const fb = soulMeshParams({ seed: 'x', palette: 'nope', body: 'nope' });
  assert.equal(fb.palette, TRAITS.palette[0]);
  assert.equal(fb.body, TRAITS.body[0]);
});

test('every body silhouette has a closed lathe profile that starts at the hem and ends at the top', () => {
  for (const body of TRAITS.body) {
    assert.ok(BODY_PROFILES[body], `profile for ${body}`);
    const prof = latheProfile(body);
    assert.ok(prof.length > 20);
    assert.equal(prof[0].r, 0); assert.equal(prof[prof.length - 1].r, 0);
    assert.ok(prof[0].y <= 0.03, 'starts at the hem');
    assert.ok(prof[prof.length - 1].y > 1.2, 'ends above the head');
    assert.ok(prof.every((p) => p.r >= 0 && Number.isFinite(p.y)));
    const max = Math.max(...prof.map((p) => p.r));
    assert.ok(max > 0.3 && max < 0.8, `${body} radius ${max}`);
  }
});

test('radiusAt interpolates the profile and the head patch is a sensible size', () => {
  const prof = [{ r: 0, y: 0 }, { r: 0.5, y: 1 }, { r: 0, y: 2 }];
  assert.equal(radiusAt(prof, 0.5), 0.25);
  assert.equal(radiusAt(prof, 1.5), 0.25);
  assert.equal(radiusAt(prof, 5), 0);
  for (const body of TRAITS.body) {
    const p = soulMeshParams(cfg({ body }));
    assert.ok(p.headR > 0.25 && p.headR < 0.6, `${body} head radius ${p.headR}`);
    assert.ok(p.headY > 0.9 && p.headY < p.topY, `${body} head inside the body`);
  }
});

test('antenna layouts exist for every trait and "none" renders nothing', () => {
  for (const a of TRAITS.antenna) assert.ok(a in ANTENNA, a);
  assert.equal(ANTENNA.none, null);
});

test('reveal stage progress mirrors the motion.json stage order and clamps', () => {
  assert.equal(stageProgress('glow', 0), 0);
  assert.equal(stageProgress('glow', 1), 1);
  assert.equal(stageProgress('silhouette', 0.2), 0);
  assert.equal(stageProgress('features', 0.5), 0);
  assert.ok(stageProgress('silhouette', 0.5) > 0 && stageProgress('silhouette', 0.5) < 1);
  assert.equal(stageProgress('features', 1), 1);
  assert.equal(easeEmphasized(0), 0); assert.equal(easeEmphasized(1), 1); assert.equal(easeEmphasized(2), 1);
  assert.equal(easeExit(0.5), 0.25);
});

test('hashSeed is stable and bob phase stays within one turn', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
  const p = soulMeshParams(cfg({ seed: 'zzz' }));
  assert.ok(p.bobPhase >= 0 && p.bobPhase < Math.PI * 2);
});

test('sceneQuality tiers: no WebGL -> off, low-end -> low, otherwise high, QA overrides win', () => {
  assert.equal(sceneQuality({ webgl: false, dpr: 2, cores: 8 }), 'off');
  assert.equal(sceneQuality({ webgl: true, dpr: 2, cores: 8, memoryGb: 4 }), 'high');
  assert.equal(sceneQuality({ webgl: true, dpr: 2, cores: 4, memoryGb: 4 }), 'low');
  assert.equal(sceneQuality({ webgl: true, dpr: 3, cores: 8, memoryGb: 8 }), 'low');
  assert.equal(sceneQuality({ webgl: true, dpr: 2, cores: 8, memoryGb: 2 }), 'low');
  assert.equal(sceneQuality({ webgl: true, dpr: 2, cores: 8, forced: 'off' }), 'off');
  assert.equal(sceneQuality({ webgl: true, dpr: 2, cores: 2, forced: 'force' }), 'high');
  assert.equal(sceneQuality({ webgl: false, forced: 'force' }), 'off', 'forcing never invents WebGL');
  assert.equal(sceneQuality(), 'off');
});

test('frameBudgetExceeded needs evidence and compares the median against 33 ms', () => {
  assert.equal(FRAME_BUDGET_MS, 33);
  assert.equal(frameBudgetExceeded([50, 50, 50]), false, 'fewer than 10 samples keeps the scene');
  assert.equal(frameBudgetExceeded(new Array(20).fill(16.7)), false);
  assert.equal(frameBudgetExceeded(new Array(20).fill(40)), true);
  assert.equal(frameBudgetExceeded([...new Array(19).fill(16), 400]), false, 'one hitch does not trip it');
  assert.equal(frameBudgetExceeded(null), false);
  assert.equal(pixelRatioFor('high', 3), 1.5);
  assert.equal(pixelRatioFor('low', 3), 1);
  assert.equal(pixelRatioFor('high', 1), 1);
});
