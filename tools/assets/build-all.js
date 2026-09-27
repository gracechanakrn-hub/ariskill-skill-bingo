#!/usr/bin/env node
// tools/assets/build-all.js - one command for the asset pipeline (workflow 13.6): scene -> souls -> soul-baseline (GLB) -> soul-decor ->
// soul-face -> galaxy-space -> winner-crown -> audio -> asset map -> validate.
// Zero third-party code. Every generator is deterministic, so running twice is a no-op.
//
//   node tools/assets/build-all.js            regenerate everything in place, then validate (exit 1 on critical/major)
//   node tools/assets/build-all.js --check    verify the committed outputs are current WITHOUT touching the tree:
//                                             JS generators run in a temporary copy and their assets/ tree is compared
//                                             byte-for-byte; build-audio.py --check re-synthesises in memory;
//                                             the asset map is regenerated in memory; then the validator runs.
//   options: --root <dir>  --tmp <dir> (scratch parent for --check)  --skip-audio (no python3 available)  --json
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifests, formatReport } from './validate-manifest.js';
import { writeAssetMap, ASSET_MAP_PATH } from './build-asset-map.js';

export const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GENERATORS = Object.freeze([
  { id: 'scene', cmd: 'node', args: ['tools/assets/build-scene.js'], outputs: ['assets/scene', 'assets/manifest/assets.yaml'] },
  { id: 'souls', cmd: 'node', args: ['tools/assets/build-souls.js'], outputs: ['assets/souls', 'assets/manifest/assets.yaml'] },
  // Baseline Soul GLBs (D-27): copies + checks the Blender outputs in assets-src/generated/soul-baseline/v1.
  { id: 'soul-baseline', cmd: 'node', args: ['tools/assets/build-soul-baseline.js'], outputs: ['assets/souls/baseline', 'assets/manifest/assets.yaml'] },
  // Soul decorations (D-29): copies + checks the Blender charms and face kits in assets-src/generated/soul-decor/v1.
  { id: 'soul-decor', cmd: 'node', args: ['tools/assets/build-soul-decor.js'], outputs: ['assets/souls/charms', 'assets/souls/faces', 'assets/manifest/assets.yaml'] },
  // Soul faces v3 (D-31): copies + checks the Blender body, plates, eyes, kits and sprites in assets-src/generated/soul-face/v1.
  { id: 'soul-face', cmd: 'node', args: ['tools/assets/build-soul-face.js'], outputs: ['assets/souls/v3', 'assets/manifest/assets.yaml'] },
  // The big screen's space backdrop (D-36): checks the pack in assets/space/ against the packer's provenance.json (the Blender
  // renders and the Pillow packer run by hand) and lists it in the manifest.
  { id: 'galaxy-space', cmd: 'node', args: ['tools/assets/build-galaxy-space.js'], outputs: ['assets/space', 'assets/manifest/assets.yaml'] },
  // Bingo winner's crown (stage 15, D-36): copies + checks the Blender GLB in assets-src/generated/winner.
  { id: 'winner-crown', cmd: 'node', args: ['tools/assets/build-winner-crown.js'], outputs: ['assets/souls/winner', 'assets/manifest/assets.yaml'] },
  { id: 'audio', cmd: 'python3', args: ['tools/assets/build-audio.py'], outputs: ['assets/audio', 'assets/manifest/audio.yaml', 'assets/manifest/audio.json'], check: ['--check'] },
]);
// What the JS generators need to run inside a temporary copy (imports are relative to tools/assets/).
const CHECK_COPY = ['assets', 'assets-src', 'tools/assets', 'packages'];
const SKIP_DIRS = new Set(['node_modules', 'test', 'tests', '.git']);
// Blender masters / numpy caches (git-ignored, ~66 MB) are never read by a JS generator: keep them out of the copy.
const SKIP_FILES = /\.(blend|blend1|npy)$/;
const toPosix = (p) => p.split(sep).join('/');

function run(cmd, args, cwd) {
  const exe = cmd === 'node' ? process.execPath : cmd;
  const r = spawnSync(exe, args, { cwd, encoding: 'utf8', timeout: 600000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  return { ok: r.status === 0, status: r.status, error: r.error ? String(r.error.message) : null, output: out };
}
function hashTree(dir, base = dir, out = new Map()) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) hashTree(p, base, out);
    else out.set(toPosix(relative(base, p)), createHash('sha256').update(readFileSync(p)).digest('hex'));
  }
  return out;
}
function diffTrees(expected, actual) {
  const stale = [];
  for (const [k, v] of expected) { if (!actual.has(k)) stale.push({ path: k, reason: 'missing' }); else if (actual.get(k) !== v) stale.push({ path: k, reason: 'differs' }); }
  for (const k of actual.keys()) if (!expected.has(k)) stale.push({ path: k, reason: 'not produced by any generator' });
  return stale;
}

/** Programmatic entry point. Returns { ok, mode, steps, stale, validation }. */
export function buildAll({ root = DEFAULT_ROOT, check = false, tmp = null, skipAudio = false, log = () => {} } = {}) {
  const steps = [];
  const stale = [];
  const step = (id, res) => { steps.push({ id, ...res }); log(`${res.ok ? 'ok  ' : 'FAIL'} ${id}${res.output ? '\n     ' + res.output.split('\n').slice(-3).join('\n     ') : ''}`); return res.ok; };
  let ok = true;

  if (!check) {
    for (const g of GENERATORS) {
      if (g.id === 'audio' && skipAudio) { steps.push({ id: g.id, ok: true, skipped: true }); continue; }
      ok = step(g.id, run(g.cmd, [...g.args], root)) && ok;
    }
    const map = writeAssetMap({ root });
    step('asset-map', { ok: true, output: `${map.changed ? 'wrote' : 'unchanged'} ${ASSET_MAP_PATH} (${map.bytes} bytes)` });
  } else {
    // 1. JS generators in a disposable copy; compare their assets/ trees with the committed ones.
    const parent = tmp || tmpdir();
    mkdirSync(parent, { recursive: true });
    const work = mkdtempSync(join(parent, 'assets-check-'));
    try {
      for (const d of CHECK_COPY) if (existsSync(join(root, d))) cpSync(join(root, d), join(work, d), { recursive: true, filter: (src) => { const name = relative(root, src).split(sep).pop(); return !SKIP_DIRS.has(name) && !SKIP_FILES.test(name); } });
      for (const g of GENERATORS) {
        if (g.cmd !== 'node') continue;
        const res = run(g.cmd, [...g.args], work);
        ok = step(`${g.id} (temp copy)`, res) && ok;
      }
      const jsOutputs = ['assets/scene', 'assets/souls', 'assets/manifest/assets.yaml'];
      for (const o of jsOutputs) {
        const isDir = existsSync(join(work, o)) && statSync(join(work, o)).isDirectory();
        const exp = isDir ? hashTree(join(work, o), work) : new Map(existsSync(join(work, o)) ? [[o, createHash('sha256').update(readFileSync(join(work, o))).digest('hex')]] : []);
        const act = isDir ? hashTree(join(root, o), root) : new Map(existsSync(join(root, o)) ? [[o, createHash('sha256').update(readFileSync(join(root, o))).digest('hex')]] : []);
        for (const s of diffTrees(exp, act)) stale.push(s);
      }
      ok = step('scene+souls outputs current', { ok: stale.length === 0, output: stale.length ? 'STALE: ' + stale.map((s) => `${s.path} (${s.reason})`).join(', ') : `${jsOutputs.join(', ')} match a fresh generation` }) && ok;
    } finally { rmSync(work, { recursive: true, force: true }); }
    // 2. audio: the generator's own in-memory --check.
    if (skipAudio) steps.push({ id: 'audio --check', ok: true, skipped: true });
    else {
      const g = GENERATORS.find((x) => x.id === 'audio');
      const res = run(g.cmd, [...g.args, ...g.check], root);
      if (!res.ok && res.output) for (const m of res.output.matchAll(/STALE: (.+)/g)) for (const p of m[1].split(',')) stale.push({ path: p.trim(), reason: 'audio output differs' });
      ok = step('audio --check', res) && ok;
    }
    // 3. asset map regenerated in memory.
    const map = writeAssetMap({ root, check: true });
    if (map.stale) stale.push({ path: ASSET_MAP_PATH, reason: 'differs from manifests' });
    ok = step('asset-map --check', { ok: !map.stale, output: map.stale ? `STALE: ${ASSET_MAP_PATH}` : `${ASSET_MAP_PATH} is current` }) && ok;
  }

  // 4. validate.
  const validation = validateManifests({ root });
  ok = step('validate-manifest', { ok: validation.ok, output: formatReport(validation) }) && ok;
  return { ok, mode: check ? 'check' : 'build', steps, stale, validation };
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const json = argv.includes('--json');
  const result = buildAll({ root: arg('--root') || DEFAULT_ROOT, check: argv.includes('--check'), tmp: arg('--tmp') || null, skipAudio: argv.includes('--skip-audio'), log: json ? () => {} : (m) => console.log(m) });
  if (json) console.log(JSON.stringify({ ok: result.ok, mode: result.mode, stale: result.stale, steps: result.steps.map((s) => ({ id: s.id, ok: s.ok, skipped: !!s.skipped })), summary: result.validation.summary, problems: result.validation.problems }, null, 2));
  else console.log(`build-all (${result.mode}): ${result.ok ? 'OK' : 'FAILED'}${result.stale.length ? ` - ${result.stale.length} stale output(s)` : ''}`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
