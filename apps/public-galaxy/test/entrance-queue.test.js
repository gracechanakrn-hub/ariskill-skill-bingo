import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEntranceQueue } from '../src/entrance-queue.js';

test('at most 6 concurrent entrances, FIFO queue, overflow settles instantly', () => {
  const q = createEntranceQueue({ maxConcurrent: 6, maxQueued: 12, arcMs: 2200, pulseMs: 600, settleMs: 1200 });
  const results = [];
  for (let i = 0; i < 20; i++) results.push(q.enqueue(`s${i}`, 0));
  assert.deepEqual(results.slice(0, 6), Array(6).fill('active'));
  assert.deepEqual(results.slice(6, 18), Array(12).fill('queued'));
  assert.deepEqual(results.slice(18), ['instant', 'instant']);
  assert.equal(q.activeCount, 6); assert.equal(q.queuedCount, 12);
  assert.equal(q.enqueue('s0', 0), 'duplicate');
  // nothing finishes before 4000 ms
  assert.deepEqual(q.update(3999), { started: [], finished: [] });
  const r = q.update(4000);
  assert.equal(r.finished.length, 6); assert.equal(r.started.length, 6);
  assert.deepEqual(r.started, ['s6', 's7', 's8', 's9', 's10', 's11']);
  assert.equal(q.queuedCount, 6);
});

test('phases: arc -> pulse -> settle -> done with normalised t', () => {
  const q = createEntranceQueue({ arcMs: 2200, pulseMs: 600, settleMs: 1200 });
  q.enqueue('a', 1000);
  assert.deepEqual(q.progress('a', 1000), { phase: 'arc', t: 0 });
  assert.equal(q.progress('a', 2100).phase, 'arc');
  assert.equal(q.progress('a', 1000 + 2200).phase, 'pulse');
  assert.equal(q.progress('a', 1000 + 2800).phase, 'settle');
  assert.equal(q.progress('a', 1000 + 4000).phase, 'done');
  assert.equal(q.progress('zzz', 0), null);
  assert.equal(q.totalMs(), 4000);
});

test('notBefore delays a queued entrance (server-time alignment) and reduced motion is a 400 ms fade', () => {
  const q = createEntranceQueue({ maxConcurrent: 1 });
  assert.equal(q.enqueue('early', 0, 500), 'queued');
  assert.deepEqual(q.update(499), { started: [], finished: [] });
  assert.deepEqual(q.update(500).started, ['early']);
  const rm = createEntranceQueue({ reducedMotion: true, fadeMs: 400 });
  rm.enqueue('f', 0);
  assert.equal(rm.progress('f', 200).phase, 'fade');
  assert.equal(rm.progress('f', 400).phase, 'done');
  assert.equal(rm.totalMs(), 400);
});

test('start/finish listeners fire once per Soul', () => {
  const q = createEntranceQueue({ maxConcurrent: 1, arcMs: 10, pulseMs: 10, settleMs: 10 });
  const started = [], finished = [];
  q.onStart(id => started.push(id)); q.onFinish(id => finished.push(id));
  q.enqueue('a', 0); q.enqueue('b', 0);
  q.update(30); q.update(60);
  assert.deepEqual(started, ['a', 'b']); assert.deepEqual(finished, ['a', 'b']);
});
