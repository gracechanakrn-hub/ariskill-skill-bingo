// node --test apps/employee-mobile/test - pure helpers behind the phone hero scenes (no DOM, no Three.js).
// The phone draws the baseline Soul (D-27): baselineParams / BASELINE below. soulMeshParams / latheProfile / radiusAt /
// ANTENNA are the LEGACY procedural Soul, no longer drawn; they stay tested because tools/ai (Blender port) imports them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { soulMeshParams, latheProfile, radiusAt, stageProgress, easeEmphasized, easeExit, BODY_PROFILES, hashSeed, ANTENNA, baselineParams, BASELINE, GLOW_STYLES, outlineWidth, mascotPalette, MASCOT, PEEL, stickerPeel } from '../src/scene/soul-params.js';
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
  assert.equal(sceneQuality({ webgl: true, dpr: 2, cores: 4, memoryGb: 4 }), 'high', 'D-57: 4 cores is a normal phone');
  assert.equal(sceneQuality({ webgl: true, dpr: 3, cores: 8, memoryGb: 8 }), 'high', 'D-57: a sharp screen no longer lowers the tier');
  assert.equal(sceneQuality({ webgl: true, dpr: 3, cores: 2, memoryGb: 4 }), 'low', 'very few cores');
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
  assert.equal(pixelRatioFor('high', 3), 2.5, 'D-57: sharp on dpr 3 phones');
  assert.equal(pixelRatioFor('high', 2), 2);
  assert.equal(pixelRatioFor('low', 3), 1.5);
  assert.equal(pixelRatioFor('reduced', 3), 1.25, 'the lighter step before the flat fallback');
  assert.equal(pixelRatioFor('minimal', 3), 1, 'the lightest step (D-58)');
  assert.equal(pixelRatioFor('high', 1), 1, 'never above the device');
  assert.equal(pixelRatioFor('unknown', 3), 1);
});

// ---- baseline Soul (D-27) -------------------------------------------------------------------------------------

test('baselineParams draws palette + glow + badge only: body / eyes / antenna / mouth / Platform / Role never change it', () => {
  const base = baselineParams(cfg(), 'bingo-star');
  assert.deepEqual(baselineParams(cfg(), 'bingo-star'), base, 'deterministic');
  for (const body of TRAITS.body) for (const eyes of TRAITS.eyes.slice(0, 3)) {
    const p = baselineParams(cfg({ body, eyes, antenna: 'twin', mouth: 'none' }), 'bingo-star');
    assert.deepEqual(p, base, `${body} / ${eyes}`);
  }
  assert.deepEqual(baselineParams({ ...cfg(), platformId: 'platform_x', roleId: 'role_y', isWinner: true, rank: 1, label: 'VIP' }, 'bingo-star'), base);
  assert.equal(base.scale, 1); assert.equal(base.glowStrength, 1);
  assert.equal(baselineParams(cfg(), null).badge, false);
  assert.equal(baselineParams(cfg(), 'something-else').badge, false, 'only the Bingo Star is a badge');
  assert.ok(Object.isFrozen(base) && Object.isFrozen(base.hex) && Object.isFrozen(base.colors));
});

test('baselineParams: every palette comes from PALETTES, every glow trait maps to a halo style, unknown values fall back', () => {
  for (const pal of PALETTES) {
    const p = baselineParams(cfg({ palette: pal.name }));
    assert.deepEqual({ ...p.hex }, { fill: pal.fill, highlight: pal.highlight, outline: pal.outline, glow: pal.glow });
    assert.equal(p.colors.fill, parseInt(pal.fill.slice(1), 16));
  }
  assert.deepEqual(Object.keys(GLOW_STYLES), [...TRAITS.glow]);
  const styles = TRAITS.glow.map((g) => baselineParams(cfg({ glow: g })).glowStyle);
  assert.deepEqual(styles, ['back-glow', 'dashed-ring', 'halo-ring']);
  const fb = baselineParams({ seed: 'x', palette: 'nope', glow: 'nope' });
  assert.equal(fb.palette, TRAITS.palette[0]); assert.equal(fb.glowStyle, 'back-glow');
  const p = baselineParams(cfg({ seed: 'zzz' }));
  assert.ok(p.bobPhase >= 0 && p.bobPhase < Math.PI * 2);
  assert.equal(p.bobPhase, soulMeshParams(cfg({ seed: 'zzz' })).bobPhase, 'same bob phase as before (motion only)');
});

test('BASELINE framing, die-cut and motion constants (shared by every Soul, BR-17)', () => {
  assert.equal(BASELINE.fitHeight, 1.86, 'the lathe Souls\' framing incl. the antenna');
  assert.ok(BASELINE.yaw < 0 && BASELINE.yaw > -0.8, '3/4 view, face toward the viewer\'s left');
  assert.equal(outlineWidth('high'), BASELINE.outline.high); assert.equal(outlineWidth('low'), BASELINE.outline.low); assert.equal(outlineWidth('nope'), BASELINE.outline.low);
  // ~1.03 of the model half-width (0.725 model units): 0.02 .. 0.035
  for (const w of Object.values(BASELINE.outline)) assert.ok(w >= 0.02 && w <= 0.035, `outline ${w}`);
  assert.ok(BASELINE.flashBoost > 0 && BASELINE.flashBoost <= 1, 'one flash widens the die-cut, flash-safe');
  assert.ok(BASELINE.bob.hz <= 0.5, 'ambient motion under 0.5 Hz');
  // the peel itself is unchanged: 0.92 -> 1, 6 deg, one 250 ms flash
  assert.equal(PEEL.scaleFrom, 0.92); assert.equal(PEEL.tiltDeg, 6); assert.equal(PEEL.flashMs, 250);
  assert.equal(stickerPeel(1).flash, 0);
});

test('the join mascot is the baseline in the lilac palette (nobody\'s Soul: no seed, no badge)', () => {
  const lilac = PALETTES.find((p) => p.name === 'lilac');
  assert.equal(MASCOT.palette, 'lilac');
  assert.deepEqual({ ...mascotPalette() }, { fill: lilac.fill, highlight: lilac.highlight, outline: lilac.outline, glow: lilac.glow });
  assert.ok(!('seed' in MASCOT) && !('badge' in MASCOT));
});
