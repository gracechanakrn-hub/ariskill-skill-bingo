// @ariskill/ui sse-client.js - Server-Sent Events over fetch + ReadableStream.
// EventSource cannot send Authorization headers, so this client reads the stream with fetch.
// Contract: contracts/realtime-events.json (id/event/data frames, comment heartbeats every 15 s,
// 45 s silence => disconnected (E12) and reconnect, resume with Last-Event-ID / ?since=, monotonic sequence).
//
// createSseClient({ url, getToken, onEvent, onGap, onStatus, since }) -> client
//   client.start() / client.stop()
//   client.status            'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'
//   client.connectionEpoch   increments on every successful (re)connect (1 = first connection)
//   client.lastSequence      last applied sequence (-1 when unknown)
//   client.acknowledgeSnapshot(sequence)  after applying a snapshot: sets the cursor and marks
//                            everything with sequence <= snapshot.sequence as replay (no celebration)
//   onEvent(envelope, meta)  meta = { id, type, connectionEpoch, replay, gap }
//   onGap({ reason: 'sequence' | 'snapshot_required', expected, received, envelope })
//   onStatus(status, { connectionEpoch, attempt, error, resumedFrom })

const DEFAULTS = { silenceMs: 45_000, minBackoffMs: 500, maxBackoffMs: 10_000 };

/**
 * parseSseChunk(buffer) -> { frames, rest }
 * Pure parser for the text/event-stream format. `buffer` is the accumulated text; complete frames
 * (terminated by a blank line) are returned and `rest` is the unterminated remainder to keep.
 * frame = { id: string|null, event: string, data: string|null, retry: number|null, comment: boolean }
 * A frame with only comment lines (heartbeat) has comment=true and data=null.
 */
export function parseSseChunk(buffer) {
  const frames = [];
  let text = String(buffer ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let idx;
  while ((idx = text.indexOf('\n\n')) !== -1) {
    const block = text.slice(0, idx);
    text = text.slice(idx + 2);
    const frame = parseFrame(block);
    if (frame) frames.push(frame);
  }
  return { frames, rest: text };
}

function parseFrame(block) {
  const lines = block.split('\n');
  let id = null, event = null, retry = null, comment = false; const data = [];
  let sawField = false;
  for (const line of lines) {
    if (line === '') continue;
    if (line.startsWith(':')) { comment = true; continue; }
    sawField = true;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') { if (!value.includes('\0')) id = value; }
    else if (field === 'retry') { const n = Number(value); if (/^\d+$/.test(value) && Number.isFinite(n)) retry = n; }
  }
  if (!sawField && !comment) return null;
  return { id, event: event || 'message', data: data.length ? data.join('\n') : null, retry, comment: !sawField && comment };
}

function toSeq(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

export function createSseClient({
  url,
  getToken = null,
  onEvent = () => {},
  onGap = () => {},
  onStatus = () => {},
  since = null,
  fetch: fetchImpl = null,
  silenceMs = DEFAULTS.silenceMs,
  minBackoffMs = DEFAULTS.minBackoffMs,
  maxBackoffMs = DEFAULTS.maxBackoffMs,
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms), // reconnect-backoff scheduler only (injectable for tests)
  clearTimeoutFn = (t) => clearTimeout(t),
  random = Math.random,
} = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  let status = 'idle';
  let connectionEpoch = 0;
  let lastSequence = toSeq(since) ?? -1;
  let liveFromSequence = toSeq(since); // events with sequence <= liveFrom are replay; null = unknown (all replay)
  let attempt = 0;
  let controller = null;
  let silenceTimer = null;
  let reconnectTimer = null;
  let running = false;
  let serverRetryMs = null;
  let gapPending = false;
  let stoppedReason = null;

  function setStatus(next, extra = {}) {
    if (status === next && !extra.force) return;
    status = next;
    try { onStatus(next, { connectionEpoch, attempt, ...extra }); } catch (err) { report(err); }
  }

  function armSilence() {
    disarmSilence();
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (!running) return;
      // 45 s without any bytes: treat as disconnected (E12) and reconnect
      if (controller) controller.abort(new Error('silence'));
    }, silenceMs);
    if (silenceTimer && typeof silenceTimer.unref === 'function') silenceTimer.unref();
  }
  function disarmSilence() { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } }

  function resumeUrl() {
    if (lastSequence < 0) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}since=${encodeURIComponent(String(lastSequence))}`;
  }

  async function connect() {
    if (!running) return;
    const resumedFrom = lastSequence >= 0 ? lastSequence : null;
    setStatus(attempt === 0 && connectionEpoch === 0 ? 'connecting' : 'reconnecting', { resumedFrom }); // no-op when already emitted by scheduleReconnect
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    const headers = { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' };
    if (resumedFrom !== null) headers['Last-Event-ID'] = String(resumedFrom);
    try {
      const token = typeof getToken === 'function' ? await getToken() : null;
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch (err) { report(err); }
    let res;
    try {
      res = await doFetch(resumeUrl(), { method: 'GET', headers, signal: controller ? controller.signal : undefined, credentials: 'same-origin', cache: 'no-store' });
    } catch (err) {
      return scheduleReconnect(err);
    }
    if (!running) return;
    if (!res.ok || !res.body) {
      const err = new Error(`SSE HTTP ${res.status}`); err.status = res.status;
      if (res.status === 401 || res.status === 403 || res.status === 404) { stoppedReason = err; running = false; setStatus('closed', { error: err }); return; }
      return scheduleReconnect(err);
    }
    // Established
    connectionEpoch++;
    attempt = 0;
    // On a resumed connection everything is replay until the app acknowledges a fresh snapshot,
    // except the initial connection where `since` (from the app's first snapshot) defines liveness.
    if (connectionEpoch > 1) liveFromSequence = null;
    setStatus('open', { resumedFrom, force: true });
    armSilence();
    let buffer = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!running) break;
        armSilence();
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = parseSseChunk(buffer);
        buffer = rest;
        for (const frame of frames) handleFrame(frame);
      }
    } catch (err) {
      if (!running) return;
      return scheduleReconnect(err);
    } finally {
      disarmSilence();
    }
    if (running) scheduleReconnect(new Error('stream ended'));
  }

  function handleFrame(frame) {
    if (frame.retry !== null) serverRetryMs = Math.min(maxBackoffMs, Math.max(minBackoffMs, frame.retry));
    if (frame.comment) return; // heartbeat: silence timer already reset
    if (frame.data === null) {
      // Skip marker (id-only frame): the server withheld a row this audience must not see. Advance the sequence so the
      // filtered stream stays contiguous - no event, no gap, no replay window (realtime-events transport.skipMarker).
      const skipped = toSeq(frame.id);
      if (skipped !== null && skipped > lastSequence) lastSequence = skipped;
      return;
    }
    let envelope;
    try { envelope = JSON.parse(frame.data); } catch (err) { report(new Error('SSE: non-JSON data frame')); return; }
    const type = envelope && envelope.type ? envelope.type : frame.event;
    const seq = toSeq(envelope && envelope.sequence) ?? toSeq(frame.id);
    if (seq !== null && seq <= lastSequence) return; // duplicate / already applied
    let gap = false;
    if (type === 'system.snapshot_required') {
      gapPending = true;
      safe(() => onGap({ reason: 'snapshot_required', expected: lastSequence + 1, received: seq, envelope }));
    } else if (seq !== null && lastSequence >= 0 && seq > lastSequence + 1) {
      gap = true;
      if (!gapPending) { gapPending = true; safe(() => onGap({ reason: 'sequence', expected: lastSequence + 1, received: seq, envelope })); }
    }
    if (seq !== null) lastSequence = seq;
    const replay = liveFromSequence === null || gapPending || (seq !== null && seq <= liveFromSequence);
    safe(() => onEvent(envelope, { id: frame.id, type, connectionEpoch, replay, gap }));
  }

  function scheduleReconnect(err) {
    if (!running) return;
    disarmSilence();
    controller = null;
    attempt++;
    const base = serverRetryMs ?? minBackoffMs;
    const delay = Math.min(maxBackoffMs, base * 2 ** (attempt - 1)) * (0.75 + random() * 0.5);
    setStatus('reconnecting', { error: err, resumedFrom: lastSequence >= 0 ? lastSequence : null, force: true });
    reconnectTimer = setTimeoutFn(() => { reconnectTimer = null; connect(); }, Math.round(delay));
    if (reconnectTimer && typeof reconnectTimer.unref === 'function') reconnectTimer.unref();
  }

  function start() {
    if (running) return client;
    running = true; stoppedReason = null;
    connect();
    return client;
  }
  function stop() {
    running = false;
    disarmSilence();
    if (reconnectTimer) { clearTimeoutFn(reconnectTimer); reconnectTimer = null; }
    if (controller) { try { controller.abort(new Error('stopped')); } catch { /* ignore */ } controller = null; }
    setStatus('closed', { force: true });
    return client;
  }
  function acknowledgeSnapshot(sequence) {
    const seq = toSeq(sequence);
    if (seq === null) return;
    if (seq > lastSequence) lastSequence = seq;
    liveFromSequence = seq;
    gapPending = false;
  }
  /** Force an immediate reconnect (e.g. after the app regains network / visibility). */
  function reconnectNow() {
    if (!running) return;
    if (reconnectTimer) { clearTimeoutFn(reconnectTimer); reconnectTimer = null; attempt = Math.max(0, attempt - 1); connect(); return; }
    if (controller) controller.abort(new Error('reconnectNow'));
  }

  const client = {
    start, stop, acknowledgeSnapshot, reconnectNow,
    get status() { return status; },
    get connectionEpoch() { return connectionEpoch; },
    get lastSequence() { return lastSequence; },
    get liveFromSequence() { return liveFromSequence; },
    get isRunning() { return running; },
    get stoppedReason() { return stoppedReason; },
  };
  return client;
}

function safe(fn) { try { fn(); } catch (err) { report(err); } }
function report(err) { if (typeof console !== 'undefined' && console.error) console.error('[sse-client]', err); }
