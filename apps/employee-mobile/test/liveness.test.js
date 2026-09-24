// node --test apps/employee-mobile/test - sparse participant stream liveness (src/liveness.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { sparseStreamLiveness, createGapTracker } from '../src/liveness.js';

const ctx = (over = {}) => ({ currentEpoch: 1, ackedEpoch: 1, gapPending: false, snapshotSequence: 1401, ...over });

test('a non-replay event is live and not sparse', () => {
  assert.deepEqual(sparseStreamLiveness({ replay: false, gap: false, connectionEpoch: 1, sequence: 1402 }, ctx()), { live: true, sparse: false });
});

test('a sparse-stream gap on the first connection is live (draw 1416 -> 1419)', () => {
  assert.deepEqual(sparseStreamLiveness({ replay: true, gap: true, connectionEpoch: 1, sequence: 1419 }, ctx()), { live: true, sparse: true });
  // contiguous follow-ups inside the pending window (bingo.detected 1460 -> result.published 1461) are live too
  assert.deepEqual(sparseStreamLiveness({ replay: true, gap: false, connectionEpoch: 1, sequence: 1461 }, ctx({ gapPending: true })), { live: true, sparse: true });
});

test('a plain resume replay (no gap, nothing pending) stays silent', () => {
  assert.equal(sparseStreamLiveness({ replay: true, gap: false, connectionEpoch: 1, sequence: 1300 }, ctx()).live, false);
});

test('reconnect backlog stays silent until the fresh snapshot is acknowledged for that epoch', () => {
  const meta = { replay: true, gap: true, connectionEpoch: 2, sequence: 1500 };
  assert.equal(sparseStreamLiveness(meta, ctx({ currentEpoch: 2, ackedEpoch: 1 })).live, false);
  assert.equal(sparseStreamLiveness(meta, ctx({ currentEpoch: 2, ackedEpoch: 2, snapshotSequence: 1480 })).live, true);
  // events from a previous epoch or covered by the applied snapshot never celebrate
  assert.equal(sparseStreamLiveness({ ...meta, connectionEpoch: 1 }, ctx({ currentEpoch: 2, ackedEpoch: 2 })).live, false);
  assert.equal(sparseStreamLiveness(meta, ctx({ currentEpoch: 2, ackedEpoch: 2, snapshotSequence: 1500 })).live, false);
});

test('gap tracker: pending from a gap until the acknowledgement, which records the epoch', () => {
  const g = createGapTracker();
  assert.equal(g.gapPending, false); assert.equal(g.ackedEpoch, 0);
  g.onGap(); assert.equal(g.gapPending, true);
  g.onAcknowledged(1); assert.equal(g.gapPending, false); assert.equal(g.ackedEpoch, 1);
  g.onGap(); g.onAcknowledged(3); assert.equal(g.ackedEpoch, 3);
});
