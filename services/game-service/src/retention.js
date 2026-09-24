// Data lifecycle (OD-08, D-10): events whose rounds all ended more than BINGO_RETENTION_DAYS ago lose every
// participant-identifying row; an anonymized aggregate (Insights) is kept in aggregate_archive.
import { json } from './db.js';
import { computeInsights } from '../../analytics-projection/src/insights.js';

export function runRetention({ db, config, clock, projections = null, log = null }, nowMs = clock.now()) {
  const cutoff = new Date(nowMs - config.retentionDays * 86400 * 1000).toISOString();
  const candidates = db.all(`
    SELECT e.id FROM events e
    WHERE e.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM rounds r WHERE r.event_id = e.id AND r.state NOT IN ('CLOSED','CANCELLED'))
      AND COALESCE((SELECT MAX(COALESCE(r.closed_at, r.ended_at, r.updated_at)) FROM rounds r WHERE r.event_id = e.id), e.created_at) <= ?`, cutoff).map(r => r.id);
  const archived = [];
  for (const eventId of candidates) {
    db.transaction(() => {
      const insights = projections ? projections.insights(eventId, { fresh: true }) : computeInsights({ participants: [], boards: [], skills: new Map(), platforms: [], roles: [], roleSkillSet: () => new Set(), matrixVersion: null, computedAt: clock.iso() });
      db.run('INSERT INTO aggregate_archive(event_id, archived_at, insights_json) VALUES (?, ?, ?)', eventId, clock.iso(), json.str(insights));
      db.run('DELETE FROM float_tokens WHERE soul_id IN (SELECT id FROM souls WHERE event_id = ?)', eventId);
      db.run('DELETE FROM souls WHERE event_id = ?', eventId);
      db.run('DELETE FROM winners WHERE round_id IN (SELECT id FROM rounds WHERE event_id = ?)', eventId);
      db.run('DELETE FROM board_matches WHERE board_id IN (SELECT id FROM boards WHERE event_id = ?)', eventId);
      db.run('DELETE FROM board_cells WHERE board_id IN (SELECT id FROM boards WHERE event_id = ?)', eventId);
      db.run('DELETE FROM boards WHERE event_id = ?', eventId);
      db.run('DELETE FROM sessions WHERE event_id = ?', eventId);
      db.run(`DELETE FROM idempotency WHERE actor IN (SELECT id FROM participants WHERE event_id = ?)`, eventId);
      db.run(`DELETE FROM audit_log WHERE event_id = ? AND (actor LIKE 'prt_%' OR target LIKE 'prt_%' OR target LIKE 'brd_%' OR target LIKE 'soul_%')`, eventId);
      db.run('DELETE FROM events_outbox WHERE event_id = ?', eventId);
      db.run('DELETE FROM join_tokens WHERE event_id = ?', eventId);
      db.run('DELETE FROM participants WHERE event_id = ?', eventId);
      db.run(`UPDATE events SET status = 'archived', archived_at = ? WHERE id = ?`, clock.iso(), eventId);
    });
    archived.push(eventId);
    log?.info('retention archived event', { eventId });
  }
  db.run('DELETE FROM idempotency WHERE expires_at <= ?', new Date(nowMs).toISOString());
  db.run('DELETE FROM sessions WHERE expires_at <= ?', new Date(nowMs).toISOString());
  return { archivedEvents: archived, cutoff };
}
