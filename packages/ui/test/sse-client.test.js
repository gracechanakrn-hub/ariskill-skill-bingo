import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSseChunk, createSseClient } from '../sse-client.js';

test('parseSseChunk: id/event/data/retry lines, multi-line data, comments as heartbeats, partial frames kept', () => {
  const chunk = 'id: 41\nevent: draw.accepted\ndata: {"sequence":41,\ndata: "type":"draw.accepted"}\n\n: heartbeat\n\nretry: 3000\nid: 42\ndata:{"sequence":42}\n\nid: 43\ndata: {"seq';
  const { frames, rest } = parseSseChunk(chunk);
  assert.equal(frames.length, 3);
  assert.deepEqual(frames[0], { id: '41', event: 'draw.accepted', data: '{"sequence":41,\n"type":"draw.accepted"}', retry: null, comment: false });
  assert.deepEqual(frames[1], { id: null, event: 'message', data: null, retry: null, comment: true });
  assert.deepEqual(frames[2], { id: '42', event: 'message', data: '{"sequence":42}', retry: 3000, comment: false });
  assert.equal(rest, 'id: 43\ndata: {"seq');
  const more = parseSseChunk(rest + 'uence":43}\n\n');
  assert.equal(more.frames[0].data, '{"sequence":43}');
  assert.equal(more.rest, '');
});

test('parseSseChunk: CRLF and CR line endings, id with NUL ignored, invalid retry ignored, empty input', () => {
  const { frames } = parseSseChunk('id: 1\r\ndata: a\r\n\r\nid: x\0y\rdata: b\rretry: abc\r\r');
  assert.equal(frames.length, 2);
  assert.equal(frames[0].id, '1'); assert.equal(frames[0].data, 'a');
  assert.equal(frames[1].id, null); assert.equal(frames[1].retry, null);
  assert.deepEqual(parseSseChunk(''), { frames: [], rest: '' });
  assert.deepEqual(parseSseChunk(null), { frames: [], rest: '' });
});

// ---- fake SSE server ------------------------------------------------------------------------
function fakeServer() {
  const connections = [];
  const encoder = new TextEncoder();
  const fetch = async (url, init) => {
    const conn = { url, init, controller: null, closed: false };
    const stream = new ReadableStream({ start(c) { conn.controller = c; }, cancel() { conn.closed = true; } });
    if (init.signal) init.signal.addEventListener('abort', () => { if (!conn.closed) { conn.closed = true; try { conn.controller.error(new Error('aborted')); } catch { /* ignore */ } } });
    connections.push(conn);
    conn.send = (text) => conn.controller.enqueue(encoder.encode(text));
    conn.event = (seq, type = 'round.updated', payload = {}) => conn.send(`id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ eventId: 'evt_1', roundId: 'r1', sequence: seq, type, occurredAt: '2026-09-22T03:30:05.120Z', roundVersion: 1, payload })}\n\n`);
    conn.end = () => { if (!conn.closed) { conn.closed = true; conn.controller.close(); } };
    const status = fetch.nextStatus; fetch.nextStatus = 200;
    return new Response(status === 200 ? stream : null, { status, headers: { 'content-type': 'text/event-stream' } });
  };
  fetch.nextStatus = 200;
  return { fetch, connections, last: () => connections[connections.length - 1] };
}
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('connects with Authorization + Last-Event-ID + since, tracks sequence, ignores duplicates, replay flag from since', async () => {
  const srv = fakeServer();
  const events = []; const statuses = [];
  const sse = createSseClient({ url: '/api/v1/me/stream', getToken: () => 'tok', since: 10, fetch: srv.fetch, onEvent: (e, m) => events.push([e.sequence, m]), onStatus: (s, m) => statuses.push([s, m.connectionEpoch]) });
  sse.start();
  await tick();
  const conn = srv.last();
  assert.equal(conn.url, '/api/v1/me/stream?since=10');
  assert.equal(conn.init.headers.Authorization, 'Bearer tok');
  assert.equal(conn.init.headers['Last-Event-ID'], '10');
  assert.equal(sse.status, 'open'); assert.equal(sse.connectionEpoch, 1);
  conn.event(11); conn.event(11); conn.event(9); conn.event(12); conn.send(': ping\n\n');
  await tick();
  assert.deepEqual(events.map(([s]) => s), [11, 12]);
  assert.equal(events[0][1].replay, false); assert.equal(events[0][1].connectionEpoch, 1); assert.equal(events[0][1].type, 'round.updated'); assert.equal(events[0][1].gap, false);
  assert.equal(sse.lastSequence, 12);
  assert.deepEqual(statuses, [['connecting', 0], ['open', 1]]);
  sse.stop();
  assert.equal(sse.status, 'closed');
});

test('sequence gap -> onGap once, events flagged replay until acknowledgeSnapshot; system.snapshot_required -> onGap', async () => {
  const srv = fakeServer();
  const gaps = []; const events = [];
  const sse = createSseClient({ url: '/s', since: 5, fetch: srv.fetch, onEvent: (e, m) => events.push([e.sequence, m.replay, m.gap]), onGap: (g) => gaps.push(g) });
  sse.start(); await tick();
  const conn = srv.last();
  conn.event(6); conn.event(9); conn.event(10);
  await tick();
  assert.equal(gaps.length, 1); assert.equal(gaps[0].reason, 'sequence'); assert.equal(gaps[0].expected, 7); assert.equal(gaps[0].received, 9);
  assert.deepEqual(events, [[6, false, false], [9, true, true], [10, true, false]]);
  sse.acknowledgeSnapshot(10);
  conn.event(11); await tick();
  assert.deepEqual(events[3], [11, false, false]);
  conn.event(12, 'system.snapshot_required', { reason: 'outbox-trimmed' }); await tick();
  assert.equal(gaps[1].reason, 'snapshot_required');
  conn.event(13); await tick();
  assert.equal(events[5][1], true, 'replay until the snapshot is acknowledged');
  sse.acknowledgeSnapshot(13);
  assert.equal(sse.lastSequence, 13);
  sse.stop();
});

test('reconnects with backoff after the stream ends, increments connectionEpoch, resumes from last sequence, marks replay', async () => {
  const srv = fakeServer();
  const statuses = []; const events = []; const delays = [];
  const sse = createSseClient({ url: '/s?audience=public', since: 0, fetch: srv.fetch, onEvent: (e, m) => events.push([e.sequence, m.replay, m.connectionEpoch]), onStatus: (s, m) => statuses.push([s, m.connectionEpoch, m.resumedFrom]),
    setTimeoutFn: (fn, ms) => { delays.push(ms); return setTimeout(fn, 1); }, minBackoffMs: 500, maxBackoffMs: 10_000, random: () => 0.5 });
  sse.start(); await tick();
  srv.last().event(1); await tick();
  srv.last().end(); await tick(20);
  assert.equal(srv.connections.length, 2);
  assert.equal(srv.last().url, '/s?audience=public&since=1');
  assert.equal(srv.last().init.headers['Last-Event-ID'], '1');
  assert.equal(sse.connectionEpoch, 2); assert.equal(sse.status, 'open');
  assert.deepEqual(statuses.map((s) => s[0]), ['connecting', 'open', 'reconnecting', 'open']);
  assert.equal(statuses[3][2], 1, 'resumedFrom');
  assert.equal(delays[delays.length - 1], 500, 'first reconnect delay = min backoff (jitter 0.5 -> x1)');
  srv.last().event(2); await tick();
  assert.deepEqual(events[1], [2, true, 2], 'events after a reconnect are replay until the snapshot is acknowledged');
  sse.acknowledgeSnapshot(2);
  srv.last().event(3); await tick();
  assert.deepEqual(events[2], [3, false, 2]);
  sse.stop();
});

test('exponential backoff is capped at 10 s and honours the server retry hint', async () => {
  const srv = fakeServer();
  const delays = [];
  let failing = true;
  const fetch = async (url, init) => { if (failing) throw new TypeError('offline'); return srv.fetch(url, init); };
  const sse = createSseClient({ url: '/s', fetch, setTimeoutFn: (fn, ms) => { delays.push(ms); return setTimeout(fn, 0); }, random: () => 0.5, minBackoffMs: 500, maxBackoffMs: 10_000 });
  sse.start();
  await tick(60);
  assert.ok(delays.length >= 6, `attempts: ${delays.length}`);
  assert.deepEqual(delays.slice(0, 6), [500, 1000, 2000, 4000, 8000, 10000]);
  assert.equal(sse.status, 'reconnecting');
  failing = false;
  await tick(20);
  assert.equal(sse.status, 'open');
  srv.last().send('retry: 3000\n\n'); await tick();
  srv.last().end(); await tick(10);
  assert.equal(delays[delays.length - 1], 3000);
  sse.stop();
});

test('45 s silence (here 30 ms) triggers a reconnect; heartbeats keep the connection alive', async () => {
  const srv = fakeServer();
  const statuses = [];
  const sse = createSseClient({ url: '/s', fetch: srv.fetch, silenceMs: 30, minBackoffMs: 1, maxBackoffMs: 2, onStatus: (s) => statuses.push(s) });
  sse.start(); await tick();
  for (let i = 0; i < 4; i++) { srv.last().send(': hb\n\n'); await tick(12); }
  assert.equal(srv.connections.length, 1, 'heartbeats reset the silence timer');
  await tick(60);
  assert.ok(srv.connections.length >= 2, 'silence caused a reconnect');
  assert.ok(statuses.includes('reconnecting'));
  assert.equal(sse.status, 'open');
  sse.stop();
});

test('401/403/404 close the client instead of retrying; stop() aborts the fetch', async () => {
  const srv = fakeServer();
  srv.fetch.nextStatus = 401;
  const statuses = [];
  const sse = createSseClient({ url: '/s', fetch: srv.fetch, onStatus: (s, m) => statuses.push([s, m.error && m.error.status]) });
  sse.start(); await tick();
  assert.equal(sse.status, 'closed'); assert.equal(sse.isRunning, false); assert.equal(sse.stoppedReason.status, 401);
  assert.deepEqual(statuses[statuses.length - 1], ['closed', 401]);
  const srv2 = fakeServer();
  const sse2 = createSseClient({ url: '/s', fetch: srv2.fetch });
  sse2.start(); await tick();
  sse2.stop(); await tick();
  assert.equal(srv2.last().closed, true);
});

test('id-only skip marker advances the sequence without an event, a gap or a replay window (realtime-events skipMarker)', async () => {
  const srv = fakeServer();
  const gaps = []; const events = [];
  const sse = createSseClient({ url: '/s', since: 5, fetch: srv.fetch, onEvent: (e, m) => events.push([e.sequence, m.replay, m.gap]), onGap: (g) => gaps.push(g) });
  sse.start(); await tick();
  const conn = srv.last();
  conn.event(6); conn.send('id: 7\n\n'); conn.send('id: 8\n\n'); conn.event(9);
  await tick();
  assert.deepEqual(events, [[6, false, false], [9, false, false]], 'skipped ids dispatch nothing and 9 stays live');
  assert.equal(gaps.length, 0, 'no false gap');
  assert.equal(sse.lastSequence, 9);
  conn.send('id: 3\n\n'); await tick();
  assert.equal(sse.lastSequence, 9, 'stale marker ignored');
  conn.send('id: 12\n\n'); conn.event(14); await tick();
  assert.equal(gaps.length, 1, 'a real hole after a marker is still a gap');
  assert.equal(gaps[0].expected, 13); assert.equal(gaps[0].received, 14);
  sse.stop();
});
