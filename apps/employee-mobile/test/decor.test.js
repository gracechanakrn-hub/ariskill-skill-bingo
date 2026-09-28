// node --test apps/employee-mobile/test - the decorated Soul on the phone (D-29, docs/art/soul-decorations.md "Phone"):
// reveal colours from the v2 gradient, the shared packages/ui/soul3d module behind the historical scene modules, the
// reveal built from the shared rig with its decorations (never waiting long for them), the join mascot kept plain, and
// the decoration prefetch. Pure / source-level: no DOM, no WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { baselineParams, BASELINE, outlineWidth, GLOW_STYLES } from '../src/scene/soul-params.js';
import * as sceneModel from '../src/scene/soul-model.js';
import * as sceneTint from '../src/scene/soul-tint.js';
import * as soul3d from '../../../packages/ui/soul3d/index.js';
import { createSoulScene, DECOR_WAIT_MS } from '../src/scene/soul-scene.js';
import { prefetchSoulDecor } from '../src/scene/loader.js';
import { GRADIENTS } from '../../../packages/game-rules/src/soul-catalog.js';
import { PALETTES } from '../../../packages/ui/soul-renderer.js';
import { v2Config, neutralV2 } from '../../../packages/ui/test/decor-fixture.js';

const src = (p) => readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), 'utf8');
const hexInt = (h) => parseInt(h.slice(1), 16);

test('reveal colours for a v2 Soul come from its gradient (ring, motes and halo glow in the Soul\'s own glow)', () => {
  for (let gi = 0; gi < GRADIENTS.length; gi++) {
    const g = GRADIENTS[gi];
    const p = baselineParams(v2Config({ gradient: gi, glow: 2 }), 'bingo-star');
    assert.equal(p.version, 2);
    assert.equal(p.palette, g.id);
    assert.deepEqual([p.hex.glow, p.hex.highlight, p.hex.outline], [g.glow, g.highlight, g.outline]);
    assert.equal(p.colors.glow, hexInt(g.glow));
    assert.equal(p.glowStyle, GLOW_STYLES.soft, 'no halo ring above the orb of a decorated Soul: only the angel face kit wears a halo (D-29)');
    assert.equal(p.badge, true);
    assert.equal(p.scale, 1); assert.equal(p.glowStrength, 1);
  }
  // the decoration (face, charms) never changes size, brightness or motion (BR-17)
  const base = baselineParams(v2Config());
  for (const face of ['nerdy', 'pirate', 'angel', null]) assert.deepEqual(baselineParams(v2Config({ face, charms: face ? v2Config().charms.slice().reverse() : [] })), base);
  assert.deepEqual(baselineParams({ ...v2Config(), rank: 1, isWinner: true, selectedKinds: { core: 3 } }), base);
  // v1 is unchanged: the palette
  const v1 = baselineParams({ seed: 'x', palette: 'coral', glow: 'soft' });
  assert.equal(v1.version, 1);
  assert.deepEqual({ ...v1.hex }, { fill: PALETTES[5].fill, highlight: PALETTES[5].highlight, outline: PALETTES[5].outline, glow: PALETTES[5].glow });
  assert.equal(baselineParams(neutralV2()).palette, GRADIENTS[0].id);
});

test('one 3D Soul: the phone scene modules are the shared packages/ui/soul3d implementation', () => {
  assert.equal(BASELINE, soul3d.SOUL_VIEW, 'framing, yaw, outline and motion constants are shared with the Galaxy');
  assert.equal(outlineWidth('high'), soul3d.outlineWidth('high'));
  for (const name of ['buildSoulFigure', 'buildSoulRig', 'extractSoulModel', 'loadSoulModels', 'makeStudioEnvironment', 'applySoulToneMapping', 'addStudioLights', 'addGlowLight', 'loadSoulDecor', 'readLandmarks']) {
    assert.equal(sceneModel[name], soul3d[name], `soul-model.${name}`);
  }
  assert.equal(sceneModel.LOOK, soul3d.LOOK);
  for (const name of ['tintColors', 'tintGradientColors', 'tintVertex', 'hexToLinear', 'orbGlow', 'gradientLinearAt']) assert.equal(sceneTint[name], soul3d[name], `soul-tint.${name}`);
});

test('the reveal builds the shared rig with the Soul config and its decorations, and never waits long for them', async () => {
  const scene = src('scene/soul-scene.js');
  assert.match(scene, /buildSoulRig\(THREE, \{ body: models\.body, hull: models\.hull, config, badge: [^,]+, decor, quality, glowTexture: glowTex, dieCut: false, winnerCrown: P\.badge \? \(crownGlb \|\| true\) : false \}\)/, 'D-58: no die-cut; a winner wears the crown');
  assert.match(scene, /const crownP = opts && opts\.badge \? loadWinnerCrown\(mods\) : Promise\.resolve\(null\);/, 'the crown is fetched only for a winner');
  assert.match(scene, /Promise\.race\(\[crownP, new Promise\(\(r\) => setTimeout\(\(\) => r\(null\), DECOR_WAIT_MS\)\)\]\)/, 'bounded wait for the crown');
  assert.doesNotMatch(scene, /TorusGeometry|makeDashedRingTexture|'dashed-ring'|'halo-ring'/, 'D-58: no floor ring, dashed ring or halo ring');
  assert.match(scene, /loadSoulDecor\(mods, opts && opts\.config\)/);
  assert.match(scene, /Promise\.race\(\[decorP, new Promise\(\(r\) => setTimeout\(\(\) => r\(null\), DECOR_WAIT_MS\)\)\]\)/, 'bounded wait');
  assert.match(scene, /decorLate\.then\(\(d\) => \{ if \(!disposed && d\) rig\.setDecor\(d\); \}\)/, 'late decorations join the reveal');
  assert.ok(DECOR_WAIT_MS > 0 && DECOR_WAIT_MS <= 1000, `decor wait ${DECOR_WAIT_MS} ms (the reveal is not held)`);
  assert.equal(await createSoulScene(null, { config: v2Config() }), null, 'no host: the SVG path');
  // the join mascot is nobody's Soul: plain baseline, lilac palette, no config, no decorations
  const join = src('scene/join-scene.js');
  assert.match(join, /buildSoulFigure\(THREE, \{\s*body: model, hull: model, palette: mascotPalette\(\)/);
  assert.doesNotMatch(join, /config|decor|buildSoulRig/);
});

test('the 2D fallback and the alt text use renderer v4 with the Soul config (gradient, face and charm sprites)', () => {
  const view = src('views/soul.js');
  assert.match(view, /const alt = soulAltText\(soul\.config, soul\.badge\);/);
  assert.match(view, /renderSoulSvg\(soul\.config, \{ size: 220, badge: soul\.badge, detail: 'full', reducedMotion: prefersReducedMotion\(\), label: alt/);
  assert.doesNotMatch(view, /images: false/, 'inline SVG keeps its <image> layers');
  const main = src('main.js');
  assert.match(main, /prefetchSoulDecor\(state\.soul\.config\)/, 'the result screen warms the decorations');
});

test('prefetchSoulDecor ignores Souls without decorations and schedules each decoration set once', () => {
  const calls = [];
  const had = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn) => { calls.push(fn); return 1; };
  try {
    for (const c of [null, undefined, 'x', { seed: 'v1', palette: 1 }, neutralV2()]) prefetchSoulDecor(c);
    assert.equal(calls.length, 0);
    prefetchSoulDecor(v2Config()); prefetchSoulDecor(v2Config({ seed: 'another' }));
    assert.equal(calls.length, 1, 'same face and charms: one prefetch');
    prefetchSoulDecor(v2Config({ face: 'pirate' }));
    assert.equal(calls.length, 2);
  } finally { if (had) globalThis.requestIdleCallback = had; else delete globalThis.requestIdleCallback; }
});

test('a decorated Soul keeps the soft and dashed-ring glow styles; the halo style falls back to the soft glow (D-29)', () => {
  assert.deepEqual([0, 1, 2].map((glow) => baselineParams(v2Config({ glow })).glowStyle), [GLOW_STYLES.soft, GLOW_STYLES.ring, GLOW_STYLES.soft]);
  assert.equal(baselineParams({ seed: 'v1', palette: 'lagoon', glow: 'halo' }).glowStyle, GLOW_STYLES.halo, 'v1 Souls keep their halo ring');
});
