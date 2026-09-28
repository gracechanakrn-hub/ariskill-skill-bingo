import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, normaliseSnapshot, reduceEvent, roundViewModel, upsertRound, drawsNewestFirst, localDateTimeToIso,
  isoToLocalDateTime, clampResultWindow, isCommandAllowed, statePill, connectionView, filterAudit, densityBars, TERMINAL_STATES,
  COMMANDS_BY_STATE, STATUS, STEPS, START_IN_CHOICES, EXTEND_CHOICES, UNFINISHED_ALERT, statusOf, defaultRoundTitle,
} from '../src/state.js';
import sm from '../../../contracts/round-state-machine.json' with { type: 'json' };

const summary = (over = {}) => ({ roundId: 'rnd_1', number: 1, title: 'Round 1', state: 'DRAFT', version: 1, lockAt: '2026-09-22T12:00:00.000Z', startedAt: null, resultWindowSeconds: 12, cancellationReason: null, ...over });
const snapshot = (over = {}) => ({
  eventId: 'evt_demo', eventName: 'Demo', sequence: 10, serverTime: '2026-09-22T11:00:00.000Z',
  rounds: [summary()],
  currentRound: { summary: summary(), readiness: { poolSize: 7, poolMinimum: 5, anyBoardCanWin: true, boardsThatCanWin: 3, startOverdue: false, lockCountdownMs: null, startBlocked: false, unfinishedBoards: 0 }, counts: { joined: 12, completed: 12, incomplete: 0, active: 0, deferred: 0, matchedBoards: 0, connections: 2 }, draws: [], poolRemaining: 7, winners: [], lastCommand: null, pacingHintSeconds: [5, 8] },
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
  // D-53: the start time passed with a pool < 5 -> round.updated {startBlocked: true} (system actor, same version)
  s = { ...s, currentRound: { ...s.currentRound, readiness: { ...s.currentRound.readiness, unfinishedBoards: 4, lockCountdownMs: 1000 } } };
  s = reduceEvent(s, { type: 'round.updated', roundId: 'rnd_1', sequence: 12, payload: { round: summary({ state: 'REGISTRATION_OPEN', version: 2 }), startBlocked: true } });
  assert.equal(s.currentRound.readiness.startBlocked, true);
  // an extension (round.reschedule) arrives as round.updated without startBlocked: the flag is left for the snapshot to clear
  s = reduceEvent(s, { type: 'round.updated', roundId: 'rnd_1', sequence: 13, payload: { round: summary({ state: 'REGISTRATION_OPEN', version: 3, lockAt: '2026-09-22T12:05:00.000Z' }) } });
  assert.equal(s.currentRound.summary.lockAt, '2026-09-22T12:05:00.000Z'); assert.equal(s.currentRound.summary.version, 3);
  s = reduceEvent(s, { type: 'round.updated', roundId: 'rnd_1', sequence: 14, payload: { round: summary({ state: 'REGISTRATION_OPEN', version: 3 }), startBlocked: false } });
  assert.equal(s.currentRound.readiness.startBlocked, false);
  s = reduceEvent(s, { type: 'round.started', roundId: 'rnd_1', sequence: 15, payload: { round: summary({ state: 'PLAYING', version: 4 }), poolSize: 9, activeBoards: 10, unfinishedBoards: 3, deferredBoards: 2 } });
  assert.equal(s.currentRound.summary.state, 'PLAYING');
  assert.equal(s.currentRound.readiness.poolSize, 9);
  assert.equal(s.currentRound.poolRemaining, 9);
  assert.equal(s.currentRound.counts.active, 10);
  assert.equal(s.currentRound.counts.deferred, 2);
  assert.equal(s.currentRound.readiness.startBlocked, false); assert.equal(s.currentRound.readiness.unfinishedBoards, 0); assert.equal(s.currentRound.readiness.lockCountdownMs, null);
  // D-53: round.locked / round.exhausted are no longer handled
  for (const type of ['round.locked', 'round.exhausted']) assert.equal(reduceEvent(s, { type, roundId: 'rnd_1', sequence: 16, payload: { round: summary({ state: 'LOCKED', version: 5 }) } }), s, type);
});

test('reduceEvent: round.deleted removes the round (and clears the current round only when it was that one); event.reset clears everything', () => {
  let s = normaliseSnapshot(snapshot({ rounds: [summary({ state: 'CLOSED' }), summary({ roundId: 'rnd_2', number: 2, state: 'PLAYING' })], currentRound: { ...snapshot().currentRound, summary: summary({ roundId: 'rnd_2', number: 2, state: 'PLAYING' }) } }), initialState());
  s = { ...s, bingo: { drawNumber: 5, roundId: 'rnd_2' }, resultWindowEndsAt: '2026-09-22T12:00:12.000Z', boardsWithFourInLine: 3 };
  const other = reduceEvent(s, { type: 'round.deleted', roundId: null, sequence: 50, payload: { roundId: 'rnd_1', number: 1 } });
  assert.deepEqual(other.rounds.map((r) => r.roundId), ['rnd_2']);
  assert.equal(other.currentRound.summary.roundId, 'rnd_2', 'another round deleted: the current round stays');
  assert.deepEqual(other.bingo, { drawNumber: 5, roundId: 'rnd_2' });
  const cur = reduceEvent(other, { type: 'round.deleted', roundId: null, sequence: 51, payload: { roundId: 'rnd_2', number: 2 } });
  assert.deepEqual(cur.rounds, []); assert.equal(cur.currentRound, null);
  assert.equal(cur.bingo, null); assert.equal(cur.resultWindowEndsAt, null); assert.equal(cur.boardsWithFourInLine, null);
  assert.equal(roundViewModel(cur).phase, 'none'); assert.equal(roundViewModel(cur).canCreateNext, true);
  const reset = reduceEvent(s, { type: 'event.reset', roundId: null, sequence: 52, payload: {} });
  assert.deepEqual(reset.rounds, []); assert.equal(reset.currentRound, null); assert.equal(reset.bingo, null); assert.equal(reset.resultWindowEndsAt, null); assert.equal(reset.boardsWithFourInLine, null);
  assert.equal(reset.eventId, 'evt_demo', 'the event itself stays');
  assert.equal(normaliseSnapshot(snapshot({ canClearData: true }), initialState()).canClearData, true);
  assert.equal(normaliseSnapshot(snapshot(), initialState()).canClearData, false, 'hidden unless the server says so (production)');
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

test('roundViewModel: controls per state (D-53: Start now / Extend while open, no lock / start / close)', () => {
  const st = (state, readiness = {}, over = {}) => normaliseSnapshot(snapshot({ currentRound: { ...snapshot().currentRound, summary: summary({ state, ...over }), readiness: { ...snapshot().currentRound.readiness, ...readiness } } }), initialState());
  const none = roundViewModel(initialState());
  assert.equal(none.phase, 'none'); assert.equal(none.canCreateNext, true);
  const draft = roundViewModel(st('DRAFT'));
  assert.deepEqual(draft.controls, { edit: true, openRegistration: true, startNow: false, extend: false, nextSkill: false, cancel: true, delete: true, createNext: false });
  assert.equal(draft.status.label, 'Draft'); assert.equal(draft.msToStart, null); assert.equal(draft.showJoin, false);
  const open = roundViewModel(st('REGISTRATION_OPEN'), Date.parse('2026-09-22T11:55:00.000Z'));
  assert.deepEqual(open.controls, { edit: false, openRegistration: false, startNow: true, extend: true, nextSkill: false, cancel: true, delete: true, createNext: false });
  assert.equal(open.showJoin, true); assert.equal(open.msToStart, 5 * 60 * 1000); assert.equal(open.startBlocked, false);
  const blocked = roundViewModel(st('REGISTRATION_OPEN', { startBlocked: true }), Date.parse('2026-09-22T12:01:00.000Z'));
  assert.equal(blocked.startBlocked, true); assert.equal(blocked.msToStart, -60000); assert.ok(blocked.controls.extend && blocked.controls.startNow);
  const playing = roundViewModel(st('PLAYING'));
  assert.deepEqual(playing.controls, { edit: false, openRegistration: false, startNow: false, extend: false, nextSkill: true, cancel: true, delete: true, createNext: false });
  assert.equal(playing.startBlocked, false, 'startBlocked only means something while registration is open');
  assert.equal(roundViewModel(st('PLAYING', { startBlocked: true })).startBlocked, false);
  for (const s of ['WINNER', 'CLOSED']) {
    const vm = roundViewModel(st(s));
    assert.ok(!vm.controls.cancel && !vm.controls.nextSkill && vm.controls.delete, s); assert.equal(vm.status.label, 'Finished');
  }
  assert.equal(roundViewModel(st('WINNER')).canCreateNext, false, 'the next round waits for the celebration to end');
  for (const s of TERMINAL_STATES) { const vm = roundViewModel(st(s)); assert.ok(vm.controls.createNext && vm.canCreateNext && !vm.controls.cancel); }
  for (const vm of [draft, open, playing]) for (const gone of ['lockNow', 'start', 'startEnabled', 'close', 'reschedule']) assert.ok(!(gone in vm.controls), gone);
});

test('roundViewModel: the unfinished-boards alert shows for more than 3 unfinished players in the last 2 minutes, never while startBlocked', () => {
  const lockAt = '2026-09-22T12:00:00.000Z';
  const at = (msBefore) => Date.parse(lockAt) - msBefore;
  const vm = (unfinishedBoards, now, extra = {}, state = 'REGISTRATION_OPEN') => roundViewModel(normaliseSnapshot(snapshot({ currentRound: { ...snapshot().currentRound, summary: summary({ state, lockAt }), readiness: { ...snapshot().currentRound.readiness, unfinishedBoards, ...extra } } }), initialState()), now);
  assert.deepEqual(UNFINISHED_ALERT, { over: 3, windowMs: 120000 });
  assert.equal(vm(4, at(120000)).unfinishedAlert, true, 'exactly 2 minutes before the start');
  assert.equal(vm(4, at(1000)).unfinishedAlert, true);
  assert.equal(vm(4, at(0)).unfinishedAlert, true, 'at the start time');
  assert.equal(vm(4, at(120001)).unfinishedAlert, false, 'earlier than 2 minutes');
  assert.equal(vm(3, at(60000)).unfinishedAlert, false, '3 is not more than 3');
  assert.equal(vm(4, at(60000)).unfinished, 4);
  assert.equal(vm(10, at(60000), { startBlocked: true }).unfinishedAlert, false, 'the blocked-start alert replaces it');
  assert.equal(vm(10, at(60000), {}, 'PLAYING').unfinishedAlert, false);
  assert.equal(vm(10, at(60000), {}, 'DRAFT').unfinishedAlert, false);
  const noTime = roundViewModel(normaliseSnapshot(snapshot({ currentRound: { ...snapshot().currentRound, summary: summary({ state: 'REGISTRATION_OPEN', lockAt: null }), readiness: { ...snapshot().currentRound.readiness, unfinishedBoards: 9 } } }), initialState()), at(0));
  assert.equal(noTime.msToStart, null); assert.equal(noTime.unfinishedAlert, false);
});

test('D-53 statuses, steps, choices and the default round title', () => {
  assert.equal(statusOf('DRAFT').label, 'Draft'); assert.equal(statusOf('REGISTRATION_OPEN').label, 'Registration open'); assert.equal(statusOf('PLAYING').label, 'Playing');
  assert.equal(statusOf('WINNER').label, 'Finished'); assert.equal(statusOf('CLOSED').label, 'Finished'); assert.equal(statusOf('CANCELLED').label, 'Cancelled');
  assert.equal(statusOf('WINNER').step, statusOf('CLOSED').step); assert.equal(statusOf('CANCELLED').step, -1);
  assert.deepEqual(STEPS, ['Draft', 'Registration open', 'Playing', 'Finished']);
  for (const [state, def] of Object.entries(STATUS)) if (def.step >= 0) assert.equal(STEPS[def.step], def.label, state);
  assert.deepEqual(statusOf('LOCKED'), { label: 'LOCKED', step: -1, pill: 'pill--info' }, 'unknown states fall back');
  assert.equal(statusOf(undefined).label, '');
  assert.deepEqual(START_IN_CHOICES, [5, 10, 15, 30]); assert.deepEqual(EXTEND_CHOICES, [1, 3, 5, 10, 15]);
  assert.ok(START_IN_CHOICES.every((m) => m >= 1 && m <= 240) && EXTEND_CHOICES.every((m) => m >= 1 && m <= 60), 'inside the server limits');
  assert.equal(defaultRoundTitle([]), 'Round 1'); assert.equal(defaultRoundTitle(undefined), 'Round 1');
  assert.equal(defaultRoundTitle([{ number: 1 }, { number: 4 }, { number: 2 }]), 'Round 5', 'one past the highest, gaps from deleted rounds are not reused');
  assert.equal(defaultRoundTitle([{ number: 'x' }]), 'Round 1');
});

test('isCommandAllowed mirrors the state machine', () => {
  assert.ok(isCommandAllowed('PLAYING', 'round.draw.next'));
  assert.ok(!isCommandAllowed('WINNER', 'round.draw.next'));
  assert.ok(!isCommandAllowed('LOCKED', 'round.lock'));
  assert.ok(isCommandAllowed('REGISTRATION_OPEN', 'round.start_now'));
  assert.ok(!isCommandAllowed('CLOSED', 'round.cancel'));
  for (const s of Object.keys(COMMANDS_BY_STATE)) for (const c of ['round.lock', 'round.start', 'round.close']) assert.ok(!isCommandAllowed(s, c), `${s}:${c}`);
  assert.deepEqual(Object.keys(COMMANDS_BY_STATE).sort(), Object.keys(sm.round.states).sort(), 'same states as contracts/round-state-machine.json');
  for (const [state, def] of Object.entries(sm.round.states)) assert.deepEqual(COMMANDS_BY_STATE[state], def.commands, state);
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
  assert.equal(statePill('WINNER'), 'pill--success'); assert.equal(statePill('CLOSED'), 'pill--success', 'Finished looks the same in both');
  assert.equal(statePill('DRAFT'), 'pill--info'); assert.equal(statePill('REGISTRATION_OPEN'), 'pill--open');
  assert.deepEqual(connectionView('open'), { pill: 'pill--open', reconnecting: false });
  assert.deepEqual(connectionView('reconnecting'), { pill: 'pill--reconnecting', reconnecting: true });
  const entries = [{ id: 1, roundId: 'a' }, { id: 3, roundId: 'b' }, { id: 2, roundId: 'a' }];
  assert.deepEqual(filterAudit(entries, null).map((e) => e.id), [3, 2, 1]);
  assert.deepEqual(filterAudit(entries, 'a').map((e) => e.id), [2, 1]);
  assert.deepEqual(densityBars({ core: 50, critical: 30, optional: 20, totalSelections: 100 }), { core: 50, critical: 30, optional: 20, total: 100 });
  assert.deepEqual(densityBars(null), { core: 0, critical: 0, optional: 0, total: 0 });
});

test('D-56 test mode: the snapshot carries testMode / testModeLocked / canClearData; event.updated switches it and Clear all data with it', () => {
  let s = normaliseSnapshot(snapshot({ testMode: false, testModeLocked: false, canClearData: false }), initialState());
  assert.equal(s.testMode, false); assert.equal(s.canClearData, false);
  s = reduceEvent(s, { type: 'event.updated', sequence: 11, payload: { testMode: true } });
  assert.equal(s.testMode, true); assert.equal(s.canClearData, true);
  s = reduceEvent(s, { type: 'event.updated', sequence: 12, payload: { testMode: false } });
  assert.equal(s.testMode, false); assert.equal(s.canClearData, false);
  const locked = normaliseSnapshot(snapshot({ testMode: false, testModeLocked: true, canClearData: false }), initialState());
  assert.equal(reduceEvent(locked, { type: 'event.updated', sequence: 11, payload: { testMode: true } }).canClearData, false, 'the server lock wins');
  assert.equal(reduceEvent(s, { type: 'event.updated', sequence: 13, payload: {} }), s, 'no testMode: unchanged');
});
