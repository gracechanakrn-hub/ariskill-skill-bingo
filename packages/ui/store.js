// @ariskill/ui store.js - tiny observable store + snapshot/event helpers.
// Rules (contracts/realtime-events.json clientRules):
//   - track the last applied sequence; ignore sequence <= last
//   - a snapshot always wins over locally applied events (final state wins)
// Works in browsers and in Node (no DOM use).

/**
 * createStore(initial) -> { get, set, subscribe }
 *  get()             current state object (treat as immutable)
 *  set(patch | fn)   shallow-merge a patch, or replace with fn(prev)
 *  subscribe(fn)     fn(next, prev) on every change; returns unsubscribe
 */
export function createStore(initial = {}) {
  let state = { ...initial };
  const listeners = new Set();
  function get() { return state; }
  function set(update) {
    const prev = state;
    const next = typeof update === 'function' ? update(prev) : { ...prev, ...update };
    if (next === prev) return prev;
    state = next;
    for (const fn of Array.from(listeners)) {
      try { fn(state, prev); } catch (err) { reportListenerError(err); }
    }
    return state;
  }
  function subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }
  return { get, set, subscribe };
}

function reportListenerError(err) {
  if (typeof console !== 'undefined' && console.error) console.error('[store] listener failed', err);
}

/**
 * applySnapshot(store, snapshot) - the snapshot is authoritative.
 * Merges every field of the snapshot into the state and sets
 * `sequence` (last applied) and `snapshotSequence`. Never rejected, even if a
 * higher sequence was applied locally: the server commits before it emits, so
 * a snapshot fetched after a gap is at least as new as the events it covers.
 */
export function applySnapshot(store, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return store.get();
  const seq = toSequence(snapshot.sequence);
  return store.set((prev) => ({
    ...prev,
    ...snapshot,
    sequence: seq === null ? (prev.sequence ?? -1) : seq,
    snapshotSequence: seq === null ? (prev.snapshotSequence ?? null) : seq,
    snapshotAt: Date.now(),
  }));
}

/**
 * applyEvent(store, envelope, reducer) -> { applied: boolean, reason?, state }
 * reducer(state, envelope) returns the next state (may return the same object
 * to signal "no change"). Events at or below the current sequence are ignored.
 */
export function applyEvent(store, envelope, reducer) {
  const state = store.get();
  const seq = toSequence(envelope && envelope.sequence);
  const last = toSequence(state.sequence) ?? -1;
  if (seq === null) return { applied: false, reason: 'no-sequence', state };
  if (seq <= last) return { applied: false, reason: 'stale', state };
  const reduced = typeof reducer === 'function' ? reducer(state, envelope) : state;
  const next = store.set({ ...(reduced || state), sequence: seq, lastEventType: envelope.type, lastEventAt: envelope.occurredAt || null });
  return { applied: true, state: next };
}

/** select(store, selector, fn) - subscribe to a derived value; fires only when it changes (Object.is). */
export function select(store, selector, fn) {
  let current = selector(store.get());
  fn(current, undefined);
  return store.subscribe((next) => {
    const value = selector(next);
    if (!Object.is(value, current)) { const prev = current; current = value; fn(value, prev); }
  });
}

function toSequence(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
