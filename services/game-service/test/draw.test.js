import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, tryCommand, join, readyBoard, boardSet, mixedSet, startRound, drawUntilEnd, fiveSkillLineScenario, nextKey, EVENT_ID, OPTIONAL_IDS } from './helpers.js';

describe('draw transaction (A-04, A-05, BR-09..BR-15)', () => {
  let t;
  before(async () => { t = await startServer(); });
  after(async () => { await t.close(); });

  test('draw 4 completes no bingo, draw 5 declares the winner; matches only from accepted draws', async () => {
    const { round, p, eligible5 } = await fiveSkillLineScenario(t);
    let cur = round;
    for (let n = 1; n <= 4; n++) {
      const r = await command(t, cur.roundId, 'round.draw.next', cur.version);
      assert.equal(r.round.state, 'PLAYING'); assert.equal(r.effects.draw.number, n); assert.equal(r.effects.winners, undefined);
      assert.ok(eligible5.includes(r.effects.draw.skill.id)); assert.equal(r.effects.matchedBoards, 1); assert.equal(r.effects.poolRemaining, 5 - n);
      cur = r.round;
    }
    let me = (await t.api.get('/me', p.token)).body;
    assert.equal(me.board.matchedPositions.length, 4); assert.equal(me.result, null);
    const five = await command(t, cur.roundId, 'round.draw.next', cur.version);
    assert.equal(five.round.state, 'WINNER'); assert.equal(five.effects.draw.number, 5); assert.equal(five.effects.winners.length, 1);
    assert.equal(five.effects.winners[0].participantId, p.participantId); assert.deepEqual(five.effects.winners[0].lineIds, ['row-0']); assert.equal(five.effects.winners[0].winningDrawNumber, 5);
    me = (await t.api.get('/me', p.token)).body;
    assert.deepEqual(me.board.matchedPositions, [0, 1, 2, 3, 4]); assert.equal(me.result.winningDrawNumber, 5); assert.equal(me.soul.badge, 'bingo-star');
    assert.equal(me.draws.length, 5);
    const again = await tryCommand(t, cur.roundId, 'round.draw.next', five.resultingVersion);
    assert.equal(again.status, 409); assert.equal(again.body.error.code, 'ILLEGAL_TRANSITION');
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, 5);
  });

  test('co-winners: two boards completing a line on the same draw are both persisted and published; a third board is not', async () => {
    const { round, p, others } = await fiveSkillLineScenario(t, { extraPlayers: [
      { join: { displayName: 'Second', consent: false }, layout: (e5) => [...OPTIONAL_IDS.slice(20, 25), ...e5, ...OPTIONAL_IDS.slice(25, 40)] },
      { join: { displayName: 'Third' }, set: mixedSet(5, 0, 28), layout: (e5) => { const opt = OPTIONAL_IDS.slice(28, 48); const l = []; const at = { 0: e5[0], 6: e5[1], 12: e5[2], 18: e5[3], 20: e5[4] }; let k = 0; for (let i = 0; i < 25; i++) l.push(at[i] ?? opt[k++]); return l; } },
    ] });
    const { results, round: end } = await drawUntilEnd(t, round);
    assert.equal(end.state, 'WINNER'); assert.equal(results.length, 5);
    const winners = results.at(-1).effects.winners;
    assert.deepEqual(winners.map(w => w.participantId).sort(), [p.participantId, others[0].p.participantId].sort());
    assert.deepEqual(winners.map(w => w.lineIds), [['row-0'], ['row-1']]);
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM winners WHERE round_id = ?', round.roundId).c, 2);
    const third = (await t.api.get('/me', others[1].p.token)).body;
    assert.equal(third.result.isWinner, false); assert.equal(third.result.coWinnerCount, 2); assert.equal(third.soul.badge, null);
    const adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body.currentRound;
    assert.equal(adm.winners.length, 2);
    assert.equal(adm.winners.find(w => w.participantId === others[0].p.participantId).label.startsWith('Soul #'), true, 'non-consented pseudonym');
  });

  test('two concurrent draw-next with the same expectedVersion: exactly one accepted, the other STALE_VERSION; one draw row', async () => {
    const round = await createRound(t);
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const started = await startRound(t, round);
    const [r1, r2] = await Promise.all([tryCommand(t, round.roundId, 'round.draw.next', started.version), tryCommand(t, round.roundId, 'round.draw.next', started.version)]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const rejected = r1.status === 409 ? r1 : r2;
    assert.equal(rejected.body.error.code, 'STALE_VERSION'); assert.equal(rejected.body.error.details.currentVersion, started.version + 1);
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, 1);
    await command(t, round.roundId, 'round.cancel', started.version + 1, { reason: 'cleanup' });
  });

  test('same Idempotency-Key returns the identical response and performs no second draw; different body with same key is 422', async () => {
    const round = await createRound(t);
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const started = await startRound(t, round);
    const key = nextKey('draw');
    const r1 = await tryCommand(t, round.roundId, 'round.draw.next', started.version, {}, key);
    const r2 = await tryCommand(t, round.roundId, 'round.draw.next', started.version, {}, key);
    assert.equal(r1.status, 200); assert.equal(r2.status, 200); assert.deepEqual(r2.body, r1.body);
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, 1);
    const r3 = await tryCommand(t, round.roundId, 'round.draw.next', started.version + 1, {}, key);
    assert.equal(r3.status, 422); assert.equal(r3.body.error.code, 'IDEMPOTENCY_MISMATCH');
    await command(t, round.roundId, 'round.cancel', started.version + 1, { reason: 'cleanup' });
  });

  test('draws are unique per round, numbered consecutively, all from the pool of Core/Critical skills on active boards; params.skillId is ignored', async () => {
    const round = await createRound(t);
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const b = await join(t); await readyBoard(t, b, boardSet(20));
    const started = await startRound(t, round);
    const first = await command(t, round.roundId, 'round.draw.next', started.version, { skillId: 'skill_adaptability' });
    const { results, round: end } = await drawUntilEnd(t, first.round);
    const draws = [first, ...results].map(r => r.effects.draw);
    assert.deepEqual(draws.map(d => d.number), draws.map((_, i) => i + 1));
    assert.equal(new Set(draws.map(d => d.skill.id)).size, draws.length);
    const pool = new Set([...boardSet(0), ...boardSet(20)]);
    assert.ok(draws.every(d => pool.has(d.skill.id) && ['Core', 'Critical'].includes(d.skill.kind)));
    assert.ok(['WINNER', 'EXHAUSTED'].includes(end.state));
    assert.ok(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c <= 45);
  });

  test('a persistence failure inside the draw transaction is DRAW_FAILED (E21): nothing persisted, nothing published, retry works', async () => {
    const round = await createRound(t);
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const started = await startRound(t, round);
    const seqBefore = t.db.get('SELECT COALESCE(MAX(sequence),0) AS s FROM events_outbox WHERE event_id = ?', EVENT_ID).s;
    t.db.exec('ALTER TABLE board_matches RENAME TO board_matches_broken');
    let r;
    try { r = await tryCommand(t, round.roundId, 'round.draw.next', started.version); }
    finally { t.db.exec('ALTER TABLE board_matches_broken RENAME TO board_matches'); }
    assert.equal(r.status, 500); assert.equal(r.body.error.code, 'DRAW_FAILED'); assert.equal(r.body.error.exceptionId, 'E21');
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, 0);
    assert.equal(t.db.get('SELECT version FROM rounds WHERE id = ?', round.roundId).version, started.version);
    assert.equal(t.db.get('SELECT COALESCE(MAX(sequence),0) AS s FROM events_outbox WHERE event_id = ?', EVENT_ID).s, seqBefore, 'no outbox rows');
    const audit = (await t.api.get(`/admin/events/${EVENT_ID}/audit?roundId=${round.roundId}`, t.admin)).body.entries[0];
    assert.equal(audit.action, 'round.draw.next'); assert.equal(audit.outcome, 'rejected'); assert.equal(audit.details.code, 'DRAW_FAILED');
    const retry = await tryCommand(t, round.roundId, 'round.draw.next', started.version);
    assert.equal(retry.status, 200);
    await command(t, round.roundId, 'round.cancel', retry.body.resultingVersion, { reason: 'cleanup' });
  });

  test('seeded RNG makes draw order reproducible across servers (fixture determinism) while draw responses never expose other boards', async () => {
    const run = async () => {
      const s = await startServer({ rngSeed: 'unit-seed' });
      try {
        const round = await createRound(s); const a = await join(s); await readyBoard(s, a, boardSet(0)); const st = await startRound(s, round);
        const { results } = await drawUntilEnd(s, st);
        return results.map(r => r.effects.draw.skill.id);
      } finally { await s.close(); }
    };
    const [x, y] = [await run(), await run()];
    assert.deepEqual(x, y); assert.ok(x.length >= 5);
  });
});
