#!/usr/bin/env node
// tools/assets/validate-manifest.js - asset + audio manifest validator (workflow 13.6 / 14 assembly hard checks).
// Zero third-party code. CLI and library:
//   node tools/assets/validate-manifest.js [--root <dir>] [--json] [--quiet]     exit 1 on any critical/major problem
//   import { validateManifests } from './validate-manifest.js'; validateManifests({ root }) -> { ok, problems, summary }
//
// Severity vocabulary: critical (provenance/integrity violation), major (blocks the gate), minor (warning, gate item for
// humans), info (context only). Every problem is { severity, check, path, detail }.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest, MANIFEST_FIELDS } from './lib/manifest.js';
import { readGlb, imageRefs } from './lib/glb.js';
import { buildAssetMapSource, ASSET_MAP_PATH, APPS } from './build-asset-map.js';

export const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ASSETS_MANIFEST = 'assets/manifest/assets.yaml';
export const AUDIO_MANIFEST_YAML = 'assets/manifest/audio.yaml';
export const AUDIO_MANIFEST_JSON = 'assets/manifest/audio.json';
export const ALLOWED_LICENSES = Object.freeze(['internal-original']);
export const PLACEHOLDER_FORMATS = Object.freeze(['selected_after_stack_verification', 'tbd', 'todo', '']);
export const FALLBACK_REQUIRED_KINDS = Object.freeze(['model', 'sprite']);
export const APP_DIRS = Object.freeze({ participant: 'apps/employee-mobile', admin: 'apps/admin-portal', public: 'apps/public-galaxy', stage: 'apps/stage-dashboard' });
export const ORPHAN_EXEMPT = /(^|\/)(README(\.md)?|sheet\.html|\.gitkeep)$/;
export const AUDIO_REQUIRED_FIELDS = Object.freeze(['id', 'kind', 'runtime_file', 'checksum', 'bytes', 'duration_s', 'license', 'generator_script', 'source_file', 'source_format', 'runtime_format', 'version', 'sample_rate', 'channels', 'bit_depth', 'loop', 'preload', 'audiences', 'caption', 'approved_by']);
export const AUDIO_FORMAT = Object.freeze({ sampleRate: 22050, channels: 1, bitsPerSample: 16, pcmFormat: 1 });
/** Per-app bundle budgets that differ from appBytesEach (D-49: the phone carries the 3D landing mascot and the sky layers). */
export const APP_BUDGET_OVERRIDES = Object.freeze({ participant: 700 * 1024 });

export const DEFAULT_BUDGETS = Object.freeze({
  assetsBytes: 7 * 1024 * 1024,          // everything under assets/ except assets/manifest/ (6 -> 7 MiB for the v3 faces, D-31)
  audioBytes: 1600 * 1024,               // 1.6 MB as the sound spec counts it (audio.yaml budgets.max_total_bytes = 1638400)
  singleFileBytes: Math.round(1.2 * 1024 * 1024),
  soulSvgBytes: 6 * 1024,                // every SVG under assets/souls/
  sceneDataBytes: 120 * 1024,            // assets/scene/* (scene-spec: scene data <= 120 KB)
  appBytesEach: 600 * 1024,              // apps/<app>/ (excluding test dirs)
  audioOneshotBytes: 120 * 1024,         // overridden by audio.yaml budgets.max_oneshot_bytes when present
  glbBytes: 400 * 1024,                  // every .glb under assets/ (baseline Soul models, D-27)
});
export const MODEL_FORMATS = Object.freeze(['glb']);
// Soul decorations (D-29, tools/assets/build-soul-decor.js): per-file budgets for the charm models + textures and the face
// kits + sprites, and their total. Kept apart from DEFAULT_BUDGETS (whose key set the integration test pins); the same
// `budgets` override applies to both.
export const DECOR_BUDGETS = Object.freeze({
  charmGlbBytes: 20 * 1024,              // assets/souls/charms/<id>.glb (~900 triangles, quantised)
  charmPngBytes: 32 * 1024,              // assets/souls/charms/<id>.png (128 px texture, also the 2D sprite)
  faceGlbBytes: 96 * 1024,               // assets/souls/faces/face-<face>.glb
  faceSpriteBytes: 96 * 1024,            // assets/souls/faces/face-<face>-front.png (800 px)
  decorBytes: Math.round(3.75 * 1024 * 1024), // everything under assets/souls/charms/ and assets/souls/faces/
});
// Soul faces v3 (D-31, tools/assets/build-soul-face.js): per-file budgets under assets/souls/v3/ and the directory total
// (the two body GLBs are also held to glbBytes). Kept apart from DEFAULT_BUDGETS like DECOR_BUDGETS.
export const FACE_V3_BUDGETS = Object.freeze({
  plateGlbBytes: 48 * 1024,              // assets/souls/v3/plate-<id>.glb
  eyesGlbBytes: 64 * 1024,               // assets/souls/v3/eyes-<id>.glb
  kitGlbBytes: 96 * 1024,                // assets/souls/v3/face-<face>.glb
  spriteBytes: 32 * 1024,                // assets/souls/v3/*.png (cropped front sprites)
  v3Bytes: Math.round(1.5 * 1024 * 1024), // everything under assets/souls/v3/
});
const DECOR_FILE = Object.freeze([
  { re: /^assets\/souls\/charms\/[^/]+\.glb$/, key: 'charmGlbBytes' }, { re: /^assets\/souls\/charms\/[^/]+\.png$/, key: 'charmPngBytes' },
  { re: /^assets\/souls\/faces\/[^/]+\.glb$/, key: 'faceGlbBytes' }, { re: /^assets\/souls\/faces\/[^/]+-front\.png$/, key: 'faceSpriteBytes' },
]);
const V3_FILE = Object.freeze([
  { re: /^assets\/souls\/v3\/plate-[^/]+\.glb$/, key: 'plateGlbBytes' }, { re: /^assets\/souls\/v3\/eyes-[^/]+\.glb$/, key: 'eyesGlbBytes' },
  { re: /^assets\/souls\/v3\/face-[^/]+\.glb$/, key: 'kitGlbBytes' }, { re: /^assets\/souls\/v3\/[^/]+\.png$/, key: 'spriteBytes' },
]);

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');
const toPosix = (p) => p.split(sep).join('/');
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ------------------------------------------------------------------------------------------------------------------
// Minimal YAML subset parser: exactly the shape emitted by tools/assets/build-audio.py to_yaml (block maps, lists of
// maps introduced by "- key: value", flow arrays of scalars, JSON-quoted strings, numbers, null, booleans).
export function parseYamlSubset(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() && !l.trim().startsWith('#'));
  let i = 0;
  const indentOf = (l) => l.match(/^ */)[0].length;
  const scalar = (s) => {
    s = s.trim();
    if (s === '' || s === 'null' || s === '~') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === '{}') return {};
    if (s === '[]') return [];
    if (s.startsWith('[') && s.endsWith(']')) return splitFlow(s.slice(1, -1)).map(scalar);
    if (s.startsWith('"')) return JSON.parse(s);
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return Number(s);
    return s;
  };
  const splitFlow = (s) => {
    const out = []; let cur = ''; let q = false;
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (q) { cur += ch; if (ch === '\\') { cur += s[++k]; } else if (ch === '"') q = false; continue; }
      if (ch === '"') { q = true; cur += ch; continue; }
      if (ch === ',') { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  };
  function parseBlock(indent) {
    // Decide map vs list by the first line at this indent.
    const first = lines[i];
    if (first.slice(indent).startsWith('- ')) return parseList(indent);
    return parseMap(indent);
  }
  function parseMap(indent) {
    const obj = {};
    while (i < lines.length) {
      const line = lines[i]; const ind = indentOf(line);
      if (ind < indent || (ind === indent && line.slice(ind).startsWith('- '))) break;
      if (ind > indent) throw new Error(`yaml: unexpected indent at line: ${line}`);
      const m = line.slice(ind).match(/^([\w.-]+):(?:\s+(.*))?$/);
      if (!m) throw new Error(`yaml: cannot parse line: ${line}`);
      i += 1;
      if (m[2] !== undefined && m[2] !== '') { obj[m[1]] = scalar(m[2]); continue; }
      // nested block (map or list) or empty value
      if (i < lines.length && indentOf(lines[i]) > ind) obj[m[1]] = parseBlock(indentOf(lines[i]));
      else if (i < lines.length && indentOf(lines[i]) === ind && lines[i].slice(ind).startsWith('- ')) obj[m[1]] = parseList(ind);
      else obj[m[1]] = null;
    }
    return obj;
  }
  function parseList(indent) {
    const arr = [];
    while (i < lines.length) {
      const line = lines[i]; const ind = indentOf(line);
      if (ind !== indent || !line.slice(ind).startsWith('- ')) break;
      const rest = line.slice(ind + 2);
      const km = rest.match(/^([\w.-]+):(?:\s+(.*))?$/);
      if (!km) { arr.push(scalar(rest)); i += 1; continue; }
      // list item that is a map: rewrite the first line as a map line at indent+2 and parse the map
      lines[i] = ' '.repeat(ind + 2) + rest;
      arr.push(parseMap(ind + 2));
    }
    return arr;
  }
  const out = lines.length ? parseBlock(indentOf(lines[0])) : {};
  if (i < lines.length) throw new Error(`yaml: trailing content at line: ${lines[i]}`);
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// WAV header reader: { ok, reason, format, channels, sampleRate, bitsPerSample, dataBytes, samples }.
export function readWavHeader(buf) {
  const r = { ok: false, reason: null, format: null, channels: null, sampleRate: null, bitsPerSample: null, dataBytes: null, samples: null };
  try {
    if (buf.length < 44) { r.reason = 'file shorter than a WAV header'; return r; }
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') { r.reason = 'not a RIFF/WAVE file'; return r; }
    if (buf.readUInt32LE(4) !== buf.length - 8) { r.reason = `RIFF size ${buf.readUInt32LE(4)} != ${buf.length - 8}`; return r; }
    let off = 12; let fmt = false; let data = false;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4); const size = buf.readUInt32LE(off + 4);
      if (id === 'fmt ') {
        fmt = true;
        r.format = buf.readUInt16LE(off + 8); r.channels = buf.readUInt16LE(off + 10); r.sampleRate = buf.readUInt32LE(off + 12); r.bitsPerSample = buf.readUInt16LE(off + 22);
      } else if (id === 'data') {
        data = true; r.dataBytes = size;
        if (off + 8 + size > buf.length) { r.reason = `data chunk (${size}) exceeds file`; return r; }
      }
      off += 8 + size + (size % 2);
    }
    if (!fmt) { r.reason = 'missing fmt chunk'; return r; }
    if (!data) { r.reason = 'missing data chunk'; return r; }
    const frameBytes = (r.channels || 1) * ((r.bitsPerSample || 16) / 8);
    r.samples = Math.floor(r.dataBytes / frameBytes);
    r.ok = true;
    return r;
  } catch (err) { r.reason = String(err.message); return r; }
}

// ------------------------------------------------------------------------------------------------------------------
function walkFiles(dir, out = [], skipDirs = new Set(['node_modules', 'test', 'tests', '.git'])) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name); const st = statSync(p);
    if (st.isDirectory()) { if (!skipDirs.has(name)) walkFiles(p, out, skipDirs); }
    else out.push({ path: p, bytes: st.size });
  }
  return out;
}

/** Validate both manifests and the tree they describe. Never throws for tree problems; returns them as problems. */
export function validateManifests({ root = DEFAULT_ROOT, budgets = {}, checkAssetMap = true, checkUiKit = true } = {}) {
  const B = { ...DEFAULT_BUDGETS, ...DECOR_BUDGETS, ...FACE_V3_BUDGETS, ...budgets };
  const problems = [];
  const add = (severity, check, path, detail) => problems.push({ severity, check, path: path == null ? null : toPosix(String(path)), detail });
  const abs = (rel) => join(root, rel);
  const relOf = (p) => toPosix(relative(root, p));
  const fileCache = new Map();
  const readBuf = (rel) => { if (!fileCache.has(rel)) fileCache.set(rel, readFileSync(abs(rel))); return fileCache.get(rel); };
  const listed = new Map(); // rel path -> [ids]
  const note = (rel, id) => { const k = String(rel).replace(/^\.?\//, ''); if (!listed.has(k)) listed.set(k, []); listed.get(k).push(id); };
  const summary = { root: toPosix(root), entries: 0, cues: 0, files: 0, unapproved: { assets: 0, audio: 0 }, budgets: {}, bySeverity: { critical: 0, major: 0, minor: 0, info: 0 } };
  // glTF binaries (kind model): container header + per-file budget, each path checked once (runtime, fallback or lod)
  const glbSeen = new Set();
  const checkGlb = (rel, id) => {
    if (!/\.glb$/i.test(rel) || glbSeen.has(rel)) return;
    glbSeen.add(rel);
    const buf = readBuf(rel);
    const h = readGlb(buf);
    if (!h.ok) add('major', 'glb.header', rel, `${h.reason} (entry ${id})`);
    if (buf.length > B.glbBytes) add('major', 'budget.glb', rel, `${buf.length} bytes > ${B.glbBytes}`);
    // decor models: quantised positions keep raw integer min/max; a charm's texture is its sibling <id>.png by relative URI
    if (h.ok && /^assets\/souls\/(charms|faces)\//.test(rel)) {
      for (const a of h.json.accessors || []) if (a.normalized && (a.min || a.max) && [a.min, a.max].some((m) => !Array.isArray(m) || m.some((v) => !Number.isInteger(v)))) add('major', 'decor.glb', rel, 'quantised accessor min/max must be the raw stored integers');
      if (rel.startsWith('assets/souls/charms/')) {
        const want = posix.basename(rel).replace(/\.glb$/, '.png');
        const imgs = imageRefs(h.json);
        if (imgs.length !== 1 || !imgs[0].external || !imgs[0].relative || imgs[0].uri !== want) add('major', 'decor.glb', rel, `texture must be the external relative URI ${want}, got ${JSON.stringify(imgs.map((i) => i.uri))}`);
        else if (!existsSync(abs(posix.join(posix.dirname(rel), want)))) add('major', 'decor.glb', rel, `texture ${want} is missing next to the model`);
      }
    }
  };

  // ---------------------------------------------------------------- assets.yaml
  let assets = null;
  if (!existsSync(abs(ASSETS_MANIFEST))) add('critical', 'manifest.missing', ASSETS_MANIFEST, 'asset manifest not found');
  else {
    try { assets = parseManifest(readBuf(ASSETS_MANIFEST).toString('utf8')); }
    catch (err) { add('critical', 'manifest.parse', ASSETS_MANIFEST, err.message); }
  }
  if (assets) {
    summary.entries = assets.entries.length;
    if (assets.header.license_default && !ALLOWED_LICENSES.includes(String(assets.header.license_default))) add('critical', 'license.disallowed', ASSETS_MANIFEST, `license_default ${assets.header.license_default}`);
    if (!/^\d+\.\d+\.\d+$/.test(String(assets.header.version || ''))) add('major', 'manifest.version', ASSETS_MANIFEST, `header version must be semver, got ${assets.header.version}`);
    const seen = new Map();
    for (const e of assets.entries) {
      const id = e.id == null ? '<missing id>' : String(e.id);
      const where = `${ASSETS_MANIFEST}#${id}`;
      // required fields (workflow 5.2)
      for (const f of MANIFEST_FIELDS) if (!(f in e)) add('major', 'field.missing', where, `required field ${f} is absent`);
      if (e.id == null || !/^[a-z][a-z0-9_]*$/.test(id)) add('major', 'id.format', where, 'id must be lower snake_case');
      if (seen.has(id)) add('major', 'id.duplicate', where, `duplicate id (first at entry #${seen.get(id)})`); else seen.set(id, assets.entries.indexOf(e));
      if (!/^\d+\.\d+\.\d+$/.test(String(e.version || ''))) add('major', 'field.version', where, `version must be semver, got ${e.version}`);
      // license / provenance
      if (!ALLOWED_LICENSES.includes(String(e.license))) add('critical', 'license.disallowed', where, `license ${JSON.stringify(e.license)} is not in [${ALLOWED_LICENSES.join(', ')}]`);
      if (e.approved_by === null || e.approved_by === undefined) summary.unapproved.assets += 1;
      else if (typeof e.approved_by !== 'string' || !e.approved_by.trim()) add('major', 'field.approvedBy', where, 'approved_by must be null or a non-empty reviewer string');
      // formats must be concrete
      for (const f of ['source_format', 'runtime_format']) if (PLACEHOLDER_FORMATS.includes(String(e[f] ?? '').toLowerCase())) add('major', 'format.placeholder', where, `${f} is ${JSON.stringify(e[f])}; record the concrete format`);
      if (e.fallback_file && PLACEHOLDER_FORMATS.includes(String(e.fallback_format ?? '').toLowerCase())) add('major', 'format.placeholder', where, `fallback_format is ${JSON.stringify(e.fallback_format)}`);
      // generator + source
      if (!e.generator_script || !existsSync(abs(String(e.generator_script)))) add('major', 'generator.missing', where, `generator_script ${e.generator_script} does not exist`);
      if (!e.source_file || !existsSync(abs(String(e.source_file).split('#')[0]))) add('major', 'source.missing', where, `source_file ${e.source_file} does not exist`);
      // runtime file, checksum, bytes
      const rf = e.runtime_file ? String(e.runtime_file) : null;
      if (!rf) add('major', 'file.missing', where, 'runtime_file is empty');
      else if (!rf.startsWith('assets/')) add('major', 'file.location', rf, 'runtime_file must live under assets/');
      else if (!existsSync(abs(rf))) add('major', 'file.missing', rf, `runtime_file listed by ${id} does not exist`);
      else {
        note(rf, id);
        const buf = readBuf(rf);
        if (!/^sha256:[0-9a-f]{64}$/.test(String(e.checksum || ''))) add('major', 'checksum.format', where, `checksum must be sha256:<64 hex>, got ${e.checksum}`);
        else if (String(e.checksum).slice(7) !== sha256hex(buf)) add('critical', 'checksum.mismatch', rf, `manifest ${e.checksum} != file sha256:${sha256hex(buf)} (entry ${id})`);
        if (Number(e.texture_memory_bytes) !== buf.length) add('major', 'bytes.mismatch', rf, `texture_memory_bytes ${e.texture_memory_bytes} != file size ${buf.length} (entry ${id})`);
        if (buf.length > B.singleFileBytes) add('major', 'budget.singleFile', rf, `${buf.length} bytes > ${B.singleFileBytes}`);
        if (/^assets\/souls\/.*\.svg$/.test(rf) && buf.length > B.soulSvgBytes) add('major', 'budget.soulSvg', rf, `${buf.length} bytes > ${B.soulSvgBytes}`);
        checkGlb(rf, id);
      }
      // fallback
      if (e.fallback_file) {
        const ff = String(e.fallback_file);
        if (!existsSync(abs(ff))) add('major', 'fallback.missing', ff, `fallback_file listed by ${id} does not exist`);
        else { note(ff, id); if (/^assets\/souls\/.*\.svg$/.test(ff) && readBuf(ff).length > B.soulSvgBytes) add('major', 'budget.soulSvg', ff, `${readBuf(ff).length} bytes > ${B.soulSvgBytes}`); checkGlb(ff, id); }
        if (ff === rf) add('minor', 'fallback.sameAsRuntime', where, 'fallback_file equals runtime_file');
      } else if (FALLBACK_REQUIRED_KINDS.includes(String(e.kind))) {
        add('minor', 'fallback.undeclared', where, `kind ${e.kind} has no fallback_file; the client falls back to the built-in rule (scene background / dot). Generator should declare one.`);
      }
      // lods
      if (!Array.isArray(e.lods)) add('major', 'lods.malformed', where, 'lods must be an array');
      else {
        const seenLod = new Set();
        e.lods.forEach((l, idx) => {
          if (typeof l !== 'string' || !l) { add('major', 'lods.malformed', where, `lods[${idx}] must be a non-empty path`); return; }
          if (seenLod.has(l)) add('major', 'lods.malformed', where, `lods[${idx}] duplicates ${l}`); seenLod.add(l);
          if (!existsSync(abs(l))) add('major', 'lods.missing', l, `lod listed by ${id} does not exist`);
          else { note(l, id); if (/^assets\/souls\/.*\.svg$/.test(l) && readBuf(l).length > B.soulSvgBytes) add('major', 'budget.soulSvg', l, `${readBuf(l).length} bytes > ${B.soulSvgBytes}`); checkGlb(l, id); }
        });
        if (e.lods.length && rf && !e.lods.includes(rf)) add('minor', 'lods.runtimeAbsent', where, 'runtime_file is not part of lods (expected as the highest level)');
      }
      for (const f of ['bounds', 'pivot']) if (!Array.isArray(e[f]) || e[f].length !== 3 || e[f].some((n) => typeof n !== 'number')) add('major', 'field.vector', where, `${f} must be [x, y, z] numbers`);
      if (typeof e.triangle_count !== 'number' || e.triangle_count < 0) add('major', 'field.number', where, 'triangle_count must be a non-negative number');
      if (String(e.kind) === 'model') {
        if (!MODEL_FORMATS.includes(String(e.runtime_format))) add('major', 'format.model', where, `kind model needs runtime_format in [${MODEL_FORMATS.join(', ')}], got ${JSON.stringify(e.runtime_format)}`);
        if (!(e.triangle_count > 0)) add('major', 'field.number', where, 'kind model needs triangle_count > 0');
      }
    }
    if (summary.unapproved.assets) add('minor', 'approval.pending', ASSETS_MANIFEST, `${summary.unapproved.assets} of ${assets.entries.length} entries have approved_by: null (human gate item)`);
  }

  // ---------------------------------------------------------------- audio.yaml / audio.json
  let audio = null; let audioYaml = null;
  if (!existsSync(abs(AUDIO_MANIFEST_JSON))) add('critical', 'manifest.missing', AUDIO_MANIFEST_JSON, 'audio manifest (json) not found');
  else { try { audio = JSON.parse(readBuf(AUDIO_MANIFEST_JSON).toString('utf8')); } catch (err) { add('critical', 'manifest.parse', AUDIO_MANIFEST_JSON, err.message); } }
  if (!existsSync(abs(AUDIO_MANIFEST_YAML))) add('critical', 'manifest.missing', AUDIO_MANIFEST_YAML, 'audio manifest (yaml) not found');
  else { try { audioYaml = parseYamlSubset(readBuf(AUDIO_MANIFEST_YAML).toString('utf8')); } catch (err) { add('critical', 'manifest.parse', AUDIO_MANIFEST_YAML, err.message); } }
  if (audio && audioYaml && JSON.stringify(audio) !== JSON.stringify(audioYaml)) add('major', 'audio.twin', AUDIO_MANIFEST_YAML, 'audio.yaml and audio.json differ; regenerate with python3 tools/assets/build-audio.py');
  let audioBytesListed = 0;
  if (audio) {
    const cues = Array.isArray(audio.cues) ? audio.cues : [];
    summary.cues = cues.length;
    if (!Array.isArray(audio.cues)) add('major', 'field.missing', AUDIO_MANIFEST_JSON, 'cues must be an array');
    if (!ALLOWED_LICENSES.includes(String(audio.license))) add('critical', 'license.disallowed', AUDIO_MANIFEST_JSON, `manifest license ${JSON.stringify(audio.license)}`);
    if (!audio.generator_script || !existsSync(abs(String(audio.generator_script)))) add('major', 'generator.missing', AUDIO_MANIFEST_JSON, `generator_script ${audio.generator_script} does not exist`);
    if (!audio.provenance) add('major', 'provenance.missing', AUDIO_MANIFEST_JSON, 'provenance statement is required');
    const oneshotBudget = Number(audio.budgets?.max_oneshot_bytes) || B.audioOneshotBytes;
    const totalBudget = Math.min(B.audioBytes, Number(audio.budgets?.max_total_bytes) || B.audioBytes);
    const seen = new Set();
    for (const c of cues) {
      const id = c.id == null ? '<missing id>' : String(c.id);
      const where = `${AUDIO_MANIFEST_JSON}#${id}`;
      for (const f of AUDIO_REQUIRED_FIELDS) if (!(f in c)) add('major', 'field.missing', where, `required field ${f} is absent`);
      if (seen.has(id)) add('major', 'id.duplicate', where, 'duplicate cue id'); seen.add(id);
      if (assets && assets.entries.some((e) => e.id === id)) add('minor', 'id.crossManifest', where, 'cue id collides with an assets.yaml id');
      if (!ALLOWED_LICENSES.includes(String(c.license))) add('critical', 'license.disallowed', where, `license ${JSON.stringify(c.license)}`);
      if (c.approved_by === null || c.approved_by === undefined) summary.unapproved.audio += 1;
      for (const f of ['source_format', 'runtime_format']) if (PLACEHOLDER_FORMATS.includes(String(c[f] ?? '').toLowerCase())) add('major', 'format.placeholder', where, `${f} is ${JSON.stringify(c[f])}`);
      if (!c.generator_script || !existsSync(abs(String(c.generator_script)))) add('major', 'generator.missing', where, `generator_script ${c.generator_script} does not exist`);
      const src = c.source_file ? String(c.source_file) : '';
      if (!src || !existsSync(abs(src.split('#')[0]))) add('major', 'source.missing', where, `source_file ${c.source_file} does not exist`);
      else if (src.includes('#')) {
        try {
          const doc = JSON.parse(readBuf(src.split('#')[0]).toString('utf8'));
          const ptr = src.split('#')[1].split('/').filter(Boolean);
          let cur = doc; for (const k of ptr) cur = cur == null ? undefined : cur[k];
          if (cur === undefined) add('major', 'source.pointer', where, `${src} does not resolve in the recipe file`);
        } catch (err) { add('major', 'source.pointer', where, `cannot resolve ${src}: ${err.message}`); }
      }
      const rf = c.runtime_file ? String(c.runtime_file) : null;
      if (!rf) { add('major', 'file.missing', where, 'runtime_file is empty'); continue; }
      if (!rf.startsWith('assets/audio/')) add('major', 'file.location', rf, 'audio runtime_file must live under assets/audio/');
      if (!existsSync(abs(rf))) { add('major', 'file.missing', rf, `runtime_file listed by cue ${id} does not exist`); continue; }
      note(rf, id);
      const buf = readBuf(rf);
      audioBytesListed += buf.length;
      if (!/^sha256:[0-9a-f]{64}$/.test(String(c.checksum || ''))) add('major', 'checksum.format', where, `checksum must be sha256:<64 hex>, got ${c.checksum}`);
      else if (String(c.checksum).slice(7) !== sha256hex(buf)) add('critical', 'checksum.mismatch', rf, `manifest ${c.checksum} != file sha256:${sha256hex(buf)} (cue ${id})`);
      if (Number(c.bytes) !== buf.length) add('major', 'bytes.mismatch', rf, `bytes ${c.bytes} != file size ${buf.length} (cue ${id})`);
      if (buf.length > B.singleFileBytes) add('major', 'budget.singleFile', rf, `${buf.length} bytes > ${B.singleFileBytes}`);
      if (c.kind === 'audio-oneshot' && buf.length > oneshotBudget) add('major', 'budget.audioOneshot', rf, `${buf.length} bytes > ${oneshotBudget}`);
      const h = readWavHeader(buf);
      if (!h.ok) add('major', 'audio.header', rf, h.reason);
      else {
        if (h.format !== AUDIO_FORMAT.pcmFormat) add('major', 'audio.header', rf, `format tag ${h.format} is not PCM (1)`);
        if (h.sampleRate !== AUDIO_FORMAT.sampleRate) add('major', 'audio.header', rf, `sample rate ${h.sampleRate} != ${AUDIO_FORMAT.sampleRate}`);
        if (h.channels !== AUDIO_FORMAT.channels) add('major', 'audio.header', rf, `channels ${h.channels} != ${AUDIO_FORMAT.channels}`);
        if (h.bitsPerSample !== AUDIO_FORMAT.bitsPerSample) add('major', 'audio.header', rf, `bit depth ${h.bitsPerSample} != ${AUDIO_FORMAT.bitsPerSample}`);
        if (Number(c.sample_rate) !== h.sampleRate || Number(c.channels) !== h.channels || Number(c.bit_depth) !== h.bitsPerSample) add('major', 'audio.header', rf, 'manifest sample_rate/channels/bit_depth disagree with the file header');
        const dur = h.samples / (h.sampleRate || 1);
        if (Math.abs(Number(c.duration_s) - dur) > 0.001) add('major', 'audio.duration', rf, `duration_s ${c.duration_s} != ${dur.toFixed(4)} from the data chunk`);
        if (c.max_duration_s != null && Number(c.duration_s) > Number(c.max_duration_s) + 1e-6) add('major', 'audio.duration', rf, `duration_s ${c.duration_s} exceeds max_duration_s ${c.max_duration_s}`);
        if (c.loop !== null && c.loop !== undefined) {
          const L = c.loop;
          if (!isPlainObject(L) || typeof L.start_sample !== 'number' || typeof L.end_sample !== 'number') add('major', 'audio.loop', rf, 'loop must be { start_sample, end_sample }');
          else if (!(L.start_sample >= 0 && L.start_sample < L.end_sample && L.end_sample <= h.samples)) add('major', 'audio.loop', rf, `loop ${L.start_sample}..${L.end_sample} outside 0..${h.samples}`);
          if (c.kind !== 'audio-loop') add('major', 'audio.loop', rf, `loop points on a ${c.kind} cue`);
        } else if (c.kind === 'audio-loop') add('major', 'audio.loop', rf, 'audio-loop cue has no loop points');
        if (typeof c.peak_dbfs === 'number' && audio.budgets && typeof audio.budgets.peak_ceiling_dbfs === 'number' && c.peak_dbfs > audio.budgets.peak_ceiling_dbfs + 0.05) add('major', 'audio.peak', rf, `peak ${c.peak_dbfs} dBFS above ceiling ${audio.budgets.peak_ceiling_dbfs}`);
      }
      // preload / audiences
      const aud = Array.isArray(c.audiences) ? c.audiences : [];
      const pre = Array.isArray(c.preload) ? c.preload : [];
      for (const a of aud) if (!APPS.includes(a)) add('major', 'audio.audience', where, `unknown audience ${a}`);
      for (const p of pre) { if (!APPS.includes(p)) add('major', 'preload.audience', where, `unknown preload app ${p}`); else if (!aud.includes(p)) add('major', 'preload.audience', where, `preload app ${p} is not in audiences [${aud.join(', ')}]`); }
      if (!c.caption) add('major', 'audio.caption', where, 'every cue needs a caption (silent-mode equivalent)');
    }
    if (audio.totals && Number(audio.totals.bytes) !== audioBytesListed) add('major', 'bytes.mismatch', AUDIO_MANIFEST_JSON, `totals.bytes ${audio.totals.bytes} != sum of files ${audioBytesListed}`);
    if (audio.totals && Number(audio.totals.cues) !== cues.length) add('major', 'field.missing', AUDIO_MANIFEST_JSON, `totals.cues ${audio.totals.cues} != ${cues.length}`);
    if (summary.unapproved.audio) add('minor', 'approval.pending', AUDIO_MANIFEST_YAML, `${summary.unapproved.audio} of ${cues.length} cues have approved_by: null (human gate item)`);
    summary.budgets.audioBytes = { used: audioBytesListed, limit: totalBudget };
    // ui kit sync: PRELOAD_BY_APP in packages/ui/audio.js must equal the manifest-derived sets
    const uiAudio = abs('packages/ui/audio.js');
    if (checkUiKit && existsSync(uiAudio)) {
      const text = readFileSync(uiAudio, 'utf8');
      const m = text.match(/PRELOAD_BY_APP\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
      if (!m) add('minor', 'preload.uiKitSync', 'packages/ui/audio.js', 'PRELOAD_BY_APP not found; cannot verify preload sync');
      else {
        for (const app of APPS) {
          const row = m[1].match(new RegExp(`${app}\\s*:\\s*\\[([^\\]]*)\\]`));
          const kit = row ? row[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort() : null;
          const man = cues.filter((c) => Array.isArray(c.preload) && c.preload.includes(app)).map((c) => c.id).sort();
          if (!kit) add('major', 'preload.uiKitSync', 'packages/ui/audio.js', `PRELOAD_BY_APP.${app} missing`);
          else if (JSON.stringify(kit) !== JSON.stringify(man)) add('major', 'preload.uiKitSync', 'packages/ui/audio.js', `PRELOAD_BY_APP.${app} [${kit}] != manifest [${man}]`);
        }
      }
    }
  }

  // ---------------------------------------------------------------- tree: orphans + budgets
  const assetFiles = walkFiles(abs('assets'), [], new Set(['manifest']));
  let assetsBytes = 0; let audioBytes = 0; let sceneBytes = 0; let soulsBytes = 0; let decorBytes = 0; let v3Bytes = 0;
  const decorMax = Object.fromEntries(DECOR_FILE.map((d) => [d.key, 0]));
  const v3Max = Object.fromEntries(V3_FILE.map((d) => [d.key, 0]));
  for (const f of assetFiles) {
    const rel = relOf(f.path);
    assetsBytes += f.bytes;
    if (/^assets\/souls\/(charms|faces)\//.test(rel)) {
      decorBytes += f.bytes;
      const d = DECOR_FILE.find((x) => x.re.test(rel));
      if (d) { decorMax[d.key] = Math.max(decorMax[d.key], f.bytes); if (f.bytes > B[d.key]) add('major', 'budget.decor', rel, `${f.bytes} bytes > ${B[d.key]} (${d.key})`); }
    }
    if (rel.startsWith('assets/souls/v3/')) {
      v3Bytes += f.bytes;
      const d = V3_FILE.find((x) => x.re.test(rel));
      if (d) { v3Max[d.key] = Math.max(v3Max[d.key], f.bytes); if (f.bytes > B[d.key]) add('major', 'budget.faceV3', rel, `${f.bytes} bytes > ${B[d.key]} (${d.key})`); }
    }
    if (rel.startsWith('assets/audio/')) audioBytes += f.bytes;
    if (rel.startsWith('assets/scene/')) sceneBytes += f.bytes;
    if (rel.startsWith('assets/souls/')) soulsBytes += f.bytes;
    if (!listed.has(rel) && !ORPHAN_EXEMPT.test(rel)) add('major', 'manifest.orphan', rel, 'runtime file under assets/ is not listed by any manifest entry');
    if (f.bytes > B.singleFileBytes && !listed.has(rel)) add('major', 'budget.singleFile', rel, `${f.bytes} bytes > ${B.singleFileBytes}`);
    if (/^assets\/souls\/.*\.svg$/.test(rel) && f.bytes > B.soulSvgBytes && !listed.has(rel)) add('major', 'budget.soulSvg', rel, `${f.bytes} bytes > ${B.soulSvgBytes}`);
    if (/\.glb$/i.test(rel) && f.bytes > B.glbBytes && !listed.has(rel)) add('major', 'budget.glb', rel, `${f.bytes} bytes > ${B.glbBytes}`);
  }
  summary.files = assetFiles.length;
  summary.budgets.assetsBytes = { used: assetsBytes, limit: B.assetsBytes };
  summary.budgets.audioBytes = { used: audioBytes, limit: summary.budgets.audioBytes ? summary.budgets.audioBytes.limit : B.audioBytes };
  summary.budgets.sceneDataBytes = { used: sceneBytes, limit: B.sceneDataBytes };
  summary.budgets.soulsBytes = { used: soulsBytes, limit: null };
  summary.budgets.singleFileBytes = { used: Math.max(0, ...assetFiles.map((f) => f.bytes)), limit: B.singleFileBytes };
  summary.budgets.soulSvgBytes = { used: Math.max(0, ...assetFiles.filter((f) => /\.svg$/.test(f.path) && relOf(f.path).startsWith('assets/souls/')).map((f) => f.bytes)), limit: B.soulSvgBytes };
  summary.budgets.glbBytes = { used: Math.max(0, ...assetFiles.filter((f) => /\.glb$/i.test(f.path)).map((f) => f.bytes)), limit: B.glbBytes };
  summary.budgets.decorBytes = { used: decorBytes, limit: B.decorBytes };
  for (const d of DECOR_FILE) summary.budgets[d.key] = { used: decorMax[d.key], limit: B[d.key] };
  summary.budgets.v3Bytes = { used: v3Bytes, limit: B.v3Bytes };
  for (const d of V3_FILE) summary.budgets[d.key] = { used: v3Max[d.key], limit: B[d.key] };
  if (v3Bytes > B.v3Bytes) add('major', 'budget.faceV3', 'assets/souls/v3/', `v3 faces ${v3Bytes} bytes > ${B.v3Bytes}`);
  if (decorBytes > B.decorBytes) add('major', 'budget.decor', 'assets/souls/', `charms + faces ${decorBytes} bytes > ${B.decorBytes}`);
  if (assetsBytes > B.assetsBytes) add('major', 'budget.assets', 'assets/', `${assetsBytes} bytes > ${B.assetsBytes}`);
  if (audioBytes > summary.budgets.audioBytes.limit) add('major', 'budget.audio', 'assets/audio/', `${audioBytes} bytes > ${summary.budgets.audioBytes.limit}`);
  if (sceneBytes > B.sceneDataBytes) add('major', 'budget.sceneData', 'assets/scene/', `${sceneBytes} bytes > ${B.sceneDataBytes}`);
  summary.budgets.apps = {};
  for (const [app, dir] of Object.entries(APP_DIRS)) {
    const limit = APP_BUDGET_OVERRIDES[app] ?? B.appBytesEach;
    const files = walkFiles(abs(dir));
    const bytes = files.reduce((a, f) => a + f.bytes, 0);
    summary.budgets.apps[app] = { path: dir, used: bytes, limit, files: files.length };
    if (!files.length) add('info', 'app.empty', dir, `no files yet for ${app}; bundle budget not evaluated`);
    else if (bytes > limit) add('major', 'budget.app', dir, `${bytes} bytes > ${limit}`);
  }

  // ---------------------------------------------------------------- generated asset map in sync
  if (checkAssetMap && assets && audio) {
    const mapPath = abs(ASSET_MAP_PATH);
    try {
      const expected = buildAssetMapSource({ root });
      if (!existsSync(mapPath)) add('major', 'assetmap.missing', ASSET_MAP_PATH, 'run: node tools/assets/build-asset-map.js');
      else if (readFileSync(mapPath, 'utf8') !== expected) add('major', 'assetmap.stale', ASSET_MAP_PATH, 'asset map differs from the manifests; run: node tools/assets/build-asset-map.js');
    } catch (err) { add('major', 'assetmap.error', ASSET_MAP_PATH, err.message); }
  }

  for (const p of problems) summary.bySeverity[p.severity] = (summary.bySeverity[p.severity] || 0) + 1;
  const ok = summary.bySeverity.critical === 0 && summary.bySeverity.major === 0;
  return { ok, problems, summary };
}

const fmtBytes = (n) => (n == null ? '-' : `${(n / 1024).toFixed(1)} KB`);
export function formatReport({ ok, problems, summary }) {
  const lines = [];
  lines.push(`validate-manifest: ${ok ? 'OK' : 'FAILED'} - ${summary.entries} asset entries, ${summary.cues} audio cues, ${summary.files} runtime files`);
  const b = summary.budgets;
  const row = (name, v) => v && lines.push(`  budget ${name.padEnd(16)} ${fmtBytes(v.used).padStart(10)} / ${v.limit == null ? 'n/a' : fmtBytes(v.limit)}${v.limit != null && v.used > v.limit ? '  OVER' : ''}`);
  row('assets', b.assetsBytes); row('audio', b.audioBytes); row('scene data', b.sceneDataBytes); row('largest file', b.singleFileBytes); row('largest soul svg', b.soulSvgBytes); row('largest glb', b.glbBytes);
  row('soul decor', b.decorBytes); row('largest charm glb', b.charmGlbBytes); row('largest charm png', b.charmPngBytes); row('largest face glb', b.faceGlbBytes); row('largest face png', b.faceSpriteBytes);
  row('soul faces v3', b.v3Bytes); row('largest plate glb', b.plateGlbBytes); row('largest eyes glb', b.eyesGlbBytes); row('largest kit v3 glb', b.kitGlbBytes); row('largest v3 sprite', b.spriteBytes);
  for (const [app, v] of Object.entries(b.apps || {})) row(`app ${app}`, v.files ? v : { used: 0, limit: v.limit });
  lines.push(`  approvals pending: assets ${summary.unapproved.assets}, audio ${summary.unapproved.audio}`);
  lines.push(`  problems: critical ${summary.bySeverity.critical}, major ${summary.bySeverity.major}, minor ${summary.bySeverity.minor}, info ${summary.bySeverity.info}`);
  for (const p of problems) lines.push(`  [${p.severity}] ${p.check} ${p.path ?? ''} - ${p.detail}`);
  return lines.join('\n');
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const root = arg('--root') || DEFAULT_ROOT;
  const result = validateManifests({ root });
  if (argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else if (!argv.includes('--quiet')) console.log(formatReport(result));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
