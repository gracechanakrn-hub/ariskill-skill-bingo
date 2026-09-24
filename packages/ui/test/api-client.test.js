import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError, newIdempotencyKey } from '../api-client.js';

function jsonResponse(status, body) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('GET adds Authorization when a token exists and parses the envelope; lastServerTime updates', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return jsonResponse(200, { serverTime: '2026-09-22T03:30:05.120Z', correlationId: 'c1', platforms: [] }); };
  let samples = [];
  const api = createApiClient({ baseUrl: '/api/v1', getToken: () => 'tok', fetch, clockSync: { observe: (s) => samples.push(s) } });
  const res = await api.get('/taxonomy');
  assert.deepEqual(res.platforms, []);
  assert.equal(calls[0].url, '/api/v1/taxonomy');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].init.headers['Idempotency-Key'], undefined);
  assert.equal(api.lastServerTime, '2026-09-22T03:30:05.120Z');
  assert.equal(api.lastCorrelationId, 'c1');
  assert.equal(samples.length, 1);
  assert.equal(samples[0].serverTime, '2026-09-22T03:30:05.120Z');
});

test('POST sets an auto Idempotency-Key, JSON body, no Authorization without token', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return jsonResponse(200, { ok: true, serverTime: '2026-09-22T03:30:05.120Z', resultingVersion: 2 }); };
  const api = createApiClient({ fetch });
  await api.post('/events/evt_1/session', { joinToken: 'j', employeeRef: 'e', displayName: 'n', consentPublicName: false });
  const h = calls[0].init.headers;
  assert.equal(calls[0].init.method, 'POST');
  assert.match(h['Idempotency-Key'], /^[0-9a-f-]{36}$/);
  assert.equal(h.Authorization, undefined);
  assert.equal(h['Content-Type'], 'application/json');
  assert.equal(JSON.parse(calls[0].init.body).employeeRef, 'e');
  assert.match(newIdempotencyKey(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('error envelope becomes ApiError with code/exceptionId/details/status/correlationId', async () => {
  const fetch = async () => jsonResponse(409, { error: { code: 'STALE_VERSION', message: 'stale', exceptionId: 'E10', details: { currentVersion: 4, snapshot: { round: { version: 4 } } } }, correlationId: 'c9', serverTime: '2026-09-22T03:30:05.120Z' });
  const api = createApiClient({ fetch, baseUrl: '/api/v1' });
  await assert.rejects(api.post('/admin/rounds/r1/commands', { command: 'round.lock', expectedVersion: 3 }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, 'STALE_VERSION'); assert.equal(err.exceptionId, 'E10'); assert.equal(err.status, 409); assert.equal(err.correlationId, 'c9');
    assert.equal(err.details.currentVersion, 4); assert.equal(err.isStaleVersion, true); assert.deepEqual(err.staleSnapshot, { round: { version: 4 } });
    return true;
  });
  assert.equal(api.lastServerTime, '2026-09-22T03:30:05.120Z', 'server time is read from error envelopes too');
});

test('network failure retries up to 3 times with the SAME Idempotency-Key and backoff, then succeeds', async () => {
  const keys = []; let n = 0; const sleeps = [];
  const fetch = async (url, init) => { keys.push(init.headers['Idempotency-Key']); n++; if (n < 3) throw new TypeError('fetch failed'); return jsonResponse(200, { accepted: true, resultingVersion: 5 }); };
  const api = createApiClient({ fetch, sleep: async (ms) => { sleeps.push(ms); } });
  const res = await api.post('/admin/rounds/r1/commands', { command: 'round.draw.next', expectedVersion: 4 }, { idempotencyKey: 'fixed-key' });
  assert.equal(res.accepted, true);
  assert.equal(n, 3);
  assert.deepEqual(keys, ['fixed-key', 'fixed-key', 'fixed-key']);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[1] > sleeps[0], 'exponential backoff');
});

test('persistent network failure gives up after 1 + 3 attempts with a NETWORK ApiError', async () => {
  let n = 0;
  const api = createApiClient({ fetch: async () => { n++; throw new TypeError('offline'); }, sleep: async () => {} });
  await assert.rejects(api.put('/me/board/selections', { skillIds: [], boardVersion: 1 }), (err) => err instanceof ApiError && err.code === 'NETWORK' && err.isNetwork && err.status === 0);
  assert.equal(n, 4);
});

test('never retries on 4xx / 409 / 500, retries on 503', async () => {
  let n = 0;
  const api409 = createApiClient({ fetch: async () => { n++; return jsonResponse(409, { error: { code: 'ROUND_LOCKED', message: 'locked', exceptionId: 'E8' } }); }, sleep: async () => {} });
  await assert.rejects(api409.post('/me/board/finalize', { boardVersion: 1 }), (e) => e.code === 'ROUND_LOCKED' && e.exceptionId === 'E8');
  assert.equal(n, 1);
  n = 0;
  const api500 = createApiClient({ fetch: async () => { n++; return jsonResponse(500, { error: { code: 'DRAW_FAILED', message: 'x', exceptionId: 'E21' } }); }, sleep: async () => {} });
  await assert.rejects(api500.post('/x', {}), (e) => e.code === 'DRAW_FAILED');
  assert.equal(n, 1);
  n = 0;
  const api503 = createApiClient({ fetch: async () => { n++; return n < 2 ? jsonResponse(503, null) : jsonResponse(200, { ok: 1 }); }, sleep: async () => {} });
  assert.equal((await api503.get('/time')).ok, 1);
  assert.equal(n, 2);
  n = 0;
  const api401 = createApiClient({ fetch: async () => { n++; return new Response('<html>nope</html>', { status: 401 }); }, sleep: async () => {} });
  await assert.rejects(api401.get('/me'), (e) => e.code === 'HTTP_401' && e.isAuth && e.status === 401);
  assert.equal(n, 1);
});

test('204 returns null; absolute URLs pass through; abort signal is honoured', async () => {
  const api = createApiClient({ baseUrl: '/api/v1', fetch: async (url) => { assert.equal(url, 'https://x.example/ping'); return new Response(null, { status: 204 }); } });
  assert.equal(await api.get('https://x.example/ping'), null);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(api.get('/time', { signal: ac.signal }), (e) => e.code === 'ABORTED');
});
