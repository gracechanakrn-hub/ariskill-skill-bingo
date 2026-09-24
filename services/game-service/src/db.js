// Durable store: node:sqlite (DatabaseSync). Schema is embedded so the service has no external migration tooling.
// UNIQUE constraints are the last line of defence for duplicate draws, board cells, winners and idempotency keys (requirement 13.3).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  lock_at TEXT,
  locked_at TEXT,
  started_at TEXT,
  published_at TEXT,
  ended_at TEXT,
  closed_at TEXT,
  result_window_seconds INTEGER NOT NULL,
  cancellation_reason TEXT,
  pool_json TEXT,
  overdue_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, number)
);
CREATE INDEX IF NOT EXISTS idx_rounds_event_state ON rounds(event_id, state);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  employee_ref_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  consent_public_name INTEGER NOT NULL DEFAULT 0,
  platform_id TEXT,
  role_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id, employee_ref_hash)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_participant ON sessions(participant_id);

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  selected_json TEXT NOT NULL DEFAULT '[]',
  matrix_version TEXT,
  randomized_at TEXT,
  locked_at TEXT,
  finished_at TEXT,
  deferred_reason TEXT,
  reassigned_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(round_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_boards_round_state ON boards(round_id, state);
CREATE INDEX IF NOT EXISTS idx_boards_participant ON boards(participant_id, created_at);

CREATE TABLE IF NOT EXISTS board_cells (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 24),
  skill_id TEXT NOT NULL,
  PRIMARY KEY(board_id, position),
  UNIQUE(board_id, skill_id)
);

CREATE TABLE IF NOT EXISTS draws (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  number INTEGER NOT NULL,
  skill_id TEXT NOT NULL,
  drawn_at TEXT NOT NULL,
  command_id TEXT NOT NULL,
  matched_boards INTEGER NOT NULL DEFAULT 0,
  UNIQUE(round_id, number),
  UNIQUE(round_id, skill_id)
);

CREATE TABLE IF NOT EXISTS board_matches (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  draw_id TEXT NOT NULL REFERENCES draws(id),
  position INTEGER NOT NULL,
  matched_at TEXT NOT NULL,
  PRIMARY KEY(board_id, position)
);

CREATE TABLE IF NOT EXISTS winners (
  round_id TEXT NOT NULL REFERENCES rounds(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  board_id TEXT NOT NULL,
  winning_draw_id TEXT NOT NULL,
  winning_draw_number INTEGER NOT NULL,
  line_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(round_id, participant_id)
);

CREATE TABLE IF NOT EXISTS souls (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  board_id TEXT NOT NULL UNIQUE,
  seed TEXT NOT NULL,
  config_json TEXT NOT NULL,
  badge TEXT,
  float_token_enc TEXT,
  created_at TEXT NOT NULL,
  floated_at TEXT,
  entrance_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_souls_participant ON souls(participant_id, created_at);

CREATE TABLE IF NOT EXISTS float_tokens (
  token_hash TEXT PRIMARY KEY,
  soul_id TEXT NOT NULL REFERENCES souls(id),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  command_id TEXT
);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL,
  actor TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(key, actor)
);

CREATE TABLE IF NOT EXISTS events_outbox (
  event_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  round_id TEXT,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  round_version INTEGER,
  payload_json TEXT NOT NULL,
  participant_id TEXT,
  PRIMARY KEY(event_id, sequence)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  round_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  expected_version INTEGER,
  actual_version INTEGER,
  outcome TEXT NOT NULL,
  correlation_id TEXT,
  command_id TEXT,
  details_json TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_id, id);

CREATE TABLE IF NOT EXISTS join_tokens (
  event_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aggregate_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  insights_json TEXT NOT NULL
);
`;

/** Open (creating directories as needed) and migrate a database. ':memory:' is used by tests. */
export function openDatabase(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') { db.exec('PRAGMA journal_mode = WAL'); db.exec('PRAGMA synchronous = NORMAL'); db.exec('PRAGMA busy_timeout = 5000'); }
  migrate(db);
  return wrap(db);
}

export function migrate(db) {
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
}

/** Small convenience wrapper: cached prepared statements + transaction helper. */
export function wrap(raw) {
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  const api = {
    raw,
    run: (sql, ...p) => stmt(sql).run(...p),
    get: (sql, ...p) => stmt(sql).get(...p),
    all: (sql, ...p) => stmt(sql).all(...p),
    exec: (sql) => raw.exec(sql),
    /**
     * Run fn inside BEGIN IMMEDIATE ... COMMIT. Any throw rolls back and is re-thrown.
     * Nested calls reuse the outer transaction.
     */
    transaction(fn) {
      if (raw.isTransaction) return fn(api);
      raw.exec('BEGIN IMMEDIATE');
      try { const r = fn(api); raw.exec('COMMIT'); return r; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
    },
    close() { try { raw.close(); } catch { /* ignore */ } },
  };
  return api;
}

export const json = { parse: (s, d = null) => (s === null || s === undefined ? d : JSON.parse(s)), str: (v) => JSON.stringify(v) };
