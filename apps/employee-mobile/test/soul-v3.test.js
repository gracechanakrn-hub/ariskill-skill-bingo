// node --test apps/employee-mobile/test - the v3 Soul on the phone (stage 13, D-31, docs/art/soul-faces.md "Rendering:
// one Soul everywhere"): the reveal loads the body of the config's variant (the v3 body for a v3 Soul), the join
// mascot stays on the baseline, the v3 body and decorations are prefetched once the round-end config is known, and the
// reveal colours / glow style follow the v2 rules (no halo ring for any decorated Soul). Pure / source-level: no DOM,
// no WebGL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { baselineParams, GLOW_STYLES } from '../src/scene/soul-params.js';
import * as sceneModel from '../src/scene/soul-model.js';
import * as soul3d from '../../../packages/ui/soul3d/index.js';
import { createSoulScene } from '../src/scene/soul-scene.js';
import { prefetchSoulBody, prefetchSoulDecor } from '../src/scene/loader.js';
import { GRADIENTS, CHARMS_BY_KIND } from '../../../packages/game-rules/src/soul-catalog.js';
import { v2Config, neutralV2, v3Config } from '../../../packages/ui/test/decor-fixture.js';

const src = (p) => readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), 'utf8');
const hexInt = (h) => parseInt(h.slice(1), 16);

test('a v3 Soul reveals on the v3 body: the scene loads the models of its config\'s variant; the join mascot stays on the baseline', async () => {
  for (const name of ['soulBodyVariant', 'loadSoulModel', 'loadSoulModels', 'prefetchSoulModels']) assert.equal(sceneModel[name], soul3d[name], `soul-model.${name}`);
  assert.equal(sceneModel.soulBodyVariant(v3Config()), 'v3');
  for (const c of [v2Config(), neutralV2(), { seed: 'v1', palette: 'coral' }, undefined]) assert.equal(sceneModel.soulBodyVariant(c), 'v2');
  const scene = src('scene/soul-scene.js');
  assert.match(scene, /models = await loadSoulModels\(mods, quality, \{ variant: soulBodyVariant\(opts && opts\.config\), hull: false \}\)/, 'D-58: no hull download');
  assert.match(scene, /if \(!models \|\| !host\.isConnected\) return null;/, 'no v3 body (face data not built, 404): the SVG path');
  assert.match(scene, /loadSoulDecor\(mods, opts && opts\.config\)/, 'the v3 plate, eyes, kit and antenna charm come with the decorations');
  assert.equal(await createSoulScene(null, { config: v3Config() }), null);
  const join = src('scene/join-scene.js');
  assert.match(join, /loadSoulModel\(mods, 'lite'\)/, 'the join mascot: the baseline lite LOD');
  assert.doesNotMatch(join, /variant|v3|soulBodyVariant/);
});

test('reveal colours of a v3 Soul come from its gradient; no decorated Soul gets the halo ring (the soft glow instead)', () => {
  for (let gi = 0; gi < GRADIENTS.length; gi++) {
    const g = GRADIENTS[gi];
    const p = baselineParams(v3Config({ gradient: gi, glow: 2 }), 'bingo-star');
    assert.equal(p.version, 3);
    assert.equal(p.palette, g.id);
    assert.deepEqual([p.hex.glow, p.hex.highlight, p.hex.outline, p.colors.glow], [g.glow, g.highlight, g.outline, hexInt(g.glow)]);
    assert.equal(p.glowStyle, GLOW_STYLES.soft, 'no halo ring over the antenna charm: only the angel kit wears a halo');
    assert.deepEqual([p.badge, p.scale, p.glowStrength], [true, 1, 1]);
  }
  assert.deepEqual([0, 1, 2].map((glow) => baselineParams(v3Config({ glow })).glowStyle), [GLOW_STYLES.soft, GLOW_STYLES.ring, GLOW_STYLES.soft]);
  // plate, eyes and antenna charm never change size, brightness or motion (BR-17)
  const base = baselineParams(v3Config());
  assert.deepEqual(baselineParams(v3Config({ plate: 'skull', eyes: 'wink', face: 'pirate', topper: CHARMS_BY_KIND.soft[9] })), base);
  assert.equal(baselineParams({ seed: 'v1', palette: 'lagoon', glow: 'halo' }).glowStyle, GLOW_STYLES.halo, 'v1 Souls keep their halo ring');
});

test('once the round-end config is known: the v3 body is prefetched once (v3 only), each v3 decoration set once', () => {
  const calls = [];
  const had = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn) => { calls.push(fn); return 1; };
  try {
    for (const c of [null, undefined, 'x', { seed: 'v1', palette: 1 }, v2Config(), neutralV2()]) prefetchSoulBody(c);
    assert.equal(calls.length, 0, 'v1 / v2 Souls stand on the baseline, already warm from prefetchThree');
    prefetchSoulBody(v3Config()); prefetchSoulBody(v3Config({ seed: 'another', plate: 'bat' }));
    assert.equal(calls.length, 1, 'one v3 body for every v3 Soul: warmed once');
    prefetchSoulDecor(v3Config()); prefetchSoulDecor(v3Config({ seed: 'another' }));
    assert.equal(calls.length, 2, 'same pieces: one decoration prefetch');
    prefetchSoulDecor(v3Config({ plate: 'bat' })); prefetchSoulDecor(v3Config({ eyes: 'sleepy' })); prefetchSoulDecor(v3Config({ topper: CHARMS_BY_KIND.soft[4] }));
    assert.equal(calls.length, 5, 'a different plate, eyes or antenna charm is another set');
    prefetchSoulDecor(v2Config());
    assert.equal(calls.length, 6, 'the v2 kit of the same face is not the v3 kit');
  } finally { if (had) globalThis.requestIdleCallback = had; else delete globalThis.requestIdleCallback; }
  const main = src('main.js');
  assert.match(main, /prefetchSoulBody\(state\.soul\.config\); prefetchSoulDecor\(state\.soul\.config\);/, 'the result screen warms both');
  // D-58: only the tier's own body, and the v3 body before the Soul is known; winners also warm the crown
  assert.match(src('scene/loader.js'), /model\.prefetchSoulModels\(mods, \[tier === 'high' \? 'hero' : 'lite'\], config \? model\.soulBodyVariant\(config\) : 'v3'\)/);
  assert.match(main, /if \(state\.soul\.badge\) prefetchWinnerCrown\(\);/);
});
