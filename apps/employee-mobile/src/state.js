// apps/employee-mobile/src/state.js - pure state, reducers and view-model selectors for /play.
// No DOM, no imports: this module is unit-tested under node:test (apps/employee-mobile/test).
//
// Rules implemented here (requirements BR-05, BR-11, 7.3, 11; contracts/realtime-events.json clientRules):
//   - every screen is a projection of the server state (snapshot + events); the client never computes matches,
//     winners or lock/start transitions;
//   - reducers return the next state and a list of `effects` (one-shot celebrations the view MAY play, gated
//     by the celebration guard in main.js);
//   - the local draft (25-skill selection) is the only client-owned state and is reconciled against the server set.

export const REQUIRED_SELECTIONS = 25;
export const BINGO_UNLOCK_DRAW = 5;
export const EDITABLE_ROUND_STATES = ['DRAFT', 'REGISTRATION_OPEN'];
export const IN_PROGRESS_ROUND_STATES = ['LOCKED', 'PLAYING'];
export const RESULT_ROUND_STATES = ['WINNER', 'EXHAUSTED', 'CLOSED'];

export function initialState() {
  return {
    sequence: -1,
    session: null,          // { sessionToken, participantId, eventId, expiresAt }
    joinToken: null,
    joinError: null,        // exception id (E2) when the token/session was rejected
    participant: null,
    event: null,
    round: null,
    nextRound: null,
    board: null,
    draws: [],
    result: null,
    soul: null,
    insightAvailable: false,
    insight: null,          // { roundId, inMatrixCount, beyondMatrixCount, totalSelected }
    bingo: null,            // { drawNumber, winnerCount } from bingo.detected
    bingoEvaluationActive: false,
    resultWindowEndsAt: null,
    connection: 'idle',     // idle | connecting | open | reconnecting | closed
    clockSynced: false,
    ui: {
      draft: [],            // local selection (skill ids, in tap order)
      undo: null,           // previous draft for one-level undo
      draftDirty: false,    // local changes not yet confirmed by the server
      draftRoundId: null,   // round the draft belongs to
      editing: false,       // "Edit skills" on a READY board
      saveError: null,      // exception id of the last failed save (E6)
      saveNotice: null,     // server notice text for a save that was parked (older backend ROUND_LOCKED E8/E1)
      finalizeError: null,  // E18
      floatError: null,     // E13
      resultSeen: false,    // "Reveal Soul" pressed
      soulRevealed: false,  // staged reveal completed or skipped
      floating: false,      // countdown running
      floatDigit: null,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Snapshot / events
// ---------------------------------------------------------------------------------------------

/** Merge a /me snapshot. The snapshot always wins; local draft is reconciled by reconcileDraft(). */
export function applyParticipantSnapshot(state, snap) {
  if (!snap || typeof snap !== 'object') return state;
  const board = snap.board ?? null;
  const roundChanged = board && state.board && board.roundId !== state.board.roundId;
  const next = {
    ...state,
    sequence: Number.isFinite(Number(snap.sequence)) ? Number(snap.sequence) : state.sequence,
    participant: snap.participant ?? state.participant,
    event: snap.event ?? state.event,
    round: snap.round ?? null,
    nextRound: snap.nextRound ?? null,
    board: board ? withDeferredReason(board, state, snap.round) : null,
    draws: Array.isArray(snap.draws) ? snap.draws.slice() : [],
    result: snap.result ?? null,
    soul: snap.soul ?? null,
    insightAvailable: !!snap.insightAvailable,
    bingoEvaluationActive: Array.isArray(snap.draws) ? snap.draws.length >= BINGO_UNLOCK_DRAW : false,
  };
  if (roundChanged) { next.bingo = null; next.insight = null; next.ui = { ...next.ui, resultSeen: false, soulRevealed: false }; }
  if (next.insight && next.result && next.insight.roundId && next.board && next.insight.roundId !== next.board.roundId) next.insight = null;
  return reconcileDraft(next);
}

function withDeferredReason(board, state, round) {
  if (board.state !== 'DEFERRED') return board;
  const prev = state.board && state.board.boardId === board.boardId ? state.board.deferredReason : null;
  const reason = prev || (round && round.state === 'CANCELLED' ? 'cancelled' : 'incomplete');
  return { ...board, deferredReason: reason };
}

/**
 * reduceEvent(state, envelope) -> { state, effects }
 * effects: [{ type: 'board.ready' | 'lock' | 'draw' | 'bingo' | 'result' | 'soul' | 'float' | 'deferred', key, ... }]
 * The caller applies `state` first, then asks the celebration guard whether each effect may animate.
 */
export function reduceEvent(state, envelope) {
  if (!envelope || typeof envelope !== 'object') return { state, effects: [] };
  const p = envelope.payload || {};
  const effects = [];
  let next = state;
  switch (envelope.type) {
    case 'round.created':
    case 'round.updated':
    case 'round.registration_opened':
    case 'round.locked':
    case 'round.started':
    case 'round.cancelled':
    case 'round.exhausted':
    case 'round.closed': {
      if (!p.round) break;
      next = placeRound(state, p.round);
      if (envelope.type === 'round.locked' && next.board && next.board.roundId === p.round.roundId && next.board.state === 'LOCKED_ACTIVE') {
        effects.push({ type: 'lock', key: `lock:${p.round.roundId}` });
      }
      if (envelope.type === 'round.cancelled' && next.board && next.board.roundId === p.round.roundId && next.board.state !== 'FINISHED') {
        next = { ...next, board: { ...next.board, deferredReason: 'cancelled' } };
      }
      break;
    }
    case 'board.saved': {
      if (!p.board) break;
      next = placeBoard(state, p.board);
      next = reconcileDraft(next);
      break;
    }
    case 'board.ready': {
      if (!p.board) break;
      next = reconcileDraft(placeBoard(state, p.board));
      next = { ...next, ui: { ...next.ui, editing: false } };
      effects.push({ type: 'board.ready', key: `board.ready:${p.board.boardId}:${p.board.version}` });
      break;
    }
    case 'board.locked_active': {
      if (!p.board) break;
      next = placeBoard(state, p.board);
      effects.push({ type: 'lock', key: `lock:${p.board.roundId}` });
      break;
    }
    case 'board.deferred': {
      if (!p.board) break;
      next = placeBoard(state, { ...p.board, deferredReason: p.reason || 'incomplete' });
      effects.push({ type: 'deferred', key: `deferred:${p.board.boardId}:${p.board.version}`, reason: p.reason || 'incomplete' });
      break;
    }
    case 'draw.accepted': {
      const draw = p.draw;
      if (!draw) break;
      if (state.draws.some((d) => d.drawId === draw.drawId)) break;
      const draws = [...state.draws, draw].sort((a, b) => a.number - b.number);
      const before = state.board ? (state.board.matchedPositions || []) : [];
      const mine = Array.isArray(p.myMatchedPositions) ? p.myMatchedPositions.slice() : before;
      const board = state.board ? { ...state.board, matchedPositions: mine } : state.board;
      const newPositions = mine.filter((pos) => !before.includes(pos));
      next = { ...state, draws, board, bingoEvaluationActive: !!p.bingoEvaluationActive || draw.number >= BINGO_UNLOCK_DRAW };
      effects.push({ type: 'draw', key: `draw:${draw.drawId}`, draw, newPositions, matchedCount: mine.length, unlocksBingo: draw.number === BINGO_UNLOCK_DRAW });
      break;
    }
    case 'bingo.detected': {
      next = { ...state, bingo: { drawNumber: p.drawNumber, winnerCount: p.winnerCount } };
      effects.push({ type: 'bingo', key: `bingo:${envelope.roundId}:${p.drawNumber}`, drawNumber: p.drawNumber });
      break;
    }
    case 'result.published': {
      const round = p.round ? placeRound(state, p.round) : state;
      const mine = p.myResult || { isWinner: false, lineIds: [] };
      const winningDrawNumber = (state.bingo && state.bingo.drawNumber) || (state.draws.length ? state.draws[state.draws.length - 1].number : null);
      const result = {
        isWinner: !!mine.isWinner,
        lineIds: Array.isArray(mine.lineIds) ? mine.lineIds.slice() : [],
        winningDrawNumber: mine.isWinner ? winningDrawNumber : (Array.isArray(p.winners) && p.winners.length ? winningDrawNumber : null),
        coWinnerCount: Array.isArray(p.winners) ? p.winners.length : 0,
      };
      const board = round.board && round.board.roundId === (envelope.roundId || (p.round && p.round.roundId)) && round.board.state === 'LOCKED_ACTIVE'
        ? { ...round.board, state: 'FINISHED' } : round.board;
      next = { ...round, result, board, resultWindowEndsAt: p.resultWindowEndsAt || null, insightAvailable: board ? board.state === 'FINISHED' : state.insightAvailable };
      effects.push({ type: 'result', key: `result:${envelope.roundId}`, isWinner: result.isWinner, lineIds: result.lineIds });
      break;
    }
    case 'soul.created': {
      if (!p.soul) break;
      next = { ...state, soul: p.soul, ui: { ...state.ui, soulRevealed: false } };
      effects.push({ type: 'soul', key: `soul:${p.soul.soulId}` });
      break;
    }
    case 'soul.float_accepted': {
      const e = p.entrance;
      if (!e || !state.soul || e.soulId !== state.soul.soulId) break;
      next = { ...state, soul: { ...state.soul, floated: true, floatToken: null }, ui: { ...state.ui, floating: false, floatDigit: null } };
      effects.push({ type: 'float', key: `float:${e.soulId}`, entrance: e });
      break;
    }
    default:
      break;
  }
  return { state: next, effects };
}

/** Place a RoundSummary as `round` or `nextRound` following the snapshot semantics of /me. */
export function placeRound(state, round) {
  if (!round) return state;
  if (state.round && state.round.roundId === round.roundId) return { ...state, round };
  if (state.nextRound && state.nextRound.roundId === round.roundId) return { ...state, nextRound: round };
  if (!state.board || !state.round) return { ...state, round };
  // A different round while our board is attached to another one: it is the upcoming round.
  return { ...state, nextRound: round };
}

/** Place a ParticipantBoard; when it belongs to a different round than the current one, the attached round moves too. */
export function placeBoard(state, board) {
  if (!board) return state;
  const sameRound = state.board && state.board.roundId === board.roundId;
  const merged = board.state === 'DEFERRED' ? { ...board, deferredReason: board.deferredReason || (sameRound && state.board.deferredReason) || 'incomplete' } : board;
  if (sameRound || !state.board) {
    const carry = state.board && state.board.boardId === board.boardId && !Array.isArray(board.matchedPositions) ? { matchedPositions: state.board.matchedPositions } : {};
    return { ...state, board: { ...merged, ...carry } };
  }
  const next = { ...state, board: merged, draws: [], result: null, soul: null, insight: null, bingo: null, bingoEvaluationActive: false, resultWindowEndsAt: null, insightAvailable: false };
  if (state.nextRound && state.nextRound.roundId === board.roundId) { next.round = state.nextRound; next.nextRound = null; }
  next.ui = { ...state.ui, resultSeen: false, soulRevealed: false, editing: false, draftRoundId: board.roundId };
  return next;
}

// ---------------------------------------------------------------------------------------------
// Local draft (selection) helpers - pure
// ---------------------------------------------------------------------------------------------

/** After the server confirms a set, drop the dirty flag when the sets match; otherwise keep the local draft to re-PUT. */
export function reconcileDraft(state) {
  const server = state.board && Array.isArray(state.board.selectedSkillIds) ? state.board.selectedSkillIds : null;
  const ui = state.ui;
  if (!server) {
    if (ui.draftRoundId && state.round && ui.draftRoundId === state.round.roundId) return state;
    return state;
  }
  if (!ui.draftDirty || sameSet(ui.draft, server)) {
    return { ...state, ui: { ...ui, draft: server.slice(), draftDirty: false, draftRoundId: state.board.roundId, saveError: null } };
  }
  return state; // local changes pending: main.js re-PUTs and the response/event reconciles
}

export function sameSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** Tap a skill: adds it to the next slot. Duplicate tap is a no-op ({ changed: false, reason: 'duplicate' }). */
export function addSkill(state, skillId) {
  const draft = state.ui.draft;
  if (!skillId) return { state, changed: false, reason: 'invalid' };
  if (draft.includes(skillId)) return { state, changed: false, reason: 'duplicate' };
  if (draft.length >= REQUIRED_SELECTIONS) return { state, changed: false, reason: 'full' };
  const next = [...draft, skillId];
  return { state: { ...state, ui: { ...state.ui, draft: next, undo: draft.slice(), draftDirty: true } }, changed: true, count: next.length };
}

export function removeSkill(state, skillId) {
  const draft = state.ui.draft;
  if (!draft.includes(skillId)) return { state, changed: false, reason: 'missing' };
  const next = draft.filter((id) => id !== skillId);
  return { state: { ...state, ui: { ...state.ui, draft: next, undo: draft.slice(), draftDirty: true } }, changed: true, count: next.length };
}

/** One-level undo: restores the draft as it was before the last add/remove. */
export function undoSelection(state) {
  const prev = state.ui.undo;
  if (!Array.isArray(prev)) return { state, changed: false };
  return { state: { ...state, ui: { ...state.ui, draft: prev.slice(), undo: null, draftDirty: true } }, changed: true, count: prev.length };
}

// ---------------------------------------------------------------------------------------------
// View-model selectors
// ---------------------------------------------------------------------------------------------

/** Kind label from a discovery / cell / draw skill: Core | Critical | Optional (icon + label carried by the view). */
export function kindOf(skill) {
  if (!skill) return 'Optional';
  if (skill.kind === 'Core' || skill.kind === 'Critical' || skill.kind === 'Optional') return skill.kind;
  if (skill.isCore) return 'Core';
  if (skill.isCritical) return 'Critical';
  return 'Optional';
}

/** The round that currently accepts saves for this participant (display only; the server is the judge). */
export function editableRound(state, nowMs = null) {
  const candidates = [state.round, state.nextRound].filter(Boolean);
  for (const r of candidates) {
    if (!EDITABLE_ROUND_STATES.includes(r.state)) continue;
    if (nowMs !== null && r.lockAt && Date.parse(r.lockAt) <= nowMs) continue;
    return r;
  }
  return null;
}

/**
 * Why the selection cannot be saved right now: null | 'E1' (no round) | 'E8' (this participant already holds a board
 * in a round that is in progress) | 'E15' (cancelled). A participant WITHOUT a board may still save while the round is
 * LOCKED/PLAYING: the server stores the draft as a DEFERRED (late) board for the next round (F-01, BR-06).
 */
export function saveBlockedReason(state, nowMs = null) {
  if (editableRound(state, nowMs)) return null;
  const r = state.round;
  if (!r) return 'E1';
  if (IN_PROGRESS_ROUND_STATES.includes(r.state) || r.state === 'WINNER' || r.state === 'EXHAUSTED') {
    return state.board && state.board.roundId === r.roundId ? 'E8' : null; // no board yet: the server parks a late draft
  }
  if (r.state === 'CANCELLED') return 'E15';
  return 'E1';
}

/**
 * Applies a PUT /me/board/selections (or finalize) response. A DEFERRED board returned with a `notice` (E8 copy) is a
 * late save: the server parked the draft for the next round (reason 'late'). Returns { state, notice, late }.
 */
export function applySaveResponse(state, res) {
  if (!res || !res.board) return { state, notice: null, late: false };
  const board = res.board;
  const late = board.state === 'DEFERRED' && (board.deferredReason === 'late' || board.reason === 'late' || !!res.notice);
  const shaped = board.state === 'DEFERRED' ? { ...board, deferredReason: late ? 'late' : (board.deferredReason || board.reason || 'incomplete') } : board;
  const placed = placeBoard(state, shaped);
  const next = reconcileDraft(placed);
  return { state: next, notice: typeof res.notice === 'string' ? res.notice : (res.notice && res.notice.text) || null, late };
}

/**
 * The round this participant can build a board for next, independent of Float / Soul state (UX-01, M-13):
 * `nextRound` when it accepts boards, or an editable round other than the one the current board belongs to.
 */
export function nextRoundAction(state, nowMs = null) {
  const editable = editableRound(state, nowMs);
  if (!editable) return null;
  if (state.board && state.board.roundId === editable.roundId) return null;
  if (state.ui.draftRoundId === editable.roundId && screenFor(state) === 'select') return null;
  return editable;
}

export const SCREENS = ['join', 'loading', 'profile', 'select', 'board', 'locked', 'deferred', 'playing', 'result', 'soul', 'floated'];

/** Which screen (canonical-flow section 1) the state projects to. */
export function screenFor(state) {
  if (!state.session) return 'join';
  if (!state.participant) return 'loading';
  if (!state.participant.platformId || !state.participant.roleId) return 'profile';
  const b = state.board;
  const r = state.round;
  if (!b) return 'select';
  if (b.state === 'DRAFT') return 'select';
  if (b.state === 'READY') return state.ui.editing ? 'select' : 'board';
  if (b.state === 'DEFERRED') return 'deferred';
  if (b.state === 'LOCKED_ACTIVE') return r && r.state === 'PLAYING' ? 'playing' : 'locked';
  if (b.state === 'FINISHED') {
    if (state.ui.draftRoundId && state.nextRound && state.ui.draftRoundId === state.nextRound.roundId) return 'select';
    if (!state.ui.resultSeen) return 'result';
    if (!state.soul) return 'result';
    if (state.soul.floated) return 'floated';
    return 'soul';
  }
  return 'select';
}

/** Progress for the selection screen. */
export function selectionProgress(state) {
  const count = state.ui.draft.length;
  return { count, total: REQUIRED_SELECTIONS, percent: Math.round((count / REQUIRED_SELECTIONS) * 100), complete: count >= REQUIRED_SELECTIONS };
}

/** Banner key for the playing screen: 'play.drawsBeforeFiveN' for draws 1-4, 'play.evaluationActive' from draw 5. */
export function playingBannerKey(state) {
  const n = state.draws.length;
  if (state.bingoEvaluationActive || n >= BINGO_UNLOCK_DRAW) return 'play.evaluationActive';
  return 'play.drawsBeforeFiveN';
}

/** Copy keys for the deferred screen, by reason. */
export function deferredCopyKey(reason) {
  if (reason === 'late') return 'E8';
  if (reason === 'cancelled') return 'E15';
  return 'board.deferred';
}

/** Cells indexed by position 0..24 (null when the board has no cells yet). */
export function cellsByPosition(board) {
  if (!board || !Array.isArray(board.cells)) return null;
  const arr = new Array(25).fill(null);
  for (const c of board.cells) if (Number.isInteger(c.position) && c.position >= 0 && c.position < 25) arr[c.position] = c;
  return arr;
}

/** True when the server DRAFT board already holds 25 (e.g. reassigned deferred board) and the local draft agrees. */
export function shouldAutoFinalize(state) {
  const b = state.board;
  if (!b || b.state !== 'DRAFT') return false;
  if (!Array.isArray(b.selectedSkillIds) || b.selectedSkillIds.length !== REQUIRED_SELECTIONS) return false;
  if (state.ui.draftDirty) return false;
  return sameSet(state.ui.draft, b.selectedSkillIds);
}
