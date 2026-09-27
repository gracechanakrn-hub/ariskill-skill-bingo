import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, tryCommand, join, readyBoard, saveBoard, finalizeBoard, boardSet, setPool, startRound, drawUntilEnd, EVENT_ID, lineScenario, CELLS, GRID } from './helpers.js';
import { POOL_MINIMUM } from '../../../packages/game-rules/src/index.js';

describe('round state machine, lock, start, cancel, timers (A-01, A-07, BR-05..BR-08, E15, E20, E23)', () => {
  let t;
  // Plain uniform random draws (drawGuidance: false): WINNER/EXHAUSTED cases need exact draw counts.
  before(async () => { t = await startServer({ drawGuidance: false }); });
  after(async () => { await t.close(); });

  test('create -> DRAFT; illegal command is ILLEGAL_TRANSITION; stale version is STALE_VERSION with snapshot; neither mutates', async () => {
    const r = await t.api.post(`/admin/events/${EVENT_ID}/rounds`, { title: 'R', lockAt: new Date(t.clock.now() + 60000).toISOString(), resultWindowSeconds: 30 }, t.admin);
    assert.equal(r.status, 201); assert.equal(r.body.round.state, 'DRAFT'); assert.equal(r.body.round.version, 1); assert.equal(r.body.round.resultWindowSeconds, 15, 'clamped to 10-15');
    const ill = await tryCommand(t, r.body.round.roundId, 'round.start', 1);
    assert.equal(ill.status, 409); assert.equal(ill.body.error.code, 'ILLEGAL_TRANSITION'); assert.equal(ill.body.error.exceptionId, 'E10');
    const stale = await tryCommand(t, r.body.round.roundId, 'round.registration.open', 7);
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'STALE_VERSION'); assert.equal(stale.body.error.details.currentVersion, 1); assert.equal(stale.body.error.details.snapshot.state, 'DRAFT');
    const bad = await tryCommand(t, r.body.round.roundId, 'round.fly', 1);
    assert.equal(bad.status, 400);
    const adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body;
    assert.equal(adm.rounds.find(x => x.roundId === r.body.round.roundId).version, 1);
    await command(t, r.body.round.roundId, 'round.cancel', 1, { reason: 'cleanup' });
  });

  test('registration.open requires a future lockAt; reschedule requires a future lockAt', async () => {
    const past = await t.api.post(`/admin/events/${EVENT_ID}/rounds`, { title: 'Past', lockAt: new Date(t.clock.now() - 1000).toISOString() }, t.admin);
    const open = await tryCommand(t, past.body.round.roundId, 'round.registration.open', 1);
    assert.equal(open.status, 400); assert.equal(open.body.error.code, 'VALIDATION');
    const fixed = await command(t, past.body.round.roundId, 'round.update', 1, { lockAt: new Date(t.clock.now() + 60000).toISOString(), title: 'Fixed' });
    assert.equal(fixed.round.title, 'Fixed'); assert.equal(fixed.resultingVersion, 2);
    const opened = await command(t, past.body.round.roundId, 'round.registration.open', 2);
    assert.equal(opened.round.state, 'REGISTRATION_OPEN');
    const bad = await tryCommand(t, past.body.round.roundId, 'round.reschedule', 3, { lockAt: new Date(t.clock.now() - 5).toISOString() });
    assert.equal(bad.status, 400);
    await command(t, past.body.round.roundId, 'round.cancel', 3, { reason: 'cleanup' });
  });

  test('lock is atomic: READY -> LOCKED_ACTIVE, DRAFT -> DEFERRED (E5), pool snapshot, one version increment', async () => {
    const round = await createRound(t);
    const a = await join(t), b = await join(t), c = await join(t);
    await readyBoard(t, a, boardSet(0)); await readyBoard(t, b, boardSet(12)); await saveBoard(t, c, boardSet(0, 10));
    const l = await command(t, round.roundId, 'round.lock', round.version);
    assert.equal(l.round.state, 'LOCKED'); assert.equal(l.resultingVersion, round.version + 1);
    assert.deepEqual({ a: l.effects.activeBoards, d: l.effects.deferredBoards }, { a: 2, d: 1 });
    assert.equal((await t.api.get('/me', a.token)).body.board.state, 'LOCKED_ACTIVE');
    const cm = (await t.api.get('/me', c.token)).body;
    assert.equal(cm.board.state, 'DEFERRED'); assert.deepEqual(cm.board.selectedSkillIds, boardSet(0, 10)); assert.equal(cm.board.cells, null);
    const adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body.currentRound;
    assert.equal(adm.readiness.poolSize, new Set([...boardSet(0), ...boardSet(12)]).size); assert.equal(adm.readiness.poolSize, 28); assert.equal(adm.readiness.anyBoardCanWin, true); assert.equal(adm.readiness.boardsThatCanWin, 2);
    assert.deepEqual({ ...adm.counts, connections: undefined }, { joined: adm.counts.joined, completed: 2, incomplete: 0, active: 2, deferred: 1, matchedBoards: 0, connections: undefined });
    await command(t, round.roundId, 'round.cancel', l.resultingVersion, { reason: 'cleanup' });
  });

  test('countdown reaching lockAt locks (actor=system) but never starts play and never draws; startOverdue flags after 60 s', async () => {
    const round = await createRound(t, { lockAtMs: 5000 });
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    t.clock.set(t.clock.now() + 6000);
    try {
      t.app.timers.tick();
      let r = t.db.get('SELECT * FROM rounds WHERE id = ?', round.roundId);
      assert.equal(r.state, 'LOCKED'); assert.equal(r.version, round.version + 1); assert.equal(r.started_at, null);
      assert.equal(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, 0);
      const audit = (await t.api.get(`/admin/events/${EVENT_ID}/audit?roundId=${round.roundId}`, t.admin)).body.entries;
      const lockEntry = audit.find(e => e.action === 'round.lock');
      assert.equal(lockEntry.actor, 'system'); assert.equal(lockEntry.outcome, 'accepted');
      let adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body.currentRound;
      assert.equal(adm.readiness.startOverdue, false);
      t.clock.advance(61000); t.app.timers.tick();
      adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body.currentRound;
      assert.equal(adm.readiness.startOverdue, true); assert.equal(adm.summary.state, 'LOCKED', 'still no automatic start');
      const st = (await t.api.get(`/stage/events/${EVENT_ID}/snapshot`, t.stage)).body;
      assert.equal(st.round.startOverdue, true);
      r = t.db.get('SELECT * FROM rounds WHERE id = ?', round.roundId);
      await command(t, round.roundId, 'round.cancel', r.version, { reason: 'cleanup' });
    } finally { t.clock.unfreeze(); }
  });

  test('start is blocked with pool < 5 (POOL_TOO_SMALL, E20) and the round stays LOCKED', async () => {
    const round = await createRound(t);
    // Any 16-skill board gives a pool of at least 16 (D-33), so the snapshot is narrowed to POOL_MINIMUM - 1 skills.
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const l = await command(t, round.roundId, 'round.lock', round.version);
    setPool(t.db, round.roundId, boardSet(0, POOL_MINIMUM - 1));
    const s = await tryCommand(t, round.roundId, 'round.start', l.resultingVersion);
    assert.equal(s.status, 409); assert.equal(s.body.error.code, 'POOL_TOO_SMALL'); assert.equal(s.body.error.exceptionId, 'E20'); assert.equal(s.body.error.details.poolSize, 4);
    const r = t.db.get('SELECT state, version FROM rounds WHERE id = ?', round.roundId);
    assert.equal(r.state, 'LOCKED'); assert.equal(r.version, l.resultingVersion);
    await command(t, round.roundId, 'round.cancel', l.resultingVersion, { reason: 'cleanup' });
  });

  test('start_now requires params.confirmed === true; when confirmed it locks and starts atomically with one version increment', async () => {
    const round = await createRound(t);
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const b = await join(t); await saveBoard(t, b, boardSet(0, 3));
    const draftsBefore = t.db.get("SELECT COUNT(*) AS c FROM boards WHERE round_id = ? AND state = 'DRAFT'", round.roundId).c;
    const un = await tryCommand(t, round.roundId, 'round.start_now', round.version, {});
    assert.equal(un.status, 400); assert.equal(un.body.error.code, 'VALIDATION');
    assert.equal(t.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'REGISTRATION_OPEN');
    const ok = await command(t, round.roundId, 'round.start_now', round.version, { confirmed: true });
    assert.equal(ok.round.state, 'PLAYING'); assert.equal(ok.resultingVersion, round.version + 1);
    assert.equal(ok.effects.activeBoards, 1); assert.equal(ok.effects.deferredBoards, draftsBefore); assert.ok(draftsBefore >= 1); assert.equal(ok.effects.poolSize, CELLS);
    await command(t, round.roundId, 'round.cancel', ok.resultingVersion, { reason: 'cleanup' });
  });

  test('start_now with a pool < 5 is rejected and the round stays REGISTRATION_OPEN (atomic lock+start rolled back)', async () => {
    const round = await createRound(t);
    // Only a DRAFT board (3 skills): it is deferred by the lock, so the pool is empty.
    const a = await join(t); await saveBoard(t, a, boardSet(0, 3));
    const r = await tryCommand(t, round.roundId, 'round.start_now', round.version, { confirmed: true });
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'POOL_TOO_SMALL'); assert.equal(r.body.error.details.poolSize, 0);
    assert.equal(t.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'REGISTRATION_OPEN');
    assert.equal((await t.api.get('/me', a.token)).body.board.state, 'DRAFT', 'rolled back: not deferred');
    await command(t, round.roundId, 'round.cancel', round.version, { reason: 'cleanup' });
  });

  test('cancel requires a reason (REASON_REQUIRED); cancelled round defers READY and LOCKED_ACTIVE boards (E15) and creates no Souls', async () => {
    const round = await createRound(t);
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const b = await join(t); await readyBoard(t, b, boardSet(CELLS));
    const started = await startRound(t, round);
    await command(t, round.roundId, 'round.draw.next', started.version);
    const v = t.db.get('SELECT version FROM rounds WHERE id = ?', round.roundId).version;
    const noReason = await tryCommand(t, round.roundId, 'round.cancel', v, {});
    assert.equal(noReason.status, 400); assert.equal(noReason.body.error.code, 'REASON_REQUIRED');
    const c = await command(t, round.roundId, 'round.cancel', v, { reason: 'Projector failure' });
    assert.equal(c.round.state, 'CANCELLED'); assert.equal(c.round.cancellationReason, 'Projector failure'); assert.equal(c.effects.deferredBoards, 2);
    const me = (await t.api.get('/me', a.token)).body;
    assert.equal(me.board.state, 'DEFERRED'); assert.deepEqual(me.board.selectedSkillIds, boardSet(0)); assert.equal(me.soul, null);
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM souls WHERE round_id = ?', round.roundId).c, 0);
    const pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub.publicState, 'Waiting'); assert.equal(pub.notice.kind, 'cancelled');
    const later = await tryCommand(t, round.roundId, 'round.draw.next', c.resultingVersion);
    assert.equal(later.status, 409); assert.equal(later.body.error.code, 'ILLEGAL_TRANSITION');
  });

  test('deferred boards are reassigned as DRAFT (selections kept, positions cleared) when the next registration opens; board.saved emitted', async () => {
    const round = await createRound(t);
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const b = await join(t); await saveBoard(t, b, boardSet(0, 7));
    const l = await command(t, round.roundId, 'round.lock', round.version);
    await command(t, round.roundId, 'round.cancel', l.resultingVersion, { reason: 'move on' });
    const seqBefore = t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', EVENT_ID).s;
    const next = await createRound(t, { title: 'Round next' });
    for (const p of [a, b]) {
      const me = (await t.api.get('/me', p.token)).body;
      assert.equal(me.round.roundId, next.roundId); assert.equal(me.board.state, 'DRAFT'); assert.equal(me.board.cells, null); assert.equal(me.board.version, 1);
    }
    assert.deepEqual((await t.api.get('/me', a.token)).body.board.selectedSkillIds, boardSet(0));
    assert.deepEqual((await t.api.get('/me', b.token)).body.board.selectedSkillIds, boardSet(0, 7));
    const saved = t.db.all("SELECT participant_id FROM events_outbox WHERE event_id = ? AND sequence > ? AND type = 'board.saved'", EVENT_ID, seqBefore).map(r => r.participant_id).sort();
    for (const id of [a.participantId, b.participantId]) assert.ok(saved.includes(id));
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM boards WHERE round_id = ? AND participant_id = ?', next.roundId, a.participantId).c, 1);
    const cancelled = await command(t, next.roundId, 'round.cancel', next.version, { reason: 'cleanup' });
    // a second open must not duplicate: the old boards were marked reassigned, the new ones are deferred again
    const third = await createRound(t, { title: 'Round third' });
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM boards WHERE round_id = ? AND participant_id IN (?, ?)', third.roundId, a.participantId, b.participantId).c, 2);
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM boards WHERE round_id = ?', third.roundId).c, t.db.get('SELECT COUNT(*) AS c FROM boards WHERE round_id = ?', next.roundId).c, 'every deferred board reassigned exactly once');
    await command(t, third.roundId, 'round.cancel', third.version, { reason: 'cleanup' });
    assert.equal(cancelled.round.state, 'CANCELLED');
  });

  test('F-01: a DEFERRED(late) board is reassigned into the next opened round as DRAFT with selections intact and no positions', async () => {
    const round = await createRound(t, { title: 'Late source' });
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const started = await startRound(t, round);
    const late = await join(t, { displayName: 'Late Joiner' });
    const save = await saveBoard(t, late, boardSet(30, 12), 0);
    assert.equal(save.status, 200); assert.equal(save.body.board.state, 'DEFERRED');
    let me = (await t.api.get('/me', late.token)).body;
    assert.equal(me.round.roundId, round.roundId); assert.equal(me.board.state, 'DEFERRED'); assert.equal(me.nextRound, null);
    await command(t, round.roundId, 'round.cancel', started.version, { reason: 'move on' });
    const seqBefore = t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', EVENT_ID).s;
    const next = await createRound(t, { title: 'Late target' });
    me = (await t.api.get('/me', late.token)).body;
    assert.equal(me.round.roundId, next.roundId); assert.equal(me.board.state, 'DRAFT'); assert.equal(me.board.cells, null); assert.equal(me.board.version, 1);
    assert.deepEqual(me.board.selectedSkillIds, boardSet(30, 12));
    const saved = t.db.all("SELECT participant_id FROM events_outbox WHERE event_id = ? AND sequence > ? AND type = 'board.saved'", EVENT_ID, seqBefore).map(r => r.participant_id);
    assert.ok(saved.includes(late.participantId));
    assert.equal(t.db.get('SELECT reassigned_to FROM boards WHERE round_id = ? AND participant_id = ?', round.roundId, late.participantId).reassigned_to, me.board.boardId);
    const s2 = await saveBoard(t, late, boardSet(30), 1);
    assert.equal(s2.status, 200); assert.equal(s2.body.board.state, 'DRAFT');
    const fin = await finalizeBoard(t, late);
    assert.equal(fin.status, 200); assert.equal(fin.body.board.state, 'READY'); assert.equal(fin.body.board.cells.length, CELLS);
    await command(t, next.roundId, 'round.cancel', next.version, { reason: 'cleanup' });
  });

  test('WINNER auto-closes after resultWindowSeconds via the timer; result stays visible', async () => {
    const { round, p } = await lineScenario(t);
    const { round: end } = await drawUntilEnd(t, round);
    assert.equal(end.state, 'WINNER');
    const r = t.db.get('SELECT * FROM rounds WHERE id = ?', round.roundId);
    t.clock.set(Date.parse(r.published_at) + 5000);
    try {
      t.app.timers.tick();
      assert.equal(t.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'WINNER');
      t.clock.advance(8000); t.app.timers.tick();
      const closed = t.db.get('SELECT state, version FROM rounds WHERE id = ?', round.roundId);
      assert.equal(closed.state, 'CLOSED'); assert.equal(closed.version, end.version + 1);
      const pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
      assert.equal(pub.publicState, 'Waiting'); assert.equal(pub.round.state, 'CLOSED'); assert.equal(pub.winners.length, 1);
      const me = (await t.api.get('/me', p.token)).body;
      assert.equal(me.result.isWinner, true); assert.equal(me.board.state, 'FINISHED');
    } finally { t.clock.unfreeze(); }
  });

  test('EXHAUSTED (E23): pool empties without a winner, then round.close -> CLOSED; Souls exist without badge', async () => {
    const { round, p } = await lineScenario(t, { linePositions: [0, 1, 2, 4] }); // the pool's four skills are on no single line
    const { results, round: end } = await drawUntilEnd(t, round);
    assert.equal(results.length, GRID); assert.equal(end.state, 'EXHAUSTED');
    const me = (await t.api.get('/me', p.token)).body;
    assert.equal(me.board.state, 'FINISHED'); assert.equal(me.result.isWinner, false); assert.equal(me.soul.badge, null); assert.ok(me.soul.floatToken);
    const pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub.notice.kind, 'exhausted'); assert.equal(pub.publicState, 'Waiting');
    const draw = await tryCommand(t, round.roundId, 'round.draw.next', end.version);
    assert.equal(draw.status, 409); assert.equal(draw.body.error.code, 'ILLEGAL_TRANSITION');
    const c = await command(t, round.roundId, 'round.close', end.version);
    assert.equal(c.round.state, 'CLOSED');
  });
});
