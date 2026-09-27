// Stage dashboard - view-model reducer (pure, Node-testable).
// Source of truth: the stage snapshot (contracts/projections/stage.json) and the stage-audience events in
// contracts/realtime-events.json. Everything here only reshapes server data for display: no winners, matches or
// timings are computed locally (requirement 7.3 / wave-2 non-negotiables).
import { PUBLIC_STATE_BY_ROUND, BINGO_UNLOCK_DRAW } from '../../../packages/contracts/index.js';

export const RECENT_LIMIT = 10;
export const STALE_AFTER_MS = 10_000;
export const LIVE_STATES = Object.freeze(['PLAYING', 'WINNER']);
export const TERMINAL_STATES = Object.freeze(['CLOSED', 'CANCELLED']);
const ROUND_EVENTS = new Set(['round.created', 'round.updated', 'round.registration_opened', 'round.locked', 'round.started', 'round.cancelled', 'round.exhausted', 'round.closed', 'result.published']);

export function emptyCounts() { return { joined: 0, completed: 0, incomplete: 0, active: 0, deferred: 0, matchedBoards: 0 }; }

export function initialState() {
  return {
    sequence: -1, eventId: null, eventName: '', serverTime: null, publicState: 'Waiting', notice: null,
    round: null, nextRound: null, counts: emptyCounts(), currentDraw: null, recentDraws: [], winners: [],
    resultTiming: { winningDrawNumber: null, publishedAt: null, resultWindowEndsAt: null },
    insights: null, galaxy: null, bingo: null, poolSize: null, roundsPlayed: 0,
  };
}

function withPublicState(state) {
  const rs = state.round?.state;
  return { ...state, publicState: rs ? (PUBLIC_STATE_BY_ROUND[rs] || 'Waiting') : 'Waiting' };
}

function sameRound(a, b) { return !!a && !!b && a.roundId === b.roundId; }

/** Decide where an incoming RoundSummary lands: current round, next round, or promoted to current. */
function placeRound(state, incoming, { startOverdue } = {}) {
  if (!incoming || !incoming.roundId) return state;
  const summary = { ...incoming, startOverdue: startOverdue === undefined ? (sameRound(state.round, incoming) ? !!state.round.startOverdue : false) : !!startOverdue };
  if (summary.state !== 'LOCKED') summary.startOverdue = false;
  if (sameRound(state.round, incoming)) return { ...state, round: { ...state.round, ...summary } };
  const current = state.round;
  const currentIsSettled = !current || TERMINAL_STATES.includes(current.state) || current.state === 'EXHAUSTED' || current.state === 'WINNER';
  const incomingIsActive = ['REGISTRATION_OPEN', 'LOCKED', 'PLAYING'].includes(summary.state);
  if (incomingIsActive && currentIsSettled) {
    // A new round became the live one: reset per-round data; a snapshot refresh reconciles the rest.
    return { ...state, round: summary, nextRound: sameRound(state.nextRound, incoming) ? null : state.nextRound, currentDraw: null, recentDraws: [], winners: [], bingo: null, poolSize: null,
      resultTiming: { winningDrawNumber: null, publishedAt: null, resultWindowEndsAt: null }, counts: { ...state.counts, active: 0, deferred: 0, matchedBoards: 0 }, notice: null };
  }
  if (!current && summary.state === 'DRAFT') return { ...state, nextRound: summary };
  if (sameRound(state.nextRound, incoming) || summary.state === 'DRAFT') return { ...state, nextRound: summary };
  return state;
}

/**
 * reduce(state, envelope) -> next state. Returns the same object when nothing changes.
 * Sequence bookkeeping is done by packages/ui/store.js applyEvent; this only maps payloads.
 */
export function reduce(state, envelope) {
  if (!envelope || typeof envelope !== 'object') return state;
  const { type, payload = {}, occurredAt = null } = envelope;
  const base = { ...state, serverTime: occurredAt || state.serverTime };
  let next = base;
  switch (type) {
    case 'round.created':
    case 'round.updated':
    case 'round.registration_opened':
      next = placeRound(base, payload.round, { startOverdue: payload.startOverdue === true ? true : undefined });
      if (type === 'round.registration_opened' && sameRound(next.round, payload.round)) next.notice = null;
      break;
    case 'round.locked':
      next = placeRound(base, payload.round, { startOverdue: false });
      next.counts = { ...next.counts, active: numOr(payload.activeBoards, next.counts.active), deferred: numOr(payload.deferredBoards, next.counts.deferred) };
      break;
    case 'round.started':
      next = placeRound(base, payload.round, { startOverdue: false });
      next.poolSize = numOr(payload.poolSize, next.poolSize);
      next.currentDraw = null; next.recentDraws = []; next.winners = []; next.bingo = null;
      next.counts = { ...next.counts, matchedBoards: 0 };
      break;
    case 'round.cancelled':
      next = placeRound(base, payload.round, { startOverdue: false });
      next.notice = { kind: 'cancelled', text: null, reason: payload.reason || payload.round?.cancellationReason || null };
      break;
    case 'round.exhausted':
      next = placeRound(base, payload.round, { startOverdue: false });
      next.notice = { kind: 'exhausted', text: null };
      break;
    case 'round.closed':
      next = placeRound(base, payload.round, { startOverdue: false });
      break;
    case 'participation.updated':
      next = { ...base, counts: { ...base.counts, ...pickCounts(payload.counts) } };
      break;
    case 'draw.accepted': {
      const d = payload.draw;
      if (!d || !d.skill) break;
      const entry = { number: d.number, skillName: d.skill.name, kind: d.skill.kind };
      const recent = [...base.recentDraws.filter(r => r.number !== d.number), entry].sort((a, b) => a.number - b.number).slice(-RECENT_LIMIT);
      next = {
        ...base,
        currentDraw: { number: d.number, skill: d.skill, drawnAt: d.drawnAt || occurredAt, poolRemaining: numOr(payload.poolRemaining, null), bingoEvaluationActive: payload.bingoEvaluationActive === true },
        recentDraws: recent,
        counts: { ...base.counts, matchedBoards: numOr(payload.matchedBoards, base.counts.matchedBoards) },
      };
      break;
    }
    case 'draw.match_counts_updated':
      next = { ...base, counts: { ...base.counts, matchedBoards: numOr(payload.matchedBoards, base.counts.matchedBoards) } };
      break;
    case 'bingo.detected':
      next = { ...base, bingo: { drawNumber: numOr(payload.drawNumber, null), winnerCount: numOr(payload.winnerCount, null), at: occurredAt } };
      break;
    case 'result.published': {
      next = placeRound(base, payload.round, { startOverdue: false });
      const winners = Array.isArray(payload.winners) ? payload.winners.map(w => ({ label: w.label ?? null, soulId: w.soulId ?? null, winningDrawNumber: numOr(w.winningDrawNumber, null) })) : next.winners;
      next.winners = winners;
      next.resultTiming = {
        winningDrawNumber: winners[0]?.winningDrawNumber ?? next.bingo?.drawNumber ?? next.resultTiming.winningDrawNumber ?? null,
        publishedAt: occurredAt || next.resultTiming.publishedAt,
        resultWindowEndsAt: payload.resultWindowEndsAt || next.resultTiming.resultWindowEndsAt,
      };
      break;
    }
    case 'soul.float_accepted': {
      const entrance = payload.entrance;
      if (!entrance || !entrance.soulId) break;
      const galaxy = base.galaxy || { souls: [], count: 0 };
      const souls = Array.isArray(galaxy.souls) ? galaxy.souls : [];
      if (souls.some(s => s.soulId === entrance.soulId)) break;
      next = { ...base, galaxy: { ...galaxy, souls: [...souls, { soulId: entrance.soulId }], count: numOr(galaxy.count, souls.length) + 1 } };
      break;
    }
    default:
      return state; // unknown / non-stage events: no change (serverTime untouched too)
  }
  return withPublicState(next);
}

export function isRoundEvent(type) { return ROUND_EVENTS.has(type); }

function numOr(v, fallback) { const n = Number(v); return v === null || v === undefined || !Number.isFinite(n) ? fallback : n; }
function pickCounts(c) {
  const out = {};
  if (!c || typeof c !== 'object') return out;
  for (const k of ['joined', 'completed', 'incomplete', 'active', 'deferred', 'matchedBoards']) if (c[k] !== undefined) out[k] = numOr(c[k], 0);
  return out;
}

/** Which tiles changed between two states (keys used by the view to apply .m-fade). */
export function changedTiles(prev, next) {
  const changed = new Set();
  if (!prev) return changed;
  for (const k of ['joined', 'completed', 'incomplete', 'active', 'deferred', 'matchedBoards']) if ((prev.counts?.[k] ?? 0) !== (next.counts?.[k] ?? 0)) changed.add(`count.${k}`);
  if ((prev.round?.state ?? null) !== (next.round?.state ?? null) || (prev.round?.roundId ?? null) !== (next.round?.roundId ?? null) || (prev.round?.startOverdue ?? false) !== (next.round?.startOverdue ?? false) || (prev.notice?.kind ?? null) !== (next.notice?.kind ?? null)) changed.add('status');
  if ((prev.currentDraw?.number ?? null) !== (next.currentDraw?.number ?? null)) { changed.add('draw'); changed.add('status'); }
  if (prev.winners !== next.winners && JSON.stringify(prev.winners) !== JSON.stringify(next.winners)) changed.add('winners');
  if (prev.insights !== next.insights && JSON.stringify(prev.insights) !== JSON.stringify(next.insights)) changed.add('insights');
  return changed;
}

/** Layout focus mapped from the round state (requirement 7.3): draws/winners during PLAYING/WINNER, insights otherwise. */
export function layoutFor(state) {
  return state.round && LIVE_STATES.includes(state.round.state) ? 'live' : 'insights';
}

/**
 * deriveView(state, { nowMs }) -> data-only view model. Copy keys are resolved by the view; this only chooses
 * which hero to show and reorders lists for display (newest draw first).
 */
export function deriveView(state, { nowMs = Date.now() } = {}) {
  const round = state.round;
  const rs = round?.state ?? null;
  const focusRound = round || state.nextRound || null;
  let hero;
  if (!focusRound) hero = { kind: 'none' };
  else if (rs === 'REGISTRATION_OPEN') hero = { kind: 'countdown', target: round.lockAt };
  else if (rs === 'LOCKED') hero = { kind: 'locked', startOverdue: !!round.startOverdue };
  else if (rs === 'PLAYING') hero = state.currentDraw ? { kind: 'draw', number: state.currentDraw.number, skillName: state.currentDraw.skill?.name ?? '', skillKind: state.currentDraw.skill?.kind ?? null, live: !!state.currentDraw.bingoEvaluationActive } : { kind: 'waitingDraw' };
  else if (rs === 'WINNER') hero = { kind: 'result', winningDrawNumber: state.resultTiming?.winningDrawNumber ?? null, publishedAt: state.resultTiming?.publishedAt ?? null, resultWindowEndsAt: state.resultTiming?.resultWindowEndsAt ?? null, winnerCount: state.winners.length };
  else if (rs === 'CANCELLED') hero = { kind: 'notice', notice: 'cancelled', text: state.notice?.text ?? null };
  else if (rs === 'EXHAUSTED') hero = { kind: 'notice', notice: 'exhausted', text: state.notice?.text ?? null };
  else if (rs === 'CLOSED') hero = state.nextRound ? { kind: 'scheduled', target: state.nextRound.lockAt } : { kind: 'closed' };
  else hero = { kind: 'scheduled', target: focusRound.lockAt }; // DRAFT (as current or as nextRound)

  const pacingLive = !!state.currentDraw?.bingoEvaluationActive || (state.currentDraw?.number ?? 0) >= BINGO_UNLOCK_DRAW;
  return {
    layout: layoutFor(state),
    eventName: state.eventName || '',
    status: {
      roundState: rs,
      focusState: focusRound?.state ?? null,
      isNextRound: !round && !!state.nextRound,
      roundNumber: focusRound?.number ?? null,
      roundTitle: focusRound?.title ?? '',
      hero,
    },
    counts: { ...emptyCounts(), ...(state.counts || {}) },
    roundsPlayed: Number(state.roundsPlayed) || 0, // D-46: rounds that reached a result (server-counted)
    draw: {
      current: state.currentDraw,
      recent: [...(state.recentDraws || [])].sort((a, b) => b.number - a.number).slice(0, RECENT_LIMIT),
      pacing: pacingLive ? 'live' : 'beforeFive',
      matchedBoards: state.counts?.matchedBoards ?? 0,
      poolRemaining: state.currentDraw?.poolRemaining ?? null,
    },
    winners: {
      list: (state.winners || []).map(w => ({ label: w.label ?? null, soulId: w.soulId ?? null, winningDrawNumber: w.winningDrawNumber ?? null })),
      timing: state.resultTiming || { winningDrawNumber: null, publishedAt: null, resultWindowEndsAt: null },
      roundNumber: round?.number ?? null,
    },
    insights: state.insights || null,
    galaxyCount: state.galaxy?.count ?? null,
    stale: isStale(state.serverTime, nowMs),
    serverTime: state.serverTime,
  };
}

export function isStale(serverTimeIso, nowMs, thresholdMs = STALE_AFTER_MS) {
  const t = Date.parse(serverTimeIso || '');
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return false;
  return nowMs - t > thresholdMs;
}
