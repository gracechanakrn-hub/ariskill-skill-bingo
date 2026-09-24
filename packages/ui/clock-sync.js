// @ariskill/ui clock-sync.js - server clock offset estimation for countdown DISPLAY only.
// Rule (requirement 15.4, docs/ux/canonical-flow.md): clients never infer lock/start from local time;
// they only display countdowns. Lock/start are signalled by server events (round.locked, round.started).
// Target: countdown drift <= 250 ms between healthy clients after correction.

const DEFAULT_SAMPLES = 3;
const DEFAULT_DRIFT_THRESHOLD_MS = 250;

function monotonicNow() {
  const p = globalThis.performance;
  return p && typeof p.now === 'function' ? p.now() : Date.now();
}

/** medianOffset([{offsetMs, rttMs}...]) -> median offset (ms). Even counts average the two middle values. */
export function medianOffset(samples) {
  const xs = samples.map((s) => (typeof s === 'number' ? s : s.offsetMs)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * createClockSync({ fetchTime, samples, driftThresholdMs, wallNow, monoNow, onChange })
 *  fetchTime()   async -> { serverTime: ISO, epochMs: int }   (e.g. () => api.get('/time'))
 * Returns:
 *  sync() / resync()  -> Promise<{ offsetMs, rttMs, synced, samples }>
 *  now()              -> corrected epoch ms (falls back to Date.now() until synced)
 *  offsetMs           -> current server - local offset
 *  isSynced           -> boolean
 *  observe(sample)    -> feed a passive sample ({ serverTime|serverEpochMs, sentAt, receivedAt } in wall ms);
 *                        used by api-client; triggers a debounced resync when drift > threshold
 *  subscribe(fn)      -> fn({ synced, offsetMs, rttMs }) on change; returns unsubscribe
 *  startAutoResync(intervalMs = 60000) / stop()
 */
export function createClockSync({
  fetchTime,
  samples = DEFAULT_SAMPLES,
  driftThresholdMs = DEFAULT_DRIFT_THRESHOLD_MS,
  wallNow = () => Date.now(),
  monoNow = monotonicNow,
  onChange = null,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  let offsetMs = 0;          // server - local(wall) at anchor time
  let anchorServerMs = null; // server epoch at anchor
  let anchorMonoMs = null;   // monotonic clock at anchor
  let rttMs = null;
  let synced = false;
  let syncing = null;
  let timer = null;
  let resyncPending = null;
  const listeners = new Set();
  if (typeof onChange === 'function') listeners.add(onChange);

  function emit() {
    const status = { synced, offsetMs, rttMs };
    for (const fn of Array.from(listeners)) { try { fn(status); } catch { /* ignore */ } }
  }

  function setAnchor(newOffset, rtt) {
    // Drift correction: if the correction is tiny (inside jitter) keep the old anchor to avoid
    // countdown flicker; otherwise re-anchor to the new estimate.
    const delta = Math.abs(newOffset - offsetMs);
    if (!synced || delta > 30) offsetMs = newOffset;
    const wall = wallNow();
    anchorServerMs = wall + offsetMs;
    anchorMonoMs = monoNow();
    rttMs = rtt;
    synced = true;
    emit();
  }

  async function takeSample() {
    const sentWall = wallNow(); const sentMono = monoNow();
    const res = await fetchTime();
    const recvWall = wallNow(); const rtt = Math.max(0, monoNow() - sentMono);
    const serverMs = serverEpochFrom(res);
    if (!Number.isFinite(serverMs)) throw new Error('clock-sync: fetchTime returned no server time');
    // Server timestamp is taken mid-flight: offset = server + rtt/2 - receivedAt
    return { offsetMs: serverMs + rtt / 2 - recvWall, rttMs: rtt, sentWall };
  }

  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      const taken = [];
      let lastErr = null;
      for (let i = 0; i < samples; i++) {
        try { taken.push(await takeSample()); } catch (err) { lastErr = err; }
        if (i < samples - 1) await sleep(40 + i * 40);
      }
      if (!taken.length) { syncing = null; emit(); throw lastErr || new Error('clock-sync: no samples'); }
      // Prefer low-RTT samples: take the median of the best half (at least 1).
      const best = taken.slice().sort((a, b) => a.rttMs - b.rttMs).slice(0, Math.max(1, Math.ceil(taken.length / 2)));
      const off = medianOffset(best);
      const rtt = medianOffset(best.map((s) => s.rttMs));
      setAnchor(off, rtt);
      syncing = null;
      return { offsetMs, rttMs, synced, samples: taken };
    })();
    return syncing;
  }

  function now() {
    if (!synced || anchorServerMs === null) return wallNow() + offsetMs;
    return anchorServerMs + (monoNow() - anchorMonoMs);
  }

  function observe(sample) {
    if (!sample) return;
    const serverMs = serverEpochFrom(sample);
    if (!Number.isFinite(serverMs)) return;
    const received = Number.isFinite(sample.receivedAt) ? sample.receivedAt : wallNow();
    const sent = Number.isFinite(sample.sentAt) ? sample.sentAt : received;
    const rtt = Math.max(0, received - sent);
    if (rtt > 2000) return; // too noisy to use
    const passiveOffset = serverMs + rtt / 2 - received;
    if (!synced) { setAnchor(passiveOffset, rtt); return; }
    const observed = now() - received; // what our corrected clock says the offset is right now
    if (Math.abs(passiveOffset - observed) > driftThresholdMs && !resyncPending) {
      resyncPending = Promise.resolve().then(() => sync()).catch(() => {}).finally(() => { resyncPending = null; });
    }
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function startAutoResync(intervalMs = 60_000) {
    stop();
    timer = setInterval(() => { sync().catch(() => {}); }, intervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return {
    sync, resync: sync, now, observe, subscribe, startAutoResync, stop,
    get offsetMs() { return offsetMs; },
    get rttMs() { return rttMs; },
    get isSynced() { return synced; },
  };
}

function serverEpochFrom(res) {
  if (!res) return NaN;
  if (Number.isFinite(res.epochMs)) return res.epochMs;
  if (Number.isFinite(res.serverEpochMs)) return res.serverEpochMs;
  const iso = res.serverTime || res.serverTimeIso;
  return iso ? Date.parse(iso) : NaN;
}

/**
 * formatCountdown(targetIso, nowMs) -> 'mm:ss' (tabular numerals via .countdown class).
 * Never negative: returns '00:00' at or after the target or for invalid input. Seconds are rounded UP
 * so the display reaches 00:00 exactly when the target time passes (never shows 00:00 early).
 */
export function formatCountdown(targetIso, nowMs = Date.now()) {
  const t = typeof targetIso === 'number' ? targetIso : targetIso instanceof Date ? targetIso.getTime() : Date.parse(targetIso);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return '00:00';
  const remaining = Math.max(0, t - nowMs);
  const total = Math.ceil(remaining / 1000);
  const mm = Math.floor(total / 60), ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** remainingMs(targetIso, nowMs) -> clamped >= 0 milliseconds (for progress bars). */
export function remainingMs(targetIso, nowMs = Date.now()) {
  const t = typeof targetIso === 'number' ? targetIso : Date.parse(targetIso);
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : 0;
}
