import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { serveStatic, acceptsGzip, clearStaticCache, staticCacheStats, CACHE_IMMUTABLE, CACHE_REVALIDATE } from '../src/static.js';
import { startServer } from './helpers.js';

/** Minimal server over a temporary repo root so the test controls file sizes and the /packages/vendor tree. */
async function staticServer(repoRoot) {
  const server = http.createServer((req, res) => { if (!serveStatic(req, res, new URL(req.url, 'http://x').pathname, { repoRoot })) { res.writeHead(404); res.end(); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}
const get = (url, headers = {}, method = 'GET') => fetch(url, { headers, method, redirect: 'manual' });
// Node's fetch transparently decodes gzip; ask for it explicitly and read raw bytes to verify the encoding on the wire.
async function raw(url, headers = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}

describe('static serving: gzip negotiation, ETag/304, cache headers (D-22)', () => {
  let root, srv;
  const bigJs = 'export const pad = "' + 'abcdefghij'.repeat(3000) + '";\n'; // ~30 KB, compressible
  const bigVendor = '/* vendored */ ' + 'const x = 1;\n'.repeat(2000);
  const smallJson = '{"ok":true}';
  // A fake baseline Soul model (D-27): GLB magic + a quantised-looking payload, well above the 8 KB gzip floor.
  const fakeGlb = Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(4), Buffer.from(Array.from({ length: 40000 }, (_, i) => (i * 7) % 61))]);
  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'bingo-static-'));
    mkdirSync(join(root, 'packages/vendor/three/build'), { recursive: true });
    mkdirSync(join(root, 'packages/contracts'), { recursive: true });
    mkdirSync(join(root, 'assets'), { recursive: true });
    mkdirSync(join(root, 'apps/employee-mobile'), { recursive: true });
    writeFileSync(join(root, 'packages/vendor/three/build/three.module.js'), bigVendor);
    writeFileSync(join(root, 'packages/contracts/big.js'), bigJs);
    writeFileSync(join(root, 'packages/contracts/small.json'), smallJson);
    writeFileSync(join(root, 'assets/blob.png'), Buffer.alloc(20000, 7));
    mkdirSync(join(root, 'assets/souls/baseline'), { recursive: true });
    writeFileSync(join(root, 'assets/souls/baseline/soul-baseline-hero.glb'), fakeGlb);
    writeFileSync(join(root, 'assets/souls/baseline/tiny.glb'), fakeGlb.subarray(0, 4096));
    writeFileSync(join(root, 'apps/employee-mobile/index.html'), '<!doctype html><title>x</title>' + '<p>hello</p>'.repeat(2000));
    writeFileSync(join(root, 'package.json'), '{"secret":true}');
    clearStaticCache();
    srv = await staticServer(root);
  });
  after(async () => { await srv.close(); rmSync(root, { recursive: true, force: true }); clearStaticCache(); });

  test('acceptsGzip parses Accept-Encoding tokens and q values', () => {
    assert.equal(acceptsGzip('gzip, deflate, br'), true); assert.equal(acceptsGzip('br;q=1.0, gzip;q=0.8'), true); assert.equal(acceptsGzip('*'), true);
    assert.equal(acceptsGzip('br'), false); assert.equal(acceptsGzip('gzip;q=0'), false); assert.equal(acceptsGzip(''), false); assert.equal(acceptsGzip(undefined), false);
  });

  test('text files above 8 KB are gzipped only when the client accepts gzip; Vary is always set; bytes round-trip', async () => {
    const gz = await raw(`${srv.base}/packages/contracts/big.js`, { 'Accept-Encoding': 'gzip, deflate' });
    assert.equal(gz.status, 200); assert.equal(gz.headers['content-encoding'], 'gzip'); assert.equal(gz.headers.vary, 'Accept-Encoding');
    assert.ok(gz.headers['content-type'].startsWith('text/javascript')); assert.equal(Number(gz.headers['content-length']), gz.body.length);
    assert.ok(gz.body.length < bigJs.length / 4, 'actually compressed'); assert.equal(gunzipSync(gz.body).toString('utf8'), bigJs);
    const plain = await raw(`${srv.base}/packages/contracts/big.js`, { 'Accept-Encoding': 'identity' });
    assert.equal(plain.status, 200); assert.equal(plain.headers['content-encoding'], undefined); assert.equal(plain.headers.vary, 'Accept-Encoding'); assert.equal(plain.body.toString('utf8'), bigJs);
    const none = await raw(`${srv.base}/packages/contracts/big.js`);
    assert.equal(none.headers['content-encoding'], undefined);
    const brOnly = await raw(`${srv.base}/packages/contracts/big.js`, { 'Accept-Encoding': 'br' });
    assert.equal(brOnly.headers['content-encoding'], undefined, 'br alone is not honoured (gzip only)');
    const head = await raw(`${srv.base}/packages/contracts/big.js`, { 'Accept-Encoding': 'gzip' }).then(r => r); // GET variant already checked; HEAD below
    assert.equal(head.status, 200);
    const h = await fetch(`${srv.base}/packages/contracts/big.js`, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(h.status, 200); assert.equal(h.headers.get('content-encoding'), 'gzip');
  });

  test('small text files and binary files are never compressed even when gzip is accepted; MIME types unchanged', async () => {
    const small = await raw(`${srv.base}/packages/contracts/small.json`, { 'Accept-Encoding': 'gzip' });
    assert.equal(small.status, 200); assert.equal(small.headers['content-encoding'], undefined); assert.equal(small.body.toString(), smallJson);
    assert.ok(small.headers['content-type'].startsWith('application/json')); assert.equal(small.headers.vary, 'Accept-Encoding');
    const png = await raw(`${srv.base}/assets/blob.png`, { 'Accept-Encoding': 'gzip' });
    assert.equal(png.status, 200); assert.equal(png.headers['content-encoding'], undefined); assert.equal(png.headers['content-type'], 'image/png'); assert.equal(png.body.length, 20000);
    const html = await raw(`${srv.base}/play`, { 'Accept-Encoding': 'gzip' });
    assert.equal(html.status, 200); assert.equal(html.headers['content-encoding'], 'gzip'); assert.ok(html.headers['content-type'].startsWith('text/html'));
    assert.ok(gunzipSync(html.body).toString().startsWith('<!doctype html>'));
  });

  test('strong ETag on every static file; If-None-Match returns 304 (with and without gzip, weak-prefix tolerant); ETag changes when the file changes', async () => {
    const first = await raw(`${srv.base}/packages/contracts/small.json`);
    const etag = first.headers.etag;
    assert.match(etag, /^"[0-9a-f]{40}"$/);
    const notMod = await raw(`${srv.base}/packages/contracts/small.json`, { 'If-None-Match': etag });
    assert.equal(notMod.status, 304); assert.equal(notMod.body.length, 0); assert.equal(notMod.headers.etag, etag); assert.equal(notMod.headers.vary, 'Accept-Encoding'); assert.equal(notMod.headers['cache-control'], CACHE_REVALIDATE);
    const weak = await raw(`${srv.base}/packages/contracts/small.json`, { 'If-None-Match': `W/${etag}, "other"` });
    assert.equal(weak.status, 304);
    const gzEtag = (await raw(`${srv.base}/packages/contracts/big.js`, { 'Accept-Encoding': 'gzip' })).headers.etag;
    const gz304 = await raw(`${srv.base}/packages/contracts/big.js`, { 'Accept-Encoding': 'gzip', 'If-None-Match': gzEtag });
    assert.equal(gz304.status, 304);
    const miss = await raw(`${srv.base}/packages/contracts/small.json`, { 'If-None-Match': '"nope"' });
    assert.equal(miss.status, 200);
    await new Promise(r => setTimeout(r, 15));
    writeFileSync(join(root, 'packages/contracts/small.json'), '{"ok":false}');
    const changed = await raw(`${srv.base}/packages/contracts/small.json`, { 'If-None-Match': etag });
    assert.equal(changed.status, 200); assert.notEqual(changed.headers.etag, etag);
    writeFileSync(join(root, 'packages/contracts/small.json'), smallJson);
  });

  test('Cache-Control is immutable only under /packages/vendor/; everything else revalidates; the vendored library is compressed once per process', async () => {
    clearStaticCache();
    const v1 = await raw(`${srv.base}/packages/vendor/three/build/three.module.js`, { 'Accept-Encoding': 'gzip' });
    assert.equal(v1.status, 200); assert.equal(v1.headers['cache-control'], CACHE_IMMUTABLE); assert.equal(v1.headers['content-encoding'], 'gzip'); assert.ok(v1.headers['content-type'].startsWith('text/javascript'));
    assert.equal(gunzipSync(v1.body).toString(), bigVendor);
    const stats1 = staticCacheStats();
    assert.equal(stats1.entries, 1); assert.equal(stats1.bytes, v1.body.length); assert.equal(stats1.maxBytes, 64 * 1024 * 1024);
    const v2 = await raw(`${srv.base}/packages/vendor/three/build/three.module.js`, { 'Accept-Encoding': 'gzip' });
    assert.deepEqual(v2.body, v1.body); assert.equal(staticCacheStats().entries, 1, 'served from the cache, not re-compressed');
    for (const path of ['/packages/contracts/big.js', '/packages/contracts/small.json', '/assets/blob.png', '/play']) {
      const r = await raw(`${srv.base}${path}`); assert.equal(r.headers['cache-control'], CACHE_REVALIDATE, path);
    }
    const vendorish = await raw(`${srv.base}/packages/vendor-not/x.js`);
    assert.equal(vendorish.status, 404);
  });

  test('.glb models are model/gltf-binary, gzipped when accepted, ETag/304 and revalidated like every other asset (D-27)', async () => {
    const url = `${srv.base}/assets/souls/baseline/soul-baseline-hero.glb`;
    const gz = await raw(url, { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(gz.status, 200); assert.equal(gz.headers['content-type'], 'model/gltf-binary'); assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(gz.headers.vary, 'Accept-Encoding'); assert.equal(gz.headers['cache-control'], CACHE_REVALIDATE); assert.match(gz.headers.etag, /^"[0-9a-f]{40}"$/);
    assert.equal(Number(gz.headers['content-length']), gz.body.length); assert.ok(gz.body.length < fakeGlb.length / 2, 'compressed');
    assert.deepEqual(gunzipSync(gz.body), fakeGlb, 'bytes round-trip');
    const again = await raw(url, { 'Accept-Encoding': 'gzip', 'If-None-Match': gz.headers.etag });
    assert.equal(again.status, 304); assert.equal(again.body.length, 0); assert.equal(again.headers.etag, gz.headers.etag);
    const plain = await raw(url, { 'Accept-Encoding': 'identity' });
    assert.equal(plain.status, 200); assert.equal(plain.headers['content-encoding'], undefined); assert.equal(plain.headers['content-type'], 'model/gltf-binary'); assert.deepEqual(plain.body, fakeGlb);
    assert.equal(plain.headers.etag, gz.headers.etag, 'one ETag per file regardless of encoding');
    const head = await fetch(url, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-type'), 'model/gltf-binary'); assert.equal(head.headers.get('content-encoding'), 'gzip');
    const tiny = await raw(`${srv.base}/assets/souls/baseline/tiny.glb`, { 'Accept-Encoding': 'gzip' });
    assert.equal(tiny.status, 200); assert.equal(tiny.headers['content-encoding'], undefined, 'below 8 KB stays raw'); assert.equal(tiny.headers['content-type'], 'model/gltf-binary');
    assert.equal((await raw(`${srv.base}/assets/souls/baseline/missing.glb`)).status, 404);
  });

  test('path traversal is still blocked (404) including encoded forms; unknown files 404', async () => {
    for (const path of ['/packages/../package.json', '/packages/vendor/../../package.json', '/play/../../package.json', '/contracts/%2e%2e/package.json', '/assets/..%2f..%2fpackage.json', '/packages/vendor/%00x']) {
      const r = await raw(`${srv.base}${path}`, { 'Accept-Encoding': 'gzip' });
      assert.notEqual(r.status, 200, path); assert.ok(!r.body.toString().includes('secret'), path);
    }
    assert.equal((await raw(`${srv.base}/packages/contracts/missing.js`)).status, 404);
  });

  test('integration through the app: the real skill-master JSON is gzipped with security headers and an ETag; small package.json is not', async () => {
    const t = await startServer();
    try {
      const big = await raw(`${t.baseUrl}/packages/skill-master/data/skill-master.json`, { 'Accept-Encoding': 'gzip' });
      assert.equal(big.status, 200); assert.equal(big.headers['content-encoding'], 'gzip'); assert.equal(big.headers['x-content-type-options'], 'nosniff'); assert.ok(big.headers.etag); assert.equal(big.headers['cache-control'], CACHE_REVALIDATE);
      assert.equal(JSON.parse(gunzipSync(big.body).toString()).matrixVersion, 'skill-matrix-2026-tech-role-20260319');
      const again = await raw(`${t.baseUrl}/packages/skill-master/data/skill-master.json`, { 'Accept-Encoding': 'gzip', 'If-None-Match': big.headers.etag });
      assert.equal(again.status, 304);
      const small = await raw(`${t.baseUrl}/packages/contracts/package.json`, { 'Accept-Encoding': 'gzip' });
      assert.equal(small.status, 200); assert.equal(small.headers['content-encoding'], undefined);
      const js = await raw(`${t.baseUrl}/packages/game-rules/src/index.js`, { 'Accept-Encoding': 'gzip' });
      assert.equal(js.status, 200); assert.ok(js.headers['content-type'].startsWith('text/javascript')); assert.equal(js.headers['content-encoding'], undefined, 'below 8 KB');
      const api = await fetch(`${t.baseUrl}/api/v1/time`, { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(api.status, 200);
      // the real baseline Soul model (D-27): gzipped glTF binary with the security headers and an ETag
      const glb = await raw(`${t.baseUrl}/assets/souls/baseline/soul-baseline-hero.glb`, { 'Accept-Encoding': 'gzip' });
      assert.equal(glb.status, 200); assert.equal(glb.headers['content-type'], 'model/gltf-binary'); assert.equal(glb.headers['content-encoding'], 'gzip');
      assert.equal(glb.headers['x-content-type-options'], 'nosniff'); assert.equal(glb.headers['cache-control'], CACHE_REVALIDATE); assert.ok(glb.headers.etag);
      const bytes = gunzipSync(glb.body);
      assert.equal(bytes.toString('latin1', 0, 4), 'glTF'); assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
      assert.equal((await raw(`${t.baseUrl}/assets/souls/baseline/soul-baseline-lite.glb`, { 'If-None-Match': (await raw(`${t.baseUrl}/assets/souls/baseline/soul-baseline-lite.glb`)).headers.etag })).status, 304);
    } finally { await t.close(); }
  });
});
