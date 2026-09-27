#!/usr/bin/env node
// tools/assets/build-galaxy-space.js - publishes the big screen's space backdrop (stage 15, D-36, docs/art/scene-spec.md).
// tools/ai/blender/galaxy_space.py renders the plates (the backdrop and five meteors) into assets-src/generated/galaxy-space/
// (git-ignored PNGs); tools/assets/build-galaxy-space.py (the entries' generator_script) packs them into assets/space/ -
// the backdrop JPEG, the constellation lines, the meteors and the falling-star streak as WebP, and space.json - and records
// each file's bytes, sha256 and pixel size in assets-src/generated/galaxy-space/provenance.json. Both need Blender or
// Pillow, so neither runs here: this step checks the committed pack (every file matches provenance.json, nothing extra;
// space.json is version 1 and names exactly the images; JPEG / WebP headers, pixel sizes and alpha; the budgets) and
// merges one entry per file into assets/manifest/assets.yaml. The images are textures, not scene data: they have their
// own budgets here and stay out of the 120 KB scene-data budget of assets/scene/. Deterministic, zero third-party code.
// Usage: node tools/assets/build-galaxy-space.js
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { mergeManifest, sha256 } from './lib/manifest.js';

export const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GENERATOR = 'tools/assets/build-galaxy-space.py';
export const RENDER_SCRIPT = 'tools/ai/blender/galaxy_space.py';
export const SOURCE_DIR = 'assets-src/generated/galaxy-space';
export const RUNTIME = 'assets/space';
export const MANIFEST = 'assets/manifest/assets.yaml';
export const SPACE_BUDGETS = Object.freeze({
  backdropBytes: 160 * 1024,             // backdrop.jpg (the opaque plate, region x overscan)
  layerBytes: 64 * 1024,                 // each WebP layer (constellation lines, meteors, falling star)
  specBytes: 16 * 1024,                  // space.json
  spaceBytes: 320 * 1024,                // everything under assets/space/
  textureBytes: 16 * 1024 * 1024,        // decoded RGBA of every image (art direction: texture memory <= 64 MB in all)
});
const hex = (buf) => createHash('sha256').update(buf).digest('hex');

/** { ok, width, height } of a baseline or progressive JPEG (the first SOFn segment). */
export function jpegInfo(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { ok: false, reason: 'not a JPEG' };
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return { ok: false, reason: 'JPEG marker expected' };
    const m = buf[i + 1];
    if (m === 0xff) { i += 1; continue; }                               // fill byte
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }  // no length
    if (m === 0xd9 || m === 0xda) break;                                // end of image / start of scan before any SOF
    const len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 9 > buf.length) break;
      return { ok: true, width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), progressive: m === 0xc2 };
    }
    i += 2 + len;
  }
  return { ok: false, reason: 'JPEG without a frame header' };
}

/** { ok, width, height, alpha } of a WebP (lossy VP8, lossless VP8L or extended VP8X). */
export function webpInfo(buf) {
  if (!buf || buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return { ok: false, reason: 'not a WebP' };
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const flags = buf[20];
    return { ok: true, width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), alpha: (flags & 0x10) !== 0 };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return { ok: false, reason: 'VP8L signature missing' };
    const b = buf.readUInt32LE(21);
    return { ok: true, width: 1 + (b & 0x3fff), height: 1 + ((b >>> 14) & 0x3fff), alpha: ((b >>> 28) & 1) === 1 };
  }
  if (chunk === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return { ok: false, reason: 'VP8 start code missing' };
    return { ok: true, width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, alpha: false };
  }
  return { ok: false, reason: `unknown WebP chunk ${JSON.stringify(chunk)}` };
}

/** The image files space.json names, in its order: backdrop, constellations, meteors, falling star. */
export function specFiles(spec) {
  const out = [];
  if (spec && spec.backdrop && spec.backdrop.file) out.push(spec.backdrop.file);
  if (spec && spec.constellations && spec.constellations.file) out.push(spec.constellations.file);
  for (const m of (spec && Array.isArray(spec.meteors) ? spec.meteors : [])) if (m && m.file) out.push(m.file);
  if (spec && spec.fallingStars && spec.fallingStars.file) out.push(spec.fallingStars.file);
  return out;
}

const idFor = (file) => `space_${file.replace(/\.[a-z]+$/, '').replace(/-/g, '_')}`;

function entry({ file, buf, kind, format, source, sourceFormat, bounds }) {
  const [w, h] = bounds;
  return {
    id: file === 'space.json' ? 'space_config' : idFor(file), kind,
    source_file: source, source_format: sourceFormat,
    runtime_file: `${RUNTIME}/${file}`, runtime_format: format, fallback_file: null, fallback_format: null,
    version: '1.0.0', checksum: sha256(buf), license: 'internal-original', generator_script: GENERATOR,
    bounds: [w, h, 0], pivot: [w / 2, h / 2, 0], triangle_count: 0, texture_memory_bytes: buf.length, lods: [], approved_by: null,
  };
}

/** Programmatic entry point: checks + merges. Returns { ok, problems, entries, bytes, textureBytes }. */
export function buildGalaxySpace({ root = DEFAULT_ROOT, budgets = SPACE_BUDGETS, log = () => {} } = {}) {
  const problems = [], entries = [];
  let bytes = 0, textureBytes = 0;
  const B = { ...SPACE_BUDGETS, ...budgets };
  const fail = () => ({ ok: false, problems, entries, bytes, textureBytes });
  const provPath = join(root, SOURCE_DIR, 'provenance.json');
  if (!existsSync(provPath)) { problems.push(`${SOURCE_DIR}/provenance.json missing (run python3 ${GENERATOR})`); return fail(); }
  let prov;
  try { prov = JSON.parse(readFileSync(provPath, 'utf8')); } catch (err) { problems.push(`provenance.json unreadable: ${err.message}`); return fail(); }
  const listed = Object.keys((prov && prov.files) || {}).sort();
  const dir = join(root, RUNTIME);
  const present = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')).sort() : [];
  for (const n of present) if (!listed.includes(n)) problems.push(`${RUNTIME}/${n}: not listed in provenance.json (repack with python3 ${GENERATOR})`);
  const bufs = new Map();
  for (const n of listed) {
    const p = join(dir, n);
    if (!existsSync(p)) { problems.push(`${RUNTIME}/${n}: missing`); continue; }
    const buf = readFileSync(p);
    if (prov.files[n].sha256 !== hex(buf) || prov.files[n].bytes !== buf.length) problems.push(`${RUNTIME}/${n}: differs from provenance.json (never hand-edit assets/space; repack with python3 ${GENERATOR})`);
    bufs.set(n, buf);
    bytes += buf.length;
  }
  if (!bufs.has('space.json')) { problems.push(`${RUNTIME}/space.json missing`); return fail(); }
  let spec;
  try { spec = JSON.parse(bufs.get('space.json').toString('utf8')); } catch (err) { problems.push(`space.json unreadable: ${err.message}`); return fail(); }
  if (spec.version !== 1) problems.push(`space.json version ${JSON.stringify(spec.version)} != 1`);
  const region = spec.region || {};
  if (!(region.width > 0 && region.height > 0) || !(spec.overscan >= 1)) problems.push('space.json needs region { width, height } and overscan >= 1');
  const images = specFiles(spec);
  if (new Set(images).size !== images.length) problems.push('space.json names an image twice');
  const packed = listed.filter((n) => n !== 'space.json');
  for (const n of images) if (!packed.includes(n)) problems.push(`space.json names ${n}, which is not in the pack`);
  for (const n of packed) if (!images.includes(n)) problems.push(`${RUNTIME}/${n}: packed but not named by space.json`);
  if (bufs.get('space.json').length > B.specBytes) problems.push(`space.json: ${bufs.get('space.json').length} bytes > ${B.specBytes}`);
  const plate = [Math.round(region.width * spec.overscan), Math.round(region.height * spec.overscan)];
  for (const n of packed) {
    const buf = bufs.get(n);
    if (!buf) continue;
    const isBackdrop = n === (spec.backdrop && spec.backdrop.file);
    const info = /\.jpe?g$/.test(n) ? jpegInfo(buf) : /\.webp$/.test(n) ? webpInfo(buf) : { ok: false, reason: 'only JPEG and WebP are packed' };
    if (!info.ok) { problems.push(`${RUNTIME}/${n}: ${info.reason}`); continue; }
    const px = prov.files[n] && prov.files[n].px;
    if (!Array.isArray(px) || px[0] !== info.width || px[1] !== info.height) problems.push(`${RUNTIME}/${n}: ${info.width}x${info.height} px disagrees with provenance`);
    if (isBackdrop && (info.width !== plate[0] || info.height !== plate[1])) problems.push(`${RUNTIME}/${n}: backdrop ${info.width}x${info.height} != the plate ${plate[0]}x${plate[1]} (region x overscan)`);
    if (!isBackdrop && !info.alpha) problems.push(`${RUNTIME}/${n}: a layer over the backdrop needs alpha`);
    const limit = isBackdrop ? B.backdropBytes : B.layerBytes;
    if (buf.length > limit) problems.push(`${RUNTIME}/${n}: ${buf.length} bytes > ${limit}`);
    textureBytes += info.width * info.height * 4;
    const blender = isBackdrop || /^meteor-/.test(n);
    entries.push(entry({ file: n, buf, kind: 'texture', format: isBackdrop ? 'jpeg' : 'webp', source: blender ? RENDER_SCRIPT : GENERATOR,
      sourceFormat: blender ? 'blender-python' : 'python-pillow', bounds: [info.width, info.height] }));
  }
  entries.push(entry({ file: 'space.json', buf: bufs.get('space.json'), kind: 'data', format: 'json', source: GENERATOR, sourceFormat: 'python-parameters',
    bounds: [region.width || 0, region.height || 0] }));
  if (bytes > B.spaceBytes) problems.push(`${RUNTIME}/: ${bytes} bytes > ${B.spaceBytes}`);
  if (textureBytes > B.textureBytes) problems.push(`${RUNTIME}/: ${textureBytes} bytes of decoded texture > ${B.textureBytes}`);
  if (problems.length) return fail();
  mergeManifest(join(root, MANIFEST), GENERATOR, entries);
  log(`${packed.length} images + space.json: ${entries.length} manifest entries, ${(bytes / 1024).toFixed(1)} KB (${(textureBytes / 1048576).toFixed(1)} MB decoded)`);
  return { ok: true, problems, entries, bytes, textureBytes };
}

function main() {
  const r = buildGalaxySpace({ log: (m) => console.log(`build-galaxy-space: ${m}`) });
  if (!r.ok) { for (const p of r.problems) console.error(`build-galaxy-space: ${p}`); return 1; }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
