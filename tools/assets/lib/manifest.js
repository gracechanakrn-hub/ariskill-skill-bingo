// Minimal deterministic YAML emit/parse for assets/manifest/assets.yaml (workflow 5.2 fields).
// Zero third-party code. Supports exactly the subset we emit: a header map, then `entries:` as a list of flat maps
// whose values are scalars (string/number/null) or flat arrays of scalars.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export const MANIFEST_FIELDS = ['id', 'kind', 'source_file', 'source_format', 'runtime_file', 'runtime_format', 'fallback_file', 'fallback_format',
  'version', 'checksum', 'license', 'generator_script', 'bounds', 'pivot', 'triangle_count', 'texture_memory_bytes', 'lods', 'approved_by'];

export function sha256(buf) { return 'sha256:' + createHash('sha256').update(buf).digest('hex'); }
export function fileChecksum(path) { return sha256(readFileSync(path)); }
export function fileSize(path) { return statSync(path).size; }

function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  const s = String(v);
  return /^[A-Za-z0-9_./:-]+$/.test(s) && !/^(null|true|false|\d+)$/.test(s) ? s : JSON.stringify(s);
}
function unscalar(s) {
  s = s.trim();
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('"')) return JSON.parse(s);
  return s;
}

/** Emit the manifest deterministically (entries sorted by id, fields in canonical order). */
export function emitManifest({ header = {}, entries = [] }) {
  const lines = ['# Generated asset manifest (workflow 5.2). Do not hand-edit: regenerate with the generator_script of each entry.'];
  for (const [k, v] of Object.entries(header)) lines.push(`${k}: ${scalar(v)}`);
  lines.push('entries:');
  const sorted = entries.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const e of sorted) {
    let first = true;
    for (const f of MANIFEST_FIELDS) {
      const v = e[f];
      const prefix = first ? '  - ' : '    ';
      first = false;
      if (Array.isArray(v)) lines.push(`${prefix}${f}: [${v.map(scalar).join(', ')}]`);
      else lines.push(`${prefix}${f}: ${scalar(v)}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Parse a manifest emitted by emitManifest. */
export function parseManifest(text) {
  const header = {}; const entries = []; let cur = null; let inEntries = false;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (raw === 'entries:') { inEntries = true; continue; }
    if (!inEntries) { const m = raw.match(/^([\w-]+):\s*(.*)$/); if (m) header[m[1]] = unscalar(m[2]); continue; }
    const m = raw.match(/^(\s*-\s+|\s+)([\w-]+):\s*(.*)$/);
    if (!m) throw new Error(`manifest parse error: ${raw}`);
    if (m[1].includes('-')) { cur = {}; entries.push(cur); }
    const val = m[3].trim();
    if (val.startsWith('[')) cur[m[2]] = val === '[]' ? [] : val.slice(1, -1).split(',').map(unscalar);
    else cur[m[2]] = unscalar(val);
  }
  return { header, entries };
}

export function readManifest(path) {
  if (!existsSync(path)) return { header: { version: '1.0.0', license_default: 'internal-original', runtime_formats: 'svg,json,html' }, entries: [] };
  return parseManifest(readFileSync(path, 'utf8'));
}

/** Replace all entries produced by `generatorScript` with `entries` and write deterministically. */
export function mergeManifest(path, generatorScript, entries) {
  const m = readManifest(path);
  const kept = m.entries.filter((e) => e.generator_script !== generatorScript);
  const out = emitManifest({ header: m.header, entries: kept.concat(entries) });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out);
  return out;
}

/** Write only when content differs (keeps mtimes stable; content is deterministic anyway). */
export function writeIfChanged(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return false;
  writeFileSync(path, content);
  return true;
}
