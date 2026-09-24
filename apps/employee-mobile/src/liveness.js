// apps/employee-mobile/src/liveness.js - pure liveness decision for participant stream events (node-testable).
//
// The game service numbers events across every audience, so a participant stream legitimately skips sequence
// numbers on almost every draw (observed: 1416 -> 1419 -> 1422 ... draw.accepted; other audiences' events sit in
// between). The shared sse-client (packages/ui, wave-1, consumed as-is) treats each skip as a gap: it flags the event
// and everything until the next snapshot acknowledgement as `replay: true`, and the celebration guard then silences
// every live celebration on the phone (draw arrival, match pulse, line trace, winner burst, float launch, cues).
//
// This helper keeps the safety half of that contract (the app still refetches /me on every gap) and restores the
// other half: a gap event is live when it arrived on the current connection epoch that has already acknowledged a
// snapshot (or the first connection), and is newer than the applied snapshot. Backlog after a reconnect stays
// silent until the fresh snapshot is acknowledged; the guard still dedupes keys and rejects snapshot-covered events.

/**
 * @param {{ replay?: boolean, gap?: boolean, connectionEpoch?: number, sequence?: number }} meta  sse-client meta
 * @param {{ currentEpoch: number, ackedEpoch: number, gapPending: boolean, snapshotSequence?: number }} ctx
 * @returns {{ live: boolean, sparse: boolean }} live = meta.replay should be treated as false; sparse = the reason
 */
export function sparseStreamLiveness(meta = {}, ctx = {}) {
  const { replay = false, gap = false, connectionEpoch, sequence } = meta;
  const { currentEpoch = 0, ackedEpoch = 0, gapPending = false, snapshotSequence = -Infinity } = ctx;
  if (replay !== true) return { live: true, sparse: false };
  if (!gap && !gapPending) return { live: false, sparse: false };          // a plain resume replay
  if (connectionEpoch === undefined || connectionEpoch !== currentEpoch) return { live: false, sparse: false };
  if (connectionEpoch !== 1 && ackedEpoch !== connectionEpoch) return { live: false, sparse: false }; // reconnect backlog
  if (Number.isFinite(sequence) && Number.isFinite(snapshotSequence) && sequence <= snapshotSequence) return { live: false, sparse: false };
  return { live: true, sparse: true };
}

/** Tracks the sparse-gap window between a gap and the next snapshot acknowledgement. Pure state machine. */
export function createGapTracker() {
  let pending = false;
  let acked = 0;
  return {
    onGap() { pending = true; },
    onAcknowledged(epoch) { pending = false; acked = epoch; },
    get gapPending() { return pending; },
    get ackedEpoch() { return acked; },
  };
}
