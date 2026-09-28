// Admin round control (requirement 4.2, 5.2, 15.1; AC 5, 15; A-01, A-04, A-05, A-07, A-09; E10, E15, E20; rate limits).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, tryCommand, join, me, readyBoard, saveBoard, boardSet, startRound, drawUntilEnd, openStream, sleep, nextKey } from './helpers.js';
import { CELLS, POOL_MINIMUM } from '../../packages/game-rules/src/index.js';
import { exception, t as copy } from '../../packages/contracts/index.js';
import sm from '../../contracts/round-state-machine.json' with { type: 'json' };

describe('admin operations: versions, idempotency, concurrency, guards, cancellation, audit, rate limits', () => {
  let t;
  before(async () => { t = await startServer(); });
  after(async () => { await t.close(); });

  test('stale expectedVersion -> STALE_VERSION (E10) with currentVersion + snapshot, no mutation; missing/invalid fields -> VALIDATION', async () => {
    const round = await createRound(t, { title: 'Stale' });
    const stale = await tryCommand(t, round.roundId, 'round.start_now', round.version + 3, { confirmed: true });
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'STALE_VERSION'); assert.equal(stale.body.error.exceptionId, 'E10'); assert.equal(stale.body.error.message, exception('E10').copy);
    assert.equal(stale.body.error.details.currentVersion, round.version); assert.equal(stale.body.error.details.snapshot.roundId, round.roundId); assert.equal(stale.body.error.details.snapshot.state, 'REGISTRATION_OPEN');
    assert.equal(t.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'REGISTRATION_OPEN');
    const noVersion = await t.api.post(`/admin/rounds/${round.roundId}/commands`, { command: 'round.start_now', params: { confirmed: true } }, t.admin);
    assert.equal(noVersion.status, 400); assert.equal(noVersion.body.error.code, 'VALIDATION');
    const noKey = await t.api.call('POST', `/admin/rounds/${round.roundId}/commands`, { body: { command: 'round.start_now', expectedVersion: round.version, params: { confirmed: true } }, token: t.admin });
    assert.equal(noKey.status, 400, 'Idempotency-Key is mandatory on mutations');
    const unknownRound = await tryCommand(t, 'rnd_nope', 'round.start_now', 1, { confirmed: true });
    assert.equal(unknownRound.status, 404);
    await command(t, round.roundId, 'round.cancel', round.version, { reason: 'cleanup' });
  });

  test('duplicate Idempotency-Key returns the identical stored body (Idempotent-Replay); same key + different body -> 422', async () => {
    const round = await createRound(t, { title: 'Idem' });
    const key = nextKey('idem');
    const first = await tryCommand(t, round.roundId, 'round.reschedule', round.version, { title: 'Idem renamed' }, key);
    assert.equal(first.status, 200); assert.equal(first.body.resultingVersion, round.version + 1);
    const again = await tryCommand(t, round.roundId, 'round.reschedule', round.version, { title: 'Idem renamed' }, key);
    assert.equal(again.status, 200); assert.equal(again.headers.get('idempotent-replay'), 'true'); assert.deepEqual(again.body, first.body, 'byte-identical replay');
    assert.equal(t.db.get('SELECT version FROM rounds WHERE id = ?', round.roundId).version, round.version + 1, 'replay did not mutate again');
    const mismatch = await tryCommand(t, round.roundId, 'round.reschedule', round.version, { title: 'Different body' }, key);
    assert.equal(mismatch.status, 422); assert.equal(mismatch.body.error.code, 'IDEMPOTENCY_MISMATCH');
    const rejectedKey = nextKey('idem-rej');
    const rej1 = await tryCommand(t, round.roundId, 'round.start_now', 999, { confirmed: true }, rejectedKey);
    const rej2 = await tryCommand(t, round.roundId, 'round.start_now', 999, { confirmed: true }, rejectedKey);
    assert.equal(rej1.status, 409); assert.equal(rej2.status, 409, 'rejections are not cached as successes; the retry is evaluated again');
    await command(t, round.roundId, 'round.cancel', first.body.resultingVersion, { reason: 'cleanup' });
  });

  test('two simultaneous draw-next -> exactly one accepted, one draw row; retry with the same key of the accepted one replays (AC 5, BR-09)', async () => {
    const round = await createRound(t, { title: 'Race' });
    const a = await join(t), b = await join(t);
    await readyBoard(t, a, boardSet(0)); await readyBoard(t, b, boardSet(CELLS));
    const started = await startRound(t, round);
    const k1 = nextKey('race'), k2 = nextKey('race');
    const [r1, r2] = await Promise.all([tryCommand(t, round.roundId, 'round.draw.next', started.version, {}, k1), tryCommand(t, round.roundId, 'round.draw.next', started.version, {}, k2)]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409], 'one accepted, one rejected');
    const accepted = r1.status === 200 ? r1 : r2, rejected = r1.status === 200 ? r2 : r1;
    assert.equal(rejected.body.error.code, 'STALE_VERSION');
    assert.equal(accepted.body.effects.draw.number, 1); assert.equal(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, 1, 'exactly one draw persisted');
    const acceptedKey = r1.status === 200 ? k1 : k2;
    const retry = await tryCommand(t, round.roundId, 'round.draw.next', started.version, {}, acceptedKey);
    assert.equal(retry.status, 200); assert.deepEqual(retry.body, accepted.body, 'network retry with the same key returns the same draw');
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, 1);
    // same key fired twice at once -> one draw, both responses identical
    const k3 = nextKey('race-same');
    const [s1, s2] = await Promise.all([tryCommand(t, round.roundId, 'round.draw.next', accepted.body.resultingVersion, {}, k3), tryCommand(t, round.roundId, 'round.draw.next', accepted.body.resultingVersion, {}, k3)]);
    assert.equal(s1.status, 200); assert.equal(s2.status, 200); assert.deepEqual(s1.body, s2.body);
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, 2);
    const draws = t.db.all('SELECT number, skill_id FROM draws WHERE round_id = ? ORDER BY number', round.roundId);
    assert.deepEqual(draws.map(d => d.number), [1, 2]); assert.equal(new Set(draws.map(d => d.skill_id)).size, 2);
    await command(t, round.roundId, 'round.cancel', s1.body.resultingVersion, { reason: 'cleanup' });
  });

  test('start with pool < 5 -> POOL_TOO_SMALL (E20), round stays REGISTRATION_OPEN; start_now without confirmed -> rejected; illegal and removed commands rejected', async () => {
    const round = await createRound(t, { title: 'Guards' });
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const adm = (await t.api.get(`/admin/events/${t.eventId}/snapshot`, t.admin)).body.currentRound;
    // every skill on the board is draw-eligible (D-33): readiness reports all 16 and a winnable board
    assert.equal(adm.readiness.poolSize, CELLS); assert.equal(adm.readiness.poolMinimum, POOL_MINIMUM); assert.equal(adm.readiness.anyBoardCanWin, true);
    const startNowUnconfirmed = await tryCommand(t, round.roundId, 'round.start_now', round.version, {});
    assert.equal(startNowUnconfirmed.status, 400); assert.equal(startNowUnconfirmed.body.error.code, 'VALIDATION');
    const startNowFalse = await tryCommand(t, round.roundId, 'round.start_now', round.version, { confirmed: false });
    assert.equal(startNowFalse.status, 400);
    assert.equal(t.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'REGISTRATION_OPEN');
    const drawBeforeStart = await tryCommand(t, round.roundId, 'round.draw.next', round.version);
    assert.equal(drawBeforeStart.status, 409); assert.equal(drawBeforeStart.body.error.code, 'ILLEGAL_TRANSITION');
    for (const gone of ['round.lock', 'round.start', 'round.close']) { // D-53: removed commands are unknown
      const g = await tryCommand(t, round.roundId, gone, round.version);
      assert.equal(g.status, 400, gone); assert.equal(g.body.error.code, 'VALIDATION');
    }
    await command(t, round.roundId, 'round.cancel', round.version, { reason: 'cleanup' });
    // D-53: unfinished boards play, so a small pool comes from few skills in total: one board with POOL_MINIMUM - 1 skills
    const small = await startServer();
    try {
      const sr = await createRound(small, { title: 'Small pool' });
      const sp = await join(small); await saveBoard(small, sp, boardSet(0, POOL_MINIMUM - 1));
      const s = await tryCommand(small, sr.roundId, 'round.start_now', sr.version, { confirmed: true });
      assert.equal(s.status, 409); assert.equal(s.body.error.code, 'POOL_TOO_SMALL'); assert.equal(s.body.error.exceptionId, 'E20'); assert.equal(s.body.error.message, exception('E20').copy);
      assert.equal(s.body.error.details.poolSize, POOL_MINIMUM - 1);
      const r = small.db.get('SELECT state, version FROM rounds WHERE id = ?', sr.roundId);
      assert.equal(r.state, 'REGISTRATION_OPEN'); assert.equal(r.version, sr.version, 'rejection never mutates');
      assert.equal((await me(small, sp)).board.state, 'DRAFT', 'the board was not locked');
      assert.equal((await small.api.get(`/events/${small.eventId}/snapshot`)).body.publicState, 'Waiting');
    } finally { await small.close(); }
  });

  test('cancel without reason -> REASON_REQUIRED; cancel with reason defers every board, emits round.cancelled + board.deferred(cancelled), public shows the E15 notice (A-07)', async () => {
    const round = await createRound(t, { title: 'Cancel' });
    const a = await join(t, { displayName: 'Ready Player' }); await readyBoard(t, a, boardSet(0));
    const b = await join(t, { displayName: 'Draft Player' }); await saveBoard(t, b, boardSet(0, 9));
    const pub = await openStream(t.baseUrl, `/events/${t.eventId}/stream`);
    const aStream = await openStream(t.baseUrl, '/me/stream', { token: a.token });
    const bStream = await openStream(t.baseUrl, '/me/stream', { token: b.token });
    const noReason = await tryCommand(t, round.roundId, 'round.cancel', round.version, {});
    assert.equal(noReason.status, 400); assert.equal(noReason.body.error.code, 'REASON_REQUIRED');
    const blank = await tryCommand(t, round.roundId, 'round.cancel', round.version, { reason: '   ' });
    assert.equal(blank.status, 400);
    assert.equal(t.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'REGISTRATION_OPEN');
    // deferred boards of earlier cancelled rounds were reassigned into this round as DRAFT when registration opened; count them
    const liveBoards = t.db.get("SELECT COUNT(*) AS c FROM boards WHERE round_id = ? AND state IN ('DRAFT','READY','LOCKED_ACTIVE')", round.roundId).c;
    assert.ok(liveBoards >= 2);
    const c = await command(t, round.roundId, 'round.cancel', round.version, { reason: 'Projector failure' });
    assert.equal(c.round.state, 'CANCELLED'); assert.equal(c.round.cancellationReason, 'Projector failure'); assert.equal(c.effects.deferredBoards, liveBoards);
    assert.equal(t.db.get("SELECT COUNT(*) AS c FROM boards WHERE round_id = ? AND state = 'DEFERRED'", round.roundId).c, liveBoards, 'every live board of the round is DEFERRED');
    await pub.waitFor(ev => ev.some(e => e.event === 'round.cancelled'), 2000, 'round.cancelled');
    const cancelled = pub.events.find(e => e.event === 'round.cancelled');
    assert.equal(cancelled.data.payload.reason, 'Projector failure'); assert.equal(cancelled.data.payload.round.state, 'CANCELLED');
    for (const [name, s] of [['ready', aStream], ['draft', bStream]]) {
      await s.waitFor(ev => ev.some(e => e.event === 'board.deferred'), 2000, `${name} board.deferred`);
      const d = s.events.find(e => e.event === 'board.deferred');
      assert.equal(d.data.payload.reason, 'cancelled', name); assert.equal(d.data.payload.board.state, 'DEFERRED'); assert.equal(d.data.payload.board.cells, null, 'positions cleared on deferral');
    }
    assert.equal(exception('E15').copy, 'This round was cancelled. Your board is saved for the next round.', 'E15 copy in the catalog for the deferred players');
    const am = await me(t, a);
    assert.equal(am.board.state, 'DEFERRED'); assert.deepEqual(am.board.selectedSkillIds, boardSet(0), 'selections preserved'); assert.equal(am.soul, null, 'no Soul for a cancelled round');
    const snap = (await t.api.get(`/events/${t.eventId}/snapshot`)).body;
    assert.equal(snap.publicState, 'Waiting'); assert.deepEqual(snap.notice, { kind: 'cancelled', text: copy('public.cancelled') }); assert.equal(snap.join, null);
    const stage = (await t.api.get(`/stage/events/${t.eventId}/snapshot`, t.stage)).body;
    assert.equal(stage.notice.kind, 'cancelled'); assert.equal(stage.round.cancellationReason, 'Projector failure');
    const adm = (await t.api.get(`/admin/events/${t.eventId}/snapshot`, t.admin)).body;
    assert.equal(adm.rounds.find(r => r.roundId === round.roundId).cancellationReason, 'Projector failure');
    const afterCancel = await tryCommand(t, round.roundId, 'round.registration.open', c.resultingVersion);
    assert.equal(afterCancel.status, 409, 'CANCELLED is terminal');
    for (const s of [pub, aStream, bStream]) { s.close(); await s.done; }
  });

  test('audit reconstructs a full round: every accepted transition follows the state-machine contract, draw order, winners and rejections with actor + correlation ids (A-09, AC 15)', async () => {
    const round = await createRound(t, { title: 'Audit' });
    const a = await join(t), b = await join(t);
    await readyBoard(t, a, boardSet(0)); await readyBoard(t, b, boardSet(0));
    await tryCommand(t, round.roundId, 'round.draw.next', round.version); // illegal before the start
    await tryCommand(t, round.roundId, 'round.start_now', round.version + 9, { confirmed: true }); // stale
    const started = await startRound(t, round);
    const { results, round: end } = await drawUntilEnd(t, started);
    assert.equal(end.state, 'WINNER');
    await tryCommand(t, round.roundId, 'round.draw.next', end.version); // illegal after WINNER
    const res = await t.api.get(`/admin/events/${t.eventId}/audit?roundId=${round.roundId}&limit=1000`, t.admin);
    assert.equal(res.status, 200);
    const chrono = res.body.entries.slice().reverse();
    assert.ok(chrono.every((e, i) => i === 0 || e.id > chrono[i - 1].id));
    for (const e of chrono) { assert.ok(e.actor && e.action && e.outcome && e.correlationId && e.at, JSON.stringify(e)); assert.equal(e.roundId, round.roundId); }
    const accepted = chrono.filter(e => e.actor === 'admin' && e.outcome === 'accepted');
    assert.deepEqual(accepted.slice(0, 3).map(e => e.action), ['round.create', 'round.registration.open', 'round.start_now']);
    assert.ok(accepted.slice(3).every(e => e.action === 'round.draw.next'));
    // every accepted transition (from, command, to) exists in contracts/round-state-machine.json
    for (const e of accepted.filter(e => e.details?.fromState)) {
      const ok = sm.round.transitions.some(tr => tr.from === e.details.fromState && tr.command === e.action && tr.to === e.details.toState);
      assert.ok(ok, `transition ${e.details.fromState} --${e.action}--> ${e.details.toState} is in the contract`);
    }
    const versions = accepted.map(e => e.actualVersion);
    assert.deepEqual(versions, versions.map((_, i) => i + 1), 'one version increment per accepted command');
    const draws = accepted.filter(e => e.action === 'round.draw.next');
    assert.equal(draws.length, results.length);
    assert.deepEqual(draws.map(d => d.details.drawNumber), results.map((_, i) => i + 1));
    assert.deepEqual(draws.map(d => d.details.skillId), results.map(r => r.effects.draw.skill.id), 'audit draw order equals the accepted order');
    assert.ok(draws.every(d => d.commandId), 'each draw records its command (idempotency) id');
    assert.ok(draws.every(d => ['hold', 'open', 'push', 'build', 'fallback'].includes(d.details.drawMode)), 'each draw records how the guided draw picked it (D-33)');
    assert.equal(draws.at(-1).details.outcome, 'WINNER'); assert.deepEqual(draws.at(-1).details.winners.sort(), results.at(-1).effects.winners.map(w => w.participantId).sort());
    const rejected = chrono.filter(e => e.outcome === 'rejected' && e.actor === 'admin');
    assert.deepEqual(rejected.map(e => e.details.code), ['ILLEGAL_TRANSITION', 'STALE_VERSION', 'ILLEGAL_TRANSITION']);
    assert.equal(rejected[1].expectedVersion, round.version + 9); assert.equal(rejected[1].actualVersion, round.version);
    const players = chrono.filter(e => [a.participantId, b.participantId].includes(e.actor)).map(e => e.action);
    assert.deepEqual([...new Set(players)].sort(), ['board.finalize', 'board.selections.save']);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(a.token) && !text.includes(a.employeeRef) && !text.includes('selectedSkillIds'), 'audit never contains secrets or selections');
    const adm = (await t.api.get(`/admin/events/${t.eventId}/snapshot`, t.admin)).body.currentRound;
    assert.deepEqual(adm.draws.map(d => d.skill.id), draws.map(d => d.details.skillId));
    assert.equal(adm.lastCommand.command, 'round.draw.next'); assert.equal(adm.lastCommand.outcome, 'rejected', 'last command was the rejected post-WINNER draw');
    const all = (await t.api.get(`/admin/events/${t.eventId}/audit?limit=5`, t.admin)).body.entries;
    assert.equal(all.length, 5);
    const authFail = await t.api.get(`/admin/events/${t.eventId}/audit`, t.stage);
    assert.equal(authFail.status, 403, 'stage token cannot read the audit log');
    assert.ok(t.db.get("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'auth.reject' AND actor = 'stage'").c >= 1, 'authz rejections are audited');
  });

  test('rate limit: a burst of admin commands beyond 10/s and session creations beyond 5/min answer 429 RATE_LIMITED with the error envelope', async () => {
    const s = await startServer({ rateLimits: { commandsPerSec: 10, sessionPerMin: 5, discoveryPerSec: 20 } });
    try {
      const round = await createRound(s, { title: 'Burst' }); // 2 commands consumed
      const burst = await Promise.all([...Array(25)].map(() => tryCommand(s, round.roundId, 'round.reschedule', 999, { title: 'x' })));
      const limited = burst.filter(r => r.status === 429);
      assert.ok(limited.length >= 10, `at least 10 of 25 burst commands are rate limited (got ${limited.length})`);
      assert.ok(burst.some(r => r.status === 409), 'requests inside the bucket are still evaluated');
      for (const r of limited) { assert.equal(r.body.error.code, 'RATE_LIMITED'); assert.equal(r.body.error.exceptionId, null); assert.ok(r.body.correlationId && r.body.serverTime); }
      assert.equal(s.db.get('SELECT version FROM rounds WHERE id = ?', round.roundId).version, round.version, 'burst mutated nothing');
      const sessions = await Promise.all([...Array(8)].map((_, i) => s.api.post(`/events/${s.eventId}/session`, { joinToken: s.joinToken(), employeeRef: `burst-${i}`, displayName: 'B', consentPublicName: false })));
      assert.equal(sessions.filter(r => r.status === 201).length, 5); assert.equal(sessions.filter(r => r.status === 429).length, 3);
      await sleep(1100);
      const after = await tryCommand(s, round.roundId, 'round.reschedule', 999, { title: 'x' });
      assert.equal(after.status, 409, 'bucket refills after a second');
    } finally { await s.close(); }
  });
});
