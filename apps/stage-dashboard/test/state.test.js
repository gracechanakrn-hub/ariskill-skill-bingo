import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, deriveView, changedTiles, layoutFor, isStale, RECENT_LIMIT } from '../src/state.js';

const round = (over = {}) => ({ roundId: 'rnd_1', number: 1, title: 'Round 1', state: 'REGISTRATION_OPEN', version: 2, lockAt: '2026-09-22T06:00:00.000Z', startedAt: null, resultWindowSeconds: 12, cancellationReason: null, ...over });
const env = (type, payload, over = {}) => ({ eventId: 'evt_demo', roundId: 'rnd_1', sequence: 10, type, occurredAt: '2026-09-22T05:50:00.000Z', roundVersion: 2, payload, ...over });
const skill = (n, kind = 'Core') => ({ id: `skill_${n}`, name: `Skill ${n}`, kind, domain: 'd' });

test('unknown events leave the state untouched (same reference)', () => {
  const s = initialState();
  assert.equal(reduce(s, env('board.saved', {})), s);
  assert.equal(reduce(s, null), s);
});

test('round.created for a DRAFT round with no current round lands in nextRound', () => {
  const s = reduce(initialState(), env('round.created', { round: round({ state: 'DRAFT' }) }));
  assert.equal(s.round, null);
  assert.equal(s.nextRound.roundId, 'rnd_1');
  assert.equal(s.publicState, 'Waiting');
});

test('registration_opened promotes the next round to current and maps publicState', () => {
  let s = reduce(initialState(), env('round.created', { round: round({ state: 'DRAFT' }) }));
  s = reduce(s, env('round.registration_opened', { round: round() }));
  assert.equal(s.round.roundId, 'rnd_1');
  assert.equal(s.round.state, 'REGISTRATION_OPEN');
  assert.equal(s.nextRound, null);
  assert.equal(s.serverTime, '2026-09-22T05:50:00.000Z');
});

test('round.locked stores active/deferred counts and clears startOverdue; round.updated can set it', () => {
  let s = reduce(initialState(), env('round.registration_opened', { round: round() }));
  s = reduce(s, env('round.locked', { round: round({ state: 'LOCKED' }), activeBoards: 27, deferredBoards: 3 }));
  assert.equal(s.counts.active, 27);
  assert.equal(s.counts.deferred, 3);
  assert.equal(s.round.startOverdue, false);
  s = reduce(s, env('round.updated', { round: round({ state: 'LOCKED' }), startOverdue: true }));
  assert.equal(s.round.startOverdue, true);
  s = reduce(s, env('round.started', { round: round({ state: 'PLAYING', startedAt: '2026-09-22T05:51:00.000Z' }), poolSize: 40 }));
  assert.equal(s.round.startOverdue, false);
  assert.equal(s.poolSize, 40);
  assert.equal(s.publicState, 'Playing');
});

test('draw.accepted keeps the last 10 draws in order, updates matched boards and the current draw', () => {
  let s = reduce(initialState(), env('round.started', { round: round({ state: 'PLAYING' }), poolSize: 40 }));
  for (let n = 1; n <= 12; n++) {
    s = reduce(s, env('draw.accepted', { draw: { drawId: `d${n}`, number: n, skill: skill(n, n % 2 ? 'Core' : 'Critical'), drawnAt: '2026-09-22T05:52:00.000Z' }, poolRemaining: 40 - n, matchedBoards: n * 2, bingoEvaluationActive: n >= 5 }, { sequence: 20 + n }));
  }
  assert.equal(s.recentDraws.length, RECENT_LIMIT);
  assert.deepEqual(s.recentDraws.map(r => r.number), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(s.recentDraws[9], { number: 12, skillName: 'Skill 12', kind: 'Critical' });
  assert.equal(s.currentDraw.number, 12);
  assert.equal(s.currentDraw.poolRemaining, 28);
  assert.equal(s.currentDraw.bingoEvaluationActive, true);
  assert.equal(s.counts.matchedBoards, 24);
  const vm = deriveView(s, { nowMs: Date.parse('2026-09-22T05:52:05.000Z') });
  assert.equal(vm.layout, 'live');
  assert.deepEqual(vm.draw.recent.map(r => r.number), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.equal(vm.draw.pacing, 'live');
  assert.equal(vm.status.hero.kind, 'draw');
  assert.equal(vm.status.hero.skillName, 'Skill 12');
});

test('draw.match_counts_updated only touches matchedBoards; participation.updated merges counts', () => {
  let s = reduce(initialState(), env('draw.match_counts_updated', { drawNumber: 3, matchedBoards: 9 }));
  assert.equal(s.counts.matchedBoards, 9);
  s = reduce(s, env('participation.updated', { counts: { joined: 30, completed: 28, incomplete: 2, active: 0, deferred: 0, matchedBoards: 9 } }));
  assert.deepEqual(s.counts, { joined: 30, completed: 28, incomplete: 2, active: 0, deferred: 0, matchedBoards: 9 });
});

test('bingo.detected then result.published fills winners and result timing from the server, never locally', () => {
  let s = reduce(initialState(), env('round.started', { round: round({ state: 'PLAYING' }), poolSize: 40 }));
  s = reduce(s, env('bingo.detected', { drawNumber: 7, winnerCount: 2 }));
  assert.deepEqual(s.bingo, { drawNumber: 7, winnerCount: 2, at: '2026-09-22T05:50:00.000Z' });
  s = reduce(s, env('result.published', { round: round({ state: 'WINNER' }), winners: [{ label: 'Ada', soulId: 'soul_a', winningDrawNumber: 7 }, { label: null, soulId: 'soul_b', winningDrawNumber: 7 }], resultWindowEndsAt: '2026-09-22T05:55:12.000Z' }, { occurredAt: '2026-09-22T05:55:00.000Z' }));
  assert.equal(s.round.state, 'WINNER');
  assert.equal(s.publicState, 'Winner');
  assert.equal(s.winners.length, 2);
  assert.equal(s.winners[1].label, null);
  assert.deepEqual(s.resultTiming, { winningDrawNumber: 7, publishedAt: '2026-09-22T05:55:00.000Z', resultWindowEndsAt: '2026-09-22T05:55:12.000Z' });
  const vm = deriveView(s);
  assert.equal(vm.status.hero.kind, 'result');
  assert.equal(vm.status.hero.winningDrawNumber, 7);
  assert.equal(vm.winners.list.length, 2);
  assert.equal(vm.layout, 'live');
});

test('cancel / exhausted / closed map to notices and the insights layout; a new active round resets per-round data', () => {
  let s = reduce(initialState(), env('round.started', { round: round({ state: 'PLAYING' }), poolSize: 40 }));
  s = reduce(s, env('draw.accepted', { draw: { drawId: 'd1', number: 1, skill: skill(1) }, poolRemaining: 39, matchedBoards: 1, bingoEvaluationActive: false }));
  s = reduce(s, env('round.exhausted', { round: round({ state: 'EXHAUSTED' }) }));
  assert.equal(s.notice.kind, 'exhausted');
  assert.equal(deriveView(s).status.hero.kind, 'notice');
  assert.equal(layoutFor(s), 'insights');
  s = reduce(s, env('round.closed', { round: round({ state: 'CLOSED' }) }));
  assert.equal(s.round.state, 'CLOSED');
  s = reduce(s, env('round.created', { round: round({ roundId: 'rnd_2', number: 2, title: 'Round 2', state: 'DRAFT' }) }, { roundId: 'rnd_2' }));
  assert.equal(s.nextRound.roundId, 'rnd_2');
  assert.equal(deriveView(s).status.hero.kind, 'scheduled');
  s = reduce(s, env('round.registration_opened', { round: round({ roundId: 'rnd_2', number: 2, title: 'Round 2' }) }, { roundId: 'rnd_2' }));
  assert.equal(s.round.roundId, 'rnd_2');
  assert.equal(s.currentDraw, null);
  assert.deepEqual(s.recentDraws, []);
  assert.equal(s.notice, null);
  assert.equal(deriveView(s).status.hero.kind, 'countdown');
  s = reduce(s, env('round.cancelled', { round: round({ roundId: 'rnd_2', number: 2, state: 'CANCELLED', cancellationReason: 'Fire drill' }), reason: 'Fire drill' }, { roundId: 'rnd_2' }));
  assert.equal(s.notice.kind, 'cancelled');
  assert.equal(s.notice.reason, 'Fire drill');
});

test('soul.float_accepted increments the galaxy count once per soulId', () => {
  let s = { ...initialState(), galaxy: { souls: [{ soulId: 'soul_x' }], count: 1 } };
  s = reduce(s, env('soul.float_accepted', { entrance: { soulId: 'soul_y', edge: 'left' } }));
  assert.equal(s.galaxy.count, 2);
  const again = reduce(s, env('soul.float_accepted', { entrance: { soulId: 'soul_y', edge: 'left' } }));
  assert.equal(again.galaxy.count, 2);
});

test('deriveView hero variants: none, scheduled (nextRound), countdown, locked with overdue note, closed', () => {
  assert.equal(deriveView(initialState()).status.hero.kind, 'none');
  const withNext = { ...initialState(), nextRound: round({ state: 'DRAFT' }) };
  const vmNext = deriveView(withNext);
  assert.equal(vmNext.status.hero.kind, 'scheduled');
  assert.equal(vmNext.status.isNextRound, true);
  assert.equal(vmNext.status.roundNumber, 1);
  const open = reduce(initialState(), env('round.registration_opened', { round: round() }));
  assert.deepEqual(deriveView(open).status.hero, { kind: 'countdown', target: '2026-09-22T06:00:00.000Z' });
  const locked = reduce(open, env('round.updated', { round: round({ state: 'LOCKED' }), startOverdue: true }));
  assert.deepEqual(deriveView(locked).status.hero, { kind: 'locked', startOverdue: true });
  const closed = reduce(locked, env('round.closed', { round: round({ state: 'CLOSED' }) }));
  assert.equal(deriveView(closed).status.hero.kind, 'closed');
});

test('changedTiles reports counts, status, draw, winners and insights changes', () => {
  const a = initialState();
  const b = reduce(a, env('participation.updated', { counts: { joined: 5, matchedBoards: 0 } }));
  assert.deepEqual([...changedTiles(a, b)], ['count.joined']);
  const c = reduce(b, env('draw.accepted', { draw: { drawId: 'd1', number: 1, skill: skill(1) }, poolRemaining: 1, matchedBoards: 2, bingoEvaluationActive: false }));
  const set = changedTiles(b, c);
  assert.ok(set.has('count.matchedBoards') && set.has('draw') && set.has('status'));
  const d = { ...c, insights: { topSkills: [] } };
  assert.ok(changedTiles(c, d).has('insights'));
  const e = reduce(d, env('result.published', { round: round({ state: 'WINNER' }), winners: [{ label: 'Ada', soulId: 's', winningDrawNumber: 1 }], resultWindowEndsAt: null }));
  assert.ok(changedTiles(d, e).has('winners'));
});

test('isStale uses a 10 s threshold against the server time', () => {
  const t = '2026-09-22T05:50:00.000Z';
  assert.equal(isStale(t, Date.parse(t) + 9_000), false);
  assert.equal(isStale(t, Date.parse(t) + 10_001), true);
  assert.equal(isStale(null, Date.now()), false);
});
