// Static file serving for the four clients and the shared trees. Path traversal is blocked by resolving inside the root.
// ES modules are served as text/javascript. Missing app directories (built by other workstreams) simply yield 404.
// D-22: text assets above 8 KB are gzip-compressed on demand (node:zlib) when the client accepts gzip, cached in memory per
// (path, mtime, size) within a bounded budget so the vendored Three.js is compressed once per process; every static response
// carries a strong ETag (If-None-Match -> 304) and `Vary: Accept-Encoding`; /packages/vendor/** is immutable (versioned by directory).
// D-27: the baseline Soul models (/assets/souls/baseline/*.glb) are served as model/gltf-binary and gzip like text: the quantised
// buffers still shrink (~27 %), and they follow the same ETag / revalidate rules as every other asset.
import { createReadStream, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { REPO_ROOT } from './config.js';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.yaml': 'application/yaml; charset=utf-8', '.yml': 'application/yaml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.map': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.csv': 'text/csv; charset=utf-8',
  '.glb': 'model/gltf-binary',
};

export const COMPRESSIBLE_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.yaml', '.yml', '.glb']);
export const COMPRESS_MIN_BYTES = 8 * 1024;
export const GZIP_CACHE_MAX_BYTES = 64 * 1024 * 1024;
export const IMMUTABLE_PREFIX = '/packages/vendor/';
export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
export const CACHE_REVALIDATE = 'no-cache';

// gzip cache: key -> Buffer, insertion-ordered so the oldest entry is evicted first when the byte budget is exceeded.
const gzipCache = new Map();
let gzipCacheBytes = 0;
export function clearStaticCache() { gzipCache.clear(); gzipCacheBytes = 0; }
export function staticCacheStats() { return { entries: gzipCache.size, bytes: gzipCacheBytes, maxBytes: GZIP_CACHE_MAX_BYTES }; }
function gzipFor(full, st) {
  const key = `${full}|${st.mtimeMs}|${st.size}`;
  const hit = gzipCache.get(key);
  if (hit) return hit;
  const gz = gzipSync(readFileSync(full), { level: 6 });
  if (gz.length <= GZIP_CACHE_MAX_BYTES) {
    while (gzipCacheBytes + gz.length > GZIP_CACHE_MAX_BYTES && gzipCache.size) { const [k, v] = gzipCache.entries().next().value; gzipCache.delete(k); gzipCacheBytes -= v.length; }
    gzipCache.set(key, gz); gzipCacheBytes += gz.length;
  }
  return gz;
}
/** True when the Accept-Encoding header lists gzip (or *) with a non-zero q. */
export function acceptsGzip(header) {
  if (typeof header !== 'string' || !header) return false;
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';').map(x => x.trim());
    if (name !== 'gzip' && name !== 'x-gzip' && name !== '*') continue;
    const q = params.find(x => x.startsWith('q='));
    if (q && Number.parseFloat(q.slice(2)) === 0) continue;
    return true;
  }
  return false;
}
export function etagFor(st) { return `"${createHash('sha1').update(`${st.mtimeMs}:${st.size}`).digest('hex')}"`; }
function etagMatches(header, etag) {
  if (typeof header !== 'string' || !header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').map(x => x.trim().replace(/^W\//, '')).includes(etag);
}

export const APP_MOUNTS = { '/play': 'apps/employee-mobile', '/admin': 'apps/admin-portal', '/public': 'apps/public-galaxy', '/stage': 'apps/stage-dashboard' };
export const SHARED_MOUNTS = ['/packages', '/assets', '/tokens', '/contracts'];

export const INDEX_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AriSkill Skill Bingo</title>
<style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#e9ecf5;margin:0;padding:32px;max-width:640px}a{color:#8fd3ff}li{margin:8px 0}code{background:#1a2340;padding:2px 6px;border-radius:4px}</style></head>
<body><h1>AriSkill Skill Bingo</h1><p>Game service is running. Open a client:</p>
<ul><li><a href="/play">/play</a> - employee mobile (needs a join link with <code>?t=</code>)</li><li><a href="/admin">/admin</a> - admin portal (Mission Control)</li><li><a href="/public">/public</a> - public Arise Galaxy screen</li><li><a href="/stage">/stage</a> - stage dashboard</li></ul>
<p>API: <code>/api/v1/time</code>, <code>/api/v1/events/{eventId}/snapshot</code>. Contracts: <a href="/contracts/api-contract.yaml">/contracts/api-contract.yaml</a></p></body></html>`;

function safeResolve(rootDir, relPath) {
  const root = resolve(rootDir);
  const full = resolve(root, '.' + (relPath.startsWith('/') ? relPath : '/' + relPath));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

/** Try to serve a static path. Returns true when a response was written. */
export function serveStatic(req, res, pathname, { repoRoot = REPO_ROOT, headers = {} } = {}) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  if (decoded.includes('\0')) return false;
  let rootDir = null, rel = null, appMount = false;
  for (const [mount, dir] of Object.entries(APP_MOUNTS)) {
    if (decoded === mount || decoded.startsWith(mount + '/')) { rootDir = join(repoRoot, dir); rel = decoded.slice(mount.length) || '/'; appMount = true; break; }
  }
  if (!rootDir) for (const mount of SHARED_MOUNTS) {
    if (decoded === mount || decoded.startsWith(mount + '/')) { rootDir = join(repoRoot, mount.slice(1)); rel = decoded.slice(mount.length) || '/'; break; }
  }
  if (!rootDir) return false;
  if (!existsSync(rootDir)) { notFound(res, headers); return true; }
  let full = safeResolve(rootDir, rel);
  if (!full) { notFound(res, headers); return true; }
  let st = existsSync(full) ? statSync(full) : null;
  if (st?.isDirectory()) { full = join(full, 'index.html'); st = existsSync(full) ? statSync(full) : null; }
  if (!st && appMount && !extname(rel)) { full = join(rootDir, 'index.html'); st = existsSync(full) ? statSync(full) : null; }
  if (!st || !st.isFile()) { notFound(res, headers); return true; }
  const ext = extname(full).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  const etag = etagFor(st);
  const cacheControl = decoded.startsWith(IMMUTABLE_PREFIX) ? CACHE_IMMUTABLE : CACHE_REVALIDATE;
  const base = { ...headers, ETag: etag, 'Cache-Control': cacheControl, Vary: 'Accept-Encoding' };
  if (etagMatches(req.headers['if-none-match'], etag)) { res.writeHead(304, base); res.end(); return true; }
  const compress = COMPRESSIBLE_EXT.has(ext) && st.size > COMPRESS_MIN_BYTES && acceptsGzip(req.headers['accept-encoding']);
  if (compress) {
    let gz;
    try { gz = gzipFor(full, st); } catch { notFound(res, headers); return true; }
    res.writeHead(200, { ...base, 'Content-Type': type, 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
    res.end(req.method === 'HEAD' ? undefined : gz);
    return true;
  }
  res.writeHead(200, { ...base, 'Content-Type': type, 'Content-Length': st.size });
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(full).on('error', () => { try { res.destroy(); } catch { /* ignore */ } }).pipe(res);
  return true;
}
function notFound(res, headers) { res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }
