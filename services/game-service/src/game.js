// Authoritative round logic. Every mutation runs in one BEGIN IMMEDIATE transaction; realtime events are written to the
// outbox inside the transaction and handed to the SSE hub only after COMMIT (D-08, requirement 7.1 / 15.1).
import { json } from './db.js';
import { ApiError, isApiError } from './errors.js';
import { newId, sha256Hex, randomToken } from './ids.js';
import { encryptToken } from './auth.js';
import { SKILLS, domainCounts, kindCounts, MATRIX_VERSION } from './skills.js';
import {
  getRound, getEvent, roundSummary, drawShape, activeBoardsWithCells, drawsOf, boardsOfRound, cellsOf, matchesOf, winnerLabel,
  resultWindowEndsAt, latestSequence, boardOf, participantBoard, getParticipant,
} from './queries.js';
import {
  isCommandAllowed, buildDrawPool, readiness as poolReadiness, guidedDraw, drawNext, evaluateDraw, positionsFromMask, bestLineProgress,
  secureRng, seededRng, POOL_MINIMUM, GRID, soulSeed, randomizePartialBoard, bestLineProgress as lineProgress, LINE_MASKS, decoratedSoulConfig, validateSoulConfig, neutralSoulConfig, shuffle,
} from '../../../packages/game-rules/src/index.js';

// D-53: no round.lock / round.start / round.close - the start time (or Start now) closes registration and starts play in one step.
export const COMMANDS = ['round.update', 'round.registration.open', 'round.reschedule', 'round.start_now', 'round.draw.next', 'round.cancel'];

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
    const startOverdue = false; // D-53: no LOCKED state, so nothing can be overdue
    const lockCountdownMs = round.state === 'REGISTRATION_OPEN' && round.lock_at ? Math.max(0, Date.parse(round.lock_at) - clock.now()) : null;
    const startBlocked = round.state === 'REGISTRATION_OPEN' && !!round.overdue_notified; // start time passed but the pool was too small (E20)
    return { poolSize: r.poolSize, poolMinimum: POOL_MINIMUM, anyBoardCanWin: r.anyBoardCanWin, boardsThatCanWin: r.boardsThatCanWin, startOverdue, lockCountdownMs, startBlocked, unfinishedBoards: unfinishedBoardsOf(round), pool: r.pool };
  }
  /**
   * Unfinished boards (D-53 admin alert): boards of this round still under 16 skills, plus players who joined while the
   * round was open and have not picked anything yet.
   */
  function unfinishedBoardsOf(round) {
    if (round.state !== 'REGISTRATION_OPEN') return 0;
    const drafts = db.get(`SELECT COUNT(*) AS c FROM boards WHERE round_id = ? AND state = 'DRAFT'`, round.id).c;
    const since = round.opened_at || round.updated_at;
    const noBoard = db.get(`SELECT COUNT(*) AS c FROM participants p WHERE p.event_id = ? AND p.created_at >= ? AND NOT EXISTS (SELECT 1 FROM boards b WHERE b.participant_id = p.id AND b.round_id = ?)`, round.event_id, since, round.id).c;
    return drafts + noBoard;
  }

  // ---- round create --------------------------------------------------------------------------------------
  function createRound(eventId, body, meta) {
    const event = getEvent(db, eventId);
    if (!event) throw new ApiError('NOT_FOUND', 'event not found');
    if (typeof body?.title !== 'string' || !body.title.trim() || body.title.length > 120) throw new ApiError('VALIDATION', 'title required (1-120 chars)');
    const delay = body.startInMinutes;
    if (delay !== undefined && (!Number.isInteger(delay) || delay < 1 || delay > 240)) throw new ApiError('VALIDATION', 'startInMinutes must be an integer 1-240');
    if (delay === undefined && !isIso(body.lockAt)) throw new ApiError('VALIDATION', 'give lockAt (ISO-8601 start time) or startInMinutes');
    if (body.resultWindowSeconds !== undefined && !Number.isInteger(body.resultWindowSeconds)) throw new ApiError('VALIDATION', 'resultWindowSeconds must be an integer');
    return withTx(meta, (ctx) => {
      const number = (db.get('SELECT COALESCE(MAX(number), 0) AS n FROM rounds WHERE event_id = ?', eventId).n) + 1;
      const id = newId('round');
      const t = now();
      db.run('INSERT INTO rounds(id, event_id, number, title, state, version, lock_at, start_delay_minutes, result_window_seconds, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)',
        id, eventId, number, body.title.trim(), 'DRAFT', delay === undefined ? new Date(Date.parse(body.lockAt)).toISOString() : null, delay ?? null, clampWindow(body.resultWindowSeconds, config), t, t);
      const round = getRound(db, id);
      ctx.emit('round.created', { eventId, roundId: id, roundVersion: 1, payload: { round: roundSummary(round) } });
      audit({ eventId, roundId: id, actor: meta.actor, action: 'round.create', target: id, actualVersion: 1, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { title: round.title, lockAt: round.lock_at, startInMinutes: round.start_delay_minutes ?? null } });
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
          case 'round.start_now': {
            if (params.confirmed !== true) throw new ApiError('VALIDATION', 'round.start_now requires params.confirmed === true', { confirmed: params.confirmed ?? null });
            effects = startGame(ctx, round, version, 'admin');
            break;
          }
          case 'round.draw.next': effects = drawNextSkill(ctx, round, version, meta); break;
          case 'round.cancel': effects = cancelRound(ctx, round, version, params); break;
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
      if (expectState === 'DRAFT') fields.start_delay_minutes = null;
    }
    if (params.startInMinutes !== undefined && expectState === 'DRAFT') {
      if (!Number.isInteger(params.startInMinutes) || params.startInMinutes < 1 || params.startInMinutes > 240) throw new ApiError('VALIDATION', 'startInMinutes must be an integer 1-240');
      fields.start_delay_minutes = params.startInMinutes; fields.lock_at = null;
    }
    if (params.extendMinutes !== undefined && expectState === 'REGISTRATION_OPEN') {
      // D-53 Extend (+1/+3/+5/+10/+15): from the current start time, or from now when it has already passed
      if (!Number.isInteger(params.extendMinutes) || params.extendMinutes < 1 || params.extendMinutes > 60) throw new ApiError('VALIDATION', 'extendMinutes must be an integer 1-60');
      const base = Math.max(round.lock_at ? Date.parse(round.lock_at) : 0, clock.now());
      fields.lock_at = new Date(base + params.extendMinutes * 60 * 1000).toISOString();
    }
    if (expectState === 'REGISTRATION_OPEN' && fields.lock_at) fields.overdue_notified = 0; // a new start time clears startBlocked
    if (params.resultWindowSeconds !== undefined) { if (!Number.isInteger(params.resultWindowSeconds)) throw new ApiError('VALIDATION', 'resultWindowSeconds must be an integer'); fields.result_window_seconds = clampWindow(params.resultWindowSeconds, config); }
    const after = setRound(round, fields);
    ctx.emit('round.updated', { eventId: round.event_id, roundId: round.id, roundVersion: version, payload: { round: roundSummary(after) } });
    return { audit: { changed: Object.keys(fields).filter(k => k !== 'version') } };
  }

  /** DRAFT -> REGISTRATION_OPEN. Reassigns every not-yet-reassigned DEFERRED board of the event into this round as a DRAFT board. */
  function openRegistration(ctx, round, version) {
    const delay = round.start_delay_minutes;
    if (!delay && (!round.lock_at || Date.parse(round.lock_at) <= clock.now())) throw new ApiError('VALIDATION', 'lockAt must be in the future to open registration', { lockAt: round.lock_at });
    const opened = { version, state: 'REGISTRATION_OPEN', opened_at: now(), overdue_notified: 0 };
    if (delay) opened.lock_at = new Date(clock.now() + delay * 60 * 1000).toISOString(); // D-53: "start in X minutes" counts from opening
    const after = setRound(round, opened);
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

  /**
   * Start (D-53): one atomic step from REGISTRATION_OPEN to PLAYING, by the start-time timer or Start now.
   * READY boards play; DRAFT boards with 1-15 skills play too (skills at random positions, blank spots never match);
   * DRAFT boards without a skill are DEFERRED for the next round. Needs a pool of POOL_MINIMUM skills (E20), else the
   * whole transaction rolls back and the round stays open.
   */
  function startGame(ctx, round, version, trigger) {
    const t = now();
    const drafts = boardsOfRound(db, round.id, ['DRAFT']);
    const partial = drafts.filter(b => json.parse(b.selected_json, []).length > 0);
    const empty = drafts.filter(b => json.parse(b.selected_json, []).length === 0);
    for (const b of partial) {
      const ids = json.parse(b.selected_json, []);
      db.run('DELETE FROM board_cells WHERE board_id = ?', b.id);
      for (const c of randomizePartialBoard(ids, rngForBoard(ids))) db.run('INSERT INTO board_cells(board_id, position, skill_id) VALUES (?, ?, ?)', b.id, c.position, c.skillId);
      db.run(`UPDATE boards SET state = 'LOCKED_ACTIVE', matrix_version = ?, randomized_at = ?, locked_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`, MATRIX_VERSION, t, t, t, b.id);
    }
    db.run(`UPDATE boards SET state = 'LOCKED_ACTIVE', locked_at = ?, updated_at = ?, version = version + 1 WHERE round_id = ? AND state = 'READY'`, t, t, round.id);
    db.run(`UPDATE boards SET state = 'DEFERRED', deferred_reason = 'incomplete', updated_at = ?, version = version + 1 WHERE round_id = ? AND state = 'DRAFT'`, t, round.id);
    const active = activeBoardsWithCells(db, round.id, ['LOCKED_ACTIVE']);
    const pool = buildDrawPool(active, SKILLS);
    if (pool.length < POOL_MINIMUM) throw new ApiError('POOL_TOO_SMALL', null, { poolSize: pool.length, poolMinimum: POOL_MINIMUM });
    const after = setRound(round, { version, state: 'PLAYING', locked_at: t, started_at: t, pool_json: json.str(pool) });
    for (const b of active) ctx.emit('board.locked_active', { eventId: round.event_id, roundId: round.id, roundVersion: version, participantId: b.participantId, payload: { board: participantBoard(db, db.get('SELECT * FROM boards WHERE id = ?', b.boardId)) } });
    for (const b of empty) ctx.emit('board.deferred', { eventId: round.event_id, roundId: round.id, roundVersion: version, participantId: b.participant_id, payload: { board: participantBoard(db, db.get('SELECT * FROM boards WHERE id = ?', b.id)), reason: 'incomplete' } });
    ctx.emit('round.started', { eventId: round.event_id, roundId: round.id, roundVersion: version, payload: { round: roundSummary(after), poolSize: pool.length, activeBoards: active.length, unfinishedBoards: partial.length, deferredBoards: empty.length } });
    emitCounts(ctx, after, version);
    return { activeBoards: active.length, unfinishedBoards: partial.length, deferredBoards: empty.length, poolSize: pool.length, audit: { trigger, activeBoards: active.length, unfinishedBoards: partial.length, deferredBoards: empty.length, poolSize: pool.length } };
  }

  /** The draw transaction (BR-09..BR-15). Called inside withTx; any throw rolls everything back. */
  function drawNextSkill(ctx, round, version, meta) {
    const pool = json.parse(round.pool_json, []);
    const previous = drawsOf(db, round.id);
    const drawnSet = new Set(previous.map(d => d.skill_id));
    const remaining = pool.filter(s => !drawnSet.has(s));
    if (!remaining.length) throw new ApiError('POOL_EXHAUSTED');
    const number = previous.length + 1;
    const boards = activeBoardsWithCells(db, round.id, ['LOCKED_ACTIVE']);
    const rng = rngForDraw(round, number);
    const pick = config.drawGuidance ? guidedDraw(remaining, boards, drawnSet, number, rng) : { skillId: drawNext(remaining, rng), mode: 'random' };
    const skillId = pick.skillId;
    const drawId = newId('draw');
    const t = now();
    db.run('INSERT INTO draws(id, round_id, number, skill_id, drawn_at, command_id, matched_boards) VALUES (?, ?, ?, ?, ?, ?, 0)', drawId, round.id, number, skillId, t, meta.commandId ?? newId('command'));
    drawnSet.add(skillId);
    const ev = evaluateDraw(boards, drawnSet, number, skillId);
    // D-53: every round has a winner. With the pool empty and no full line (unfinished boards have blank spots), the
    // boards with the most matched tiles in one line win; ties are co-winners. lineIds name those best lines.
    if (!ev.winners.length && remaining.length - 1 === 0) {
      const best = ev.matches.map(m => ({ m, n: lineProgress(m.mask) }));
      const top = Math.max(0, ...best.map(x => x.n));
      if (top > 0) for (const { m, n } of best) if (n === top) ev.winners.push({ boardId: m.boardId, participantId: m.participantId, lineIds: LINE_MASKS.filter(l => l.positions.filter(p => m.mask & (1 << p)).length === top).map(l => l.id), closest: true });
    }
    const matchedPositionsByParticipant = {};
    let matchedBoards = 0, fourInLine = 0;
    for (const m of ev.matches) {
      for (const pos of m.newlyMatched) db.run('INSERT INTO board_matches(board_id, draw_id, position, matched_at) VALUES (?, ?, ?, ?)', m.boardId, drawId, pos, t);
      if (m.matchedCount > 0) matchedBoards += 1;
      if (bestLineProgress(m.mask) >= GRID - 1) fourInLine += 1;
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
      for (const w of ev.winners) db.run('INSERT INTO winners(round_id, participant_id, board_id, winning_draw_id, winning_draw_number, line_ids_json, closest, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', round.id, w.participantId, w.boardId, drawId, number, json.str(w.lineIds), w.closest ? 1 : 0, t);
    } else {
      after = setRound(round, { version });
    }
    ctx.emit('draw.accepted', { ...e, payload: { draw, poolRemaining, matchedBoards, bingoEvaluationActive: ev.evaluationActive, matchedPositionsByParticipant } });
    ctx.emit('draw.match_counts_updated', { ...e, payload: { drawNumber: number, matchedBoards, boardsWithFourInLine: fourInLine } });
    if (ev.winners.length) {
      const souls = finishRound(ctx, after, version, new Set(ev.winners.map(w => w.participantId)));
      const winners = ev.winners.map(w => { const p = getParticipant(db, w.participantId); return { participantId: w.participantId, label: winnerLabel(p), lineIds: w.lineIds, winningDrawNumber: number, closest: !!w.closest, soulId: souls.get(w.boardId) ?? null }; });
      ctx.emit('bingo.detected', { ...e, payload: { drawNumber: number, winnerCount: winners.length } });
      ctx.emit('result.published', { ...e, payload: { round: roundSummary(after), winners, resultWindowEndsAt: resultWindowEndsAt(after) } });
      emitSouls(ctx, after, version, souls);
      effects.winners = winners.map(({ soulId, ...w }) => w);
      effects.audit = { drawNumber: number, skillId, drawMode: pick.mode, matchedBoards, winners: winners.map(w => w.participantId), outcome: 'WINNER' };
    } else {
      effects.audit = { drawNumber: number, skillId, drawMode: pick.mode, matchedBoards };
    }
    emitCounts(ctx, after, version);
    return effects;
  }

  /**
   * Soul decoration inputs (D-29): kind counts of the 16 selected skills (charm split) and of the tiles matched at round end
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
  /** Start time reached (D-53): start the round like Start now. A too-small pool keeps it open once (startBlocked). */
  function startByTimer(roundId) {
    const meta = { actor: 'system', correlationId: newId('correlation'), commandId: newId('command') };
    try {
      return withTx(meta, (ctx) => {
        const round = getRound(db, roundId);
        if (!round || round.state !== 'REGISTRATION_OPEN' || round.overdue_notified || !round.lock_at || Date.parse(round.lock_at) > clock.now()) return null;
        const version = round.version + 1;
        const eff = startGame(ctx, round, version, 'start-time timer');
        audit({ eventId: round.event_id, roundId, actor: 'system', action: 'round.start', target: roundId, expectedVersion: round.version, actualVersion: version, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { trigger: 'start-time timer', ...eff.audit } });
        return eff;
      });
    } catch (e) {
      const blocked = isApiError(e) && e.code === 'POOL_TOO_SMALL';
      // Only a too-small pool blocks the start (the admin must extend); any other failure is logged and retried next tick.
      if (!blocked) { log?.error('timer start failed', { roundId, error: e.message, correlationId: meta.correlationId }); return null; }
      withTx(meta, (ctx) => {
        const round = getRound(db, roundId);
        if (!round || round.state !== 'REGISTRATION_OPEN') return;
        db.run('UPDATE rounds SET overdue_notified = 1 WHERE id = ?', roundId); // startBlocked until the start time changes
        ctx.emit('round.updated', { eventId: round.event_id, roundId, roundVersion: round.version, payload: { round: roundSummary(getRound(db, roundId)), startBlocked: true } });
        audit({ eventId: round.event_id, roundId, actor: 'system', action: 'round.start', target: roundId, outcome: 'rejected', correlationId: meta.correlationId, details: { trigger: 'start-time timer', code: 'E20', message: e.message } });
      });
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
  // ---- delete / reset (D-53) -----------------------------------------------------------------------------------
  /** Removes one round's data in foreign-key order. Outbox rows stay (sequence numbers must never be reused). */
  function purgeRound(roundId) {
    const boardIds = `SELECT id FROM boards WHERE round_id = ?`;
    const counts = {
      boards: db.get('SELECT COUNT(*) AS c FROM boards WHERE round_id = ?', roundId).c,
      draws: db.get('SELECT COUNT(*) AS c FROM draws WHERE round_id = ?', roundId).c,
      winners: db.get('SELECT COUNT(*) AS c FROM winners WHERE round_id = ?', roundId).c,
      souls: db.get('SELECT COUNT(*) AS c FROM souls WHERE round_id = ?', roundId).c,
    };
    db.run(`DELETE FROM board_matches WHERE board_id IN (${boardIds})`, roundId);
    db.run('DELETE FROM winners WHERE round_id = ?', roundId);
    db.run('DELETE FROM float_tokens WHERE soul_id IN (SELECT id FROM souls WHERE round_id = ?)', roundId);
    db.run('DELETE FROM souls WHERE round_id = ?', roundId);
    db.run('DELETE FROM draws WHERE round_id = ?', roundId);
    db.run(`UPDATE boards SET reassigned_to = NULL WHERE reassigned_to IN (${boardIds})`, roundId);
    db.run(`DELETE FROM board_cells WHERE board_id IN (${boardIds})`, roundId);
    db.run('DELETE FROM boards WHERE round_id = ?', roundId);
    db.run('DELETE FROM rounds WHERE id = ?', roundId);
    return counts;
  }

  /** DELETE /admin/rounds/{roundId} (D-53): any state; removes boards, draws, winners, Souls; emits round.deleted. */
  function deleteRound(roundId, meta) {
    return withTx(meta, (ctx) => {
      const round = getRound(db, roundId);
      if (!round) throw new ApiError('NOT_FOUND', 'round not found');
      const counts = purgeRound(roundId);
      ctx.emit('round.deleted', { eventId: round.event_id, roundId: null, payload: { roundId, number: round.number } });
      audit({ eventId: round.event_id, roundId, actor: meta.actor, action: 'round.delete', target: roundId, expectedVersion: round.version, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { number: round.number, title: round.title, state: round.state, ...counts } });
      return { deleted: true, roundId, ...counts };
    });
  }

  /** POST /admin/events/{eventId}/reset (D-53): every round, player and Soul of the event. Production only in testing mode (D-56). */
  function resetEvent(eventId, meta) {
    if (config.testModeLocked) throw new ApiError('FORBIDDEN', 'clearing all data is locked on this server (BINGO_ALLOW_RESET=off)');
    if (!getEvent(db, eventId)?.test_mode) throw new ApiError('FORBIDDEN', 'turn on test mode in Mission Control before clearing all data');
    return withTx(meta, (ctx) => {
      if (!getEvent(db, eventId)) throw new ApiError('NOT_FOUND', 'event not found');
      const rounds = db.all('SELECT id FROM rounds WHERE event_id = ?', eventId);
      const totals = { rounds: rounds.length, boards: 0, draws: 0, winners: 0, souls: 0 };
      for (const r of rounds) { const c = purgeRound(r.id); for (const k of ['boards', 'draws', 'winners', 'souls']) totals[k] += c[k]; }
      totals.participants = db.get('SELECT COUNT(*) AS c FROM participants WHERE event_id = ?', eventId).c;
      db.run('DELETE FROM boards WHERE event_id = ?', eventId);
      db.run('DELETE FROM sessions WHERE participant_id IN (SELECT id FROM participants WHERE event_id = ?)', eventId);
      db.run('DELETE FROM participants WHERE event_id = ?', eventId);
      ctx.emit('event.reset', { eventId, roundId: null, payload: {} });
      audit({ eventId, actor: meta.actor, action: 'event.reset', target: eventId, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { ...totals, env: config.env } });
      return { reset: true, ...totals };
    });
  }

  /** POST /admin/events/{eventId}/test-mode {enabled} (D-56): turns test mode on or off; refused on when the server locks it. */
  function setTestMode(eventId, body, meta) {
    if (typeof body?.enabled !== 'boolean') throw new ApiError('VALIDATION', 'enabled (boolean) required');
    if (body.enabled && config.testModeLocked) throw new ApiError('FORBIDDEN', 'test mode is locked on this server (BINGO_ALLOW_RESET=off)');
    return withTx(meta, (ctx) => {
      db.run('UPDATE events SET test_mode = ? WHERE id = ?', body.enabled ? 1 : 0, eventId);
      ctx.emit('event.updated', { eventId, roundId: null, payload: { testMode: body.enabled } });
      audit({ eventId, actor: meta.actor, action: 'event.test_mode', target: eventId, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { enabled: body.enabled, env: config.env } });
      return { testMode: body.enabled };
    });
  }

  return { ensureEvent, createRound, command, countsOf, readinessOf, startByTimer, closeByTimer, deleteRound, resetEvent, setTestMode, withTx, audit, rngForBoard, shuffleBoard: (ids) => shuffle(ids, rngForBoard(ids)) };
}
