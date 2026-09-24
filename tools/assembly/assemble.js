#!/usr/bin/env node
// Deterministic assembly (workflow section 14).
// Consumes accepted artifacts, verifies asset manifests and checksums, scans for secrets,
// checks budgets, writes build/build-info.json (immutable build ID from content hashes),
// an SBOM, and a reproducible tarball under build/dist/.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const RUNTIME_DIRS = ['apps', 'services', 'packages', 'contracts', 'assets', 'tokens'];
const EXCLUDE_DIRS = new Set(['node_modules', 'test', 'tests', '.git', 'data']);
const BUDGETS = { assetsBytes: 6 * 1024 * 1024, audioBytes: 1.6 * 1024 * 1024, appBytesEach: 600 * 1024, singleFileBytes: 1.2 * 1024 * 1024, vendorBytes: 3 * 1024 * 1024 };
// Vendored third-party libraries (packages/vendor/**) are exempt from the single-file budget but capped in total and must carry VENDOR.json provenance (D-22).
const SECRET_PATTERNS = [/-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /sk-[A-Za-z0-9]{32,}/, /BINGO_[A-Z_]*TOKEN\s*=\s*['"][^'"]{12,}['"]/];

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name); const st = statSync(p);
    if (st.isDirectory()) { if (!EXCLUDE_DIRS.has(name)) walk(p, out); }
    else if (!name.startsWith('.') && !name.endsWith('.sqlite')) out.push(p);
  }
  return out;
}
const problems = [];
const files = [];
for (const d of RUNTIME_DIRS) { const p = join(ROOT, d); if (existsSync(p)) walk(p, files); }
for (const f of files) {
  const buf = readFileSync(f); const rel = relative(ROOT, f).split(sep).join('/');
  const entry = { path: rel, bytes: buf.length, sha256: sha256(buf) };
  files[files.indexOf(f)] = entry;
  if (buf.length > BUDGETS.singleFileBytes && !rel.startsWith('packages/vendor/')) problems.push({ severity: 'major', check: 'budget.singleFile', path: rel, bytes: buf.length });
  if (/\.(js|mjs|json|yaml|yml|html|css|md)$/.test(rel)) { const text = buf.toString('utf8'); for (const re of SECRET_PATTERNS) if (re.test(text)) problems.push({ severity: 'critical', check: 'secrets', path: rel, pattern: String(re) }); }
}
// Asset manifest verification (assets.yaml + audio.yaml): every runtime_file/file listed must exist with matching checksum; every asset file must be listed (no orphans).
function parseSimpleYamlChecksums(text) {
  // Minimal parser for the flat list style used by our generators: collects (runtime_file|file, checksum|sha256) pairs per '- ' item.
  const items = []; let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*-\s+\w+:/.test(line) || /^\s*-\s*$/.test(line)) { cur = {}; items.push(cur); }
    const m = line.match(/^\s*-?\s*(\w+):\s*(.+?)\s*$/); if (m && cur) cur[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return items;
}
const manifestFiles = ['assets/manifest/assets.yaml', 'assets/manifest/audio.yaml'];
const listed = new Set();
for (const mf of manifestFiles) {
  const p = join(ROOT, mf);
  if (!existsSync(p)) { problems.push({ severity: 'major', check: 'manifest.missing', path: mf }); continue; }
  for (const item of parseSimpleYamlChecksums(readFileSync(p, 'utf8'))) {
    const filesInItem = [item.runtime_file, item.file, item.fallback_file].filter((v) => v && v !== 'null');
    if (item.lods && item.lods.startsWith('[')) for (const l of item.lods.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)) listed.add(l);
    const sum = (item.checksum || item.sha256 || '').replace(/^sha256:/, '');
    for (const rf of filesInItem) {
      const abs = join(ROOT, rf);
      if (!existsSync(abs)) { problems.push({ severity: 'major', check: 'manifest.fileMissing', path: rf, manifest: mf }); continue; }
      listed.add(rf.replace(/^\.\//, ''));
      if (rf === (item.runtime_file || item.file) && sum && sha256(readFileSync(abs)) !== sum) problems.push({ severity: 'major', check: 'manifest.checksumMismatch', path: rf, manifest: mf });
      if (item.license && item.license !== 'internal-original' && !/^(CC0|MIT|internal)/i.test(item.license)) problems.push({ severity: 'major', check: 'manifest.license', path: rf, license: item.license });
    }
  }
}
let assetsBytes = 0, audioBytes = 0;
for (const f of files) {
  if (f.path.startsWith('assets/') && !f.path.startsWith('assets/manifest/')) {
    assetsBytes += f.bytes; if (f.path.startsWith('assets/audio/')) audioBytes += f.bytes;
    if (!listed.has(f.path) && !/\/(README\.md|sheet\.html|\.gitkeep)$/.test(f.path)) problems.push({ severity: 'minor', check: 'manifest.orphan', path: f.path });
  }
}
if (assetsBytes > BUDGETS.assetsBytes) problems.push({ severity: 'major', check: 'budget.assets', bytes: assetsBytes });
const vendorBytes = files.filter(f => f.path.startsWith('packages/vendor/')).reduce((a, f) => a + f.bytes, 0);
if (vendorBytes > BUDGETS.vendorBytes) problems.push({ severity: 'major', check: 'budget.vendor', bytes: vendorBytes });
for (const dir of new Set(files.filter(f => f.path.startsWith('packages/vendor/')).map(f => f.path.split('/').slice(0, 3).join('/')))) {
  const v = join(ROOT, dir, 'VENDOR.json');
  if (!existsSync(v)) { problems.push({ severity: 'major', check: 'vendor.provenanceMissing', path: dir }); continue; }
  for (const entry of JSON.parse(readFileSync(v, 'utf8')).files) { const f = files.find(x => x.path === entry.path); if (!f || f.sha256 !== entry.sha256) problems.push({ severity: 'major', check: 'vendor.checksumMismatch', path: entry.path }); }
}
if (audioBytes > BUDGETS.audioBytes) problems.push({ severity: 'major', check: 'budget.audio', bytes: audioBytes });
for (const app of ['employee-mobile', 'admin-portal', 'public-galaxy', 'stage-dashboard']) {
  const bytes = files.filter(f => f.path.startsWith(`apps/${app}/`)).reduce((a, f) => a + f.bytes, 0);
  if (bytes === 0) problems.push({ severity: 'critical', check: 'app.missing', path: `apps/${app}` });
  if (bytes > BUDGETS.appBytesEach) problems.push({ severity: 'major', check: 'budget.app', path: `apps/${app}`, bytes });
}
// Dependency check: zero third-party runtime dependencies.
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const pkgFiles = files.filter(f => f.path.endsWith('package.json'));
const sbom = { bomFormat: 'CycloneDX-lite', specVersion: '1.0', runtime: { node: process.version }, components: [] };
for (const pf of pkgFiles) {
  const pkg = JSON.parse(readFileSync(join(ROOT, pf.path), 'utf8'));
  sbom.components.push({ name: pkg.name, version: pkg.version, path: pf.path, license: pkg.license || 'UNLICENSED', dependencies: pkg.dependencies || {} });
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) problems.push({ severity: 'major', check: 'deps.thirdParty', path: pf.path, deps: Object.keys(pkg.dependencies) });
}
// Contract versions
const contractVersions = {};
for (const c of ['round-state-machine.json', 'bingo-rules.json', 'realtime-events.json']) contractVersions[c] = JSON.parse(readFileSync(join(ROOT, 'contracts', c), 'utf8')).version;
contractVersions['api-contract.yaml'] = (readFileSync(join(ROOT, 'contracts/api-contract.yaml'), 'utf8').match(/^version:\s*(\S+)/m) || [])[1];
// Build ID = hash of sorted (path, sha256) pairs -> reproducible for identical content.
const treeHash = sha256(files.map(f => `${f.path}:${f.sha256}`).join('\n'));
const buildId = `bingo-${treeHash.slice(0, 12)}`;
const critical = problems.filter(p => p.severity === 'critical').length, major = problems.filter(p => p.severity === 'major').length;
const buildInfo = {
  buildId, treeHash, runId: readFileSync(join(ROOT, 'build/RUN_ID'), 'utf8').trim(), name: rootPkg.name, version: rootPkg.version,
  assembledAt: new Date().toISOString(), node: process.version, contractVersions,
  skillMasterVersion: JSON.parse(readFileSync(join(ROOT, 'packages/skill-master/data/skill-master.json'), 'utf8')).matrixVersion,
  fileCount: files.length, totalBytes: files.reduce((a, f) => a + f.bytes, 0), assetsBytes, audioBytes, vendorBytes,
  budgets: BUDGETS, problems, status: critical || major ? 'failed' : 'ok',
  environmentConfigSchema: ['PORT', 'HOST', 'BINGO_ENV', 'BINGO_DB_PATH', 'BINGO_ADMIN_TOKEN', 'BINGO_STAGE_TOKEN', 'BINGO_JOIN_SECRET', 'BINGO_SESSION_SECRET', 'BINGO_PUBLIC_BASE_URL', 'BINGO_RESULT_WINDOW_SECONDS', 'BINGO_START_GRACE_SECONDS', 'BINGO_RETENTION_DAYS'],
  files,
};
mkdirSync(join(ROOT, 'build/dist'), { recursive: true });
writeFileSync(join(ROOT, 'build/build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n');
writeFileSync(join(ROOT, 'build/sbom.json'), JSON.stringify(sbom, null, 2) + '\n');
// Reproducible tarball: fixed mtime/owner, sorted entries (bsdtar options on macOS/Linux).
const tarPath = join(ROOT, 'build/dist', `${buildId}.tar.gz`);
try {
  for (const old of readdirSync(join(ROOT, 'build/dist'))) if (old.endsWith('.tar.gz')) rmSync(join(ROOT, 'build/dist', old));
  const list = files.map(f => f.path).concat(['package.json', 'build/build-info.json', 'build/sbom.json']).sort();
  writeFileSync(join(ROOT, 'build/dist/files.txt'), list.join('\n') + '\n');
  execFileSync('tar', ['--no-xattrs', '--uid', '0', '--gid', '0', '--numeric-owner', '-cf', tarPath.replace(/\.gz$/, ''), '-C', ROOT, '-T', 'build/dist/files.txt'], { stdio: 'inherit' });
  execFileSync('gzip', ['-n', '-f', tarPath.replace(/\.gz$/, '')]);
  buildInfo.distribution = { path: relative(ROOT, tarPath), sha256: sha256(readFileSync(tarPath)) };
  writeFileSync(join(ROOT, 'build/build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n');
} catch (e) { problems.push({ severity: 'minor', check: 'dist.tar', message: String(e.message) }); }
console.log(JSON.stringify({ buildId, files: files.length, assetsBytes, audioBytes, critical, major, minor: problems.length - critical - major, status: buildInfo.status }, null, 2));
if (problems.length) console.log('problems:', JSON.stringify(problems, null, 2));
process.exit(critical || major ? 1 : 0);
