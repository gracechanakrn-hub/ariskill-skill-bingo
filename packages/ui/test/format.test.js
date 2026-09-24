import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plural, formatInt, formatTime, relativeSeconds, pseudonymLabel, ordinal, padTwo } from '../format.js';

test('plural / formatInt / ordinal / padTwo', () => {
  assert.equal(plural(1, 'skill'), '1 skill');
  assert.equal(plural(3, 'skill'), '3 skills');
  assert.equal(plural(0, 'board'), '0 boards');
  assert.equal(plural(2, 'entry', 'entries'), '2 entries');
  assert.equal(formatInt(12345), '12,345');
  assert.equal(formatInt('7.9'), '7');
  assert.equal(formatInt(null), '0');
  assert.equal(ordinal(1), '1st'); assert.equal(ordinal(2), '2nd'); assert.equal(ordinal(3), '3rd'); assert.equal(ordinal(11), '11th'); assert.equal(ordinal(22), '22nd');
  assert.equal(padTwo(7), '07'); assert.equal(padTwo(-3), '00');
});

test('formatTime renders 24h HH:mm in a given zone and empty for invalid', () => {
  assert.equal(formatTime('2026-09-22T03:30:05.120Z', { timeZone: 'UTC' }), '03:30');
  assert.equal(formatTime('2026-09-22T03:30:05.120Z', { timeZone: 'UTC', withSeconds: true }), '03:30:05');
  assert.equal(formatTime('2026-09-22T00:05:00Z', { timeZone: 'UTC' }), '00:05');
  assert.equal(formatTime('nope'), '');
});

test('relativeSeconds uses the supplied now and whole units', () => {
  const now = Date.parse('2026-09-22T03:30:00Z');
  assert.equal(relativeSeconds('2026-09-22T03:30:12Z', now), 'in 12 s');
  assert.equal(relativeSeconds('2026-09-22T03:29:48Z', now), '12 s ago');
  assert.equal(relativeSeconds('2026-09-22T03:30:00.200Z', now), 'now');
  assert.equal(relativeSeconds('2026-09-22T03:35:00Z', now), 'in 5 min');
  assert.equal(relativeSeconds('2026-09-22T05:30:00Z', now), 'in 2 h');
  assert.equal(relativeSeconds('bad', now), '');
});

test('pseudonymLabel is deterministic, short, and does not leak the id', () => {
  const a = pseudonymLabel('soul_8f2a9c1d');
  assert.equal(a, pseudonymLabel('soul_8f2a9c1d'));
  assert.match(a, /^Soul [A-Z2-9]{4}$/);
  assert.notEqual(a, pseudonymLabel('soul_8f2a9c1e'));
  assert.ok(!a.includes('8f2a9c1d'));
  assert.match(pseudonymLabel(null, { prefix: 'Star' }), /^Star [A-Z2-9]{4}$/);
});
