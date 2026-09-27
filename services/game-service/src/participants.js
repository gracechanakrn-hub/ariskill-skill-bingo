// Participant-side operations: session, profile, taxonomy, discovery, board save/finalize, private insight, Soul float.
// The server is authoritative: clients never supply positions, matches, draws, time or Float state.
import { json } from './db.js';
import { ApiError } from './errors.js';
import { exception } from '../../../packages/contracts/index.js';
import { newId, sha256Hex } from './ids.js';
import { verifyJoinToken, issueSession, employeeRefHash, decryptToken } from './auth.js';
import { SKILLS, SKILL_MASTER, PLATFORMS, ROLES, PLATFORM_BY_ID, ROLE_BY_ID, ROLE_SKILL_LEVELS, MATRIX_FREQUENCY, MATRIX_VERSION, discoverySkill, roleSkillSet } from './skills.js';
import { activeRound, boardOf, getBoard, participantBoard, roundSummary, winnerLabel, soulEntranceEdge, getRound, publicEntrance } from './queries.js';
import { validateSelections, isComplete, REQUIRED_SELECTIONS, matrixInsight, checkGreeting } from '../../../packages/game-rules/src/index.js';

const LEVEL_ORDER = { core: 0, critical: 1, optional: 2 };
/** Discovery lists; 'core' and 'role' feed picker questions 1 and 2 (D-35). */
export const DISCOVERY_MODES = ['core', 'role', 'recommended', 'popular', 'search'];
const CORE_KIND = 'Core Skill';

export function createParticipants({ db, clock, config, game, log }) {
  const now = () => clock.iso();

  // ---- session ----------------------------------------------------------------------------------------------
  function createSession(eventId, body, meta) {
    const event = db.get('SELECT * FROM events WHERE id = ?', eventId);
    if (!event) throw new ApiError('NOT_FOUND', 'event not found');
    const { joinToken, employeeRef, displayName, consentPublicName } = body ?? {};
    const tok = verifyJoinToken(config.joinSecret, joinToken, clock.now());
    if (tok.eventId !== eventId) throw new ApiError('TOKEN_EXPIRED');
    if (typeof employeeRef !== 'string' || !employeeRef.trim() || employeeRef.length > 200) throw new ApiError('VALIDATION', 'employeeRef required (1-200 chars)');
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.length > 80) throw new ApiError('VALIDATION', 'displayName required (1-80 chars)');
    if (typeof consentPublicName !== 'boolean') throw new ApiError('VALIDATION', 'consentPublicName must be a boolean');
    const refHash = employeeRefHash(config, eventId, employeeRef);
    return db.transaction(() => {
      let p = db.get('SELECT * FROM participants WHERE event_id = ? AND employee_ref_hash = ?', eventId, refHash);
      const t = now();
      if (!p) {
        const id = newId('participant');
        db.run('INSERT INTO participants(id, event_id, employee_ref_hash, display_name, consent_public_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, eventId, refHash, displayName.trim(), consentPublicName ? 1 : 0, t, t);
        p = db.get('SELECT * FROM participants WHERE id = ?', id);
      } else {
        db.run('UPDATE participants SET display_name = ?, consent_public_name = ?, updated_at = ? WHERE id = ?', displayName.trim(), consentPublicName ? 1 : 0, t, p.id);
      }
      const s = issueSession(db, config, clock, p.id, eventId);
      game.audit({ eventId, actor: p.id, action: 'session.create', target: p.id, outcome: 'accepted', correlationId: meta.correlationId, details: { consentPublicName } });
      return { sessionToken: s.sessionToken, participantId: p.id, eventId, expiresAt: s.expiresAt };
    });
  }

  // ---- taxonomy + profile ------------------------------------------------------------------------------------
  function taxonomy() { return { platforms: PLATFORMS, roles: ROLES, matrixVersion: MATRIX_VERSION }; }
  function setProfile(participant, body, meta) {
    const { platformId, roleId } = body ?? {};
    if (typeof platformId !== 'string' || !PLATFORM_BY_ID.has(platformId)) throw new ApiError('VALIDATION', 'platformId must be an explicit valid platform id');
    const role = typeof roleId === 'string' ? ROLE_BY_ID.get(roleId) : null;
    if (!role) throw new ApiError('VALIDATION', 'roleId must be an explicit valid role id');
    if (role.platformId !== platformId) throw new ApiError('VALIDATION', 'roleId does not belong to platformId', { platformId, roleId });
    db.run('UPDATE participants SET platform_id = ?, role_id = ?, updated_at = ? WHERE id = ?', platformId, roleId, now(), participant.id);
    game.audit({ eventId: participant.event_id, actor: participant.id, action: 'profile.set', target: participant.id, outcome: 'accepted', correlationId: meta.correlationId, details: { platformId, roleId } });
    return { participant: participantSelf(db.get('SELECT * FROM participants WHERE id = ?', participant.id)) };
  }
  function participantSelf(p) { return { participantId: p.id, displayName: p.display_name, consentPublicName: !!p.consent_public_name, platformId: p.platform_id, roleId: p.role_id }; }
  /** Participant projection view (EO-02, P-04): adds publicLabel, exactly what public/stage screens would show for this participant. */
  function participantProjected(p) { return { ...participantSelf(p), publicLabel: winnerLabel(p) }; }
  function requireProfile(p) { if (!p.platform_id || !p.role_id) throw new ApiError('PROFILE_REQUIRED'); }

  // ---- discovery (BR-03) ----------------------------------------------------------------------------------------
  function discovery(participant, query) {
    requireProfile(participant);
    const mode = query.mode ?? 'recommended';
    if (!DISCOVERY_MODES.includes(mode)) throw new ApiError('VALIDATION', `mode must be ${DISCOVERY_MODES.join('|')}`);
    let limit = Number.parseInt(query.limit ?? '', 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    limit = Math.min(limit, SKILL_MASTER.skills.length);
    const roleId = participant.role_id;
    let skills;
    if (mode === 'core') {
      // Picker question 1 (D-35): the organisation's Core Skill kind, alphabetical.
      skills = SKILL_MASTER.skills.filter(s => s.status === 'active' && s.kind === CORE_KIND).sort((a, b) => a.name.localeCompare(b.name));
    } else if (mode === 'recommended' || mode === 'role') {
      const levels = ROLE_SKILL_LEVELS.get(roleId) ?? new Map();
      skills = [...levels.entries()].map(([id, level]) => ({ s: SKILLS.get(id), level })).filter(x => x.s && x.s.status === 'active')
        .sort((a, b) => (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || a.s.name.localeCompare(b.s.name)).map(x => x.s);
      // Picker question 2 (D-35): the role's skills without the core ones already asked in question 1.
      if (mode === 'role') skills = skills.filter(s => s.kind !== CORE_KIND);
    } else if (mode === 'popular') {
      const counts = new Map();
      for (const row of db.all('SELECT selected_json FROM boards WHERE event_id = ?', participant.event_id)) for (const id of json.parse(row.selected_json, [])) counts.set(id, (counts.get(id) ?? 0) + 1);
      const useMatrix = counts.size === 0;
      skills = SKILL_MASTER.skills.filter(s => s.status === 'active').map(s => ({ s, n: useMatrix ? (MATRIX_FREQUENCY.get(s.id) ?? 0) : (counts.get(s.id) ?? 0) }))
        .filter(x => x.n > 0).sort((a, b) => b.n - a.n || a.s.name.localeCompare(b.s.name)).map(x => x.s);
    } else {
      const q = String(query.q ?? '').trim().toLowerCase();
      skills = SKILL_MASTER.skills.filter(s => s.status === 'active' && (!q || [s.name, s.domain, s.cluster].some(v => String(v ?? '').toLowerCase().includes(q)))).sort((a, b) => a.name.localeCompare(b.name));
    }
    const board = currentBoard(participant);
    const selectedCount = board ? json.parse(board.selected_json, []).length : 0;
    return { mode, skills: skills.slice(0, limit).map(s => discoverySkill(s, roleId)), selectedCount };
  }

  // ---- board helpers ------------------------------------------------------------------------------------------------
  /** Board in the event's active round if present, else the participant's most recent board. */
  function currentBoard(participant) {
    const ar = activeRound(db, participant.event_id);
    if (ar) { const b = boardOf(db, ar.id, participant.id); if (b) return b; }
    return db.get('SELECT * FROM boards WHERE participant_id = ? ORDER BY created_at DESC LIMIT 1', participant.id) ?? null;
  }
  /** The round that accepts saves for this participant, or throws ROUND_LOCKED (BR-05/BR-07). */
  function editableRound(participant) {
    const ar = activeRound(db, participant.event_id);
    if (!ar) throw new ApiError('ROUND_LOCKED', 'The next Skill Bingo hasn\'t been scheduled yet.', { reason: 'no-round' }, 'E1');
    if (!['DRAFT', 'REGISTRATION_OPEN'].includes(ar.state)) throw new ApiError('ROUND_LOCKED', null, { roundId: ar.id, state: ar.state });
    if (ar.lock_at && Date.parse(ar.lock_at) <= clock.now()) throw new ApiError('ROUND_LOCKED', null, { roundId: ar.id, state: ar.state, lockAt: ar.lock_at });
    return ar;
  }
  function assertBoardVersion(board, boardVersion) {
    if (!Number.isInteger(boardVersion)) throw new ApiError('VALIDATION', 'boardVersion (integer) required');
    const current = board ? board.version : 0;
    if (boardVersion !== current) throw new ApiError('STALE_VERSION', null, { currentVersion: current, snapshot: participantBoard(db, board) });
  }

  /** PUT /me/board/selections (BR-02, D-12, F-01 late deferral). */
  function saveSelections(participant, body, meta) {
    requireProfile(participant);
    const skillIds = body?.skillIds;
    const v = validateSelections(skillIds, SKILLS);
    if (!v.ok) throw new ApiError(v.code, v.message, null, v.exceptionId ?? null);
    const ar = activeRound(db, participant.event_id);
    if (ar && ['LOCKED', 'PLAYING', 'WINNER', 'EXHAUSTED'].includes(ar.state)) {
      // No round can accept a board (a newer DRAFT round would have been the active round). Persist the draft as DEFERRED(late)
      // so it is reassigned when the next registration opens (BR-06, E8, AC-9); boards already in play stay immutable.
      const existing = boardOf(db, ar.id, participant.id);
      if (existing) throw new ApiError('ROUND_LOCKED', null, { roundId: ar.id, state: ar.state, boardState: existing.state });
      return saveLateDeferred(participant, ar, skillIds, body.boardVersion, meta);
    }
    const round = editableRound(participant);
    return game.withTx(meta, (ctx) => {
      let board = boardOf(db, round.id, participant.id);
      assertBoardVersion(board, body.boardVersion);
      const t = now();
      if (!board) {
        const id = newId('board');
        db.run('INSERT INTO boards(id, event_id, round_id, participant_id, state, version, selected_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)', id, participant.event_id, round.id, participant.id, 'DRAFT', json.str(skillIds), t, t);
        board = getBoard(db, id);
      } else {
        const same = JSON.stringify(json.parse(board.selected_json, [])) === JSON.stringify(skillIds);
        if (same) return { board: participantBoard(db, board), resultingVersion: board.version, noop: true };
        if (board.state === 'DEFERRED' || board.state === 'LOCKED_ACTIVE' || board.state === 'FINISHED') throw new ApiError('ROUND_LOCKED', null, { boardState: board.state });
        db.run('DELETE FROM board_cells WHERE board_id = ?', board.id);
        db.run(`UPDATE boards SET state = 'DRAFT', selected_json = ?, matrix_version = NULL, randomized_at = NULL, version = version + 1, updated_at = ? WHERE id = ?`, json.str(skillIds), t, board.id);
        board = getBoard(db, board.id);
      }
      const shaped = participantBoard(db, board);
      ctx.emit('board.saved', { eventId: participant.event_id, roundId: round.id, roundVersion: round.version, participantId: participant.id, payload: { board: shaped } });
      game.audit({ eventId: participant.event_id, roundId: round.id, actor: participant.id, action: 'board.selections.save', target: board.id, expectedVersion: body.boardVersion, actualVersion: board.version, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { count: skillIds.length, state: board.state } });
      return { board: shaped, resultingVersion: board.version };
    });
  }

  /** Late draft (F-01): a participant with no board saves after lock -> DEFERRED board with reason `late` on that round (no positions), E8 copy as notice. */
  function saveLateDeferred(participant, round, skillIds, boardVersion, meta) {
    return game.withTx(meta, (ctx) => {
      assertBoardVersion(null, boardVersion);
      const t = now();
      const id = newId('board');
      db.run(`INSERT INTO boards(id, event_id, round_id, participant_id, state, version, selected_json, deferred_reason, created_at, updated_at) VALUES (?, ?, ?, ?, 'DEFERRED', 1, ?, 'late', ?, ?)`, id, participant.event_id, round.id, participant.id, json.str(skillIds), t, t);
      const board = getBoard(db, id);
      const shaped = participantBoard(db, board);
      const notice = { kind: 'late', exceptionId: 'E8', text: exception('E8').copy };
      ctx.emit('board.deferred', { eventId: participant.event_id, roundId: round.id, roundVersion: round.version, participantId: participant.id, payload: { board: shaped, reason: 'late' } });
      game.audit({ eventId: participant.event_id, roundId: round.id, actor: participant.id, action: 'board.selections.save', target: board.id, expectedVersion: boardVersion, actualVersion: board.version, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { count: skillIds.length, state: 'DEFERRED', late: true, roundState: round.state } });
      return { board: shaped, resultingVersion: board.version, notice };
    });
  }

  /** POST /me/board/finalize (BR-04): exactly 16 unique active skills; server randomizes; matrixVersion snapshot; READY. */
  function finalize(participant, body, meta) {
    requireProfile(participant);
    const round = editableRound(participant);
    return game.withTx(meta, (ctx) => {
      const board = boardOf(db, round.id, participant.id);
      assertBoardVersion(board, body?.boardVersion);
      if (!board) throw new ApiError('VALIDATION', 'no draft board to finalize');
      const ids = json.parse(board.selected_json, []);
      if (board.state === 'READY') return { board: participantBoard(db, board), resultingVersion: board.version };
      if (board.state !== 'DRAFT') throw new ApiError('ROUND_LOCKED', null, { boardState: board.state });
      if (!isComplete(ids, SKILLS)) throw new ApiError('VALIDATION', `exactly ${REQUIRED_SELECTIONS} unique active skills are required`, { selected: ids.length });
      const order = game.shuffleBoard(ids);
      const t = now();
      db.run('DELETE FROM board_cells WHERE board_id = ?', board.id);
      order.forEach((skillId, position) => db.run('INSERT INTO board_cells(board_id, position, skill_id) VALUES (?, ?, ?)', board.id, position, skillId));
      db.run(`UPDATE boards SET state = 'READY', matrix_version = ?, randomized_at = ?, version = version + 1, updated_at = ? WHERE id = ?`, MATRIX_VERSION, t, t, board.id);
      const after = getBoard(db, board.id);
      const shaped = participantBoard(db, after);
      ctx.emit('board.ready', { eventId: participant.event_id, roundId: round.id, roundVersion: round.version, participantId: participant.id, payload: { board: shaped } });
      ctx.emit('participation.updated', { eventId: participant.event_id, roundId: round.id, roundVersion: round.version, payload: { counts: game.countsOf(round) } });
      game.audit({ eventId: participant.event_id, roundId: round.id, actor: participant.id, action: 'board.finalize', target: board.id, expectedVersion: body.boardVersion, actualVersion: after.version, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { matrixVersion: MATRIX_VERSION } });
      return { board: shaped, resultingVersion: after.version };
    });
  }

  // ---- private insight (M-12) ------------------------------------------------------------------------------------
  function insight(participant) {
    requireProfile(participant);
    const board = db.get(`SELECT * FROM boards WHERE participant_id = ? AND state = 'FINISHED' ORDER BY finished_at DESC LIMIT 1`, participant.id);
    if (!board) throw new ApiError('NOT_FOUND', 'insight is available once your board is FINISHED');
    const ids = json.parse(board.selected_json, []);
    const r = matrixInsight(ids, roleSkillSet(participant.role_id), board.matrix_version ?? MATRIX_VERSION);
    return { roundId: board.round_id, matrixVersion: r.matrixVersion, inMatrixCount: r.inMatrixCount, beyondMatrixCount: r.beyondMatrixCount, totalSelected: r.totalSelected };
  }

  // ---- Soul + Float (BR-16, D-11) ---------------------------------------------------------------------------------
  function soulPrivate(participant) {
    const s = db.get('SELECT * FROM souls WHERE participant_id = ? ORDER BY created_at DESC LIMIT 1', participant.id);
    if (!s) return null;
    return shapeSoulPrivate(s);
  }
  function shapeSoulPrivate(s) {
    const ft = db.get('SELECT expires_at, consumed_at FROM float_tokens WHERE soul_id = ?', s.id);
    let floatToken = null;
    if (ft && !ft.consumed_at && Date.parse(ft.expires_at) > clock.now() && s.float_token_enc) floatToken = decryptToken(config, s.float_token_enc);
    return { soulId: s.id, config: json.parse(s.config_json), badge: s.badge, floatToken, floated: !!s.floated_at };
  }
  function float(participant, body, meta) {
    const { soulId, floatToken } = body ?? {};
    if (typeof soulId !== 'string' || typeof floatToken !== 'string' || !floatToken) throw new ApiError('VALIDATION', 'soulId and floatToken are required');
    // Greeting (D-42): optional; checked before the one-use token is spent, so a rejected message costs nothing.
    if (body.greeting !== undefined && body.greeting !== null && typeof body.greeting !== 'string') throw new ApiError('VALIDATION', 'greeting must be a string');
    const greeting = checkGreeting(body.greeting ?? '');
    if (!greeting.ok) throw new ApiError('GREETING_REJECTED', null, { reason: greeting.reason });
    const soul = db.get('SELECT * FROM souls WHERE id = ? AND participant_id = ?', soulId, participant.id);
    if (!soul) throw new ApiError('FLOAT_FAILED', null, { reason: 'unknown-soul' });
    const hash = sha256Hex(floatToken);
    const t = now();
    const result = game.withTx(meta, (ctx) => {
      const r = db.run('UPDATE float_tokens SET consumed_at = ?, command_id = ? WHERE token_hash = ? AND soul_id = ? AND consumed_at IS NULL AND expires_at > ?', t, meta.commandId ?? newId('command'), hash, soulId, t);
      if (r.changes === 0) {
        const tok = db.get('SELECT * FROM float_tokens WHERE token_hash = ? AND soul_id = ?', hash, soulId);
        if (tok && tok.consumed_at && soul.entrance_json) return { accepted: true, replay: true, entrance: json.parse(soul.entrance_json) };
        throw new ApiError('FLOAT_FAILED', null, { reason: !tok ? 'unknown-token' : 'expired' });
      }
      const p = db.get('SELECT * FROM participants WHERE id = ?', participant.id);
      const entrance = { soulId, config: json.parse(soul.config_json), badge: soul.badge, label: p.consent_public_name ? p.display_name : null, greeting: greeting.value, enteredAt: t, edge: soulEntranceEdge(soul.seed) };
      db.run('UPDATE souls SET floated_at = ?, entrance_json = ? WHERE id = ? AND floated_at IS NULL', t, json.str(entrance), soulId);
      const round = getRound(db, soul.round_id);
      ctx.emit('soul.float_accepted', { eventId: soul.event_id, roundId: soul.round_id, roundVersion: round?.version ?? null, payload: { entrance: publicEntrance(entrance, config) } });
      game.audit({ eventId: soul.event_id, roundId: soul.round_id, actor: participant.id, action: 'soul.float', target: soulId, outcome: 'accepted', correlationId: meta.correlationId, commandId: meta.commandId, details: { edge: entrance.edge, greeting: entrance.greeting } });
      return { accepted: true, replay: false, entrance };
    });
    return result;
  }

  return { createSession, taxonomy, setProfile, participantSelf, participantProjected, discovery, currentBoard, saveSelections, finalize, insight, soulPrivate, shapeSoulPrivate, float, winnerLabel };
}
