import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetry, track, FORBIDDEN_PROPS, isDebugEnabled } from '../telemetry.js';

test('track drops private props (employeeRef/email/selectedSkillIds) and email-looking values', () => {
  const calls = [];
  const t = createTelemetry({ sink: (event, props) => calls.push({ event, props }), debug: false });
  const r = t.track('client.join_started', { eventId: 'evt_1', employeeRef: 'E123', email: 'a@b.co', selectedSkillIds: ['s1', 's2'], note: 'someone@arise.example', count: 3 });
  assert.equal(r.accepted, true);
  assert.deepEqual(r.dropped.sort(), ['email', 'employeeRef', 'note', 'selectedSkillIds']);
  assert.deepEqual(calls[0].props, { eventId: 'evt_1', count: 3 });
  for (const k of ['employeeRef', 'email', 'selectedSkillIds']) assert.ok(FORBIDDEN_PROPS.includes(k));
});

test('track never ships lists or nested objects, tolerates a throwing sink, rejects empty names', () => {
  const t = createTelemetry({ sink: () => { throw new Error('boom'); }, debug: false });
  const r = t.track('client.selection_progress', { ids: ['a', 'b', 'c'], nested: { x: 1 }, count: 25, elapsedMs: 1200 });
  assert.equal(r.accepted, true);
  assert.deepEqual(r.props, { ids: 3, nested: '[object]', count: 25, elapsedMs: 1200 });
  assert.equal(t.track('', {}).accepted, false);
});

test('default track is a no-op sink that does not throw without a window', () => {
  assert.equal(typeof isDebugEnabled(), 'boolean');
  const r = track('client.reconnect', { audience: 'public', gapSize: 2, durationMs: 800 });
  assert.equal(r.accepted, true);
});
