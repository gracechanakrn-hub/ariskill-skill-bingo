// Seeded deterministic round replay (requirement 18.2 "at least one seeded deterministic round", AC 5, 6, 7; M-08, M-10, A-06).
// Replays tests/fixtures/seeded-round.json exactly as services/game-service/README.md describes:
// fresh server with BINGO_ENV=test, BINGO_DB_PATH=:memory:, BINGO_RNG_SEED=fixture-1; first round of evt_demo; six explicit
// profiles; save + finalize the listed skillIds; lock; start; draw until the round leaves PLAYING.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startServer, command, tryCommand, openStream, nextKey } from './helpers.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/seeded-round.json', import.meta.url), 'utf8'));

describe('seeded round replay (BINGO_RNG_SEED=fixture-1)', () => {
  let t, round, streams, players, refOf;
  const results = [];
  before(async () => {
    assert.equal(fixture.env.BINGO_RNG_SEED, 'fixture-1'); assert.equal(fixture.env.BINGO_ENV, 'test'); assert.equal(fixture.env.BINGO_DB_PATH, ':memory:');
    t = await startServer({ eventId: fixture.eventId, eventName: 'AriSkill Skill Bingo Demo', rngSeed: fixture.env.BINGO_RNG_SEED });
    assert.equal(t.config.env, 'test'); assert.equal(t.config.rngSeed, 'fixture-1');
  });
  after(async () => { await t.close(); });

  test('setup: first round of evt_demo, registration open, six boards finalized with the fixture layouts', async () => {
    const created = await t.api.post(`/admin/events/${fixture.eventId}/rounds`, { title: fixture.round.title, lockAt: new Date(t.clock.now() + 3600 * 1000).toISOString(), resultWindowSeconds: fixture.round.resultWindowSeconds }, t.admin);
    assert.equal(created.status, 201); assert.equal(created.body.round.number, fixture.round.number);
    round = (await command(t, created.body.round.roundId, 'round.registration.open', created.body.round.version)).round;
    players = [];
    for (const b of fixture.boards) {
      const s = await t.api.post(`/events/${fixture.eventId}/session`, { joinToken: t.joinToken(), employeeRef: b.employeeRef, displayName: b.displayName, consentPublicName: b.consentPublicName });
      assert.equal(s.status, 201, b.employeeRef);
      const p = { ...b, token: s.body.sessionToken, participantId: s.body.participantId };
      const prof = await t.api.post('/me/profile', { platformId: b.platformId, roleId: b.roleId }, p.token);
      assert.equal(prof.status, 200, `${b.employeeRef} profile`);
      const save = await t.api.put('/me/board/selections', { skillIds: b.skillIds, boardVersion: 0 }, p.token, nextKey('save'));
      assert.equal(save.status, 200, `${b.employeeRef} save`);
      const fin = await t.api.post('/me/board/finalize', { boardVersion: save.body.resultingVersion }, p.token, nextKey('fin'));
      assert.equal(fin.status, 200, `${b.employeeRef} finalize`); assert.equal(fin.body.board.state, 'READY');
      p.boardId = fin.body.board.boardId;
      const expectedLayout = fixture.expected.boardLayouts.find(l => l.employeeRef === b.employeeRef).cells;
      assert.deepEqual(fin.body.board.cells.map(c => c.skillId), expectedLayout, `${b.employeeRef} board layout is deterministic`);
      players.push(p);
    }
    refOf = new Map(players.map(p => [p.participantId, p.employeeRef]));
    // two identical selection sets -> identical layouts (fixture determinism note)
    assert.deepEqual(fixture.expected.boardLayouts[0].cells, fixture.expected.boardLayouts[1].cells);
    const coWinners = players.filter(p => fixture.expected.coWinnerRefs.includes(p.employeeRef));
    assert.equal(coWinners.length, fixture.expected.coWinnerRefs.length);
    streams = {
      public: await openStream(t.baseUrl, `/events/${fixture.eventId}/stream`),
      stage: await openStream(t.baseUrl, `/stage/events/${fixture.eventId}/stream`, { token: t.stage }),
      admin: await openStream(t.baseUrl, `/admin/events/${fixture.eventId}/stream`, { token: t.admin }),
      [coWinners[0].employeeRef]: await openStream(t.baseUrl, '/me/stream', { token: coWinners[0].token }),
      [coWinners[1].employeeRef]: await openStream(t.baseUrl, '/me/stream', { token: coWinners[1].token }),
    };
    for (const [k, s] of Object.entries(streams)) assert.equal(s.status, 200, `${k} stream`);
  });

  test('lock and start match the fixture: 6 active / 0 deferred boards, pool of 100 eligible skills', async () => {
    const lock = await command(t, round.roundId, 'round.lock', round.version);
    assert.equal(lock.effects.activeBoards, fixture.expected.lock.activeBoards); assert.equal(lock.effects.deferredBoards, fixture.expected.lock.deferredBoards);
    const start = await command(t, round.roundId, 'round.start', lock.resultingVersion);
    assert.equal(start.round.state, 'PLAYING'); assert.equal(start.effects.poolSize, fixture.expected.poolSize);
    round = start.round;
    const pool = JSON.parse(t.db.get('SELECT pool_json FROM rounds WHERE id = ?', round.roundId).pool_json);
    assert.deepEqual(pool, fixture.expected.pool, 'pool content is exactly the fixture pool');
    assert.equal(new Set(pool).size, pool.length, 'pool has no duplicates');
    const adm = (await t.api.get(`/admin/events/${fixture.eventId}/snapshot`, t.admin)).body.currentRound;
    assert.equal(adm.readiness.poolSize, fixture.expected.poolSize); assert.equal(adm.poolRemaining, fixture.expected.poolSize);
    await streams.public.waitFor(ev => ev.some(e => e.event === 'round.started'), 2000, 'round.started');
    assert.equal(streams.public.events.find(e => e.event === 'round.started').data.payload.poolSize, fixture.expected.poolSize);
  });

  test('draw order, matched-board counts and pool remaining replay exactly; no winner before draw 5; WINNER on the expected draw', async () => {
    let cur = round;
    for (let i = 0; i < 300 && cur.state === 'PLAYING'; i++) {
      const r = await command(t, cur.roundId, 'round.draw.next', cur.version);
      results.push(r); cur = r.round;
    }
    assert.equal(results.length, fixture.expected.totalDraws);
    assert.equal(cur.state, fixture.expected.outcome); assert.equal(cur.version, fixture.expected.finalRoundVersion);
    results.forEach((r, i) => {
      const exp = fixture.expected.draws[i];
      assert.equal(r.effects.draw.number, exp.number); assert.equal(r.effects.draw.skill.id, exp.skillId, `draw ${exp.number}`); assert.equal(r.effects.draw.skill.name, exp.name); assert.equal(r.effects.draw.skill.kind, exp.kind);
      assert.equal(r.effects.matchedBoards, exp.matchedBoards, `matchedBoards after draw ${exp.number}`); assert.equal(r.effects.poolRemaining, exp.poolRemaining, `poolRemaining after draw ${exp.number}`);
      assert.ok(['Core', 'Critical'].includes(r.effects.draw.skill.kind), 'every drawn skill is Core or Critical (AC 4)');
      if (exp.number < 5) assert.equal(r.effects.winners, undefined, `no winner before draw 5 (draw ${exp.number})`);
      if (exp.number < fixture.expected.winningDrawNumber) assert.equal(r.round.state, 'PLAYING');
    });
    const skillIds = results.map(r => r.effects.draw.skill.id);
    assert.equal(new Set(skillIds).size, skillIds.length, 'no skill drawn twice (AC 5)');
    assert.ok(skillIds.every(id => fixture.expected.pool.includes(id)), 'every draw comes from the pool');
    const last = results.at(-1);
    assert.equal(last.round.state, 'WINNER'); assert.equal(last.effects.draw.number, fixture.expected.winningDrawNumber);
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, fixture.expected.totalDraws);
    round = cur;
  });

  test('co-winners: all and only the expected participants, with the expected line ids and consent-based labels (AC 7, A-06)', async () => {
    const winners = results.at(-1).effects.winners;
    assert.deepEqual(winners.map(w => refOf.get(w.participantId)).sort(), fixture.expected.coWinnerRefs);
    for (const w of winners) { assert.deepEqual(w.lineIds, fixture.expected.winnerLineIds[refOf.get(w.participantId)]); assert.equal(w.winningDrawNumber, fixture.expected.winningDrawNumber); }
    const consented = winners.map(w => w.label).filter(l => !/^Soul #\d{4}$/.test(l)).sort();
    assert.deepEqual(consented, fixture.expected.consentedWinnerLabels);
    assert.equal(winners.filter(w => /^Soul #\d{4}$/.test(w.label)).length, winners.length - consented.length, 'non-consented winners are pseudonymised');
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM winners WHERE round_id = ?', round.roundId).c, winners.length, 'persisted winners = declared winners');
    for (const p of players) {
      const m = (await t.api.get('/me', p.token)).body;
      const isWinner = fixture.expected.coWinnerRefs.includes(p.employeeRef);
      assert.equal(m.result.isWinner, isWinner, p.employeeRef); assert.equal(m.result.winningDrawNumber, fixture.expected.winningDrawNumber); assert.equal(m.result.coWinnerCount, winners.length);
      assert.equal(m.board.state, 'FINISHED'); assert.ok(m.soul, 'every finished board gets a Soul'); assert.equal(m.soul.badge, isWinner ? 'bingo-star' : null);
      assert.equal(m.draws.length, fixture.expected.totalDraws);
      assert.deepEqual(m.draws.map(d => d.skill.id), fixture.expected.draws.map(d => d.skillId), 'participant sees the same draw order');
    }
  });

  test('WINNER closes further draws: draw-next is ILLEGAL_TRANSITION (E10) and nothing is persisted', async () => {
    const drawsBefore = t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c;
    const again = await tryCommand(t, round.roundId, 'round.draw.next', round.version);
    assert.equal(again.status, 409); assert.equal(again.body.error.code, 'ILLEGAL_TRANSITION'); assert.equal(again.body.error.exceptionId, 'E10');
    const stale = await tryCommand(t, round.roundId, 'round.draw.next', round.version - 1);
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'ILLEGAL_TRANSITION');
    assert.equal(t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', round.roundId).c, drawsBefore);
    assert.equal(t.db.get('SELECT version FROM rounds WHERE id = ?', round.roundId).version, fixture.expected.finalRoundVersion);
  });

  test('result.published carries the same co-winners on public, stage, admin and both winners\' participant streams; bingo.detected exactly once at the winning draw', async () => {
    for (const [k, s] of Object.entries(streams)) await s.waitFor(ev => ev.some(e => e.event === 'result.published'), 3000, `result.published on ${k}`);
    const winners = results.at(-1).effects.winners;
    const expectedIds = new Set(winners.map(w => w.participantId));
    const expectedLabels = winners.map(w => w.label).sort();
    const soulIds = new Set();
    for (const [k, s] of Object.entries(streams)) {
      const draws = s.events.filter(e => e.event === 'draw.accepted');
      assert.equal(draws.length, fixture.expected.totalDraws, `${k} saw every draw`);
      assert.deepEqual(draws.map(d => d.data.payload.draw.skill.id), fixture.expected.draws.map(d => d.skillId), `${k} draw order`);
      assert.ok(draws.slice(0, 4).every(d => d.data.payload.bingoEvaluationActive === false) && draws.slice(4).every(d => d.data.payload.bingoEvaluationActive === true), `${k} bingoEvaluationActive from draw 5`);
      const bingo = s.events.filter(e => e.event === 'bingo.detected');
      assert.equal(bingo.length, 1, `${k} bingo.detected once`); assert.equal(bingo[0].data.payload.drawNumber, fixture.expected.winningDrawNumber); assert.equal(bingo[0].data.payload.winnerCount, winners.length);
      const lastDraw = draws.at(-1);
      assert.ok(bingo[0].data.sequence > lastDraw.data.sequence, `${k} bingo.detected after the winning draw`);
      const res = s.events.find(e => e.event === 'result.published');
      assert.equal(res.data.payload.round.state, 'WINNER'); assert.ok(res.data.payload.resultWindowEndsAt);
      assert.equal(res.data.payload.winners.length, winners.length, `${k} winner count`);
      assert.deepEqual(res.data.payload.winners.map(w => w.label).sort(), expectedLabels, `${k} winner labels`);
      if (k === 'admin') {
        assert.deepEqual(res.data.payload.winners.map(w => w.participantId).sort(), [...expectedIds].sort());
        for (const w of res.data.payload.winners) { assert.deepEqual(Object.keys(w).sort(), ['label', 'lineIds', 'participantId', 'winningDrawNumber']); assert.equal(w.winningDrawNumber, fixture.expected.winningDrawNumber); }
      } else {
        for (const w of res.data.payload.winners) { assert.ok(w.soulId.startsWith('soul_')); soulIds.add(w.soulId); }
        if (k === 'stage') for (const w of res.data.payload.winners) assert.deepEqual(Object.keys(w).sort(), ['label', 'soulId', 'winningDrawNumber']);
        if (k === 'public') for (const w of res.data.payload.winners) assert.deepEqual(Object.keys(w).sort(), ['label', 'soulId']);
      }
      if (k.startsWith('fixture-')) {
        assert.equal(res.data.payload.myResult.isWinner, true, `${k} is a winner`); assert.deepEqual(res.data.payload.myResult.lineIds, fixture.expected.winnerLineIds[k]);
        assert.ok(!('participantId' in res.data.payload.winners[0]), 'participant stream does not identify co-winners');
      }
    }
    assert.equal(soulIds.size, winners.length, 'public/stage/participant winners reference the same Souls');
    const pub = (await t.api.get(`/events/${fixture.eventId}/snapshot`)).body;
    // Snapshot labels: consented names must match; pseudonym equality with the event label is covered by the dedicated
    // DEF-01 test in public-stage-views.test.js (snapshots currently render every non-consented winner as the same pseudonym).
    const consentedOf = (ws) => ws.map(w => w.label).filter(l => !/^Soul #\d{4}$/.test(l)).sort();
    assert.equal(pub.publicState, 'Winner'); assert.equal(pub.winners.length, winners.length); assert.deepEqual(consentedOf(pub.winners), fixture.expected.consentedWinnerLabels); assert.equal(pub.currentDraw.number, fixture.expected.winningDrawNumber);
    assert.deepEqual(pub.winners.map(w => w.soulId).sort(), [...soulIds].sort(), 'snapshot winners reference the same Souls as the streams');
    const stage = (await t.api.get(`/stage/events/${fixture.eventId}/snapshot`, t.stage)).body;
    assert.equal(stage.resultTiming.winningDrawNumber, fixture.expected.winningDrawNumber); assert.equal(stage.winners.length, winners.length); assert.deepEqual(consentedOf(stage.winners), fixture.expected.consentedWinnerLabels);
    for (const s of Object.values(streams)) { s.close(); await s.done; }
  });
});
