// tools/assets/test/winner-crown.test.js - the Bingo winner's gold crown (stage 15, D-36): the Blender GLB
// (tools/ai/blender/winner_crown.py) and its published copy, the three approved materials, its frame and where it sits on
// the head, the soul_winner_crown manifest entry, and the publish step (tools/assets/build-winner-crown.js).
// Run: node --test tools/assets/test. Publish cases run on disposable copies under the scratch dir (never the real tree).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, readAccessor, meshBoundsAll, GLB_MAGIC } from '../lib/glb.js';
import { parseManifest, mergeManifest } from '../lib/manifest.js';
import { validateManifests } from '../validate-manifest.js';
import { inspectCrownGlb, buildWinnerCrown, SOURCE, RUNTIME, MANIFEST, GENERATOR, ID, NODE } from '../build-winner-crown.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_SCRATCH = '/private/tmp/claude-501/-Users-grc-Desktop-claudecodetest-Ariskill-Bingo/312520a1-70d6-4efd-9438-4e9be7bd9617/scratchpad/asset-int/';
function scratchDir() {
  const want = process.env.ASSET_INT_SCRATCH || DEFAULT_SCRATCH;
  try { mkdirSync(want, { recursive: true }); return want; } catch (_) { const d = join(tmpdir(), 'asset-int'); mkdirSync(d, { recursive: true }); return d; }
}
const SCRATCH = scratchDir();
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

// The approved draft (packages/ui/soul3d/winner.js, stage-15 review) as authored: sRGB hex, emissive x strength.
const APPROVED = {
  gold: { base: '#F6C453', metallic: 0.85, roughness: 0.3, emissive: '#7A5410', strength: 0.35 },
  ruby: { base: '#E0356B', metallic: 0.2, roughness: 0.15, emissive: '#5A0A22', strength: 0.6 },
  sapphire: { base: '#4D7DFF', metallic: 0.2, roughness: 0.15, emissive: '#0D1E66', strength: 0.6 },
};
// Where winner.js puts the crown on the head (model space: position, then roll about Z) and the box round the head it
// must stay in. The approved design tops out at y 1.8022 there (spike 4's jewel, raised by the roll), hence 1.81.
const PLACEMENT = { position: [0.015, 1.49, -0.005], rollZ: -0.07 };
const HEAD_BOX = { min: [-0.45, 1.45, -0.45], max: [0.45, 1.81, 0.45] };
const TOL = 0.01;
const KB = 1024;
const lin =(hex) => [0, 2, 4].map((i) => { const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const sha = (buf) => 'sha256:' + createHash('sha256').update(buf).digest('hex');
const close = (a, b, tol = TOL) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

function published() {
  assert.ok(existsSync(join(ROOT, RUNTIME)), `${RUNTIME} is missing (run: node tools/assets/build-winner-crown.js)`);
  return readFileSync(join(ROOT, RUNTIME));
}
function parsed(buf = published()) {
  const g = readGlb(buf);
  assert.ok(g.ok, g.reason);
  return g;
}
/** Every vertex (model units: the root node has no transform) of every primitive. */
function vertices(g) {
  return g.json.meshes[0].primitives.flatMap((p) => readAccessor(g.json, g.bin, p.attributes.POSITION));
}
function entries(text = readFileSync(join(ROOT, MANIFEST), 'utf8')) {
  return parseManifest(text).entries.filter((e) => e.id === ID);
}
/** Rewrite the GLB's JSON chunk in place (padded to the same length; the edit must not make it longer). */
function patchJson(buf, fn) {
  const out = Buffer.from(buf), len = out.readUInt32LE(12);
  const j = JSON.parse(out.subarray(20, 20 + len).toString('utf8'));
  fn(j);
  const s = JSON.stringify(j);
  assert.ok(Buffer.byteLength(s) <= len, 'the patched JSON must not grow');
  out.write(s.padEnd(len, ' '), 20, 'utf8');
  return out;
}
function tempRoot() {
  const dir = mkdtempSync(join(SCRATCH, 'crown-'));
  made.push(dir);
  for (const rel of [SOURCE, MANIFEST]) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); copyFileSync(join(ROOT, rel), join(dir, rel)); }
  mergeManifest(join(dir, MANIFEST), GENERATOR, []); // as before the crown was first published
  return dir;
}

describe('winner crown GLB (assets/souls/winner/crown.glb)', () => {
  test('exists, byte for byte the Blender output in assets-src/generated/winner/', () => {
    const buf = published();
    assert.ok(existsSync(join(ROOT, SOURCE)), `${SOURCE} is missing (run tools/ai/blender/winner_crown.py in Blender)`);
    assert.ok(buf.equals(readFileSync(join(ROOT, SOURCE))), 'the published copy differs from the staged GLB (run node tools/assets/build-winner-crown.js)');
  });

  test('is a valid glTF 2.0 binary: header, JSON + BIN chunks, asset.version 2.0, only KHR_mesh_quantization', () => {
    const buf = published();
    assert.equal(buf.readUInt32LE(0), GLB_MAGIC);
    assert.equal(buf.readUInt32LE(4), 2);
    assert.equal(buf.readUInt32LE(8), buf.length);
    const g = parsed(buf);
    assert.equal(g.json.asset.version, '2.0');
    assert.ok(g.bin && g.bin.length > 0, 'BIN chunk');
    assert.deepEqual(g.json.extensionsRequired, ['KHR_mesh_quantization']);
    assert.deepEqual(g.json.extensionsUsed, ['KHR_mesh_quantization']);
    for (const p of g.json.meshes[0].primitives) {
      const pos = g.json.accessors[p.attributes.POSITION];
      assert.equal(pos.componentType, 5122); assert.equal(pos.normalized, true);
      assert.ok([...pos.min, ...pos.max].every(Number.isInteger), 'POSITION min/max are the raw stored integers');
      assert.equal((p.mode ?? 4), 4);
    }
  });

  test('is under 48 KB (and within the 40 KB stage-15 target)', () => {
    const n = published().length;
    assert.ok(n < 48 * KB, `${n} bytes`);
    assert.ok(n <= 40 * KB, `${n} bytes`);
  });

  test('has no textures: no images, textures or samplers, and no material uses one', () => {
    const j = parsed().json;
    for (const k of ['images', 'textures', 'samplers']) assert.equal((j[k] || []).length, 0, k);
    assert.doesNotMatch(JSON.stringify(j.materials), /Texture"/);
  });

  test('uses exactly the approved gold, ruby and sapphire materials (base colour within 0.01, linear glTF factors)', () => {
    const j = parsed().json;
    assert.equal(j.materials.length, 3);
    const found = {};
    for (const m of j.materials) {
      const base = m.pbrMetallicRoughness.baseColorFactor;
      const key = Object.keys(APPROVED).find((k) => close(base, [...lin(APPROVED[k].base), 1]));
      assert.ok(key, `${m.name}: base colour ${JSON.stringify(base)} is none of the approved three`);
      assert.ok(!(key in found), `${key} twice`);
      found[key] = m;
      const a = APPROVED[key];
      assert.ok(Math.abs(m.pbrMetallicRoughness.metallicFactor - a.metallic) <= TOL, `${key} metallic`);
      assert.ok(Math.abs(m.pbrMetallicRoughness.roughnessFactor - a.roughness) <= TOL, `${key} roughness`);
      assert.ok(close(m.emissiveFactor, lin(a.emissive).map((c) => Math.min(1, c * a.strength))), `${key} emissive ${JSON.stringify(m.emissiveFactor)}`);
      assert.equal(m.alphaMode ?? 'OPAQUE', 'OPAQUE');
    }
    assert.deepEqual(Object.keys(found).sort(), ['gold', 'ruby', 'sapphire']);
    const parts = j.meshes[0].primitives.map((p) => p.extras.part).sort();
    assert.deepEqual(parts, ['gold', 'ruby', 'sapphire'], 'one primitive per material');
  });

  test(`has the crown's own frame: one root node "${NODE}" without a transform, the band's base centred on the origin`, () => {
    const g = parsed();
    assert.deepEqual(g.json.scenes[g.json.scene ?? 0].nodes, [0]);
    assert.equal(g.json.nodes.length, 1);
    assert.equal(g.json.nodes[0].name, NODE);
    assert.notEqual(g.json.scenes[g.json.scene ?? 0].name, NODE, 'GLTFLoader names the scene first: the node must keep the name');
    for (const k of ['translation', 'rotation', 'scale', 'matrix']) assert.ok(!(k in g.json.nodes[0]), `node has no ${k}`);
    const { min, max } = meshBoundsAll(g.json, g.bin);
    assert.ok(Math.abs(min[1]) < 0.001, `base at y ${min[1]}`);
    assert.ok(max[1] > 0.28 && max[1] < 0.3, `top at y ${max[1]}`);
    for (const k of [0, 2]) assert.ok(Math.abs(min[k] + max[k]) < 0.05, `centred on the axis (${k}: ${min[k]}..${max[k]})`);
  });

  test('placed on the head as winner.js does, it stays in the box round the head (x, z within 0.45, y 1.45..1.81)', () => {
    const [tx, ty, tz] = PLACEMENT.position, c = Math.cos(PLACEMENT.rollZ), s = Math.sin(PLACEMENT.rollZ);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const [x, y, z] of vertices(parsed())) {
      const p = [c * x - s * y + tx, s * x + c * y + ty, z + tz];
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
    for (let k = 0; k < 3; k++) {
      assert.ok(lo[k] >= HEAD_BOX.min[k] && hi[k] <= HEAD_BOX.max[k], `axis ${'xyz'[k]}: ${lo[k].toFixed(4)}..${hi[k].toFixed(4)} outside ${HEAD_BOX.min[k]}..${HEAD_BOX.max[k]}`);
    }
  });

  test("passes the publish step's checks (the face-kit GLB format and the crown's rules)", () => {
    const info = inspectCrownGlb(published());
    assert.deepEqual(info.problems, []);
    assert.ok(info.triangles > 1000 && info.triangles < 4000, `${info.triangles} triangles`);
  });
});

describe(`manifest entry ${ID}`, () => {
  test("exists once, with the published file's checksum and size, generated by winner_crown.py", () => {
    const found = entries();
    assert.equal(found.length, 1);
    const e = found[0], buf = published();
    assert.equal(e.checksum, sha(buf));
    assert.equal(e.texture_memory_bytes, buf.length);
    assert.equal(e.kind, 'model');
    assert.equal(e.runtime_file, RUNTIME); assert.equal(e.runtime_format, 'glb');
    assert.equal(e.source_file, SOURCE); assert.equal(e.source_format, 'glb');
    assert.equal(e.generator_script, GENERATOR);
    assert.ok(existsSync(join(ROOT, e.generator_script)));
    assert.equal(e.license, 'internal-original');
    assert.equal(e.approved_by, null);
    assert.deepEqual(e.lods, [RUNTIME]);
  });

  test('bounds, pivot and triangle_count describe the GLB (filled like the face kits)', () => {
    const [e] = entries(), g = parsed(), info = inspectCrownGlb(published());
    const { min, max } = meshBoundsAll(g.json, g.bin);
    assert.deepEqual(e.bounds, [0, 1, 2].map((k) => Number((max[k] - min[k]).toFixed(5))));
    assert.deepEqual(e.pivot, [0, 0, 0]);
    const tris = g.json.meshes[0].primitives.reduce((n, p) => n + g.json.accessors[p.indices].count / 3, 0);
    assert.equal(e.triangle_count, tris);
    assert.equal(e.triangle_count, info.triangles);
  });

  test('the validator reports no critical or major problem for the crown', () => {
    const res = validateManifests({ root: ROOT, checkAssetMap: false });
    const mine = res.problems.filter((p) => String(p.path).includes('souls/winner') || String(p.path).includes(ID) || String(p.detail).includes(ID));
    assert.deepEqual(mine.filter((p) => p.severity === 'critical' || p.severity === 'major'), []);
  });
});

describe('publish step (build-winner-crown.js, disposable copies)', () => {
  test('copies the GLB byte for byte and merges one entry; a rerun changes nothing', () => {
    const dir = tempRoot();
    const before = parseManifest(readFileSync(join(dir, MANIFEST), 'utf8')).entries;
    assert.equal(before.filter((x) => x.id === ID).length, 0);
    const r = buildWinnerCrown({ root: dir });
    assert.equal(r.ok, true, r.problems.join('\n'));
    assert.deepEqual(r.written, [RUNTIME]);
    assert.ok(readFileSync(join(dir, RUNTIME)).equals(readFileSync(join(dir, SOURCE))));
    const text = readFileSync(join(dir, MANIFEST), 'utf8');
    const [e] = entries(text);
    assert.equal(e.checksum, sha(readFileSync(join(dir, RUNTIME))));
    const now = parseManifest(text).entries;
    assert.equal(now.length, before.length + 1, 'one entry added');
    assert.deepEqual(now.filter((x) => x.id !== ID), before, 'every other entry kept as it was');
    const again = buildWinnerCrown({ root: dir });
    assert.equal(again.ok, true);
    assert.deepEqual(again.written, []);
    assert.equal(readFileSync(join(dir, MANIFEST), 'utf8'), text);
  });

  test('refuses a GLB that is not the approved crown: nothing is published, the manifest is untouched', () => {
    const dir = tempRoot();
    const before = readFileSync(join(dir, MANIFEST), 'utf8');
    const bad = [
      [(j) => { j.materials[0].pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1]; }, /is not gold, ruby or sapphire/],
      [(j) => { j.nodes[0].scale = [2, 2, 2]; delete j.asset.extras; }, /must have no transform/],
      [(j) => { j.images = [{ uri: 'crown.png' }]; delete j.asset.extras; }, /no textures/],
    ];
    for (const [fn, re] of bad) {
      writeFileSync(join(dir, SOURCE), patchJson(readFileSync(join(ROOT, SOURCE)), fn));
      const r = buildWinnerCrown({ root: dir });
      assert.equal(r.ok, false);
      assert.ok(r.problems.some((p) => re.test(p)), r.problems.join('\n'));
      assert.ok(!existsSync(join(dir, RUNTIME)), 'nothing published');
      assert.equal(readFileSync(join(dir, MANIFEST), 'utf8'), before);
    }
  });

  test('reports a stray file next to the published crown instead of deleting it', () => {
    const dir = tempRoot();
    mkdirSync(join(dir, dirname(RUNTIME)), { recursive: true });
    writeFileSync(join(dir, dirname(RUNTIME), 'crown-old.glb'), 'x');
    const r = buildWinnerCrown({ root: dir });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('crown-old.glb: not a built winner file')), r.problems.join('\n'));
    assert.ok(existsSync(join(dir, dirname(RUNTIME), 'crown-old.glb')));
  });
});
