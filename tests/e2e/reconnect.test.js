// Reconnect / event-gap behaviour (AC 10, P-06, BR-19, requirement 15.4 "reconnection with state reconciliation").
// Streams are dropped client-side, events are generated while disconnected, then resumed with Last-Event-ID / since.
// The replay window is lowered to 30 events (config override) so the "stale since beyond the window" case is reachable.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, command, join, me, readyBoard, boardSet, startRound, drawUntilEnd, openStream, readSse, sleep, nextKey } from './helpers.js';
import realtime from '../../contracts/realtime-events.json' with { type: 'json' };

const REPLAY_LIMIT = 30;
const strip = (snap) => { const { serverTime, correlationId, ...rest } = snap; return rest; };

describe('reconnect: drop, resume with Last-Event-ID, stale resume -> snapshot_required, no duplicate celebrations', () => {
  let t, round, alice, bob, pub, mine, cur;
  before(async () => {
    t = await startServer({ extra: { sseReplayLimit: REPLAY_LIMIT } });
    round = await createRound(t, { title: 'Reconnect' });
    alice = await join(t, { displayName: 'Alice', consent: true }); bob = await join(t, { displayName: 'Bob', consent: false });
    await readyBoard(t, alice, boardSet(0)); await readyBoard(t, bob, boardSet(0));
  });
  after(async () => { await t.close(); });

  /** Outbox rows visible to an audience after `since` (independent expectation built from the realtime contract). */
  function expectedIds(audience, since, participantId = null) {
    return t.db.all('SELECT sequence, type, participant_id FROM events_outbox WHERE event_id = ? AND sequence > ? ORDER BY sequence', t.eventId, since)
      .filter(r => r.participant_id ? (audience === 'participant' && r.participant_id === participantId) : realtime.types[r.type].audiences.includes(audience))
      .map(r => r.sequence);
  }

  test('live streams receive lock/start/draws; heartbeat comments flow', async () => {
    pub = await openStream(t.baseUrl, `/events/${t.eventId}/stream`);
    mine = await openStream(t.baseUrl, '/me/stream', { token: alice.token });
    assert.equal(pub.status, 200); assert.ok(pub.contentType.startsWith('text/event-stream')); assert.equal(mine.status, 200);
    cur = await startRound(t, round);
    for (let i = 0; i < 2; i++) cur = (await command(t, cur.roundId, 'round.draw.next', cur.version)).round;
    await pub.waitFor(ev => ev.filter(e => e.event === 'draw.accepted').length === 2, 2000, 'two public draws');
    await mine.waitFor(ev => ev.filter(e => e.event === 'draw.accepted').length === 2, 2000, 'two participant draws');
    assert.ok(mine.events.some(e => e.event === 'board.locked_active'));
    assert.ok(pub.events.every(e => e.id === e.data.sequence), 'SSE id equals envelope sequence');
    await sleep(400);
    assert.ok(pub.comments.some(c => c.startsWith('ping')), 'heartbeat comment received');
  });

  test('drop both streams, generate events while disconnected, resume with Last-Event-ID: only missed events replay, in order, then live continues (AC 10)', async () => {
    const pubLast = pub.lastId, mineLast = mine.lastId;
    pub.close(); mine.close(); await pub.done; await mine.done;
    for (let i = 0; i < 50 && t.app.hub.size() > 0; i++) await sleep(10);
    assert.equal(t.app.hub.size(), 0, 'server released the dropped connections');
    for (let i = 0; i < 2; i++) cur = (await command(t, cur.roundId, 'round.draw.next', cur.version)).round; // draws 3 and 4 while offline
    const pub2 = await openStream(t.baseUrl, `/events/${t.eventId}/stream`, { lastEventId: pubLast });
    const mine2 = await openStream(t.baseUrl, '/me/stream', { token: alice.token, since: mineLast });
    const expPub = expectedIds('public', pubLast), expMine = expectedIds('participant', mineLast, alice.participantId);
    await pub2.waitFor(ev => ev.length >= expPub.length, 2000, 'public replay'); await mine2.waitFor(ev => ev.length >= expMine.length, 2000, 'participant replay');
    assert.deepEqual(pub2.events.map(e => e.id), expPub, 'public replay = exactly the missed public events');
    assert.deepEqual(mine2.events.map(e => e.id), expMine, 'participant replay = exactly the missed participant events');
    assert.ok(pub2.events.every(e => e.id > pubLast)); assert.ok(!pub2.events.some(e => e.event === 'system.snapshot_required'), 'no snapshot required inside the window');
    assert.deepEqual(pub2.events.filter(e => e.event === 'draw.accepted').map(e => e.data.payload.draw.number), [3, 4]);
    const replayedDraws = mine2.events.filter(e => e.event === 'draw.accepted');
    assert.deepEqual(replayedDraws.map(e => e.data.payload.draw.number), [3, 4]);
    assert.ok(replayedDraws.every(e => Array.isArray(e.data.payload.myMatchedPositions)), 'replayed participant draws are projected per participant');
    assert.deepEqual((await me(t, alice)).board.matchedPositions, replayedDraws.at(-1).data.payload.myMatchedPositions, 'cumulative positions on the last replayed draw equal the snapshot');
    // live continues on the resumed connection without a gap
    cur = (await command(t, cur.roundId, 'round.draw.next', cur.version)).round;
    await pub2.waitFor(ev => ev.some(e => e.event === 'draw.accepted' && e.data.payload.draw.number === 5), 2000, 'live draw 5');
    const latestNow = t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', t.eventId).s;
    await pub2.waitFor(ev => ev.length && ev.at(-1).id >= expectedIds('public', pubLast).at(-1), 2000, 'live tail');
    assert.ok(latestNow >= pub2.lastId);
    const ids = pub2.events.map(e => e.id);
    assert.ok(ids.every((v, i) => i === 0 || v > ids[i - 1]), 'strictly increasing sequence across replay + live');
    assert.deepEqual(ids, expectedIds('public', pubLast), 'no gap between replay and live');
    pub = pub2; mine = mine2;
  });

  test('stale resume beyond the replay window -> system.snapshot_required; snapshot sequence >= last event and equals the live state', async () => {
    // generate more than REPLAY_LIMIT events
    const seqBefore = t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', t.eventId).s;
    // filler: title updates on a DRAFT "next round" each emit one public round.updated; the playing round stays untouched
    let filler = (await createRound(t, { title: 'Filler', open: false }));
    for (let i = 0; t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', t.eventId).s - seqBefore < REPLAY_LIMIT + 5; i++) {
      filler = (await command(t, filler.roundId, 'round.update', filler.version, { title: `Filler ${i}` })).round;
    }
    const latest = t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', t.eventId).s;
    assert.ok(latest - seqBefore > REPLAY_LIMIT, 'enough events generated');
    const stale = await readSse(t.baseUrl, `/events/${t.eventId}/stream`, { since: seqBefore, until: ev => ev.length >= 1, timeoutMs: 1500 });
    assert.equal(stale.status, 200);
    const first = stale.events[0];
    assert.equal(first.event, 'system.snapshot_required'); assert.equal(first.data.payload.reason, 'replay-window-exceeded'); assert.equal(first.data.sequence, latest);
    assert.equal(stale.events.length, 1, 'no partial replay after snapshot_required');
    const snap = (await t.api.get(`/events/${t.eventId}/snapshot`)).body;
    assert.ok(snap.sequence >= first.data.sequence, 'snapshot is at or after the stream position');
    assert.ok(snap.sequence >= pub.lastId, 'snapshot sequence >= last event seen live');
    const again = (await t.api.get(`/events/${t.eventId}/snapshot`)).body;
    assert.deepEqual(strip(snap), strip(again), 'snapshot equals the live state (stable between two reads with no writes)');
    const dbRound = t.db.get('SELECT version, state FROM rounds WHERE id = ?', cur.roundId);
    assert.equal(snap.round.version, dbRound.version); assert.equal(snap.round.state, dbRound.state);
    assert.equal(snap.currentDraw.number, t.db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', cur.roundId).c);
    await pub.waitFor(ev => ev.some(e => e.data.sequence === latest || e.data.sequence >= latest), 2000, 'live stream caught up');
    const lastLiveDraw = pub.events.filter(e => e.event === 'draw.accepted').at(-1);
    assert.equal(snap.currentDraw.number, lastLiveDraw.data.payload.draw.number, 'snapshot state matches the last live draw');
    const staleMine = await readSse(t.baseUrl, '/me/stream', { token: alice.token, since: seqBefore, until: ev => ev.length >= 1, timeoutMs: 1500 });
    assert.equal(staleMine.events[0].event, 'system.snapshot_required');
    const meSnap = await me(t, alice);
    assert.ok(meSnap.sequence >= staleMine.events[0].data.sequence);
    assert.deepEqual(meSnap.board.matchedPositions, mine.events.filter(e => e.event === 'draw.accepted').at(-1).data.payload.myMatchedPositions);
    const ahead = await readSse(t.baseUrl, `/events/${t.eventId}/stream`, { since: latest + 1000, until: ev => ev.length >= 1, timeoutMs: 1500 });
    assert.equal(ahead.events[0].event, 'system.snapshot_required'); assert.equal(ahead.events[0].data.payload.reason, 'sequence-ahead');
    const bad = await t.api.get(`/events/${t.eventId}/stream?since=abc`, null, { Accept: 'text/event-stream' });
    assert.equal(bad.status, 400, 'non-integer since is rejected before the stream opens');
  });

  test('no duplicate soul.float_accepted across live + replay; a replayed Float request emits nothing (AC 11, motion contract)', async () => {
    if (cur.state === 'PLAYING') cur = (await drawUntilEnd(t, cur)).round;
    assert.equal(cur.state, 'WINNER');
    const am = await me(t, alice);
    assert.ok(am.soul?.floatToken);
    const before = t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', t.eventId).s;
    const live = await openStream(t.baseUrl, `/events/${t.eventId}/stream`);
    const f1 = await t.api.post('/me/soul/float', { soulId: am.soul.soulId, floatToken: am.soul.floatToken }, alice.token, nextKey('float'));
    assert.equal(f1.status, 200); assert.equal(f1.body.replay, false);
    await live.waitFor(ev => ev.some(e => e.event === 'soul.float_accepted'), 2000, 'live float');
    const f2 = await t.api.post('/me/soul/float', { soulId: am.soul.soulId, floatToken: am.soul.floatToken }, alice.token, nextKey('float'));
    assert.equal(f2.body.replay, true);
    await sleep(150);
    live.close(); await live.done;
    const liveFloats = live.events.filter(e => e.event === 'soul.float_accepted');
    assert.equal(liveFloats.length, 1, 'one live entrance');
    // resume from before the float: replay carries the same single event with the same sequence id (client dedups by id)
    const replay = await readSse(t.baseUrl, `/events/${t.eventId}/stream`, { since: before, until: ev => ev.some(e => e.event === 'soul.float_accepted'), timeoutMs: 1500 });
    const replayFloats = replay.events.filter(e => e.event === 'soul.float_accepted');
    assert.equal(replayFloats.length, 1); assert.equal(replayFloats[0].id, liveFloats[0].id); assert.deepEqual(replayFloats[0].data.payload.entrance, liveFloats[0].data.payload.entrance);
    const union = new Map([...live.events, ...replay.events].map(e => [e.id, e]));
    assert.equal([...union.values()].filter(e => e.event === 'soul.float_accepted').length, 1, 'dedup by sequence leaves exactly one entrance');
    assert.equal(t.db.get("SELECT COUNT(*) AS c FROM events_outbox WHERE event_id = ? AND type = 'soul.float_accepted'", t.eventId).c, 1);
    // the participant stream also sees exactly one, and the stream that was open for the whole round has no duplicate sequence ids
    const allIds = mine.events.map(e => e.id);
    assert.equal(new Set(allIds).size, allIds.length, 'no duplicate sequence on a long-lived participant stream');
    assert.equal(mine.events.filter(e => e.event === 'bingo.detected').length, 1); assert.equal(mine.events.filter(e => e.event === 'result.published').length, 1);
    pub.close(); mine.close(); await pub.done; await mine.done;
  });
});
