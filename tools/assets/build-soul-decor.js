#!/usr/bin/env node
// tools/assets/build-soul-decor.js - publishes the Soul decorations (D-29, docs/art/soul-decorations.md) as runtime assets.
// tools/ai/blender/soul_decor.py (the entries' generator_script) builds every charm model + texture and the three face
// kits + front sprites into assets-src/generated/soul-decor/v1/ and records the sha256 of each in provenance.json. This
// step copies them byte for byte to assets/souls/charms/ and assets/souls/faces/, checks each file (glTF 2.0 binary,
// KHR_mesh_quantization, raw-integer POSITION min/max, the charm frame and its external <id>.png texture, the face-kit
// materials, PNG sizes, budgets), checks that packages/ui/soul-decor-data.js lists exactly these files with their hashes,
// and merges one `kind: model` entry per charm and per face kit into assets/manifest/assets.yaml (the model is the
// runtime file, its PNG the 2D fallback). A charm whose icon is not drawn yet is reported as missing, not a failure: the
// data module lists only built charms. The staged PNGs are git-ignored, so on a fresh clone the runtime copies themselves
// are checked against provenance.json. Deterministic (byte copies + the sorted manifest emitter), zero third-party code.
// Usage: node tools/assets/build-soul-decor.js
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mergeManifest, sha256 } from './lib/manifest.js';
import { readGlb, readAccessor, meshBounds, meshBoundsAll, imageRefs } from './lib/glb.js';
import { DECOR_BUDGETS } from './validate-manifest.js';

export const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GENERATOR = 'tools/ai/blender/soul_decor.py';
export const SOURCE_DIR = 'assets-src/generated/soul-decor/v1';
export const RUNTIME = Object.freeze({ charms: 'assets/souls/charms', faces: 'assets/souls/faces' });
export const DATA_MODULE = 'packages/ui/soul-decor-data.js';
export const CATALOG = 'packages/game-rules/src/soul-catalog.js';
export const MANIFEST = 'assets/manifest/assets.yaml';
export const FACES = Object.freeze(['nerdy', 'pirate', 'angel']);
export const CHARM_PNG_PX = 128;
export const FACE_SPRITE_PX = 800;
export const SHA_CHARS = 10;
const R5 = (v) => Number(Number(v).toFixed(5));
const hex = (buf) => createHash('sha256').update(buf).digest('hex');

/** The strict-JSON catalog block of soul-catalog.js (the same one Python reads). */
export function readCatalog(root = DEFAULT_ROOT) {
  const txt = readFileSync(join(root, CATALOG), 'utf8');
  const a = txt.indexOf('// BEGIN SOUL_CATALOG_JSON'), b = txt.indexOf('// END SOUL_CATALOG_JSON');
  const blk = txt.slice(a, b);
  return JSON.parse(blk.slice(blk.indexOf('{'), blk.lastIndexOf('}') + 1));
}

/** The object literal of the generated data module (JSON inside deepFreeze(...)); null when unreadable. */
export function readDecorData(root = DEFAULT_ROOT) {
  const p = join(root, DATA_MODULE);
  if (!existsSync(p)) return null;
  const txt = readFileSync(p, 'utf8');
  const i = txt.indexOf('deepFreeze({'), j = txt.lastIndexOf('});');
  if (i < 0 || j < i) return null;
  try { return JSON.parse(txt.slice(i + 'deepFreeze('.length, j + 1)); } catch { return null; }
}

/** PNG header: { ok, width, height, colorType, alpha, reason }. */
export function pngInfo(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf || buf.length < 33 || !buf.subarray(0, 8).equals(sig) || buf.toString('ascii', 12, 16) !== 'IHDR') return { ok: false, reason: 'not a PNG' };
  const colorType = buf[25];
  return { ok: true, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType, alpha: colorType === 6 || (colorType === 3 && buf.includes(Buffer.from('tRNS'))) };
}

function quantisedPosition(j, prim, problems, tag) {
  const pos = j.accessors?.[prim.attributes?.POSITION];
  if (!pos) { problems.push(`${tag}POSITION missing`); return; }
  if (pos.componentType !== 5122 || pos.normalized !== true) problems.push(`${tag}POSITION must be normalized SHORT (KHR_mesh_quantization)`);
  if ([pos.min, pos.max].some((a) => !Array.isArray(a) || a.some((v) => !Number.isInteger(v)))) problems.push(`${tag}POSITION accessor min/max must be the raw stored integers (glTF 2.0: \`normalized\` never applies to min/max)`);
  const nrm = j.accessors?.[prim.attributes?.NORMAL];
  if (!nrm) problems.push(`${tag}NORMAL missing`);
  else if (nrm.componentType !== 5120 || nrm.normalized !== true) problems.push(`${tag}NORMAL must be normalized BYTE`);
  if (prim.indices === undefined) problems.push(`${tag}indices missing`);
  if ((prim.mode ?? 4) !== 4) problems.push(`${tag}primitive mode ${prim.mode} is not TRIANGLES`);
}

function containerProblems(glb, problems) {
  if (!glb.ok) { problems.push(`glb: ${glb.reason}`); return false; }
  const j = glb.json;
  if (j.asset?.version !== '2.0') problems.push(`asset.version ${j.asset?.version} != 2.0`);
  if (!glb.bin) problems.push('no BIN chunk');
  for (const k of ['extensionsRequired', 'extensionsUsed']) if (!(j[k] || []).includes('KHR_mesh_quantization')) problems.push(`KHR_mesh_quantization is not in ${k}`);
  const other = [...new Set([...(j.extensionsUsed || []), ...(j.extensionsRequired || [])])].filter((e) => e !== 'KHR_mesh_quantization');
  if (other.length) problems.push(`only core glTF + KHR_mesh_quantization allowed, found ${other.join(', ')}`);
  return true;
}

/**
 * Deep check of one charm GLB. Never throws: { ok, problems, triangles, vertices, bounds, radius }. The local frame (the
 * spec's "Asset formats"): origin at the centre of the back face, +Z front, die-cut outline diameter 1.0 (so the outline's
 * farthest point from the axis is 0.5), front height `thickness`; one primitive with POSITION / NORMAL / TEXCOORD_0;
 * baseColorTexture (and emissiveTexture) = the relative URI <id>.png, never embedded.
 */
export function inspectCharmGlb(buf, id, { thickness } = {}) {
  const out = { ok: false, problems: [], triangles: 0, vertices: 0, bounds: null, radius: null };
  const glb = readGlb(buf);
  if (!containerProblems(glb, out.problems)) return out;
  const j = glb.json;
  const prims = j.meshes?.[0]?.primitives || [];
  if ((j.meshes || []).length !== 1 || prims.length !== 1) out.problems.push(`expected one mesh with one primitive, got ${(j.meshes || []).length} / ${prims.length}`);
  const prim = prims[0];
  if (!prim) return out;
  quantisedPosition(j, prim, out.problems, '');
  const uv = j.accessors?.[prim.attributes?.TEXCOORD_0];
  if (!uv) out.problems.push('TEXCOORD_0 missing');
  else if (uv.type !== 'VEC2' || !((uv.componentType === 5123 || uv.componentType === 5121) && uv.normalized === true) && uv.componentType !== 5126) out.problems.push('TEXCOORD_0 must be VEC2 normalized unsigned (or float)');
  const mat = j.materials?.[prim.material];
  const texIndex = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
  const src = j.textures?.[texIndex]?.source;
  const imgs = imageRefs(j);
  const img = imgs[src];
  if (texIndex === undefined || !img) out.problems.push('material has no baseColorTexture image');
  else {
    if (!img.external) out.problems.push('texture is embedded; it must be the external relative URI (the page CSP blocks blob: fetches)');
    if (!img.relative || img.uri !== `${id}.png`) out.problems.push(`texture URI ${JSON.stringify(img.uri)} != relative "${id}.png"`);
  }
  if (imgs.length !== 1) out.problems.push(`expected exactly one image, got ${imgs.length}`);
  const ems = mat?.emissiveTexture?.index;
  if (ems !== undefined && j.textures?.[ems]?.source !== src) out.problems.push('emissiveTexture must reuse the base colour image');
  if (mat && (mat.pbrMetallicRoughness?.metallicFactor ?? 1) !== 0) out.problems.push('charm material must not be metallic');
  const acc = (i) => (i === undefined ? null : j.accessors?.[i] || null);
  if (acc(prim.attributes?.POSITION)) out.vertices = acc(prim.attributes.POSITION).count;
  if (acc(prim.indices)) out.triangles = Math.floor(acc(prim.indices).count / 3);
  if (!out.problems.length) {
    try {
      out.bounds = meshBounds(j, glb.bin);
      const node = j.nodes?.[(j.scenes?.[j.scene ?? 0]?.nodes || [0])[0]] || {};
      const s = node.scale || [1, 1, 1], t = node.translation || [0, 0, 0];
      let r = 0;
      for (const p of readAccessor(j, glb.bin, prim.attributes.POSITION)) r = Math.max(r, Math.hypot(p[0] * s[0] + t[0], p[1] * s[1] + t[1]));
      out.radius = r;
      const { min, max } = out.bounds;
      if (Math.abs(r - 0.5) > 0.012) out.problems.push(`outline radius ${r.toFixed(4)} != 0.5 (diameter 1.0)`);
      if (min[2] > 0.001 || min[2] < -0.12) out.problems.push(`back at z ${min[2].toFixed(4)}: the origin must be the centre of the back face`);
      // the pillow reaches `thickness` where the icon is wide; thin parts (a diagonal pen) stay lower, never higher
      if (thickness !== undefined && (max[2] > thickness + 0.01 || max[2] < 0.6 * thickness)) out.problems.push(`front height ${max[2].toFixed(4)} outside 0.6..1 x charm.thickness ${thickness}`);
      if (Math.max(Math.abs(min[0]), Math.abs(max[0]), Math.abs(min[1]), Math.abs(max[1])) > 0.512) out.problems.push('mesh leaves the unit outline circle');
    } catch (err) { out.problems.push(`POSITION data unreadable: ${err.message}`); }
  }
  if (out.triangles < 300 || out.triangles > 1500) out.problems.push(`${out.triangles} triangles outside 300..1500`);
  if (buf.length > DECOR_BUDGETS.charmGlbBytes) out.problems.push(`${buf.length} bytes > charm GLB budget ${DECOR_BUDGETS.charmGlbBytes}`);
  out.ok = out.problems.length === 0;
  return out;
}

/**
 * Deep check of one face kit GLB (model space, placed at identity next to the body): { ok, problems, triangles, parts,
 * bounds }. One primitive per part (extras.part), core PBR colour factors, no textures; the angel's halo is emissive and
 * its blush blends (COLOR_0 alpha).
 */
export function inspectFaceGlb(buf, face) {
  const out = { ok: false, problems: [], triangles: 0, parts: [], bounds: null };
  const glb = readGlb(buf);
  if (!containerProblems(glb, out.problems)) return out;
  const j = glb.json;
  const prims = j.meshes?.[0]?.primitives || [];
  if (!prims.length) { out.problems.push('no primitives'); return out; }
  prims.forEach((p, i) => {
    quantisedPosition(j, p, out.problems, `primitive ${i}: `);
    out.parts.push(p.extras?.part || `#${i}`);
    const idx = j.accessors?.[p.indices];
    if (idx) out.triangles += Math.floor(idx.count / 3);
  });
  if (new Set(out.parts).size !== out.parts.length) out.problems.push('part names repeat');
  if ((j.images || []).length || (j.textures || []).length) out.problems.push('face kits use fixed colours, no textures');
  for (const m of j.materials || []) if (!m.pbrMetallicRoughness?.baseColorFactor) out.problems.push(`material ${m.name} has no baseColorFactor`);
  if (face === 'angel') {
    if (!(j.materials || []).some((m) => Array.isArray(m.emissiveFactor) && m.emissiveFactor.some((v) => v > 0.5))) out.problems.push('angel halo must be emissive');
    if (!(j.materials || []).some((m) => m.alphaMode === 'BLEND')) out.problems.push('angel blush must use alphaMode BLEND');
  }
  if (!out.problems.length) {
    try {
      out.bounds = meshBoundsAll(j, glb.bin);
      const { min, max } = out.bounds;
      if (min[1] < 0.6 || max[1] > 2.3 || Math.abs(min[0]) > 0.75 || Math.abs(max[0]) > 0.75 || Math.abs(min[2]) > 0.7 || Math.abs(max[2]) > 0.7) out.problems.push(`bounds ${JSON.stringify(min.map(R5))}..${JSON.stringify(max.map(R5))} leave the head region of model space`);
    } catch (err) { out.problems.push(`POSITION data unreadable: ${err.message}`); }
  }
  if (buf.length > DECOR_BUDGETS.faceGlbBytes) out.problems.push(`${buf.length} bytes > face GLB budget ${DECOR_BUDGETS.faceGlbBytes}`);
  out.ok = out.problems.length === 0;
  return out;
}

/** Manifest entry (workflow 5.2 fields) for a charm or face kit: the GLB is the runtime file, its PNG the 2D fallback. */
export function decorEntry({ id, group, name, glb, info, pivot }) {
  const { min, max } = info.bounds;
  const runtime = `${RUNTIME[group]}/${name}.glb`;
  const fallback = group === 'charms' ? `${RUNTIME.charms}/${name}.png` : `${RUNTIME.faces}/${name}-front.png`;
  return {
    id, kind: 'model',
    source_file: `${SOURCE_DIR}/${group}/${name}.glb`, source_format: 'glb',
    runtime_file: runtime, runtime_format: 'glb', fallback_file: fallback, fallback_format: 'png',
    version: '1.0.0', checksum: sha256(glb), license: 'internal-original', generator_script: GENERATOR,
    bounds: [R5(max[0] - min[0]), R5(max[1] - min[1]), R5(max[2] - min[2])], pivot,
    triangle_count: info.triangles, texture_memory_bytes: glb.length, lods: [runtime], approved_by: null,
  };
}

/** Programmatic entry point: copies + validates + merges. Returns { ok, problems, warnings, entries, written, built, missing, bytes }. */
export function buildSoulDecor({ root = DEFAULT_ROOT, log = () => {} } = {}) {
  const problems = [], warnings = [], entries = [], written = [], built = [], missing = [];
  const bytes = { charms: 0, faces: 0 };
  const provPath = join(root, SOURCE_DIR, 'provenance.json');
  if (!existsSync(provPath)) return { ok: false, problems: [`${SOURCE_DIR}/provenance.json missing (run npm run ai:soul-decor)`], warnings, entries, written, built, missing, bytes };
  let prov;
  try { prov = JSON.parse(readFileSync(provPath, 'utf8')); } catch (err) { return { ok: false, problems: [`provenance.json unreadable: ${err.message}`], warnings, entries, written, built, missing, bytes }; }
  const cat = readCatalog(root);
  const thickness = prov.charm?.thickness;
  const copies = [];
  // one staged-or-runtime file, verified against provenance.json
  const take = (group, file) => {
    const rec = prov.files?.[`${group}/${file}`];
    const staged = join(root, SOURCE_DIR, group, file), runtime = join(root, RUNTIME[group], file);
    const have = existsSync(staged) ? staged : existsSync(runtime) ? runtime : null;
    if (!have) return null;
    const buf = readFileSync(have);
    if (!rec) { problems.push(`${group}/${file}: not listed in provenance.json`); return null; }
    if (rec.sha256 !== hex(buf)) { problems.push(`${group}/${file}: sha256 differs from provenance.json (rebuild with npm run ai:soul-decor)`); return null; }
    copies.push({ rel: `${RUNTIME[group]}/${file}`, buf });
    return buf;
  };
  for (const ch of cat.charms) {
    const glb = take('charms', `${ch.id}.glb`), png = take('charms', `${ch.id}.png`);
    if (!glb || !png) { if (!glb && !png) missing.push(ch.id); else problems.push(`${ch.id}: GLB and PNG must both exist`); continue; }
    const info = inspectCharmGlb(glb, ch.id, { thickness });
    for (const p of info.problems) problems.push(`charms/${ch.id}.glb: ${p}`);
    const pi = pngInfo(png);
    if (!pi.ok || pi.width !== CHARM_PNG_PX || pi.height !== CHARM_PNG_PX || !pi.alpha) problems.push(`charms/${ch.id}.png: must be a ${CHARM_PNG_PX} px PNG with alpha (got ${pi.ok ? `${pi.width}x${pi.height} type ${pi.colorType}` : pi.reason})`);
    if (png.length > DECOR_BUDGETS.charmPngBytes) problems.push(`charms/${ch.id}.png: ${png.length} bytes > ${DECOR_BUDGETS.charmPngBytes}`);
    bytes.charms += glb.length + png.length;
    if (info.ok) { built.push(ch.id); entries.push(decorEntry({ id: `soul_charm_${ch.id.replace(/-/g, '_')}`, group: 'charms', name: ch.id, glb, info, pivot: [0, 0, 0] })); }
  }
  for (const face of FACES) {
    const glb = take('faces', `face-${face}.glb`), png = take('faces', `face-${face}-front.png`);
    if (!glb || !png) { problems.push(`face kit ${face}: face-${face}.glb and face-${face}-front.png are required`); continue; }
    const info = inspectFaceGlb(glb, face);
    for (const p of info.problems) problems.push(`faces/face-${face}.glb: ${p}`);
    const pi = pngInfo(png);
    if (!pi.ok || pi.width !== FACE_SPRITE_PX || pi.height !== FACE_SPRITE_PX || !pi.alpha) problems.push(`faces/face-${face}-front.png: must be an ${FACE_SPRITE_PX} px PNG with alpha`);
    if (png.length > DECOR_BUDGETS.faceSpriteBytes) problems.push(`faces/face-${face}-front.png: ${png.length} bytes > ${DECOR_BUDGETS.faceSpriteBytes}`);
    bytes.faces += glb.length + png.length;
    if (info.ok) entries.push(decorEntry({ id: `soul_face_${face}`, group: 'faces', name: `face-${face}`, glb, info, pivot: [0, 0, 0] }));
  }
  if (bytes.charms + bytes.faces > DECOR_BUDGETS.decorBytes) problems.push(`decor total ${bytes.charms + bytes.faces} bytes > ${DECOR_BUDGETS.decorBytes}`);
  // stray runtime files (nothing here is deleted: report them)
  const expect = new Set(copies.map((c) => c.rel));
  for (const group of Object.keys(RUNTIME)) {
    const dir = join(root, RUNTIME[group]);
    if (existsSync(dir)) for (const f of readdirSync(dir).sort()) if (!f.startsWith('.') && !expect.has(`${RUNTIME[group]}/${f}`)) problems.push(`${RUNTIME[group]}/${f}: not a built decoration file`);
  }
  // the data module must list exactly these files, with their hashes
  const data = readDecorData(root);
  if (!data) problems.push(`${DATA_MODULE}: unreadable (regenerate with npm run ai:soul-decor -- --mode data)`);
  else {
    if (data.stub !== false || data.version !== 1) problems.push(`${DATA_MODULE}: still the stub (stub ${data.stub}, version ${data.version})`);
    if (data.charm?.thickness !== thickness) problems.push(`${DATA_MODULE}: charm.thickness ${data.charm?.thickness} != provenance ${thickness}`);
    const byRel = new Map(copies.map((c) => [c.rel, c.buf]));
    const urlOk = (url, rel) => { const buf = byRel.get(rel); return !!buf && url === `/${rel}?v=${hex(buf).slice(0, SHA_CHARS)}`; };
    const listed = Object.keys(data.charm?.files || {});
    if (JSON.stringify(listed) !== JSON.stringify(built)) problems.push(`${DATA_MODULE}: charm.files lists ${listed.length} charms, ${built.length} are built (regenerate the data module)`);
    for (const id of listed) {
      const f = data.charm.files[id];
      if (!urlOk(f.glb, `${RUNTIME.charms}/${id}.glb`) || !urlOk(f.png, `${RUNTIME.charms}/${id}.png`)) problems.push(`${DATA_MODULE}: ${id} URL or hash is stale`);
    }
    if (JSON.stringify(data.charm?.missing || []) !== JSON.stringify(missing)) problems.push(`${DATA_MODULE}: charm.missing disagrees with the built files`);
    for (const face of FACES) {
      const f = data.faces?.[face];
      if (!f || !urlOk(f.glb, `${RUNTIME.faces}/face-${face}.glb`) || !urlOk(f.sprite, `${RUNTIME.faces}/face-${face}-front.png`)) problems.push(`${DATA_MODULE}: face ${face} URL or hash is stale`);
    }
    if (!Array.isArray(data.slots) || data.slots.length !== cat.slotCount) problems.push(`${DATA_MODULE}: ${data.slots?.length} slots != ${cat.slotCount}`);
  }
  if (missing.length) warnings.push(`${missing.length} charm(s) not built yet (no icon): ${missing.join(', ')}`);
  if (problems.length) return { ok: false, problems, warnings, entries, written, built, missing, bytes };
  for (const { rel, buf } of copies) {
    const dest = join(root, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (!existsSync(dest) || !readFileSync(dest).equals(buf)) { writeFileSync(dest, buf); written.push(rel); }
  }
  mergeManifest(join(root, MANIFEST), GENERATOR, entries);
  log(`${built.length} charms, ${FACES.length} face kits, ${entries.length} manifest entries; decor ${(bytes.charms / 1024).toFixed(1)} KB charms + ${(bytes.faces / 1024).toFixed(1)} KB faces`);
  return { ok: true, problems, warnings, entries, written, built, missing, bytes };
}

function main() {
  const r = buildSoulDecor({ log: (m) => console.log(`build-soul-decor: ${m}`) });
  for (const w of r.warnings) console.log(`build-soul-decor: warning: ${w}`);
  if (!r.ok) { for (const p of r.problems) console.error(`build-soul-decor: ${p}`); return 1; }
  console.log(`build-soul-decor: ${r.written.length} file(s) written -> ${RUNTIME.charms}/, ${RUNTIME.faces}/`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
