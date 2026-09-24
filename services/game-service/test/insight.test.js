import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, join, readyBoard, boardSet, startRound, drawUntilEnd, EVENT_ID } from './helpers.js';
import { ROLES, roleSkillSet, SKILLS, PLATFORMS, MATRIX_VERSION } from '../src/skills.js';
import { computeInsights } from '../../analytics-projection/src/insights.js';
import { findForbiddenKeys } from '../src/projections.js';

describe('private insight, aggregate insights with cohort suppression, retention (M-12, requirement 16, D-15, OD-08)', () => {
  let t;
  before(async () => { t = await startServer(); });
  after(async () => { await t.close(); });

  test('insight is available only after the board is FINISHED, is private, and counts against the role map at matrixVersion', async () => {
    const round = await createRound(t);
    const role = ROLES[2];
    const a = await join(t, { profile: { platformId: role.platformId, roleId: role.id } });
    const set = roleSkillSet(role.id);
    const inMatrix = [...set].filter(id => SKILLS.get(id)?.status === 'active').sort().slice(0, 10);
    const beyond = boardSet(0, 40).filter(id => !set.has(id)).slice(0, 15);
    await readyBoard(t, a, [...inMatrix, ...beyond]);
    const b = await join(t); await readyBoard(t, b, boardSet(60));
    assert.equal((await t.api.get('/me/insight', a.token)).status, 404, 'not before FINISHED');
    const started = await startRound(t, round);
    await drawUntilEnd(t, started);
    const ins = (await t.api.get('/me/insight', a.token)).body;
    assert.equal(ins.roundId, round.roundId); assert.equal(ins.matrixVersion, MATRIX_VERSION); assert.equal(ins.inMatrixCount, 10); assert.equal(ins.beyondMatrixCount, 15); assert.equal(ins.totalSelected, 25);
    const other = (await t.api.get('/me/insight', b.token)).body;
    assert.notDeepEqual([other.inMatrixCount, other.beyondMatrixCount], [10, 15]);
    for (const [aud, path, tok] of [['public', `/events/${EVENT_ID}/snapshot`, null], ['stage', `/stage/events/${EVENT_ID}/snapshot`, t.stage], ['admin', `/admin/events/${EVENT_ID}/snapshot`, t.admin]]) {
      const body = (await t.api.get(path, tok)).body;
      assert.deepEqual(findForbiddenKeys(aud, body), [], aud); assert.ok(!JSON.stringify(body).includes('inMatrixCount'));
    }
    assert.equal((await t.api.get('/me', a.token)).body.insightAvailable, true);
  });

  test('cohort suppression: platform/role breakdowns below 5 joined are omitted and counted (pure function and API)', async () => {
    const roleA = ROLES[10], roleB = ROLES[11];
    const parts = [...Array(5)].map((_, i) => ({ participantId: `p${i}`, platformId: roleA.platformId, roleId: roleA.id }));
    parts.push(...[...Array(4)].map((_, i) => ({ participantId: `q${i}`, platformId: roleB.platformId, roleId: roleB.id })));
    const boards = parts.map(p => ({ participantId: p.participantId, state: 'FINISHED', selectedSkillIds: boardSet(0), matrixVersion: MATRIX_VERSION }));
    const r = computeInsights({ participants: parts, boards, skills: SKILLS, platforms: PLATFORMS, roles: ROLES, roleSkillSet, matrixVersion: MATRIX_VERSION, computedAt: 'now' });
    assert.deepEqual(r.roleEngagement.map(x => x.roleId), [roleA.id]);
    assert.equal(r.roleEngagement[0].joined, 5); assert.equal(r.roleEngagement[0].completed, 5);
    const platformsExpected = roleA.platformId === roleB.platformId ? 1 : 1;
    assert.equal(r.platformEngagement.length, platformsExpected);
    assert.equal(r.suppressedCohorts, roleA.platformId === roleB.platformId ? 1 : 2);
    assert.equal(r.participation.joined, 9); assert.equal(r.participation.completedRate, 1); assert.equal(r.topSkills.length, 10); assert.equal(r.topSkills[0].count, 9);
    assert.equal(r.coreCriticalDensity.totalSelections, 225); assert.equal(r.coreCriticalDensity.optional, 0);
    assert.ok(r.matrixAlignment.rate >= 0 && r.matrixAlignment.rate <= 1); assert.equal(r.matrixAlignment.participants, 9); assert.ok(r.skillsBeyondMatrix.length <= 10);
    assert.deepEqual(findForbiddenKeys('insights', r), []); assert.ok(!JSON.stringify(r).includes('p0'));
    // API: a fresh server with 4 participants in one role suppresses it, a 5th reveals it
    const s = await startServer();
    try {
      await createRound(s);
      for (let i = 0; i < 4; i++) { const p = await join(s, { profile: { platformId: roleA.platformId, roleId: roleA.id } }); await readyBoard(s, p, boardSet(i)); }
      let ins = (await s.api.get(`/admin/events/${EVENT_ID}/insights`, s.admin)).body;
      assert.deepEqual(ins.roleEngagement, []); assert.equal(ins.suppressedCohorts, 2); assert.equal(ins.participation.joined, 4); assert.equal(ins.matrixVersion, MATRIX_VERSION); assert.ok(ins.computedAt);
      const fifth = await join(s, { profile: { platformId: roleA.platformId, roleId: roleA.id } }); await readyBoard(s, fifth, boardSet(9));
      ins = (await s.api.get(`/admin/events/${EVENT_ID}/insights`, s.admin)).body;
      assert.deepEqual(ins.roleEngagement, [], 'cached for 2 s');
      s.clock.advance(2500);
      ins = (await s.api.get(`/admin/events/${EVENT_ID}/insights`, s.admin)).body;
      assert.equal(ins.roleEngagement.length, 1); assert.equal(ins.roleEngagement[0].joined, 5); assert.equal(ins.suppressedCohorts, 0);
      assert.deepEqual(findForbiddenKeys('insights', ins), []);
      const stage = (await s.api.get(`/stage/events/${EVENT_ID}/snapshot`, s.stage)).body.insights;
      assert.deepEqual(Object.keys(stage).sort(), ['coreCriticalDensity', 'matrixAlignment', 'platformEngagement', 'roleEngagement', 'skillsBeyondMatrix', 'suppressedCohorts', 'topSkills']);
    } finally { await s.close(); }
  });

  test('retention removes participant-identifying rows of events closed longer than the retention period and keeps an aggregate archive', async () => {
    const s = await startServer({ retentionDays: 90 });
    try {
      const round = await createRound(s);
      const a = await join(s); await readyBoard(s, a, boardSet(0));
      const started = await startRound(s, round); await drawUntilEnd(s, started);
      const r = s.db.get('SELECT * FROM rounds WHERE id = ?', round.roundId);
      s.clock.set(Date.parse(r.published_at ?? r.ended_at) + 20000); s.app.timers.tick();
      assert.equal(s.db.get('SELECT state FROM rounds WHERE id = ?', round.roundId).state, 'CLOSED');
      const early = s.app.runRetention(s.clock.now() + 30 * 86400000);
      assert.deepEqual(early.archivedEvents, []); assert.equal(s.db.get('SELECT COUNT(*) AS c FROM participants').c, 1);
      const late = s.app.runRetention(s.clock.now() + 91 * 86400000);
      assert.deepEqual(late.archivedEvents, [EVENT_ID]);
      for (const table of ['participants', 'sessions', 'boards', 'board_cells', 'board_matches', 'winners', 'souls', 'float_tokens', 'events_outbox']) assert.equal(s.db.get(`SELECT COUNT(*) AS c FROM ${table}`).c, 0, table);
      assert.equal(s.db.get("SELECT COUNT(*) AS c FROM audit_log WHERE actor LIKE 'prt_%'").c, 0);
      assert.ok(s.db.get("SELECT COUNT(*) AS c FROM audit_log WHERE actor = 'admin'").c > 0, 'admin audit trail retained');
      const arch = s.db.get('SELECT * FROM aggregate_archive WHERE event_id = ?', EVENT_ID);
      assert.ok(arch); const agg = JSON.parse(arch.insights_json); assert.equal(agg.participation.joined, 1); assert.ok(!JSON.stringify(agg).includes(a.participantId));
      assert.equal(s.db.get('SELECT status FROM events WHERE id = ?', EVENT_ID).status, 'archived');
      assert.equal((await s.api.get(`/events/${EVENT_ID}/snapshot`)).status, 200);
    } finally { s.clock.unfreeze(); await s.close(); }
  });
});
