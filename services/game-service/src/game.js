// Authoritative round logic. Every mutation runs in one BEGIN IMMEDIATE transaction; realtime events are written to the
// outbox inside the transaction and handed to the SSE hub only after COMMIT (D-08, requirement 7.1 / 15.1).
import { json } from './db.js';
import { ApiError, isApiError } from './errors.js';
import { newId, sha256Hex, randomToken } from './ids.js';
import { encryptToken } from './auth.js';
import { SKILLS, domainCounts, kindCounts } from './skills.js';
import {
  getRound, getEvent, roundSummary, drawShape, activeBoardsWithCells, drawsOf, boardsOfRound, cellsOf, matchesOf, winnerLabel,
  resultWindowEndsAt, latestSequence, boardOf, participantBoard, getParticipant,
} from './queries.js';
import {
  isCommandAllowed, buildDrawPool, readiness as poolReadiness, drawNext, evaluateDraw, positionsFromMask, bestLineProgress,
  secureRng, seededRng, POOL_MINIMUM, soulSeed, decoratedSoulConfig, validateSoulConfig, neutralSoulConfig, shuffle,
} from '../../../packages/game-rules/src/index.js';

export const COMMANDS = ['round.update', 'round.registration.open', 'round.reschedule', 'round.lock', 'round.start', 'round.start_now', 'round.draw.next', 'round.cancel', 'round.close'];

function clampWindow(n, config) { const v = Number.isInteger(n) ? n : config.resultWindowSeconds; return Math.min(15, Math.max(10, v)); }
function isIso(s) { return typeof s === 'string' && Number.isFinite(Date.parse(s)); }

export function createGame({ db, clock, config, log, hub = null }) {
  const now = () => clock.iso();

  // ---- RNG sources (BR-10). Seeded only outside production, keyed so fixtures replay across processes. ----
  const rngForDraw = (round, drawNumber) => config.rngSeed && config.env !== 'production'
    ? seededRng(`${config.rngSeed}:${round.event_id}:round-${round.number}:draw-${drawNumber}`)
    : secureRng();
  const rngForBoard = (skillIds) => config.rngSeed && config.env !== 'production'
    ? seededRng(`${config.rngSeed}:board:${skillIds.slice().sort().join(',')}`)
    : secureRng();

  // ---- transaction context: outbox + audit -------------------------------------------------------------
  function makeCtx(meta) {
    const out = [];
    const seq = new Map();
    const ctx = {
      db, clock, config, meta, out,
      emit(type, { eventId, roundId = null, roundVersion = null, payload = {}, participantId = null }) {
        const next = (seq.get(eventId) ?? latestSequence(db, eventId)) + 1;
        seq.set(eventId, next);
        const row = { event_id: eventId, sequence: next, round_id: roundId, type, occurred_at: now(), round_version: roundVersion, payload_json: json.str(payload), participant_id: participantId };
        db.run('INSERT INTO events_outbox(event_id, sequence, round_id, type, occurred_at, round_version, payload_json, participant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          row.event_id, row.sequence, row.round_id, row.type, row.occurred_at, row.round_version, row.payload_json, row.participant_id);
        out.push(row);
        return row;
      },
    };
    return ctx;
  }
  /** Run fn in a transaction; publish outbox rows after commit. */
  function withTx(meta, fn) {
    const ctx = makeCtx(meta);
    const result = db.transaction(() => fn(ctx));
    if (ctx.out.length && hub) hub.publish(ctx.out);
    return result;
  }
  function audit(entry) {
    db.run('INSERT INTO audit_log(event_id, round_id, actor, action, target, expected_version, actual_version, outcome, correlation_id, command_id, details_json, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      entry.eventId ?? null, entry.roundId ?? null, entry.actor ?? 'unknown', entry.action, entry.target ?? null, entry.expectedVersion ?? null, entry.actualVersion ?? null,
      entry.outcome, entry.correlationId ?? null, entry.commandId ?? null, entry.details ? json.str(entry.details) : null, entry.at ?? now());
  }

  // ---- events -------------------------------------------------------------------------------------------
  function ensureEvent(id, name) {
    const e = getEvent(db, id);
    if (e) return e;
    db.run('INSERT INTO events(id, name, timezone, status, created_at) VALUES (?, ?, ?, ?, ?)', id, name, 'UTC', 'active', now());
    return getEvent(db, id);
  }

  // ---- counts / readiness -------------------------------------------------------------------------------
  function countsOf(round, eventIdHint = null) {
    const eventId = round?.event_id ?? eventIdHint;
    const joined = eventId ? db.get('SELECT COUNT(*) AS c FROM participants WHERE event_id = ?', eventId).c : 0;
    if (!round) return { joined, completed: 0, incomplete: 0, active: 0, deferred: 0, matchedBoards: 0 };
    const by = Object.fromEntries(db.all('SELECT state, COUNT(*) AS c FROM boards WHERE round_id = ? GROUP BY state', round.id).map(r => [r.state, r.c]));
    const matched = db.get('SELECT COUNT(DISTINCT m.board_id) AS c FROM board_matches m JOIN boards b ON b.id = m.board_id WHERE b.round_id = ?', round.id).c;
    return {
      joined,
      completed: (by.READY ?? 0) + (by.LOCKED_ACTIVE ?? 0) + (by.FINISHED ?? 0),
      incomplete: by.DRAFT ?? 0,
      active: (by.LOCKED_ACTIVE ?? 0) + (by.FINISHED ?? 0),
      deferred: by.DEFERRED ?? 0,
      matchedBoards: matched,
    };
  }
  /** Readiness (A-03, BR-08): before lock evaluate READY boards; after lock the LOCKED_ACTIVE/FINISHED set. */
  function readinessOf(round) {
    const states = ['DRAFT', 'REGISTRATION_OPEN'].includes(round.state) ? ['READY'] : ['LOCKED_ACTIVE', 'FINISHED'];
    const boards = activeBoardsWithCells(db, round.id, states);
    const r = poolReadiness(boards, SKILLS);
    const startOverdue = round.state === 'LOCKED' && !!round.locked_at && (clock.now() - Date.parse(round.locked_at) >= config.startGraceSeconds * 1000);
    const lockCountdownMs = round.state === 'REGISTRATION_OPEN' && round.lock_at ? Math.max(0, Date.parse(round.lock_at) - clock.now()) : null;
    return { poolSize: r.poolSize, poolMinimum: POOL_MINIMUM, anyBoardCanWin: r.anyBoardCanWin, boardsThatCanWin: r.boardsThatCanWin, startOverdue, lockCountdownMs, pool: r.pool };
  }

  // ---- round create --------------------------------------------------------------------------------------
  function createRound(eventId, body, meta) {
    const event = getEvent(db, eventId);
    if (!event) throw new ApiError('NOT_FOUND', 'event not found');
    if (typeof body?.title !== 'string' || !body.title.trim() || body.title.length > 120) throw new ApiError('VALIDATION', 'title required (1-120 chars)');
    if (!isIso(body.lockAt)) throw new ApiError('VALIDATION', 'lockAt must be an ISO-8601 timestamp');
    if (body.resultWindowSeconds !== undefined && !Number.isInteger(body.resultWindowSeconds)) throw new ApiError('VALIDATION', 'resultWindowSeconds must be an integer');
    return withTx(meta, (ctx) => {
      const number = (db.get('SELECT COALESCE(MAX(number), 0) AS n FROM rounds WHERE event_id = ?', eventId).n) + 1;
      const id = newId('round');
      const t = now();
      db.run('INSERT INTO rounds(id, event_id, number, title, state, version, lock_at, result_window_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
        id, eventId, number, body.title.trim(), 'DRAFT', new Date(Date.parse(body.lockAt)).toISOString(), clampWindow(body.resultWindowSeconds, config), t, t);
      const round = getRound(db, id);
      ctx.emit('round.created', { eventId, roundId: id, roundVersion: 1, payload: { round: roundSummary(round) } });
      audit({ eventId, roundId: id, actor: meta.actor, action: 'round.create', target: id, actualVersion: 1, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { title: round.title, lockAt: round.lock_at } });
      return { round: roundSummary(round), resultingVersion: 1 };
    });
  }

  // ---- generic command dispatcher ------------------------------------------------------------------------
  function command(roundId, body, meta) {
    const cmd = body?.command;
    if (!COMMANDS.includes(cmd)) throw new ApiError('VALIDATION', `unknown command ${String(cmd)}`);
    if (!Number.isInteger(body.expectedVersion)) throw new ApiError('VALIDATION', 'expectedVersion (integer) required');
    const params = body.params && typeof body.params === 'object' ? body.params : {};
    const round0 = getRound(db, roundId);
    if (!round0) throw new ApiError('NOT_FOUND', 'round not found');
    const base = { eventId: round0.event_id, roundId, actor: meta.actor, action: cmd, target: roundId, expectedVersion: body.expectedVersion, correlationId: meta.correlationId, commandId: meta.commandId };
    try {
      return withTx(meta, (ctx) => {
        const round = getRound(db, roundId);
        if (!isCommandAllowed(round.state, cmd)) throw new ApiError('ILLEGAL_TRANSITION', `command ${cmd} is not allowed in state ${round.state}`, { state: round.state, command: cmd, currentVersion: round.version });
        if (round.version !== body.expectedVersion) throw new ApiError('STALE_VERSION', null, { currentVersion: round.version, snapshot: roundSummary(round) });
        const version = round.version + 1;
        let effects = {};
        switch (cmd) {
          case 'round.update': effects = updateRound(ctx, round, version, params, 'DRAFT'); break;
          case 'round.reschedule': effects = updateRound(ctx, round, version, params, 'REGISTRATION_OPEN'); break;
          case 'round.registration.open': effects = openRegistration(ctx, round, version); break;
          case 'round.lock': effects = lockRound(ctx, round, version, 'round.locked'); break;
          case 'round.start': effects = startRound(ctx, round, version); break;
          case 'round.start_now': {
            if (params.confirmed !== true) throw new ApiError('VALIDATION', 'round.start_now requires params.confirmed === true', { confirmed: params.confirmed ?? null });
            const l = lockRound(ctx, round, version, 'round.locked');
            const s = startRound(ctx, getRound(db, roundId), version);
            effects = { ...l, ...s };
            break;
          }
          case 'round.draw.next': effects = drawNextSkill(ctx, round, version, meta); break;
          case 'round.cancel': effects = cancelRound(ctx, round, version, params); break;
          case 'round.close': effects = closeRound(ctx, round, version, 'admin'); break;
          default: throw new ApiError('VALIDATION', 'unsupported command');
        }
        const after = getRound(db, roundId);
        if (after.version !== version) throw new Error(`version invariant violated for ${cmd}`);
        audit({ ...base, actualVersion: version, outcome: 'accepted', details: { command: cmd, fromState: round.state, toState: after.state, ...(effects.audit ?? {}) } });
        const { audit: _a, ...publicEffects } = effects;
        return { accepted: true, round: roundSummary(after), resultingVersion: version, effects: publicEffects };
      });
    } catch (e) {
      const err = isApiError(e) ? e : new ApiError(cmd === 'round.draw.next' ? 'DRAW_FAILED' : 'VALIDATION', cmd === 'round.draw.next' ? null : e.message);
      if (!isApiError(e)) log?.error('command failed', { command: cmd, roundId, correlationId: meta.correlationId, error: e.message });
      const current = getRound(db, roundId);
      audit({ ...base, actualVersion: current?.version ?? null, outcome: 'rejected', details: { command: cmd, code: err.code, message: err.message } });
      throw err;
    }
  }

  function setRound(round, fields) {
    const keys = Object.keys(fields);
    db.run(`UPDATE rounds SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map(k => fields[k]), now(), round.id);
    return getRound(db, round.id);
  }

  function updateRound(ctx, round, version, params, expectState) {
    const fields = { version };
    if (params.title !== undefined) { if (typeof params.title !== 'string' || !params.title.trim() || params.title.length > 120) throw new ApiError('VALIDATION', 'title must be 1-120 chars'); fields.title = params.title.trim(); }
    if (params.lockAt !== undefined) {
      if (!isIso(params.lockAt)) throw new ApiError('VALIDATION', 'lockAt must be ISO-8601');
      if (expectState === 'REGISTRATION_OPEN' && Date.parse(params.lockAt) <= clock.now()) throw new ApiError('VALIDATION', 'new lockAt must be in the future');
      fields.lock_at = new Date(Date.parse(params.lockAt)).toISOString();
    }
    if (params.resultWindowSeconds !== undefined) { if (!Number.isInteger(params.resultWindowSeconds)) throw new ApiError('VALIDATION', 'resultWindowSeconds must be an integer'); fields.result_window_seconds = clampWindow(params.resultWindowSeconds, config); }
    const after = setRound(round, fields);
    ctx.emit('round.updated', { eventId: round.event_id, roundId: round.id, roundVersion: version, payload: { round: roundSummary(after) } });
    return { audit: { changed: Object.keys(fields).filter(k => k !== 'version') } };
  }

  /** DRAFT -> REGISTRATION_OPEN. Reassigns every not-yet-reassigned DEFERRED board of the event into this round as a DRAFT board. */
  function openRegistration(ctx, round, version) {
    if (!round.lock_at || Date.parse(round.lock_at) <= clock.now()) throw new ApiError('VALIDATION', 'lockAt must be in the future to open registration', { lockAt: round.lock_at });
    const after = setRound(round, { version, state: 'REGISTRATION_OPEN' });
    ctx.emit('round.registration_opened', { eventId: round.event_id, roundId: round.id, roundVersion: version, payload: { round: roundSummary(after) } });
    const deferred = db.all(`SELECT * FROM boards WHERE event_id = ? AND state = 'DEFERRED' AND reassigned_to IS NULL AND round_id != ? ORDER BY created_at`, round.event_id, round.id);
    let reassigned = 0;
    for (const old of deferred) {
      if (boardOf(db, round.id, old.participant_id)) { db.run('UPDATE boards SET reassigned_to = ? WHERE id = ?', 'skipped', old.id); continue; }
      const id = newId('board'); const t = now();
      db.run('INSERT INTO boards(id, event_id, round_id, participant_id, state, version, selected_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)', id, round.event_id, round.id, old.participant_id, 'DRAFT', old.selected_json, t, t);
      db.run('UPDATE boards SET reassigned_to = ? WHERE id = ?', id, old.id);
      reassigned += 1;
      ctx.emit('board.saved', { eventId: round.event_id, roundId: round.id, roundVersion: version, participantId: old.participant_id, payload: { board: participantBoard(db, db.get('SELECT * FROM boards WHERE id = ?', id)), reassignedFrom: old.round_id } });
    }
    emitCounts(ctx, after, version);
    return { reassignedBoards: reassigned, audit: { reassignedBoards: reassigned } };
  }

  /** Atomic lock (BR-06/BR-07): READY -> LOCKED_ACTIVE, DRAFT -> DEFERRED, pool snapshot, one version increment. */
  function lockRound(ctx, round, version, eventType) {
    const t = now();
    const ready = boardsOfRound(db, round.id, ['READY']);
    const drafts = boardsOfRound(db, round.id, ['DRAFT']);
    db.run(`UPDATE boards SET state = 'LOCKED_ACTIVE', locked_at = ?, updated_at = ?, version = version + 1 WHERE round_id = ? AND state = 'READY'`, t, t, round.id);
    db.run(`UPDATE boards SET state = 'DEFERRED', deferred_reason = 'incomplete', updated_at = ?, version = version + 1 WHERE round_id = ? AND state = 'DRAFT'`, t, round.id);
    const active = activeBoardsWithCells(db, round.id, ['LOCKED_ACTIVE']);
    if (active.length !== ready.length) throw new Error('lock invariant: active count mismatch');
    const pool = buildDrawPool(active, SKILLS);
    const after = setRound(round, { version, state: 'LOCKED', locked_at: t, pool_json: json.str(pool) });
    ctx.emit(eventType, { eventId: round.event_id, roundId: round.id, roundVersion: version, payload: { round: roundSummary(after), activeBoards: active.length, deferredBoards: drafts.length } });
    for (const b of active) ctx.emit('board.locked_active', { eventId: round.event_id, roundId: round.id, roundVersion: version, participantId: b.participantId, payload: { board: participantBoard(db, db.get('SELECT * FROM boards WHERE id = ?', b.boardId)) } });
    for (const b of drafts) ctx.emit('board.deferred', { eventId: round.event_id, roundId: round.id, roundVersion: version, participantId: b.participant_id, payload: { board: participantBoard(db, db.get('SELECT * FROM boards WHERE id = ?', b.id)), reason: 'incomplete' } });
    emitCounts(ctx, after, version);
    return { activeBoards: active.length, deferredBoards: drafts.length, audit: { activeBoards: active.length, deferredBoards: drafts.length, poolSize: pool.length } };
  }

  /** LOCKED -> PLAYING. Never automatic; requires pool >= 5 (E20). */
  function startRound(ctx, round, version) {
    if (round.state !== 'LOCKED') throw new ApiError('ILLEGAL_TRANSITION', `cannot start from ${round.state}`);
    const pool = json.parse(round.pool_json, []);
    if (pool.length < POOL_MINIMUM) throw new ApiError('POOL_TOO_SMALL', null, { poolSize: pool.length, poolMinimum: POOL_MINIMUM });
    const after = setRound(round, { version, state: 'PLAYING', started_at: now() });
    ctx.emit('round.started', { eventId: round.event_id, roundId: round.id, roundVersion: version, payload: { round: roundSummary(after), poolSize: pool.length } });
    return { poolSize: pool.length, audit: { poolSize: pool.length } };
  }

  /** The draw transaction (BR-09..BR-15). Called inside withTx; any throw rolls everything back. */
  function drawNextSkill(ctx, round, version, meta) {
    const pool = json.parse(round.pool_json, []);
    const previous = drawsOf(db, round.id);
    const drawnSet = new Set(previous.map(d => d.skill_id));
    const remaining = pool.filter(s => !drawnSet.has(s));
    if (!remaining.length) throw new ApiError('POOL_EXHAUSTED');
    const number = previous.length + 1;
    const skillId = drawNext(remaining, rngForDraw(round, number));
    const drawId = newId('draw');
    const t = now();
    db.run('INSERT INTO draws(id, round_id, number, skill_id, drawn_at, command_id, matched_boards) VALUES (?, ?, ?, ?, ?, ?, 0)', drawId, round.id, number, skillId, t, meta.commandId ?? newId('command'));
    const boards = activeBoardsWithCells(db, round.id, ['LOCKED_ACTIVE']);
    drawnSet.add(skillId);
    const ev = evaluateDraw(boards, drawnSet, number, skillId);
    const matchedPositionsByParticipant = {};
    let matchedBoards = 0, fourInLine = 0;
    for (const m of ev.matches) {
      for (const pos of m.newlyMatched) db.run('INSERT INTO board_matches(board_id, draw_id, position, matched_at) VALUES (?, ?, ?, ?)', m.boardId, drawId, pos, t);
      if (m.matchedCount > 0) matchedBoards += 1;
      if (bestLineProgress(m.mask) >= 4) fourInLine += 1;
      matchedPositionsByParticipant[m.participantId] = positionsFromMask(m.mask);
    }
    db.run('UPDATE draws SET matched_boards = ? WHERE id = ?', matchedBoards, drawId);
    const draw = drawShape(db.get('SELECT * FROM draws WHERE id = ?', drawId));
    const poolRemaining = remaining.length - 1;
    const e = { eventId: round.event_id, roundId: round.id, roundVersion: version };
    let after;
    const effects = { draw, poolRemaining, matchedBoards };
    if (ev.winners.length) {
      after = setRound(round, { version, state: 'WINNER', published_at: t, ended_at: t });
      for (const w of ev.winners) db.run('INSERT INTO winners(round_id, participant_id, board_id, winning_draw_id, winning_draw_number, line_ids_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', round.id, w.participantId, w.boardId, drawId, number, json.str(w.lineIds), t);
    } else if (poolRemaining === 0) {
      after = setRound(round, { version, state: 'EXHAUSTED', ended_at: t });
    } else {
      after = setRound(round, { version });
    }
    ctx.emit('draw.accepted', { ...e, payload: { draw, poolRemaining, matchedBoards, bingoEvaluationActive: ev.evaluationActive, matchedPositionsByParticipant } });
    ctx.emit('draw.match_counts_updated', { ...e, payload: { drawNumber: number, matchedBoards, boardsWithFourInLine: fourInLine } });
    if (ev.winners.length) {
      const souls = finishRound(ctx, after, version, new Set(ev.winners.map(w => w.participantId)));
      const winners = ev.winners.map(w => { const p = getParticipant(db, w.participantId); return { participantId: w.participantId, label: winnerLabel(p), lineIds: w.lineIds, winningDrawNumber: number, soulId: souls.get(w.boardId) ?? null }; });
      ctx.emit('bingo.detected', { ...e, payload: { drawNumber: number, winnerCount: winners.length } });
      ctx.emit('result.published', { ...e, payload: { round: roundSummary(after), winners, resultWindowEndsAt: resultWindowEndsAt(after) } });
      emitSouls(ctx, after, version, souls);
      effects.winners = winners.map(({ soulId, ...w }) => w);
      effects.audit = { drawNumber: number, skillId, matchedBoards, winners: winners.map(w => w.participantId), outcome: 'WINNER' };
    } else if (poolRemaining === 0) {
      const souls = finishRound(ctx, after, version, new Set());
      ctx.emit('round.exhausted', { ...e, payload: { round: roundSummary(after) } });
      emitSouls(ctx, after, version, souls);
      effects.audit = { drawNumber: number, skillId, matchedBoards, outcome: 'EXHAUSTED' };
    } else {
      effects.audit = { drawNumber: number, skillId, matchedBoards };
    }
    emitCounts(ctx, after, version);
    return effects;
  }

  /**
   * Soul decoration inputs (D-29): kind counts of the 25 selected skills (charm split) and of the tiles matched at round end
   * (face). The v3 face plate, eyes and antenna charm (D-31) take nothing but the seed and the picked charms.
   */
  function soulInputs(board) {
    const selected = json.parse(board.selected_json, []);
    const matched = new Set(matchesOf(db, board.id));
    const matchedIds = cellsOf(db, board.id).filter(c => matched.has(c.position)).map(c => c.skillId);
    return { domainCounts: domainCounts(selected), selectedKinds: kindCounts(selected), matchedKinds: kindCounts(matchedIds) };
  }
  /** Round end: LOCKED_ACTIVE -> FINISHED and one Soul per finished board (BR-16), idempotent by board id. Returns Map boardId -> soulId. */
  function finishRound(ctx, round, version, winnerParticipantIds) {
    const t = now();
    const boards = boardsOfRound(db, round.id, ['LOCKED_ACTIVE']);
    db.run(`UPDATE boards SET state = 'FINISHED', finished_at = ?, updated_at = ?, version = version + 1 WHERE round_id = ? AND state = 'LOCKED_ACTIVE'`, t, t, round.id);
    const souls = new Map();
    for (const b of boards) {
      const existing = db.get('SELECT id FROM souls WHERE board_id = ?', b.id);
      if (existing) { souls.set(b.id, existing.id); continue; }
      const seed = soulSeed({ eventId: round.event_id, participantId: b.participant_id, roundId: round.id });
      // A SoulConfig v3 (contract 1.2.0). A bad decoration must never fail the final draw: any error or invalid config (such
      // as no skill kind counted, so no charms) gives the neutral Soul, which stays a v2 config (BR-17).
      let cfg = null, reason = null;
      try { cfg = decoratedSoulConfig(seed, soulInputs(b)); reason = validateSoulConfig(cfg).reason ?? null; } catch (e) { reason = e?.message || 'decoration failed'; }
      if (reason) { log?.warn('soul config rejected, neutral fallback', { boardId: b.id, reason }); cfg = neutralSoulConfig(seed); }
      const soulId = newId('soul');
      const token = randomToken(32);
      db.run('INSERT INTO souls(id, event_id, round_id, participant_id, board_id, seed, config_json, badge, float_token_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        soulId, round.event_id, round.id, b.participant_id, b.id, seed, json.str(cfg), winnerParticipantIds.has(b.participant_id) ? 'bingo-star' : null, encryptToken(config, token), t);
      db.run('INSERT INTO float_tokens(token_hash, soul_id, expires_at) VALUES (?, ?, ?)', sha256Hex(token), soulId, new Date(clock.now() + config.floatTokenTtlHours * 3600 * 1000).toISOString());
      souls.set(b.id, soulId);
    }
    return souls;
  }
  function emitSouls(ctx, round, version, souls) {
    for (const [boardId, soulId] of souls) {
      const s = db.get('SELECT participant_id FROM souls WHERE id = ?', soulId);
      ctx.emit('soul.created', { eventId: round.event_id, roundId: round.id, roundVersion: version, participantId: s.participant_id, payload: { soulId, boardId } });
    }
  }
  function emitCounts(ctx, round, version) {
    ctx.emit('participation.updated', { eventId: round.event_id, roundId: round.id, roundVersion: version, payload: { counts: countsOf(round) } });
  }

  /** Cancel with reason (A-07, E15): every non-finished board keeps its selections and becomes DEFERRED; no Souls. */
  function cancelRound(ctx, round, version, params) {
    if (typeof params.reason !== 'string' || !params.reason.trim()) throw new ApiError('REASON_REQUIRED', 'params.reason is required to cancel a round');
    const reason = params.reason.trim().slice(0, 500);
    const t = now();
    const affected = boardsOfRound(db, round.id, ['DRAFT', 'READY', 'LOCKED_ACTIVE']);
    db.run(`UPDATE boards SET state = 'DEFERRED', deferred_reason = 'cancelled', updated_at = ?, version = version + 1 WHERE round_id = ? AND state IN ('DRAFT','READY','LOCKED_ACTIVE')`, t, round.id);
    const after = setRound(round, { version, state: 'CANCELLED', cancellation_reason: reason, ended_at: t, closed_at: t });
    ctx.emit('round.cancelled', { eventId: round.event_id, roundId: round.id, roundVersion: version, payload: { round: roundSummary(after), reason } });
    for (const b of affected) ctx.emit('board.deferred', { eventId: round.event_id, roundId: round.id, roundVersion: version, participantId: b.participant_id, payload: { board: participantBoard(db, db.get('SELECT * FROM boards WHERE id = ?', b.id)), reason: 'cancelled' } });
    emitCounts(ctx, after, version);
    return { deferredBoards: affected.length, audit: { reason, deferredBoards: affected.length } };
  }

  function closeRound(ctx, round, version, by) {
    const after = setRound(round, { version, state: 'CLOSED', closed_at: now() });
    ctx.emit('round.closed', { eventId: round.event_id, roundId: round.id, roundVersion: version, payload: { round: roundSummary(after) } });
    return { audit: { closedBy: by } };
  }

  // ---- timer-driven transitions (actor = system) ------------------------------------------------------------
  function lockByTimer(roundId) {
    const meta = { actor: 'system', correlationId: newId('correlation'), commandId: newId('command') };
    try {
      return withTx(meta, (ctx) => {
        const round = getRound(db, roundId);
        if (!round || round.state !== 'REGISTRATION_OPEN' || !round.lock_at || Date.parse(round.lock_at) > clock.now()) return null;
        const version = round.version + 1;
        const eff = lockRound(ctx, round, version, 'round.locked');
        audit({ eventId: round.event_id, roundId, actor: 'system', action: 'round.lock', target: roundId, expectedVersion: round.version, actualVersion: version, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { trigger: 'lockAt timer', ...eff.audit } });
        return eff;
      });
    } catch (e) {
      log?.error('timer lock failed', { roundId, error: e.message, correlationId: meta.correlationId });
      audit({ roundId, actor: 'system', action: 'round.lock', target: roundId, outcome: 'rejected', correlationId: meta.correlationId, details: { trigger: 'lockAt timer', code: 'E19', message: e.message } });
      return null;
    }
  }
  function closeByTimer(roundId) {
    const meta = { actor: 'system', correlationId: newId('correlation'), commandId: newId('command') };
    return withTx(meta, (ctx) => {
      const round = getRound(db, roundId);
      if (!round || round.state !== 'WINNER') return null;
      const ends = resultWindowEndsAt(round);
      if (!ends || Date.parse(ends) > clock.now()) return null;
      const version = round.version + 1;
      closeRound(ctx, round, version, 'timer');
      audit({ eventId: round.event_id, roundId, actor: 'system', action: 'round.close', target: roundId, expectedVersion: round.version, actualVersion: version, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { trigger: 'resultWindow timer' } });
      return true;
    });
  }
  /** Start-grace warning (OD-04): flag once; no version change, no automatic start. */
  function markOverdue(roundId) {
    const meta = { actor: 'system', correlationId: newId('correlation') };
    return withTx(meta, (ctx) => {
      const round = getRound(db, roundId);
      if (!round || round.state !== 'LOCKED' || round.overdue_notified || !round.locked_at) return null;
      if (clock.now() - Date.parse(round.locked_at) < config.startGraceSeconds * 1000) return null;
      db.run('UPDATE rounds SET overdue_notified = 1 WHERE id = ?', roundId);
      ctx.emit('round.updated', { eventId: round.event_id, roundId, roundVersion: round.version, payload: { round: roundSummary(round), startOverdue: true } });
      audit({ eventId: round.event_id, roundId, actor: 'system', action: 'round.start_overdue', target: roundId, actualVersion: round.version, outcome: 'accepted', correlationId: meta.correlationId, details: { graceSeconds: config.startGraceSeconds } });
      return true;
    });
  }

  return { ensureEvent, createRound, command, countsOf, readinessOf, lockByTimer, closeByTimer, markOverdue, withTx, audit, rngForBoard, shuffleBoard: (ids) => shuffle(ids, rngForBoard(ids)) };
}
