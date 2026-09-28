import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUND_STATES, allowedCommands, isCommandAllowed, assertAllowed, targets, isTerminal, STATE_MACHINE, PUBLIC_STATE } from '../src/state-machine.js';

test('the six D-53 states exist (no LOCKED, no EXHAUSTED), terminals have no commands, every state maps to a public state', () => {
  assert.equal(STATE_MACHINE.version, '2.0.0');
  assert.deepEqual(ROUND_STATES, ['DRAFT', 'REGISTRATION_OPEN', 'PLAYING', 'WINNER', 'CLOSED', 'CANCELLED']);
  for (const s of ['CLOSED', 'CANCELLED']) { assert.ok(isTerminal(s)); assert.deepEqual(allowedCommands(s), []); }
  for (const s of ROUND_STATES) assert.ok(PUBLIC_STATE[s]);
});
test('no unreachable state and every transition target is a known state', () => {
  const reachable = new Set(['DRAFT']); let changed = true;
  while (changed) { changed = false; for (const t of STATE_MACHINE.round.transitions) if (reachable.has(t.from) && !reachable.has(t.to)) { reachable.add(t.to); changed = true; } }
  for (const s of ROUND_STATES) assert.ok(reachable.has(s), `unreachable ${s}`);
  for (const t of STATE_MACHINE.round.transitions) { assert.ok(ROUND_STATES.includes(t.from)); assert.ok(ROUND_STATES.includes(t.to)); }
});
test('every command listed for a state has at least one transition, and vice versa', () => {
  for (const s of ROUND_STATES) for (const c of allowedCommands(s)) assert.ok(targets(s, c).length > 0, `${s}:${c}`);
  for (const t of STATE_MACHINE.round.transitions) if (t.command !== '(timer)') assert.ok(isCommandAllowed(t.from, t.command), `${t.from}:${t.command}`);
});
test('illegal transitions throw with code', () => {
  assert.throws(() => assertAllowed('DRAFT', 'round.draw.next'), e => e.code === 'ILLEGAL_TRANSITION');
  assert.throws(() => assertAllowed('WINNER', 'round.draw.next'));
  assert.doesNotThrow(() => assertAllowed('PLAYING', 'round.draw.next'));
  assert.deepEqual(targets('PLAYING', 'round.draw.next').sort(), ['PLAYING', 'WINNER']);
  assert.deepEqual(targets('REGISTRATION_OPEN', 'round.start_now'), ['PLAYING']);
});
test('D-53 command sets: start time / Start now replace lock + start; round.close is timer-only', () => {
  assert.deepEqual(allowedCommands('DRAFT'), ['round.update', 'round.registration.open', 'round.cancel']);
  assert.deepEqual(allowedCommands('REGISTRATION_OPEN'), ['round.reschedule', 'round.start_now', 'round.cancel']);
  assert.deepEqual(allowedCommands('PLAYING'), ['round.draw.next', 'round.cancel']);
  assert.deepEqual(allowedCommands('WINNER'), []);
  for (const s of ROUND_STATES) for (const c of ['round.lock', 'round.start', 'round.close']) assert.equal(isCommandAllowed(s, c), false, `${s}:${c}`);
  assert.deepEqual(targets('REGISTRATION_OPEN', '(timer)'), ['PLAYING']);
  assert.deepEqual(targets('WINNER', '(timer)'), ['CLOSED']);
});
