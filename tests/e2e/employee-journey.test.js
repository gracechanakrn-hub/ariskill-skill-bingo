// Canonical employee journey (requirement 4.1, AC 1, 2, 3, 9, 11, 12; M-01, M-02, M-04..M-07, M-12, M-13; E2, E4, E5, E8, E16).
// Independent QA evidence: everything goes through the HTTP API of an in-process server on port 0.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, join, me, saveBoard, finalizeBoard, readyBoard, boardSet, startRound, drawUntilEnd, openStream, closeByTimer, nextKey, sleep, ELIGIBLE_IDS, ACTIVE_IDS, roleAt, SKILLS_BY_ID } from './helpers.js';
import { exception, t as copy } from '../../packages/contracts/index.js';

describe('employee journey: join -> profile -> discover -> 25 skills -> READY -> lock -> play -> Soul -> Float', () => {
  let t, round, alice, bob, carol, aliceFirstLayout;
  const aliceSet = boardSet(0);
  before(async () => { t = await startServer(); round = await createRound(t, { title: 'Journey 1' }); });
  after(async () => { await t.close(); });

  test('join with the signed token from /join-info; expired, tampered and foreign tokens are rejected with E2 (M-01)', async () => {
    const info = await t.api.get(`/events/${t.eventId}/join-info`);
    assert.equal(info.status, 200); assert.ok(info.body.joinUrl.includes('/play?t=')); assert.ok(Date.parse(info.body.expiresAt) > t.clock.now());
    const token = decodeURIComponent(new URL(info.body.joinUrl).searchParams.get('t'));
    const ok = await t.api.post(`/events/${t.eventId}/session`, { joinToken: token, employeeRef: 'emp-alice', displayName: 'Alice Public', consentPublicName: true });
    assert.equal(ok.status, 201);
    for (const k of ['sessionToken', 'participantId', 'eventId', 'expiresAt', 'correlationId', 'serverTime']) assert.ok(k in ok.body, k);
    assert.equal(ok.body.eventId, t.eventId); assert.ok(ok.body.participantId.startsWith('prt_'));
    alice = { token: ok.body.sessionToken, participantId: ok.body.participantId, employeeRef: 'emp-alice', displayName: 'Alice Public' };
    // same employee scanning again -> same participant, new session
    const again = await t.api.post(`/events/${t.eventId}/session`, { joinToken: token, employeeRef: 'emp-alice', displayName: 'Alice Public', consentPublicName: true });
    assert.equal(again.status, 201); assert.equal(again.body.participantId, alice.participantId); assert.notEqual(again.body.sessionToken, alice.token);
    const expired = await t.api.post(`/events/${t.eventId}/session`, { joinToken: t.joinToken(-30), employeeRef: 'emp-x', displayName: 'X', consentPublicName: false });
    assert.equal(expired.status, 401); assert.equal(expired.body.error.code, 'TOKEN_EXPIRED'); assert.equal(expired.body.error.exceptionId, 'E2'); assert.equal(expired.body.error.message, exception('E2').copy);
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    const bad = await t.api.post(`/events/${t.eventId}/session`, { joinToken: tampered, employeeRef: 'emp-x', displayName: 'X', consentPublicName: false });
    assert.equal(bad.status, 401); assert.equal(bad.body.error.exceptionId, 'E2');
    const foreign = await t.api.post(`/events/${t.eventId}/session`, { joinToken: t.joinToken(3600, 'evt_other'), employeeRef: 'emp-x', displayName: 'X', consentPublicName: false });
    assert.equal(foreign.status, 401); assert.equal(foreign.body.error.code, 'TOKEN_EXPIRED');
    const missing = await t.api.post(`/events/${t.eventId}/session`, { employeeRef: 'emp-x', displayName: 'X', consentPublicName: false });
    assert.equal(missing.status, 400); assert.equal(missing.body.error.code, 'VALIDATION');
    const noSession = await t.api.get('/me', 'not-a-session');
    assert.equal(noSession.status, 401); assert.equal(noSession.body.error.exceptionId, 'E9');
  });

  test('no prefill: Platform and Role are empty until explicitly chosen; discovery, save and finalize are E16 before that (M-02, AC 2)', async () => {
    const m0 = await me(t, alice);
    assert.equal(m0.participant.platformId, null); assert.equal(m0.participant.roleId, null); assert.equal(m0.board, null);
    for (const [name, r] of [
      ['discovery', await t.api.get('/skills/discovery?mode=recommended', alice.token)],
      ['save', await t.api.put('/me/board/selections', { skillIds: [ELIGIBLE_IDS[0]], boardVersion: 0 }, alice.token)],
      ['finalize', await t.api.post('/me/board/finalize', { boardVersion: 0 }, alice.token)],
    ]) { assert.equal(r.status, 409, name); assert.equal(r.body.error.code, 'PROFILE_REQUIRED', name); assert.equal(r.body.error.exceptionId, 'E16', name); assert.equal(r.body.error.message, exception('E16').copy); }
    const tax = await t.api.get('/taxonomy', alice.token);
    assert.equal(tax.status, 200); assert.ok(tax.body.platforms.length > 0 && tax.body.roles.length > 0 && tax.body.matrixVersion);
    const role = tax.body.roles[0];
    const wrongPlatform = tax.body.platforms.find(p => p.id !== role.platformId);
    const mismatch = await t.api.post('/me/profile', { platformId: wrongPlatform.id, roleId: role.id }, alice.token);
    assert.equal(mismatch.status, 400, 'role must belong to the chosen platform');
    const set = await t.api.post('/me/profile', { platformId: role.platformId, roleId: role.id }, alice.token);
    assert.equal(set.status, 200); assert.equal(set.body.participant.platformId, role.platformId); assert.equal(set.body.participant.roleId, role.id);
    assert.equal((await me(t, alice)).participant.roleId, role.id);
  });

  test('discovery: recommended (role order core -> critical -> optional), popular, search (M-03, BR-03)', async () => {
    const rec = await t.api.get('/skills/discovery?mode=recommended&limit=200', alice.token);
    assert.equal(rec.status, 200); assert.equal(rec.body.mode, 'recommended'); assert.ok(rec.body.skills.length > 0); assert.equal(rec.body.selectedCount, 0);
    const order = { core: 0, critical: 1, optional: 2 };
    const levels = rec.body.skills.map(s => order[s.roleLevel]);
    assert.ok(levels.every(l => l !== undefined), 'recommended skills carry a role level');
    assert.ok(levels.every((l, i) => i === 0 || l >= levels[i - 1]), 'core before critical before optional');
    for (const s of rec.body.skills) { for (const k of ['id', 'name', 'domain', 'cluster', 'kind', 'isCore', 'isCritical', 'eligible', 'roleLevel']) assert.ok(k in s, k); assert.equal(s.eligible, !!(s.isCore || s.isCritical)); }
    const pop = await t.api.get('/skills/discovery?mode=popular&limit=20', alice.token);
    assert.equal(pop.status, 200); assert.equal(pop.body.mode, 'popular'); assert.ok(pop.body.skills.length > 0 && pop.body.skills.length <= 20);
    const q = 'data';
    const search = await t.api.get(`/skills/discovery?mode=search&q=${q}&limit=500`, alice.token);
    assert.equal(search.status, 200); assert.ok(search.body.skills.length > 0);
    assert.ok(search.body.skills.every(s => [s.name, s.domain, s.cluster].some(v => String(v ?? '').toLowerCase().includes(q))), 'every hit matches name/domain/cluster');
    const names = search.body.skills.map(s => s.name);
    assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b)), 'search results are alphabetical');
    const nothing = await t.api.get('/skills/discovery?mode=search&q=zzzzqqqq', alice.token);
    assert.equal(nothing.status, 200); assert.deepEqual(nothing.body.skills, []);
    const badMode = await t.api.get('/skills/discovery?mode=magic', alice.token);
    assert.equal(badMode.status, 400);
    const noAuth = await t.api.get('/skills/discovery?mode=recommended');
    assert.equal(noAuth.status, 401);
  });

  test('25 unique skills: duplicate rejected (E4), 26th rejected, finalize -> READY with 25 unique positions holding the requested skills (M-04..M-06, AC 1)', async () => {
    const partial = await saveBoard(t, alice, aliceSet.slice(0, 24));
    assert.equal(partial.status, 200); assert.equal(partial.body.board.state, 'DRAFT'); assert.equal(partial.body.board.selectedSkillIds.length, 24); assert.equal(partial.body.board.cells, null); assert.equal(partial.body.resultingVersion, 1);
    assert.equal((await t.api.get('/skills/discovery?mode=recommended', alice.token)).body.selectedCount, 24);
    const dup = await saveBoard(t, alice, [...aliceSet.slice(0, 24), aliceSet[3]]);
    assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'DUPLICATE_SKILL'); assert.equal(dup.body.error.exceptionId, 'E4'); assert.equal(dup.body.error.message, exception('E4').copy);
    assert.equal((await me(t, alice)).board.version, 1, 'rejected save did not mutate');
    const twentySix = await saveBoard(t, alice, ACTIVE_IDS.slice(0, 26));
    assert.equal(twentySix.status, 400); assert.equal(twentySix.body.error.code, 'VALIDATION');
    const inactiveOrUnknown = await saveBoard(t, alice, [...aliceSet.slice(0, 24), 'skill_not_in_master']);
    assert.equal(inactiveOrUnknown.status, 400);
    const early = await finalizeBoard(t, alice);
    assert.equal(early.status, 400, 'finalize needs exactly 25');
    const full = await saveBoard(t, alice, aliceSet);
    assert.equal(full.status, 200); assert.deepEqual(full.body.board.selectedSkillIds, aliceSet); assert.equal(full.body.board.state, 'DRAFT');
    const fin = await t.api.post('/me/board/finalize', { boardVersion: full.body.resultingVersion, cells: aliceSet.map((skillId, position) => ({ position, skillId })) }, alice.token);
    assert.equal(fin.status, 200);
    const b = fin.body.board;
    assert.equal(b.state, 'READY'); assert.equal(b.cells.length, 25); assert.ok(b.matrixVersion);
    assert.deepEqual(b.cells.map(c => c.position), [...Array(25).keys()], 'positions 0..24 exactly once');
    assert.equal(new Set(b.cells.map(c => c.skillId)).size, 25, 'no skill twice on the board');
    assert.deepEqual(b.cells.map(c => c.skillId).sort(), aliceSet.slice().sort(), 'the board holds exactly the requested skills');
    assert.notDeepEqual(b.cells.map(c => c.skillId), aliceSet, 'client-supplied positions are ignored; server randomizes');
    for (const c of b.cells) { assert.equal(c.name, SKILLS_BY_ID.get(c.skillId).name); assert.ok(['Core', 'Critical', 'Optional'].includes(c.kind)); }
    aliceFirstLayout = b.cells.map(c => c.skillId);
    const readyAgain = await finalizeBoard(t, alice);
    assert.equal(readyAgain.status, 200); assert.equal(readyAgain.body.board.state, 'READY'); assert.deepEqual(readyAgain.body.board.cells.map(c => c.skillId), aliceFirstLayout, 'finalizing a READY board is idempotent');
  });

  test('editing after READY returns the board to DRAFT (positions cleared); re-finalizing the same set yields a new permutation (D-12)', async () => {
    const changed = [...aliceSet.slice(0, 24), ELIGIBLE_IDS[80]];
    const s1 = await saveBoard(t, alice, changed);
    assert.equal(s1.status, 200); assert.equal(s1.body.board.state, 'DRAFT'); assert.equal(s1.body.board.cells, null); assert.equal(s1.body.board.matrixVersion, null);
    const s2 = await saveBoard(t, alice, aliceSet);
    assert.equal(s2.status, 200); assert.equal(s2.body.board.state, 'DRAFT');
    const stale = await t.api.put('/me/board/selections', { skillIds: aliceSet, boardVersion: 1 }, alice.token);
    assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'STALE_VERSION'); assert.equal(stale.body.error.details.currentVersion, s2.body.resultingVersion);
    const fin = await finalizeBoard(t, alice);
    assert.equal(fin.status, 200); assert.equal(fin.body.board.state, 'READY');
    const layout = fin.body.board.cells.map(c => c.skillId);
    assert.deepEqual(layout.slice().sort(), aliceSet.slice().sort());
    assert.notDeepEqual(layout, aliceFirstLayout, 'a fresh random permutation (chance of equality 1/25!)');
    aliceFirstLayout = layout;
  });

  test('lock: incomplete board -> DEFERRED with an E5 event; save after lock -> E8; late joiner after lock is parked as DEFERRED(late) with the E8 notice, never in the pool (BR-05..BR-07, AC 3, AC 9, contract 1.0.2 / D-20)', async () => {
    bob = await join(t, { employeeRef: 'emp-bob', displayName: 'Bob Draft', consent: false, profile: roleAt(3) });
    const bobStream = await openStream(t.baseUrl, '/me/stream', { token: bob.token });
    assert.equal(bobStream.status, 200);
    const partial = await saveBoard(t, bob, boardSet(30, 10));
    assert.equal(partial.status, 200);
    await bobStream.waitFor(ev => ev.some(e => e.event === 'board.saved'), 2000, 'board.saved');
    const l = await command(t, round.roundId, 'round.lock', round.version);
    assert.equal(l.round.state, 'LOCKED'); assert.equal(l.effects.activeBoards, 1); assert.equal(l.effects.deferredBoards, 1);
    round = l.round;
    await bobStream.waitFor(ev => ev.some(e => e.event === 'board.deferred'), 2000, 'board.deferred');
    const deferred = bobStream.events.find(e => e.event === 'board.deferred');
    assert.equal(deferred.data.payload.reason, 'incomplete'); assert.equal(deferred.data.payload.board.state, 'DEFERRED'); assert.deepEqual(deferred.data.payload.board.selectedSkillIds, boardSet(30, 10));
    assert.equal(exception('E5').copy, copy('board.deferred'), 'the E5 copy shown for an incomplete board at lock exists in the catalog');
    bobStream.close(); await bobStream.done;
    const bobMe = await me(t, bob);
    assert.equal(bobMe.board.state, 'DEFERRED'); assert.equal(bobMe.board.cells, null);
    assert.equal((await me(t, alice)).board.state, 'LOCKED_ACTIVE');
    const late = await saveBoard(t, alice, [...aliceSet.slice(1), ELIGIBLE_IDS[90]]);
    assert.equal(late.status, 409); assert.equal(late.body.error.code, 'ROUND_LOCKED'); assert.equal(late.body.error.exceptionId, 'E8'); assert.equal(late.body.error.message, exception('E8').copy);
    assert.equal((await me(t, alice)).board.state, 'LOCKED_ACTIVE', 'rejected save did not mutate the locked board');
    const bobLate = await saveBoard(t, bob, boardSet(30));
    assert.equal(bobLate.status, 409); assert.equal(bobLate.body.error.exceptionId, 'E8', 'deferred boards cannot re-enter a locked round');
    // late joiner (no board in the locked round): contract 1.0.2 -> 200 with a DEFERRED(late) board and the E8 notice
    carol = await join(t, { employeeRef: 'emp-carol', displayName: 'Carol Late', consent: true, profile: roleAt(5) });
    const carolStream = await openStream(t.baseUrl, '/me/stream', { token: carol.token });
    const poolBefore = (await t.api.get(`/admin/events/${t.eventId}/snapshot`, t.admin)).body.currentRound.readiness.poolSize;
    const carolSave = await saveBoard(t, carol, boardSet(50));
    assert.equal(carolSave.status, 200, JSON.stringify(carolSave.body));
    assert.equal(carolSave.body.board.state, 'DEFERRED'); assert.equal(carolSave.body.board.cells, null); assert.deepEqual(carolSave.body.board.selectedSkillIds, boardSet(50)); assert.equal(carolSave.body.board.roundId, round.roundId);
    assert.deepEqual(carolSave.body.notice, { kind: 'late', exceptionId: 'E8', text: exception('E8').copy });
    assert.equal(typeof carolSave.body.resultingVersion, 'number');
    await carolStream.waitFor(ev => ev.some(e => e.event === 'board.deferred'), 2000, 'late board.deferred');
    const lateEv = carolStream.events.find(e => e.event === 'board.deferred');
    assert.equal(lateEv.data.payload.reason, 'late'); assert.equal(lateEv.data.payload.board.state, 'DEFERRED'); assert.equal(lateEv.data.payload.board.boardId, carolSave.body.board.boardId);
    carolStream.close(); await carolStream.done;
    const carolMe = await me(t, carol);
    assert.equal(carolMe.board.state, 'DEFERRED', 'late board is parked, not active'); assert.equal(carolMe.round.state, 'LOCKED'); assert.equal(carolMe.board.cells, null);
    const carolAgain = await saveBoard(t, carol, boardSet(51));
    assert.equal(carolAgain.status, 409, 'once parked, the deferred board cannot re-enter the locked round'); assert.equal(carolAgain.body.error.exceptionId, 'E8');
    assert.equal((await t.api.get(`/admin/events/${t.eventId}/snapshot`, t.admin)).body.currentRound.readiness.poolSize, poolBefore, 'late board never enters the pool');
    assert.equal(t.db.get("SELECT COUNT(*) AS c FROM boards WHERE round_id = ? AND state = 'LOCKED_ACTIVE'", round.roundId).c, 1, 'active boards unchanged');
    assert.equal(t.db.get('SELECT deferred_reason FROM boards WHERE id = ?', carolSave.body.board.boardId).deferred_reason, 'late');
    const pub = (await t.api.get(`/events/${t.eventId}/snapshot`)).body;
    assert.equal(pub.publicState, 'Waiting'); assert.equal(pub.join, null, 'no QR join link while locked'); assert.equal(pub.counts.active, 1);
  });

  test('play to the end: Soul present, private insight only for the finished board, Float once, replay returns the original entrance, never a second entrance (M-12, M-13, AC 11)', async () => {
    const aliceStream = await openStream(t.baseUrl, '/me/stream', { token: alice.token });
    const started = await command(t, round.roundId, 'round.start', round.version);
    assert.equal(started.round.state, 'PLAYING'); assert.equal(started.effects.poolSize, 25);
    const { results, round: end } = await drawUntilEnd(t, started.round);
    assert.equal(end.state, 'WINNER'); assert.ok(results.length >= 5, 'no Bingo before draw 5');
    assert.ok(results.slice(0, 4).every(r => r.effects.winners === undefined && r.round.state === 'PLAYING'));
    const last = results.at(-1);
    assert.equal(last.effects.winners.length, 1); assert.equal(last.effects.winners[0].participantId, alice.participantId); assert.equal(last.effects.winners[0].winningDrawNumber, results.length);
    assert.equal(t.db.get("SELECT COUNT(*) AS c FROM board_matches m JOIN boards b ON b.id = m.board_id WHERE b.participant_id = ?", carol.participantId).c, 0, 'the late board never receives matches');
    assert.equal((await me(t, carol)).soul, null, 'no Soul for a late-deferred board');
    await aliceStream.waitFor(ev => ev.some(e => e.event === 'soul.created'), 3000, 'soul.created');
    const draws = aliceStream.events.filter(e => e.event === 'draw.accepted');
    assert.equal(draws.length, results.length);
    assert.ok(draws.every((d, i) => i === 0 || d.data.payload.myMatchedPositions.length >= draws[i - 1].data.payload.myMatchedPositions.length), 'myMatchedPositions is cumulative');
    const res = aliceStream.events.find(e => e.event === 'result.published');
    assert.equal(res.data.payload.myResult.isWinner, true); assert.ok(res.data.payload.myResult.lineIds.length >= 1);
    const soulEv = aliceStream.events.find(e => e.event === 'soul.created');
    assert.ok(soulEv.data.payload.soul.soulId.startsWith('soul_')); assert.equal(soulEv.data.payload.soul.badge, 'bingo-star'); assert.ok(soulEv.data.payload.soul.floatToken);
    aliceStream.close(); await aliceStream.done;

    const am = await me(t, alice);
    assert.equal(am.board.state, 'FINISHED'); assert.equal(am.result.isWinner, true); assert.equal(am.result.coWinnerCount, 1); assert.equal(am.insightAvailable, true);
    assert.ok(am.soul && am.soul.floatToken && am.soul.floated === false && am.soul.badge === 'bingo-star');
    const insight = await t.api.get('/me/insight', alice.token);
    assert.equal(insight.status, 200); assert.equal(insight.body.roundId, round.roundId); assert.equal(insight.body.totalSelected, 25);
    assert.equal(insight.body.inMatrixCount + insight.body.beyondMatrixCount, 25); assert.ok(insight.body.matrixVersion);
    const bobInsight = await t.api.get('/me/insight', bob.token);
    assert.equal(bobInsight.status, 404, 'deferred (unfinished) board has no insight');
    assert.equal((await me(t, bob)).soul, null, 'no Soul for a deferred board'); assert.equal((await me(t, bob)).insightAvailable, false);
    for (const [name, path, tok] of [['public', `/events/${t.eventId}/snapshot`, null], ['stage', `/stage/events/${t.eventId}/snapshot`, t.stage], ['admin', `/admin/events/${t.eventId}/snapshot`, t.admin], ['insights', `/admin/events/${t.eventId}/insights`, t.admin]]) {
      const text = JSON.stringify((await t.api.get(path, tok)).body);
      assert.ok(!text.includes('inMatrixCount') && !text.includes('beyondMatrixCount'), `${name} never carries the private insight`);
      assert.ok(!text.includes(am.soul.floatToken), `${name} never carries the Float token`);
    }

    // Float: one entrance, replay returns the original, idempotent retry returns the stored response
    const pubStream = await openStream(t.baseUrl, `/events/${t.eventId}/stream`);
    const key = nextKey('float');
    const wrong = await t.api.post('/me/soul/float', { soulId: am.soul.soulId, floatToken: 'bogus' }, alice.token);
    assert.equal(wrong.status, 409); assert.equal(wrong.body.error.exceptionId, 'E13');
    const f1 = await t.api.post('/me/soul/float', { soulId: am.soul.soulId, floatToken: am.soul.floatToken }, alice.token, key);
    assert.equal(f1.status, 200); assert.equal(f1.body.accepted, true); assert.equal(f1.body.replay, false);
    assert.equal(f1.body.entrance.soulId, am.soul.soulId); assert.equal(f1.body.entrance.label, 'Alice Public'); assert.equal(f1.body.entrance.badge, 'bingo-star');
    const retry = await t.api.post('/me/soul/float', { soulId: am.soul.soulId, floatToken: am.soul.floatToken }, alice.token, key);
    assert.equal(retry.status, 200); assert.equal(retry.headers.get('idempotent-replay'), 'true'); assert.deepEqual(retry.body, f1.body, 'same Idempotency-Key -> identical stored response');
    const f2 = await t.api.post('/me/soul/float', { soulId: am.soul.soulId, floatToken: am.soul.floatToken }, alice.token, nextKey('float2'));
    assert.equal(f2.status, 200); assert.equal(f2.body.replay, true); assert.deepEqual(f2.body.entrance, f1.body.entrance, 'replay returns the original entrance');
    await sleep(150);
    pubStream.close(); await pubStream.done;
    assert.equal(pubStream.events.filter(e => e.event === 'soul.float_accepted').length, 1, 'exactly one public entrance event');
    assert.equal(t.db.get("SELECT COUNT(*) AS c FROM events_outbox WHERE event_id = ? AND type = 'soul.float_accepted'", t.eventId).c, 1);
    const after = await me(t, alice);
    assert.equal(after.soul.floated, true); assert.equal(after.soul.floatToken, null, 'consumed token is never shown again');
    const pub = (await t.api.get(`/events/${t.eventId}/snapshot`)).body;
    assert.equal(pub.publicState, 'Winner'); assert.equal(pub.galaxy.count, 1); assert.equal(pub.galaxy.souls[0].label, 'Alice Public'); assert.deepEqual(pub.winners.map(w => w.label), ['Alice Public']);
  });

  test('next round: the deferred board is reassigned as DRAFT with its selections kept and the late joiner can build a board (AC 9, E15 recovery)', async () => {
    const closed = closeByTimer(t, round.roundId);
    assert.equal(closed.state, 'CLOSED');
    const next = await createRound(t, { title: 'Journey 2' });
    const bobMe = await me(t, bob);
    assert.equal(bobMe.board.roundId, next.roundId); assert.equal(bobMe.board.state, 'DRAFT'); assert.deepEqual(bobMe.board.selectedSkillIds, boardSet(30, 10)); assert.equal(bobMe.board.cells, null);
    const bobReady = await readyBoard(t, bob, boardSet(30));
    assert.equal(bobReady.state, 'READY'); assert.equal(bobReady.roundId, next.roundId);
    const carolMe = await me(t, carol);
    assert.equal(carolMe.board.roundId, next.roundId, 'late board reassigned when the next round opens'); assert.equal(carolMe.board.state, 'DRAFT'); assert.deepEqual(carolMe.board.selectedSkillIds, boardSet(50));
    const carolReady = await readyBoard(t, carol, boardSet(50));
    assert.equal(carolReady.state, 'READY'); assert.equal(carolReady.roundId, next.roundId);
    assert.equal(t.db.get("SELECT COUNT(*) AS c FROM boards WHERE participant_id = ? AND deferred_reason = 'late' AND reassigned_to IS NOT NULL", carol.participantId).c, 1, 'the late board is marked reassigned');
    const aliceMe = await me(t, alice);
    assert.equal(aliceMe.board.roundId, round.roundId, 'finished board stays attached to the finished round'); assert.equal(aliceMe.nextRound.roundId, next.roundId);
    const pub = (await t.api.get(`/events/${t.eventId}/snapshot`)).body;
    assert.equal(pub.round.roundId, next.roundId); assert.ok(pub.join.joinUrl); assert.equal(pub.previousWinners.length, 1); assert.deepEqual(pub.previousWinners[0].labels, ['Alice Public']);
    assert.equal(pub.galaxy.count, 1, 'the Galaxy keeps floated Souls across rounds');
  });
});
