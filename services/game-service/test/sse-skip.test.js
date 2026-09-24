// Filtered streams stay contiguous: rows an audience must not see are delivered as id-only skip markers
// (contracts/realtime-events.json transport.skipMarker), never as silent sequence holes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, createRound, join, readyBoard, boardSet, EVENT_ID } from './helpers.js';

/** Raw SSE read: returns every frame as { id, hasData } in arrival order. */
async function readRaw(baseUrl, path, { token = null, since = null, timeoutMs = 700 } = {}) {
  const headers = { Accept: 'text/event-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const ac = new AbortController();
  const res = await fetch(`${baseUrl}/api/v1${path}${since !== null ? `?since=${since}` : ''}`, { headers, signal: ac.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; const frames = [];
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        if (block.startsWith(':')) continue;
        const id = block.match(/^id: (\d+)$/m); const hasData = /^data: /m.test(block);
        frames.push({ id: id ? Number(id[1]) : null, hasData });
      }
    }
  } catch { /* aborted */ } finally { clearTimeout(timer); }
  return frames;
}

function assertContiguous(frames) {
  const ids = frames.map(f => f.id).filter(n => n !== null);
  for (let i = 1; i < ids.length; i++) assert.equal(ids[i], ids[i - 1] + 1, `sequence hole between ${ids[i - 1]} and ${ids[i]}`);
  return ids;
}

test('participant stream: another player\'s private rows arrive as skip markers, ids contiguous, live and on resume', async () => {
  const t = await startServer();
  try {
    const round = await createRound(t);
    const a = await join(t, { displayName: 'A' });
    const b = await join(t, { displayName: 'B' });
    const start = t.db.get('SELECT COALESCE(MAX(sequence),0) AS s FROM events_outbox WHERE event_id = ?', EVENT_ID).s;
    const live = readRaw(t.baseUrl, '/me/stream', { token: a.token, timeoutMs: 900 });
    await new Promise(r => setTimeout(r, 60));
    await readyBoard(t, b, boardSet(0));       // board rows scoped to B: invisible to A
    await readyBoard(t, a, boardSet(5));       // scoped to A: visible
    const frames = await live;
    const ids = assertContiguous(frames);
    assert.ok(ids.length >= 2, 'stream delivered frames');
    assert.ok(frames.some(f => !f.hasData && f.id !== null), 'at least one id-only skip marker for B\'s rows');
    assert.ok(frames.some(f => f.hasData), 'A still receives its own events');
    const latest = t.db.get('SELECT MAX(sequence) AS s FROM events_outbox WHERE event_id = ?', EVENT_ID).s;
    assert.equal(ids[ids.length - 1], latest, 'stream reached the latest outbox sequence');

    // Resume from before the private rows: replay path uses the same skip markers.
    const replay = await readRaw(t.baseUrl, '/me/stream', { token: a.token, since: start, timeoutMs: 400 });
    const rids = assertContiguous(replay);
    assert.equal(rids[0], start + 1);
    assert.equal(rids[rids.length - 1], latest);
    assert.ok(replay.some(f => !f.hasData && f.id !== null), 'replay contains skip markers');

    // Public stream never sees participant-private rows either, and stays contiguous too.
    const pub = await readRaw(t.baseUrl, `/events/${EVENT_ID}/stream`, { since: start, timeoutMs: 400 });
    assertContiguous(pub);
    assert.ok(pub.every(f => f.id !== null));
    assert.equal(round.state, 'REGISTRATION_OPEN');
  } finally { await t.close(); }
});
