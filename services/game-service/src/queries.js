// Shared read helpers and canonical row -> contract shape mappers used by commands and projections.
import { json } from './db.js';
import { skillRef, SKILLS, skillKind } from './skills.js';
import { hashString, PUBLIC_STATE } from '../../../packages/game-rules/src/index.js';

export const NON_TERMINAL = ['DRAFT', 'REGISTRATION_OPEN', 'LOCKED', 'PLAYING', 'WINNER', 'EXHAUSTED'];

export function getEvent(db, eventId) { return db.get('SELECT * FROM events WHERE id = ?', eventId) ?? null; }
export function getRound(db, roundId) { return db.get('SELECT * FROM rounds WHERE id = ?', roundId) ?? null; }
export function roundsOfEvent(db, eventId) { return db.all('SELECT * FROM rounds WHERE event_id = ? ORDER BY number ASC', eventId); }
/** Latest non-terminal round (the round that accepts boards / is being played), or null. */
export function activeRound(db, eventId) {
  return db.get(`SELECT * FROM rounds WHERE event_id = ? AND state IN ('DRAFT','REGISTRATION_OPEN','LOCKED','PLAYING','WINNER','EXHAUSTED') ORDER BY number DESC LIMIT 1`, eventId) ?? null;
}
/** Latest round that has been opened (state != DRAFT), or null: what displays show as "the round". */
export function displayRound(db, eventId) {
  return db.get(`SELECT * FROM rounds WHERE event_id = ? AND state IN ('REGISTRATION_OPEN','LOCKED','PLAYING','WINNER','EXHAUSTED') ORDER BY number DESC LIMIT 1`, eventId)
    ?? db.get(`SELECT * FROM rounds WHERE event_id = ? AND state != 'DRAFT' ORDER BY number DESC LIMIT 1`, eventId)
    ?? null;
}
export function latestDraftRoundAfter(db, eventId, number) {
  return db.get(`SELECT * FROM rounds WHERE event_id = ? AND state = 'DRAFT' AND number > ? ORDER BY number DESC LIMIT 1`, eventId, number ?? 0) ?? null;
}
export function latestRound(db, eventId) { return db.get('SELECT * FROM rounds WHERE event_id = ? ORDER BY number DESC LIMIT 1', eventId) ?? null; }

export function getParticipant(db, id) { return db.get('SELECT * FROM participants WHERE id = ?', id) ?? null; }
export function getBoard(db, id) { return db.get('SELECT * FROM boards WHERE id = ?', id) ?? null; }
export function boardOf(db, roundId, participantId) { return db.get('SELECT * FROM boards WHERE round_id = ? AND participant_id = ?', roundId, participantId) ?? null; }
export function boardsOfRound(db, roundId, states = null) {
  if (!states) return db.all('SELECT * FROM boards WHERE round_id = ? ORDER BY created_at', roundId);
  return db.all(`SELECT * FROM boards WHERE round_id = ? AND state IN (${states.map(() => '?').join(',')}) ORDER BY created_at`, roundId, ...states);
}
export function cellsOf(db, boardId) { return db.all('SELECT position, skill_id AS skillId FROM board_cells WHERE board_id = ? ORDER BY position', boardId); }
export function matchesOf(db, boardId) { return db.all('SELECT position FROM board_matches WHERE board_id = ? ORDER BY position', boardId).map(r => r.position); }
export function drawsOf(db, roundId) { return db.all('SELECT * FROM draws WHERE round_id = ? ORDER BY number', roundId); }
export function winnersOf(db, roundId) { return db.all('SELECT w.*, w.participant_id AS id, p.display_name, p.consent_public_name, s.id AS soul_id FROM winners w JOIN participants p ON p.id = w.participant_id LEFT JOIN souls s ON s.board_id = w.board_id WHERE w.round_id = ? ORDER BY w.created_at, w.participant_id', roundId); }
export function latestSequence(db, eventId) { return db.get('SELECT COALESCE(MAX(sequence), 0) AS s FROM events_outbox WHERE event_id = ?', eventId).s; }

/** Active boards with cells, shaped for game-rules evaluation. */
export function activeBoardsWithCells(db, roundId, states = ['LOCKED_ACTIVE']) {
  return boardsOfRound(db, roundId, states).map(b => ({ boardId: b.id, participantId: b.participant_id, cells: cellsOf(db, b.id), row: b }));
}

// ---- shapes ---------------------------------------------------------------------
export function roundSummary(r) {
  if (!r) return null;
  return { roundId: r.id, number: r.number, title: r.title, state: r.state, version: r.version, lockAt: r.lock_at, startedAt: r.started_at, resultWindowSeconds: r.result_window_seconds, cancellationReason: r.cancellation_reason };
}
export function resultWindowEndsAt(r) { return r?.published_at ? new Date(Date.parse(r.published_at) + r.result_window_seconds * 1000).toISOString() : null; }
export function drawShape(d) { return { drawId: d.id, number: d.number, skill: skillRef(d.skill_id), drawnAt: d.drawn_at }; }
export function publicState(r) { return r ? (PUBLIC_STATE[r.state] ?? 'Waiting') : 'Waiting'; }

/** Winner display label: consented display name, else stable pseudonym (OD-03). */
export function winnerLabel(participant) {
  if (participant.consent_public_name) return participant.display_name;
  const id = participant.participant_id ?? participant.id;
  if (!id) throw new Error('winnerLabel: participant id missing');
  return pseudonym(id);
}
export function pseudonym(participantId) { return `Soul #${String(hashString(`soul:${participantId}`) % 10000).padStart(4, '0')}`; }

/** ParticipantBoard shape (participant audience only). */
export function participantBoard(db, b) {
  if (!b) return null;
  const selected = json.parse(b.selected_json, []);
  const cells = b.state === 'DRAFT' || b.state === 'DEFERRED' ? null : cellsOf(db, b.id).map(c => { const s = SKILLS.get(c.skillId); return { position: c.position, skillId: c.skillId, name: s?.name ?? c.skillId, kind: skillKind(s), domain: s?.domain ?? null }; });
  return { boardId: b.id, roundId: b.round_id, state: b.state, version: b.version, selectedSkillIds: selected, cells: cells && cells.length ? cells : (cells ? null : null), matchedPositions: matchesOf(db, b.id), matrixVersion: b.matrix_version };
}
export function soulEntranceEdge(seed) { return ['left', 'right', 'top', 'bottom'][hashString(`edge:${seed}`) % 4]; }
