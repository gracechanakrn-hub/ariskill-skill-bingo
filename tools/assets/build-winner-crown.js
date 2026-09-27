#!/usr/bin/env node
// tools/assets/build-winner-crown.js - publishes the Bingo winner's gold crown (stage 15, D-36) as a runtime asset.
// tools/ai/blender/winner_crown.py (the entry's generator_script) rebuilds the approved code-built draft of
// packages/ui/soul3d/winner.js in Blender and writes assets-src/generated/winner/crown.glb: the crown in its own frame
// (origin at the centre of the band's base, +Y up, +Z front; winner.js places it on the head), in the face-kit GLB format
// (KHR_mesh_quantization, raw-integer POSITION min/max, one primitive per material), gold / ruby / sapphire core PBR, no
// textures and no white die-cut. This step checks it (the face-kit checks of build-soul-decor.js inspectFaceGlb, except
// the kits' head region and budget, plus the crown's node, materials, frame and budget), copies it byte for byte to
// assets/souls/winner/crown.glb and merges one `kind: model` entry (soul_winner_crown) into assets/manifest/assets.yaml.
// There is no 2D fallback file: if the model fails to load, winner.js draws the procedural crown. Deterministic, zero
// third-party code.
// Usage: node tools/assets/build-winner-crown.js
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';
import { mergeManifest, sha256 } from './lib/manifest.js';
import { readGlb } from './lib/glb.js';
import { inspectFaceGlb } from './build-soul-decor.js';

export const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GENERATOR = 'tools/ai/blender/winner_crown.py';
export const SOURCE = 'assets-src/generated/winner/crown.glb';
export const RUNTIME = 'assets/souls/winner/crown.glb';
export const MANIFEST = 'assets/manifest/assets.yaml';
export const ID = 'soul_winner_crown';
export const NODE = 'winner-crown';
/** Budget for the crown GLB (stage 15 target; the file is about 33 KB). */
export const CROWN_GLB_BYTES = 40 * 1024;
/** The approved materials (winner.js draft, sRGB hex as authored). glTF stores linear factors, emissive = colour x strength. */
export const CROWN_MATERIALS = Object.freeze({
  gold: Object.freeze({ base: '#F6C453', metallic: 0.85, roughness: 0.3, emissive: '#7A5410', strength: 0.35 }),
  ruby: Object.freeze({ base: '#E0356B', metallic: 0.2, roughness: 0.15, emissive: '#5A0A22', strength: 0.6 }),
  sapphire: Object.freeze({ base: '#4D7DFF', metallic: 0.2, roughness: 0.15, emissive: '#0D1E66', strength: 0.6 }),
});
/** The crown's own frame: the band's base at y 0, its jewels about 0.29 above, x and z inside the head's width. */
export const CROWN_FRAME = Object.freeze({ min: Object.freeze([-0.45, 0, -0.45]), max: Object.freeze([0.45, 0.3, 0.45]) });
export const FACTOR_TOLERANCE = 0.01;
const R5 = (v) => Number(Number(v).toFixed(5));

/** sRGB hex -> linear [r, g, b] (glTF colour factors are linear). */
export function hexLinear(hex) {
  const h = String(hex).replace(/^#/, '');
  return [0, 2, 4].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
}

/** The glTF factors a CROWN_MATERIALS entry should export as: { base: [r, g, b, 1], metallic, roughness, emissive: [r, g, b] }. */
export function expectedFactors(spec) {
  return {
    base: [...hexLinear(spec.base), 1], metallic: spec.metallic, roughness: spec.roughness,
    emissive: hexLinear(spec.emissive).map((c) => Math.min(1, Math.max(0, c * spec.strength))),
  };
}

const near = (a, b, tol = FACTOR_TOLERANCE) => Array.isArray(a) && a.length === b.length && a.every((v, i) => typeof v === 'number' && Math.abs(v - b[i]) <= tol);

/** The CROWN_MATERIALS key whose base colour matches a glTF material (within FACTOR_TOLERANCE), or null. */
export function materialKey(mat) {
  const base = mat?.pbrMetallicRoughness?.baseColorFactor;
  return Object.keys(CROWN_MATERIALS).find((k) => near(base, expectedFactors(CROWN_MATERIALS[k]).base)) || null;
}

/**
 * Deep check of the crown GLB. Never throws: { ok, problems, triangles, parts, bounds, materials: { key: materialIndex } }.
 * The face-kit format (inspectFaceGlb: glTF 2.0 + BIN, KHR_mesh_quantization only, normalized SHORT POSITION with
 * raw-integer min/max, normalized BYTE NORMAL, indices, TRIANGLES, one primitive per part, no textures), then the crown's
 * own rules: one root node "winner-crown" with the mesh and no transform (positions are model units, the runtime places
 * the node), exactly the gold / ruby / sapphire materials, opaque and single-sided, the crown's frame and budget.
 */
export function inspectCrownGlb(buf) {
  const info = inspectFaceGlb(buf, 'crown');
  // the face kits' own rules: they sit on the head in model space and have a larger budget; the crown has its frame and budget
  const out = { ok: false, problems: info.problems.filter((p) => !p.includes('head region') && !p.includes('face GLB budget')), triangles: info.triangles, parts: info.parts, bounds: info.bounds, materials: {} };
  const glb = readGlb(buf);
  if (glb.ok) {
    const j = glb.json;
    const roots = j.scenes?.[j.scene ?? 0]?.nodes || [];
    const node = j.nodes?.[roots[0]];
    if (roots.length !== 1 || (j.nodes || []).length !== 1) out.problems.push(`expected one node, the scene root; got ${(j.nodes || []).length} node(s), ${roots.length} root(s)`);
    else if (node?.name !== NODE || node.mesh !== 0) out.problems.push(`the root node must be "${NODE}" with mesh 0, got ${JSON.stringify(node?.name)} / mesh ${node?.mesh}`);
    else if (['translation', 'rotation', 'scale', 'matrix'].some((k) => k in node)) out.problems.push(`node "${NODE}" must have no transform (positions are model units; the runtime places the node)`);
    // GLTFLoader gives the scene its name before the nodes: a scene called winner-crown would rename the node winner-crown_1
    if (j.scenes?.[j.scene ?? 0]?.name === NODE) out.problems.push(`the scene must not be named "${NODE}" (GLTFLoader would rename the node "${NODE}_1")`);
    if ((j.meshes || []).length !== 1) out.problems.push(`expected one mesh, got ${(j.meshes || []).length}`);
    const mats = j.materials || [];
    if (mats.length !== 3) out.problems.push(`expected the 3 crown materials, got ${mats.length}`);
    mats.forEach((m, i) => {
      const key = materialKey(m);
      if (!key) { out.problems.push(`material ${i} (${m.name}): base colour ${JSON.stringify(m.pbrMetallicRoughness?.baseColorFactor)} is not gold, ruby or sapphire`); return; }
      if (key in out.materials) out.problems.push(`materials ${out.materials[key]} and ${i} are both ${key}`);
      out.materials[key] = i;
      const want = expectedFactors(CROWN_MATERIALS[key]), pb = m.pbrMetallicRoughness;
      if (!near([pb.metallicFactor ?? 1, pb.roughnessFactor ?? 1], [want.metallic, want.roughness])) out.problems.push(`${key}: metallic / roughness ${pb.metallicFactor} / ${pb.roughnessFactor} != ${want.metallic} / ${want.roughness}`);
      if (!near(m.emissiveFactor || [0, 0, 0], want.emissive)) out.problems.push(`${key}: emissiveFactor ${JSON.stringify(m.emissiveFactor)} != ${JSON.stringify(want.emissive.map(R5))}`);
      if ((m.alphaMode ?? 'OPAQUE') !== 'OPAQUE' || m.doubleSided === true) out.problems.push(`${key}: must be opaque and single-sided`);
      if (m.extensions && Object.keys(m.extensions).length) out.problems.push(`${key}: core PBR only, found ${Object.keys(m.extensions).join(', ')}`);
    });
    for (const k of Object.keys(CROWN_MATERIALS)) if (!(k in out.materials)) out.problems.push(`no ${k} material`);
    (j.meshes?.[0]?.primitives || []).forEach((p, i) => {
      const key = materialKey(mats[p.material]);
      if (p.extras?.part !== key) out.problems.push(`primitive ${i}: part ${JSON.stringify(p.extras?.part)} uses the ${key} material`);
    });
  }
  if (out.bounds) {
    const { min, max } = out.bounds;
    if (Math.abs(min[1]) > 0.001) out.problems.push(`the band's base is at y ${R5(min[1])}: the origin must be the centre of the band's base`);
    if ([0, 1, 2].some((k) => min[k] < CROWN_FRAME.min[k] - 1e-9 || max[k] > CROWN_FRAME.max[k] + 1e-9)) out.problems.push(`bounds ${JSON.stringify(min.map(R5))}..${JSON.stringify(max.map(R5))} leave the crown's frame ${JSON.stringify(CROWN_FRAME.min)}..${JSON.stringify(CROWN_FRAME.max)}`);
  }
  if (!(out.triangles > 0)) out.problems.push('no triangles');
  if (buf.length > CROWN_GLB_BYTES) out.problems.push(`${buf.length} bytes > crown GLB budget ${CROWN_GLB_BYTES}`);
  out.ok = out.problems.length === 0;
  return out;
}

/** Manifest entry (workflow 5.2 fields), filled like the face kits' (build-soul-face.js faceEntry); no 2D fallback file. */
export function crownEntry({ glb, info }) {
  const { min, max } = info.bounds;
  return {
    id: ID, kind: 'model',
    source_file: SOURCE, source_format: 'glb',
    runtime_file: RUNTIME, runtime_format: 'glb', fallback_file: null, fallback_format: null,
    version: '1.0.0', checksum: sha256(glb), license: 'internal-original', generator_script: GENERATOR,
    bounds: [R5(max[0] - min[0]), R5(max[1] - min[1]), R5(max[2] - min[2])], pivot: [0, 0, 0],
    triangle_count: info.triangles, texture_memory_bytes: glb.length, lods: [RUNTIME], approved_by: null,
  };
}

/** Programmatic entry point: checks + copies + merges. Returns { ok, problems, entry, written, bytes }. */
export function buildWinnerCrown({ root = DEFAULT_ROOT, log = () => {} } = {}) {
  const problems = [], written = [];
  const src = join(root, SOURCE);
  if (!existsSync(src)) return { ok: false, problems: [`${SOURCE} missing (run: Blender -b --factory-startup -P ${GENERATOR})`], entry: null, written, bytes: 0 };
  const glb = readFileSync(src);
  const info = inspectCrownGlb(glb);
  for (const p of info.problems) problems.push(`${SOURCE}: ${p}`);
  // stray runtime files (nothing is deleted: report them)
  const dir = posix.dirname(RUNTIME);
  if (existsSync(join(root, dir))) for (const f of readdirSync(join(root, dir)).sort()) if (!f.startsWith('.') && `${dir}/${f}` !== RUNTIME) problems.push(`${dir}/${f}: not a built winner file`);
  if (problems.length) return { ok: false, problems, entry: null, written, bytes: glb.length };
  const dest = join(root, RUNTIME);
  mkdirSync(dirname(dest), { recursive: true });
  if (!existsSync(dest) || !readFileSync(dest).equals(glb)) { writeFileSync(dest, glb); written.push(RUNTIME); }
  const entry = crownEntry({ glb, info });
  mergeManifest(join(root, MANIFEST), GENERATOR, [entry]);
  log(`${ID}: ${info.triangles} triangles, ${(glb.length / 1024).toFixed(1)} KB, bounds ${JSON.stringify(entry.bounds)}`);
  return { ok: true, problems, entry, written, bytes: glb.length };
}

function main() {
  const r = buildWinnerCrown({ log: (m) => console.log(`build-winner-crown: ${m}`) });
  if (!r.ok) { for (const p of r.problems) console.error(`build-winner-crown: ${p}`); return 1; }
  console.log(`build-winner-crown: ${r.written.length} file(s) written -> ${posix.dirname(RUNTIME)}/`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
