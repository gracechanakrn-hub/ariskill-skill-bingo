// Audience projections (BR-18, contracts/projections/*.json). Every snapshot and event payload is built by allowlist and
// then passed through redact(audience, obj), which strips any forbidden key recursively as a last line of defence.
import publicContract from '../../../contracts/projections/public.json' with { type: 'json' };
import stageContract from '../../../contracts/projections/stage.json' with { type: 'json' };
import adminContract from '../../../contracts/projections/admin.json' with { type: 'json' };
import participantContract from '../../../contracts/projections/participant.json' with { type: 'json' };
import insightsContract from '../../../contracts/projections/insights.json' with { type: 'json' };
import realtime from '../../../contracts/realtime-events.json' with { type: 'json' };
import { t } from '../../../packages/contracts/index.js';
import { MIN_DRAW_FOR_BINGO, isEvaluationActive } from '../../../packages/game-rules/src/index.js';
import { json } from './db.js';
import { SKILLS, PLATFORMS, ROLES, MATRIX_VERSION, roleSkillSet } from './skills.js';
import { currentJoinLink } from './auth.js';
import {
  getEvent, getRound, roundsOfEvent, activeRound, displayRound, latestDraftRoundAfter, latestRound, drawsOf, winnersOf, latestSequence,
  roundSummary, resultWindowEndsAt, drawShape, publicState, winnerLabel, participantBoard, boardsOfRound,
} from './queries.js';
import { computeInsights, stageInsights } from '../../analytics-projection/src/insights.js';

// ---- forbidden keys per audience, derived from the contracts ------------------------------------------------------
const SKIP_WORDS = new Set(['any', 'other', 'aggregate']);
function keysFrom(list) {
  const out = new Set();
  for (const phrase of list) { const w = String(phrase).split(/\s+/)[0]; if (/^[a-z][A-Za-z_]+$/.test(w) && !SKIP_WORDS.has(w)) out.add(w); }
  return out;
}
const ALWAYS_SECRET = ['employeeRef', 'employee_ref_hash', 'token_hash', 'float_token_enc', 'sessionToken', 'joinSecret', 'adminToken', 'stageToken'];
export const FORBIDDEN_KEYS = Object.freeze({
  public: Object.freeze([...new Set([...keysFrom(publicContract.forbidden), ...ALWAYS_SECRET, 'floatToken', 'participantId', 'displayName', 'consentPublicName', 'matchedPositionsByParticipant', 'myMatchedPositions', 'myResult', 'lineIds', 'boardsWithFourInLine', 'connections'])]),
  stage: Object.freeze([...new Set([...keysFrom(stageContract.forbidden), ...ALWAYS_SECRET, 'floatToken', 'participantId', 'displayName', 'consentPublicName', 'matchedPositionsByParticipant', 'myMatchedPositions', 'myResult', 'lineIds', 'boardsWithFourInLine', 'connections', 'joinUrl', 'join'])]),
  admin: Object.freeze([...new Set([...keysFrom(adminContract.forbidden), ...ALWAYS_SECRET, 'floatToken', 'matchedPositionsByParticipant', 'myMatchedPositions', 'myResult'])]),
  participant: Object.freeze([...new Set([...ALWAYS_SECRET, 'matchedPositionsByParticipant', 'employeeRef'])]),
  insights: Object.freeze([...new Set([...keysFrom(insightsContract.forbidden), ...ALWAYS_SECRET, 'participantId', 'displayName', 'floatToken'])]),
});

/** Recursively delete forbidden keys for an audience. Returns the same object (mutated) for convenience. */
export function redact(audience, obj) {
  const forbidden = FORBIDDEN_KEYS[audience];
  if (!forbidden) throw new Error(`unknown audience ${audience}`);
  const set = new Set(forbidden);
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 12) return v;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return v; }
    for (const k of Object.keys(v)) { if (set.has(k)) delete v[k]; else walk(v[k], depth + 1); }
    return v;
  };
  return walk(obj, 0);
}
/** Find forbidden keys present anywhere in obj (used by contract tests). */
export function findForbiddenKeys(audience, obj) {
  const set = new Set(FORBIDDEN_KEYS[audience]); const found = [];
  const walk = (v, path) => { if (!v || typeof v !== 'object') return; if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; } for (const k of Object.keys(v)) { if (set.has(k)) found.push(`${path}.${k}`); walk(v[k], `${path}.${k}`); } };
  walk(obj, '$'); return found;
}

export function createProjections({ db, clock, config, game, participants, hub = null }) {
  const cache = new Map(); // eventId -> { at, value } for insights

  function publicRound(r) { if (!r) return null; return { roundId: r.id, number: r.number, title: r.title, state: r.state, version: r.version, lockAt: r.lock_at, startedAt: r.started_at, resultWindowEndsAt: resultWindowEndsAt(r) }; }
  function stageRound(r) { if (!r) return null; return { ...roundSummary(r), resultWindowEndsAt: resultWindowEndsAt(r), startOverdue: game.readinessOf(r).startOverdue }; }
  function noticeFor(r) {
    if (!r) return null;
    if (r.state === 'CANCELLED') return { kind: 'cancelled', text: t('public.cancelled') };
    if (r.state === 'EXHAUSTED') return { kind: 'exhausted', text: t('public.exhausted') };
    return null;
  }
  function drawInfo(r) {
    if (!r) return { draws: [], currentDraw: null, poolRemaining: 0 };
    const draws = drawsOf(db, r.id);
    const pool = json.parse(r.pool_json, []);
    const poolRemaining = Math.max(0, pool.length - draws.length);
    const last = draws[draws.length - 1];
    const currentDraw = last ? { ...drawShape(last), poolRemaining, bingoEvaluationActive: isEvaluationActive(last.number) } : null;
    if (currentDraw) delete currentDraw.drawId;
    return { draws, currentDraw, poolRemaining };
  }
  function recent(draws, n) { return draws.slice(-n).map(d => { const s = drawShape(d); return { number: s.number, skillName: s.skill.name, kind: s.skill.kind }; }); }
  function pacing(r, draws) {
    if (!r) return t('board.noRound');
    if (r.state === 'PLAYING') return draws.length < MIN_DRAW_FOR_BINGO ? t('public.playing.pacing') : t('public.playing.live');
    if (r.state === 'WINNER') return t('public.winner.title');
    if (r.state === 'LOCKED') return t('play.waitingStart');
    return t('public.waiting.title');
  }
  function joinFor(eventId) {
    const open = db.get(`SELECT id FROM rounds WHERE event_id = ? AND state IN ('DRAFT','REGISTRATION_OPEN') LIMIT 1`, eventId);
    return open ? currentJoinLink(db, config, clock, eventId) : null;
  }
  function previousWinners(eventId, excludeRoundId) {
    const rounds = db.all(`SELECT * FROM rounds WHERE event_id = ? AND state = 'CLOSED' AND id != ? ORDER BY number DESC LIMIT 3`, eventId, excludeRoundId ?? '');
    return rounds.map(r => ({ roundNumber: r.number, labels: winnersOf(db, r.id).map(w => winnerLabel(w)) }));
  }
  function galaxy(eventId) {
    const souls = db.all('SELECT entrance_json FROM souls WHERE event_id = ? AND entrance_json IS NOT NULL ORDER BY floated_at', eventId).map(r => json.parse(r.entrance_json));
    return { souls, count: souls.length };
  }
  function base(eventId) {
    const event = getEvent(db, eventId);
    if (!event) return null;
    return { event, cur: displayRound(db, eventId), seq: latestSequence(db, eventId) };
  }
  function nextRoundFor(eventId, cur) { return latestDraftRoundAfter(db, eventId, cur?.number ?? 0); }

  // ---- snapshots -----------------------------------------------------------------------------------------------
  function publicSnapshot(eventId) {
    const b = base(eventId); if (!b) return null;
    const { event, cur, seq } = b;
    const { draws, currentDraw } = drawInfo(cur);
    const counts = game.countsOf(cur, eventId);
    const showWinners = cur && ['WINNER', 'CLOSED'].includes(cur.state);
    const snap = {
      eventId, eventName: event.name, sequence: seq, serverTime: clock.iso(), publicState: publicState(cur), notice: noticeFor(cur),
      round: publicRound(cur), nextRound: publicRound(nextRoundFor(eventId, cur)), join: joinFor(eventId),
      counts: { joined: counts.joined, completed: counts.completed, active: counts.active, matchedBoards: counts.matchedBoards },
      currentDraw, recentDraws: recent(draws, 5), pacingMessage: pacing(cur, draws),
      winners: showWinners ? winnersOf(db, cur.id).map(w => ({ label: winnerLabel(w), soulId: w.soul_id })) : [],
      previousWinners: previousWinners(eventId, cur?.id), galaxy: galaxy(eventId),
    };
    return redact('public', snap);
  }
  function stageSnapshot(eventId) {
    const b = base(eventId); if (!b) return null;
    const { event, cur, seq } = b;
    const { draws, currentDraw } = drawInfo(cur);
    const showWinners = cur && ['WINNER', 'CLOSED'].includes(cur.state);
    const winners = showWinners ? winnersOf(db, cur.id) : [];
    const snap = {
      eventId, eventName: event.name, sequence: seq, serverTime: clock.iso(), publicState: publicState(cur), notice: noticeFor(cur),
      round: stageRound(cur), nextRound: roundSummary(nextRoundFor(eventId, cur)), counts: game.countsOf(cur, eventId),
      currentDraw, recentDraws: recent(draws, 10),
      winners: winners.map(w => ({ label: winnerLabel(w), soulId: w.soul_id, winningDrawNumber: w.winning_draw_number })),
      resultTiming: { winningDrawNumber: winners[0]?.winning_draw_number ?? null, publishedAt: cur?.published_at ?? null, resultWindowEndsAt: resultWindowEndsAt(cur) },
      insights: stageInsights(insights(eventId)),
    };
    return redact('stage', snap);
  }
  function adminRoundSummary(r) { const rd = ['CLOSED', 'CANCELLED'].includes(r.state) ? null : game.readinessOf(r); return { ...roundSummary(r), resultWindowEndsAt: resultWindowEndsAt(r), startOverdue: rd?.startOverdue ?? false, readiness: rd ? withoutPool(rd) : null }; }
  function withoutPool(rd) { const { pool, ...rest } = rd; return rest; }
  function lastCommandFor(roundId) {
    const a = db.get(`SELECT * FROM audit_log WHERE round_id = ? AND action LIKE 'round.%' ORDER BY id DESC LIMIT 1`, roundId);
    return a ? { commandId: a.command_id, command: a.action, outcome: a.outcome, at: a.at } : null;
  }
  function adminSnapshot(eventId) {
    const event = getEvent(db, eventId); if (!event) return null;
    const cur = activeRound(db, eventId) ?? latestRound(db, eventId);
    const conns = hub ? hub.counts() : { public: 0, stage: 0, participants: 0, admin: 0 };
    let currentRound = null;
    if (cur) {
      const { draws, poolRemaining } = drawInfo(cur);
      currentRound = {
        summary: { ...roundSummary(cur), resultWindowEndsAt: resultWindowEndsAt(cur) }, readiness: withoutPool(game.readinessOf(cur)),
        counts: { ...game.countsOf(cur), connections: conns.public + conns.stage + conns.participants + conns.admin },
        draws: draws.map(d => ({ ...drawShape(d), matchedBoards: d.matched_boards })), poolRemaining,
        winners: winnersOf(db, cur.id).map(w => ({ participantId: w.participant_id, label: winnerLabel(w), lineIds: json.parse(w.line_ids_json, []), winningDrawNumber: w.winning_draw_number })),
        lastCommand: lastCommandFor(cur.id), pacingHintSeconds: [5, 8],
      };
    }
    const snap = { eventId, eventName: event.name, sequence: latestSequence(db, eventId), serverTime: clock.iso(), rounds: roundsOfEvent(db, eventId).map(adminRoundSummary), currentRound, join: currentJoinLink(db, config, clock, eventId), connections: conns };
    return redact('admin', snap);
  }
  function participantSnapshot(p) {
    const event = getEvent(db, p.event_id);
    const board = participants.currentBoard(p);
    const ar = activeRound(db, p.event_id);
    const round = board ? getRound(db, board.round_id) : ar;
    const nextRound = ar && round && ar.id !== round.id ? ar : null;
    const draws = round ? drawsOf(db, round.id).map(drawShape) : [];
    let result = null;
    if (round && board && board.state === 'FINISHED' && ['WINNER', 'EXHAUSTED', 'CLOSED'].includes(round.state)) {
      const ws = winnersOf(db, round.id); const mine = ws.find(w => w.participant_id === p.id);
      result = { isWinner: !!mine, lineIds: mine ? json.parse(mine.line_ids_json, []) : [], winningDrawNumber: ws[0]?.winning_draw_number ?? null, coWinnerCount: ws.length };
    }
    const soulRow = board ? db.get('SELECT * FROM souls WHERE board_id = ?', board.id) : null;
    const soul = soulRow ? participants.shapeSoulPrivate(soulRow) : participants.soulPrivate(p);
    const snap = {
      sequence: latestSequence(db, p.event_id), serverTime: clock.iso(), participant: participants.participantProjected(p), event: { eventId: event.id, eventName: event.name },
      round: roundSummary(round), nextRound: roundSummary(nextRound), board: participantBoard(db, board), draws, result, soul, insightAvailable: board?.state === 'FINISHED',
    };
    return redact('participant', snap);
  }

  // ---- insights (cached) ---------------------------------------------------------------------------------------------
  function insightsInput(eventId) {
    const round = activeRound(db, eventId) ?? latestRound(db, eventId);
    const parts = db.all('SELECT id, platform_id, role_id FROM participants WHERE event_id = ?', eventId).map(r => ({ participantId: r.id, platformId: r.platform_id, roleId: r.role_id }));
    const boards = round ? boardsOfRound(db, round.id).map(b => ({ participantId: b.participant_id, state: b.state, selectedSkillIds: json.parse(b.selected_json, []), matrixVersion: b.matrix_version })) : [];
    return { participants: parts, boards, skills: SKILLS, platforms: PLATFORMS, roles: ROLES, roleSkillSet, matrixVersion: MATRIX_VERSION, computedAt: clock.iso() };
  }
  function insights(eventId, { fresh = false } = {}) {
    const c = cache.get(eventId);
    if (!fresh && c && clock.now() - c.at < config.insightsCacheMs) return c.value;
    if (!getEvent(db, eventId)) return null;
    const value = redact('insights', computeInsights(insightsInput(eventId)));
    cache.set(eventId, { at: clock.now(), value });
    return value;
  }

  // ---- realtime event projection --------------------------------------------------------------------------------------
  const TYPES = realtime.types;
  function projectEvent(audience, row, { participantId = null } = {}) {
    const def = TYPES[row.type];
    if (!def) return null;
    if (row.participant_id) { if (audience !== 'participant' || row.participant_id !== participantId) return null; }
    else if (!def.audiences.includes(audience)) return null;
    let payload = json.parse(row.payload_json, {});
    switch (row.type) {
      case 'draw.accepted': {
        const { matchedPositionsByParticipant, ...rest } = payload;
        payload = audience === 'participant' ? { ...rest, myMatchedPositions: matchedPositionsByParticipant?.[participantId] ?? [] } : rest;
        break;
      }
      case 'draw.match_counts_updated': if (audience !== 'admin') { const { boardsWithFourInLine, ...rest } = payload; payload = rest; } break;
      case 'result.published': {
        const winners = payload.winners ?? [];
        if (audience === 'admin') payload = { ...payload, winners: winners.map(({ soulId, ...w }) => w) };
        else if (audience === 'stage') payload = { ...payload, winners: winners.map(w => ({ label: w.label, soulId: w.soulId, winningDrawNumber: w.winningDrawNumber })) };
        else if (audience === 'public') payload = { ...payload, winners: winners.map(w => ({ label: w.label, soulId: w.soulId })) };
        else { const mine = winners.find(w => w.participantId === participantId); payload = { ...payload, winners: winners.map(w => ({ label: w.label, soulId: w.soulId })), myResult: { isWinner: !!mine, lineIds: mine?.lineIds ?? [] } }; }
        break;
      }
      case 'soul.created': {
        const s = db.get('SELECT * FROM souls WHERE id = ?', payload.soulId);
        payload = { soul: s ? participants.shapeSoulPrivate(s) : null };
        break;
      }
      case 'participation.updated': {
        const c = payload.counts ?? {};
        if (audience === 'public') payload = { counts: { joined: c.joined, completed: c.completed, active: c.active, matchedBoards: c.matchedBoards } };
        else if (audience === 'admin') { const conns = hub ? hub.counts() : { public: 0, stage: 0, participants: 0, admin: 0 }; payload = { counts: { ...c, connections: conns.public + conns.stage + conns.participants + conns.admin } }; }
        else payload = { counts: c };
        break;
      }
      default: break;
    }
    const env = { eventId: row.event_id, roundId: row.round_id, sequence: row.sequence, type: row.type, occurredAt: row.occurred_at, roundVersion: row.round_version, payload };
    return redact(audience, env);
  }
  function snapshotRequired(audience, eventId, reason) {
    return redact(audience, { eventId, roundId: null, sequence: latestSequence(db, eventId), type: 'system.snapshot_required', occurredAt: clock.iso(), roundVersion: null, payload: { reason } });
  }

  return { publicSnapshot, stageSnapshot, adminSnapshot, participantSnapshot, insights, insightsInput, projectEvent, snapshotRequired, FORBIDDEN_KEYS, redact };
}
