import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, applySnapshot, applyEvent, select } from '../store.js';

test('createStore: get/set patch, set fn, subscribe/unsubscribe', () => {
  const s = createStore({ a: 1 });
  const seen = [];
  const off = s.subscribe((next, prev) => seen.push([next.a, prev.a]));
  s.set({ a: 2 });
  s.set((prev) => ({ ...prev, a: prev.a + 1 }));
  off();
  s.set({ a: 99 });
  assert.equal(s.get().a, 99);
  assert.deepEqual(seen, [[2, 1], [3, 2]]);
});

test('applyEvent ignores sequence <= last and applies newer events through the reducer', () => {
  const s = createStore({ sequence: 5, draws: [] });
  const reducer = (state, env) => ({ ...state, draws: [...state.draws, env.payload.draw.number] });
  assert.equal(applyEvent(s, { sequence: 5, type: 'draw.accepted', payload: { draw: { number: 1 } } }, reducer).applied, false);
  assert.equal(applyEvent(s, { sequence: 3, type: 'draw.accepted', payload: { draw: { number: 1 } } }, reducer).reason, 'stale');
  const r = applyEvent(s, { sequence: 6, type: 'draw.accepted', occurredAt: '2026-09-22T03:30:05.120Z', payload: { draw: { number: 1 } } }, reducer);
  assert.equal(r.applied, true);
  assert.deepEqual(s.get().draws, [1]);
  assert.equal(s.get().sequence, 6);
  assert.equal(s.get().lastEventType, 'draw.accepted');
  assert.equal(applyEvent(s, { type: 'x' }, reducer).reason, 'no-sequence');
});

test('applySnapshot always wins (final state wins) and sets the cursor', () => {
  const s = createStore({ sequence: 10, round: { state: 'PLAYING' }, local: 'keep' });
  applySnapshot(s, { sequence: 12, round: { state: 'WINNER' } });
  assert.equal(s.get().round.state, 'WINNER');
  assert.equal(s.get().sequence, 12);
  assert.equal(s.get().snapshotSequence, 12);
  assert.equal(s.get().local, 'keep');
  // an older event is now ignored
  assert.equal(applyEvent(s, { sequence: 11, type: 'round.started' }, (st) => ({ ...st, round: { state: 'PLAYING' } })).applied, false);
  assert.equal(s.get().round.state, 'WINNER');
  // a snapshot even with a lower sequence still replaces state (snapshot is authoritative)
  applySnapshot(s, { sequence: 11, round: { state: 'CLOSED' } });
  assert.equal(s.get().round.state, 'CLOSED');
  assert.equal(s.get().sequence, 11);
});

test('select fires only when the derived value changes', () => {
  const s = createStore({ a: 1, b: 1 });
  const seen = [];
  select(s, (st) => st.a, (v) => seen.push(v));
  s.set({ b: 2 }); s.set({ a: 2 }); s.set({ a: 2 });
  assert.deepEqual(seen, [1, 2]);
});
