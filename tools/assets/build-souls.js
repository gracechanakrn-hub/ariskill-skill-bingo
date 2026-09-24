#!/usr/bin/env node
// Generates the neutral Arise Soul test cohort + fallbacks + thumbnails + contact sheet, and writes manifest entries.
// Deterministic: running twice yields byte-identical files. Never hand-edit assets/souls/**.
// Usage: node tools/assets/build-souls.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { renderSoulSvg, soulAltText, resolveSoul, TRAITS, PALETTES, SOUL_RENDERER_VERSION } from '../../packages/ui/soul-renderer.js';
import { soulSeed, soulConfigFromSeed, validateSoulConfig, SOUL_TRAITS } from '../../packages/game-rules/src/soul.js';
import { seededRng } from '../../packages/game-rules/src/random.js';
import { mergeManifest, fileChecksum, fileSize, writeIfChanged } from './lib/manifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GENERATOR = 'tools/assets/build-souls.js';
const VERSION = '2.0.0'; // v2 sticker language (docs/art/sticker-art-direction.md, D-25)
const OUT = join(ROOT, 'assets', 'souls');
const SRC = join(ROOT, 'assets-src', 'souls');
const MANIFEST = join(ROOT, 'assets', 'manifest', 'assets.yaml');
const rel = (p) => relative(ROOT, p).split('\\').join('/');

// Locked vocabularies must agree between game-rules and the renderer.
for (const k of Object.keys(SOUL_TRAITS)) {
  if (JSON.stringify(SOUL_TRAITS[k]) !== JSON.stringify(TRAITS[k])) throw new Error(`trait vocabulary mismatch for ${k}`);
}

const cohortParams = JSON.parse(readFileSync(join(SRC, 'cohort.json'), 'utf8'));
const skillMaster = JSON.parse(readFileSync(join(ROOT, 'packages', 'skill-master', 'data', 'skill-master.json'), 'utf8'));
const DOMAINS = [...new Set(skillMaster.skills.map((s) => s.domain))].sort();

/** Cohort member i: seed from a neutral synthetic identity; domain counts drawn from the Skill Master domain list only. */
function cohortMember(i) {
  const participantId = `${cohortParams.participantPrefix}${String(i + 1).padStart(2, '0')}`;
  const seed = soulSeed({ eventId: cohortParams.eventId, participantId, roundId: cohortParams.roundId });
  const rng = seededRng(`${seed}:domains`);
  const counts = {};
  const k = 2 + rng.int(4); // 2..5 domains represented
  for (let d = 0; d < k; d++) counts[DOMAINS[rng.int(DOMAINS.length)]] = 1 + rng.int(12);
  const config = soulConfigFromSeed(seed, counts);
  const v = validateSoulConfig(config);
  if (!v.ok) throw new Error(`cohort member ${participantId} invalid: ${v.reason}`);
  const badge = cohortParams.badgeMembers.includes(i + 1) ? 'bingo-star' : null; // cosmetic review only
  return { index: i + 1, participantId, seed, config, badge };
}

const members = Array.from({ length: cohortParams.size }, (_, i) => cohortMember(i));
const written = [];
const entries = [];

function emit(subpath, content) {
  const path = join(OUT, subpath);
  writeIfChanged(path, content);
  written.push(path);
  return path;
}

for (const m of members) {
  const full = emit(`cohort/${m.seed}.svg`, renderSoulSvg(m.config, { size: 160, badge: m.badge, detail: 'full', idPrefix: `s${m.seed}` }) + '\n');
  const simple = emit(`fallback/${m.seed}-simple.svg`, renderSoulSvg(m.config, { size: 96, badge: m.badge, detail: 'simple', reducedMotion: true, idPrefix: `s${m.seed}` }) + '\n');
  const dot = emit(`fallback/${m.seed}-dot.svg`, renderSoulSvg(m.config, { size: 24, detail: 'dot', reducedMotion: true, idPrefix: `s${m.seed}` }) + '\n');
  const thumb = emit(`thumbnails/${m.seed}-64.svg`, renderSoulSvg(m.config, { size: 64, badge: m.badge, detail: 'full', reducedMotion: true, idPrefix: `t${m.seed}` }) + '\n');
  entries.push({
    id: `soul_cohort_${String(m.index).padStart(2, '0')}_${m.seed}`, kind: 'sprite',
    source_file: 'assets-src/souls/cohort.json', source_format: 'json-parameters',
    runtime_file: rel(full), runtime_format: 'svg',
    fallback_file: rel(simple), fallback_format: 'svg',
    version: VERSION, checksum: fileChecksum(full), license: 'internal-original', generator_script: GENERATOR,
    bounds: [200, 200, 0], pivot: [100, 112, 0], triangle_count: 0, texture_memory_bytes: fileSize(full),
    lods: [rel(full), rel(simple), rel(dot), rel(thumb)], approved_by: null,
  });
}

// Cohort record (review + downstream tests). Excludes anything but seed/config/badge.
const cohortRecord = {
  rendererVersion: SOUL_RENDERER_VERSION, generator: GENERATOR, version: VERSION,
  members: members.map((m) => ({ index: m.index, seed: m.seed, badge: m.badge, config: m.config, alt: soulAltText(m.config, m.badge) })),
};
const cohortPath = emit('cohort.json', JSON.stringify(cohortRecord, null, 2) + '\n');
entries.push({
  id: 'soul_cohort_index', kind: 'data', source_file: 'assets-src/souls/cohort.json', source_format: 'json-parameters',
  runtime_file: rel(cohortPath), runtime_format: 'json', fallback_file: null, fallback_format: null,
  version: VERSION, checksum: fileChecksum(cohortPath), license: 'internal-original', generator_script: GENERATOR,
  bounds: [0, 0, 0], pivot: [0, 0, 0], triangle_count: 0, texture_memory_bytes: fileSize(cohortPath), lods: [], approved_by: null,
});

// ---- Contact sheet (static review page; uses inline SVG so it works from file://) ----
function traitRow(kind, base) {
  return TRAITS[kind].map((name, i) => {
    const cfg = { ...base, [kind]: i, seed: `row-${kind}-${i}` };
    return `<figure><div class="sp">${renderSoulSvg(cfg, { size: 112, detail: 'full', reducedMotion: true, idPrefix: `r-${kind}-${i}` })}</div><figcaption>${kind}: ${name}</figcaption></figure>`;
  }).join('');
}
const base = { body: 0, palette: 1, eyes: 0, antenna: 0, mouth: 0, glow: 0, constellation: [], driftPhase: 0 };
const cohortCards = members.map((m) => {
  const s = resolveSoul(m.config);
  return `<figure><div class="sp">${renderSoulSvg(m.config, { size: 150, badge: m.badge, detail: 'full', reducedMotion: true, idPrefix: `c${m.seed}` })}</div>` +
    `<figcaption><b>#${String(m.index).padStart(2, '0')}</b> ${s.palette} ${s.body}<br><span class="muted">${s.eyes} / ${s.antenna} / ${s.mouth} / ${s.glow}${m.badge ? ' / badge' : ''}</span><br><code>${m.seed}</code></figcaption></figure>`;
}).join('');
const lodCards = members.slice(0, 6).map((m) => `<figure><div class="sp lod">${renderSoulSvg(m.config, { size: 120, badge: m.badge, idPrefix: `l1${m.seed}`, reducedMotion: true })}${renderSoulSvg(m.config, { size: 72, badge: m.badge, detail: 'simple', idPrefix: `l2${m.seed}` })}${renderSoulSvg(m.config, { size: 28, detail: 'dot', idPrefix: `l3${m.seed}` })}</div><figcaption>full / simple / dot</figcaption></figure>`).join('');
const paletteRow = PALETTES.map((p, i) => `<figure><div class="sp">${renderSoulSvg({ ...base, palette: i, body: i % 6, eyes: i % 6, antenna: i % 6, seed: `pal-${i}` }, { size: 112, reducedMotion: true, idPrefix: `p${i}` })}</div><figcaption>palette: ${p.name}</figcaption></figure>`).join('');

const sheet = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Arise Soul cohort sheet</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark}body{margin:0;background:#0B1030;color:#F2F4FF;font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;color:#B4BCE0;text-transform:uppercase;letter-spacing:.08em}
p{color:#B4BCE0;margin:0 0 12px;max-width:80ch}.grid{display:flex;flex-wrap:wrap;gap:12px}
figure{margin:0;width:160px;background:#121833;border:1px solid #2A3560;border-radius:12px;padding:8px;text-align:center}
.sp{display:flex;justify-content:center;align-items:flex-end;gap:6px}figcaption{font-size:12px;margin-top:6px}code{font-size:10px;color:#8F9AC6}.muted{color:#B4BCE0}
.lod svg{display:inline-block}
</style></head><body>
<h1>Arise Soul v2 (sticker language) - neutral test cohort (${members.length} seeds)</h1>
<p>Generated by <code>${GENERATOR}</code> (renderer ${SOUL_RENDERER_VERSION}). Sticker language v2: clay gradient body, peach rim, seeded speckles, lit antenna orb, white die-cut + shadow (docs/art/sticker-art-direction.md). Review checklist: every Soul is the same size and brightness range; no trait reads as rank, status, skin tone, gender or body size; badges are small and never cover the face. Seeds come from synthetic identities; Platform/Role are not inputs.</p>
<h2>Cohort</h2><div class="grid">${cohortCards}</div>
<h2>Bodies</h2><div class="grid">${traitRow('body', base)}</div>
<h2>Eyes</h2><div class="grid">${traitRow('eyes', base)}</div>
<h2>Antenna</h2><div class="grid">${traitRow('antenna', base)}</div>
<h2>Mouth</h2><div class="grid">${traitRow('mouth', base)}</div>
<h2>Glow</h2><div class="grid">${traitRow('glow', base)}</div>
<h2>Palettes</h2><div class="grid">${paletteRow}</div>
<h2>Level of detail</h2><div class="grid">${lodCards}</div>
</body></html>
`;
const sheetPath = emit('sheet.html', sheet);
entries.push({
  id: 'soul_cohort_sheet', kind: 'review-page', source_file: 'assets-src/souls/cohort.json', source_format: 'json-parameters',
  runtime_file: rel(sheetPath), runtime_format: 'html', fallback_file: null, fallback_format: null,
  version: VERSION, checksum: fileChecksum(sheetPath), license: 'internal-original', generator_script: GENERATOR,
  bounds: [0, 0, 0], pivot: [0, 0, 0], triangle_count: 0, texture_memory_bytes: fileSize(sheetPath), lods: [], approved_by: null,
});

mergeManifest(MANIFEST, GENERATOR, entries);
console.log(`build-souls: ${members.length} cohort members, ${written.length} files, ${entries.length} manifest entries -> ${rel(MANIFEST)}`);
