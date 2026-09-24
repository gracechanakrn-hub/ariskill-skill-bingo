import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, join, tryCommand, EVENT_ID, nextKey } from './helpers.js';
import { signJoinToken } from '../src/auth.js';
import { loadConfig } from '../src/config.js';

describe('authorization boundaries, tokens, rate limits, headers, static serving (BR-11, BR-20, 15.2)', () => {
  let t, round, p;
  before(async () => { t = await startServer(); round = await createRound(t); p = await join(t); });
  after(async () => { await t.close(); });

  test('admin endpoints: missing/invalid bearer is 401 UNAUTHORIZED (E9), stage or participant tokens are 403 FORBIDDEN, all audited', async () => {
    const none = await t.api.get(`/admin/events/${EVENT_ID}/snapshot`);
    assert.equal(none.status, 401); assert.equal(none.body.error.code, 'UNAUTHORIZED'); assert.equal(none.body.error.exceptionId, 'E9');
    const wrong = await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, 'nope');
    assert.equal(wrong.status, 401);
    const stage = await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.stage);
    assert.equal(stage.status, 403); assert.equal(stage.body.error.code, 'FORBIDDEN');
    const stageCmd = await t.api.post(`/admin/rounds/${round.roundId}/commands`, { command: 'round.lock', expectedVersion: round.version, params: {} }, t.stage);
    assert.equal(stageCmd.status, 403);
    const partCmd = await t.api.post(`/admin/rounds/${round.roundId}/commands`, { command: 'round.lock', expectedVersion: round.version, params: {} }, p.token);
    assert.equal(partCmd.status, 403);
    const partCreate = await t.api.post(`/admin/events/${EVENT_ID}/rounds`, { title: 'x', lockAt: new Date().toISOString() }, p.token);
    assert.equal(partCreate.status, 403);
    assert.equal(t.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'REGISTRATION_OPEN');
    const rejects = t.db.all("SELECT * FROM audit_log WHERE action = 'auth.reject' AND outcome = 'rejected'");
    assert.ok(rejects.length >= 5);
    assert.ok(rejects.some(r => r.actor === 'stage') && rejects.some(r => r.actor === p.participantId) && rejects.some(r => r.actor.startsWith('ip:')));
  });

  test('stage endpoints accept stage and admin tokens only; participant endpoints reject admin/stage tokens', async () => {
    assert.equal((await t.api.get(`/stage/events/${EVENT_ID}/snapshot`, t.stage)).status, 200);
    assert.equal((await t.api.get(`/stage/events/${EVENT_ID}/snapshot`, t.admin)).status, 200);
    assert.equal((await t.api.get(`/stage/events/${EVENT_ID}/snapshot`)).status, 401);
    assert.equal((await t.api.get(`/stage/events/${EVENT_ID}/snapshot`, p.token)).status, 403);
    assert.equal((await t.api.get('/me', t.admin)).status, 403);
    assert.equal((await t.api.get('/me')).status, 401);
    assert.equal((await t.api.get('/me', 'garbage')).status, 401);
    const adminInsights = await t.api.get(`/admin/events/${EVENT_ID}/insights`, t.stage);
    assert.equal(adminInsights.status, 403);
  });

  test('join token: expired or wrong-event tokens are TOKEN_EXPIRED (E2); a tampered signature is rejected; validation of session body', async () => {
    const expired = signJoinToken(t.config.joinSecret, EVENT_ID, Math.floor(t.clock.now() / 1000) - 10);
    const r1 = await t.api.post(`/events/${EVENT_ID}/session`, { joinToken: expired, employeeRef: 'e1', displayName: 'E', consentPublicName: false });
    assert.equal(r1.status, 401); assert.equal(r1.body.error.code, 'TOKEN_EXPIRED'); assert.equal(r1.body.error.exceptionId, 'E2');
    const other = signJoinToken(t.config.joinSecret, 'evt_other', Math.floor(t.clock.now() / 1000) + 100);
    assert.equal((await t.api.post(`/events/${EVENT_ID}/session`, { joinToken: other, employeeRef: 'e1', displayName: 'E', consentPublicName: false })).status, 401);
    const tampered = t.joinToken().slice(0, -3) + 'abc';
    assert.equal((await t.api.post(`/events/${EVENT_ID}/session`, { joinToken: tampered, employeeRef: 'e1', displayName: 'E', consentPublicName: false })).status, 401);
    const badBody = await t.api.post(`/events/${EVENT_ID}/session`, { joinToken: t.joinToken(), employeeRef: '', displayName: 'E', consentPublicName: 'yes' });
    assert.equal(badBody.status, 400); assert.equal(badBody.body.error.code, 'VALIDATION');
    const info = await t.api.get(`/events/${EVENT_ID}/join-info`);
    assert.equal(info.status, 200); assert.ok(info.body.joinUrl.includes('/play?t=v1.')); assert.ok(Date.parse(info.body.expiresAt) > t.clock.now());
    const tok = decodeURIComponent(new URL(info.body.joinUrl).searchParams.get('t'));
    const ok = await t.api.post(`/events/${EVENT_ID}/session`, { joinToken: tok, employeeRef: 'from-qr', displayName: 'QR', consentPublicName: true });
    assert.equal(ok.status, 201); assert.ok(ok.body.sessionToken); assert.ok(ok.body.participantId.startsWith('prt_'));
    const again = await t.api.post(`/events/${EVENT_ID}/session`, { joinToken: tok, employeeRef: 'FROM-QR ', displayName: 'QR2', consentPublicName: true });
    assert.equal(again.body.participantId, ok.body.participantId, 'same employee reference resolves to the same participant');
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM sessions WHERE token_hash = ?', ok.body.sessionToken).c, 0, 'session tokens stored hashed');
  });

  test('join link rotates when less than 1 h remains; session expires after 24 h (TOKEN_EXPIRED)', async () => {
    const a = (await t.api.get(`/admin/events/${EVENT_ID}/join-link`, t.admin)).body;
    const b = (await t.api.get(`/events/${EVENT_ID}/join-info`)).body;
    assert.equal(a.joinUrl, b.joinUrl);
    t.clock.set(Date.parse(a.expiresAt) - 30 * 60 * 1000);
    try {
      const c = (await t.api.get(`/events/${EVENT_ID}/join-info`)).body;
      assert.notEqual(c.joinUrl, a.joinUrl); assert.ok(Date.parse(c.expiresAt) > Date.parse(a.expiresAt));
      t.clock.set(t.clock.now() + 25 * 3600 * 1000);
      const me = await t.api.get('/me', p.token);
      assert.equal(me.status, 401); assert.equal(me.body.error.code, 'TOKEN_EXPIRED');
    } finally { t.clock.unfreeze(); }
  });

  test('rate limiting: commands beyond the per-actor bucket are 429 RATE_LIMITED', async () => {
    const s = await startServer({ rateLimits: { commandsPerSec: 2, sessionPerMin: 2, discoveryPerSec: 1000 } });
    try {
      const r = await createRound(s, { open: false });
      const results = [];
      for (let i = 0; i < 4; i++) results.push(await s.api.post(`/admin/rounds/${r.roundId}/commands`, { command: 'round.update', expectedVersion: 999, params: {} }, s.admin));
      assert.ok(results.some(x => x.status === 429 && x.body.error.code === 'RATE_LIMITED'));
      const sessions = [];
      for (let i = 0; i < 4; i++) sessions.push(await s.api.post(`/events/${EVENT_ID}/session`, { joinToken: s.joinToken(), employeeRef: `rl-${i}`, displayName: 'R', consentPublicName: false }));
      assert.ok(sessions.some(x => x.status === 429));
    } finally { await s.close(); }
  });

  test('RISK-01: BINGO_SESSION_RATE_PER_MIN raises the per-IP session limit and BINGO_TRUST_PROXY keys it on X-Forwarded-For', async () => {
    const cfg = loadConfig({ BINGO_SESSION_RATE_PER_MIN: '50', BINGO_TRUST_PROXY: '1' }, { env: 'test', dbPath: ':memory:', adminToken: 'a', stageToken: 's', joinSecret: 'j', sessionSecret: 'x' });
    assert.equal(cfg.rateLimits.sessionPerMin, 50); assert.equal(cfg.rateLimits.commandsPerSec, 10); assert.equal(cfg.trustProxy, true);
    const dflt = loadConfig({}, { env: 'test', dbPath: ':memory:', adminToken: 'a', stageToken: 's', joinSecret: 'j', sessionSecret: 'x' });
    assert.equal(dflt.rateLimits.sessionPerMin, 5); assert.equal(dflt.trustProxy, false);
    const sessionBody = (i) => ({ joinToken: s2.joinToken(), employeeRef: `nat-${i}`, displayName: 'N', consentPublicName: false });
    // trusted proxy: two venues behind different forwarded addresses get separate buckets of 3
    const s2 = await startServer({ rateLimits: { commandsPerSec: 1000, sessionPerMin: 3, discoveryPerSec: 1000 }, trustProxy: true });
    try {
      const a = []; for (let i = 0; i < 4; i++) a.push((await s2.api.post(`/events/${EVENT_ID}/session`, sessionBody(i), null, undefined, { 'X-Forwarded-For': '10.0.0.1, 192.168.1.1' })).status);
      assert.deepEqual(a, [201, 201, 201, 429]);
      const b = []; for (let i = 10; i < 13; i++) b.push((await s2.api.post(`/events/${EVENT_ID}/session`, sessionBody(i), null, undefined, { 'X-Forwarded-For': '10.0.0.2' })).status);
      assert.deepEqual(b, [201, 201, 201], 'a different forwarded client is not starved');
    } finally { await s2.close(); }
    // proxy not trusted: the header is ignored and everything from the socket address shares one bucket
    const s3 = await startServer({ rateLimits: { commandsPerSec: 1000, sessionPerMin: 3, discoveryPerSec: 1000 }, trustProxy: false });
    try {
      const c = []; for (let i = 0; i < 4; i++) c.push((await s3.api.post(`/events/${EVENT_ID}/session`, { joinToken: s3.joinToken(), employeeRef: `d-${i}`, displayName: 'N', consentPublicName: false }, null, undefined, { 'X-Forwarded-For': `10.0.0.${i}` })).status);
      assert.deepEqual(c, [201, 201, 201, 429]);
    } finally { await s3.close(); }
  });

  test('security headers on every response; JSON body limit; invalid JSON; unknown route 404', async () => {
    const r = await t.api.get('/time');
    assert.equal(r.status, 200); assert.ok(r.body.serverTime && Number.isInteger(r.body.epochMs));
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.ok(r.headers.get('content-security-policy').startsWith("default-src 'self'")); assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    const big = await t.api.put('/me/board/selections', { skillIds: [], boardVersion: 0, pad: 'x'.repeat(70000) }, p.token);
    assert.equal(big.status, 400);
    const badJson = await fetch(`${t.baseUrl}/api/v1/me/board/selections`, { method: 'PUT', headers: { Authorization: `Bearer ${p.token}`, 'Idempotency-Key': nextKey(), 'Content-Type': 'application/json' }, body: '{nope' });
    assert.equal(badJson.status, 400);
    assert.equal((await t.api.get('/nothing/here')).status, 404);
    assert.equal((await t.api.get('/events/evt_missing/snapshot')).status, 404);
  });

  test('static serving: index page, shared trees with MIME types, path traversal blocked, absent app dirs give 404', async () => {
    const idx = await fetch(`${t.baseUrl}/`); assert.equal(idx.status, 200); assert.ok((await idx.text()).includes('/play')); assert.ok(idx.headers.get('content-type').startsWith('text/html'));
    const js = await fetch(`${t.baseUrl}/packages/game-rules/src/index.js`); assert.equal(js.status, 200); assert.ok(js.headers.get('content-type').startsWith('text/javascript'));
    const yaml = await fetch(`${t.baseUrl}/contracts/api-contract.yaml`); assert.equal(yaml.status, 200); assert.ok(yaml.headers.get('content-type').includes('yaml'));
    const json = await fetch(`${t.baseUrl}/packages/contracts/copy.json`); assert.equal(json.status, 200); assert.ok(json.headers.get('content-type').startsWith('application/json'));
    for (const path of ['/packages/../package.json', '/play/../../package.json', '/contracts/%2e%2e/package.json', '/assets/..%2f..%2fpackage.json']) {
      const r = await fetch(`${t.baseUrl}${path}`); assert.notEqual(r.status, 200, path);
    }
    const missing = await fetch(`${t.baseUrl}/admin/does-not-exist.css`); assert.equal(missing.status, 404);
    const app = await fetch(`${t.baseUrl}/play?t=abc`); assert.ok([200, 404].includes(app.status), 'app dir may not exist yet');
    assert.equal(app.headers.get('x-content-type-options'), 'nosniff');
  });

  test('client authority: participants cannot post commands, mark cells, choose draws or alter time; draw params never carry a skill', async () => {
    const cmd = await tryCommand(t, round.roundId, 'round.draw.next', round.version, { skillId: 'skill_adaptability' });
    assert.equal(cmd.status, 409, 'not playing: state machine wins regardless of params');
    const mark = await t.api.put('/me/board/selections', { skillIds: [], boardVersion: 0, matchedPositions: [0, 1, 2], cells: [{ position: 0, skillId: 'skill_adaptability' }] }, p.token);
    assert.equal(mark.status, 200); assert.deepEqual(mark.body.board.matchedPositions, []); assert.equal(mark.body.board.cells, null);
    const time = await t.api.get('/time?serverTime=2000-01-01');
    assert.ok(Math.abs(time.body.epochMs - Date.now()) < 5000);
  });
});
