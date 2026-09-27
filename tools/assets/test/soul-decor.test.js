// tools/assets/test/soul-decor.test.js - Soul decorations (D-29): the charm and face-kit GLBs and PNGs, their runtime
// copies, manifest entries, the data module's URLs and hashes, and the validator's decor budgets.
// Run: node --test tools/assets/test. Mutation cases run on disposable copies under the scratch dir (never the real tree).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb, GLB_MAGIC } from '../lib/glb.js';
import { inspectCharmGlb, inspectFaceGlb, buildSoulDecor, readCatalog, readDecorData, pngInfo, SOURCE_DIR, RUNTIME, GENERATOR, FACES, SHA_CHARS } from '../build-soul-decor.js';
import { validateManifests, DECOR_BUDGETS } from '../validate-manifest.js';
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
// Blender masters and review renders are not inputs of any check: keep the copies small.
const SKIP = /(^|\/)(node_modules|test|\.git)$|\.(blend|blend1|npy)$|soul-decor\/v1\/renders|soul-baseline\/v1\/.*\.png$/;
function tempTree(dirs = ['assets', 'assets-src/generated/soul-decor', 'assets-src/charms', 'tools/assets', 'packages/ui', 'packages/game-rules']) {
  const dir = mkdtempSync(join(SCRATCH, 'decor-'));
  for (const d of dirs) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(dir, d), { recursive: true, filter: (src) => !SKIP.test(src) });
  made.push(dir);
  return dir;
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const DATA = readDecorData(ROOT);
const BUILT = Object.keys(DATA.charm.files);
const THICKNESS = DATA.charm.thickness;
const runtime = (group, file) => readFileSync(join(ROOT, RUNTIME[group], file));

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

describe('charm models (assets/souls/charms)', () => {
  test('every built charm: quantised GLB in the local frame (outline diameter 1, back at the origin), external <id>.png texture, within budget', () => {
    assert.ok(BUILT.length >= 134, `${BUILT.length} charms built`);
    let maxGlb = 0, maxPng = 0;
    for (const id of BUILT) {
      const glb = runtime('charms', `${id}.glb`);
      const r = inspectCharmGlb(glb, id, { thickness: THICKNESS });
      assert.equal(r.ok, true, `${id}: ${r.problems.join('; ')}`);
      assert.ok(Math.abs(r.radius - 0.5) < 0.012 && r.bounds.min[2] <= 0.001 && r.bounds.max[2] <= THICKNESS + 0.01);
      assert.ok(r.triangles >= 600 && r.triangles <= 1200, `${id} ${r.triangles} triangles`);
      const png = runtime('charms', `${id}.png`);
      const p = pngInfo(png);
      assert.equal(p.width, 128); assert.equal(p.height, 128); assert.equal(p.alpha, true);
      maxGlb = Math.max(maxGlb, glb.length); maxPng = Math.max(maxPng, png.length);
    }
    assert.ok(maxGlb <= DECOR_BUDGETS.charmGlbBytes && maxPng <= DECOR_BUDGETS.charmPngBytes);
  });

  test('material keeps the icon colours: base colour and emissive share the one PNG, not metallic', () => {
    const g = readGlb(runtime('charms', `${BUILT[0]}.glb`)).json;
    const m = g.materials[0];
    assert.equal(m.pbrMetallicRoughness.metallicFactor, 0);
    assert.equal(m.emissiveTexture.index, m.pbrMetallicRoughness.baseColorTexture.index);
    assert.ok(m.emissiveFactor.every((v) => v >= 0.25 && v <= 0.4));
    assert.deepEqual(g.images, [{ uri: `${BUILT[0]}.png`, mimeType: 'image/png' }]);
    assert.deepEqual(g.extensionsRequired, ['KHR_mesh_quantization']);
    const acc = g.accessors[g.meshes[0].primitives[0].attributes.TEXCOORD_0];
    assert.equal(acc.componentType, 5123); assert.equal(acc.normalized, true);
  });

  test('broken charms are problems: embedded or absolute texture, float min/max, wrong outline size, over budget', () => {
    const buf = runtime('charms', `${BUILT[0]}.glb`);
    const id = BUILT[0];
    const cases = [
      [(j) => { j.images[0] = { bufferView: 0, mimeType: 'image/png' }; }, /embedded/],
      [(j) => { j.images[0].uri = `/assets/souls/charms/${id}.png`; }, /relative/],
      [(j) => { j.images[0].uri = `blob:${id}.png`; }, /relative/],
      [(j) => { const a = j.accessors[0]; a.min = a.min.map((v) => v / 32767); a.max = a.max.map((v) => v / 32767); }, /raw stored integers/],
      [(j) => { j.nodes[0].scale = j.nodes[0].scale.map((v) => v * 1.3); }, /outline radius/],
      [(j) => { j.nodes[0].translation[2] += 0.05; }, /back at z/],
      [(j) => { j.extensionsRequired = []; }, /extensionsRequired/],
      [(j) => { j.materials[0].pbrMetallicRoughness.metallicFactor = 1; }, /metallic/],
      [(j) => { j.asset.extras.pad = 'x'.repeat(DECOR_BUDGETS.charmGlbBytes); }, /budget/],
    ];
    for (const [mutate, re] of cases) {
      const r = inspectCharmGlb(repack(buf, mutate), id, { thickness: THICKNESS });
      assert.equal(r.ok, false, String(re)); assert.ok(r.problems.some((p) => re.test(p)), `${re} in ${r.problems.join('; ')}`);
    }
    assert.equal(inspectCharmGlb(Buffer.from('nope'), id).ok, false);
  });
});

describe('face kits (assets/souls/faces)', () => {
  test('three kits in model space with core-PBR parts; the angel halo glows and its blush blends', () => {
    const want = { nerdy: ['rim_left', 'rim_right', 'bridge', 'temple_left', 'temple_right'], pirate: ['patch', 'strap', 'bandana', 'bandana_hem', 'bandana_top', 'bandana_knot', 'bandana_dots'], angel: ['halo', 'blush_left', 'blush_right'] };
    for (const f of FACES) {
      const buf = runtime('faces', `face-${f}.glb`);
      const r = inspectFaceGlb(buf, f);
      assert.equal(r.ok, true, `${f}: ${r.problems.join('; ')}`);
      assert.deepEqual(r.parts, want[f]);
      assert.ok(buf.length <= DECOR_BUDGETS.faceGlbBytes);
      const g = readGlb(buf).json;
      for (const m of g.materials) assert.ok(!m.pbrMetallicRoughness.metallicFactor, `${f}/${m.name} is not metallic (no gold status look)`);
    }
    const halo = readGlb(runtime('faces', 'face-angel.glb')).json.materials.find((m) => m.name === 'halo');
    assert.ok(halo.emissiveFactor[0] > 0.9 && halo.emissiveFactor[2] > 0.5, 'warm white light, not gold');
    const bad = repack(runtime('faces', 'face-angel.glb'), (j) => { for (const m of j.materials) delete m.alphaMode; });
    assert.ok(inspectFaceGlb(bad, 'angel').problems.some((p) => /BLEND/.test(p)));
  });

  test('front sprites: 800 px RGBA over the 200 viewBox (glasses frame both eyes, the patch covers the left eye, the halo floats)', async () => {
    const zlib = await import('node:zlib');
    function decode(buf) {  // 8-bit RGBA or palette PNG, non-interlaced -> { w, h, px(x, y) -> [r, g, b, a] }
      let off = 8, w = 0, h = 0, type = 0, pal = null, trns = null; const idat = [];
      while (off < buf.length) {
        const len = buf.readUInt32BE(off), t = buf.toString('ascii', off + 4, off + 8), d = buf.subarray(off + 8, off + 8 + len);
        if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); type = d[9]; } else if (t === 'PLTE') pal = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d);
        off += 12 + len;
      }
      const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = type === 6 ? 4 : 1, stride = w * bpp;
      const out = Buffer.alloc(h * stride); let prev = Buffer.alloc(stride);
      for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = Buffer.alloc(stride);
        for (let x = 0; x < stride; x++) {
          const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
          const p = a + b - c, pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
          cur[x] = (line[x] + [0, a, b, (a + b) >> 1, pr][f]) & 255;
        }
        cur.copy(out, y * stride); prev = cur;
      }
      return { w, h, px: (x, y) => (type === 6 ? [...out.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)] : [...pal.subarray(out[y * w + x] * 3, out[y * w + x] * 3 + 3), trns && out[y * w + x] < trns.length ? trns[out[y * w + x]] : 255]) };
    }
    const at = (img, vx, vy) => img.px(Math.round(vx * 4), Math.round(vy * 4));   // viewBox -> sprite pixel
    const sprites = Object.fromEntries(FACES.map((f) => [f, decode(runtime('faces', `face-${f}-front.png`))]));
    for (const f of FACES) { assert.equal(sprites[f].w, 800); assert.equal(sprites[f].h, 800); assert.equal(at(sprites[f], 2, 2)[3], 0, 'transparent corner'); }
    // soul-baseline-shape.js EYES: centres (85.6, 97.1) and (114.4, 97.1), groove ring about 10.4 x 9.1
    for (const cx of [85.6, 114.4]) {
      const ring = [[cx - 12.5, 97.1], [cx + 12.5, 97.1], [cx, 97.1 - 11.6], [cx, 97.1 + 11.6]].filter(([x, y]) => at(sprites.nerdy, x, y)[3] > 128);
      assert.ok(ring.length >= 3, `glasses rim around the eye at ${cx}`);
      assert.ok(at(sprites.nerdy, cx, 97.1)[3] < 30, 'the button eye stays visible through the frame');
    }
    const disc = []; for (let dx = -6; dx <= 6; dx += 2) for (let dy = -6; dy <= 6; dy += 2) if (dx * dx + dy * dy <= 36) disc.push(at(sprites.pirate, 114.4 + dx, 97.1 + dy));
    assert.ok(disc.every((p) => p[3] > 250), 'the patch covers the character\'s left eye (viewer\'s right)');
    assert.ok(disc.reduce((a, p) => a + p[0] + p[1] + p[2], 0) / disc.length < 420, 'a dark (plum) patch, well below the pastel body');
    assert.ok(at(sprites.pirate, 85.6, 97.1)[3] < 30, 'the other eye stays free');
    let halo = 0; for (let x = 80; x < 135; x++) for (let y = 38; y < 62; y++) if (at(sprites.angel, x, y)[3] > 200) halo++;
    assert.ok(halo > 60, `halo ring above the head (${halo} px)`);
  });
});

describe('runtime copies, manifest and data module', () => {
  test('runtime files equal the Blender outputs and provenance.json; manifest has one kind: model entry per charm and kit', () => {
    const prov = JSON.parse(readFileSync(join(ROOT, SOURCE_DIR, 'provenance.json'), 'utf8'));
    const { entries } = parseManifest(readFileSync(join(ROOT, 'assets/manifest/assets.yaml'), 'utf8'));
    const mine = entries.filter((e) => e.generator_script === GENERATOR);
    assert.equal(mine.length, BUILT.length + FACES.length);
    for (const id of BUILT) {
      for (const ext of ['glb', 'png']) {
        const buf = runtime('charms', `${id}.${ext}`);
        assert.equal(sha(buf), prov.files[`charms/${id}.${ext}`].sha256, `${id}.${ext} provenance`);
        const staged = join(ROOT, SOURCE_DIR, 'charms', `${id}.${ext}`);
        if (existsSync(staged)) assert.ok(readFileSync(staged).equals(buf), `${id}.${ext} copied byte for byte`);
      }
      const e = mine.find((x) => x.id === `soul_charm_${id.replace(/-/g, '_')}`);
      assert.ok(e, id);
      assert.equal(e.kind, 'model'); assert.equal(e.runtime_file, `${RUNTIME.charms}/${id}.glb`); assert.equal(e.fallback_file, `${RUNTIME.charms}/${id}.png`);
      assert.equal(e.checksum, `sha256:${sha(runtime('charms', `${id}.glb`))}`); assert.ok(e.triangle_count > 0); assert.deepEqual(e.pivot, [0, 0, 0]);
    }
    for (const f of FACES) {
      const e = mine.find((x) => x.id === `soul_face_${f}`);
      assert.equal(e.runtime_file, `${RUNTIME.faces}/face-${f}.glb`); assert.equal(e.fallback_file, `${RUNTIME.faces}/face-${f}-front.png`);
    }
    const files = readdirSync(join(ROOT, RUNTIME.charms)).sort();
    assert.deepEqual(files, BUILT.flatMap((id) => [`${id}.glb`, `${id}.png`]).sort(), 'no stray files');
  });

  test('data module URLs carry the runtime files\' hashes; every catalog charm is listed or reported missing', () => {
    const cat = readCatalog(ROOT);
    for (const id of BUILT) {
      assert.equal(DATA.charm.files[id].glb, `/${RUNTIME.charms}/${id}.glb?v=${sha(runtime('charms', `${id}.glb`)).slice(0, SHA_CHARS)}`);
      assert.equal(DATA.charm.files[id].png, `/${RUNTIME.charms}/${id}.png?v=${sha(runtime('charms', `${id}.png`)).slice(0, SHA_CHARS)}`);
    }
    for (const f of FACES) assert.equal(DATA.faces[f].sprite, `/${RUNTIME.faces}/face-${f}-front.png?v=${sha(runtime('faces', `face-${f}-front.png`)).slice(0, SHA_CHARS)}`);
    assert.deepEqual(DATA.charm.missing, cat.charms.map((c) => c.id).filter((id) => !BUILT.includes(id)));
    for (const id of DATA.charm.missing) assert.ok(!existsSync(join(ROOT, 'assets-src', 'charms', 'icons', `${id}.png`)) || !existsSync(join(ROOT, SOURCE_DIR, 'charms', `${id}.glb`)), `${id} is missing only while unbuilt`);
  });

  test('generator: idempotent in a copy; refuses bytes that disagree with provenance.json and a stale data module', () => {
    const dir = tempTree();
    const manifest = join(dir, 'assets/manifest/assets.yaml');
    const before = readFileSync(manifest, 'utf8');
    const r1 = buildSoulDecor({ root: dir });
    assert.equal(r1.ok, true, r1.problems.join('; ')); assert.deepEqual(r1.written, []);
    assert.equal(readFileSync(manifest, 'utf8'), before, 'second generation is byte-identical');
    assert.deepEqual(r1.missing, DATA.charm.missing);
    if (r1.missing.length) assert.ok(r1.warnings.some((w) => w.includes(r1.missing[0])), 'missing charms are reported, not silent');
    // fresh clone: the staged PNGs are git-ignored; the runtime copies are verified against provenance instead
    for (const f of readdirSync(join(dir, SOURCE_DIR, 'charms'))) if (f.endsWith('.png')) rmSync(join(dir, SOURCE_DIR, 'charms', f));
    const r2 = buildSoulDecor({ root: dir });
    assert.equal(r2.ok, true, r2.problems.join('; ')); assert.deepEqual(r2.written, []);
    // one flipped byte in a staged model: provenance mismatch, runtime left alone
    const src = join(dir, SOURCE_DIR, 'charms', `${BUILT[0]}.glb`);
    const buf = readFileSync(src); buf[buf.length - 1] ^= 0xff; writeFileSync(src, buf);
    const runtimeBefore = readFileSync(join(dir, RUNTIME.charms, `${BUILT[0]}.glb`));
    const r3 = buildSoulDecor({ root: dir });
    assert.equal(r3.ok, false); assert.ok(r3.problems.some((p) => /provenance/.test(p)), r3.problems.join('; '));
    assert.ok(readFileSync(join(dir, RUNTIME.charms, `${BUILT[0]}.glb`)).equals(runtimeBefore));
    // a stale data module (a file hash that no longer matches)
    buf[buf.length - 1] ^= 0xff; writeFileSync(src, buf);
    const dm = join(dir, 'packages/ui/soul-decor-data.js');
    writeFileSync(dm, readFileSync(dm, 'utf8').replace(DATA.charm.files[BUILT[1]].png, `/${RUNTIME.charms}/${BUILT[1]}.png?v=0000000000`));
    const r4 = buildSoulDecor({ root: dir });
    assert.equal(r4.ok, false); assert.ok(r4.problems.some((p) => p.includes(BUILT[1]) && /stale/.test(p)), r4.problems.join('; '));
  });
});

describe('validator: decor budgets', () => {
  test('the real tree reports the decor total and per-file maxima within budget, and no decor problems', () => {
    const res = validateManifests({ root: ROOT, checkAssetMap: false });
    const b = res.summary.budgets;
    let total = 0;
    for (const g of ['charms', 'faces']) for (const f of readdirSync(join(ROOT, RUNTIME[g]))) total += readFileSync(join(ROOT, RUNTIME[g], f)).length;
    assert.equal(b.decorBytes.used, total); assert.equal(b.decorBytes.limit, DECOR_BUDGETS.decorBytes);
    for (const k of ['charmGlbBytes', 'charmPngBytes', 'faceGlbBytes', 'faceSpriteBytes']) assert.ok(b[k].used > 0 && b[k].used <= b[k].limit, k);
    assert.equal(res.problems.filter((p) => /decor/.test(p.check)).length, 0, JSON.stringify(res.problems.filter((p) => /decor/.test(p.check))));
    const tight = validateManifests({ root: ROOT, checkAssetMap: false, budgets: { decorBytes: 1000, charmPngBytes: 1000 } });
    assert.ok(tight.problems.filter((p) => p.check === 'budget.decor').length > 10);
  });

  test('a charm whose texture URI does not point at its sibling PNG is a major decor.glb problem', () => {
    const dir = tempTree(['assets', 'assets-src/generated/soul-decor', 'tools/assets', 'packages/ui', 'packages/game-rules', 'tools/ai/blender']);
    const p = join(dir, RUNTIME.charms, `${BUILT[2]}.glb`);
    writeFileSync(p, repack(readFileSync(p), (j) => { j.images[0].uri = 'elsewhere.png'; }));
    const res = validateManifests({ root: dir, checkAssetMap: false });
    const hits = res.problems.filter((x) => x.check === 'decor.glb');
    assert.equal(hits.length, 1); assert.equal(hits[0].severity, 'major'); assert.match(hits[0].detail, /relative URI/);
  });
});
