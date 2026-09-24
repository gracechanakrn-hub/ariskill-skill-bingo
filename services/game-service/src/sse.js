// Server-Sent Events hub (contracts/realtime-events.json). Subscribers are keyed by audience + eventId (+ participantId).
// Replay from the outbox is bounded to the last `sseReplayLimit` sequences; older resume points get system.snapshot_required.
export function createHub({ db, config, clock, projections, log }) {
  const subs = new Set();
  let nextId = 1;
  let heartbeat = null;

  function counts() {
    const c = { public: 0, stage: 0, participants: 0, admin: 0 };
    for (const s of subs) { if (s.audience === 'participant') c.participants += 1; else c[s.audience] += 1; }
    return c;
  }
  function frame(env) { return `id: ${env.sequence}\nevent: ${env.type}\ndata: ${JSON.stringify(env)}\n\n`; }
  // Skip marker: an id-only frame for an outbox row this audience/participant must not see. Per the SSE spec a block
  // without `data` dispatches nothing but still advances Last-Event-ID, so filtered streams stay contiguous and a
  // client never mistakes redaction for a lost event (contracts/realtime-events.json transport.skipMarker).
  function skipFrame(sequence) { return `id: ${sequence}\n\n`; }
  function write(sub, text) { try { sub.res.write(text); } catch (e) { log?.warn('sse write failed', { error: e.message }); remove(sub); } }
  function send(sub, env) { if (!env) return; write(sub, frame(env)); }
  /** Deliver one outbox row: the projected envelope when visible to this subscriber, else a skip marker. */
  function deliver(sub, row) {
    const env = projections.projectEvent(sub.audience, row, { participantId: sub.participantId });
    write(sub, env ? frame(env) : skipFrame(row.sequence));
  }
  function remove(sub) { if (subs.delete(sub)) { try { sub.res.end(); } catch { /* ignore */ } } }

  function subscribe(req, res, { audience, eventId, participantId = null, since = null }) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`: connected ${clock.iso()}\n\n`);
    const sub = { id: nextId++, audience, eventId, participantId, res };
    // Replay (resume) before registering so that ordering is preserved.
    if (since !== null) {
      const latest = db.get('SELECT COALESCE(MAX(sequence), 0) AS s FROM events_outbox WHERE event_id = ?', eventId).s;
      if (since > latest) send(sub, projections.snapshotRequired(audience, eventId, 'sequence-ahead'));
      else if (latest - since > config.sseReplayLimit) send(sub, projections.snapshotRequired(audience, eventId, 'replay-window-exceeded'));
      else if (since < latest) {
        const rows = db.all('SELECT * FROM events_outbox WHERE event_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?', eventId, since, config.sseReplayLimit);
        for (const row of rows) deliver(sub, row);
      }
    }
    subs.add(sub);
    const bye = () => remove(sub);
    req.on('close', bye); req.on('error', bye); res.on('error', bye);
    if (!heartbeat) { heartbeat = setInterval(() => { for (const s of subs) { try { s.res.write(`: ping ${clock.iso()}\n\n`); } catch { remove(s); } } }, config.sseHeartbeatMs); heartbeat.unref?.(); }
    return sub;
  }
  /** Fan out committed outbox rows to every matching subscriber, projecting per audience. */
  function publish(rows) {
    for (const row of rows) for (const sub of [...subs]) {
      if (sub.eventId !== row.event_id) continue;
      deliver(sub, row);
    }
  }
  function close() { if (heartbeat) clearInterval(heartbeat); heartbeat = null; for (const s of [...subs]) remove(s); }
  return { subscribe, publish, counts, close, size: () => subs.size };
}
