import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, tryCommand, join, readyBoard, saveBoard, finalizeBoard, boardSet, setPool, startRound, drawUntilEnd, EVENT_ID, lineScenario, arrangeCells, nextKey, CELLS, GRID, LINE_MASKS } from './helpers.js';
import { POOL_MINIMUM } from '../../../packages/game-rules/src/index.js';

describe('round state machine, start, cancel, timers (A-01, A-07, BR-05..BR-08, E15, E20; D-53)', () => {
  let t;
  // Plain uniform random draws (drawGuidance: false): WINNER / closest-line cases need exact draw counts.
  before(async () => { t = await startServer({ drawGuidance: false }); });
  after(async () => { await t.close(); });

  test('create -> DRAFT; illegal command is ILLEGAL_TRANSITION; stale version is STALE_VERSION with snapshot; neither mutates', async () => {
    const r = await t.api.post(`/admin/events/${EVENT_ID}/rounds`, { title: 'R', lockAt: new Date(t.clock.now() + 60000).toISOString(), resultWindowSeconds: 30 }, t.admin);
    assert.equal(r.status, 201); assert.equal(r.body.round.state, 'DRAFT'); assert.equal(r.body.round.version, 1); assert.equal(r.body.round.resultWindowSeconds, 15, 'clamped to 10-15');
    const ill = await tryCommand(t, r.body.round.roundId, 'round.start_now', 1, { confirmed: true });
    assert.equal(ill.status, 409); assert.equal(ill.body.error.code, 'ILLEGAL_TRANSITION'); assert.equal(ill.body.error.exceptionId, 'E10');
    // D-53: the old lock / start / close commands no longer exist
    for (const gone of ['round.lock', 'round.start', 'round.close']) {
      const g = await tryCommand(t, r.body.round.roundId, gone, 1);
      assert.equal(g.status, 400, gone); assert.equal(g.body.error.code, 'VALIDATION'); assert.match(g.body.error.message, /unknown command/);
    }
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

  test('start is atomic (D-53): READY and partial DRAFT -> LOCKED_ACTIVE, empty DRAFT -> DEFERRED, pool snapshot, one version increment', async () => {
    const s = await startServer({ drawGuidance: false });
    try {
      const round = await createRound(s);
      const a = await join(s), b = await join(s), c = await join(s), d = await join(s);
      await readyBoard(s, a, boardSet(0)); await readyBoard(s, b, boardSet(12)); await saveBoard(s, c, boardSet(40, 10)); await saveBoard(s, d, []);
      const seq0 = s.db.get('SELECT COALESCE(MAX(sequence),0) AS q FROM events_outbox WHERE event_id = ?', EVENT_ID).q;
      const l = await command(s, round.roundId, 'round.start_now', round.version, { confirmed: true });
      assert.equal(l.round.state, 'PLAYING'); assert.equal(l.resultingVersion, round.version + 1);
      assert.deepEqual({ a: l.effects.activeBoards, u: l.effects.unfinishedBoards, d: l.effects.deferredBoards }, { a: 3, u: 1, d: 1 });
      assert.equal((await s.api.get('/me', a.token)).body.board.state, 'LOCKED_ACTIVE');
      // the unfinished board plays: its 10 skills sit on 10 distinct random cells, the other 6 spots stay blank
      const cm = (await s.api.get('/me', c.token)).body;
      assert.equal(cm.board.state, 'LOCKED_ACTIVE'); assert.deepEqual(cm.board.selectedSkillIds, boardSet(40, 10)); assert.equal(cm.board.cells.length, 10);
      assert.equal(new Set(cm.board.cells.map(x => x.position)).size, 10);
      assert.deepEqual(cm.board.cells.map(x => x.skillId).sort(), boardSet(40, 10).slice().sort());
      assert.ok(cm.board.cells.every(x => x.position >= 0 && x.position < CELLS));
      const dm = (await s.api.get('/me', d.token)).body;
      assert.equal(dm.board.state, 'DEFERRED'); assert.equal(dm.board.cells, null);
      assert.equal(s.db.get('SELECT deferred_reason FROM boards WHERE participant_id = ?', d.participantId).deferred_reason, 'incomplete');
      const adm = (await s.api.get(`/admin/events/${EVENT_ID}/snapshot`, s.admin)).body.currentRound;
      const pool = new Set([...boardSet(0), ...boardSet(12), ...boardSet(40, 10)]);
      assert.equal(adm.readiness.poolSize, pool.size); assert.equal(l.effects.poolSize, pool.size); assert.equal(adm.readiness.anyBoardCanWin, true);
      assert.equal(adm.readiness.startBlocked, false); assert.equal(adm.readiness.unfinishedBoards, 0, 'only counted while registration is open');
      assert.deepEqual({ ...adm.counts, connections: undefined }, { joined: 4, completed: 3, incomplete: 0, active: 3, deferred: 1, matchedBoards: 0, connections: undefined });
      const ev = s.db.all('SELECT type, participant_id, payload_json FROM events_outbox WHERE event_id = ? AND sequence > ?', EVENT_ID, seq0);
      assert.deepEqual(ev.filter(e => e.type === 'board.locked_active').map(e => e.participant_id).sort(), [a.participantId, b.participantId, c.participantId].sort());
      const deferred = ev.filter(e => e.type === 'board.deferred');
      assert.equal(deferred.length, 1); assert.equal(deferred[0].participant_id, d.participantId); assert.equal(JSON.parse(deferred[0].payload_json).reason, 'incomplete');
      const started = JSON.parse(ev.find(e => e.type === 'round.started').payload_json);
      assert.deepEqual({ poolSize: started.poolSize, activeBoards: started.activeBoards, unfinishedBoards: started.unfinishedBoards, deferredBoards: started.deferredBoards, state: started.round.state }, { poolSize: pool.size, activeBoards: 3, unfinishedBoards: 1, deferredBoards: 1, state: 'PLAYING' });
      assert.ok(!ev.some(e => e.type === 'round.locked'), 'no LOCKED step any more');
    } finally { await s.close(); }
  });

  test('the start time (timer, actor=system) starts play like Start now, and never draws', async () => {
    const s = await startServer({ drawGuidance: false });
    try {
      const round = await createRound(s, { lockAtMs: 5000 });
      const a = await join(s); await readyBoard(s, a, boardSet(0));
      const b = await join(s); await saveBoard(s, b, boardSet(30, 4));
      s.clock.set(s.clock.now() + 4000); s.app.timers.tick();
      assert.equal(s.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'REGISTRATION_OPEN', 'not before the start time');
      s.clock.advance(2000); s.app.timers.tick();
      const r = s.db.get('SELECT * FROM rounds WHERE id = ?', round.roundId);
      assert.equal(r.state, 'PLAYING'); assert.equal(r.version, round.version + 1); assert.ok(r.started_at);
      assert.equal(s.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, 0);
      assert.equal((await s.api.get('/me', b.token)).body.board.state, 'LOCKED_ACTIVE', 'the unfinished board plays');
      const audit = (await s.api.get(`/admin/events/${EVENT_ID}/audit?roundId=${round.roundId}`, s.admin)).body.entries;
      const startEntry = audit.find(e => e.action === 'round.start');
      assert.equal(startEntry.actor, 'system'); assert.equal(startEntry.outcome, 'accepted'); assert.equal(startEntry.details.trigger, 'start-time timer');
      assert.equal(startEntry.details.activeBoards, 2); assert.equal(startEntry.details.unfinishedBoards, 1);
      assert.equal(s.app.game.startByTimer(round.roundId), null, 'a second timer start is a no-op');
      const adm = (await s.api.get(`/admin/events/${EVENT_ID}/snapshot`, s.admin)).body.currentRound;
      assert.equal(adm.readiness.startOverdue, false); assert.equal(adm.readiness.startBlocked, false); assert.equal(adm.readiness.lockCountdownMs, null);
    } finally { await s.close(); }
  });

  test('timer start with a pool < 5 keeps the round open with startBlocked (E20), once; extending clears it and the next start time starts play', async () => {
    const s = await startServer({ drawGuidance: false });
    try {
      s.clock.set(Date.now());
      const round = await createRound(s, { lockAtMs: 5000 });
      const a = await join(s); await saveBoard(s, a, boardSet(0, 3)); // 3 skills: plays, but a pool of 3 is too small
      let adm = (await s.api.get(`/admin/events/${EVENT_ID}/snapshot`, s.admin)).body.currentRound;
      assert.equal(adm.readiness.startBlocked, false); assert.equal(adm.readiness.lockCountdownMs, 5000);
      const seq0 = s.db.get('SELECT COALESCE(MAX(sequence),0) AS q FROM events_outbox WHERE event_id = ?', EVENT_ID).q;
      s.clock.advance(6000); s.app.timers.tick();
      let r = s.db.get('SELECT * FROM rounds WHERE id = ?', round.roundId);
      assert.equal(r.state, 'REGISTRATION_OPEN'); assert.equal(r.version, round.version, 'a blocked start never bumps the version');
      assert.equal((await s.api.get('/me', a.token)).body.board.state, 'DRAFT', 'rolled back');
      adm = (await s.api.get(`/admin/events/${EVENT_ID}/snapshot`, s.admin)).body.currentRound;
      assert.equal(adm.readiness.startBlocked, true); assert.equal(adm.readiness.lockCountdownMs, 0);
      const ev = s.db.all('SELECT type, payload_json FROM events_outbox WHERE event_id = ? AND sequence > ?', EVENT_ID, seq0);
      assert.deepEqual(ev.map(e => e.type), ['round.updated']); assert.equal(JSON.parse(ev[0].payload_json).startBlocked, true);
      const rejected = (await s.api.get(`/admin/events/${EVENT_ID}/audit?roundId=${round.roundId}`, s.admin)).body.entries.find(e => e.action === 'round.start');
      assert.equal(rejected.actor, 'system'); assert.equal(rejected.outcome, 'rejected'); assert.equal(rejected.details.code, 'E20');
      // the timer does not retry while blocked
      s.clock.advance(5000); s.app.timers.tick();
      assert.equal(s.db.get('SELECT COUNT(*) AS c FROM events_outbox WHERE event_id = ? AND sequence > ?', EVENT_ID, seq0).c, 1);
      assert.equal(s.app.game.startByTimer(round.roundId), null);
      // boards cannot change after the start time (BR-07), so the admin extends first: Extend +1 counts from now and clears startBlocked
      const b = await join(s);
      assert.equal((await saveBoard(s, b, boardSet(20))).status, 409, 'still past the start time');
      const ext = await command(s, round.roundId, 'round.reschedule', round.version, { extendMinutes: 1 });
      assert.equal(ext.round.lockAt, new Date(s.clock.now() + 60000).toISOString());
      adm = (await s.api.get(`/admin/events/${EVENT_ID}/snapshot`, s.admin)).body.currentRound;
      assert.equal(adm.readiness.startBlocked, false);
      await readyBoard(s, b, boardSet(20)); // more skills arrive
      s.clock.advance(61000); s.app.timers.tick();
      r = s.db.get('SELECT * FROM rounds WHERE id = ?', round.roundId);
      assert.equal(r.state, 'PLAYING'); assert.equal(r.version, ext.resultingVersion + 1);
    } finally { await s.close(); }
  });

  test('start_now requires params.confirmed === true; when confirmed it starts atomically with one version increment and a partial board plays', async () => {
    const round = await createRound(t);
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const b = await join(t); await saveBoard(t, b, boardSet(0, 3));
    const draftsBefore = t.db.get("SELECT COUNT(*) AS c FROM boards WHERE round_id = ? AND state = 'DRAFT'", round.roundId).c;
    for (const params of [{}, { confirmed: 'yes' }, { confirmed: false }]) {
      const un = await tryCommand(t, round.roundId, 'round.start_now', round.version, params);
      assert.equal(un.status, 400); assert.equal(un.body.error.code, 'VALIDATION');
    }
    assert.equal(t.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'REGISTRATION_OPEN');
    const ok = await command(t, round.roundId, 'round.start_now', round.version, { confirmed: true });
    assert.equal(ok.round.state, 'PLAYING'); assert.equal(ok.resultingVersion, round.version + 1);
    // boards reassigned from earlier cancelled rounds of this shared server are DRAFT boards too; all of them have skills
    assert.ok(draftsBefore >= 1); assert.equal(ok.effects.activeBoards, 1 + draftsBefore); assert.equal(ok.effects.unfinishedBoards, draftsBefore); assert.equal(ok.effects.deferredBoards, 0);
    assert.equal((await t.api.get('/me', b.token)).body.board.state, 'LOCKED_ACTIVE');
    assert.ok(ok.effects.poolSize >= CELLS);
    await command(t, round.roundId, 'round.cancel', ok.resultingVersion, { reason: 'cleanup' });
  });

  test('start_now with a pool < 5 is rejected (POOL_TOO_SMALL, E20) and the round stays REGISTRATION_OPEN (start rolled back)', async () => {
    const s = await startServer();
    try {
      const round = await createRound(s);
      // Only a DRAFT board with 3 skills: it would play, but the pool of 3 is under POOL_MINIMUM.
      const a = await join(s); await saveBoard(s, a, boardSet(0, POOL_MINIMUM - 2));
      const r = await tryCommand(s, round.roundId, 'round.start_now', round.version, { confirmed: true });
      assert.equal(r.status, 409); assert.equal(r.body.error.code, 'POOL_TOO_SMALL'); assert.equal(r.body.error.exceptionId, 'E20'); assert.equal(r.body.error.details.poolSize, POOL_MINIMUM - 2);
      const row = s.db.get('SELECT state, version FROM rounds WHERE id = ?', round.roundId);
      assert.equal(row.state, 'REGISTRATION_OPEN'); assert.equal(row.version, round.version);
      const me = (await s.api.get('/me', a.token)).body;
      assert.equal(me.board.state, 'DRAFT', 'rolled back: not locked'); assert.equal(s.db.get('SELECT COUNT(*) AS c FROM board_cells c JOIN boards b ON b.id = c.board_id WHERE b.participant_id = ?', a.participantId).c, 0);
      // with only an empty board nothing plays at all: pool 0
      const e = await join(s); await saveBoard(s, e, []);
      await saveBoard(s, a, [], 1);
      const r0 = await tryCommand(s, round.roundId, 'round.start_now', round.version, { confirmed: true });
      assert.equal(r0.body.error.code, 'POOL_TOO_SMALL'); assert.equal(r0.body.error.details.poolSize, 0);
    } finally { await s.close(); }
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
    // a and b plus any boards reassigned from earlier cancelled rounds of this shared server (they all play since D-53)
    const inPlay = t.db.get("SELECT COUNT(*) AS c FROM boards WHERE round_id = ? AND state = 'LOCKED_ACTIVE'", round.roundId).c;
    assert.ok(inPlay >= 2);
    const c = await command(t, round.roundId, 'round.cancel', v, { reason: 'Projector failure' });
    assert.equal(c.round.state, 'CANCELLED'); assert.equal(c.round.cancellationReason, 'Projector failure'); assert.equal(c.effects.deferredBoards, inPlay);
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
    const l = await command(t, round.roundId, 'round.start_now', round.version, { confirmed: true });
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

  test('always a winner (D-53): the pool empties without a full line, so the boards with the most tiles in one line win (co-winners on ties)', async () => {
    const { round, p, others } = await lineScenario(t, { linePositions: [0, 1, 2, 4], extraPlayers: [ // row-0 holds 3 of the 4 pool skills
      { join: { displayName: 'Tie' }, linePositions: [15, 14, 13, 0] }, // row-3 holds 3 -> co-winner
      { join: { displayName: 'Two' }, linePositions: [0, 5, 2, 7] },   // at most 2 in any line -> not a winner
    ] });
    const { results, round: end } = await drawUntilEnd(t, round);
    assert.equal(results.length, GRID); assert.equal(end.state, 'WINNER');
    assert.ok(results.slice(0, -1).every(r => r.round.state === 'PLAYING' && r.effects.winners === undefined));
    const last = results.at(-1).effects;
    assert.equal(last.poolRemaining, 0);
    const byId = Object.fromEntries(last.winners.map(w => [w.participantId, w]));
    assert.deepEqual(Object.keys(byId).sort(), [p.participantId, others[0].p.participantId].sort());
    assert.deepEqual(byId[p.participantId].lineIds, ['row-0']); assert.deepEqual(byId[others[0].p.participantId].lineIds, ['row-3']);
    assert.equal(byId[p.participantId].winningDrawNumber, GRID);
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM winners WHERE round_id = ?', round.roundId).c, 2);
    assert.ok(last.winners.every(w => w.closest === true), 'closest-line winners are flagged for the admin');
    const adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body;
    assert.ok(adm.currentRound.winners.every(w => w.closest === true));
    const me = (await t.api.get('/me', p.token)).body;
    assert.equal(me.board.state, 'FINISHED'); assert.equal(me.result.isWinner, true); assert.equal(me.soul.badge, 'bingo-star'); assert.ok(me.soul.floatToken);
    const two = (await t.api.get('/me', others[1].p.token)).body;
    assert.equal(two.result.isWinner, false); assert.equal(two.result.coWinnerCount, 2); assert.equal(two.soul.badge, null);
    const pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub.notice, null); assert.equal(pub.publicState, 'Winner'); assert.equal(pub.winners.length, 2);
    const draw = await tryCommand(t, round.roundId, 'round.draw.next', end.version);
    assert.equal(draw.status, 409); assert.equal(draw.body.error.code, 'ILLEGAL_TRANSITION');
  });
});

describe('D-53 round set-up: start in N minutes, update, reschedule / extend', () => {
  let t;
  before(async () => { t = await startServer(); t.clock.set(Date.now()); });
  after(async () => { t.clock.unfreeze(); await t.close(); });
  const post = (body) => t.api.post(`/admin/events/${EVENT_ID}/rounds`, body, t.admin);

  test('create with startInMinutes: lockAt stays null until Open for players sets it to now + delay; the admin snapshot shows startInMinutes / openedAt / createdAt', async () => {
    const r = await post({ title: 'Soon', startInMinutes: 10 });
    assert.equal(r.status, 201); assert.equal(r.body.round.lockAt, null); assert.equal(r.body.round.state, 'DRAFT');
    let adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body;
    let sum = adm.rounds.find(x => x.roundId === r.body.round.roundId);
    assert.equal(sum.startInMinutes, 10); assert.equal(sum.openedAt, null); assert.equal(sum.createdAt, t.clock.iso()); assert.equal(adm.testMode, false); assert.equal(adm.canClearData, false, 'D-56: test mode is off by default');
    t.clock.advance(30000);
    const opened = await command(t, r.body.round.roundId, 'round.registration.open', 1);
    assert.equal(opened.round.state, 'REGISTRATION_OPEN'); assert.equal(opened.round.lockAt, new Date(t.clock.now() + 10 * 60000).toISOString());
    adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body;
    sum = adm.rounds.find(x => x.roundId === r.body.round.roundId);
    assert.equal(sum.openedAt, t.clock.iso()); assert.equal(adm.currentRound.readiness.lockCountdownMs, 10 * 60000);
    await command(t, r.body.round.roundId, 'round.cancel', opened.resultingVersion, { reason: 'cleanup' });
  });

  test('create validation: startInMinutes must be an integer 1-240; without it a valid lockAt is required', async () => {
    for (const bad of [0, 241, 1.5, '10', -5]) { const r = await post({ title: 'Bad', startInMinutes: bad }); assert.equal(r.status, 400, String(bad)); assert.equal(r.body.error.code, 'VALIDATION'); }
    for (const body of [{ title: 'No time' }, { title: 'Bad time', lockAt: 'tomorrow' }]) { const r = await post(body); assert.equal(r.status, 400); assert.equal(r.body.error.code, 'VALIDATION'); }
    for (const ok of [1, 240]) { const r = await post({ title: `Edge ${ok}`, startInMinutes: ok }); assert.equal(r.status, 201); await command(t, r.body.round.roundId, 'round.cancel', 1, { reason: 'cleanup' }); }
  });

  test('round.update toggles between a start time and "start in N minutes" (each clears the other)', async () => {
    const at = new Date(t.clock.now() + 3600000).toISOString();
    const r = (await post({ title: 'Toggle', lockAt: at })).body.round;
    const sumOf = async () => (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body.rounds.find(x => x.roundId === r.roundId);
    assert.equal((await sumOf()).startInMinutes, null); assert.equal((await sumOf()).lockAt, at);
    const u1 = await command(t, r.roundId, 'round.update', 1, { startInMinutes: 15 });
    assert.equal(u1.round.lockAt, null); assert.equal((await sumOf()).startInMinutes, 15);
    const bad = await tryCommand(t, r.roundId, 'round.update', 2, { startInMinutes: 0 });
    assert.equal(bad.status, 400);
    const at2 = new Date(t.clock.now() + 7200000).toISOString();
    const u2 = await command(t, r.roundId, 'round.update', 2, { lockAt: at2, title: 'Toggled' });
    assert.equal(u2.round.lockAt, at2); assert.equal(u2.round.title, 'Toggled'); assert.equal((await sumOf()).startInMinutes, null);
    const opened = await command(t, r.roundId, 'round.registration.open', 3);
    assert.equal(opened.round.lockAt, at2, 'a fixed start time is kept on opening');
    const noUpdate = await tryCommand(t, r.roundId, 'round.update', 4, { title: 'Too late' });
    assert.equal(noUpdate.status, 409); assert.equal(noUpdate.body.error.code, 'ILLEGAL_TRANSITION');
    await command(t, r.roundId, 'round.cancel', 4, { reason: 'cleanup' });
  });

  test('round.reschedule: extendMinutes counts from the start time, or from now once it has passed; lockAt must be in the future', async () => {
    const r = (await post({ title: 'Extend', lockAt: new Date(t.clock.now() + 10 * 60000).toISOString() })).body.round;
    const o = await command(t, r.roundId, 'round.registration.open', 1);
    const e1 = await command(t, r.roundId, 'round.reschedule', o.resultingVersion, { extendMinutes: 5 });
    assert.equal(e1.round.lockAt, new Date(Date.parse(o.round.lockAt) + 5 * 60000).toISOString(), 'from the future start time');
    for (const bad of [0, 61, 2.5]) { const x = await tryCommand(t, r.roundId, 'round.reschedule', e1.resultingVersion, { extendMinutes: bad }); assert.equal(x.status, 400, String(bad)); }
    const past = await tryCommand(t, r.roundId, 'round.reschedule', e1.resultingVersion, { lockAt: new Date(t.clock.now() - 1000).toISOString() });
    assert.equal(past.status, 400); assert.equal(past.body.error.code, 'VALIDATION');
    const nowAt = await tryCommand(t, r.roundId, 'round.reschedule', e1.resultingVersion, { lockAt: t.clock.iso() });
    assert.equal(nowAt.status, 400, 'now is not in the future');
    t.clock.advance(20 * 60000); // the start time passed (no tick ran)
    const e2 = await command(t, r.roundId, 'round.reschedule', e1.resultingVersion, { extendMinutes: 3 });
    assert.equal(e2.round.lockAt, new Date(t.clock.now() + 3 * 60000).toISOString(), 'from now');
    const newAt = new Date(t.clock.now() + 30 * 60000).toISOString();
    const e3 = await command(t, r.roundId, 'round.reschedule', e2.resultingVersion, { lockAt: newAt });
    assert.equal(e3.round.lockAt, newAt);
    const draftOnly = await tryCommand(t, r.roundId, 'round.update', e3.resultingVersion, { startInMinutes: 5 });
    assert.equal(draftOnly.status, 409);
    await command(t, r.roundId, 'round.cancel', e3.resultingVersion, { reason: 'cleanup' });
  });

  test('readiness.unfinishedBoards counts DRAFT boards plus players who joined since opening without a board', async () => {
    const s = await startServer();
    try {
      s.clock.set(Date.now());
      const before = await join(s, { displayName: 'Before' }); // joined before opening, no board: not counted
      s.clock.advance(1000);
      const round = await createRound(s);
      const unfinished = async () => (await s.api.get(`/admin/events/${EVENT_ID}/snapshot`, s.admin)).body.currentRound.readiness.unfinishedBoards;
      assert.equal(await unfinished(), 0);
      s.clock.advance(1000);
      const a = await join(s); await readyBoard(s, a, boardSet(0));      // READY: finished
      const b = await join(s); await saveBoard(s, b, boardSet(20, 5));   // DRAFT: unfinished
      const c = await join(s);                                           // joined since opening, nothing picked
      const d = await join(s); await saveBoard(s, d, []);                // empty DRAFT board
      assert.equal(await unfinished(), 3);
      await saveBoard(s, before, boardSet(40, 2));
      assert.equal(await unfinished(), 4, 'the early player now has a DRAFT board');
      await readyBoard(s, b, boardSet(20));
      assert.equal(await unfinished(), 3);
      void c;
      const st = await command(s, round.roundId, 'round.start_now', round.version, { confirmed: true });
      assert.equal(st.effects.unfinishedBoards, 1, 'the 2-skill board plays unfinished'); assert.equal(st.effects.deferredBoards, 1);
      assert.equal(await unfinished(), 0);
    } finally { await s.close(); }
  });
});

describe('D-53 always a winner: draws continue past 12', () => {
  test('no full line is possible, so play runs to draw 14 and the board with the most tiles in a line wins (all ten 3-tile lines)', async () => {
    const s = await startServer({ drawGuidance: false });
    try {
      const round = await createRound(s);
      const a = await join(s, { displayName: 'Almost' }); const ab = await readyBoard(s, a, boardSet(0));
      const b = await join(s, { displayName: 'Two skills' }); await saveBoard(s, b, boardSet(60, 2)); // partial board: 14 blank spots
      const started = await startRound(s, round);
      arrangeCells(s.db, ab.boardId, boardSet(0));
      // one gap per row, column and diagonal (positions 0, 6, 11, 13): 12 tiles can match, no line can complete
      const gaps = new Set([0, 6, 11, 13]);
      const pool = [...boardSet(0).filter((_, i) => !gaps.has(i)), ...boardSet(60, 2)];
      setPool(s.db, round.roundId, pool);
      const { results, round: end } = await drawUntilEnd(s, started);
      assert.equal(results.length, 14); assert.equal(end.state, 'WINNER');
      assert.ok(results.slice(0, 13).every(r => r.round.state === 'PLAYING'), 'draws 13 and 14 are accepted in PLAYING');
      assert.deepEqual(results.map(r => r.effects.draw.number), [...Array(14).keys()].map(i => i + 1));
      const winners = results.at(-1).effects.winners;
      assert.equal(winners.length, 1); assert.equal(winners[0].participantId, a.participantId); assert.equal(winners[0].winningDrawNumber, 14);
      assert.deepEqual(winners[0].lineIds.slice().sort(), LINE_MASKS.map(l => l.id).sort(), 'every line has exactly 3 matched tiles');
      const bm = (await s.api.get('/me', b.token)).body;
      assert.equal(bm.board.state, 'FINISHED'); assert.equal(bm.board.matchedPositions.length, 2); assert.equal(bm.result.isWinner, false);
      const adm = (await s.api.get(`/admin/events/${EVENT_ID}/snapshot`, s.admin)).body.currentRound;
      assert.equal(adm.draws.length, 14); assert.equal(adm.poolRemaining, 0); assert.equal(adm.winners.length, 1);
    } finally { await s.close(); }
  });
});

describe('D-53 delete round and clear all data', () => {
  const del = (s, roundId, key = nextKey('del')) => s.api.call('DELETE', `/admin/rounds/${roundId}`, { token: s.admin, key });

  test('DELETE /admin/rounds/{id} removes the round with boards, cells, matches, draws, winners, Souls and float tokens; outbox rows stay; round.deleted is emitted', async () => {
    const s = await startServer({ drawGuidance: false });
    try {
      const { round, p, b } = await lineScenario(s, { extraPlayers: [{ join: { displayName: 'Other' } }] });
      const { round: end } = await drawUntilEnd(s, round);
      assert.equal(end.state, 'WINNER');
      const me = (await s.api.get('/me', p.token)).body;
      const f = await s.api.post('/me/soul/float', { soulId: me.soul.soulId, floatToken: me.soul.floatToken }, p.token);
      assert.equal(f.status, 200);
      assert.equal((await s.api.get(`/events/${EVENT_ID}/snapshot`)).body.galaxy.count, 1);
      const boardIds = s.db.all('SELECT id FROM boards WHERE round_id = ?', round.roundId).map(r => r.id);
      const soulIds = s.db.all('SELECT id FROM souls WHERE round_id = ?', round.roundId).map(r => r.id);
      assert.equal(boardIds.length, 2); assert.equal(soulIds.length, 2); assert.ok(boardIds.includes(b.boardId));
      const outboxBefore = s.db.get('SELECT COUNT(*) AS c FROM events_outbox WHERE round_id = ?', round.roundId).c;
      assert.ok(outboxBefore > 0);
      const seq0 = s.db.get('SELECT MAX(sequence) AS q FROM events_outbox WHERE event_id = ?', EVENT_ID).q;
      // participants and the stage may not delete
      assert.equal((await s.api.call('DELETE', `/admin/rounds/${round.roundId}`, { token: p.token, key: nextKey() })).status, 403);
      assert.equal((await s.api.call('DELETE', `/admin/rounds/${round.roundId}`, { token: s.admin })).status, 400, 'Idempotency-Key required');
      const key = nextKey('del');
      const r = await del(s, round.roundId, key);
      assert.equal(r.status, 200);
      assert.deepEqual({ deleted: r.body.deleted, roundId: r.body.roundId, boards: r.body.boards, draws: r.body.draws, winners: r.body.winners, souls: r.body.souls }, { deleted: true, roundId: round.roundId, boards: 2, draws: GRID, winners: 1, souls: 2 });
      const inList = (sql, ids) => ids.length ? s.db.get(`${sql} (${ids.map(() => '?').join(',')})`, ...ids).c : 0;
      assert.equal(s.db.get('SELECT COUNT(*) AS c FROM rounds WHERE id = ?', round.roundId).c, 0);
      for (const table of ['boards', 'draws', 'winners', 'souls']) assert.equal(s.db.get(`SELECT COUNT(*) AS c FROM ${table} WHERE round_id = ?`, round.roundId).c, 0, table);
      assert.equal(inList('SELECT COUNT(*) AS c FROM board_cells WHERE board_id IN', boardIds), 0);
      assert.equal(inList('SELECT COUNT(*) AS c FROM board_matches WHERE board_id IN', boardIds), 0);
      assert.equal(inList('SELECT COUNT(*) AS c FROM float_tokens WHERE soul_id IN', soulIds), 0);
      assert.equal(s.db.get('SELECT COUNT(*) AS c FROM events_outbox WHERE round_id = ?', round.roundId).c, outboxBefore, 'outbox rows are kept (sequence numbers never reused)');
      const ev = s.db.all('SELECT type, payload_json FROM events_outbox WHERE event_id = ? AND sequence > ?', EVENT_ID, seq0);
      assert.deepEqual(ev.map(e => e.type), ['round.deleted']); assert.deepEqual(JSON.parse(ev[0].payload_json), { roundId: round.roundId, number: round.number });
      const audit = (await s.api.get(`/admin/events/${EVENT_ID}/audit`, s.admin)).body.entries.find(e => e.action === 'round.delete');
      assert.equal(audit.outcome, 'accepted'); assert.equal(audit.roundId, round.roundId); assert.equal(audit.details.state, 'WINNER'); assert.equal(audit.details.souls, 2);
      // the galaxy loses the round's floated Soul; the admin no longer lists the round
      assert.equal((await s.api.get(`/events/${EVENT_ID}/snapshot`)).body.galaxy.count, 0);
      const adm = (await s.api.get(`/admin/events/${EVENT_ID}/snapshot`, s.admin)).body;
      assert.ok(!adm.rounds.some(x => x.roundId === round.roundId)); assert.equal(adm.currentRound, null);
      // replay of the same key returns the original response; a new key on a gone round is NOT_FOUND
      const replay = await del(s, round.roundId, key);
      assert.equal(replay.status, 200); assert.equal(replay.headers.get('idempotent-replay'), 'true');
      const again = await del(s, round.roundId);
      assert.equal(again.status, 404); assert.equal(again.body.error.code, 'NOT_FOUND');
    } finally { await s.close(); }
  });

  test('any state can be deleted: DRAFT, REGISTRATION_OPEN (with boards) and PLAYING', async () => {
    const s = await startServer();
    try {
      const draft = await createRound(s, { open: false });
      assert.equal((await del(s, draft.roundId)).status, 200);
      const open = await createRound(s, { title: 'Open' });
      const p = await join(s); await saveBoard(s, p, boardSet(0, 4));
      const r1 = await del(s, open.roundId);
      assert.equal(r1.status, 200); assert.equal(r1.body.boards, 1);
      const playing = await createRound(s, { title: 'Playing' });
      const q = await join(s); await readyBoard(s, q, boardSet(0));
      const st = await startRound(s, playing);
      await command(s, playing.roundId, 'round.draw.next', st.version);
      const r2 = await del(s, playing.roundId);
      assert.equal(r2.status, 200); assert.equal(r2.body.draws, 1);
      assert.equal(s.db.get('SELECT COUNT(*) AS c FROM rounds').c, 0);
      assert.equal(s.db.get('SELECT COUNT(*) AS c FROM boards').c, 0);
      assert.equal((await s.api.get('/me', q.token)).status, 200, 'players keep their session');
    } finally { await s.close(); }
  });

  test('POST /admin/events/{id}/reset needs {confirm:"DELETE"}, clears every round, player, board, session and Soul, emits event.reset; old sessions get 401', async () => {
    const s = await startServer({ drawGuidance: false });
    try {
      const { round, p } = await lineScenario(s);
      await drawUntilEnd(s, round);
      const next = await createRound(s, { title: 'Next' });
      const q = await join(s); await saveBoard(s, q, boardSet(0, 3));
      const path = `/admin/events/${EVENT_ID}/reset`;
      for (const body of [{}, { confirm: 'delete' }, { confirm: true }]) {
        const r = await s.api.post(path, body, s.admin);
        assert.equal(r.status, 400); assert.equal(r.body.error.code, 'VALIDATION');
      }
      assert.equal((await s.api.post(path, { confirm: 'DELETE' }, p.token)).status, 403, 'admin only');
      assert.equal((await s.api.post(`/admin/events/evt_nope/reset`, { confirm: 'DELETE' }, s.admin)).status, 404);
      const off = await s.api.post(path, { confirm: 'DELETE' }, s.admin);
      assert.equal(off.status, 403, 'D-56: refused until test mode is on'); assert.equal(off.body.error.code, 'FORBIDDEN');
      assert.equal(s.db.get('SELECT COUNT(*) AS c FROM rounds').c, 2, 'rejected resets change nothing');
      assert.equal((await s.api.post(`/admin/events/${EVENT_ID}/test-mode`, { enabled: true }, s.admin)).status, 200);
      const seq0 = s.db.get('SELECT MAX(sequence) AS q FROM events_outbox WHERE event_id = ?', EVENT_ID).q;
      const r = await s.api.post(path, { confirm: 'DELETE' }, s.admin);
      assert.equal(r.status, 200); assert.equal(r.body.reset, true); assert.equal(r.body.rounds, 2); assert.equal(r.body.participants, 2); assert.equal(r.body.souls, 1);
      for (const table of ['rounds', 'boards', 'board_cells', 'board_matches', 'draws', 'winners', 'souls', 'float_tokens', 'participants', 'sessions']) assert.equal(s.db.get(`SELECT COUNT(*) AS c FROM ${table}`).c, 0, table);
      const ev = s.db.all('SELECT type FROM events_outbox WHERE event_id = ? AND sequence > ?', EVENT_ID, seq0).map(e => e.type);
      assert.deepEqual(ev, ['event.reset']);
      assert.ok(s.db.get('SELECT COUNT(*) AS c FROM events_outbox WHERE event_id = ?', EVENT_ID).c > 1, 'outbox history kept');
      for (const tok of [p.token, q.token]) assert.equal((await s.api.get('/me', tok)).status, 401);
      const adm = (await s.api.get(`/admin/events/${EVENT_ID}/snapshot`, s.admin)).body;
      assert.deepEqual(adm.rounds, []); assert.equal(adm.currentRound, null); assert.equal(adm.testMode, true, 'test mode stays on after a clear'); assert.equal(adm.canClearData, true);
      assert.equal(s.db.get('SELECT action FROM audit_log WHERE action = ?', 'event.reset').action, 'event.reset');
      // the event lives on: a fresh player can join and a new round can be created
      const fresh = await join(s); assert.ok(fresh.token);
      const again = await createRound(s, { title: 'After reset' }); assert.equal(again.number, 1);
      void next;
    } finally { await s.close(); }
  });

  test('test mode (D-56): off by default, switchable by the admin on any server (production too), audited, admin-only event; BINGO_ALLOW_RESET=off locks it', async () => {
    const s = await startServer();
    try {
      await createRound(s);
      const tm = `/admin/events/${EVENT_ID}/test-mode`, reset = `/admin/events/${EVENT_ID}/reset`;
      const snap = async () => (await s.api.get(`/admin/events/${EVENT_ID}/snapshot`, s.admin)).body;
      let a = await snap(); assert.equal(a.testMode, false); assert.equal(a.testModeLocked, false); assert.equal(a.canClearData, false);
      assert.equal((await s.api.post(tm, { enabled: 'yes' }, s.admin)).status, 400);
      assert.equal((await s.api.post(tm, { enabled: true }, s.stage)).status, 403, 'admin only');
      s.config.env = 'production'; // the game and projections read the live config object
      assert.equal((await s.api.post(reset, { confirm: 'DELETE' }, s.admin)).status, 403, 'production, test mode off');
      const seq0 = s.db.get('SELECT MAX(sequence) AS q FROM events_outbox WHERE event_id = ?', EVENT_ID).q;
      const on = await s.api.post(tm, { enabled: true }, s.admin);
      assert.equal(on.status, 200); assert.equal(on.body.testMode, true);
      a = await snap(); assert.equal(a.testMode, true); assert.equal(a.canClearData, true);
      const ev = s.db.get('SELECT type, payload_json FROM events_outbox WHERE event_id = ? AND sequence > ?', EVENT_ID, seq0);
      assert.equal(ev.type, 'event.updated'); assert.deepEqual(JSON.parse(ev.payload_json), { testMode: true });
      const aud = s.db.get(`SELECT details_json FROM audit_log WHERE action = 'event.test_mode' ORDER BY id DESC LIMIT 1`);
      assert.deepEqual(JSON.parse(aud.details_json), { enabled: true, env: 'production' });
      // the server lock wins over the stored switch
      s.config.testModeLocked = true;
      a = await snap(); assert.equal(a.testModeLocked, true); assert.equal(a.testMode, false); assert.equal(a.canClearData, false);
      assert.equal((await s.api.post(reset, { confirm: 'DELETE' }, s.admin)).status, 403, 'locked: no clearing');
      assert.equal((await s.api.post(tm, { enabled: true }, s.admin)).status, 403, 'locked: cannot turn on');
      assert.equal((await s.api.post(tm, { enabled: false }, s.admin)).status, 200, 'turning off is always allowed');
      s.config.testModeLocked = false;
      a = await snap(); assert.equal(a.testMode, false);
      assert.equal(s.db.get('SELECT COUNT(*) AS c FROM rounds').c, 1, 'nothing was cleared');
    } finally { s.config.env = 'test'; s.config.testModeLocked = false; await s.close(); }
  });
});
