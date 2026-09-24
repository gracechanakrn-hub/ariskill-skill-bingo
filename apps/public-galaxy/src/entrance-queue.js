// Entrance queue for Float events (scene-spec 4, P-05). Pure ESM, Node-testable.
// At most `maxConcurrent` entrances animate at once; further entrances wait in FIFO order; when more than
// `maxQueued` are waiting, extra Souls settle instantly (scene-config#entrance.queueOverflow). Keyed by soulId:
// a second enqueue for the same Soul is ignored (dedup is also enforced upstream by the celebration guard).
export const PHASES = Object.freeze(['arc', 'pulse', 'settle', 'done']);

export function createEntranceQueue(opts = {}) {
  const maxConcurrent = opts.maxConcurrent ?? 6;
  const maxQueued = opts.maxQueued ?? 12;
  const arcMs = opts.arcMs ?? 2200, pulseMs = opts.pulseMs ?? 600, settleMs = opts.settleMs ?? 1200;
  const fadeMs = opts.fadeMs ?? 400;
  let reducedMotion = !!opts.reducedMotion;
  const active = new Map();   // soulId -> { startedAt }
  const waiting = [];         // [{ soulId, notBefore }]
  const known = new Set();
  const listeners = { start: [], finish: [] };

  function totalMs() { return reducedMotion ? fadeMs : arcMs + pulseMs + settleMs; }
  function emit(kind, id) { for (const fn of listeners[kind]) { try { fn(id); } catch { /* listener errors never break the loop */ } } }

  /** @returns 'active' | 'queued' | 'instant' | 'duplicate' */
  function enqueue(soulId, nowMs, notBefore = nowMs) {
    const id = String(soulId);
    if (known.has(id)) return 'duplicate';
    known.add(id);
    if (active.size < maxConcurrent && notBefore <= nowMs) { active.set(id, { startedAt: nowMs }); emit('start', id); return 'active'; }
    if (waiting.length >= maxQueued) return 'instant';
    waiting.push({ soulId: id, notBefore });
    return 'queued';
  }

  /** Advances the queue: finishes completed entrances and starts waiting ones. Returns { started, finished }. */
  function update(nowMs) {
    const finished = [], started = [];
    for (const [id, e] of active) {
      if (nowMs - e.startedAt >= totalMs()) { active.delete(id); finished.push(id); emit('finish', id); }
    }
    while (active.size < maxConcurrent && waiting.length) {
      const idx = waiting.findIndex(w => w.notBefore <= nowMs);
      if (idx < 0) break;
      const [w] = waiting.splice(idx, 1);
      active.set(w.soulId, { startedAt: nowMs }); started.push(w.soulId); emit('start', w.soulId);
    }
    return { started, finished };
  }

  /** Progress of an active entrance: { phase, t } with t in 0..1, or null when not animating. */
  function progress(soulId, nowMs) {
    const e = active.get(String(soulId));
    if (!e) return waiting.some(w => w.soulId === String(soulId)) ? { phase: 'waiting', t: 0 } : null;
    const el = Math.max(0, nowMs - e.startedAt);
    if (reducedMotion) return el >= fadeMs ? { phase: 'done', t: 1 } : { phase: 'fade', t: el / fadeMs };
    if (el < arcMs) return { phase: 'arc', t: el / arcMs };
    if (el < arcMs + pulseMs) return { phase: 'pulse', t: (el - arcMs) / pulseMs };
    if (el < arcMs + pulseMs + settleMs) return { phase: 'settle', t: (el - arcMs - pulseMs) / settleMs };
    return { phase: 'done', t: 1 };
  }

  return {
    enqueue, update, progress,
    activeIds: () => [...active.keys()],
    queuedIds: () => waiting.map(w => w.soulId),
    has: (id) => known.has(String(id)),
    get activeCount() { return active.size; },
    get queuedCount() { return waiting.length; },
    setReducedMotion(v) { reducedMotion = !!v; },
    onStart(fn) { listeners.start.push(fn); },
    onFinish(fn) { listeners.finish.push(fn); },
    totalMs,
  };
}
