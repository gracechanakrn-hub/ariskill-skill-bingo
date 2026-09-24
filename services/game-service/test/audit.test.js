import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, tryCommand, join, readyBoard, boardSet, startRound, drawUntilEnd, EVENT_ID } from './helpers.js';

describe('audit log reconstructs transitions, actors, draws and rejections (A-09, AC-15)', () => {
  let t;
  before(async () => { t = await startServer(); });
  after(async () => { await t.close(); });

  test('a full round leaves an ordered trail: create, open, lock, start, every draw (with number and skill), result, rejections', async () => {
    const round = await createRound(t);
    const a = await join(t); await readyBoard(t, a, boardSet(0));
    const b = await join(t); await readyBoard(t, b, boardSet(0));
    await tryCommand(t, round.roundId, 'round.start', round.version); // illegal
    await tryCommand(t, round.roundId, 'round.lock', round.version + 5); // stale
    const started = await startRound(t, round);
    const { results, round: end } = await drawUntilEnd(t, started);
    assert.equal(end.state, 'WINNER');
    const res = await t.api.get(`/admin/events/${EVENT_ID}/audit?roundId=${round.roundId}&limit=500`, t.admin);
    assert.equal(res.status, 200);
    const entries = res.body.entries;
    assert.ok(entries.every((e, i) => i === 0 || e.id < entries[i - 1].id), 'newest first');
    const chrono = entries.slice().reverse();
    const actions = chrono.filter(e => e.outcome === 'accepted' && e.actor === 'admin').map(e => e.action);
    assert.deepEqual(actions.slice(0, 4), ['round.create', 'round.registration.open', 'round.lock', 'round.start']);
    const draws = chrono.filter(e => e.action === 'round.draw.next' && e.outcome === 'accepted');
    assert.equal(draws.length, results.length);
    assert.deepEqual(draws.map(d => d.details.drawNumber), results.map((_, i) => i + 1));
    assert.deepEqual(draws.map(d => d.details.skillId), results.map(r => r.effects.draw.skill.id));
    assert.ok(draws.at(-1).details.winners.length >= 1 && draws.at(-1).details.winners.every(w => [a.participantId, b.participantId].includes(w)));
    assert.deepEqual(chrono.map(e => [e.details?.fromState, e.details?.toState]).filter(x => x[0]).slice(0, 4), [['DRAFT', 'REGISTRATION_OPEN'], ['REGISTRATION_OPEN', 'LOCKED'], ['LOCKED', 'PLAYING'], ['PLAYING', 'PLAYING']].slice(0, 4).map((x, i) => i === 3 ? [x[0], draws.length === 1 ? 'WINNER' : 'PLAYING'] : x));
    const rejected = chrono.filter(e => e.outcome === 'rejected');
    assert.deepEqual(rejected.map(e => e.details.code), ['ILLEGAL_TRANSITION', 'STALE_VERSION']);
    assert.equal(rejected[1].expectedVersion, round.version + 5); assert.equal(rejected[1].actualVersion, round.version);
    for (const e of entries) { assert.ok(e.correlationId); assert.ok(e.at); assert.ok(e.actor); }
    assert.ok(draws.every(d => d.commandId), 'draw entries carry the command (idempotency) id');
    assert.equal(chrono.find(e => e.action === 'board.finalize')?.actor, a.participantId);
    const finalize = chrono.filter(e => e.action === 'board.finalize');
    assert.equal(finalize.length, 2);
    const adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body.currentRound;
    assert.deepEqual(adm.draws.map(d => d.skill.id), draws.map(d => d.details.skillId), 'audit order equals the draw order in the projection');
    assert.equal(adm.lastCommand.command, 'round.draw.next'); assert.equal(adm.lastCommand.outcome, 'accepted');
    // never log or audit secrets or selections
    const text = JSON.stringify(entries);
    assert.ok(!text.includes(a.token) && !text.includes(a.employeeRef));
    assert.ok(!text.includes('"selectedSkillIds"'));
  });

  test('session creation, profile, float and cancellation are audited; limit and roundId filters work', async () => {
    const round = await createRound(t, { title: 'Audit 2' });
    const a = await join(t);
    const c = await command(t, round.roundId, 'round.cancel', round.version, { reason: 'audit test' });
    assert.equal(c.round.state, 'CANCELLED');
    const all = (await t.api.get(`/admin/events/${EVENT_ID}/audit?limit=3`, t.admin)).body.entries;
    assert.equal(all.length, 3);
    const filtered = (await t.api.get(`/admin/events/${EVENT_ID}/audit?roundId=${round.roundId}`, t.admin)).body.entries;
    assert.ok(filtered.every(e => e.roundId === round.roundId));
    assert.equal(filtered[0].action, 'round.cancel'); assert.equal(filtered[0].details.reason, 'audit test');
    const acts = t.db.all('SELECT action FROM audit_log WHERE actor = ? ORDER BY id', a.participantId).map(r => r.action);
    assert.deepEqual(acts, ['session.create', 'profile.set']);
  });
});
