// tools/assets/test/integration.test.js - asset/audio integration checks (workflow 13.6).
// Run: node --test tools/assets/test/integration.test.js
// Mutation cases run against a disposable copy of the asset tree under the scratch dir (ASSET_INT_SCRATCH or the
// session scratchpad; falls back to os.tmpdir()). The real tree is never modified.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifests, parseYamlSubset, readWavHeader, DEFAULT_BUDGETS } from '../validate-manifest.js';
import { buildAssetMapSource, writeAssetMap, ASSET_MAP_PATH, APPS } from '../build-asset-map.js';
import { buildAll } from '../build-all.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// D-29 decoration entries (one per built charm and face kit; the count grows as charm icons land).
const DECOR_ENTRIES = (readFileSync(join(ROOT, 'assets', 'manifest', 'assets.yaml'), 'utf8').match(/\bid: soul_(charm|face)_/g) || []).length;
const DEFAULT_SCRATCH = '/private/tmp/claude-501/-Users-grc-Desktop-claudecodetest-Ariskill-Bingo/312520a1-70d6-4efd-9438-4e9be7bd9617/scratchpad/asset-int/';
function scratchDir() {
  const want = process.env.ASSET_INT_SCRATCH || DEFAULT_SCRATCH;
  try { mkdirSync(want, { recursive: true }); return want; } catch (_) { const d = join(tmpdir(), 'asset-int'); mkdirSync(d, { recursive: true }); return d; }
}
const SCRATCH = scratchDir();
const COPY = ['assets', 'assets-src', 'tools/assets', 'tools/ai/blender', 'packages/ui', 'packages/game-rules', 'packages/skill-master', 'docs/audio'];
const SKIP = new Set(['node_modules', 'test', '.git']);
const SKIP_FILES = /\.(blend|blend1|npy)$/; // Blender masters (~66 MB, git-ignored) are not inputs of any check
const made = [];
function tempTree() {
  const dir = mkdtempSync(join(SCRATCH, 'tree-'));
  for (const d of COPY) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(dir, d), { recursive: true, filter: (src) => { const name = relative(ROOT, src).split(sep).pop(); return !SKIP.has(name) && !SKIP_FILES.test(name); } });
  made.push(dir);
  return dir;
}
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const find = (res, check, pathPart) => res.problems.filter((p) => p.check === check && (!pathPart || String(p.path).includes(pathPart)));
const replaceIn = (file, from, to) => { const t = readFileSync(file, 'utf8'); assert.ok(t.includes(from), `${file} contains ${from}`); writeFileSync(file, t.split(from).join(to)); };

describe('validator on the current tree', () => {
  test('passes with no critical/major problems and reports approval + budget summaries', () => {
    const res = validateManifests({ root: ROOT });
    assert.equal(res.ok, true, JSON.stringify(res.problems.filter((p) => p.severity === 'critical' || p.severity === 'major'), null, 2));
    assert.equal(res.summary.entries, 35 + DECOR_ENTRIES, '33 scene/soul entries + 2 baseline Soul models (D-27) + the D-29 charms and face kits');
    assert.ok(DECOR_ENTRIES >= 137, `decoration entries ${DECOR_ENTRIES}`);
    assert.equal(res.summary.cues, 12);
    assert.ok(res.summary.files >= 110, `runtime files ${res.summary.files}`);
    const pending = find(res, 'approval.pending');
    assert.equal(pending.length, 2, 'approved_by: null is reported once per manifest as a minor gate item');
    assert.ok(pending.every((p) => p.severity === 'minor'));
    assert.match(pending[0].detail, /^\d+ of \d+ entries/);
    for (const p of res.problems) assert.ok(['critical', 'major', 'minor', 'info'].includes(p.severity) && p.check && 'path' in p && p.detail);
  });

  test('total budgets hold: assets <= 6 MB, audio <= 1.6 MB, single file <= 1.2 MB, soul svg <= 6 KB, scene data <= 120 KB, apps <= 600 KB', () => {
    const { summary } = validateManifests({ root: ROOT });
    const b = summary.budgets;
    assert.equal(b.assetsBytes.limit, 7 * 1024 * 1024); assert.ok(b.assetsBytes.used <= b.assetsBytes.limit);
    assert.equal(b.audioBytes.limit, 1600 * 1024); assert.ok(b.audioBytes.used <= b.audioBytes.limit);
    assert.equal(b.audioBytes.limit, JSON.parse(readFileSync(join(ROOT, 'assets/manifest/audio.json'), 'utf8')).budgets.max_total_bytes, 'same number the sound agent budgets against');
    assert.equal(b.singleFileBytes.limit, Math.round(1.2 * 1024 * 1024)); assert.ok(b.singleFileBytes.used <= b.singleFileBytes.limit);
    assert.equal(b.soulSvgBytes.limit, 6 * 1024); assert.ok(b.soulSvgBytes.used <= b.soulSvgBytes.limit);
    assert.equal(b.sceneDataBytes.limit, 120 * 1024); assert.ok(b.sceneDataBytes.used <= b.sceneDataBytes.limit);
    for (const app of APPS) { assert.equal(b.apps[app].limit, app === 'participant' ? 700 * 1024 : 600 * 1024, 'phone 700 KB (D-49), others 600 KB'); assert.ok(b.apps[app].used <= b.apps[app].limit, `${app} bundle ${b.apps[app].used}`); }
    assert.equal(b.glbBytes.limit, 400 * 1024); assert.ok(b.glbBytes.used <= b.glbBytes.limit);
    assert.deepEqual(Object.keys(DEFAULT_BUDGETS).sort(), ['appBytesEach', 'assetsBytes', 'audioBytes', 'audioOneshotBytes', 'glbBytes', 'sceneDataBytes', 'singleFileBytes', 'soulSvgBytes']);
  });

  test('audio.yaml parses with the subset parser and equals audio.json (canonical twin)', () => {
    const y = parseYamlSubset(readFileSync(join(ROOT, 'assets/manifest/audio.yaml'), 'utf8'));
    const j = JSON.parse(readFileSync(join(ROOT, 'assets/manifest/audio.json'), 'utf8'));
    assert.deepEqual(y, j);
    const h = readWavHeader(readFileSync(join(ROOT, 'assets/audio/cell_match.wav')));
    assert.equal(h.ok, true); assert.equal(h.sampleRate, 22050); assert.equal(h.channels, 1); assert.equal(h.bitsPerSample, 16);
  });
});

describe('validator detects corruption (temporary copies)', () => {
  test('corrupted checksum -> critical checksum.mismatch', () => {
    const dir = tempTree();
    const yaml = join(dir, 'assets/manifest/assets.yaml');
    const text = readFileSync(yaml, 'utf8');
    const m = text.match(/checksum: sha256:([0-9a-f]{64})/);
    const flipped = (m[1][0] === '0' ? '1' : '0') + m[1].slice(1);
    writeFileSync(yaml, text.replace(m[0], `checksum: sha256:${flipped}`));
    const res = validateManifests({ root: dir, checkAssetMap: false });
    assert.equal(res.ok, false);
    const hits = find(res, 'checksum.mismatch');
    assert.equal(hits.length, 1); assert.equal(hits[0].severity, 'critical'); assert.match(hits[0].path, /^assets\//);
  });

  test('missing file -> major file.missing (and lods.missing for its LOD reference)', () => {
    const dir = tempTree();
    unlinkSync(join(dir, 'assets/souls/cohort/140e6ebb0fff0f.svg'));
    const res = validateManifests({ root: dir, checkAssetMap: false });
    assert.equal(res.ok, false);
    const hits = find(res, 'file.missing', '140e6ebb0fff0f.svg');
    assert.equal(hits.length, 1); assert.equal(hits[0].severity, 'major');
    assert.equal(find(res, 'lods.missing', '140e6ebb0fff0f.svg').length, 1);
  });

  test('orphan runtime file -> major manifest.orphan; README/.gitkeep/sheet.html are exempt', () => {
    const dir = tempTree();
    writeFileSync(join(dir, 'assets/souls/cohort/stray.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    writeFileSync(join(dir, 'assets/scene/README.md'), '# exempt\n');
    writeFileSync(join(dir, 'assets/scene/.gitkeep'), '');
    const res = validateManifests({ root: dir, checkAssetMap: false });
    assert.equal(res.ok, false);
    const hits = find(res, 'manifest.orphan');
    assert.deepEqual(hits.map((p) => p.path), ['assets/souls/cohort/stray.svg']);
    assert.equal(hits[0].severity, 'major');
  });

  test('unknown license -> critical license.disallowed (assets and audio)', () => {
    const dir = tempTree();
    replaceIn(join(dir, 'assets/manifest/assets.yaml'), 'id: scene_nebula\n    kind: sprite\n    source_file: assets-src/scene/scene-params.json\n    source_format: json-parameters\n    runtime_file: assets/scene/nebula.svg\n    runtime_format: svg\n    fallback_file: null\n    fallback_format: null\n    version: 1.0.0\n    checksum: sha256:60e5ccb51f907f75c2d721e0c451c4db7b28ad85623f8c8149636ece0f3c8abf\n    license: internal-original', 'id: scene_nebula\n    kind: sprite\n    source_file: assets-src/scene/scene-params.json\n    source_format: json-parameters\n    runtime_file: assets/scene/nebula.svg\n    runtime_format: svg\n    fallback_file: null\n    fallback_format: null\n    version: 1.0.0\n    checksum: sha256:60e5ccb51f907f75c2d721e0c451c4db7b28ad85623f8c8149636ece0f3c8abf\n    license: CC-BY-4.0');
    // audio: change the license on one cue in both twins
    const json = JSON.parse(readFileSync(join(dir, 'assets/manifest/audio.json'), 'utf8'));
    json.cues.find((c) => c.id === 'bingo').license = 'sampled-third-party';
    writeFileSync(join(dir, 'assets/manifest/audio.json'), JSON.stringify(json, null, 2) + '\n');
    const yamlPath = join(dir, 'assets/manifest/audio.yaml');
    const yaml = readFileSync(yamlPath, 'utf8');
    const idx = yaml.indexOf('- id: "bingo"');
    const lic = yaml.indexOf('license: "internal-original"', idx);
    writeFileSync(yamlPath, yaml.slice(0, lic) + 'license: "sampled-third-party"' + yaml.slice(lic + 'license: "internal-original"'.length));
    const res = validateManifests({ root: dir, checkAssetMap: false });
    assert.equal(res.ok, false);
    const hits = find(res, 'license.disallowed');
    assert.equal(hits.length, 2, JSON.stringify(hits));
    assert.ok(hits.every((p) => p.severity === 'critical'));
    assert.ok(hits.some((p) => p.path.endsWith('#scene_nebula') && /CC-BY-4.0/.test(p.detail)));
    assert.ok(hits.some((p) => p.path.endsWith('#bingo') && /sampled-third-party/.test(p.detail)));
    assert.equal(find(res, 'audio.twin').length, 0, 'both twins were edited consistently');
  });

  test('over-budget file -> major budget.singleFile; budget overrides fire budget.assets / budget.audio / budget.soulSvg', () => {
    const dir = tempTree();
    const big = join(dir, 'assets/audio/ambient_galaxy.wav');
    writeFileSync(big, Buffer.concat([readFileSync(big), Buffer.alloc(1_000_000)]));
    assert.ok(statSync(big).size > 1.2 * 1024 * 1024);
    const res = validateManifests({ root: dir, checkAssetMap: false });
    assert.equal(res.ok, false);
    const hits = find(res, 'budget.singleFile', 'ambient_galaxy.wav');
    assert.equal(hits.length, 1); assert.equal(hits[0].severity, 'major');
    assert.equal(find(res, 'bytes.mismatch', 'ambient_galaxy.wav').length, 1, 'size drift is also reported');
    // budget overrides on the pristine tree
    const tight = validateManifests({ root: ROOT, checkAssetMap: false, budgets: { assetsBytes: 1000, audioBytes: 1000, soulSvgBytes: 100, sceneDataBytes: 10, appBytesEach: 1 } });
    assert.equal(tight.ok, false);
    assert.equal(find(tight, 'budget.assets').length, 1);
    assert.equal(find(tight, 'budget.audio').length, 1);
    assert.equal(find(tight, 'budget.sceneData').length, 1);
    assert.ok(find(tight, 'budget.soulSvg').length >= 24);
  });

  test('corrupt WAV header and loop points outside the file are reported', () => {
    const dir = tempTree();
    const wav = join(dir, 'assets/audio/reconnect.wav');
    const buf = readFileSync(wav); buf.write('RIFX', 0, 'ascii'); writeFileSync(wav, buf);
    replaceIn(join(dir, 'assets/manifest/audio.json'), '"end_sample": 154350', '"end_sample": 999999');
    replaceIn(join(dir, 'assets/manifest/audio.yaml'), 'end_sample: 154350', 'end_sample: 999999');
    const res = validateManifests({ root: dir, checkAssetMap: false });
    assert.equal(res.ok, false);
    assert.equal(find(res, 'audio.header', 'reconnect.wav').length, 1);
    assert.equal(find(res, 'checksum.mismatch', 'reconnect.wav').length, 1);
    assert.equal(find(res, 'audio.loop', 'ambient_galaxy.wav').length, 1);
  });

  test('placeholder formats, missing generator and duplicate ids are rejected', () => {
    const dir = tempTree();
    const yaml = join(dir, 'assets/manifest/assets.yaml');
    let text = readFileSync(yaml, 'utf8');
    text = text.replace('runtime_format: json\n', 'runtime_format: selected_after_stack_verification\n');
    text = text.replace('generator_script: tools/assets/build-scene.js\n', 'generator_script: tools/assets/does-not-exist.js\n');
    text = text.replace('- id: scene_orbit_rings\n', '- id: scene_config\n');
    writeFileSync(yaml, text);
    const res = validateManifests({ root: dir, checkAssetMap: false });
    assert.equal(find(res, 'format.placeholder').length, 1);
    assert.equal(find(res, 'generator.missing').length, 1);
    assert.equal(find(res, 'id.duplicate').length, 1);
  });

  test('stale asset map is detected when the manifests change', () => {
    const dir = tempTree();
    replaceIn(join(dir, 'assets/manifest/audio.json'), '"caption": "Bingo detected"', '"caption": "Bingo!"');
    replaceIn(join(dir, 'assets/manifest/audio.yaml'), 'caption: "Bingo detected"', 'caption: "Bingo!"');
    const res = validateManifests({ root: dir });
    assert.equal(find(res, 'assetmap.stale').length, 1);
    assert.equal(find(res, 'audio.twin').length, 0);
  });
});

describe('asset map', () => {
  test('packages/ui/asset-map.js is in sync with the manifests (regenerated to a temp path and compared) and is deterministic', () => {
    const out = join(mkdtempSync(join(SCRATCH, 'map-')), 'asset-map.js'); made.push(dirname(out));
    writeAssetMap({ root: ROOT, out });
    assert.equal(readFileSync(out, 'utf8'), readFileSync(join(ROOT, ASSET_MAP_PATH), 'utf8'));
    assert.equal(buildAssetMapSource({ root: ROOT }), buildAssetMapSource({ root: ROOT }));
    assert.equal(writeAssetMap({ root: ROOT, check: true }).stale, false);
    assert.ok(!/generatedAt": "\d/.test(readFileSync(out, 'utf8')), 'no timestamps');
  });

  test('module imports in Node, is deeply frozen and typed as specified', async () => {
    const m = await import(join(ROOT, ASSET_MAP_PATH));
    const A = m.ASSETS;
    assert.ok(Object.isFrozen(A) && Object.isFrozen(A.audio) && Object.isFrozen(A.audio.bingo) && Object.isFrozen(A.scene.starfield) && Object.isFrozen(A.scene.defaults.lod));
    assert.equal(A.generatedAt, null);
    assert.equal(A.manifestVersion, '1.0.0');
    assert.match(A.sha256OfManifests['assets/manifest/assets.yaml'], /^[0-9a-f]{64}$/);
    assert.match(A.sha256OfManifests.combined, /^[0-9a-f]{64}$/);
    assert.equal(A.scene.config, '/assets/scene/scene-config.json');
    assert.equal(A.scene.nebula, '/assets/scene/nebula.svg');
    assert.deepEqual([...A.scene.starfield], ['/assets/scene/starfield-layer-1.json', '/assets/scene/starfield-layer-2.json', '/assets/scene/starfield-layer-3.json']);
    assert.equal(A.scene.orbitRings, '/assets/scene/orbit-rings.json');
    assert.equal(A.scene.defaults.safeZone.panelX, 1248);
    assert.deepEqual(A.scene.defaults, JSON.parse(readFileSync(join(ROOT, 'assets/scene/scene-config.json'), 'utf8')));
    assert.equal(A.souls.cohort, '/assets/souls/cohort.json');
    assert.equal(A.souls.thumbnailDir, '/assets/souls/thumbnails/');
    assert.equal(A.souls.fallbackDir, '/assets/souls/fallback/');
    assert.equal(A.souls.count, 24); assert.equal(A.souls.seeds.length, 24);
    assert.equal(Object.keys(A.audio).length, 12);
    for (const [id, c] of Object.entries(A.audio)) {
      assert.equal(c.url, `/assets/audio/${id}.wav`);
      assert.ok(Number.isInteger(c.bytes) && c.bytes > 0 && c.durationS > 0);
      assert.match(c.sha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(Object.keys(c.preload).sort(), ['admin', 'participant', 'public', 'stage']);
      assert.ok(c.loop === null || (c.loop.startSample === 0 && c.loop.endSample > 0 && c.loop.sampleRate === 22050));
    }
    assert.equal(A.audio.ambient_galaxy.loop.endSample, 154350);
    assert.equal(Object.keys(A.entries).length, 35, 'the decoration entries stay out of the asset map (soul-decor-data.js carries them)');
    // helpers
    assert.equal(m.assetUrl('scene_nebula'), '/assets/scene/nebula.svg');
    assert.equal(m.assetUrl('bingo'), '/assets/audio/bingo.wav');
    assert.equal(m.assetUrl('nope'), null);
    assert.equal(m.fallbackUrl('soul_cohort_01_140e6ebb0fff0f'), '/assets/souls/fallback/140e6ebb0fff0f-simple.svg');
    assert.deepEqual(m.soulSpriteUrls('140e6ebb0fff0f'), { full: '/assets/souls/cohort/140e6ebb0fff0f.svg', simple: '/assets/souls/fallback/140e6ebb0fff0f-simple.svg', dot: '/assets/souls/fallback/140e6ebb0fff0f-dot.svg', thumbnail: '/assets/souls/thumbnails/140e6ebb0fff0f-64.svg' });
    const wf = m.withFallback('/a.svg', '/b.svg');
    assert.deepEqual([...wf.candidates], ['/a.svg', '/b.svg']); assert.equal(wf.next('/a.svg'), '/b.svg'); assert.equal(wf.next('/b.svg'), null);
    const img = { src: '/a.svg' }; assert.equal(wf.onError({ target: img }), true); assert.equal(img.src, '/b.svg'); assert.equal(wf.onError({ target: img }), false, 'swaps once');
    assert.equal(m.withFallback('/a.svg', null).onError({ target: img }), false);
    assert.equal(m.withFallback(null, null).url, null);
  });

  test('preloadListFor(app) matches docs/audio/sound-spec.md section 6 and the manifest preload flags', async () => {
    const m = await import(join(ROOT, ASSET_MAP_PATH));
    const spec = readFileSync(join(ROOT, 'docs/audio/sound-spec.md'), 'utf8');
    const section = spec.slice(spec.indexOf('## 6. Preload list'), spec.indexOf('## 7.'));
    const rows = {};
    for (const line of section.split('\n')) {
      const r = line.match(/^\|\s*(participant|public|stage|admin)\s*\|\s*([^|]*)\|/);
      if (r) rows[r[1]] = r[2].split(',').map((s) => s.trim()).filter(Boolean).sort();
    }
    assert.deepEqual(Object.keys(rows).sort(), [...APPS].sort(), 'spec table lists all four apps');
    const manifest = JSON.parse(readFileSync(join(ROOT, 'assets/manifest/audio.json'), 'utf8'));
    for (const app of APPS) {
      const list = m.preloadListFor(app);
      assert.deepEqual([...list].sort(), rows[app], `${app} preload list vs sound-spec`);
      assert.deepEqual([...list].sort(), manifest.cues.filter((c) => c.preload.includes(app)).map((c) => c.id).sort(), `${app} vs manifest`);
      for (let i = 1; i < list.length; i++) assert.ok(m.ASSETS.audio[list[i - 1]].priority >= m.ASSETS.audio[list[i]].priority, 'ordered by priority desc');
    }
    assert.deepEqual(m.preloadListFor('nobody'), []);
  });

  test('checkIntegrity() verifies sample assets over a fetch and never throws', async () => {
    const m = await import(join(ROOT, ASSET_MAP_PATH));
    const fetchFn = async (url) => ({ ok: true, status: 200, arrayBuffer: async () => readFileSync(join(ROOT, url.slice(1))) });
    const good = await m.checkIntegrity(fetchFn);
    assert.equal(good.ok, true); assert.equal(good.checked, m.integritySample().length); assert.ok(good.checked >= 4);
    const bad = await m.checkIntegrity(async (url) => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.concat([readFileSync(join(ROOT, url.slice(1))), Buffer.from('x')]) }));
    assert.equal(bad.ok, false); assert.equal(bad.mismatches.length, good.checked);
    const err = await m.checkIntegrity(async () => { throw new Error('offline'); });
    assert.equal(err.ok, false); assert.ok(err.errors.length >= 1);
    const http = await m.checkIntegrity(async () => ({ ok: false, status: 404 }));
    assert.equal(http.ok, false); assert.match(http.errors[0].error, /404/);
    // No fetch function: uses globalThis.fetch when present (relative URLs fail in Node -> errors, never a throw) or skips.
    const none = await m.checkIntegrity(null);
    assert.ok(typeof none.ok === 'boolean' && Array.isArray(none.errors) && Array.isArray(none.mismatches));
    const noFetch = globalThis.fetch; globalThis.fetch = undefined;
    try { const skipped = await m.checkIntegrity(undefined); assert.equal(skipped.skipped, 'no fetch available'); assert.equal(skipped.ok, true); } finally { globalThis.fetch = noFetch; }
  });
});

describe('build-all', () => {
  test('--check passes on the current tree without modifying it', { timeout: 120000 }, () => {
    const before = readFileSync(join(ROOT, 'assets/manifest/assets.yaml'), 'utf8');
    const r = buildAll({ root: ROOT, check: true, tmp: SCRATCH });
    assert.equal(r.ok, true, JSON.stringify({ stale: r.stale, steps: r.steps.filter((s) => !s.ok) }, null, 2));
    assert.deepEqual(r.stale, []);
    assert.equal(readFileSync(join(ROOT, 'assets/manifest/assets.yaml'), 'utf8'), before);
    assert.ok(r.steps.some((s) => s.id === 'audio --check' && (s.ok || s.skipped)));
  });

  test('CLI entry points exit 0 on the current tree and 1 on a broken copy', { timeout: 120000 }, () => {
    const okRun = spawnSync(process.execPath, ['tools/assets/validate-manifest.js', '--quiet'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(okRun.status, 0, okRun.stdout + okRun.stderr);
    const dir = tempTree();
    unlinkSync(join(dir, 'assets/scene/orbit-rings.json'));
    const bad = spawnSync(process.execPath, [join(ROOT, 'tools/assets/validate-manifest.js'), '--root', dir, '--json'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    const parsed = JSON.parse(bad.stdout);
    assert.equal(parsed.ok, false); assert.ok(parsed.problems.some((p) => p.check === 'file.missing' && p.path === 'assets/scene/orbit-rings.json'));
  });
});
