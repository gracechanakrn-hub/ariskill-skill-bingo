// Public screen state: reducer for the public projection (snapshot + SSE events) and the panel view-model.
// Pure ESM (no DOM), tested in test/state.test.js. Only public-projection fields are ever stored
// (contracts/projections/public.json); nothing is inferred beyond display mapping.
import { t, exception, PUBLIC_STATE_BY_ROUND } from '../../../packages/contracts/index.js';
import { formatCountdown } from '../../../packages/ui/clock-sync.js';
import { pseudonymLabel } from '../../../packages/ui/format.js';
import { label } from './copy.js';

export const PUBLIC_KEYS = ['eventId', 'eventName', 'sequence', 'serverTime', 'publicState', 'notice', 'round', 'nextRound', 'join', 'counts', 'currentDraw', 'recentDraws', 'pacingMessage', 'winners', 'previousWinners', 'galaxy'];

export function initialState() {
  return {
    loaded: false, sequence: -1, serverTime: null, eventId: 'evt_demo', eventName: '',
    publicState: 'Waiting', notice: null, round: null, nextRound: null, join: null,
    counts: { joined: 0, completed: 0, active: 0, matchedBoards: 0 },
    currentDraw: null, recentDraws: [], pacingMessage: '', winners: [], previousWinners: [],
    galaxy: { souls: [], count: 0 },
    bingo: null,                 // { drawNumber, winnerCount } from bingo.detected until result.published
    resultWindowElapsed: false,  // display fallback: scheduleAt(resultWindowEndsAt) fired before round.closed
    connection: 'connecting',    // connecting | open | reconnecting | closed
    staleMs: 0,
  };
}

/** Snapshot always wins: copies only allow-listed keys. */
export function applyPublicSnapshot(state, snap) {
  const next = { ...state, loaded: true, resultWindowElapsed: false, bingo: null };
  for (const k of PUBLIC_KEYS) if (snap[k] !== undefined) next[k] = snap[k];
  if (!next.galaxy) next.galaxy = { souls: [], count: 0 };
  if (!Array.isArray(next.galaxy.souls)) next.galaxy = { souls: [], count: 0 };
  next.galaxy = { souls: dedupSouls(next.galaxy.souls), count: next.galaxy.count ?? next.galaxy.souls.length };
  if (!next.counts) next.counts = initialState().counts;
  if (!Array.isArray(next.recentDraws)) next.recentDraws = [];
  if (!Array.isArray(next.winners)) next.winners = [];
  if (!Array.isArray(next.previousWinners)) next.previousWinners = [];
  return next;
}

function dedupSouls(list) {
  const seen = new Set(), out = [];
  for (const s of list) { if (s && s.soulId && !seen.has(s.soulId)) { seen.add(s.soulId); out.push(s); } }
  return out;
}

function publicRound(summary, prev) {
  if (!summary) return prev || null;
  return {
    roundId: summary.roundId, number: summary.number, title: summary.title, state: summary.state, version: summary.version,
    lockAt: summary.lockAt ?? null, startedAt: summary.startedAt ?? null,
    resultWindowEndsAt: summary.resultWindowEndsAt ?? (prev && prev.roundId === summary.roundId ? prev.resultWindowEndsAt : null),
  };
}

function noticeFor(round) {
  if (!round) return null;
  if (round.state === 'CANCELLED') return { kind: 'cancelled', text: t('public.cancelled') };
  if (round.state === 'EXHAUSTED') return { kind: 'exhausted', text: t('public.exhausted') };
  return null;
}

function pacingFor(round, drawCount) {
  if (!round) return t('board.noRound');
  if (round.state === 'PLAYING') return drawCount < 5 ? t('public.playing.pacing') : t('public.playing.live');
  if (round.state === 'WINNER') return t('public.winner.title');
  if (round.state === 'LOCKED') return t('play.waitingStart');
  return t('public.waiting.title');
}

/**
 * Reduces one SSE envelope. Returns { state, needsSnapshot } - needsSnapshot asks main.js to reconcile with
 * GET /snapshot for structural changes the event payload cannot fully describe (join link, previous winners,
 * next round). Final state always equals the snapshot afterwards.
 */
export function reduceEvent(state, envelope) {
  const type = envelope && envelope.type;
  const p = (envelope && envelope.payload) || {};
  let s = { ...state, serverTime: envelope.occurredAt || state.serverTime };
  let needsSnapshot = false;
  switch (type) {
    case 'round.created':
    case 'round.updated':
    case 'round.registration_opened':
    case 'round.locked':
    case 'round.started':
    case 'round.cancelled':
    case 'round.exhausted':
    case 'round.closed': {
      const r = publicRound(p.round, s.round);
      const isCurrent = !s.round || !r || s.round.roundId === r.roundId || type === 'round.created' && !s.round;
      if (type === 'round.created' && s.round && s.round.roundId !== r.roundId) {
        s.nextRound = r; needsSnapshot = true; break;
      }
      if (!isCurrent && s.nextRound && s.nextRound.roundId === r.roundId) {
        if (type === 'round.registration_opened' || type === 'round.updated') { s.nextRound = r; needsSnapshot = true; break; }
      }
      if (type === 'round.closed') {
        const labels = (s.winners || []).map(w => winnerLabel(w));
        s.previousWinners = [{ roundNumber: r.number, labels }, ...(s.previousWinners || []).filter(x => x.roundNumber !== r.number)].slice(0, 3);
        s.bingo = null; s.resultWindowElapsed = false;
      }
      if (type === 'round.started') { s.currentDraw = null; s.recentDraws = []; s.winners = []; s.bingo = null; s.counts = { ...s.counts, matchedBoards: 0 }; }
      s.round = r;
      s.publicState = PUBLIC_STATE_BY_ROUND[r.state] || 'Waiting';
      s.notice = noticeFor(r);
      s.pacingMessage = pacingFor(r, s.recentDraws.length ? (s.currentDraw ? s.currentDraw.number : 0) : 0);
      if (type === 'round.created' || type === 'round.closed' || type === 'round.cancelled' || type === 'round.exhausted' || type === 'round.registration_opened' || type === 'round.locked') needsSnapshot = true;
      break;
    }
    case 'draw.accepted': {
      const d = p.draw || {};
      s.currentDraw = { number: d.number, skill: d.skill, drawnAt: d.drawnAt, poolRemaining: p.poolRemaining ?? 0, bingoEvaluationActive: !!p.bingoEvaluationActive || d.number >= 5 };
      s.recentDraws = [...(s.recentDraws || []), { number: d.number, skillName: d.skill && d.skill.name, kind: d.skill && d.skill.kind }].slice(-5);
      if (typeof p.matchedBoards === 'number') s.counts = { ...s.counts, matchedBoards: p.matchedBoards };
      s.publicState = 'Playing';
      s.pacingMessage = d.number < 5 ? t('public.playing.pacing') : t('public.playing.live');
      break;
    }
    case 'draw.match_counts_updated':
      if (typeof p.matchedBoards === 'number') s.counts = { ...s.counts, matchedBoards: p.matchedBoards };
      break;
    case 'bingo.detected':
      s.bingo = { drawNumber: p.drawNumber, winnerCount: p.winnerCount };
      break;
    case 'result.published': {
      const r = publicRound(p.round, s.round);
      if (r) { r.resultWindowEndsAt = p.resultWindowEndsAt || r.resultWindowEndsAt; s.round = r; s.publicState = PUBLIC_STATE_BY_ROUND[r.state] || 'Winner'; }
      s.winners = Array.isArray(p.winners) ? p.winners.map(w => ({ label: w.label, soulId: w.soulId })) : s.winners;
      s.resultWindowElapsed = false;
      s.pacingMessage = t('public.winner.title');
      break;
    }
    case 'soul.float_accepted': {
      const e = p.entrance;
      if (e && e.soulId && !s.galaxy.souls.some(x => x.soulId === e.soulId)) {
        const souls = [...s.galaxy.souls, { soulId: e.soulId, config: e.config, badge: e.badge || null, label: e.label ?? null, enteredAt: e.enteredAt, edge: e.edge }];
        s.galaxy = { souls, count: souls.length };
      }
      break;
    }
    case 'participation.updated':
      if (p.counts) s.counts = { joined: p.counts.joined ?? s.counts.joined, completed: p.counts.completed ?? s.counts.completed, active: p.counts.active ?? s.counts.active, matchedBoards: p.counts.matchedBoards ?? s.counts.matchedBoards };
      break;
    case 'system.snapshot_required':
      needsSnapshot = true;
      break;
    default:
      break;
  }
  return { state: s, needsSnapshot };
}

export function winnerLabel(w) {
  if (w && typeof w.label === 'string' && w.label.trim()) return w.label;
  return w && w.soulId ? t('public.winner.anonymous', { id: pseudonymLabel(w.soulId, { prefix: '' }).trim() }) : t('public.winner.anonymous', { id: '?' });
}

/** The round whose schedule the Waiting panel shows: the current one while it is upcoming, else nextRound. */
export function upcomingRound(state) {
  const r = state.round;
  if (r && ['DRAFT', 'REGISTRATION_OPEN', 'LOCKED'].includes(r.state)) return r;
  return state.nextRound || null;
}

/** Effective public state for display (server state wins; the elapsed result window is a display fallback only). */
export function effectivePublicState(state) {
  if (state.publicState === 'Winner' && state.resultWindowElapsed) return 'Waiting';
  return state.publicState || 'Waiting';
}

/** Previous winners: the just-closed round (still `round` in the projection) first, then previousWinners (last 3). */
export function previousWinnerRows(state) {
  const rows = [];
  if (state.round && state.round.state === 'CLOSED' && Array.isArray(state.winners) && state.winners.length) {
    rows.push({ roundNumber: state.round.number, labels: state.winners.map(winnerLabel) });
  }
  for (const pw of state.previousWinners || []) if (!rows.some(r => r.roundNumber === pw.roundNumber)) rows.push({ roundNumber: pw.roundNumber, labels: pw.labels || [] });
  return rows.slice(0, 3).map(r => ({ roundLabel: t('public.winner.round', { number: r.roundNumber }), labels: r.labels }));
}

/** Panel view-model: everything panel.js needs, precomputed and copy-resolved. */
export function panelViewModel(state, nowMs = Date.now()) {
  const mode = effectivePublicState(state);
  const base = {
    mode, loaded: !!state.loaded, eventName: state.eventName || label('eventName'), connection: state.connection,
    stale: state.staleMs > 10_000, galaxyCount: state.galaxy ? state.galaxy.count : 0,
    notice: state.notice && state.notice.text ? { kind: state.notice.kind, text: state.notice.text } : null,
  };
  if (mode === 'Playing') {
    const d = state.currentDraw;
    const round = state.round;
    return {
      ...base,
      roundLabel: round ? label('roundLabel', { number: round.number }) : '',
      drawLabel: d ? t('public.playing.draw', { number: d.number }) : t('public.playing.pacing'),
      kind: d && d.skill ? d.skill.kind : null,
      skillName: d && d.skill ? d.skill.name : '',
      domain: d && d.skill ? d.skill.domain : '',
      matched: t('public.playing.matched', { count: state.counts.matchedBoards ?? 0 }),
      pacing: d && d.bingoEvaluationActive ? t('public.playing.live') : t('public.playing.pacing'),
      live: !!(d && d.bingoEvaluationActive),
      recentDraws: (state.recentDraws || []).slice(-5).reverse(),
      waitingForDraw: !d,
    };
  }
  if (mode === 'Winner') {
    const round = state.round;
    const labels = (state.winners || []).map(winnerLabel);
    return {
      ...base,
      title: t('public.winner.title'),
      roundLabel: round ? t('public.winner.round', { number: round.number }) : '',
      labels,
      pending: labels.length === 0 && !!state.bingo,
      resultWindowEndsAt: round ? round.resultWindowEndsAt : null,
    };
  }
  const up = upcomingRound(state);
  const countdown = up && up.lockAt && up.state !== 'LOCKED' ? formatCountdown(up.lockAt, nowMs) : null;
  const registrationOpen = !!(up && up.state === 'REGISTRATION_OPEN');
  return {
    ...base,
    title: t('public.waiting.title'),
    roundTitle: up ? up.title : null,
    roundNumber: up ? up.number : null,
    scheduled: !!up,
    notScheduled: up ? null : exception('E1').copy,
    lockAt: up ? up.lockAt : null,
    locked: !!(up && up.state === 'LOCKED'),
    lockedText: up && up.state === 'LOCKED' ? t('play.waitingStart') : null,
    countdown,
    countdownUrgent: !!(up && up.lockAt && up.lockAt && (Date.parse(up.lockAt) - nowMs) < 60_000),
    registrationOpen,
    joinUrl: state.join && state.join.joinUrl ? state.join.joinUrl : null,
    scan: t('public.waiting.scan'),
    previousTitle: t('public.waiting.previous'),
    previous: previousWinnerRows(state),
  };
}
