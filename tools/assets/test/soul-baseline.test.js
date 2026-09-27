// tools/assets/test/soul-baseline.test.js - baseline Soul GLBs (D-27): GLB reader, generator checks, manifest entries,
// validator (kind model / glb) and the asset map. Run: node --test tools/assets/test
// Mutation cases run on disposable copies under the scratch dir (never the real tree).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, readAccessor, meshBounds, GLB_MAGIC } from '../lib/glb.js';
import { inspectBaselineGlb, buildSoulBaseline, LODS, SOURCE_DIR, RUNTIME_DIR, GENERATOR, GLB_BUDGET_BYTES } from '../build-soul-baseline.js';
import { validateManifests, DEFAULT_BUDGETS } from '../validate-manifest.js';
import { parseManifest } from '../lib/manifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_SCRATCH = '/private/tmp/claude-501/-Users-grc-Desktop-claudecodetest-Ariskill-Bingo/312520a1-70d6-4efd-9438-4e9be7bd9617/scratchpad/asset-int/';
function scratchDir() {
  const want = process.env.ASSET_INT_SCRATCH || DEFAULT_SCRATCH;
  try { mkdirSync(want, { recursive: true }); return want; } catch (_) { const d = join(tmpdir(), 'asset-int'); mkdirSync(d, { recursive: true }); return d; }
}
const SCRATCH = scratchDir();
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
// Blender masters, numpy caches and review renders are not inputs of any check: keep the copies small.
const SKIP = /(^|\/)(node_modules|test|\.git)$|\.(blend|blend1|npy)$|assets-src\/generated\/.*\.png$/;
function tempTree(dirs = ['assets', 'assets-src', 'tools/assets', 'tools/ai/blender', 'packages/ui', 'packages/game-rules', 'packages/skill-master', 'docs/audio', 'apps']) {
  const dir = mkdtempSync(join(SCRATCH, 'glb-'));
  for (const d of dirs) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(dir, d), { recursive: true, filter: (src) => !SKIP.test(src) });
  made.push(dir);
  return dir;
}
const hero = () => readFileSync(join(ROOT, SOURCE_DIR, 'soul-baseline-hero.glb'));
const lite = () => readFileSync(join(ROOT, SOURCE_DIR, 'soul-baseline-lite.glb'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Re-pack a GLB with a mutated JSON chunk (BIN chunk kept byte for byte). */
function repack(buf, mutate) {
  const g = readGlb(buf);
  const json = JSON.parse(JSON.stringify(g.json));
  mutate(json);
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(g.bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(text.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const head = Buffer.alloc(12); head.writeUInt32LE(GLB_MAGIC, 0); head.writeUInt32LE(2, 4);
  const out = Buffer.concat([head, jsonHeader, text, binHeader, g.bin]);
  out.writeUInt32LE(out.length, 8);
  return out;
}

describe('GLB reader (tools/assets/lib/glb.js)', () => {
  test('reads both baseline GLBs: glTF 2.0 container, JSON + BIN chunks, quantised accessors dequantise into the model frame', () => {
    for (const buf of [hero(), lite()]) {
      const g = readGlb(buf);
      assert.equal(g.ok, true, g.reason); assert.equal(g.version, 2); assert.equal(g.length, buf.length);
      assert.equal(g.json.asset.version, '2.0'); assert.ok(g.bin.length >= g.json.buffers[0].byteLength);
      const prim = g.json.meshes[0].primitives[0];
      const nrm = readAccessor(g.json, g.bin, prim.attributes.NORMAL);
      assert.ok(nrm.every((n) => Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 0.03), 'int8 normals dequantise to unit length');
      const col = readAccessor(g.json, g.bin, prim.attributes.COLOR_0);
      assert.ok(col.every((c) => c.length === 4 && c.every((v) => v >= 0 && v <= 1)), 'uint8 mask dequantises to [0, 1]');
      const { min, max } = meshBounds(g.json, g.bin);
      assert.ok(Math.abs(min[1] - g.json.asset.extras.landmarks.floor) < 0.005 && Math.abs(max[1] - min[1] - g.json.asset.extras.landmarks.height) < 0.005, 'feet at the floor, height as the landmarks say');
      assert.ok(max[0] > 0.6 && min[0] < -0.6 && max[2] > 0.3 && min[2] < -0.3);
    }
  });

  test('rejects broken containers with a reason and never throws', () => {
    const buf = lite();
    const badMagic = Buffer.from(buf); badMagic.writeUInt32LE(0x12345678, 0);
    assert.match(readGlb(badMagic).reason, /magic/);
    const v1 = Buffer.from(buf); v1.writeUInt32LE(1, 4);
    assert.match(readGlb(v1).reason, /version 1/);
    assert.match(readGlb(buf.subarray(0, buf.length - 16)).reason, /declared length/);
    const notJson = Buffer.from(buf); notJson.writeUInt32LE(0x004e4942, 16);
    assert.match(readGlb(notJson).reason, /not JSON/);
    assert.match(readGlb(Buffer.alloc(8)).reason, /shorter/);
    assert.equal(readGlb(null).ok, false);
  });
});

describe('baseline GLB checks (build-soul-baseline.js)', () => {
  test('hero and lite pass: KHR_mesh_quantization, COLOR_0 RGBA mask, 24k / 6k triangles, landmarks, <= 400 KB', () => {
    const want = { hero: { tris: 24000, verts: 12002 }, lite: { tris: 6000, verts: 3002 } };
    for (const spec of LODS) {
      const buf = readFileSync(join(ROOT, SOURCE_DIR, spec.file));
      const r = inspectBaselineGlb(buf);
      assert.equal(r.ok, true, r.problems.join('; '));
      assert.equal(r.triangles, want[spec.lod].tris); assert.equal(r.vertices, want[spec.lod].verts);
      assert.ok(buf.length <= GLB_BUDGET_BYTES && GLB_BUDGET_BYTES === 400 * 1024);
      const L = r.landmarks;
      assert.equal(L.eyes.length, 2); assert.ok(L.orb.radius > 0.1 && L.orb.centre[1] > 1.9, 'orb sits on top');
      assert.ok(L.badge_anchor[1] > L.eyes[0].centre[1], 'badge anchor above the eyes');
      assert.ok(!r.warnings.some((w) => /min\/max/.test(w)), 'quantised min/max are the raw integers the glTF spec asks for');
    }
  });

  test('missing COLOR_0, missing KHR_mesh_quantization, missing landmarks, non-VEC4 mask and over-budget files are problems', () => {
    const cases = [
      [(j) => { delete j.meshes[0].primitives[0].attributes.COLOR_0; }, /COLOR_0 .*missing/],
      [(j) => { j.extensionsRequired = []; }, /KHR_mesh_quantization is not in extensionsRequired/],
      [(j) => { delete j.asset.extras.landmarks; }, /landmarks missing/],
      [(j) => { delete j.asset.extras.landmarks.badge_anchor; }, /badge_anchor/],
      [(j) => { j.asset.extras.landmarks.eyes = j.asset.extras.landmarks.eyes.slice(0, 1); }, /two/],
      [(j) => { j.accessors[j.meshes[0].primitives[0].attributes.COLOR_0].type = 'VEC3'; }, /VEC4/],
      [(j) => { j.asset.extras.triangles = 1; }, /asset.extras.triangles 1/],
      [(j) => { j.asset.extras.landmarks.height = 3; }, /disagrees with landmarks.height/],
      [(j) => { const a = j.accessors[j.meshes[0].primitives[0].attributes.POSITION]; a.min = a.min.map((v) => v / 32767); a.max = a.max.map((v) => v / 32767); }, /raw stored integers/],
    ];
    for (const [mutate, re] of cases) {
      const r = inspectBaselineGlb(repack(lite(), mutate));
      assert.equal(r.ok, false, String(re)); assert.ok(r.problems.some((p) => re.test(p)), `${re} in ${r.problems.join('; ')}`);
    }
    const padded = repack(lite(), (j) => { j.asset.extras.pad = 'x'.repeat(GLB_BUDGET_BYTES); });
    assert.ok(inspectBaselineGlb(padded).problems.some((p) => /budget/.test(p)));
    assert.equal(inspectBaselineGlb(Buffer.from('nope')).ok, false);
  });

  test('runtime copies are byte-identical to the Blender outputs and the manifest carries two kind: model entries', () => {
    const { entries } = parseManifest(readFileSync(join(ROOT, 'assets/manifest/assets.yaml'), 'utf8'));
    const prov = JSON.parse(readFileSync(join(ROOT, SOURCE_DIR, 'provenance.json'), 'utf8'));
    for (const spec of LODS) {
      const src = readFileSync(join(ROOT, SOURCE_DIR, spec.file)), dest = readFileSync(join(ROOT, RUNTIME_DIR, spec.file));
      assert.ok(src.equals(dest), `${spec.file} copied byte for byte`);
      assert.equal(sha(dest), prov.files[spec.file].sha256, 'matches provenance.json');
      const e = entries.find((x) => x.id === spec.id);
      assert.ok(e, spec.id);
      assert.equal(e.kind, 'model'); assert.equal(e.runtime_format, 'glb'); assert.equal(e.source_format, 'glb');
      assert.equal(e.source_file, `${SOURCE_DIR}/${spec.file}`); assert.equal(e.runtime_file, `${RUNTIME_DIR}/${spec.file}`);
      assert.equal(e.generator_script, GENERATOR); assert.equal(e.license, 'internal-original'); assert.equal(e.approved_by, null);
      assert.equal(e.checksum, `sha256:${sha(dest)}`); assert.equal(e.texture_memory_bytes, dest.length);
      assert.equal(e.triangle_count, prov.files[spec.file].triangles);
      const L = readGlb(dest).json.asset.extras.landmarks;
      assert.equal(e.bounds[1], L.height, 'height from the landmarks'); assert.ok(e.bounds[0] > 1.4 && e.bounds[0] < 1.5 && e.bounds[2] > 0.85 && e.bounds[2] < 0.95);
      assert.deepEqual(e.pivot, [0, L.floor, 0], 'pivot = feet');
    }
    const h = entries.find((x) => x.id === 'soul_baseline_hero');
    assert.deepEqual(h.lods, [`${RUNTIME_DIR}/soul-baseline-hero.glb`, `${RUNTIME_DIR}/soul-baseline-lite.glb`], 'hero LOD chain ends at the lite');
    assert.equal(h.fallback_file, `${RUNTIME_DIR}/soul-baseline-lite.glb`);
    assert.deepEqual(entries.find((x) => x.id === 'soul_baseline_lite').lods, [`${RUNTIME_DIR}/soul-baseline-lite.glb`]);
  });

  test('generator is idempotent in a copy and refuses bytes that do not match provenance.json (nothing written)', () => {
    const dir = tempTree(['assets', 'assets-src/generated/soul-baseline', 'tools/assets', 'tools/ai/blender']);
    const manifest = join(dir, 'assets/manifest/assets.yaml');
    const before = readFileSync(manifest, 'utf8');
    const r1 = buildSoulBaseline({ root: dir });
    assert.equal(r1.ok, true, r1.problems.join('; ')); assert.deepEqual(r1.written, []);
    assert.equal(readFileSync(manifest, 'utf8'), before, 'second generation is byte-identical');
    // fresh tree without runtime copies: both files are written, manifest unchanged
    rmSync(join(dir, RUNTIME_DIR), { recursive: true, force: true });
    const r2 = buildSoulBaseline({ root: dir });
    assert.deepEqual(r2.written.sort(), [`${RUNTIME_DIR}/soul-baseline-hero.glb`, `${RUNTIME_DIR}/soul-baseline-lite.glb`]);
    assert.equal(readFileSync(manifest, 'utf8'), before);
    // one flipped byte in the source: provenance mismatch, runtime left alone
    const src = join(dir, SOURCE_DIR, 'soul-baseline-lite.glb');
    const buf = readFileSync(src); buf[buf.length - 1] ^= 0xff; writeFileSync(src, buf);
    const runtimeBefore = readFileSync(join(dir, RUNTIME_DIR, 'soul-baseline-lite.glb'));
    const r3 = buildSoulBaseline({ root: dir });
    assert.equal(r3.ok, false); assert.ok(r3.problems.some((p) => /provenance/.test(p)), r3.problems.join('; '));
    assert.ok(readFileSync(join(dir, RUNTIME_DIR, 'soul-baseline-lite.glb')).equals(runtimeBefore));
    assert.equal(readFileSync(manifest, 'utf8'), before);
  });
});

describe('validator: kind model / glb', () => {
  test('the real tree reports the GLB budget (<= 400 KB each) and no glb problems', () => {
    const res = validateManifests({ root: ROOT });
    assert.equal(DEFAULT_BUDGETS.glbBytes, 400 * 1024);
    assert.equal(res.summary.budgets.glbBytes.limit, 400 * 1024);
    assert.equal(res.summary.budgets.glbBytes.used, statSync(join(ROOT, RUNTIME_DIR, 'soul-baseline-hero.glb')).size);
    assert.equal(res.problems.filter((p) => /glb|format\.model/.test(p.check)).length, 0);
  });

  test('corrupt GLB header, over-budget GLB and a model with a non-glb format are major problems', () => {
    const dir = tempTree();
    const heroPath = join(dir, RUNTIME_DIR, 'soul-baseline-hero.glb');
    const buf = readFileSync(heroPath); buf.writeUInt32LE(0xdeadbeef, 0); writeFileSync(heroPath, buf);
    const yaml = join(dir, 'assets/manifest/assets.yaml');
    const text = readFileSync(yaml, 'utf8');
    const i = text.indexOf('- id: soul_baseline_lite');
    writeFileSync(yaml, text.slice(0, i) + text.slice(i).replace('runtime_format: glb', 'runtime_format: svg'));
    const res = validateManifests({ root: dir, checkAssetMap: false });
    assert.equal(res.ok, false);
    const header = res.problems.filter((p) => p.check === 'glb.header');
    assert.equal(header.length, 1); assert.equal(header[0].severity, 'major'); assert.equal(header[0].path, `${RUNTIME_DIR}/soul-baseline-hero.glb`);
    assert.equal(res.problems.filter((p) => p.check === 'checksum.mismatch' && /hero/.test(p.path)).length, 1);
    assert.equal(res.problems.filter((p) => p.check === 'format.model').length, 1);
    const tight = validateManifests({ root: ROOT, checkAssetMap: false, budgets: { glbBytes: 100 * 1024 } });
    const over = tight.problems.filter((p) => p.check === 'budget.glb');
    assert.deepEqual(over.map((p) => p.path), [`${RUNTIME_DIR}/soul-baseline-hero.glb`, 'assets/souls/v3/body-hero.glb'], 'only the two hero bodies (baseline and v3, D-31) exceed 100 KB, each reported once');
  });
});

describe('asset map exposes the baseline models', () => {
  test('ASSETS.souls.baseline, soulModelUrl() and assetUrl() resolve the GLB URLs', async () => {
    const m = await import(join(ROOT, 'packages/ui/asset-map.js'));
    const b = m.ASSETS.souls.baseline;
    assert.equal(b.format, 'glb');
    assert.equal(b.hero, '/assets/souls/baseline/soul-baseline-hero.glb');
    assert.equal(b.lite, '/assets/souls/baseline/soul-baseline-lite.glb');
    assert.deepEqual({ ...b.triangles }, { hero: 24000, lite: 6000 });
    assert.equal(b.sha256.hero, sha(readFileSync(join(ROOT, RUNTIME_DIR, 'soul-baseline-hero.glb'))));
    assert.ok(Object.isFrozen(b) && Object.isFrozen(b.sha256));
    assert.equal(m.soulModelUrl(), b.hero); assert.equal(m.soulModelUrl('hero'), b.hero); assert.equal(m.soulModelUrl('lite'), b.lite);
    assert.equal(m.assetUrl('soul_baseline_hero'), b.hero); assert.equal(m.assetUrl('soul_baseline_lite'), b.lite);
    assert.equal(m.fallbackUrl('soul_baseline_hero'), b.lite);
    assert.equal(m.ASSETS.entries.soul_baseline_hero.kind, 'model'); assert.equal(m.ASSETS.entries.soul_baseline_hero.format, 'glb');
  });
});
