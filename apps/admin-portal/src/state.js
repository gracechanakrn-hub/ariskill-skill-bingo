// Admin portal state: pure reducers and view-models (no DOM, no imports; tested with node:test).
// The server is authoritative: reducers only mirror what the admin projection / realtime events say.

export const TERMINAL_STATES = Object.freeze(['CLOSED', 'CANCELLED']);
export const POOL_MINIMUM = 5;
export const RESULT_WINDOW = Object.freeze({ min: 10, max: 15, default: 12 });

/** Allowed commands per round state (contracts/round-state-machine.json). */
export const COMMANDS_BY_STATE = Object.freeze({
  DRAFT: ['round.update', 'round.registration.open', 'round.cancel'],
  REGISTRATION_OPEN: ['round.reschedule', 'round.lock', 'round.start_now', 'round.cancel'],
  LOCKED: ['round.start', 'round.cancel'],
  PLAYING: ['round.draw.next', 'round.cancel'],
  WINNER: [],
  EXHAUSTED: ['round.close', 'round.cancel'],
  CLOSED: [],
  CANCELLED: [],
});

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
    loaded: false,
  };
}

function emptyCounts() { return { joined: 0, completed: 0, incomplete: 0, active: 0, deferred: 0, matchedBoards: 0, connections: 0 }; }

function emptyReadiness() {
  return { poolSize: 0, poolMinimum: POOL_MINIMUM, anyBoardCanWin: false, boardsThatCanWin: 0, startOverdue: false, lockCountdownMs: null };
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
      if (p.startOverdue !== undefined && cur && cur.summary.roundId === (p.round?.roundId ?? envelope.roundId)) {
        extra.readiness = { ...cur.readiness, startOverdue: !!p.startOverdue };
      }
      return p.round ? withSummary(state, p.round, extra) : state;
    }
    case 'round.registration_opened':
      return p.round ? withSummary(state, p.round) : state;
    case 'round.locked': {
      if (!p.round) return state;
      const extra = {};
      if (cur && cur.summary.roundId === p.round.roundId) {
        extra.counts = { ...cur.counts, active: p.activeBoards ?? cur.counts.active, deferred: p.deferredBoards ?? cur.counts.deferred };
        extra.readiness = { ...cur.readiness, lockCountdownMs: null };
      }
      return withSummary(state, p.round, extra);
    }
    case 'round.started': {
      if (!p.round) return state;
      const extra = {};
      if (cur && cur.summary.roundId === p.round.roundId) {
        extra.readiness = { ...cur.readiness, poolSize: p.poolSize ?? cur.readiness.poolSize, startOverdue: false, lockCountdownMs: null };
        extra.poolRemaining = p.poolSize ?? cur.poolRemaining;
      }
      return withSummary(state, p.round, extra);
    }
    case 'round.cancelled':
    case 'round.exhausted':
    case 'round.closed':
      return p.round ? withSummary(state, p.round) : state;
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
 * roundViewModel(state) -> what the Mission Control round panel needs to render.
 * Start readiness comes from the server (readiness.poolSize / anyBoardCanWin); the client only displays it.
 */
export function roundViewModel(state) {
  const cur = state.currentRound;
  if (!cur) return { phase: 'none', summary: null, controls: {}, canCreateNext: true };
  const s = cur.summary.state;
  const readiness = cur.readiness || emptyReadiness();
  const poolTooSmall = (readiness.poolSize ?? 0) < (readiness.poolMinimum ?? POOL_MINIMUM);
  const controls = {
    edit: s === 'DRAFT',
    openRegistration: s === 'DRAFT',
    lockNow: s === 'REGISTRATION_OPEN',
    startNow: s === 'REGISTRATION_OPEN',
    reschedule: s === 'REGISTRATION_OPEN',
    start: s === 'LOCKED',
    startEnabled: s === 'LOCKED' && !poolTooSmall,
    nextSkill: s === 'PLAYING',
    close: s === 'EXHAUSTED',
    cancel: isCommandAllowed(s, 'round.cancel'),
    createNext: TERMINAL_STATES.includes(s),
  };
  // Irreversible actions always go through a confirmation dialog (A-01 / UX-03); reschedule is the safe default.
  const confirmRequired = { lockNow: true, startNow: true, cancel: true, reschedule: false, start: false, nextSkill: false, close: false };
  return {
    phase: s,
    summary: cur.summary,
    readiness,
    poolTooSmall,
    startBlockedException: s === 'LOCKED' && poolTooSmall ? 'E20' : null,
    showJoin: s === 'REGISTRATION_OPEN',
    showLockCountdown: s === 'REGISTRATION_OPEN' && !!cur.summary.lockAt,
    showReadiness: s === 'LOCKED' || s === 'REGISTRATION_OPEN',
    startOverdue: s === 'LOCKED' && !!readiness.startOverdue,
    draws: drawsNewestFirst(cur.draws),
    poolRemaining: cur.poolRemaining,
    winners: cur.winners || [],
    exhaustedException: s === 'EXHAUSTED' ? 'E23' : null,
    controls,
    confirmRequired,
    canCreateNext: controls.createNext,
  };
}

/** Round state -> pill modifier class; text is always shown next to the colour. */
export function statePill(roundState) {
  switch (roundState) {
    case 'REGISTRATION_OPEN': return 'pill--open';
    case 'PLAYING': return 'pill--live';
    case 'WINNER': return 'pill--success';
    case 'LOCKED': case 'EXHAUSTED': return 'pill--warning';
    case 'CANCELLED': return 'pill--danger';
    case 'CLOSED': return 'pill--closed';
    default: return 'pill--info';
  }
}

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
