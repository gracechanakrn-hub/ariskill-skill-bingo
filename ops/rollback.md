# Rollback and Live Recovery

## Principles
- Prefer switching traffic back to the last known-good build rather than hot-fixing during the event.
- Never roll back across an incompatible SQLite schema migration. Migrations in `services/game-service/src/db.js` are additive; a rollback build must read the current schema (verify with the migration test in the release gate).
- Never recalculate or overwrite a published winner set. If a round is invalid, cancel it transparently (reason visible to players) and start a new round under an incident record.
- The public Galaxy/audio layer can be disabled independently (public screen `?mode=static` query or renderer fallback) while mobile/admin gameplay continues.

## Procedure
1. Announce the pause to the MC; stop issuing admin commands.
2. Stop the service process. The SQLite file (`BINGO_DB_PATH`) is the state; back it up (`cp` while stopped).
3. Deploy the recorded rollback build (same env vars). Start it. Verify `/api/v1/time` and the admin snapshot.
4. Clients reconnect automatically and resync from snapshot; no manual action for players.
5. Record the incident: build IDs, time, reason, affected round IDs, actions taken.

## Forward-fix rule
If the schema changed incompatibly, do not roll back: apply a tested forward-fix release instead.
