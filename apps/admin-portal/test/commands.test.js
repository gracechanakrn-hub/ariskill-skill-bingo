import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandRunner, exceptionIdFor } from '../src/commands.js';

function fakeApi(script) {
  const calls = [];
  let i = 0;
  const post = async (roundId, body, key) => {
    calls.push({ roundId, body, key });
    const step = script[Math.min(i, script.length - 1)]; i += 1;
    if (typeof step === 'function') return step({ roundId, body, key });
    if (step && step.error) throw step.error;
    return step;
  };
  return { post, calls };
}
const err = (code, extra = {}) => Object.assign(new Error(code), { code, isStaleVersion: code === 'STALE_VERSION', isNetwork: code === 'NETWORK', isAuth: false, ...extra });
let n = 0; const newKey = () => `key-${++n}`;

test('accepted: sends expectedVersion from the current summary and a fresh key; draw.next never carries a skill id', async () => {
  const round = { roundId: 'r1', state: 'PLAYING', version: 7 };
  const api = fakeApi([{ accepted: true, round: { ...round, version: 8 }, resultingVersion: 8 }]);
  const hooks = { accepted: [], pending: [] };
  const runner = createCommandRunner({ post: api.post, newKey, getRound: () => round, hooks: { onAccepted: (r, c) => hooks.accepted.push(c), onPending: (c) => hooks.pending.push(c) } });
  const res = await runner.run('round.draw.next', { skillId: 'never' });
  assert.equal(res.status, 'accepted');
  assert.equal(api.calls.length, 1);
  assert.deepEqual(api.calls[0].body, { command: 'round.draw.next', expectedVersion: 7, params: {} });
  assert.ok(!JSON.stringify(api.calls[0].body).includes('skillId'));
  assert.match(api.calls[0].key, /^key-\d+$/);
  assert.deepEqual(hooks.pending, ['round.draw.next']);
  assert.deepEqual(hooks.accepted, ['round.draw.next']);
  assert.equal(runner.isPending(), false);
});

test('double click: second run while pending returns busy and sends nothing', async () => {
  const round = { roundId: 'r1', state: 'PLAYING', version: 1 };
  let resolve; const api = fakeApi([() => new Promise((r) => { resolve = r; })]);
  const runner = createCommandRunner({ post: api.post, newKey, getRound: () => round });
  const first = runner.run('round.draw.next');
  await Promise.resolve();
  assert.equal(runner.isPending(), true);
  assert.equal(runner.pendingCommand(), 'round.draw.next');
  const second = await runner.run('round.draw.next');
  assert.equal(second.status, 'busy');
  assert.equal(api.calls.length, 1);
  resolve({ accepted: true });
  assert.equal((await first).status, 'accepted');
});

test('stale version: onStale receives the snapshot, nothing re-fires, next action uses a new key', async () => {
  const round = { roundId: 'r1', state: 'PLAYING', version: 3 };
  const stale = err('STALE_VERSION', { details: { currentVersion: 4, snapshot: { roundId: 'r1', version: 4, state: 'PLAYING' } }, staleSnapshot: { roundId: 'r1', version: 4, state: 'PLAYING' } });
  const api = fakeApi([{ error: stale }, { accepted: true }]);
  const seen = [];
  const runner = createCommandRunner({ post: api.post, newKey, getRound: () => round, hooks: { onStale: (e) => seen.push(e.staleSnapshot.version) } });
  const res = await runner.run('round.draw.next');
  assert.equal(res.status, 'stale');
  assert.deepEqual(seen, [4]);
  assert.equal(api.calls.length, 1); // never auto re-fires
  round.version = 4;
  const again = await runner.run('round.draw.next');
  assert.equal(again.status, 'accepted');
  assert.equal(api.calls[1].body.expectedVersion, 4);
  assert.notEqual(api.calls[1].key, api.calls[0].key);
});

test('network failure keeps the same Idempotency-Key for a retry of the SAME action only', async () => {
  const round = { roundId: 'r1', state: 'PLAYING', version: 2 };
  const api = fakeApi([{ error: err('NETWORK') }, { accepted: true }, { accepted: true }]);
  const runner = createCommandRunner({ post: api.post, newKey, getRound: () => round });
  const r1 = await runner.run('round.draw.next');
  assert.equal(r1.status, 'network');
  assert.equal(runner.retryKeyFor('round.draw.next'), api.calls[0].key);
  const r2 = await runner.run('round.draw.next');
  assert.equal(r2.status, 'accepted');
  assert.equal(api.calls[1].key, api.calls[0].key);
  const r3 = await runner.run('round.cancel', { reason: 'x' });
  assert.equal(r3.status, 'accepted');
  assert.notEqual(api.calls[2].key, api.calls[0].key);
  assert.deepEqual(api.calls[2].body.params, { reason: 'x' });
});

test('network failure followed by a different action drops the retry key', async () => {
  const round = { roundId: 'r1', state: 'REGISTRATION_OPEN', version: 2 };
  const api = fakeApi([{ error: err('NETWORK') }, { accepted: true }, { accepted: true }]);
  const runner = createCommandRunner({ post: api.post, newKey, getRound: () => round });
  await runner.run('round.start_now');
  await runner.run('round.reschedule', { extendMinutes: 5 });
  assert.notEqual(api.calls[1].key, api.calls[0].key);
  await runner.run('round.start_now');
  assert.notEqual(api.calls[2].key, api.calls[0].key);
});

test('rejected commands surface the error and the exception copy id', async () => {
  const round = { roundId: 'r1', state: 'REGISTRATION_OPEN', version: 5 };
  const api = fakeApi([{ error: err('POOL_TOO_SMALL', { exceptionId: 'E20' }) }]);
  const rejected = [];
  const runner = createCommandRunner({ post: api.post, newKey, getRound: () => round, hooks: { onRejected: (e, c) => rejected.push([c, exceptionIdFor(e)]) } });
  const res = await runner.run('round.start_now');
  assert.equal(res.status, 'rejected');
  assert.deepEqual(rejected, [['round.start_now', 'E20']]);
  assert.equal(exceptionIdFor(err('ILLEGAL_TRANSITION')), 'E10');
  assert.equal(exceptionIdFor(err('DRAW_FAILED')), 'E21');
  assert.equal(exceptionIdFor(err('POOL_EXHAUSTED')), 'E11');
  assert.equal(exceptionIdFor(err('REASON_REQUIRED')), null);
  assert.equal(exceptionIdFor(null), null);
});

test('guards: no round, command not allowed in state, start_now always confirmed', async () => {
  const api = fakeApi([{ accepted: true }]);
  let round = null;
  const runner = createCommandRunner({ post: api.post, newKey, getRound: () => round });
  assert.equal((await runner.run('round.start_now')).status, 'no-round');
  round = { roundId: 'r1', state: 'WINNER', version: 1 };
  assert.equal((await runner.run('round.draw.next')).status, 'not-allowed');
  round = { roundId: 'r1', state: 'REGISTRATION_OPEN', version: 1 };
  for (const gone of ['round.lock', 'round.start', 'round.close']) assert.equal((await runner.run(gone)).status, 'not-allowed', `D-53 removed ${gone}`);
  assert.equal(api.calls.length, 0);
  round = { roundId: 'r1', state: 'REGISTRATION_OPEN', version: 1 };
  assert.equal((await runner.run('round.start_now', { confirmed: 'yes' })).status, 'accepted');
  assert.deepEqual(api.calls[0].body.params, { confirmed: true });
});

test('UX-04: a failed start_now lock leg maps to E19; stale, illegal, pool and network stay themselves (D-53: start_now is the only locking command)', () => {
  assert.equal(exceptionIdFor(err('INTERNAL', { status: 500 }), 'round.start_now'), 'E19');
  assert.equal(exceptionIdFor(err('DB_ERROR'), 'round.start_now'), 'E19');
  assert.equal(exceptionIdFor(err('INTERNAL', { details: { code: 'E19' } }), 'round.draw.next'), 'E19', 'an E19-flagged detail wins for any command');
  assert.equal(exceptionIdFor(err('STALE_VERSION'), 'round.start_now'), 'E10');
  assert.equal(exceptionIdFor(err('ILLEGAL_TRANSITION'), 'round.start_now'), 'E10');
  assert.equal(exceptionIdFor(err('POOL_TOO_SMALL'), 'round.start_now'), 'E20');
  assert.equal(exceptionIdFor(err('NETWORK'), 'round.start_now'), null);
  assert.equal(exceptionIdFor(err('VALIDATION'), 'round.start_now'), null);
  assert.equal(exceptionIdFor(err('INTERNAL'), 'round.draw.next'), null);
  assert.equal(exceptionIdFor(err('INTERNAL', { status: 500 }), 'round.lock'), null, 'round.lock no longer exists, so it is not a locking command');
  assert.equal(exceptionIdFor(err('INTERNAL'), 'round.reschedule'), null);
});

test('UX-04: runner reports a lock failure as rejected (no mutation, no retry key) and the hook can map it to E19', async () => {
  const round = { roundId: 'r1', state: 'REGISTRATION_OPEN', version: 2 };
  const api = fakeApi([{ error: err('INTERNAL', { status: 500 }) }]);
  const seen = [];
  const runner = createCommandRunner({ post: api.post, newKey, getRound: () => round, hooks: { onRejected: (e, c) => seen.push(exceptionIdFor(e, c)) } });
  const res = await runner.run('round.start_now');
  assert.equal(res.status, 'rejected');
  assert.deepEqual(seen, ['E19']);
  assert.equal(runner.retryKeyFor('round.start_now'), null);
  assert.equal(round.version, 2);
});
