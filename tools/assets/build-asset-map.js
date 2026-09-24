#!/usr/bin/env node
// tools/assets/build-asset-map.js - generates packages/ui/asset-map.js, the frozen typed asset map every client imports.
// Deterministic: derived only from assets/manifest/assets.yaml, assets/manifest/audio.json (+ audio.yaml hash) and
// assets/scene/scene-config.json (embedded as the built-in scene defaults). No timestamps. Zero third-party code.
//
// Usage: node tools/assets/build-asset-map.js [--check] [--out <file>] [--root <dir>]
//   --check   regenerate in memory and exit 1 when packages/ui/asset-map.js differs (nothing is written)
//   --out     write to another path (used by tests to compare against the committed file)
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest } from './lib/manifest.js';

export const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ASSET_MAP_PATH = 'packages/ui/asset-map.js';
export const GENERATOR = 'tools/assets/build-asset-map.js';
export const APPS = Object.freeze(['participant', 'admin', 'public', 'stage']);
export const MANIFEST_PATHS = Object.freeze(['assets/manifest/assets.yaml', 'assets/manifest/audio.yaml', 'assets/manifest/audio.json']);

const hex = (buf) => createHash('sha256').update(buf).digest('hex');
const stripPrefix = (s) => String(s || '').replace(/^sha256:/, '');
const toUrl = (relPath) => (relPath == null ? null : '/' + String(relPath).replace(/^\.?\//, ''));

/** Build the plain data model (an ordinary object; freezing happens in the generated module). */
export function buildAssetMapModel({ root = DEFAULT_ROOT } = {}) {
  const read = (p) => readFileSync(join(root, p));
  const assetsYamlText = read('assets/manifest/assets.yaml').toString('utf8');
  const audioJsonText = read('assets/manifest/audio.json').toString('utf8');
  const audioYamlText = existsSync(join(root, 'assets/manifest/audio.yaml')) ? read('assets/manifest/audio.yaml').toString('utf8') : '';
  const assets = parseManifest(assetsYamlText);
  const audio = JSON.parse(audioJsonText);
  const byId = new Map(assets.entries.map((e) => [e.id, e]));
  const need = (id) => { const e = byId.get(id); if (!e) throw new Error(`asset-map: manifest entry ${id} is missing from assets.yaml`); return e; };

  // ---- scene ----
  const starfieldIds = assets.entries.filter((e) => /^scene_starfield_layer_\d+$/.test(e.id)).map((e) => e.id)
    .sort((a, b) => Number(a.match(/(\d+)$/)[1]) - Number(b.match(/(\d+)$/)[1]));
  const sceneConfigEntry = need('scene_config');
  const sceneDefaults = JSON.parse(read(sceneConfigEntry.runtime_file).toString('utf8'));
  const scene = {
    config: toUrl(sceneConfigEntry.runtime_file),
    nebula: toUrl(need('scene_nebula').runtime_file),
    starfield: starfieldIds.map((id) => toUrl(need(id).runtime_file)),
    orbitRings: toUrl(need('scene_orbit_rings').runtime_file),
    sha256: {
      config: stripPrefix(sceneConfigEntry.checksum), nebula: stripPrefix(need('scene_nebula').checksum),
      orbitRings: stripPrefix(need('scene_orbit_rings').checksum), starfield: starfieldIds.map((id) => stripPrefix(need(id).checksum)),
    },
    // Built-in defaults: the generated scene-config.json embedded verbatim, used when the fetch fails (fallback rule).
    defaults: sceneDefaults,
  };

  // ---- souls ----
  const soulEntries = assets.entries.filter((e) => /^soul_cohort_\d+_[0-9a-f]+$/.test(e.id));
  const cohortEntry = need('soul_cohort_index');
  const cohortDir = soulEntries.length ? toUrl(dirname(soulEntries[0].runtime_file)) + '/' : '/assets/souls/cohort/';
  const fallbackDir = soulEntries.length && soulEntries[0].fallback_file ? toUrl(dirname(soulEntries[0].fallback_file)) + '/' : '/assets/souls/fallback/';
  const thumbEntry = soulEntries.length ? (soulEntries[0].lods || []).find((p) => /thumbnails\//.test(p)) : null;
  const thumbnailDir = thumbEntry ? toUrl(dirname(thumbEntry)) + '/' : '/assets/souls/thumbnails/';
  const souls = {
    cohort: toUrl(cohortEntry.runtime_file),
    cohortSha256: stripPrefix(cohortEntry.checksum),
    cohortDir, thumbnailDir, fallbackDir,
    suffix: { full: '.svg', simple: '-simple.svg', dot: '-dot.svg', thumbnail: '-64.svg' },
    count: soulEntries.length,
    seeds: soulEntries.map((e) => e.id.match(/_([0-9a-f]+)$/)[1]),
    maxSpriteBytes: Math.max(0, ...soulEntries.map((e) => Number(e.texture_memory_bytes) || 0)),
  };

  // ---- audio ----
  const audioMap = {};
  for (const c of audio.cues) {
    const preload = {};
    for (const app of APPS) preload[app] = Array.isArray(c.preload) && c.preload.includes(app);
    audioMap[c.id] = {
      url: toUrl(c.runtime_file), bytes: c.bytes, durationS: c.duration_s, kind: c.kind,
      loop: c.loop ? { startSample: c.loop.start_sample, endSample: c.loop.end_sample, sampleRate: c.sample_rate } : null,
      priority: c.priority, rateLimitMs: c.rate_limit_ms, duck: c.duck || null,
      audiences: Array.isArray(c.audiences) ? c.audiences.slice() : [], preload,
      caption: c.caption, copyKey: c.copy_key ?? null, sha256: stripPrefix(c.checksum),
    };
  }

  // ---- every assets.yaml entry, for assetUrl(id) ----
  const entries = {};
  for (const e of assets.entries) {
    entries[e.id] = {
      kind: e.kind, url: toUrl(e.runtime_file), format: e.runtime_format, fallbackUrl: toUrl(e.fallback_file), fallbackFormat: e.fallback_format ?? null,
      sha256: stripPrefix(e.checksum), bytes: Number(e.texture_memory_bytes) || 0, lods: (e.lods || []).map(toUrl),
    };
  }

  const manifestHashes = {
    'assets/manifest/assets.yaml': hex(assetsYamlText), 'assets/manifest/audio.yaml': hex(audioYamlText), 'assets/manifest/audio.json': hex(audioJsonText),
  };
  manifestHashes.combined = hex(MANIFEST_PATHS.map((p) => `${p}:${manifestHashes[p]}`).join('\n'));

  return {
    generator: GENERATOR,
    generatedAt: null, // deliberately omitted for byte-for-byte determinism
    manifestVersion: String(assets.header.version ?? ''),
    audioManifestVersion: String(audio.version ?? ''),
    audioManifestId: audio.id ?? null,
    license: assets.header.license_default ?? 'internal-original',
    sha256OfManifests: manifestHashes,
    baseUrl: '/assets',
    manifests: { assets: '/assets/manifest/assets.yaml', audio: '/assets/manifest/audio.json' },
    budgets: {
      assetsBytes: 6 * 1024 * 1024, audioBytes: audio.budgets?.max_total_bytes ?? Math.round(1.6 * 1024 * 1024), singleFileBytes: Math.round(1.2 * 1024 * 1024),
      soulSvgBytes: sceneDefaults?.budgets?.soulSvgBytes ?? 6 * 1024, sceneDataBytes: (sceneDefaults?.budgets?.sceneDataKB ?? 120) * 1024, appBundleBytes: 600 * 1024,
      audioOneshotBytes: audio.budgets?.max_oneshot_bytes ?? 122880, maxConcurrentVoices: audio.budgets?.max_concurrent_voices ?? 4,
    },
    fallbackRules: {
      soulSprite: 'full -> simple -> dot (dot is a 24 px static disc that always renders); never omit a Soul',
      audio: 'silent + caption (every play() emits its caption; no error is shown to employees)',
      sceneJson: 'ASSETS.scene.defaults (embedded copy of scene-config.json); starfield/orbit files optional, nebula optional',
    },
    scene, souls, audio: audioMap, entries,
  };
}

/** Render the ES module source for packages/ui/asset-map.js. */
export function renderAssetMapSource(model) {
  const json = JSON.stringify(model, null, 2);
  if (json.includes('`') || json.includes('${')) throw new Error('asset-map: manifest data contains template-literal characters');
  return `// GENERATED FILE - do not hand-edit. Regenerate with: node tools/assets/build-asset-map.js
// Source of truth: assets/manifest/assets.yaml + assets/manifest/audio.json (+ scene-config.json for built-in defaults).
// Typed, frozen asset map for the four static clients. Importable in Node (no window/document access) and in browsers.
// Contract: every URL is absolute under the /assets static mount; sha256 values are hex without the "sha256:" prefix.

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

/** @type {Readonly<typeof ASSETS_DATA>} */
const ASSETS_DATA = ${json};

export const ASSETS = deepFreeze(ASSETS_DATA);
export const APPS = Object.freeze(['participant', 'admin', 'public', 'stage']);
export const ASSET_MAP_VERSION = ASSETS.manifestVersion;

/** URL for a manifest id (assets.yaml entry id or audio cue id); null when unknown. */
export function assetUrl(id) {
  const e = ASSETS.entries[id]; if (e) return e.url;
  const a = ASSETS.audio[id]; if (a) return a.url;
  return null;
}

/** Fallback URL for a manifest id (assets.yaml fallback_file); null when none is declared. */
export function fallbackUrl(id) {
  const e = ASSETS.entries[id]; return e ? e.fallbackUrl : null;
}

/** Sprite URLs for a Soul seed (14-hex id): { full, simple, dot, thumbnail }. Works for any seed, not only the cohort. */
export function soulSpriteUrls(seed) {
  const s = String(seed || '').replace(/[^0-9a-z]/gi, '');
  const { cohortDir, fallbackDir, thumbnailDir, suffix } = ASSETS.souls;
  return { full: cohortDir + s + suffix.full, simple: fallbackDir + s + suffix.simple, dot: fallbackDir + s + suffix.dot, thumbnail: thumbnailDir + s + suffix.thumbnail };
}

/** Cue ids an app should preload right after createAudioManager(): priority descending, then manifest order. */
export function preloadListFor(app) {
  const ids = Object.keys(ASSETS.audio).filter((id) => ASSETS.audio[id].preload && ASSETS.audio[id].preload[app] === true);
  return ids.map((id, i) => ({ id, i, p: ASSETS.audio[id].priority || 0 })).sort((a, b) => (b.p - a.p) || (a.i - b.i)).map((x) => x.id);
}

/**
 * Describe a primary/fallback pair. 'candidates' is the ordered list to try; 'onError(event)' swaps an <img>/<source>
 * (or any element with a 'src') to the fallback exactly once, so it can be attached directly as an error listener.
 */
export function withFallback(url, fallbackUrl) {
  const candidates = [url, fallbackUrl].filter((u) => typeof u === 'string' && u.length > 0);
  let swapped = false;
  return Object.freeze({
    url: candidates[0] || null, fallback: candidates[1] || null, candidates: Object.freeze(candidates),
    next(current) { const i = candidates.indexOf(current); return i >= 0 && i + 1 < candidates.length ? candidates[i + 1] : null; },
    onError(event) {
      try {
        if (swapped || candidates.length < 2) return false;
        const el = event && event.target; if (!el || typeof el !== 'object') return false;
        swapped = true; el.src = candidates[1]; return true;
      } catch (_) { return false; }
    },
  });
}

/** Small sample of assets whose bytes are re-hashed by checkIntegrity(): always tiny files. */
export function integritySample() {
  const audioIds = Object.keys(ASSETS.audio).sort((a, b) => ASSETS.audio[a].bytes - ASSETS.audio[b].bytes);
  const sample = [
    { id: 'scene_config', url: ASSETS.scene.config, sha256: ASSETS.scene.sha256.config },
    { id: 'scene_orbit_rings', url: ASSETS.scene.orbitRings, sha256: ASSETS.scene.sha256.orbitRings },
    { id: 'soul_cohort_index', url: ASSETS.souls.cohort, sha256: ASSETS.souls.cohortSha256 },
  ];
  if (audioIds.length) sample.push({ id: audioIds[0], url: ASSETS.audio[audioIds[0]].url, sha256: ASSETS.audio[audioIds[0]].sha256 });
  const soul = Object.keys(ASSETS.entries).find((id) => /^soul_cohort_\\d+_/.test(id));
  if (soul) sample.push({ id: soul, url: ASSETS.entries[soul].url, sha256: ASSETS.entries[soul].sha256 });
  return sample;
}

/**
 * Fetch a few small assets and compare their sha256 with the manifest (crypto.subtle when available).
 * Never throws. Returns { ok, checked, mismatches: [{ id, url, expected, actual }], errors: [{ id, url, error }], skipped }.
 */
export async function checkIntegrity(fetchFn) {
  const report = { ok: true, checked: 0, mismatches: [], errors: [], skipped: null };
  try {
    const f = fetchFn || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!f) { report.skipped = 'no fetch available'; return report; }
    if (!subtle || typeof subtle.digest !== 'function') { report.skipped = 'crypto.subtle unavailable'; return report; }
    for (const item of integritySample()) {
      try {
        const res = await f(item.url);
        if (!res || !res.ok) { report.errors.push({ id: item.id, url: item.url, error: 'HTTP ' + (res && res.status) }); continue; }
        const buf = await res.arrayBuffer();
        const digest = await subtle.digest('SHA-256', buf);
        const actual = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
        report.checked += 1;
        if (actual !== item.sha256) report.mismatches.push({ id: item.id, url: item.url, expected: item.sha256, actual });
      } catch (err) { report.errors.push({ id: item.id, url: item.url, error: String(err && err.message || err) }); }
    }
  } catch (err) { report.errors.push({ id: null, url: null, error: String(err && err.message || err) }); }
  report.ok = report.mismatches.length === 0 && report.errors.length === 0;
  return report;
}

export default ASSETS;
`;
}

export function buildAssetMapSource({ root = DEFAULT_ROOT } = {}) { return renderAssetMapSource(buildAssetMapModel({ root })); }

/** Returns { changed, path, stale } - with check=true nothing is written. */
export function writeAssetMap({ root = DEFAULT_ROOT, out = join(root, ASSET_MAP_PATH), check = false } = {}) {
  const source = buildAssetMapSource({ root });
  const current = existsSync(out) ? readFileSync(out, 'utf8') : null;
  const stale = current !== source;
  if (!check && stale) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, source); }
  return { changed: !check && stale, stale, path: out, bytes: Buffer.byteLength(source) };
}

function main(argv) {
  const check = argv.includes('--check');
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const root = arg('--root') || DEFAULT_ROOT;
  const out = arg('--out') || join(root, ASSET_MAP_PATH);
  const r = writeAssetMap({ root, out, check });
  const relOut = relative(root, r.path).split('\\').join('/');
  if (check) { console.log(r.stale ? `STALE: ${relOut} differs from the manifests; run: node tools/assets/build-asset-map.js` : `asset map is up to date (${relOut}, ${r.bytes} bytes)`); return r.stale ? 1 : 0; }
  console.log(`build-asset-map: ${r.changed ? 'wrote' : 'unchanged'} ${relOut} (${r.bytes} bytes)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
