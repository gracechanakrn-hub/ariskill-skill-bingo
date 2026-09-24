import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, join, readyBoard, boardSet, mixedSet, startRound, drawUntilEnd, readSse, fiveSkillLineScenario, EVENT_ID, OPTIONAL_IDS } from './helpers.js';
import { FORBIDDEN_KEYS, findForbiddenKeys, redact } from '../src/projections.js';
import publicContract from '../../../contracts/projections/public.json' with { type: 'json' };
import stageContract from '../../../contracts/projections/stage.json' with { type: 'json' };
import realtime from '../../../contracts/realtime-events.json' with { type: 'json' };

const contractKeys = (list) => list.map(s => s.split(/\s+/)[0]).filter(w => /^[a-z][A-Za-z]+$/.test(w) && !['any', 'other', 'aggregate'].includes(w));

describe('projections and realtime (P-02, P-03, P-04, P-06, S-01..S-03, BR-18, D-08)', () => {
  let t;
  before(async () => { t = await startServer({ extra: { sseReplayLimit: 40 } }); });
  after(async () => { await t.close(); });

  test('FORBIDDEN_KEYS cover every key of the contract forbidden lists and redact() strips them recursively', () => {
    for (const k of contractKeys(publicContract.forbidden)) assert.ok(FORBIDDEN_KEYS.public.includes(k), `public ${k}`);
    for (const k of contractKeys(stageContract.forbidden)) assert.ok(FORBIDDEN_KEYS.stage.includes(k), `stage ${k}`);
    const dirty = { a: { participantId: 'x', list: [{ floatToken: 't', ok: 1 }], cells: [] }, employeeRef: 'e' };
    const clean = redact('public', structuredClone(dirty));
    assert.deepEqual(clean, { a: { list: [{ ok: 1 }] } });
    assert.deepEqual(findForbiddenKeys('public', dirty).sort(), ['$.a.cells', '$.a.list[0].floatToken', '$.a.participantId', '$.employeeRef']);
  });

  test('public snapshot in Waiting includes join (QR payload) and countdown fields; stage never includes joinUrl', async () => {
    const round = await createRound(t, { title: 'Proj 1' });
    const pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub.publicState, 'Waiting'); assert.equal(pub.round.roundId, round.roundId); assert.equal(pub.round.lockAt, round.lockAt);
    assert.ok(pub.join.joinUrl.includes('/play?t=')); assert.ok(pub.join.expiresAt); assert.equal(pub.eventName, 'Test Event');
    assert.equal(typeof pub.sequence, 'number'); assert.ok(pub.serverTime); assert.equal(pub.currentDraw, null); assert.deepEqual(pub.winners, []); assert.equal(pub.galaxy.count, 0);
    assert.deepEqual(findForbiddenKeys('public', pub), []);
    const st = (await t.api.get(`/stage/events/${EVENT_ID}/snapshot`, t.stage)).body;
    assert.deepEqual(findForbiddenKeys('stage', st), []); assert.equal(st.join, undefined); assert.equal(st.round.startOverdue, false); assert.ok(st.insights);
    assert.equal(pub.sequence, t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', EVENT_ID).s);
    await command(t, round.roundId, 'round.cancel', round.version, { reason: 'cleanup' });
  });

  test('public/stage snapshots and every SSE payload contain no forbidden keys across Playing, Winner and Closed; winner labels follow consent', async () => {
    const sc = await fiveSkillLineScenario(t, { extraPlayers: [{ join: { displayName: 'Hidden Name', consent: false }, layout: (e5) => [...OPTIONAL_IDS.slice(20, 25), ...e5, ...OPTIONAL_IDS.slice(25, 40)] }] });
    const seq0 = t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', EVENT_ID).s;
    const pubStream = readSse(t.baseUrl, `/events/${EVENT_ID}/stream`, { timeoutMs: 1500, until: ev => ev.some(e => e.event === 'result.published') });
    const stageStream = readSse(t.baseUrl, `/stage/events/${EVENT_ID}/stream`, { token: t.stage, timeoutMs: 1500, until: ev => ev.some(e => e.event === 'result.published') });
    await new Promise(r => setTimeout(r, 50));
    let cur = sc.round;
    for (let i = 0; i < 2; i++) { const r = await command(t, cur.roundId, 'round.draw.next', cur.version); cur = r.round; }
    const playing = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(playing.publicState, 'Playing'); assert.equal(playing.currentDraw.number, 2); assert.equal(playing.currentDraw.bingoEvaluationActive, false); assert.equal(playing.recentDraws.length, 2); assert.equal(playing.counts.matchedBoards, 2);
    assert.equal(playing.pacingMessage, 'Bingo unlocks at draw 5'); assert.deepEqual(findForbiddenKeys('public', playing), []);
    const { round: end } = await drawUntilEnd(t, cur);
    assert.equal(end.state, 'WINNER');
    const winner = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(winner.publicState, 'Winner'); assert.equal(winner.winners.length, 2);
    const labels = winner.winners.map(w => w.label).sort();
    assert.equal(labels.includes('Line Player'), true); assert.ok(labels.some(l => /^Soul #\d{4}$/.test(l))); assert.ok(!labels.includes('Hidden Name'));
    assert.deepEqual(findForbiddenKeys('public', winner), []); assert.ok(winner.round.resultWindowEndsAt);
    const stage = (await t.api.get(`/stage/events/${EVENT_ID}/snapshot`, t.stage)).body;
    assert.equal(stage.publicState, 'Winner'); assert.equal(stage.winners[0].winningDrawNumber, 5); assert.equal(stage.resultTiming.winningDrawNumber, 5); assert.deepEqual(findForbiddenKeys('stage', stage), []);
    assert.equal(stage.recentDraws.length, 5);
    const [pubEvents, stageEvents] = [await pubStream, await stageStream];
    assert.ok(pubEvents.events.filter(e => e.event).length >= 5);
    for (const [aud, evs] of [['public', pubEvents.events], ['stage', stageEvents.events]]) for (const e of evs.filter(x => x.event)) {
      assert.deepEqual(findForbiddenKeys(aud, e.data), [], `${aud} ${e.event}`);
      assert.ok(realtime.types[e.data.type].audiences.includes(aud), `${e.data.type} allowed for ${aud}`);
      assert.equal(e.id, e.data.sequence); assert.equal(e.data.eventId, EVENT_ID); assert.ok(e.data.occurredAt);
    }
    const ids = pubEvents.events.filter(e => e.event).map(e => e.id);
    assert.ok(ids.every((v, i) => i === 0 || v > ids[i - 1]), 'monotonic sequence');
    const typesSeen = new Set(pubEvents.events.map(e => e.event));
    for (const ty of ['draw.accepted', 'draw.match_counts_updated', 'bingo.detected', 'result.published', 'participation.updated']) assert.ok(typesSeen.has(ty), ty);
    assert.ok(!typesSeen.has('board.locked_active') && !typesSeen.has('soul.created'), 'participant-only events never reach public');
    const draw = pubEvents.events.find(e => e.event === 'draw.accepted').data.payload;
    assert.ok('draw' in draw && 'poolRemaining' in draw && 'matchedBoards' in draw && 'bingoEvaluationActive' in draw); assert.ok(!('myMatchedPositions' in draw));
    const stageCounts = stageEvents.events.find(e => e.event === 'draw.match_counts_updated').data.payload;
    assert.ok(!('boardsWithFourInLine' in stageCounts));
    const res = pubEvents.events.find(e => e.event === 'result.published').data.payload;
    assert.deepEqual(Object.keys(res.winners[0]).sort(), ['label', 'soulId']);
    assert.ok(pubEvents.events.every(e => e.id === null || e.id > seq0));
    // close through the timer and check previousWinners on the next round
    t.clock.set(Date.parse(t.db.get('SELECT published_at FROM rounds WHERE id = ?', end.roundId).published_at) + 20000);
    try { t.app.timers.tick(); } finally { t.clock.unfreeze(); }
    const next = await createRound(t, { title: 'After' });
    const pub2 = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub2.round.roundId, next.roundId); assert.equal(pub2.previousWinners.length, 1); assert.equal(pub2.previousWinners[0].labels.length, 2);
    assert.deepEqual(findForbiddenKeys('public', pub2), []);
    await command(t, next.roundId, 'round.cancel', next.version, { reason: 'cleanup' });
  });

  test('admin snapshot: counts, readiness, connections; participant stream only includes own board and gets myMatchedPositions', async () => {
    const round = await createRound(t, { title: 'Streams' });
    const a = await join(t), b = await join(t);
    await readyBoard(t, a, boardSet(0)); await readyBoard(t, b, boardSet(0));
    const aStream = readSse(t.baseUrl, '/me/stream', { token: a.token, timeoutMs: 1500, until: ev => ev.some(e => e.event === 'draw.accepted') });
    await new Promise(r => setTimeout(r, 50));
    const adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body;
    assert.equal(adm.connections.participants, 1); assert.ok(adm.join.joinUrl); assert.equal(adm.currentRound.counts.connections, 1);
    assert.equal(adm.currentRound.counts.completed, 2); assert.equal(adm.currentRound.readiness.poolSize, 25); assert.deepEqual(adm.currentRound.pacingHintSeconds, [5, 8]);
    assert.deepEqual(findForbiddenKeys('admin', adm), []);
    const started = await startRound(t, round);
    const d = await command(t, round.roundId, 'round.draw.next', started.version);
    const { events } = await aStream;
    const typed = events.filter(e => e.event);
    const aBoard = (await t.api.get('/me', a.token)).body.board.boardId;
    assert.ok(typed.some(e => e.event === 'board.locked_active' && e.data.payload.board.boardId === aBoard));
    const boardIdsSeen = typed.filter(e => e.data.payload.board).map(e => e.data.payload.board.boardId);
    const bBoard = (await t.api.get('/me', b.token)).body.board.boardId;
    assert.ok(!boardIdsSeen.includes(bBoard), 'never sees another participant board');
    const draw = typed.find(e => e.event === 'draw.accepted').data.payload;
    assert.ok(Array.isArray(draw.myMatchedPositions)); assert.equal(draw.myMatchedPositions.length, 1);
    assert.ok(!('matchedPositionsByParticipant' in draw));
    assert.ok(typed.every(e => findForbiddenKeys('participant', e.data).length === 0));
    assert.equal(d.effects.matchedBoards, 2);
    await command(t, round.roundId, 'round.cancel', d.resultingVersion, { reason: 'cleanup' });
  });

  test('SSE resume: since replays only newer events; a gap larger than the replay window yields system.snapshot_required; Last-Event-ID header; heartbeat', async () => {
    const latest = t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', EVENT_ID).s;
    const from = latest - 3;
    const r = await readSse(t.baseUrl, `/events/${EVENT_ID}/stream`, { since: from, timeoutMs: 500 });
    assert.equal(r.status, 200); assert.ok(r.contentType.startsWith('text/event-stream'));
    const typed = r.events.filter(e => e.event);
    const expectPublic = (since) => t.db.all('SELECT sequence, type FROM events_outbox WHERE event_id = ? AND sequence > ? AND participant_id IS NULL ORDER BY sequence', EVENT_ID, since).filter(x => realtime.types[x.type].audiences.includes('public')).map(x => x.sequence);
    assert.ok(expectPublic(from).length >= 1);
    assert.deepEqual(typed.map(e => e.id), expectPublic(from));
    assert.ok(typed.every(e => e.id > from));
    const h = await readSse(t.baseUrl, `/events/${EVENT_ID}/stream`, { headers: { 'Last-Event-ID': String(latest - 1) }, timeoutMs: 400 });
    assert.deepEqual(h.events.filter(e => e.event).map(e => e.id), expectPublic(latest - 1));
    const gap = await readSse(t.baseUrl, `/events/${EVENT_ID}/stream`, { since: 0, timeoutMs: 400 });
    const first = gap.events.find(e => e.event);
    assert.equal(first.event, 'system.snapshot_required'); assert.equal(first.data.sequence, latest); assert.equal(first.data.payload.reason, 'replay-window-exceeded');
    const ahead = await readSse(t.baseUrl, `/events/${EVENT_ID}/stream`, { since: latest + 50, timeoutMs: 400 });
    assert.equal(ahead.events.find(e => e.event).event, 'system.snapshot_required');
    const hb = await readSse(t.baseUrl, `/events/${EVENT_ID}/stream`, { timeoutMs: 600 });
    assert.ok(hb.events.some(e => e.comment && e.comment.startsWith('ping')), 'heartbeat comment');
    for (let i = 0; i < 50 && t.app.hub.size() > 0; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal(t.app.hub.size(), 0, 'closed streams are released');
  });

  test('DEF-01 regression: non-consented winner labels in public/stage/admin snapshots and previousWinners equal the pseudonym in result.published', async () => {
    const sc = await fiveSkillLineScenario(t, { extraPlayers: [
      { join: { displayName: 'Hidden A', consent: false }, layout: (e5) => [...OPTIONAL_IDS.slice(20, 25), ...e5, ...OPTIONAL_IDS.slice(25, 40)] },
      { join: { displayName: 'Hidden B', consent: false }, set: mixedSet(5, 0, 28), layout: (e5) => [...OPTIONAL_IDS.slice(28, 38), ...e5, ...OPTIONAL_IDS.slice(38, 48)] },
    ] });
    const { round: end } = await drawUntilEnd(t, sc.round);
    assert.equal(end.state, 'WINNER');
    const published = t.db.all("SELECT payload_json FROM events_outbox WHERE event_id = ? AND round_id = ? AND type = 'result.published'", EVENT_ID, end.roundId).map(r => JSON.parse(r.payload_json));
    assert.equal(published.length, 1);
    const eventLabels = published[0].winners.map(w => w.label).sort();
    assert.equal(eventLabels.length, 3);
    const pseudonyms = eventLabels.filter(l => l.startsWith('Soul #'));
    assert.equal(pseudonyms.length, 2); assert.notEqual(pseudonyms[0], pseudonyms[1], 'distinct pseudonyms per participant');
    const pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    const stage = (await t.api.get(`/stage/events/${EVENT_ID}/snapshot`, t.stage)).body;
    const adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body;
    assert.deepEqual(pub.winners.map(w => w.label).sort(), eventLabels);
    assert.deepEqual(stage.winners.map(w => w.label).sort(), eventLabels);
    assert.deepEqual(adm.currentRound.winners.map(w => w.label).sort(), eventLabels);
    for (const w of published[0].winners) assert.equal(adm.currentRound.winners.find(x => x.participantId === w.participantId).label, w.label);
    t.clock.set(Date.parse(t.db.get('SELECT published_at FROM rounds WHERE id = ?', end.roundId).published_at) + 20000);
    try { t.app.timers.tick(); } finally { t.clock.unfreeze(); }
    const next = await createRound(t, { title: 'After DEF-01' });
    const pub2 = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.deepEqual(pub2.previousWinners[0].labels.slice().sort(), eventLabels);
    await command(t, next.roundId, 'round.cancel', next.version, { reason: 'cleanup' });
  });

  test('DEF-02 regression: cancelling a DRAFT next round while the current round is PLAYING keeps the PLAYING round as the display round', async () => {
    const sc = await fiveSkillLineScenario(t);
    let cur = sc.round;
    cur = (await command(t, cur.roundId, 'round.draw.next', cur.version)).round;
    const draft = await createRound(t, { title: 'Next (draft)', open: false });
    let pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub.round.roundId, cur.roundId); assert.equal(pub.publicState, 'Playing'); assert.equal(pub.nextRound.roundId, draft.roundId);
    await command(t, draft.roundId, 'round.cancel', draft.version, { reason: 'wrong date' });
    pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub.round.roundId, cur.roundId, 'display round is still the PLAYING round'); assert.equal(pub.publicState, 'Playing'); assert.equal(pub.notice, null); assert.equal(pub.nextRound, null);
    const stage = (await t.api.get(`/stage/events/${EVENT_ID}/snapshot`, t.stage)).body;
    assert.equal(stage.round.roundId, cur.roundId); assert.equal(stage.publicState, 'Playing'); assert.equal(stage.currentDraw.number, 1);
    const { round: end } = await drawUntilEnd(t, cur);
    pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub.round.roundId, end.roundId); assert.equal(pub.publicState, 'Winner');
    // once the played round is terminal, the latest non-DRAFT round (here: the cancelled one, higher number) is shown with its notice
    t.clock.set(Date.parse(t.db.get('SELECT published_at FROM rounds WHERE id = ?', end.roundId).published_at) + 20000);
    try { t.app.timers.tick(); } finally { t.clock.unfreeze(); }
    pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub.round.roundId, draft.roundId); assert.equal(pub.notice.kind, 'cancelled');
    const opened = await createRound(t, { title: 'Open again' });
    pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.equal(pub.round.roundId, opened.roundId, 'an active round always wins over terminal ones');
    await command(t, opened.roundId, 'round.cancel', opened.version, { reason: 'cleanup' });
  });

  test('DEF-03 / ADM-01: stage snapshot has no galaxy; admin round summaries carry resultWindowEndsAt', async () => {
    const sc = await fiveSkillLineScenario(t);
    const stage = (await t.api.get(`/stage/events/${EVENT_ID}/snapshot`, t.stage)).body;
    assert.ok(!('galaxy' in stage), 'stage must not include the public galaxy');
    for (const k of Object.keys(stage)) assert.ok(k in stageContract.allow || ['correlationId', 'serverTime'].includes(k), `stage key ${k} is allowlisted`);
    let adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body;
    assert.equal(adm.currentRound.summary.resultWindowEndsAt, null);
    const { round: end } = await drawUntilEnd(t, sc.round);
    adm = (await t.api.get(`/admin/events/${EVENT_ID}/snapshot`, t.admin)).body;
    const published = t.db.get('SELECT published_at FROM rounds WHERE id = ?', end.roundId).published_at;
    const expected = new Date(Date.parse(published) + 12000).toISOString();
    assert.equal(adm.currentRound.summary.resultWindowEndsAt, expected);
    assert.equal(adm.rounds.find(r => r.roundId === end.roundId).resultWindowEndsAt, expected);
    assert.deepEqual(findForbiddenKeys('admin', adm), []);
    t.clock.set(Date.parse(published) + 20000);
    try { t.app.timers.tick(); } finally { t.clock.unfreeze(); }
  });

  test('EO-02: participant.publicLabel equals the label result.published uses for that participant (consented and pseudonymous)', async () => {
    const sc = await fiveSkillLineScenario(t, { extraPlayers: [{ join: { displayName: 'Anon Winner', consent: false }, layout: (e5) => [...OPTIONAL_IDS.slice(20, 25), ...e5, ...OPTIONAL_IDS.slice(25, 40)] }] });
    const anon = sc.others[0].p;
    const before = (await t.api.get('/me', anon.token)).body.participant;
    assert.match(before.publicLabel, /^Soul #\d{4}$/); assert.equal(before.displayName, 'Anon Winner');
    const { round: end } = await drawUntilEnd(t, sc.round);
    assert.equal(end.state, 'WINNER');
    const published = JSON.parse(t.db.get("SELECT payload_json FROM events_outbox WHERE event_id = ? AND round_id = ? AND type = 'result.published'", EVENT_ID, end.roundId).payload_json);
    const anonLabel = published.winners.find(w => w.participantId === anon.participantId).label;
    const lineLabel = published.winners.find(w => w.participantId === sc.p.participantId).label;
    assert.equal((await t.api.get('/me', anon.token)).body.participant.publicLabel, anonLabel);
    assert.equal((await t.api.get('/me', sc.p.token)).body.participant.publicLabel, lineLabel); assert.equal(lineLabel, 'Line Player');
    const pub = (await t.api.get(`/events/${EVENT_ID}/snapshot`)).body;
    assert.ok(pub.winners.some(w => w.label === anonLabel)); assert.deepEqual(findForbiddenKeys('public', pub), []);
    t.clock.set(Date.parse(t.db.get('SELECT published_at FROM rounds WHERE id = ?', end.roundId).published_at) + 20000);
    try { t.app.timers.tick(); } finally { t.clock.unfreeze(); }
  });

  test('participant snapshot shape and redaction; other participants are never present', async () => {
    const round = await createRound(t, { title: 'Me' });
    const a = await join(t, { displayName: 'Only Me', consent: false });
    await readyBoard(t, a, boardSet(0));
    const me = (await t.api.get('/me', a.token)).body;
    assert.deepEqual(Object.keys(me).sort(), ['board', 'correlationId', 'draws', 'event', 'insightAvailable', 'nextRound', 'participant', 'result', 'round', 'sequence', 'serverTime', 'soul']);
    assert.deepEqual(me.participant, { participantId: a.participantId, displayName: 'Only Me', consentPublicName: false, platformId: me.participant.platformId, roleId: me.participant.roleId, publicLabel: me.participant.publicLabel });
    assert.match(me.participant.publicLabel, /^Soul #\d{4}$/);
    assert.equal(me.board.selectedSkillIds.length, 25); assert.equal(me.board.cells.length, 25);
    assert.deepEqual(findForbiddenKeys('participant', me), []); assert.ok(!JSON.stringify(me).includes(a.employeeRef));
    await command(t, round.roundId, 'round.cancel', round.version, { reason: 'cleanup' });
  });
});
