#!/usr/bin/env node
// tools/assets/build-soul-baseline.js - publishes the baseline Arise Soul (D-27, docs/art/soul-baseline.md) as runtime
// assets. The two web models are built in Blender by tools/ai/blender/soul_baseline.py (the entries' generator_script)
// into assets-src/generated/soul-baseline/v1/; this step copies them byte for byte to assets/souls/baseline/, checks
// each one (glTF 2.0 binary, KHR_mesh_quantization, POSITION/NORMAL/indices, the COLOR_0 RGBA mask, the landmarks the
// phone scene anchors to) and merges two `kind: model` entries into assets/manifest/assets.yaml. Deterministic (a
// byte copy + the sorted manifest emitter), zero third-party code, running twice is a no-op.
// Usage: node tools/assets/build-soul-baseline.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mergeManifest, sha256 } from './lib/manifest.js';
import { readGlb, meshBounds } from './lib/glb.js';

export const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GENERATOR = 'tools/ai/blender/soul_baseline.py';
export const SOURCE_DIR = 'assets-src/generated/soul-baseline/v1';
export const RUNTIME_DIR = 'assets/souls/baseline';
export const MANIFEST = 'assets/manifest/assets.yaml';
export const GLB_BUDGET_BYTES = 400 * 1024;
export const LODS = Object.freeze([
  Object.freeze({ lod: 'hero', id: 'soul_baseline_hero', file: 'soul-baseline-hero.glb' }),
  Object.freeze({ lod: 'lite', id: 'soul_baseline_lite', file: 'soul-baseline-lite.glb' }),
]);
const R5 = (v) => Number(Number(v).toFixed(5));
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * Deep check of one baseline GLB. Never throws: { ok, problems: string[], warnings: string[], triangles, vertices,
 * landmarks, bounds: { min, max }, version }. Problems block the build; warnings are reported (spec nits that the
 * runtime works around).
 */
export function inspectBaselineGlb(buf) {
  const out = { ok: false, problems: [], warnings: [], triangles: 0, vertices: 0, landmarks: null, bounds: null, version: null };
  const glb = readGlb(buf);
  if (!glb.ok) { out.problems.push(`glb: ${glb.reason}`); return out; }
  const j = glb.json;
  if (j.asset?.version !== '2.0') out.problems.push(`asset.version ${j.asset?.version} != 2.0`);
  if (!glb.bin) out.problems.push('no BIN chunk');
  if (!(j.extensionsRequired || []).includes('KHR_mesh_quantization')) out.problems.push('KHR_mesh_quantization is not in extensionsRequired');
  if (!(j.extensionsUsed || []).includes('KHR_mesh_quantization')) out.problems.push('KHR_mesh_quantization is not in extensionsUsed');
  const prim = j.meshes?.[0]?.primitives?.[0];
  if (!prim) { out.problems.push('no mesh primitive'); return out; }
  const acc = (i) => (i === undefined ? null : j.accessors?.[i] || null);
  const pos = acc(prim.attributes?.POSITION), nrm = acc(prim.attributes?.NORMAL), col = acc(prim.attributes?.COLOR_0), idx = acc(prim.indices);
  if (!pos) out.problems.push('POSITION missing');
  if (!nrm) out.problems.push('NORMAL missing');
  if (!col) out.problems.push('COLOR_0 (RGBA mask: R drips, G eye disc, B groove ring, A orb) missing');
  else {
    if (col.type !== 'VEC4') out.problems.push(`COLOR_0 type ${col.type} != VEC4 (RGBA mask)`);
    if (col.componentType !== 5121 || col.normalized !== true) out.problems.push('COLOR_0 must be normalized UNSIGNED_BYTE');
    if (pos && col.count !== pos.count) out.problems.push(`COLOR_0 count ${col.count} != POSITION count ${pos.count}`);
  }
  if (!idx) out.problems.push('indices missing');
  if ((prim.mode ?? 4) !== 4) out.problems.push(`primitive mode ${prim.mode} is not TRIANGLES`);
  if (pos) out.vertices = pos.count;
  if (idx) {
    if (idx.count % 3) out.problems.push(`index count ${idx.count} is not a multiple of 3`);
    out.triangles = Math.floor(idx.count / 3);
    const declared = j.asset?.extras?.triangles;
    if (declared !== undefined && declared !== out.triangles) out.problems.push(`asset.extras.triangles ${declared} != ${out.triangles} from the index accessor`);
  }
  // glTF 2.0 accessor.min/max: always the raw stored values, even when `normalized` (GLTFLoader derives the bounding
  // volume from them, so floats here give a near-zero box). A problem, not a warning: the Blender generator writes integers.
  if (pos && pos.normalized && [pos.min, pos.max].some((a) => !Array.isArray(a) || a.some((v) => !Number.isInteger(v)))) out.problems.push('POSITION accessor min/max must be the raw stored integers (glTF 2.0: `normalized` never applies to min/max)');
  // landmarks (asset.extras.landmarks)
  const L = j.asset?.extras?.landmarks;
  out.version = j.asset?.extras?.version ?? null;
  if (!L) out.problems.push('asset.extras.landmarks missing');
  else {
    if (!isVec3(L.orb?.centre) || !(L.orb?.radius > 0)) out.problems.push('landmarks.orb { centre[3], radius } missing');
    if (!Array.isArray(L.eyes) || L.eyes.length !== 2 || L.eyes.some((e) => !isVec3(e.centre) || !isVec3(e.normal) || !(e.radius > 0))) out.problems.push('landmarks.eyes must be two { centre[3], normal[3], radius }');
    if (!(L.height > 0)) out.problems.push('landmarks.height missing');
    if (typeof L.floor !== 'number') out.problems.push('landmarks.floor missing');
    if (!isVec3(L.badge_anchor)) out.problems.push('landmarks.badge_anchor[3] missing');
    out.landmarks = L;
  }
  if (!out.problems.length) {
    try {
      out.bounds = meshBounds(j, glb.bin);
      const h = out.bounds.max[1] - out.bounds.min[1];
      if (Math.abs(h - L.height) > 0.01) out.problems.push(`mesh height ${h.toFixed(4)} disagrees with landmarks.height ${L.height}`);
      if (Math.abs(out.bounds.min[1] - L.floor) > 0.01) out.problems.push(`mesh floor ${out.bounds.min[1].toFixed(4)} disagrees with landmarks.floor ${L.floor}`);
    } catch (err) { out.problems.push(`POSITION data unreadable: ${err.message}`); }
  }
  if (buf.length > GLB_BUDGET_BYTES) out.problems.push(`${buf.length} bytes > GLB budget ${GLB_BUDGET_BYTES}`);
  out.ok = out.problems.length === 0;
  return out;
}

/** Manifest entry for one LOD (workflow 5.2 fields; bounds = [width, height, depth] in model units, pivot = the feet). */
export function baselineEntry(spec, buf, info, { liteRuntime }) {
  const runtime = `${RUNTIME_DIR}/${spec.file}`;
  const { min, max } = info.bounds;
  const hero = spec.lod === 'hero';
  return {
    id: spec.id, kind: 'model',
    source_file: `${SOURCE_DIR}/${spec.file}`, source_format: 'glb',
    runtime_file: runtime, runtime_format: 'glb',
    fallback_file: hero ? liteRuntime : null, fallback_format: hero ? 'glb' : null,
    version: String(info.version || '1.0.0'), checksum: sha256(buf), license: 'internal-original', generator_script: GENERATOR,
    bounds: [R5(max[0] - min[0]), R5(info.landmarks.height), R5(max[2] - min[2])],
    pivot: [0, R5(info.landmarks.floor), 0],
    triangle_count: info.triangles, texture_memory_bytes: buf.length,
    lods: hero ? [runtime, liteRuntime] : [runtime], approved_by: null,
  };
}

/** Programmatic entry point: copies + validates + merges. Returns { ok, problems, warnings, entries, written }. */
export function buildSoulBaseline({ root = DEFAULT_ROOT, log = () => {} } = {}) {
  const problems = [], warnings = [], entries = [], written = [];
  const liteRuntime = `${RUNTIME_DIR}/${LODS.find((l) => l.lod === 'lite').file}`;
  // provenance.json (written by the Blender build next to the GLBs) must describe exactly these bytes
  let provenance = null;
  const provPath = join(root, SOURCE_DIR, 'provenance.json');
  if (existsSync(provPath)) { try { provenance = JSON.parse(readFileSync(provPath, 'utf8')); } catch (err) { problems.push(`provenance.json unreadable: ${err.message}`); } }
  else warnings.push(`${SOURCE_DIR}/provenance.json missing; sha256 provenance not cross-checked`);
  const bufs = [];
  for (const spec of LODS) {
    const src = join(root, SOURCE_DIR, spec.file);
    if (!existsSync(src)) { problems.push(`${SOURCE_DIR}/${spec.file}: missing (run the Blender build in docs/art/soul-baseline.md)`); continue; }
    const buf = readFileSync(src);
    const info = inspectBaselineGlb(buf);
    for (const p of info.problems) problems.push(`${spec.file}: ${p}`);
    for (const w of info.warnings) warnings.push(`${spec.file}: ${w}`);
    const rec = provenance?.files?.[spec.file];
    if (provenance && !rec) problems.push(`${spec.file}: not listed in provenance.json`);
    else if (rec) {
      if (`sha256:${rec.sha256}` !== sha256(buf)) problems.push(`${spec.file}: sha256 differs from provenance.json (rebuild with the Blender command in docs/art/soul-baseline.md)`);
      if (rec.bytes !== undefined && rec.bytes !== buf.length) problems.push(`${spec.file}: ${buf.length} bytes != provenance.json ${rec.bytes}`);
      if (rec.triangles !== undefined && rec.triangles !== info.triangles) problems.push(`${spec.file}: ${info.triangles} triangles != provenance.json ${rec.triangles}`);
    }
    bufs.push({ spec, buf, info });
  }
  if (problems.length) return { ok: false, problems, warnings, entries, written };
  mkdirSync(join(root, RUNTIME_DIR), { recursive: true });
  for (const { spec, buf, info } of bufs) {
    const dest = join(root, RUNTIME_DIR, spec.file);
    if (!existsSync(dest) || !readFileSync(dest).equals(buf)) { writeFileSync(dest, buf); written.push(`${RUNTIME_DIR}/${spec.file}`); }
    entries.push(baselineEntry(spec, buf, info, { liteRuntime }));
    log(`${spec.id}: ${info.triangles} triangles, ${info.vertices} vertices, ${buf.length} bytes`);
  }
  mergeManifest(join(root, MANIFEST), GENERATOR, entries);
  return { ok: true, problems, warnings, entries, written };
}

function main() {
  const r = buildSoulBaseline({ log: (m) => console.log(`build-soul-baseline: ${m}`) });
  for (const w of r.warnings) console.log(`build-soul-baseline: warning: ${w}`);
  if (!r.ok) { for (const p of r.problems) console.error(`build-soul-baseline: ${p}`); return 1; }
  console.log(`build-soul-baseline: ${r.entries.length} manifest entries, ${r.written.length} file(s) written -> ${RUNTIME_DIR}/`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
