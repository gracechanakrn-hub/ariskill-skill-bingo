// API shape contract (contracts/api-contract.yaml, requirement 14, 15.1, 15.2). Every operation listed in the contract is
// exercised for the auth-less, invalid and valid case; status codes, error codes, exception ids and envelope keys are checked.
// The operation list and the error-code table are parsed from the YAML text so a new operation without a case here fails.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, createRound, command, join, me, readyBoard, saveBoard, boardSet, mixedSet, startRound, drawUntilEnd, readSse, nextKey, ELIGIBLE_IDS, roleAt } from '../e2e/helpers.js';
import { ERROR_CODES } from '../../services/game-service/src/errors.js';

const yaml = readFileSync(new URL('../../contracts/api-contract.yaml', import.meta.url), 'utf8');
const operations = [...yaml.matchAll(/^  - id: (\S+)\n(?:.*\n)*?    method: (\S+)\n    path: (\S+)\n    auth: (\S+)/gm)].map(m => ({ id: m[1], method: m[2], path: m[3], auth: m[4] }));
const codeTable = Object.fromEntries([...yaml.matchAll(/^      ([A-Z_]+): \{ http: (\d+)(?:, exception: (E\d+))?/gm)].map(m => [m[1], { http: Number(m[2]), exceptionId: m[3] ?? null }]));

const ENVELOPE_OK = ['correlationId', 'serverTime'];
function expectError(r, status, code, exceptionId) {
  assert.equal(r.status, status, `${code}: ${JSON.stringify(r.body)}`);
  assert.deepEqual(Object.keys(r.body).sort(), ['correlationId', 'error', 'serverTime'], 'error envelope keys');
  assert.deepEqual(Object.keys(r.body.error).sort(), ['code', 'details', 'exceptionId', 'message'], 'error object keys');
  assert.equal(r.body.error.code, code); assert.equal(typeof r.body.error.message, 'string');
  if (exceptionId !== undefined) assert.equal(r.body.error.exceptionId, exceptionId);
  assert.equal(codeTable[code].http, status, `${code} status per contract`);
  if (codeTable[code].exceptionId) assert.equal(r.body.error.exceptionId, codeTable[code].exceptionId, `${code} exception per contract`);
}
function expectOk(r, status, keys, { mutation = false } = {}) {
  assert.equal(r.status, status, JSON.stringify(r.body));
  for (const k of [...keys, ...ENVELOPE_OK, ...(mutation ? ['resultingVersion'] : [])]) assert.ok(k in r.body, `missing ${k} in ${Object.keys(r.body)}`);
  assert.ok(Number.isFinite(Date.parse(r.body.serverTime)));
}

describe('api contract shapes', () => {
  let t, round, p, noProfile, finished, cases;
  before(async () => {
    t = await startServer();
    round = await createRound(t, { title: 'Shapes' });
    p = await join(t, { displayName: 'Shape Player', profile: roleAt(0) });
    noProfile = await join(t, { displayName: 'No Profile', profile: null });
    // a finished participant (separate server keeps the main round editable)
    finished = await startServer();
    const fr = await createRound(finished, { title: 'Done' });
    finished.p = await join(finished); await readyBoard(finished, finished.p, boardSet(0));
    const st = await startRound(finished, fr); await drawUntilEnd(finished, st);
    finished.me = await me(finished, finished.p);
    const E = t.eventId;
    cases = {
      'time.now': async () => { const r = await t.api.get('/time'); expectOk(r, 200, ['epochMs']); assert.ok(Math.abs(r.body.epochMs - Date.now()) < 5000); },
      'event.snapshot': async () => { expectOk(await t.api.get(`/events/${E}/snapshot`), 200, ['eventId', 'sequence', 'publicState', 'round', 'counts', 'galaxy']); expectError(await t.api.get('/events/evt_unknown/snapshot'), 404, 'NOT_FOUND', null); },
      'event.stream': async () => { const s = await readSse(t.baseUrl, `/events/${E}/stream`, { timeoutMs: 150 }); assert.equal(s.status, 200); assert.ok(s.contentType.startsWith('text/event-stream')); assert.equal((await readSse(t.baseUrl, '/events/evt_unknown/stream', { timeoutMs: 100 })).status, 404); assert.equal((await t.api.get(`/events/${E}/stream?since=-1`)).status, 400); },
      'event.join_info': async () => { const r = await t.api.get(`/events/${E}/join-info`); expectOk(r, 200, ['joinUrl', 'expiresAt']); assert.ok(r.body.joinUrl.includes('/play?t=')); },
      'event.session.create': async () => {
        expectError(await t.api.post(`/events/${E}/session`, { employeeRef: 'x', displayName: 'X', consentPublicName: true }), 400, 'VALIDATION', null);
        expectError(await t.api.post(`/events/${E}/session`, { joinToken: t.joinToken(-5), employeeRef: 'x', displayName: 'X', consentPublicName: true }), 401, 'TOKEN_EXPIRED', 'E2');
        expectError(await t.api.post(`/events/${E}/session`, { joinToken: t.joinToken(), employeeRef: 'x', displayName: 'X', consentPublicName: 'yes' }), 400, 'VALIDATION', null);
        expectError(await t.api.call('POST', `/events/${E}/session`, { body: '{not json', raw: true, headers: { 'Content-Type': 'application/json' } }), 400, 'VALIDATION', null);
        expectOk(await t.api.post(`/events/${E}/session`, { joinToken: t.joinToken(), employeeRef: 'emp-shape-2', displayName: 'Two', consentPublicName: false }), 201, ['sessionToken', 'participantId', 'eventId', 'expiresAt']);
      },
      'me.snapshot': async () => { expectError(await t.api.get('/me'), 401, 'UNAUTHORIZED', 'E9'); expectError(await t.api.get('/me', 'garbage'), 401, 'UNAUTHORIZED', 'E9'); expectError(await t.api.get('/me', t.admin), 403, 'FORBIDDEN', 'E9'); expectOk(await t.api.get('/me', p.token), 200, ['sequence', 'participant', 'event', 'round', 'nextRound', 'board', 'draws', 'result', 'soul', 'insightAvailable']); },
      'me.stream': async () => { assert.equal((await readSse(t.baseUrl, '/me/stream', { timeoutMs: 100 })).status, 401); const s = await readSse(t.baseUrl, '/me/stream', { token: p.token, timeoutMs: 150 }); assert.equal(s.status, 200); assert.ok(s.contentType.startsWith('text/event-stream')); },
      'taxonomy.query': async () => { expectError(await t.api.get('/taxonomy'), 401, 'UNAUTHORIZED', 'E9'); const r = await t.api.get('/taxonomy', p.token); expectOk(r, 200, ['platforms', 'roles', 'matrixVersion']); assert.ok(r.body.roles.every(x => 'id' in x && 'name' in x && 'platformId' in x)); },
      'me.profile.set': async () => { expectError(await t.api.post('/me/profile', roleAt(0)), 401, 'UNAUTHORIZED', 'E9'); expectError(await t.api.post('/me/profile', { platformId: 'nope', roleId: 'nope' }, p.token), 400, 'VALIDATION', null); expectError(await t.api.post('/me/profile', {}, p.token), 400, 'VALIDATION', null); const r = await t.api.post('/me/profile', roleAt(1), p.token); expectOk(r, 200, ['participant']); assert.deepEqual(Object.keys(r.body.participant).sort(), ['consentPublicName', 'displayName', 'participantId', 'platformId', 'roleId']); },
      'skill.discovery.query': async () => { expectError(await t.api.get('/skills/discovery?mode=recommended'), 401, 'UNAUTHORIZED', 'E9'); expectError(await t.api.get('/skills/discovery?mode=recommended', noProfile.token), 409, 'PROFILE_REQUIRED', 'E16'); expectError(await t.api.get('/skills/discovery?mode=bogus', p.token), 400, 'VALIDATION', null); for (const mode of ['recommended', 'popular', 'search']) { const r = await t.api.get(`/skills/discovery?mode=${mode}&q=a&limit=5`, p.token); expectOk(r, 200, ['mode', 'skills', 'selectedCount']); assert.equal(r.body.mode, mode); assert.ok(r.body.skills.length <= 5); } },
      'board.selections.save': async () => {
        expectError(await t.api.put('/me/board/selections', { skillIds: [ELIGIBLE_IDS[0]], boardVersion: 0 }), 401, 'UNAUTHORIZED', 'E9');
        expectError(await t.api.call('PUT', '/me/board/selections', { body: { skillIds: [ELIGIBLE_IDS[0]], boardVersion: 0 }, token: p.token }), 400, 'VALIDATION', null);
        expectError(await t.api.put('/me/board/selections', { skillIds: [ELIGIBLE_IDS[0]], boardVersion: 0 }, noProfile.token), 409, 'PROFILE_REQUIRED', 'E16');
        expectError(await t.api.put('/me/board/selections', { skillIds: [ELIGIBLE_IDS[0], ELIGIBLE_IDS[0]], boardVersion: 0 }, p.token), 409, 'DUPLICATE_SKILL', 'E4');
        expectError(await t.api.put('/me/board/selections', { skillIds: 'nope', boardVersion: 0 }, p.token), 400, 'VALIDATION', null);
        expectError(await t.api.put('/me/board/selections', { skillIds: [ELIGIBLE_IDS[0]], boardVersion: 7 }, p.token), 409, 'STALE_VERSION', 'E10');
        const r = await t.api.put('/me/board/selections', { skillIds: boardSet(0), boardVersion: 0 }, p.token); expectOk(r, 200, ['board'], { mutation: true });
        assert.deepEqual(Object.keys(r.body.board).sort(), ['boardId', 'cells', 'matchedPositions', 'matrixVersion', 'roundId', 'selectedSkillIds', 'state', 'version']);
        const stale = await t.api.put('/me/board/selections', { skillIds: boardSet(1), boardVersion: 0 }, p.token); expectError(stale, 409, 'STALE_VERSION', 'E10'); assert.deepEqual(Object.keys(stale.body.error.details).sort(), ['currentVersion', 'snapshot']);
        const locked = await saveBoard(finished, finished.p, boardSet(1)); expectError(locked, 409, 'ROUND_LOCKED', 'E8');
      },
      'board.finalize': async () => {
        expectError(await t.api.post('/me/board/finalize', { boardVersion: 1 }), 401, 'UNAUTHORIZED', 'E9');
        expectError(await t.api.call('POST', '/me/board/finalize', { body: { boardVersion: 1 }, token: p.token }), 400, 'VALIDATION', null);
        expectError(await t.api.post('/me/board/finalize', { boardVersion: 99 }, p.token), 409, 'STALE_VERSION', 'E10');
        const short = await join(t, { profile: roleAt(0) }); await saveBoard(t, short, boardSet(0, 10));
        expectError(await t.api.post('/me/board/finalize', { boardVersion: 1 }, short.token), 400, 'VALIDATION', null);
        const v = (await me(t, p)).board.version; expectOk(await t.api.post('/me/board/finalize', { boardVersion: v }, p.token), 200, ['board'], { mutation: true });
      },
      'me.insight': async () => { expectError(await t.api.get('/me/insight'), 401, 'UNAUTHORIZED', 'E9'); expectError(await t.api.get('/me/insight', p.token), 404, 'NOT_FOUND', null); const r = await finished.api.get('/me/insight', finished.p.token); expectOk(r, 200, ['roundId', 'matrixVersion', 'inMatrixCount', 'beyondMatrixCount', 'totalSelected']); assert.equal(r.body.totalSelected, 25); },
      'soul.float': async () => {
        expectError(await t.api.post('/me/soul/float', { soulId: 'x', floatToken: 'y' }), 401, 'UNAUTHORIZED', 'E9');
        expectError(await finished.api.call('POST', '/me/soul/float', { body: { soulId: 'x', floatToken: 'y' }, token: finished.p.token }), 400, 'VALIDATION', null);
        expectError(await finished.api.post('/me/soul/float', {}, finished.p.token), 400, 'VALIDATION', null);
        expectError(await finished.api.post('/me/soul/float', { soulId: finished.me.soul.soulId, floatToken: 'wrong' }, finished.p.token), 409, 'FLOAT_FAILED', 'E13');
        const r = await finished.api.post('/me/soul/float', { soulId: finished.me.soul.soulId, floatToken: finished.me.soul.floatToken }, finished.p.token);
        expectOk(r, 200, ['accepted', 'replay', 'entrance']); assert.equal(r.body.accepted, true); assert.deepEqual(Object.keys(r.body.entrance).sort(), ['badge', 'config', 'edge', 'enteredAt', 'label', 'soulId']);
      },
      'round.admin.snapshot': async () => { expectError(await t.api.get(`/admin/events/${E}/snapshot`), 401, 'UNAUTHORIZED', 'E9'); expectError(await t.api.get(`/admin/events/${E}/snapshot`, t.stage), 403, 'FORBIDDEN', 'E9'); expectError(await t.api.get(`/admin/events/${E}/snapshot`, p.token), 403, 'FORBIDDEN', 'E9'); const r = await t.api.get(`/admin/events/${E}/snapshot`, t.admin); expectOk(r, 200, ['eventId', 'sequence', 'rounds', 'currentRound', 'join', 'connections']); assert.deepEqual(Object.keys(r.body.connections).sort(), ['admin', 'participants', 'public', 'stage']); },
      'admin.stream': async () => { assert.equal((await readSse(t.baseUrl, `/admin/events/${E}/stream`, { timeoutMs: 100 })).status, 401); assert.equal((await readSse(t.baseUrl, `/admin/events/${E}/stream`, { token: t.stage, timeoutMs: 100 })).status, 403); assert.equal((await readSse(t.baseUrl, `/admin/events/${E}/stream`, { token: t.admin, timeoutMs: 150 })).status, 200); },
      'round.create': async () => { const body = { title: 'X', lockAt: new Date(Date.now() + 60000).toISOString() }; expectError(await t.api.post(`/admin/events/${E}/rounds`, body), 401, 'UNAUTHORIZED', 'E9'); expectError(await t.api.post(`/admin/events/${E}/rounds`, body, t.stage), 403, 'FORBIDDEN', 'E9'); expectError(await t.api.call('POST', `/admin/events/${E}/rounds`, { body, token: t.admin }), 400, 'VALIDATION', null); expectError(await t.api.post(`/admin/events/${E}/rounds`, { title: 'X', lockAt: 'soon' }, t.admin), 400, 'VALIDATION', null); expectError(await t.api.post('/admin/events/evt_unknown/rounds', body, t.admin), 404, 'NOT_FOUND', null); const r = await t.api.post(`/admin/events/${E}/rounds`, body, t.admin); expectOk(r, 201, ['round'], { mutation: true }); assert.deepEqual(Object.keys(r.body.round).sort(), ['cancellationReason', 'lockAt', 'number', 'resultWindowSeconds', 'roundId', 'startedAt', 'state', 'title', 'version']); await command(t, r.body.round.roundId, 'round.cancel', 1, { reason: 'x' }); },
      'round.command': async () => {
        const path = `/admin/rounds/${round.roundId}/commands`;
        expectError(await t.api.post(path, { command: 'round.lock', expectedVersion: round.version }), 401, 'UNAUTHORIZED', 'E9');
        expectError(await t.api.post(path, { command: 'round.lock', expectedVersion: round.version }, p.token), 403, 'FORBIDDEN', 'E9');
        expectError(await t.api.post(path, { command: 'round.fly', expectedVersion: round.version }, t.admin), 400, 'VALIDATION', null);
        expectError(await t.api.post('/admin/rounds/rnd_unknown/commands', { command: 'round.lock', expectedVersion: 1 }, t.admin), 404, 'NOT_FOUND', null);
        const stale = await t.api.post(path, { command: 'round.lock', expectedVersion: round.version + 5 }, t.admin); expectError(stale, 409, 'STALE_VERSION', 'E10'); assert.deepEqual(Object.keys(stale.body.error.details).sort(), ['currentVersion', 'snapshot']);
        expectError(await t.api.post(path, { command: 'round.start', expectedVersion: round.version }, t.admin), 409, 'ILLEGAL_TRANSITION', 'E10');
        expectError(await t.api.post(path, { command: 'round.cancel', expectedVersion: round.version, params: {} }, t.admin), 400, 'REASON_REQUIRED', null);
        const key = nextKey('shape'); const r = await t.api.post(path, { command: 'round.reschedule', expectedVersion: round.version, params: { title: 'Shapes 2' } }, t.admin, key);
        expectOk(r, 200, ['accepted', 'round', 'effects'], { mutation: true }); assert.equal(r.body.accepted, true);
        expectError(await t.api.post(path, { command: 'round.reschedule', expectedVersion: round.version, params: { title: 'Other' } }, t.admin, key), 422, 'IDEMPOTENCY_MISMATCH', null);
        round = r.body.round;
        const small = await startServer(); try { const sr = await createRound(small); const sp = await join(small); await readyBoard(small, sp, mixedSet(3)); const l = await command(small, sr.roundId, 'round.lock', sr.version); expectError(await small.api.post(`/admin/rounds/${sr.roundId}/commands`, { command: 'round.start', expectedVersion: l.resultingVersion }, small.admin), 409, 'POOL_TOO_SMALL', 'E20'); } finally { await small.close(); }
        const fr = finished.db.get("SELECT id, version FROM rounds WHERE state = 'WINNER'"); if (fr) expectError(await finished.api.post(`/admin/rounds/${fr.id}/commands`, { command: 'round.draw.next', expectedVersion: fr.version }, finished.admin), 409, 'ILLEGAL_TRANSITION', 'E10');
      },
      'admin.insights': async () => { expectError(await t.api.get(`/admin/events/${E}/insights`), 401, 'UNAUTHORIZED', 'E9'); expectError(await t.api.get(`/admin/events/${E}/insights`, t.stage), 403, 'FORBIDDEN', 'E9'); expectOk(await t.api.get(`/admin/events/${E}/insights`, t.admin), 200, ['participation', 'platformEngagement', 'roleEngagement', 'topSkills', 'coreCriticalDensity', 'matrixAlignment', 'skillsBeyondMatrix', 'suppressedCohorts', 'matrixVersion', 'computedAt']); },
      'admin.audit': async () => { expectError(await t.api.get(`/admin/events/${E}/audit`), 401, 'UNAUTHORIZED', 'E9'); expectError(await t.api.get(`/admin/events/${E}/audit`, t.stage), 403, 'FORBIDDEN', 'E9'); const r = await t.api.get(`/admin/events/${E}/audit?limit=3`, t.admin); expectOk(r, 200, ['entries']); assert.equal(r.body.entries.length, 3); for (const k of ['id', 'at', 'actor', 'action', 'target', 'expectedVersion', 'actualVersion', 'outcome', 'correlationId', 'details']) assert.ok(k in r.body.entries[0], k); },
      'admin.join_link': async () => { expectError(await t.api.get(`/admin/events/${E}/join-link`), 401, 'UNAUTHORIZED', 'E9'); expectOk(await t.api.get(`/admin/events/${E}/join-link`, t.admin), 200, ['joinUrl', 'expiresAt']); },
      'round.stage.snapshot': async () => { expectError(await t.api.get(`/stage/events/${E}/snapshot`), 401, 'UNAUTHORIZED', 'E9'); expectError(await t.api.get(`/stage/events/${E}/snapshot`, p.token), 403, 'FORBIDDEN', 'E9'); expectOk(await t.api.get(`/stage/events/${E}/snapshot`, t.stage), 200, ['eventId', 'sequence', 'publicState', 'round', 'counts', 'winners', 'resultTiming', 'insights']); expectOk(await t.api.get(`/stage/events/${E}/snapshot`, t.admin), 200, ['insights']); expectError(await t.api.get('/stage/events/evt_unknown/snapshot', t.stage), 404, 'NOT_FOUND', null); },
      'stage.stream': async () => { assert.equal((await readSse(t.baseUrl, `/stage/events/${E}/stream`, { timeoutMs: 100 })).status, 401); assert.equal((await readSse(t.baseUrl, `/stage/events/${E}/stream`, { token: p.token, timeoutMs: 100 })).status, 403); assert.equal((await readSse(t.baseUrl, `/stage/events/${E}/stream`, { token: t.stage, timeoutMs: 150 })).status, 200); },
    };
  });
  after(async () => { await t.close(); await finished.close(); });

  test('the contract lists operations and an error-code table; the service error catalogue matches the table exactly', () => {
    assert.ok(operations.length >= 20, `parsed ${operations.length} operations`);
    // INTERNAL is the catch-all the router emits for unhandled errors (never on the draw path); every other code is in the catalogue
    assert.equal(codeTable.INTERNAL.http, 500);
    assert.deepEqual(Object.keys(codeTable).filter(c => c !== 'INTERNAL').sort(), Object.keys(ERROR_CODES).sort(), 'same set of error codes');
    for (const [code, def] of Object.entries(codeTable)) { if (code === 'INTERNAL') continue; assert.equal(ERROR_CODES[code].http, def.http, code); assert.equal(ERROR_CODES[code].exceptionId ?? null, def.exceptionId, `${code} exception`); }
  });

  test('every operation in the contract has an executable case here', () => {
    assert.deepEqual(operations.map(o => o.id).sort(), Object.keys(cases).sort());
  });

  test('operations: auth-less / invalid / valid cases per contract', async (tc) => {
    for (const op of operations) await tc.test(`${op.id} ${op.method} ${op.path} [auth: ${op.auth}]`, async () => { await cases[op.id](); });
  });

  test('routing: unknown path and wrong method are 404 NOT_FOUND envelopes; JSON responses carry security headers and no-store', async () => {
    expectError(await t.api.get('/nope'), 404, 'NOT_FOUND', null);
    expectError(await t.api.call('DELETE', '/time'), 404, 'NOT_FOUND', null);
    const r = await fetch(`${t.baseUrl}/api/v1/time`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.ok(r.headers.get('content-security-policy').includes("default-src 'self'")); assert.equal(r.headers.get('x-frame-options'), 'DENY');
    const big = await t.api.call('POST', `/events/${t.eventId}/session`, { body: JSON.stringify({ joinToken: 'x'.repeat(70000) }), raw: true, headers: { 'Content-Type': 'application/json' } });
    assert.equal(big.status, 400, 'oversized body rejected');
    const corr = await t.api.get('/time', null, { 'X-Correlation-Id': 'qa-corr-1' });
    assert.equal(corr.body.correlationId, 'qa-corr-1', 'client correlation id is echoed');
  });
});
