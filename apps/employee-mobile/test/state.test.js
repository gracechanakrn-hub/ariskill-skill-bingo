// node --test apps/employee-mobile/test - pure reducer / view-model tests for src/state.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialState, applyParticipantSnapshot, reduceEvent, placeRound, placeBoard, reconcileDraft, sameSet,
  addSkill, removeSkill, undoSelection, kindOf, editableRound, saveBlockedReason, screenFor, selectionProgress,
  playingBannerKey, deferredCopyKey, cellsByPosition, shouldAutoFinalize, applySaveResponse, nextRoundAction, REQUIRED_SELECTIONS,
  nextPickStep, pickerSlots, PICK_STEPS,
} from '../src/state.js';

const round = (over = {}) => ({ roundId: 'r1', number: 1, title: 'Round 1', state: 'REGISTRATION_OPEN', version: 2, lockAt: '2026-09-22T10:00:00.000Z', startedAt: null, resultWindowSeconds: 12, cancellationReason: null, ...over });
const ids = (n, prefix = 's') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const cells = (skillIds) => skillIds.map((skillId, position) => ({ position, skillId, name: skillId.toUpperCase(), kind: position % 2 ? 'Core' : 'Critical', domain: 'Cloud' }));
const board = (over = {}) => ({ boardId: 'b1', roundId: 'r1', state: 'DRAFT', version: 1, selectedSkillIds: ids(3), cells: null, matchedPositions: [], matrixVersion: null, ...over });
const env = (type, payload, seq = 10, roundId = 'r1') => ({ eventId: 'evt_demo', roundId, sequence: seq, type, occurredAt: '2026-09-22T09:00:00.000Z', roundVersion: 2, payload });
const withSession = (s) => ({ ...s, session: { sessionToken: 'tok', participantId: 'p1', eventId: 'evt_demo' } });
const joined = (over = {}) => ({ ...withSession(initialState()), participant: { participantId: 'p1', displayName: 'A', consentPublicName: true, platformId: 'pl', roleId: 'ro' }, round: round(), ...over });

test('screenFor follows the canonical flow E1 -> E10', () => {
  assert.equal(screenFor(initialState()), 'landing', 'a fresh open starts on the landing (D-39)');
  assert.equal(screenFor({ ...initialState(), ui: { ...initialState().ui, landingDone: true } }), 'join');
  assert.equal(screenFor(withSession(initialState())), 'loading');
  assert.equal(screenFor(joined({ participant: { participantId: 'p1', platformId: null, roleId: null } })), 'profile');
  assert.equal(screenFor(joined()), 'select');
  assert.equal(screenFor(joined({ board: board() })), 'select');
  assert.equal(screenFor(joined({ board: board({ state: 'READY', cells: cells(ids(16)) }) })), 'board');
  assert.equal(screenFor(joined({ board: board({ state: 'READY' }), ui: { ...initialState().ui, editing: true } })), 'select');
  assert.equal(screenFor(joined({ board: board({ state: 'LOCKED_ACTIVE' }), round: round({ state: 'LOCKED' }) })), 'locked');
  assert.equal(screenFor(joined({ board: board({ state: 'LOCKED_ACTIVE' }), round: round({ state: 'PLAYING' }) })), 'playing');
  assert.equal(screenFor(joined({ board: board({ state: 'DEFERRED' }) })), 'deferred');
  const finished = joined({ board: board({ state: 'FINISHED' }), round: round({ state: 'WINNER' }), result: { isWinner: false, lineIds: [] } });
  assert.equal(screenFor(finished), 'result');
  const seen = { ...finished, ui: { ...finished.ui, resultSeen: true } };
  assert.equal(screenFor(seen), 'result', 'no Soul yet -> stay on result (E22)');
  const withSoul = { ...seen, soul: { soulId: 'soul1', config: {}, badge: null, floatToken: 'ft', floated: false } };
  assert.equal(screenFor(withSoul), 'soul');
  assert.equal(screenFor({ ...withSoul, soul: { ...withSoul.soul, floated: true } }), 'floated');
  const nextRound = { ...withSoul, nextRound: round({ roundId: 'r2', number: 2 }), ui: { ...withSoul.ui, draftRoundId: 'r2' } };
  assert.equal(screenFor(nextRound), 'select', 'building for the next round returns to selection');
});

test('profile is never prefilled: missing platform or role always projects to the profile screen', () => {
  assert.equal(screenFor(joined({ participant: { participantId: 'p1', platformId: 'pl', roleId: null } })), 'profile');
  assert.equal(screenFor(joined({ participant: { participantId: 'p1', platformId: null, roleId: 'ro' } })), 'profile');
});

test('addSkill fills the next slot, duplicates are a no-op, 16 is the cap, undo is one level', () => {
  let s = joined();
  let r = addSkill(s, 'a'); assert.equal(r.changed, true); assert.deepEqual(r.state.ui.draft, ['a']); assert.equal(r.state.ui.draftDirty, true);
  s = r.state;
  r = addSkill(s, 'a'); assert.equal(r.changed, false); assert.equal(r.reason, 'duplicate'); assert.equal(r.state, s, 'duplicate tap does not change state');
  r = addSkill(s, 'b'); s = r.state; assert.deepEqual(s.ui.draft, ['a', 'b']);
  r = undoSelection(s); assert.equal(r.changed, true); assert.deepEqual(r.state.ui.draft, ['a']);
  r = undoSelection(r.state); assert.equal(r.changed, false, 'only one level of undo');
  r = removeSkill(s, 'a'); assert.deepEqual(r.state.ui.draft, ['b']); assert.deepEqual(r.state.ui.undo, ['a', 'b']);
  r = removeSkill(s, 'zzz'); assert.equal(r.changed, false);
  let full = { ...s, ui: { ...s.ui, draft: ids(16) } };
  r = addSkill(full, 'extra'); assert.equal(r.changed, false); assert.equal(r.reason, 'full');
  assert.deepEqual(selectionProgress(full), { count: 16, total: REQUIRED_SELECTIONS, percent: 100, complete: true });
  assert.equal(selectionProgress(s).count, 2);
});

test('applyParticipantSnapshot: snapshot wins and a clean draft follows the server set', () => {
  const s = joined();
  const snap = { sequence: 40, participant: s.participant, event: { eventId: 'evt_demo', eventName: 'Demo' }, round: round(), nextRound: null, board: board({ selectedSkillIds: ids(17) }), draws: [], result: null, soul: null, insightAvailable: false };
  const next = applyParticipantSnapshot(s, snap);
  assert.equal(next.sequence, 40);
  assert.deepEqual(next.ui.draft, ids(17));
  assert.equal(next.ui.draftDirty, false);
  assert.equal(next.ui.draftRoundId, 'r1');
});

test('reconcileDraft keeps a dirty local draft that differs from the server set (E6 recovery re-PUT)', () => {
  const s = joined({ board: board({ selectedSkillIds: ids(3) }) });
  const dirty = { ...s, ui: { ...s.ui, draft: ids(4), draftDirty: true } };
  assert.deepEqual(reconcileDraft(dirty).ui.draft, ids(4));
  assert.equal(reconcileDraft(dirty).ui.draftDirty, true);
  const same = { ...s, ui: { ...s.ui, draft: [...ids(3)].reverse(), draftDirty: true } };
  assert.equal(reconcileDraft(same).ui.draftDirty, false, 'same set (any order) is confirmed');
  assert.equal(sameSet(['a', 'b'], ['b', 'a']), true);
  assert.equal(sameSet(['a'], ['a', 'a']), false);
});

test('board.ready event places the READY board, clears editing and emits a guarded board.ready effect', () => {
  const s = joined({ board: board({ selectedSkillIds: ids(16) }), ui: { ...initialState().ui, editing: true, draft: ids(16) } });
  const ready = board({ state: 'READY', version: 2, selectedSkillIds: ids(16), cells: cells(ids(16)) });
  const { state, effects } = reduceEvent(s, env('board.ready', { board: ready }, 11));
  assert.equal(state.board.state, 'READY');
  assert.equal(state.ui.editing, false);
  assert.deepEqual(effects.map((e) => e.type), ['board.ready']);
  assert.equal(effects[0].key, 'board.ready:b1:2');
  assert.equal(screenFor(state), 'board');
});

test('round.locked + board.locked_active project to the locked screen with a lock effect', () => {
  const s = joined({ board: board({ state: 'READY', version: 2, cells: cells(ids(16)) }) });
  const r1 = reduceEvent(s, env('board.locked_active', { board: board({ state: 'LOCKED_ACTIVE', version: 3, cells: cells(ids(16)) }) }, 12));
  assert.equal(r1.effects[0].type, 'lock');
  const r2 = reduceEvent(r1.state, env('round.locked', { round: round({ state: 'LOCKED', version: 3 }), activeBoards: 10, deferredBoards: 2 }, 13));
  assert.equal(r2.state.round.state, 'LOCKED');
  assert.equal(screenFor(r2.state), 'locked');
  const r3 = reduceEvent(r2.state, env('round.started', { round: round({ state: 'PLAYING', version: 4 }), poolSize: 30 }, 14));
  assert.equal(screenFor(r3.state), 'playing');
});

test('draw.accepted: matches come only from myMatchedPositions (BR-11); banner flips at draw 4 (M-09)', () => {
  let s = joined({ board: board({ state: 'LOCKED_ACTIVE', version: 3, cells: cells(ids(16)) }), round: round({ state: 'PLAYING' }) });
  const draw = (n, positions) => env('draw.accepted', { draw: { drawId: `d${n}`, number: n, skill: { id: `s${n}`, name: `S${n}`, kind: 'Core', domain: 'Cloud' }, drawnAt: '2026-09-22T09:00:00.000Z' }, poolRemaining: 30 - n, myMatchedPositions: positions, bingoEvaluationActive: n >= 4 }, 20 + n);
  let r = reduceEvent(s, draw(1, [3]));
  assert.deepEqual(r.state.board.matchedPositions, [3]);
  assert.deepEqual(r.effects[0].newPositions, [3]);
  assert.equal(r.effects[0].matchedCount, 1);
  assert.equal(playingBannerKey(r.state), 'play.drawsBeforeFiveN');
  s = r.state;
  r = reduceEvent(s, draw(1, [3]));
  assert.equal(r.effects.length, 0, 'duplicate drawId is ignored');
  for (const n of [2, 3]) s = reduceEvent(s, draw(n, [3])).state;
  assert.equal(playingBannerKey(s), 'play.drawsBeforeFiveN');
  r = reduceEvent(s, draw(4, [3, 8]));
  assert.equal(r.effects[0].unlocksBingo, true);
  assert.deepEqual(r.effects[0].newPositions, [8]);
  assert.equal(playingBannerKey(r.state), 'play.evaluationActive');
  assert.equal(r.state.draws.length, 4);
});

test('bingo.detected + result.published: winner/co-winner projection, FINISHED board, result screen', () => {
  const s = joined({ board: board({ state: 'LOCKED_ACTIVE', version: 3, cells: cells(ids(16)) }), round: round({ state: 'PLAYING' }), draws: [{ drawId: 'd7', number: 7, skill: { id: 'x', name: 'X', kind: 'Core' } }] });
  const r1 = reduceEvent(s, env('bingo.detected', { drawNumber: 7, winnerCount: 3 }, 30));
  assert.equal(r1.effects[0].key, 'bingo:r1:7');
  const r2 = reduceEvent(r1.state, env('result.published', { round: round({ state: 'WINNER', version: 9 }), winners: [{ label: 'A', soulId: 'a' }, { label: 'B', soulId: 'b' }, { label: 'C', soulId: 'c' }], myResult: { isWinner: true, lineIds: ['row-1', 'col-2'] }, resultWindowEndsAt: '2026-09-22T09:01:00.000Z' }, 31));
  assert.deepEqual(r2.state.result, { isWinner: true, lineIds: ['row-1', 'col-2'], winningDrawNumber: 7, coWinnerCount: 3 });
  assert.equal(r2.state.board.state, 'FINISHED');
  assert.equal(r2.state.insightAvailable, true);
  assert.equal(r2.effects[0].type, 'result');
  assert.equal(screenFor(r2.state), 'result');
  const loser = reduceEvent(r1.state, env('result.published', { round: round({ state: 'WINNER' }), winners: [{ label: 'A', soulId: 'a' }], myResult: { isWinner: false, lineIds: [] } }, 31));
  assert.equal(loser.state.result.isWinner, false);
  assert.equal(loser.state.result.coWinnerCount, 1);
});

test('soul.created then soul.float_accepted (own soul only) -> floated; foreign entrance ignored', () => {
  const s = joined({ board: board({ state: 'FINISHED' }), round: round({ state: 'WINNER' }), result: { isWinner: false, lineIds: [] } });
  const r1 = reduceEvent(s, env('soul.created', { soul: { soulId: 'soulA', config: { seed: 'x' }, badge: null, floatToken: 'tok', floated: false } }, 40));
  assert.equal(r1.effects[0].key, 'soul:soulA');
  const other = reduceEvent(r1.state, env('soul.float_accepted', { entrance: { soulId: 'soulB', enteredAt: '2026-09-22T09:00:00.000Z', edge: 'left' } }, 41));
  assert.equal(other.effects.length, 0);
  assert.equal(other.state.soul.floated, false);
  const mine = reduceEvent(r1.state, env('soul.float_accepted', { entrance: { soulId: 'soulA', enteredAt: '2026-09-22T09:00:00.000Z', edge: 'left' } }, 41));
  assert.equal(mine.state.soul.floated, true);
  assert.equal(mine.state.soul.floatToken, null);
  assert.equal(mine.effects[0].key, 'float:soulA');
});

test('board.deferred carries its reason to the copy key (E5 / E8 / E15) and round.cancelled marks cancelled', () => {
  const s = joined({ board: board({ state: 'READY', version: 2, cells: cells(ids(16)) }) });
  const late = reduceEvent(s, env('board.deferred', { board: board({ state: 'DEFERRED', version: 3 }), reason: 'late' }, 50));
  assert.equal(late.state.board.deferredReason, 'late');
  assert.equal(deferredCopyKey(late.state.board.deferredReason), 'E8');
  assert.equal(deferredCopyKey('incomplete'), 'board.deferred');
  assert.equal(deferredCopyKey('cancelled'), 'E15');
  assert.equal(screenFor(late.state), 'deferred');
  const cancelled = reduceEvent(s, env('round.cancelled', { round: round({ state: 'CANCELLED', cancellationReason: 'fire drill' }), reason: 'fire drill' }, 51));
  assert.equal(cancelled.state.board.deferredReason, 'cancelled');
  const snapDeferred = applyParticipantSnapshot(joined(), { sequence: 60, participant: s.participant, round: round({ state: 'CANCELLED' }), board: board({ state: 'DEFERRED' }), draws: [] });
  assert.equal(snapDeferred.board.deferredReason, 'cancelled', 'snapshot infers cancelled from the round state');
});

test('placeRound follows /me semantics: own round updates in place, other rounds become nextRound', () => {
  const s = joined({ board: board({ state: 'FINISHED' }), round: round({ state: 'CLOSED' }) });
  const r2 = round({ roundId: 'r2', number: 2, state: 'DRAFT' });
  const next = placeRound(s, r2);
  assert.equal(next.round.roundId, 'r1');
  assert.equal(next.nextRound.roundId, 'r2');
  const opened = placeRound(next, { ...r2, state: 'REGISTRATION_OPEN' });
  assert.equal(opened.nextRound.state, 'REGISTRATION_OPEN');
  assert.equal(placeRound(joined({ round: null }), r2).round.roundId, 'r2', 'no board: the new round is the round');
  // A board saved into the next round moves the attached round and resets round-scoped state.
  const moved = placeBoard({ ...opened, draws: [{ drawId: 'd1' }], result: { isWinner: true }, soul: { soulId: 'x' } }, board({ boardId: 'b2', roundId: 'r2', selectedSkillIds: ids(16) }));
  assert.equal(moved.round.roundId, 'r2');
  assert.equal(moved.nextRound, null);
  assert.deepEqual(moved.draws, []);
  assert.equal(moved.result, null);
  assert.equal(moved.soul, null);
  assert.equal(moved.ui.draftRoundId, 'r2');
});

test('editableRound / saveBlockedReason: E1 no round, E8 in progress, E15 cancelled, lockAt elapsed', () => {
  assert.equal(saveBlockedReason(joined({ round: null })), 'E1');
  assert.equal(saveBlockedReason(joined()), null);
  // F-01: without a board the server parks a late draft as DEFERRED (late); with a board in that round it is E8.
  assert.equal(saveBlockedReason(joined({ round: round({ state: 'PLAYING' }) })), null);
  assert.equal(saveBlockedReason(joined({ round: round({ state: 'LOCKED' }), board: board({ state: 'LOCKED_ACTIVE' }) })), 'E8');
  assert.equal(saveBlockedReason(joined({ round: round({ state: 'PLAYING' }), board: board({ state: 'DEFERRED', deferredReason: 'late' }) })), 'E8');
  assert.equal(saveBlockedReason(joined({ round: round({ state: 'CANCELLED' }) })), 'E15');
  assert.equal(saveBlockedReason(joined({ round: round({ state: 'CLOSED' }) })), 'E1');
  const elapsed = Date.parse('2026-09-22T10:00:01.000Z');
  assert.equal(editableRound(joined(), elapsed), null, 'display-only: lockAt elapsed means no editable round');
  assert.equal(editableRound(joined({ round: round({ state: 'CLOSED' }), nextRound: round({ roundId: 'r2', state: 'REGISTRATION_OPEN' }) })).roundId, 'r2');
});

test('kindOf maps discovery flags and cell/draw kinds to Core | Critical | Optional', () => {
  assert.equal(kindOf({ isCore: true, kind: 'Soft Skill' }), 'Core');
  assert.equal(kindOf({ isCritical: true, kind: 'Hard Skill' }), 'Critical');
  assert.equal(kindOf({ isCore: false, isCritical: false, kind: 'Hard Skill' }), 'Optional');
  assert.equal(kindOf({ kind: 'Critical' }), 'Critical');
  assert.equal(kindOf(null), 'Optional');
});

test('cellsByPosition and shouldAutoFinalize', () => {
  const b = board({ state: 'READY', cells: cells(ids(16)) });
  const byPos = cellsByPosition(b);
  assert.equal(byPos.length, 16);
  assert.equal(byPos[15].skillId, 's16');
  assert.equal(cellsByPosition(board()), null);
  const s = joined({ board: board({ selectedSkillIds: ids(16) }), ui: { ...initialState().ui, draft: ids(16), draftDirty: false } });
  assert.equal(shouldAutoFinalize(s), true, 'reassigned 16-skill DRAFT finalizes without a new tap');
  assert.equal(shouldAutoFinalize({ ...s, ui: { ...s.ui, draftDirty: true } }), false);
  assert.equal(shouldAutoFinalize(joined({ board: board({ selectedSkillIds: ids(24) }), ui: { ...initialState().ui, draft: ids(24) } })), false);
});

test('UX-01: next-round action is available regardless of Float / Soul state', () => {
  const finished = joined({ board: board({ state: 'FINISHED' }), round: round({ state: 'CLOSED' }), result: { isWinner: true, lineIds: ['row-0'] } });
  assert.equal(nextRoundAction(finished), null, 'no newer round -> no action');
  const withNext = { ...finished, nextRound: round({ roundId: 'r2', number: 2, state: 'REGISTRATION_OPEN' }) };
  assert.equal(nextRoundAction(withNext).roundId, 'r2', 'no Soul yet');
  const notFloated = { ...withNext, soul: { soulId: 's', config: {}, badge: null, floatToken: 'ft', floated: false } };
  assert.equal(nextRoundAction(notFloated).roundId, 'r2', 'Soul present, not floated');
  const floated = { ...notFloated, soul: { ...notFloated.soul, floated: true, floatToken: null } };
  assert.equal(nextRoundAction(floated).roundId, 'r2', 'floated');
  assert.equal(nextRoundAction({ ...withNext, nextRound: round({ roundId: 'r2', state: 'LOCKED' }) }), null, 'a round that no longer accepts boards');
  const building = { ...withNext, ui: { ...withNext.ui, draftRoundId: 'r2' } };
  assert.equal(screenFor(building), 'select');
  assert.equal(nextRoundAction(building), null, 'already building for it');
  const sameRound = joined({ board: board({ state: 'READY' }) });
  assert.equal(nextRoundAction(sameRound), null, 'board already in the editable round');
});

test('F-01: a participant without a board may save during LOCKED/PLAYING; the late response projects to deferred (E8)', () => {
  const late = joined({ round: round({ state: 'PLAYING' }), board: null, ui: { ...initialState().ui, draft: ids(7), draftDirty: true } });
  assert.equal(saveBlockedReason(late), null, 'save goes to the server, which parks it as DEFERRED (late)');
  assert.equal(saveBlockedReason(joined({ round: round({ state: 'PLAYING' }), board: board({ state: 'LOCKED_ACTIVE' }) })), 'E8', 'existing active board keeps E8');
  const res = { board: board({ state: 'DEFERRED', version: 1, selectedSkillIds: ids(7), cells: null, deferredReason: 'late' }), resultingVersion: 1, notice: 'This round is already in progress. Your board will join the next round.' };
  const r = applySaveResponse(late, res);
  assert.equal(r.late, true);
  assert.equal(r.notice, res.notice);
  assert.equal(r.state.board.state, 'DEFERRED');
  assert.equal(r.state.board.deferredReason, 'late');
  assert.equal(deferredCopyKey(r.state.board.deferredReason), 'E8');
  assert.equal(screenFor(r.state), 'deferred');
  assert.equal(r.state.ui.draftDirty, false, 'server set equals the draft -> confirmed');
  const noticeOnly = applySaveResponse(late, { board: board({ state: 'DEFERRED', selectedSkillIds: ids(7) }), notice: 'x' });
  assert.equal(noticeOnly.state.board.deferredReason, 'late', 'notice alone marks the save as late');
  const normal = applySaveResponse(joined(), { board: board({ selectedSkillIds: ids(3) }), resultingVersion: 1 });
  assert.equal(normal.late, false);
  assert.equal(normal.state.board.state, 'DRAFT');
  // The late event form is handled by the reducer too.
  const ev = reduceEvent(late, env('board.deferred', { board: board({ state: 'DEFERRED', selectedSkillIds: ids(7) }), reason: 'late' }, 70));
  assert.equal(ev.state.board.deferredReason, 'late');
  assert.equal(screenFor(ev.state), 'deferred');
});

test('picker (D-35, D-54): four questions; the rest are skipped when the board is full; slots keep tap order; READY stays in the picker while picking', () => {
  assert.equal(nextPickStep(1, 3), 2);
  assert.equal(nextPickStep(2, 10), 3, 'technical -> soft');
  assert.equal(nextPickStep(3, 13), 4, 'soft -> search');
  assert.equal(nextPickStep(2, 16), 'review', 'full after question 2: skip soft skills and the search');
  assert.equal(nextPickStep(3, 16), 'review', 'full after question 3: skip the search');
  assert.equal(nextPickStep(1, 16), 'review');
  assert.equal(nextPickStep(4, 15), 4);
  assert.deepEqual(pickerSlots(['b', 'a']).slice(0, 3), ['b', 'a', null]);
  assert.equal(pickerSlots(ids(16)).length, 16);
  const ready = board({ state: 'READY', version: 2, selectedSkillIds: ids(16), cells: cells(ids(16)) });
  const s = joined({ board: ready });
  assert.equal(screenFor(s), 'board');
  assert.equal(screenFor({ ...s, ui: { ...s.ui, picking: true } }), 'select', 'server finalized at 16 while the player is still answering');
  assert.equal(REQUIRED_SELECTIONS, 16); assert.equal(PICK_STEPS, 4);
});
