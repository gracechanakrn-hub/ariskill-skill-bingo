// The delivered v3 face data and models as soul3d consumes them (stage 13, D-31, tools/ai/blender/soul_face.py output,
// published to assets/souls/v3/): the v3 body GLBs parse into models with the topper landmark and no eye / groove / orb
// mask, the antenna-charm slot places a charm near that landmark, plates and eyes extract at identity with their own
// emissive (the vertex-coloured parts patched), and the refitted kits keep the halo glow. Skipped while
// packages/ui/soul-face-data.js is the stub placeholder or its files are not published yet (node tools/assets/build-all.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as THREE from '../../vendor/three/index.js';
import * as loaders from '../../vendor/three/loaders.js';
import { SOUL_FACE } from '../soul-face-data.js';
import { SOUL_DECOR } from '../soul-decor-data.js';
import { extractSoulModel, soulBodyUrl } from '../soul3d/model.js';
import { faceDataUsable, extractFacePartModel, extractFaceModel, soulDecorPlan, FACE_GLOW_INTENSITY, EMISSIVE_FROM_VERTEX_COLOR_KEY } from '../soul3d/decor.js';
import { buildSoulFigure } from '../soul3d/figure.js';
import { charmPlacement } from '../soul3d/placement.js';
import { PLATE_IDS, EYE_IDS, FACES } from '../../game-rules/src/soul-catalog.js';
import { v3Config } from './decor-fixture.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const fileOf = (url) => join(ROOT, url.split('?')[0].replace(/^\//, ''));
const published = SOUL_FACE.stub !== true && SOUL_FACE.body && typeof SOUL_FACE.body.hero === 'string' && existsSync(fileOf(SOUL_FACE.body.hero));
const skip = SOUL_FACE.stub === true ? 'soul-face-data.js is still the stub' : !published ? 'assets/souls/v3 is not published yet' : false;
function parse(url) {
  const buf = readFileSync(fileOf(url));
  return new Promise((resolve, reject) => new loaders.GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject));
}
const mats = (scene) => { const out = []; scene.traverse((o) => { if (o.isMesh) out.push(o.material); }); return out; };

test('v3 body GLBs: the topper landmark, framing kept, no eye / groove / orb mask; the figure draws no orb', { skip }, async () => {
  assert.equal(faceDataUsable(SOUL_FACE), true);
  const [hero, lite] = await Promise.all(['hero', 'lite'].map(async (lod) => extractSoulModel(THREE, await parse(soulBodyUrl(lod, 'v3')), lod, 'v3')));
  for (const m of [hero, lite]) {
    assert.equal(m.variant, 'v3');
    assert.ok(m.landmarks.topper, `${m.lod} topper landmark`);
    assert.ok(Math.abs(m.landmarks.topper.size - SOUL_FACE.topper.size) < 1e-6);
    assert.equal(m.landmarks.height, 2.29087, 'the v3 Soul keeps the baseline scale');
    let gba = 0; for (let i = 0; i < m.count; i++) gba = Math.max(gba, m.mask[i * 4 + 1], m.mask[i * 4 + 2], m.mask[i * 4 + 3]);
    assert.equal(gba, 0, 'mask G, B, A are 0 (no button eyes, no groove, no orb)');
  }
  // the antenna charm sits on the stalk: its placement is close to the body's topper landmark
  const place = charmPlacement(SOUL_FACE.topper, SOUL_DECOR.charm.thickness);
  assert.ok(place && Math.hypot(...place.position.map((v, i) => v - hero.landmarks.topper.centre[i])) < SOUL_FACE.topper.size, 'the slot rides on the stalk');
  const fig = buildSoulFigure(THREE, { body: hero, hull: lite, config: v3Config(), glowTexture: new THREE.Texture() });
  assert.equal(fig.orbSprite, null);
  fig.dispose();
});

test('v3 plates, eyes and kits: model space at identity, authored emissive, vertex-coloured emissive patched, halo glowing', { skip }, async () => {
  for (const id of PLATE_IDS) {
    const plate = extractFacePartModel(THREE, await parse(SOUL_FACE.plates[id].glb), 'plate', id);
    assert.ok(mats(plate.scene).every((m) => m.emissiveIntensity === 1), `plate ${id}`);
  }
  let patched = 0;
  for (const id of EYE_IDS) {
    const eyes = extractFacePartModel(THREE, await parse(SOUL_FACE.eyes[id].glb), 'eyes', id);
    for (const m of mats(eyes.scene)) {
      assert.equal(m.emissiveIntensity, 1, `eyes ${id} ${m.name}: no face-glow boost`);
      if (m.userData.emissiveFromVertexColor) { assert.equal(m.vertexColors, true, `eyes ${id} ${m.name} has COLOR_0`); assert.equal(m.customProgramCacheKey(), EMISSIVE_FROM_VERTEX_COLOR_KEY); patched++; }
    }
  }
  assert.ok(patched > 0, 'some eye designs glow in their gradient');
  for (const face of FACES) {
    const kit = extractFaceModel(THREE, await parse(SOUL_FACE.faces[face].glb), face);
    if (face === 'angel') assert.ok(mats(kit.scene).some((m) => m.emissiveIntensity === FACE_GLOW_INTENSITY), 'the halo glows');
  }
  const plan = soulDecorPlan(v3Config());
  assert.deepEqual([plan.usable, plan.reason, plan.skipped], [true, null, []], 'the shipped data plans every v3 piece');
});
