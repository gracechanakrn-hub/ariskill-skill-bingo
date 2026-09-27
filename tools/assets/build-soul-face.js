#!/usr/bin/env node
// tools/assets/build-soul-face.js - publishes the stage-13 Soul faces (D-31, docs/art/soul-faces.md) as runtime assets.
// tools/ai/blender/soul_face.py (the entries' generator_script) builds the v3 body (hero + lite), the 10 face plates, the
// 10 eye designs, the three refitted face kits and their 2D sprites into assets-src/generated/soul-face/v1/ and records
// the sha256 of each in provenance.json. This step copies them byte for byte to assets/souls/v3/, checks each file
// (glTF 2.0 binary, KHR_mesh_quantization, raw-integer POSITION min/max, the v3 body's mask and landmarks, part
// materials, sprites, budgets), checks that packages/ui/soul-face-data.js lists exactly these files with their hashes
// and sprite rects, and merges one `kind: model` entry per GLB into assets/manifest/assets.yaml (a part's sprite is its
// 2D fallback; the hero body falls back to the lite one, the lite body has none, like the baseline). The staged PNGs are git-ignored, so on a fresh clone the
// runtime copies themselves are checked against provenance.json. Deterministic, zero third-party code.
// Usage: node tools/assets/build-soul-face.js
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mergeManifest, sha256 } from './lib/manifest.js';
import { readGlb, readAccessor, meshBoundsAll } from './lib/glb.js';
import { inspectBaselineGlb } from './build-soul-baseline.js';
import { inspectFaceGlb, readCatalog, pngInfo } from './build-soul-decor.js';
import { FACE_V3_BUDGETS } from './validate-manifest.js';

export const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GENERATOR = 'tools/ai/blender/soul_face.py';
export const SOURCE_DIR = 'assets-src/generated/soul-face/v1';
export const RUNTIME = 'assets/souls/v3';
export const DATA_MODULE = 'packages/ui/soul-face-data.js';
export const MANIFEST = 'assets/manifest/assets.yaml';
export const SHA_CHARS = 10;
/** landmarks.height / floor of the baseline GLBs: the v3 body keeps them so a v3 Soul with its antenna charm fits like v2. */
export const BASE_HEIGHT = 2.29087;
export const BASE_FLOOR = -0.02189;
const R5 = (v) => Number(Number(v).toFixed(5));
const hex = (buf) => createHash('sha256').update(buf).digest('hex');
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** The object literal of the generated data module (JSON inside deepFreeze(...)); null when unreadable. */
export function readFaceData(root = DEFAULT_ROOT) {
  const p = join(root, DATA_MODULE);
  if (!existsSync(p)) return null;
  const txt = readFileSync(p, 'utf8');
  const i = txt.indexOf('deepFreeze({'), j = txt.lastIndexOf('});');
  if (i < 0 || j < i) return null;
  try { return JSON.parse(txt.slice(i + 'deepFreeze('.length, j + 1)); } catch { return null; }
}

/**
 * The v3 body (hero or lite): the baseline checks, except that the mesh ends at the antenna stalk while landmarks keep the
 * baseline height (the antenna charm reaches it); the mask carries drips only (G, B, A all 0); landmarks.topper is set.
 */
export function inspectV3BodyGlb(buf) {
  const out = inspectBaselineGlb(buf);
  out.problems = out.problems.filter((p) => !p.startsWith('mesh height'));
  const glb = readGlb(buf);
  const L = out.landmarks;
  if (glb.ok && L) {
    if (R5(L.height) !== BASE_HEIGHT || R5(L.floor) !== BASE_FLOOR) out.problems.push(`landmarks height/floor ${L.height}/${L.floor} != the baseline ${BASE_HEIGHT}/${BASE_FLOOR}`);
    if (!isVec3(L.topper?.centre) || !(L.topper?.size > 0)) out.problems.push('landmarks.topper { centre[3], size } missing');
    else if (Math.abs(L.topper.centre[1] + L.topper.size / 2 - (L.floor + L.height)) > 0.03) out.problems.push('landmarks.topper does not reach the baseline height');
    if (out.bounds && out.bounds.max[1] > L.floor + L.height) out.problems.push(`mesh top ${out.bounds.max[1].toFixed(4)} is above the baseline height`);
    try {
      const j = glb.json;
      const col = readAccessor(j, glb.bin, j.meshes[0].primitives[0].attributes.COLOR_0);
      let gba = 0;
      for (let i = 0; i < col.length; i += 4) gba = Math.max(gba, col[i + 1], col[i + 2], col[i + 3]);
      if (gba > 0) out.problems.push('the v3 body mask must have G, B and A at 0 (no eye discs, grooves or orb)');
    } catch (err) { out.problems.push(`COLOR_0 unreadable: ${err.message}`); }
  }
  out.ok = out.problems.length === 0;
  return out;
}

function quantisedPosition(j, prim, problems, tag) {
  const pos = j.accessors?.[prim.attributes?.POSITION];
  if (!pos) { problems.push(`${tag}POSITION missing`); return; }
  if (pos.componentType !== 5122 || pos.normalized !== true) problems.push(`${tag}POSITION must be normalized SHORT (KHR_mesh_quantization)`);
  if ([pos.min, pos.max].some((a) => !Array.isArray(a) || a.some((v) => !Number.isInteger(v)))) problems.push(`${tag}POSITION accessor min/max must be the raw stored integers`);
  const nrm = j.accessors?.[prim.attributes?.NORMAL];
  if (!nrm || nrm.componentType !== 5120 || nrm.normalized !== true) problems.push(`${tag}NORMAL must be normalized BYTE`);
  if (prim.indices === undefined) problems.push(`${tag}indices missing`);
  if ((prim.mode ?? 4) !== 4) problems.push(`${tag}primitive mode ${prim.mode} is not TRIANGLES`);
}

/**
 * A face plate or an eye design: model space at identity on the face, one primitive per colour (extras.part), core
 * PBR colours, no textures; a gradient part carries COLOR_0 (normalized UNSIGNED_SHORT VEC4) with a white base colour.
 * -> { ok, problems, triangles, parts, bounds }.
 */
export function inspectPartGlb(buf, kind) {
  const out = { ok: false, problems: [], triangles: 0, parts: [], bounds: null };
  const glb = readGlb(buf);
  if (!glb.ok) { out.problems.push(`glb: ${glb.reason}`); return out; }
  const j = glb.json;
  if (j.asset?.version !== '2.0') out.problems.push(`asset.version ${j.asset?.version} != 2.0`);
  for (const k of ['extensionsRequired', 'extensionsUsed']) if (!(j[k] || []).includes('KHR_mesh_quantization')) out.problems.push(`KHR_mesh_quantization is not in ${k}`);
  const prims = j.meshes?.[0]?.primitives || [];
  if (!prims.length) { out.problems.push('no primitives'); return out; }
  prims.forEach((p, i) => {
    quantisedPosition(j, p, out.problems, `primitive ${i}: `);
    out.parts.push(p.extras?.part || `#${i}`);
    const idx = j.accessors?.[p.indices];
    if (idx) out.triangles += Math.floor(idx.count / 3);
    const mat = j.materials?.[p.material];
    const base = mat?.pbrMetallicRoughness?.baseColorFactor;
    if (!Array.isArray(base) || base.length !== 4) out.problems.push(`primitive ${i}: material without baseColorFactor`);
    const col = p.attributes?.COLOR_0 === undefined ? null : j.accessors?.[p.attributes.COLOR_0];
    if (col) {
      if (col.type !== 'VEC4' || col.componentType !== 5123 || col.normalized !== true) out.problems.push(`primitive ${i}: COLOR_0 must be normalized UNSIGNED_SHORT VEC4`);
      if (Array.isArray(base) && base.some((v) => v !== 1)) out.problems.push(`primitive ${i}: a vertex-coloured part needs a white baseColorFactor`);
    }
    if (mat?.extras?.emissiveFromVertexColor && !col) out.problems.push(`primitive ${i}: emissiveFromVertexColor without COLOR_0`);
  });
  if (new Set(out.parts).size !== out.parts.length) out.problems.push('part names repeat');
  if ((j.images || []).length || (j.textures || []).length) out.problems.push('face parts use fixed colours, no textures');
  if (!out.problems.length) {
    try {
      out.bounds = meshBoundsAll(j, glb.bin);
      const { min, max } = out.bounds;
      if (min[1] < 0.8 || max[1] > 1.6 || Math.abs(min[0]) > 0.45 || Math.abs(max[0]) > 0.45 || min[2] < 0 || max[2] > 0.6) out.problems.push(`bounds ${JSON.stringify(min.map(R5))}..${JSON.stringify(max.map(R5))} leave the face region of model space`);
    } catch (err) { out.problems.push(`POSITION data unreadable: ${err.message}`); }
  }
  const limit = kind === 'plate' ? FACE_V3_BUDGETS.plateGlbBytes : FACE_V3_BUDGETS.eyesGlbBytes;
  if (buf.length > limit) out.problems.push(`${buf.length} bytes > ${kind} GLB budget ${limit}`);
  out.ok = out.problems.length === 0;
  return out;
}

/** Manifest entry (workflow 5.2 fields) for one v3 GLB. */
export function faceEntry({ id, group, file, glb, info, fallback, lods, pivot = [0, 0, 0] }) {
  const { min, max } = info.bounds;
  const runtime = `${RUNTIME}/${file}`;
  return {
    id, kind: 'model',
    source_file: `${SOURCE_DIR}/${group}/${file}`, source_format: 'glb',
    runtime_file: runtime, runtime_format: 'glb', fallback_file: fallback, fallback_format: fallback == null ? null : fallback.endsWith('.png') ? 'png' : 'glb',
    version: '1.0.0', checksum: sha256(glb), license: 'internal-original', generator_script: GENERATOR,
    bounds: [R5(max[0] - min[0]), R5(max[1] - min[1]), R5(max[2] - min[2])], pivot,
    triangle_count: info.triangles, texture_memory_bytes: glb.length, lods: lods || [runtime], approved_by: null,
  };
}

/** Programmatic entry point: copies + validates + merges. Returns { ok, problems, entries, written, bytes }. */
export function buildSoulFace({ root = DEFAULT_ROOT, log = () => {} } = {}) {
  const problems = [], entries = [], written = [];
  let bytes = 0;
  const provPath = join(root, SOURCE_DIR, 'provenance.json');
  if (!existsSync(provPath)) return { ok: false, problems: [`${SOURCE_DIR}/provenance.json missing (run npm run ai:soul-face)`], entries, written, bytes };
  let prov;
  try { prov = JSON.parse(readFileSync(provPath, 'utf8')); } catch (err) { return { ok: false, problems: [`provenance.json unreadable: ${err.message}`], entries, written, bytes }; }
  const cat = readCatalog(root);
  const plates = (cat.plates || []).map((p) => p.id), eyes = (cat.eyes || []).map((e) => e.id);
  const faces = cat.kinds.map((k) => cat.faces[k]);
  const copies = [];
  const take = (group, file) => {
    const rec = prov.files?.[`${group}/${file}`];
    const staged = join(root, SOURCE_DIR, group, file), runtime = join(root, RUNTIME, file);
    const have = existsSync(staged) ? staged : existsSync(runtime) ? runtime : null;
    if (!have) { problems.push(`${group}/${file}: not built (run npm run ai:soul-face)`); return null; }
    const buf = readFileSync(have);
    if (!rec) { problems.push(`${group}/${file}: not listed in provenance.json`); return null; }
    if (rec.sha256 !== hex(buf)) { problems.push(`${group}/${file}: sha256 differs from provenance.json (rebuild with npm run ai:soul-face)`); return null; }
    copies.push({ rel: `${RUNTIME}/${file}`, buf });
    bytes += buf.length;
    return buf;
  };
  const sprite = (name) => {
    const png = take('sprites', `${name}.png`);
    if (!png) return;
    const pi = pngInfo(png), rec = prov.files[`sprites/${name}.png`];
    if (!pi.ok || !pi.alpha) problems.push(`sprites/${name}.png: must be a PNG with alpha`);
    else if (!Array.isArray(rec.px) || rec.px[0] !== pi.width || rec.px[1] !== pi.height) problems.push(`sprites/${name}.png: ${pi.width}x${pi.height} px disagrees with provenance`);
    if (!Array.isArray(rec.rect) || rec.rect.length !== 4 || rec.rect.some((v) => typeof v !== 'number')) problems.push(`sprites/${name}.png: provenance rect missing`);
    if (png.length > FACE_V3_BUDGETS.spriteBytes) problems.push(`sprites/${name}.png: ${png.length} bytes > ${FACE_V3_BUDGETS.spriteBytes}`);
  };
  // the v3 body
  const hero = take('body', 'body-hero.glb'), lite = take('body', 'body-lite.glb');
  for (const [lod, glb] of [['hero', hero], ['lite', lite]]) {
    if (!glb) continue;
    const info = inspectV3BodyGlb(glb);
    for (const p of info.problems) problems.push(`body/body-${lod}.glb: ${p}`);
    if (info.ok) {
      entries.push(faceEntry({ id: `soul_face_v3_body_${lod}`, group: 'body', file: `body-${lod}.glb`, glb, info, fallback: lod === 'hero' ? `${RUNTIME}/body-lite.glb` : null,
        lods: lod === 'hero' ? [`${RUNTIME}/body-hero.glb`, `${RUNTIME}/body-lite.glb`] : [`${RUNTIME}/body-lite.glb`], pivot: [0, BASE_FLOOR, 0] }));
    }
  }
  // plates, eyes, kits and their sprites
  const parts = [...plates.map((p) => ['plates', `plate-${p}`, 'plate', `soul_face_v3_plate_${p}`]), ...eyes.map((e) => ['eyes', `eyes-${e}`, 'eyes', `soul_face_v3_eyes_${e}`]),
    ...faces.map((f) => ['kits', `face-${f}`, 'kit', `soul_face_v3_kit_${f}`])];
  for (const [group, name, kind, id] of parts) {
    const glb = take(group, `${name}.glb`);
    sprite(name);
    if (!glb) continue;
    let info;
    if (kind === 'kit') {
      const face = name.slice('face-'.length);
      info = inspectFaceGlb(glb, face);
      info.problems = info.problems.filter((p) => !p.startsWith('angel blush') && !p.includes('face GLB budget'));   // v3: no blush
      if (!info.problems.length && !info.bounds) { const g = readGlb(glb); info.bounds = meshBoundsAll(g.json, g.bin); }   // skipped while the blush rule failed
      if (glb.length > FACE_V3_BUDGETS.kitGlbBytes) info.problems.push(`${glb.length} bytes > kit GLB budget ${FACE_V3_BUDGETS.kitGlbBytes}`);
      info.ok = info.problems.length === 0;
    } else info = inspectPartGlb(glb, kind);
    for (const p of info.problems) problems.push(`${group}/${name}.glb: ${p}`);
    if (info.ok) entries.push(faceEntry({ id: id.replace(/-/g, '_'), group, file: `${name}.glb`, glb, info, fallback: `${RUNTIME}/${name}.png` }));
  }
  if (bytes > FACE_V3_BUDGETS.v3Bytes) problems.push(`${RUNTIME} total ${bytes} bytes > ${FACE_V3_BUDGETS.v3Bytes}`);
  // stray runtime files (nothing is deleted: report them)
  const expect = new Set(copies.map((c) => c.rel));
  const dir = join(root, RUNTIME);
  if (existsSync(dir)) for (const f of readdirSync(dir).sort()) if (!f.startsWith('.') && !expect.has(`${RUNTIME}/${f}`)) problems.push(`${RUNTIME}/${f}: not a built v3 face file`);
  // the data module must list exactly these files, with their hashes and sprite rects
  const data = readFaceData(root);
  if (!data) problems.push(`${DATA_MODULE}: unreadable (regenerate with npm run ai:soul-face -- --mode data)`);
  else {
    if (data.stub !== false || data.version !== 1) problems.push(`${DATA_MODULE}: still the placeholder (stub ${data.stub}, version ${data.version})`);
    if (data.catalogVersion !== cat.version) problems.push(`${DATA_MODULE}: catalogVersion ${data.catalogVersion} != catalog ${cat.version}`);
    const byRel = new Map(copies.map((c) => [c.rel, c.buf]));
    const urlOk = (url, file) => { const buf = byRel.get(`${RUNTIME}/${file}`); return !!buf && url === `/${RUNTIME}/${file}?v=${hex(buf).slice(0, SHA_CHARS)}`; };
    for (const lod of ['hero', 'lite']) if (!urlOk(data.body?.[lod], `body-${lod}.glb`)) problems.push(`${DATA_MODULE}: body.${lod} URL or hash is stale`);
    const map = { plates: [plates, 'plate'], eyes: [eyes, 'eyes'], faces: [faces, 'face'] };
    for (const [key, [ids, prefix]] of Object.entries(map)) {
      const listed = Object.keys(data[key] || {});
      if (JSON.stringify(listed) !== JSON.stringify(ids)) problems.push(`${DATA_MODULE}: ${key} lists ${listed.join(',')} (catalog: ${ids.join(',')})`);
      for (const id of ids) {
        const f = data[key]?.[id], name = `${prefix}-${id}`;
        if (!f || !urlOk(f.glb, `${name}.glb`) || !urlOk(f.sprite, `${name}.png`)) problems.push(`${DATA_MODULE}: ${key}.${id} URL or hash is stale`);
        else if (JSON.stringify(f.rect) !== JSON.stringify(prov.files[`sprites/${name}.png`]?.rect)) problems.push(`${DATA_MODULE}: ${key}.${id} rect disagrees with provenance`);
      }
    }
    const t = data.topper;
    if (!t || !isVec3(t.centre) || !isVec3(t.normal) || !isVec3(t.up) || !(t.size > 0) || !(t.front2d?.r > 0)) problems.push(`${DATA_MODULE}: topper slot incomplete`);
    if (typeof data.shape?.silhouette !== 'string' || !data.shape.silhouette.startsWith('M')) problems.push(`${DATA_MODULE}: shape.silhouette missing`);
  }
  if (problems.length) return { ok: false, problems, entries, written, bytes };
  for (const { rel, buf } of copies) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (!existsSync(dest) || !readFileSync(dest).equals(buf)) { writeFileSync(dest, buf); written.push(rel); }
  }
  mergeManifest(join(root, MANIFEST), GENERATOR, entries);
  log(`v3 body (hero + lite), ${plates.length} plates, ${eyes.length} eye designs, ${faces.length} kits: ${entries.length} manifest entries, ${(bytes / 1024).toFixed(1)} KB`);
  return { ok: true, problems, entries, written, bytes };
}

function main() {
  const r = buildSoulFace({ log: (m) => console.log(`build-soul-face: ${m}`) });
  if (!r.ok) { for (const p of r.problems) console.error(`build-soul-face: ${p}`); return 1; }
  console.log(`build-soul-face: ${r.written.length} file(s) written -> ${RUNTIME}/`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
