// tools/ai/lib/common.js - shared helpers for the developer-side AI tooling (zero third-party code).
// Never import from services/ or apps/: this module reads .env through ./env.js and talks to external APIs.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, redact } from '../env.js';

export const REPORTS_AI = join(ROOT, 'reports', 'ai');
export const DRY_RUN_DIR = join(REPORTS_AI, 'dry-run');
export const GENERATED_DIR = join(ROOT, 'assets-src', 'generated');
export const LICENSE_NOTE = 'AI-generated reference, not shipped';
export const PROVENANCE_VERSION = 1;

/** `--key value`, `--key=value` and boolean `--flag` (a following `--x` or end means boolean). Repeated keys collect into arrays. */
export function parseArgs(argv, { booleans = [] } = {}) {
  const out = { _: [] };
  const bools = new Set(booleans);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    let key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    let val;
    if (eq >= 0) val = a.slice(eq + 1);
    else if (bools.has(key) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) val = true;
    else val = argv[++i];
    if (key in out && key !== '_') out[key] = [].concat(out[key], val);
    else out[key] = val;
  }
  return out;
}

export function sha256Hex(buf) { return createHash('sha256').update(buf).digest('hex'); }

/** Local-time stamp `YYYYMMDD-HHMMSS`, used for batch ids and dry-run file names. */
export function nowStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function ensureDir(dir) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); return dir; }
export function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export function writeJson(path, obj) { ensureDir(dirname(path)); writeFileSync(path, JSON.stringify(obj, null, 2) + '\n'); return path; }
export function writeText(path, text) { ensureDir(dirname(path)); writeFileSync(path, text.endsWith('\n') ? text : text + '\n'); return path; }

/** Console output with key redaction. Everything the tools print goes through here. */
export function log(...parts) { console.log(redact(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 2))).join(' '))); }
export function warn(...parts) { console.error(redact(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p, null, 2))).join(' '))); }

/**
 * Dry-run record: the exact request a tool would send (URL, headers with the auth value replaced, body) plus what it
 * would write. Written as JSON to reports/ai/dry-run/<tool>-<name>-<stamp>.json (redacted twice: header masking + redact()).
 */
export function shapeDryRun({ tool, name, method = 'POST', url, headers = {}, body, outputs = [], notes = [] }) {
  const safeHeaders = {};
  for (const [k, v] of Object.entries(headers)) safeHeaders[k] = /authorization|api-key/i.test(k) ? '<redacted>' : v;
  return { tool, name, dryRun: true, createdAt: new Date().toISOString(), request: { method, url, headers: safeHeaders, body }, outputs, notes };
}
export function writeDryRun(record, stamp = nowStamp()) {
  const file = join(DRY_RUN_DIR, `${record.tool}-${record.name}-${stamp}.json`);
  ensureDir(DRY_RUN_DIR);
  writeFileSync(file, redact(JSON.stringify(record, null, 2)) + '\n');
  return file;
}

/** fetch() JSON with a timeout; errors never include the request headers. */
export async function postJson(url, { headers = {}, body, timeoutMs = 180000 } = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'ariskill-ai-tools/1.0', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw text */ }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}: ${redact(text.slice(0, 600))}`);
  if (json === null) throw new Error(`Non-JSON response from ${new URL(url).host}: ${redact(text.slice(0, 200))}`);
  return json;
}

/** Provenance entry for one generated bitmap (workflow "AI-assisted production" rule). */
export function provenanceEntry({ file, model, prompt, temperature, bytes, extra = {} }) {
  return {
    file, model, prompt, temperature, sha256: sha256Hex(bytes), bytes: bytes.length, createdAt: new Date().toISOString(),
    license: LICENSE_NOTE, shipped: false, ...extra,
  };
}

/** Section extraction from the markdown requirement: everything under a heading matching `re` until the next heading of the same or higher level. */
export function extractSection(markdown, re) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return '';
  const level = (lines[start].match(/^#+/) || ['#'])[0].length;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

/** Flat list of token names across all themes (tokens.json 1.x) - used to constrain UX/UI proposals. */
export function tokenNames(tokens) {
  const names = new Set();
  for (const theme of Object.values(tokens.themes || {})) for (const k of Object.keys(theme.tokens || {})) names.add(k);
  return [...names].sort();
}
