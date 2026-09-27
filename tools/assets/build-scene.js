#!/usr/bin/env node
// Generates the Arise Galaxy scene data: star field layers, nebula gradient sheet, orbit rings, scene config, the sticker
// doodad sprite sheet (from packages/ui/doodads.js) + manifest entries.
// Deterministic from assets-src/scene/scene-params.json (+ doodads.js). Never hand-edit assets/scene/**.
// Usage: node tools/assets/build-scene.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { ORBIT_RINGS, ORBIT_CAPACITY, hash32, PALETTES } from '../../packages/ui/soul-renderer.js';
import { doodadSpriteSheet, DOODAD_NAMES, DOODAD_VIEWBOX, DOODADS_VERSION } from '../../packages/ui/doodads.js';
import { mergeManifest, fileChecksum, fileSize, writeIfChanged } from './lib/manifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATOR = 'tools/assets/build-scene.js';
const VERSION = '1.0.0';
const OUT = join(ROOT, 'assets', 'scene');
const MANIFEST = join(ROOT, 'assets', 'manifest', 'assets.yaml');
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const P = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'scene', 'scene-params.json'), 'utf8'));

/** Deterministic float generator in [0,1) from (seed, index, salt). */
const rnd = (seed, i, salt) => hash32(`${seed}:${i}:${salt}`) / 4294967296;
const r3 = (v) => Math.round(v * 1000) / 1000;

const entries = [];
function entry(id, kind, path, extra = {}) {
  entries.push({
    id, kind, source_file: 'assets-src/scene/scene-params.json', source_format: 'json-parameters',
    runtime_file: rel(path), runtime_format: path.endsWith('.svg') ? 'svg' : 'json', fallback_file: null, fallback_format: null,
    version: VERSION, checksum: fileChecksum(path), license: 'internal-original', generator_script: GENERATOR,
    bounds: [P.canvas.width, P.canvas.height, 0], pivot: [P.canvas.width / 2, P.canvas.height / 2, 0], triangle_count: 0,
    texture_memory_bytes: fileSize(path), lods: [], approved_by: null, ...extra,
  });
}

// ---- Star field: 3 parallax layers, normalised coordinates over the Galaxy viewport (left 65 %) ----
P.starLayers.forEach((L, li) => {
  const stars = [];
  for (let i = 0; i < L.count; i++) {
    stars.push({
      x: r3(rnd(P.seed, i, `x${li}`)), y: r3(rnd(P.seed, i, `y${li}`)),
      r: r3(L.minRadius + rnd(P.seed, i, `r${li}`) * (L.maxRadius - L.minRadius)),
      b: r3(L.minBrightness + rnd(P.seed, i, `b${li}`) * (L.maxBrightness - L.minBrightness)),
      t: r3(rnd(P.seed, i, `t${li}`)), // twinkle phase 0..1 (ignored in reduced motion)
    });
  }
  const layer = { layer: li + 1, name: L.name, parallax: L.parallax, twinkleAmplitude: L.twinkleAmplitude, twinklePeriodSeconds: L.twinklePeriodSeconds, color: L.color, seed: P.seed, count: stars.length, coordinateSpace: 'normalised 0..1 over the Galaxy viewport (left 65 % of the public screen); y down', stars };
  const path = join(OUT, `starfield-layer-${li + 1}.json`);
  writeIfChanged(path, JSON.stringify(layer) + '\n');
  entry(`scene_starfield_layer_${li + 1}`, 'data', path);
});

// ---- Nebula: soft radial gradients on the Galaxy viewport; nothing crosses the safe zone ----
const W = P.canvas.width, H = P.canvas.height;
const galaxyW = Math.round(W * P.safeZone.galaxyFraction);
const blobs = P.nebula.blobs.map((b, i) => `<radialGradient id="neb${i}" cx="${b.cx}" cy="${b.cy}" r="${b.r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${b.color}" stop-opacity="${b.opacity}"/><stop offset=".55" stop-color="${b.color}" stop-opacity="${r3(b.opacity * 0.35)}"/><stop offset="1" stop-color="${b.color}" stop-opacity="0"/></radialGradient>`).join('');
const rects = P.nebula.blobs.map((b, i) => `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="url(#neb${i})"/>`).join('');
const rings = ORBIT_RINGS.map((r) => `<ellipse cx="${galaxyW / 2}" cy="${H / 2}" rx="${r3((H / 2) * r.radius * P.orbit.aspect)}" ry="${r3((H / 2) * r.radius)}" fill="none" stroke="${P.orbit.color}" stroke-width="1" stroke-opacity="${P.orbit.opacity}" stroke-dasharray="4 10"/>`).join('');
const nebula = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${galaxyW} ${H}" width="${galaxyW}" height="${H}" role="presentation" aria-hidden="true" data-generator="${GENERATOR}"><defs><clipPath id="galaxy"><rect width="${galaxyW}" height="${H}"/></clipPath>${blobs}</defs><g clip-path="url(#galaxy)"><rect width="${galaxyW}" height="${H}" fill="${P.background}"/>${rects}${rings}</g></svg>\n`;
const nebPath = join(OUT, 'nebula.svg');
writeIfChanged(nebPath, nebula);
entry('scene_nebula', 'sprite', nebPath, { bounds: [galaxyW, H, 0], pivot: [galaxyW / 2, H / 2, 0] });

// ---- Orbit rings ----
const orbit = {
  source: 'packages/ui/soul-renderer.js#ORBIT_RINGS', radiusUnit: 'fraction of Galaxy half-height', aspect: P.orbit.aspect,
  totalCapacity: ORBIT_CAPACITY, clusterAbove: P.orbit.clusterAbove, angularSpeedRadPerSec: P.orbit.angularSpeedRadPerSec, driftAmplitude: P.orbit.driftAmplitude,
  float: P.orbit.float,
  rings: ORBIT_RINGS.map((r) => ({ ...r, angularSpeedRadPerSec: r3(P.orbit.angularSpeedRadPerSec * (1 - r.ring * 0.06)) })),
};
const orbitPath = join(OUT, 'orbit-rings.json');
writeIfChanged(orbitPath, JSON.stringify(orbit, null, 2) + '\n');
entry('scene_orbit_rings', 'data', orbitPath);

// ---- Scene config ----
const config = {
  version: VERSION, generator: GENERATOR, background: P.background, canvas: P.canvas,
  safeZone: { ...P.safeZone, galaxyWidthPx: galaxyW, panelX: galaxyW, panelWidthPx: W - galaxyW, rule: 'No glow, particle, Soul, nebula or ring pixel may be drawn at x >= panelX. Renderers clip the Galaxy viewport to [0, galaxyWidthPx).' },
  camera: P.camera, entrance: P.entrance, lod: P.lod, performance: P.performance, reducedMotion: P.reducedMotion, fallback: P.fallback, budgets: P.budgets,
  soulPalettes: PALETTES.map((p) => p.name), orbit: { file: 'assets/scene/orbit-rings.json', totalCapacity: ORBIT_CAPACITY, clusterAbove: P.orbit.clusterAbove },
  starfield: P.starLayers.map((L, i) => ({ file: `assets/scene/starfield-layer-${i + 1}.json`, parallax: L.parallax, count: L.count })),
};
const cfgPath = join(OUT, 'scene-config.json');
writeIfChanged(cfgPath, JSON.stringify(config, null, 2) + '\n');
entry('scene_config', 'data', cfgPath);

// ---- Sticker doodads (art direction v2): sprite sheet generated from packages/ui/doodads.js so sprite == procedural fallback ----
const doodadPath = join(OUT, 'doodads.svg');
writeIfChanged(doodadPath, doodadSpriteSheet());
entry('scene_doodads', 'sprite', doodadPath, {
  source_file: 'packages/ui/doodads.js', source_format: 'js-procedural', version: DOODADS_VERSION,
  fallback_file: null, fallback_format: null, // fallback is the procedural doodadSvg() in the same module
  bounds: [DOODAD_VIEWBOX, DOODAD_VIEWBOX, 0], pivot: [DOODAD_VIEWBOX / 2, DOODAD_VIEWBOX / 2, 0],
  lods: [],
});

mergeManifest(MANIFEST, GENERATOR, entries);
console.log(`build-scene: ${entries.length} files (incl. ${DOODAD_NAMES.length} doodad symbols) -> ${rel(OUT)}; manifest ${rel(MANIFEST)}`);
