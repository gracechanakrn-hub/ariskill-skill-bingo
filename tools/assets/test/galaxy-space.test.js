// tools/assets/test/galaxy-space.test.js - the big screen's space backdrop pack (stage 15, D-36): the committed pack in
// assets/space/ against provenance.json, the JPEG / WebP header readers, the budgets, the manifest entries and the
// build-all step. Run: node --test tools/assets/test
// Mutation cases run on disposable copies under ASSET_INT_SCRATCH or os.tmpdir() (never the real tree).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGalaxySpace, jpegInfo, webpInfo, specFiles, SPACE_BUDGETS, GENERATOR, RENDER_SCRIPT, SOURCE_DIR, RUNTIME, MANIFEST } from '../build-galaxy-space.js';
import { GENERATORS } from '../build-all.js';
import { parseManifest } from '../lib/manifest.js';
import { validateManifests } from '../validate-manifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRATCH = process.env.ASSET_INT_SCRATCH || tmpdir();
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
/** A minimal tree: the pack, its provenance and the manifest. */
function tempTree() {
  mkdirSync(SCRATCH, { recursive: true });
  const dir = mkdtempSync(join(SCRATCH, 'galaxy-space-'));
  made.push(dir);
  cpSync(join(ROOT, RUNTIME), join(dir, RUNTIME), { recursive: true });
  mkdirSync(join(dir, SOURCE_DIR), { recursive: true });
  cpSync(join(ROOT, SOURCE_DIR, 'provenance.json'), join(dir, SOURCE_DIR, 'provenance.json'));
  mkdirSync(join(dir, 'assets/manifest'), { recursive: true });
  cpSync(join(ROOT, MANIFEST), join(dir, MANIFEST));
  return dir;
}

test('the committed pack matches its provenance, holds its budgets and lists 9 entries in the manifest', () => {
  const r = buildGalaxySpace({ root: tempTree() });
  assert.equal(r.ok, true, r.problems.join('\n'));
  const ids = r.entries.map((e) => e.id).sort();
  assert.deepEqual(ids, ['space_backdrop', 'space_config', 'space_constellations', 'space_falling_star',
    'space_meteor_1', 'space_meteor_2', 'space_meteor_3', 'space_meteor_4', 'space_meteor_5']);
  const by = Object.fromEntries(r.entries.map((e) => [e.id, e]));
  assert.equal(by.space_backdrop.runtime_format, 'jpeg'); assert.equal(by.space_backdrop.source_file, RENDER_SCRIPT);
  assert.equal(by.space_meteor_1.source_file, RENDER_SCRIPT, 'the meteors are Blender renders');
  assert.equal(by.space_constellations.source_file, GENERATOR, 'the lines are drawn by the packer');
  assert.equal(by.space_config.kind, 'data');
  for (const e of r.entries) {
    assert.equal(e.generator_script, GENERATOR);
    assert.ok(e.runtime_file.startsWith(`${RUNTIME}/`), 'outside assets/scene/, so the 120 KB scene-data budget stays scene data');
    assert.equal(e.fallback_file, null);
    if (e.kind === 'texture') assert.ok(['jpeg', 'webp'].includes(e.runtime_format));
  }
  assert.ok(r.bytes <= SPACE_BUDGETS.spaceBytes && r.textureBytes <= SPACE_BUDGETS.textureBytes, `${r.bytes} bytes, ${r.textureBytes} decoded`);
  // the real manifest carries exactly these entries, byte-identical to a fresh merge
  const real = parseManifest(readFileSync(join(ROOT, MANIFEST), 'utf8')).entries.filter((e) => e.generator_script === GENERATOR);
  assert.deepEqual(real.map((e) => e.id).sort(), ids, 'assets.yaml is current (node tools/assets/build-galaxy-space.js)');
  for (const e of real) assert.equal(e.checksum, by[e.id].checksum, e.id);
});

test('the backdrop is the plate (region x overscan x scale) and every other layer has alpha; space.json names exactly the images', () => {
  const spec = JSON.parse(readFileSync(join(ROOT, RUNTIME, 'space.json'), 'utf8'));
  const back = jpegInfo(readFileSync(join(ROOT, RUNTIME, spec.backdrop.file)));
  assert.equal(back.ok, true);
  assert.equal(spec.scale, 2, 'D-57: the plates are rendered at 2x for a 4K big screen');
  assert.deepEqual([back.width, back.height], [Math.round(spec.region.width * spec.overscan * spec.scale), Math.round(spec.region.height * spec.overscan * spec.scale)]);
  const lines = webpInfo(readFileSync(join(ROOT, RUNTIME, spec.constellations.file)));
  assert.deepEqual([lines.width, lines.height], [back.width, back.height], 'the constellation plate matches the backdrop');
  const layers = specFiles(spec).filter((f) => f !== spec.backdrop.file);
  assert.equal(layers.length, 2 + spec.meteors.length);
  for (const f of layers) { const w = webpInfo(readFileSync(join(ROOT, RUNTIME, f))); assert.equal(w.ok, true, f); assert.equal(w.alpha, true, f); }
});

test('header readers: JPEG SOF0 / SOF2 and WebP VP8 / VP8L / VP8X; anything else is refused', () => {
  const jpeg = (sof) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, sof, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03]);
  assert.deepEqual(jpegInfo(jpeg(0xc0)), { ok: true, width: 800, height: 600, progressive: false });
  assert.deepEqual(jpegInfo(jpeg(0xc2)), { ok: true, width: 800, height: 600, progressive: true });
  assert.equal(jpegInfo(Buffer.from('not a jpeg')).ok, false);
  assert.equal(jpegInfo(Buffer.from([0xff, 0xd8, 0xff, 0xd9])).ok, false, 'no frame header');
  const riff = (chunk, body) => { const b = Buffer.alloc(40); b.write('RIFF', 0); b.writeUInt32LE(32, 4); b.write('WEBP', 8); b.write(chunk, 12); body(b); return b; };
  const vp8x = riff('VP8X', (b) => { b[20] = 0x10; b.writeUIntLE(1372, 24, 3); b.writeUIntLE(1187, 27, 3); });
  assert.deepEqual(webpInfo(vp8x), { ok: true, width: 1373, height: 1188, alpha: true });
  const vp8l = riff('VP8L', (b) => { b[20] = 0x2f; b.writeUInt32LE((99) | (49 << 14) | (1 << 28), 21); });
  assert.deepEqual(webpInfo(vp8l), { ok: true, width: 100, height: 50, alpha: true });
  const vp8 = riff('VP8 ', (b) => { b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a; b.writeUInt16LE(512, 26); b.writeUInt16LE(48, 28); });
  assert.deepEqual(webpInfo(vp8), { ok: true, width: 512, height: 48, alpha: false });
  assert.equal(webpInfo(riff('ABCD', () => {})).ok, false);
  assert.equal(webpInfo(Buffer.from('RIFF....WAVEfmt ')).ok, false);
});

test('a hand-edited, extra or missing file fails the step and leaves the manifest untouched', () => {
  const edited = tempTree();
  const manifestBefore = readFileSync(join(edited, MANIFEST), 'utf8');
  const specPath = join(edited, RUNTIME, 'space.json');
  writeFileSync(specPath, readFileSync(specPath, 'utf8').replace('"maxAlpha": 0.9', '"maxAlpha": 1'));
  let r = buildGalaxySpace({ root: edited });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /space\.json: differs from provenance/.test(p)), r.problems.join('\n'));
  assert.equal(readFileSync(join(edited, MANIFEST), 'utf8'), manifestBefore);

  const extra = tempTree();
  writeFileSync(join(extra, RUNTIME, 'meteor-6.webp'), readFileSync(join(extra, RUNTIME, 'meteor-5.webp')));
  r = buildGalaxySpace({ root: extra });
  assert.ok(r.problems.some((p) => /meteor-6\.webp: not listed in provenance/.test(p)), r.problems.join('\n'));

  const missing = tempTree();
  rmSync(join(missing, RUNTIME, 'falling-star.webp'));
  r = buildGalaxySpace({ root: missing });
  assert.ok(r.problems.some((p) => /falling-star\.webp: missing/.test(p)), r.problems.join('\n'));

  const noProv = tempTree();
  rmSync(join(noProv, SOURCE_DIR, 'provenance.json'));
  r = buildGalaxySpace({ root: noProv });
  assert.ok(r.problems.some((p) => /provenance\.json missing/.test(p)));
});

test('budgets: a layer, the backdrop or the decoded total over its limit fails', () => {
  const tree = tempTree();
  let r = buildGalaxySpace({ root: tree, budgets: { layerBytes: 12 * 1024 } });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /constellations\.webp: \d+ bytes > 12288/.test(p)), r.problems.join('\n'));
  r = buildGalaxySpace({ root: tree, budgets: { backdropBytes: 64 * 1024 } });
  assert.ok(r.problems.some((p) => /backdrop\.jpg: \d+ bytes > 65536/.test(p)));
  r = buildGalaxySpace({ root: tree, budgets: { textureBytes: 8 * 1024 * 1024 } });
  assert.ok(r.problems.some((p) => /decoded texture/.test(p)));
});

test('build-all runs the step after the Soul faces and before audio; the validator sees no orphan under assets/space', () => {
  const ids = GENERATORS.map((g) => g.id);
  assert.ok(ids.indexOf('galaxy-space') > ids.indexOf('soul-face') && ids.indexOf('galaxy-space') < ids.indexOf('audio'), ids.join(' -> '));
  const res = validateManifests({ root: ROOT });
  assert.deepEqual(res.problems.filter((p) => String(p.path).startsWith(`${RUNTIME}/`)), []);
});
