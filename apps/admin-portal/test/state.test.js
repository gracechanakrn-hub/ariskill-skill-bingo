import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, normaliseSnapshot, reduceEvent, roundViewModel, upsertRound, drawsNewestFirst, localDateTimeToIso,
  isoToLocalDateTime, clampResultWindow, isCommandAllowed, statePill, connectionView, filterAudit, densityBars, TERMINAL_STATES,
} from '../src/state.js';

const summary = (over = {}) => ({ roundId: 'rnd_1', number: 1, title: 'Round 1', state: 'DRAFT', version: 1, lockAt: '2026-09-22T12:00:00.000Z', startedAt: null, resultWindowSeconds: 12, cancellationReason: null, ...over });
const snapshot = (over = {}) => ({
  eventId: 'evt_demo', eventName: 'Demo', sequence: 10, serverTime: '2026-09-22T11:00:00.000Z',
  rounds: [summary()],
  currentRound: { summary: summary(), readiness: { poolSize: 7, poolMinimum: 5, anyBoardCanWin: true, boardsThatCanWin: 3, startOverdue: false, lockCountdownMs: null }, counts: { joined: 12, completed: 12, incomplete: 0, active: 0, deferred: 0, matchedBoards: 0, connections: 2 }, draws: [], poolRemaining: 7, winners: [], lastCommand: null, pacingHintSeconds: [5, 8] },
  join: { joinUrl: 'http://127.0.0.1:8102/play?t=abc', expiresAt: '2026-09-23T00:00:00.000Z' },
  connections: { public: 1, stage: 0, participants: 1, admin: 1 },
  ...over,
});

test('normaliseSnapshot: snapshot wins and resets per-round extras when the round changes', () => {
  const s1 = normaliseSnapshot(snapshot(), initialState());
  assert.equal(s1.loaded, true);
  assert.equal(s1.currentRound.summary.roundId, 'rnd_1');
  assert.equal(s1.currentRound.readiness.poolSize, 7);
  assert.equal(s1.join.joinUrl, 'http://127.0.0.1:8102/play?t=abc');
  const withBingo = { ...s1, bingo: { drawNumber: 5 }, resultWindowEndsAt: '2026-09-22T12:00:12.000Z', currentRound: { ...s1.currentRound, summary: summary({ state: 'WINNER' }) } };
  const same = normaliseSnapshot(snapshot({ currentRound: { ...snapshot().currentRound, summary: summary({ state: 'WINNER' }) } }), withBingo);
  assert.deepEqual(same.bingo, { drawNumber: 5 });
  assert.equal(same.resultWindowEndsAt, '2026-09-22T12:00:12.000Z');
  const other = normaliseSnapshot(snapshot({ currentRound: { ...snapshot().currentRound, summary: summary({ roundId: 'rnd_2', number: 2 }) } }), withBingo);
  assert.equal(other.bingo, null);
  assert.equal(other.resultWindowEndsAt, null);
  assert.equal(normaliseSnapshot(snapshot({ currentRound: null })).currentRound, null);
});

test('reduceEvent: round lifecycle events update rounds list and current round', () => {
  let s = normaliseSnapshot(snapshot(), initialState());
  s = reduceEvent(s, { type: 'round.registration_opened', roundId: 'rnd_1', sequence: 11, payload: { round: summary({ state: 'REGISTRATION_OPEN', version: 2 }) } });
  assert.equal(s.currentRound.summary.state, 'REGISTRATION_OPEN');
  assert.equal(s.rounds[0].version, 2);
  s = reduceEvent(s, { type: 'round.locked', roundId: 'rnd_1', sequence: 12, payload: { round: summary({ state: 'LOCKED', version: 3 }), activeBoards: 10, deferredBoards: 2 } });
  assert.equal(s.currentRound.counts.active, 10);
  assert.equal(s.currentRound.counts.deferred, 2);
  assert.equal(s.currentRound.readiness.lockCountdownMs, null);
  s = reduceEvent(s, { type: 'round.updated', roundId: 'rnd_1', sequence: 13, payload: { round: summary({ state: 'LOCKED', version: 3 }), startOverdue: true } });
  assert.equal(s.currentRound.readiness.startOverdue, true);
  s = reduceEvent(s, { type: 'round.started', roundId: 'rnd_1', sequence: 14, payload: { round: summary({ state: 'PLAYING', version: 4 }), poolSize: 9 } });
  assert.equal(s.currentRound.summary.state, 'PLAYING');
  assert.equal(s.currentRound.readiness.poolSize, 9);
  assert.equal(s.currentRound.poolRemaining, 9);
  assert.equal(s.currentRound.readiness.startOverdue, false);
});

test('reduceEvent: draws, match counts, bingo, result, participation', () => {
  let s = normaliseSnapshot(snapshot({ currentRound: { ...snapshot().currentRound, summary: summary({ state: 'PLAYING', version: 4 }) } }), initialState());
  const draw = (n) => ({ drawId: `d${n}`, number: n, skill: { id: `s${n}`, name: `Skill ${n}`, kind: n % 2 ? 'Core' : 'Critical', domain: 'X' }, drawnAt: '2026-09-22T12:00:00.000Z' });
  s = reduceEvent(s, { type: 'draw.accepted', roundId: 'rnd_1', sequence: 20, payload: { draw: draw(1), poolRemaining: 6, matchedBoards: 3, bingoEvaluationActive: false } });
  s = reduceEvent(s, { type: 'draw.accepted', roundId: 'rnd_1', sequence: 21, payload: { draw: draw(2), poolRemaining: 5, matchedBoards: 4, bingoEvaluationActive: false } });
  s = reduceEvent(s, { type: 'draw.accepted', roundId: 'rnd_1', sequence: 22, payload: { draw: draw(2), poolRemaining: 5, matchedBoards: 4, bingoEvaluationActive: false } }); // duplicate number ignored
  assert.equal(s.currentRound.draws.length, 2);
  assert.equal(s.currentRound.poolRemaining, 5);
  assert.deepEqual(drawsNewestFirst(s.currentRound.draws).map((d) => d.number), [2, 1]);
  s = reduceEvent(s, { type: 'draw.match_counts_updated', roundId: 'rnd_1', sequence: 23, payload: { drawNumber: 1, matchedBoards: 7, boardsWithFourInLine: 2 } });
  assert.equal(s.currentRound.draws.find((d) => d.number === 1).matchedBoards, 7);
  assert.equal(s.boardsWithFourInLine, 2);
  s = reduceEvent(s, { type: 'bingo.detected', roundId: 'rnd_1', sequence: 24, payload: { drawNumber: 2, winnerCount: 1 } });
  assert.equal(s.bingo.drawNumber, 2);
  s = reduceEvent(s, { type: 'result.published', roundId: 'rnd_1', sequence: 25, payload: { round: summary({ state: 'WINNER', version: 6 }), winners: [{ participantId: 'p1', label: 'Avery R.', lineIds: ['row-1'], winningDrawNumber: 2 }], resultWindowEndsAt: '2026-09-22T12:00:12.000Z' } });
  assert.equal(s.currentRound.summary.state, 'WINNER');
  assert.equal(s.currentRound.winners[0].label, 'Avery R.');
  assert.equal(s.resultWindowEndsAt, '2026-09-22T12:00:12.000Z');
  s = reduceEvent(s, { type: 'participation.updated', roundId: null, sequence: 26, payload: { counts: { joined: 13, matchedBoards: 9, connections: 5 } } });
  assert.equal(s.currentRound.counts.joined, 13);
  assert.equal(s.currentRound.counts.completed, 12); // untouched fields retained
  assert.equal(reduceEvent(s, { type: 'soul.float_accepted', sequence: 27, payload: {} }), s);
});

test('reduceEvent: events for another round never touch the current round draws', () => {
  let s = normaliseSnapshot(snapshot({ currentRound: { ...snapshot().currentRound, summary: summary({ state: 'PLAYING' }) } }), initialState());
  s = reduceEvent(s, { type: 'draw.accepted', roundId: 'rnd_other', sequence: 30, payload: { draw: { number: 1, skill: { id: 'x', name: 'X', kind: 'Core' } }, poolRemaining: 1, matchedBoards: 0 } });
  assert.equal(s.currentRound.draws.length, 0);
});

test('reduceEvent: round.created after a terminal round becomes the current round', () => {
  let s = normaliseSnapshot(snapshot({ currentRound: { ...snapshot().currentRound, summary: summary({ state: 'CLOSED' }) } }), initialState());
  s = reduceEvent(s, { type: 'round.created', roundId: 'rnd_2', sequence: 40, payload: { round: summary({ roundId: 'rnd_2', number: 2, title: 'Round 2' }) } });
  assert.equal(s.currentRound.summary.roundId, 'rnd_2');
  assert.equal(s.rounds.length, 2);
  assert.deepEqual(s.rounds.map((r) => r.number), [1, 2]);
  assert.equal(s.currentRound.draws.length, 0);
});

test('roundViewModel: controls per state and E20 gating', () => {
  const st = (state, readiness = {}) => normaliseSnapshot(snapshot({ currentRound: { ...snapshot().currentRound, summary: summary({ state }), readiness: { ...snapshot().currentRound.readiness, ...readiness } } }), initialState());
  assert.equal(roundViewModel(initialState()).phase, 'none');
  const draft = roundViewModel(st('DRAFT'));
  assert.ok(draft.controls.edit && draft.controls.openRegistration && draft.controls.cancel && !draft.controls.lockNow);
  const open = roundViewModel(st('REGISTRATION_OPEN'));
  assert.ok(open.controls.lockNow && open.controls.startNow && open.controls.reschedule && open.showJoin && open.showLockCountdown);
  const locked = roundViewModel(st('LOCKED', { poolSize: 7 }));
  assert.ok(locked.controls.start && locked.controls.startEnabled && locked.startBlockedException === null);
  const small = roundViewModel(st('LOCKED', { poolSize: 4 }));
  assert.equal(small.controls.startEnabled, false);
  assert.equal(small.startBlockedException, 'E20');
  const overdue = roundViewModel(st('LOCKED', { poolSize: 7, startOverdue: true }));
  assert.equal(overdue.startOverdue, true);
  const playing = roundViewModel(st('PLAYING'));
  assert.ok(playing.controls.nextSkill && playing.controls.cancel && !playing.controls.start);
  const winner = roundViewModel(st('WINNER'));
  assert.ok(!winner.controls.cancel && !winner.controls.nextSkill && !winner.controls.close);
  const exhausted = roundViewModel(st('EXHAUSTED'));
  assert.ok(exhausted.controls.close && exhausted.controls.cancel && exhausted.exhaustedException === 'E23');
  for (const s of TERMINAL_STATES) { const vm = roundViewModel(st(s)); assert.ok(vm.controls.createNext && !vm.controls.cancel); }
});

test('isCommandAllowed mirrors the state machine', () => {
  assert.ok(isCommandAllowed('PLAYING', 'round.draw.next'));
  assert.ok(!isCommandAllowed('WINNER', 'round.draw.next'));
  assert.ok(!isCommandAllowed('LOCKED', 'round.lock'));
  assert.ok(isCommandAllowed('REGISTRATION_OPEN', 'round.start_now'));
  assert.ok(!isCommandAllowed('CLOSED', 'round.cancel'));
});

test('upsertRound keeps order and merges', () => {
  const list = upsertRound([summary({ roundId: 'b', number: 2 }), summary({ roundId: 'a', number: 1 })], { roundId: 'a', number: 1, version: 9 });
  assert.deepEqual(list.map((r) => r.roundId), ['a', 'b']);
  assert.equal(list[0].version, 9);
  assert.equal(list[0].title, 'Round 1');
});

test('datetime-local <-> ISO and result window clamp', () => {
  const iso = localDateTimeToIso('2026-09-22T14:30');
  assert.match(iso, /^2026-09-22T\d{2}:\d{2}:00\.000Z$/);
  assert.equal(localDateTimeToIso(''), null);
  assert.equal(localDateTimeToIso('nope'), null);
  assert.equal(isoToLocalDateTime('2026-09-22T12:00:00.000Z', 0), '2026-09-22T12:00');
  assert.equal(isoToLocalDateTime('2026-09-22T12:00:00.000Z', -120), '2026-09-22T14:00');
  assert.equal(isoToLocalDateTime('bad'), '');
  assert.equal(clampResultWindow('12'), 12);
  assert.equal(clampResultWindow(3), 10);
  assert.equal(clampResultWindow(99), 15);
  assert.equal(clampResultWindow('x'), 12);
});

test('pills, connection view, audit filter, density bars', () => {
  assert.equal(statePill('PLAYING'), 'pill--live');
  assert.equal(statePill('CANCELLED'), 'pill--danger');
  assert.deepEqual(connectionView('open'), { pill: 'pill--open', reconnecting: false });
  assert.deepEqual(connectionView('reconnecting'), { pill: 'pill--reconnecting', reconnecting: true });
  const entries = [{ id: 1, roundId: 'a' }, { id: 3, roundId: 'b' }, { id: 2, roundId: 'a' }];
  assert.deepEqual(filterAudit(entries, null).map((e) => e.id), [3, 2, 1]);
  assert.deepEqual(filterAudit(entries, 'a').map((e) => e.id), [2, 1]);
  assert.deepEqual(densityBars({ core: 50, critical: 30, optional: 20, totalSelections: 100 }), { core: 50, critical: 30, optional: 20, total: 100 });
  assert.deepEqual(densityBars(null), { core: 0, critical: 0, optional: 0, total: 0 });
});

test('UX-03: irreversible controls require confirmation; reschedule is the unconfirmed safe default', () => {
  const st = normaliseSnapshot(snapshot({ currentRound: { ...snapshot().currentRound, summary: summary({ state: 'REGISTRATION_OPEN' }) } }), initialState());
  const vm = roundViewModel(st);
  assert.ok(vm.controls.lockNow && vm.controls.startNow && vm.controls.reschedule && vm.controls.cancel);
  assert.equal(vm.confirmRequired.lockNow, true);
  assert.equal(vm.confirmRequired.startNow, true);
  assert.equal(vm.confirmRequired.cancel, true);
  assert.equal(vm.confirmRequired.reschedule, false);
  assert.equal(vm.confirmRequired.nextSkill, false);
});
