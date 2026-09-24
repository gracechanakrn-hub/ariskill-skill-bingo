import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClockSync, formatCountdown, medianOffset, remainingMs } from '../clock-sync.js';

function fakeClocks({ offset = 5000, rtt = 100 }) {
  let wall = 1_000_000; let mono = 50_000;
  const wallNow = () => wall, monoNow = () => mono;
  const advance = (ms) => { wall += ms; mono += ms; };
  // server is `offset` ms ahead; each round trip costs `rtt` (sampled at the midpoint)
  const fetchTime = async () => { advance(rtt / 2); const epochMs = wall + offset; advance(rtt / 2); return { serverTime: new Date(epochMs).toISOString(), epochMs }; };
  return { wallNow, monoNow, advance, fetchTime, get wall() { return wall; } };
}

test('sync takes 3 samples, uses the median and corrects now() within 250 ms', async () => {
  const c = fakeClocks({ offset: 5000, rtt: 120 });
  let calls = 0;
  const cs = createClockSync({ fetchTime: async () => { calls++; return c.fetchTime(); }, wallNow: c.wallNow, monoNow: c.monoNow, sleep: async () => {} });
  assert.equal(cs.isSynced, false);
  const r = await cs.sync();
  assert.equal(calls, 3);
  assert.equal(r.samples.length, 3);
  assert.equal(cs.isSynced, true);
  assert.ok(Math.abs(cs.offsetMs - 5000) <= 250, `offset ${cs.offsetMs}`);
  assert.ok(Math.abs(cs.now() - (c.wall + 5000)) <= 250);
  c.advance(10_000);
  assert.ok(Math.abs(cs.now() - (c.wall + 5000)) <= 250, 'drifts with the monotonic clock');
});

test('now() is immune to local wall-clock jumps after sync (monotonic anchor)', async () => {
  let wall = 100_000, mono = 0;
  const cs = createClockSync({ fetchTime: async () => ({ epochMs: wall + 2000 }), wallNow: () => wall, monoNow: () => mono, sleep: async () => {} });
  await cs.sync();
  const before = cs.now();
  wall += 60_000; // user changes the device clock; monotonic clock moves 1 s
  mono += 1000;
  assert.ok(Math.abs(cs.now() - (before + 1000)) <= 5);
});

test('observe() triggers a resync when passive samples drift beyond the threshold', async () => {
  const c = fakeClocks({ offset: 5000, rtt: 40 });
  let syncs = 0;
  const cs = createClockSync({ fetchTime: async () => { syncs++; return c.fetchTime(); }, wallNow: c.wallNow, monoNow: c.monoNow, sleep: async () => {} });
  await cs.sync();
  const after = syncs;
  cs.observe({ serverTime: new Date(c.wall + 5000).toISOString(), sentAt: c.wall - 40, receivedAt: c.wall }); // in agreement
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(syncs, after);
  cs.observe({ serverTime: new Date(c.wall + 9000).toISOString(), sentAt: c.wall - 40, receivedAt: c.wall }); // 4 s drift
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(syncs > after, 'resync scheduled');
});

test('sync rejects when every sample fails and stays unsynced', async () => {
  const cs = createClockSync({ fetchTime: async () => { throw new Error('offline'); }, sleep: async () => {} });
  await assert.rejects(cs.sync());
  assert.equal(cs.isSynced, false);
  assert.ok(Number.isFinite(cs.now()));
});

test('medianOffset', () => {
  assert.equal(medianOffset([5, 1, 3]), 3);
  assert.equal(medianOffset([{ offsetMs: 10 }, { offsetMs: 20 }]), 15);
  assert.equal(medianOffset([]), 0);
});

test('formatCountdown is mm:ss, never negative, 00:00 at/after target, rounds up', () => {
  const target = Date.parse('2026-09-22T10:00:00Z');
  assert.equal(formatCountdown('2026-09-22T10:00:00Z', target - 90_000), '01:30');
  assert.equal(formatCountdown('2026-09-22T10:00:00Z', target - 500), '00:01');
  assert.equal(formatCountdown('2026-09-22T10:00:00Z', target), '00:00');
  assert.equal(formatCountdown('2026-09-22T10:00:00Z', target + 5000), '00:00');
  assert.equal(formatCountdown('2026-09-22T10:00:00Z', target - 3_600_000), '60:00');
  assert.equal(formatCountdown('2026-09-22T10:00:00Z', target - 125_000), '02:05');
  assert.equal(formatCountdown('garbage', target), '00:00');
  assert.equal(formatCountdown(null, target), '00:00');
  assert.equal(remainingMs('2026-09-22T10:00:00Z', target + 1), 0);
  assert.equal(remainingMs('2026-09-22T10:00:00Z', target - 1), 1);
});
