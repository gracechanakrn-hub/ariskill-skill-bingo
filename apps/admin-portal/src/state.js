// Admin portal state: pure reducers and view-models (no DOM, no imports; tested with node:test).
// The server is authoritative: reducers only mirror what the admin projection / realtime events say.

export const TERMINAL_STATES = Object.freeze(['CLOSED', 'CANCELLED']);
export const POOL_MINIMUM = 5;
export const RESULT_WINDOW = Object.freeze({ min: 10, max: 15, default: 12 });

/** Allowed commands per round state (contracts/round-state-machine.json v2, D-53). Delete is a separate endpoint (any state). */
export const COMMANDS_BY_STATE = Object.freeze({
  DRAFT: ['round.update', 'round.registration.open', 'round.cancel'],
  REGISTRATION_OPEN: ['round.reschedule', 'round.start_now', 'round.cancel'],
  PLAYING: ['round.draw.next', 'round.cancel'],
  WINNER: [],
  CLOSED: [],
  CANCELLED: [],
});

/** D-53: the five statuses the admin sees. WINNER (the 12 s Bingo celebration) and CLOSED both read "Finished". */
export const STATUS = Object.freeze({
  DRAFT: { label: 'Draft', step: 0, pill: 'pill--info' },
  REGISTRATION_OPEN: { label: 'Registration open', step: 1, pill: 'pill--open' },
  PLAYING: { label: 'Playing', step: 2, pill: 'pill--live' },
  WINNER: { label: 'Finished', step: 3, pill: 'pill--success' },
  CLOSED: { label: 'Finished', step: 3, pill: 'pill--success' },
  CANCELLED: { label: 'Cancelled', step: -1, pill: 'pill--danger' },
});
export const STEPS = Object.freeze(['Draft', 'Registration open', 'Playing', 'Finished']);
export const START_IN_CHOICES = Object.freeze([5, 10, 15, 30]);
export const EXTEND_CHOICES = Object.freeze([1, 3, 5, 10, 15]);
/** Unfinished-boards alert: more than `over` players unfinished within the last `windowMs` before the start time. */
export const UNFINISHED_ALERT = Object.freeze({ over: 3, windowMs: 2 * 60 * 1000 });

export function statusOf(roundState) { return STATUS[roundState] || { label: String(roundState || ''), step: -1, pill: 'pill--info' }; }

/** Default name for the next round: "Round N" where N is one past the highest number so far. */
export function defaultRoundTitle(rounds) {
  const max = (rounds || []).reduce((m, r) => Math.max(m, Number(r.number) || 0), 0);
  return `Round ${max + 1}`;
}

export function isCommandAllowed(roundState, command) {
  return (COMMANDS_BY_STATE[roundState] || []).includes(command);
}

export function initialState() {
  return {
    sequence: -1,
    eventId: null,
    eventName: null,
    rounds: [],
    currentRound: null,
    join: null,
    connections: { public: 0, stage: 0, participants: 0, admin: 0 },
    resultWindowEndsAt: null,
    bingo: null,
    boardsWithFourInLine: null,
    canClearData: false,
    testMode: false,
    testModeLocked: false,
    loaded: false,
  };
}

function emptyCounts() { return { joined: 0, completed: 0, incomplete: 0, active: 0, deferred: 0, matchedBoards: 0, connections: 0 }; }

function emptyReadiness() {
  return { poolSize: 0, poolMinimum: POOL_MINIMUM, anyBoardCanWin: false, boardsThatCanWin: 0, startOverdue: false, lockCountdownMs: null, startBlocked: false, unfinishedBoards: 0 };
}

/** Build a currentRound block from a bare RoundSummary (used when an event introduces a new round before the snapshot arrives). */
export function currentRoundFromSummary(summary) {
  return {
    summary,
    readiness: emptyReadiness(),
    counts: emptyCounts(),
    draws: [],
    poolRemaining: null,
    winners: [],
    lastCommand: null,
    pacingHintSeconds: [5, 8],
  };
}

/** Normalise an admin snapshot into a state patch. Snapshot always wins; unknown extras are ignored. */
export function normaliseSnapshot(snapshot, prev = initialState()) {
  if (!snapshot || typeof snapshot !== 'object') return prev;
  const cur = snapshot.currentRound ? {
    summary: snapshot.currentRound.summary,
    readiness: { ...emptyReadiness(), ...(snapshot.currentRound.readiness || {}) },
    counts: { ...emptyCounts(), ...(snapshot.currentRound.counts || {}) },
    draws: Array.isArray(snapshot.currentRound.draws) ? snapshot.currentRound.draws.slice() : [],
    poolRemaining: snapshot.currentRound.poolRemaining ?? null,
    winners: Array.isArray(snapshot.currentRound.winners) ? snapshot.currentRound.winners.slice() : [],
    lastCommand: snapshot.currentRound.lastCommand ?? null,
    pacingHintSeconds: snapshot.currentRound.pacingHintSeconds || [5, 8],
  } : null;
  const sameRound = cur && prev.currentRound && prev.currentRound.summary.roundId === cur.summary.roundId;
  return {
    ...prev,
    eventId: snapshot.eventId ?? prev.eventId,
    eventName: snapshot.eventName ?? prev.eventName,
    rounds: Array.isArray(snapshot.rounds) ? snapshot.rounds.slice() : prev.rounds,
    currentRound: cur,
    join: snapshot.join ?? null,
    connections: snapshot.connections || prev.connections,
    canClearData: snapshot.canClearData === true,
    testMode: snapshot.testMode === true,
    testModeLocked: snapshot.testModeLocked === true,
    resultWindowEndsAt: sameRound && cur.summary.state === 'WINNER' ? prev.resultWindowEndsAt : null,
    bingo: sameRound ? prev.bingo : null,
    boardsWithFourInLine: sameRound ? prev.boardsWithFourInLine : null,
    loaded: true,
  };
}

/** Replace (or insert) a round summary in a list, keeping the list sorted by number. */
export function upsertRound(rounds, summary) {
  if (!summary || !summary.roundId) return rounds;
  const next = rounds.filter((r) => r.roundId !== summary.roundId);
  const existing = rounds.find((r) => r.roundId === summary.roundId);
  next.push({ ...(existing || {}), ...summary });
  next.sort((a, b) => (a.number || 0) - (b.number || 0));
  return next;
}

function withSummary(state, summary, extra = {}) {
  const rounds = upsertRound(state.rounds, summary);
  let currentRound = state.currentRound;
  const isCurrent = currentRound && currentRound.summary.roundId === summary.roundId;
  const currentTerminal = !currentRound || TERMINAL_STATES.includes(currentRound.summary.state);
  if (isCurrent) currentRound = { ...currentRound, summary: { ...currentRound.summary, ...summary }, ...extra };
  else if (currentTerminal || (currentRound.summary.number || 0) < (summary.number || 0)) currentRound = { ...currentRoundFromSummary(summary), ...extra };
  return { ...state, rounds, currentRound };
}

/**
 * reduceEvent(state, envelope) -> next state. Applies only the fields present in the admin projection.
 * Ordering/sequence is enforced by the shared store (applyEvent); this reducer trusts the caller.
 */
export function reduceEvent(state, envelope) {
  if (!envelope || typeof envelope !== 'object') return state;
  const p = envelope.payload || {};
  const cur = state.currentRound;
  const forCurrent = cur && (envelope.roundId == null || cur.summary.roundId === envelope.roundId);
  switch (envelope.type) {
    case 'round.created': {
      const next = withSummary(state, p.round);
      return { ...next, bingo: null, resultWindowEndsAt: null, boardsWithFourInLine: null };
    }
    case 'round.updated': {
      const extra = {};
      if (p.startBlocked !== undefined && cur && cur.summary.roundId === (p.round?.roundId ?? envelope.roundId)) {
        extra.readiness = { ...cur.readiness, startBlocked: !!p.startBlocked };
      }
      return p.round ? withSummary(state, p.round, extra) : state;
    }
    case 'round.registration_opened':
      return p.round ? withSummary(state, p.round) : state;
    case 'round.started': {
      if (!p.round) return state;
      const extra = {};
      if (cur && cur.summary.roundId === p.round.roundId) {
        extra.readiness = { ...cur.readiness, poolSize: p.poolSize ?? cur.readiness.poolSize, startBlocked: false, unfinishedBoards: 0, lockCountdownMs: null };
        extra.counts = { ...cur.counts, active: p.activeBoards ?? cur.counts.active, deferred: p.deferredBoards ?? cur.counts.deferred };
        extra.poolRemaining = p.poolSize ?? cur.poolRemaining;
      }
      return withSummary(state, p.round, extra);
    }
    case 'round.cancelled':
    case 'round.closed':
      return p.round ? withSummary(state, p.round) : state;
    case 'round.deleted': {
      // D-53: the round and everything in it are gone; the snapshot that follows picks the new current round
      const id = p.roundId ?? envelope.roundId;
      const rounds = state.rounds.filter((r) => r.roundId !== id);
      const gone = cur && cur.summary.roundId === id;
      return { ...state, rounds, currentRound: gone ? null : cur, ...(gone ? { bingo: null, resultWindowEndsAt: null, boardsWithFourInLine: null } : {}) };
    }
    case 'event.updated': // D-56 test mode switched
      if (typeof p.testMode !== 'boolean') return state;
      return { ...state, testMode: p.testMode, canClearData: p.testMode && !state.testModeLocked };
    case 'event.reset':
      return { ...state, rounds: [], currentRound: null, bingo: null, resultWindowEndsAt: null, boardsWithFourInLine: null };
    case 'draw.accepted': {
      if (!forCurrent || !p.draw) return state;
      const draws = cur.draws.filter((d) => d.number !== p.draw.number);
      draws.push({ ...p.draw, matchedBoards: p.matchedBoards ?? 0 });
      draws.sort((a, b) => a.number - b.number);
      return { ...state, currentRound: { ...cur, draws, poolRemaining: p.poolRemaining ?? cur.poolRemaining } };
    }
    case 'draw.match_counts_updated': {
      if (!forCurrent) return state;
      const draws = cur.draws.map((d) => (d.number === p.drawNumber ? { ...d, matchedBoards: p.matchedBoards ?? d.matchedBoards } : d));
      return { ...state, currentRound: { ...cur, draws }, boardsWithFourInLine: p.boardsWithFourInLine ?? state.boardsWithFourInLine };
    }
    case 'bingo.detected':
      if (!forCurrent) return state;
      return { ...state, bingo: { drawNumber: p.drawNumber, winnerCount: p.winnerCount, roundId: cur.summary.roundId } };
    case 'result.published': {
      const extra = {};
      if (cur && p.round && cur.summary.roundId === p.round.roundId && Array.isArray(p.winners)) extra.winners = p.winners.slice();
      const next = p.round ? withSummary(state, p.round, extra) : state;
      return { ...next, resultWindowEndsAt: p.resultWindowEndsAt ?? next.resultWindowEndsAt };
    }
    case 'participation.updated':
      if (!cur || !p.counts) return state;
      return { ...state, currentRound: { ...cur, counts: { ...cur.counts, ...p.counts } } };
    default:
      return state;
  }
}

/** Draws newest first for the Mission Control list. */
export function drawsNewestFirst(draws) {
  return (draws || []).slice().sort((a, b) => (b.number || 0) - (a.number || 0));
}

/** Convert a datetime-local input value (local wall time) into ISO-8601 UTC; null when empty/invalid. */
export function localDateTimeToIso(value) {
  if (!value || typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Format an ISO timestamp as a datetime-local input value in the local time zone. */
export function isoToLocalDateTime(iso, tzOffsetMinutes = new Date(iso || Date.now()).getTimezoneOffset()) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const local = new Date(ms - tzOffsetMinutes * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

export function clampResultWindow(n) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v)) return RESULT_WINDOW.default;
  return Math.min(RESULT_WINDOW.max, Math.max(RESULT_WINDOW.min, v));
}

/**
 * roundViewModel(state, now) -> what the Mission Control round panel needs to render (D-53).
 * Start readiness comes from the server (readiness.*); the client only displays it. `now` is the synced server clock.
 */
export function roundViewModel(state, now = Date.now()) {
  const cur = state.currentRound;
  if (!cur) return { phase: 'none', summary: null, controls: {}, canCreateNext: true };
  const s = cur.summary.state;
  const readiness = cur.readiness || emptyReadiness();
  const status = statusOf(s);
  const msToStart = s === 'REGISTRATION_OPEN' && cur.summary.lockAt ? Date.parse(cur.summary.lockAt) - now : null;
  const unfinished = Number(readiness.unfinishedBoards) || 0;
  const controls = {
    edit: s === 'DRAFT',
    openRegistration: s === 'DRAFT',
    startNow: s === 'REGISTRATION_OPEN',
    extend: s === 'REGISTRATION_OPEN',
    nextSkill: s === 'PLAYING',
    cancel: isCommandAllowed(s, 'round.cancel'),
    delete: true,
    createNext: TERMINAL_STATES.includes(s),
  };
  return {
    phase: s,
    status,
    summary: cur.summary,
    readiness,
    msToStart,
    startBlocked: s === 'REGISTRATION_OPEN' && !!readiness.startBlocked,
    unfinished,
    unfinishedAlert: s === 'REGISTRATION_OPEN' && !readiness.startBlocked && unfinished > UNFINISHED_ALERT.over && msToStart !== null && msToStart <= UNFINISHED_ALERT.windowMs,
    showJoin: s === 'REGISTRATION_OPEN',
    draws: drawsNewestFirst(cur.draws),
    poolRemaining: cur.poolRemaining,
    winners: cur.winners || [],
    controls,
    canCreateNext: controls.createNext,
  };
}

/** Round state -> pill modifier class; the plain status text is always shown next to the colour. */
export function statePill(roundState) { return statusOf(roundState).pill; }

/** SSE status -> pill modifier + whether the UI should show the reconnect banner. */
export function connectionView(status) {
  switch (status) {
    case 'open': return { pill: 'pill--open', reconnecting: false };
    case 'reconnecting': case 'connecting': return { pill: 'pill--reconnecting', reconnecting: status === 'reconnecting' };
    case 'closed': return { pill: 'pill--closed', reconnecting: false };
    default: return { pill: 'pill--info', reconnecting: false };
  }
}

/** Audit entries newest first, optionally filtered by round. */
export function filterAudit(entries, roundId) {
  const list = (entries || []).filter((e) => !roundId || e.roundId === roundId);
  return list.slice().sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
}

/** Percentages for the Core/Critical density bars (integers summing to <= 100). */
export function densityBars(density) {
  const d = density || {};
  const total = Number(d.totalSelections) || 0;
  const pct = (n) => (total ? Math.round(((Number(n) || 0) / total) * 100) : 0);
  return { core: pct(d.core), critical: pct(d.critical), optional: pct(d.optional), total };
}
