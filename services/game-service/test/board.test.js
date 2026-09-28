import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, join, saveBoard, finalizeBoard, readyBoard, boardSet, ELIGIBLE_IDS, ALL_IDS, nextKey, EVENT_ID, CELLS, REQUIRED_SELECTIONS } from './helpers.js';

describe('board: selection, finalize, versions, idempotency (M-04..M-07, BR-01, BR-02, BR-04, D-12)', () => {
  let t, round;
  before(async () => { t = await startServer(); round = await createRound(t); });
  after(async () => { await t.close(); });

  test('no prefill: platform/role are null after join and saving/discovery before profile is PROFILE_REQUIRED (E16)', async () => {
    const p = await join(t, { profile: null });
    const me = await t.api.get('/me', p.token);
    assert.equal(me.status, 200); assert.equal(me.body.participant.platformId, null); assert.equal(me.body.participant.roleId, null); assert.equal(me.body.board, null);
    const s = await t.api.put('/me/board/selections', { skillIds: [ELIGIBLE_IDS[0]], boardVersion: 0 }, p.token);
    assert.equal(s.status, 409); assert.equal(s.body.error.code, 'PROFILE_REQUIRED'); assert.equal(s.body.error.exceptionId, 'E16');
    const d = await t.api.get('/skills/discovery?mode=recommended', p.token);
    assert.equal(d.status, 409); assert.equal(d.body.error.code, 'PROFILE_REQUIRED');
  });

  test('duplicate skill in the list is DUPLICATE_SKILL (E4) with no mutation; 17 skills and unknown skills are VALIDATION', async () => {
    const p = await join(t);
    const dup = await saveBoard(t, p, [ELIGIBLE_IDS[0], ELIGIBLE_IDS[1], ELIGIBLE_IDS[0]]);
    assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'DUPLICATE_SKILL'); assert.equal(dup.body.error.exceptionId, 'E4');
    assert.equal((await t.api.get('/me', p.token)).body.board, null, 'no board created by the rejected save');
    const many = await saveBoard(t, p, ALL_IDS.slice(0, REQUIRED_SELECTIONS + 1));
    assert.equal(many.status, 400); assert.equal(many.body.error.code, 'VALIDATION');
    const unknown = await saveBoard(t, p, ['skill_does_not_exist']);
    assert.equal(unknown.status, 400);
    const ok = await saveBoard(t, p, ELIGIBLE_IDS.slice(0, 3));
    assert.equal(ok.status, 200); assert.equal(ok.body.board.state, 'DRAFT'); assert.equal(ok.body.board.cells, null); assert.equal(ok.body.resultingVersion, 1);
    assert.ok(ok.body.correlationId && ok.body.serverTime, 'envelope fields');
  });

  test('finalize needs exactly 16; positions are a server permutation; client-supplied positions are ignored; matrixVersion snapshot', async () => {
    const p = await join(t);
    await saveBoard(t, p, boardSet(0, REQUIRED_SELECTIONS - 1));
    const short = await finalizeBoard(t, p);
    assert.equal(short.status, 400); assert.equal(short.body.error.code, 'VALIDATION');
    const set = boardSet(0, REQUIRED_SELECTIONS);
    await saveBoard(t, p, set);
    const me = await t.api.get('/me', p.token);
    const fin = await t.api.post('/me/board/finalize', { boardVersion: me.body.board.version, cells: set.map((skillId, position) => ({ position, skillId })), positions: [...Array(CELLS).keys()] }, p.token);
    assert.equal(fin.status, 200);
    const b = fin.body.board;
    assert.equal(b.state, 'READY'); assert.equal(b.cells.length, CELLS); assert.equal(b.matrixVersion, 'skill-matrix-2026-tech-role-20260319');
    assert.deepEqual(b.cells.map(c => c.position), [...Array(CELLS).keys()]);
    assert.deepEqual(b.cells.map(c => c.skillId).sort(), set.slice().sort(), 'cells are a permutation of the selection');
    assert.notDeepEqual(b.cells.map(c => c.skillId), set, 'server shuffled (client order not accepted)');
    assert.ok(b.cells.every(c => typeof c.name === 'string' && ['Core', 'Critical', 'Optional'].includes(c.kind)));
    assert.deepEqual(b.matchedPositions, []);
  });

  test('identical set is a no-op; changed set on READY returns to DRAFT with cleared positions (D-12) and the layout is re-randomized', async () => {
    const p = await join(t);
    const set = boardSet(10);
    const b1 = await readyBoard(t, p, set);
    const same = await saveBoard(t, p, set);
    assert.equal(same.status, 200); assert.equal(same.body.board.state, 'READY'); assert.equal(same.body.resultingVersion, b1.version);
    const changed = [...set.slice(0, REQUIRED_SELECTIONS - 1), ELIGIBLE_IDS[60]];
    const s2 = await saveBoard(t, p, changed);
    assert.equal(s2.status, 200); assert.equal(s2.body.board.state, 'DRAFT'); assert.equal(s2.body.board.cells, null); assert.equal(s2.body.board.matrixVersion, null); assert.equal(s2.body.resultingVersion, b1.version + 1);
    const f2 = await finalizeBoard(t, p);
    assert.equal(f2.status, 200); assert.equal(f2.body.board.state, 'READY');
    assert.deepEqual(f2.body.board.cells.map(c => c.skillId).sort(), changed.slice().sort());
  });

  test('boardVersion mismatch is STALE_VERSION (E10) with currentVersion and a board snapshot, no mutation', async () => {
    const p = await join(t);
    await saveBoard(t, p, boardSet(0, 5));
    const stale = await t.api.put('/me/board/selections', { skillIds: boardSet(0, 6), boardVersion: 0 }, p.token);
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'STALE_VERSION'); assert.equal(stale.body.error.exceptionId, 'E10');
    assert.equal(stale.body.error.details.currentVersion, 1); assert.equal(stale.body.error.details.snapshot.selectedSkillIds.length, 5);
    assert.equal((await t.api.get('/me', p.token)).body.board.selectedSkillIds.length, 5);
  });

  test('idempotency: missing key is VALIDATION; same key + same body replays the stored response; same key + different body is 422', async () => {
    const p = await join(t);
    const noKey = await t.api.call('PUT', '/me/board/selections', { body: { skillIds: boardSet(0, 2), boardVersion: 0 }, token: p.token });
    assert.equal(noKey.status, 400); assert.equal(noKey.body.error.code, 'VALIDATION');
    const key = nextKey('idem');
    const a = await t.api.put('/me/board/selections', { skillIds: boardSet(0, 2), boardVersion: 0 }, p.token, key);
    const b = await t.api.put('/me/board/selections', { skillIds: boardSet(0, 2), boardVersion: 0 }, p.token, key);
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.deepEqual(b.body, a.body); assert.equal(b.headers.get('idempotent-replay'), 'true');
    assert.equal((await t.api.get('/me', p.token)).body.board.version, 1, 'no second mutation');
    const c = await t.api.put('/me/board/selections', { skillIds: boardSet(0, 3), boardVersion: 1 }, p.token, key);
    assert.equal(c.status, 422); assert.equal(c.body.error.code, 'IDEMPOTENCY_MISMATCH');
  });

  test('BR-07: a save arriving after lockAt is ROUND_LOCKED (E8) even before the start transaction ran', async () => {
    const p = await join(t);
    await saveBoard(t, p, boardSet(0, 3));
    const r = t.db.get('SELECT lock_at, state FROM rounds WHERE id = ?', round.roundId);
    assert.equal(r.state, 'REGISTRATION_OPEN');
    t.clock.set(Date.parse(r.lock_at) + 1);
    try {
      const late = await saveBoard(t, p, boardSet(0, 4), 1);
      assert.equal(late.status, 409); assert.equal(late.body.error.code, 'ROUND_LOCKED'); assert.equal(late.body.error.exceptionId, 'E8');
      assert.equal(t.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'REGISTRATION_OPEN', 'start transaction has not run yet');
      assert.equal((await t.api.get('/me', p.token)).body.board.selectedSkillIds.length, 3);
      const fin = await t.api.post('/me/board/finalize', { boardVersion: 1 }, p.token);
      assert.equal(fin.status, 409); assert.equal(fin.body.error.code, 'ROUND_LOCKED');
    } finally { t.clock.unfreeze(); }
  });

  test('F-01: a late joiner saving while the round is PLAYING gets a DEFERRED(late) board (200 + E8 notice + board.deferred); an in-play board still gets E8', async () => {
    const s = await startServer();
    try {
      const r = await createRound(s);
      const early = await join(s, { displayName: 'Early' }); await readyBoard(s, early, boardSet(0));
      const started = await command(s, r.roundId, 'round.start_now', r.version, { confirmed: true }); // D-53: no LOCKED step
      const late = await join(s, { displayName: 'Late' });
      const seq0 = s.db.get('SELECT COALESCE(MAX(sequence),0) AS q FROM events_outbox WHERE event_id = ?', EVENT_ID).q;
      const save = await saveBoard(s, late, boardSet(5, 7), 0);
      assert.equal(save.status, 200); assert.equal(save.body.board.state, 'DEFERRED'); assert.equal(save.body.board.cells, null); assert.equal(save.body.board.roundId, r.roundId);
      assert.deepEqual(save.body.board.selectedSkillIds, boardSet(5, 7)); assert.equal(save.body.resultingVersion, 1);
      assert.equal(save.body.notice.exceptionId, 'E8'); assert.equal(save.body.notice.text, 'This round is already in progress. Your board will join the next round.');
      const ev = s.db.all("SELECT * FROM events_outbox WHERE event_id = ? AND sequence > ? AND type = 'board.deferred'", EVENT_ID, seq0);
      assert.equal(ev.length, 1); assert.equal(ev[0].participant_id, late.participantId); assert.equal(JSON.parse(ev[0].payload_json).reason, 'late');
      assert.equal(s.db.get('SELECT deferred_reason FROM boards WHERE participant_id = ?', late.participantId).deferred_reason, 'late');
      // the late draft is preserved but immutable until it is reassigned (deferred boards cannot re-enter a locked round)
      const again = await saveBoard(s, late, boardSet(5, 9), 1);
      assert.equal(again.status, 409); assert.equal(again.body.error.exceptionId, 'E8');
      assert.deepEqual((await s.api.get('/me', late.token)).body.board.selectedSkillIds, boardSet(5, 7));
      assert.equal((await s.api.get('/me', late.token)).body.board.state, 'DEFERRED');
      const fin = await s.api.post('/me/board/finalize', { boardVersion: 1 }, late.token);
      assert.equal(fin.status, 409); assert.equal(fin.body.error.code, 'ROUND_LOCKED');
      // a participant whose board is LOCKED_ACTIVE is still rejected with E8 and nothing changes
      const blocked = await saveBoard(s, early, boardSet(1), 2);
      assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'ROUND_LOCKED'); assert.equal(blocked.body.error.exceptionId, 'E8');
      assert.equal((await s.api.get('/me', early.token)).body.board.state, 'LOCKED_ACTIVE');
      const late2 = await join(s, { displayName: 'Later' });
      const save2 = await saveBoard(s, late2, boardSet(20, 3), 0);
      assert.equal(save2.status, 200); assert.equal(save2.body.board.state, 'DEFERRED');
      assert.equal(started.round.state, 'PLAYING');
      assert.equal(s.db.get('SELECT COUNT(*) AS c FROM boards WHERE round_id = ? AND state = ?', r.roundId, 'LOCKED_ACTIVE').c, 1, 'late boards never enter the pool');
    } finally { await s.close(); }
  });

  test('a participant has at most one board per round and PUT replaces the whole set', async () => {
    const p = await join(t);
    await saveBoard(t, p, boardSet(0, 3)); await saveBoard(t, p, boardSet(5, 2));
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM boards WHERE participant_id = ?', p.participantId).c, 1);
    assert.deepEqual((await t.api.get('/me', p.token)).body.board.selectedSkillIds, boardSet(5, 2));
  });

  test('participant snapshot: the round is attached and the public snapshot counts completed boards', async () => {
    const before = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body.counts.completed;
    const p = await join(t); await readyBoard(t, p, boardSet(30));
    const after = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body.counts.completed;
    assert.equal(after, before + 1);
    const me = (await t.api.get('/me', p.token)).body;
    assert.equal(me.round.roundId, round.roundId); assert.equal(me.nextRound, null); assert.equal(me.insightAvailable, false); assert.equal(me.soul, null);
  });
});
