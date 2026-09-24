# Traceability Matrix

Requirement ID -> acceptance criterion (AC, requirement section 17) -> automated test(s). Test names are the planned canonical locations; `reports/qa/release-gate.json` records the executed result.

| Req | AC | Tests |
|---|---|---|
| M-01 | 9 | `tests/e2e/employee-journey.test.js` (join with signed token, expired token E2) |
| M-02 | 2 | `tests/e2e/employee-journey.test.js` (no prefill; selection blocked until Platform+Role, E16) |
| M-03 | 1 | `services/game-service/test/discovery.test.js` (recommended/popular/search) |
| M-04 | 1, 2 | `packages/game-rules/test/board.test.js`, `services/game-service/test/board.test.js` (duplicate E4, 26th rejected) |
| M-05 | 10 | `services/game-service/test/board.test.js` (idempotent save, version reconcile) |
| M-06 | 1 | `services/game-service/test/board.test.js` (finalize creates 25 unique positions, client positions ignored) |
| M-07 | 3, 9 | `services/game-service/test/round.test.js` (save after lock E8) |
| M-08 | 8 | `tests/e2e/seeded-round.test.js` (matches only from accepted draws) |
| M-09 | 6 | `packages/game-rules/test/bingo.test.js` (draw 4 no bingo, draw 5 evaluates) |
| M-10 | 7 | `tests/e2e/seeded-round.test.js` (result.published payload) |
| M-11 | - | `packages/game-rules/test/soul.test.js` (seed stable, no rank traits) |
| M-12 | 12 | `services/game-service/test/insight.test.js` (private only) |
| M-13 | 11 | `services/game-service/test/float.test.js` (one entrance; replay returns original) |
| A-01 | 3 | `services/game-service/test/round.test.js` (state machine, 00:00 lock-only, start-now) |
| A-02 | - | `services/game-service/test/projection.test.js` (admin counts) |
| A-03 | 4 | `packages/game-rules/test/pool.test.js` (min five, possible line) |
| A-04 | 5 | `services/game-service/test/draw.test.js` (idempotent draw, pending/failure) |
| A-05 | 5 | `services/game-service/test/draw.test.js` (stale version E10, duplicate command) |
| A-06 | 7 | `tests/e2e/seeded-round.test.js` (co-winners) |
| A-07 | - | `services/game-service/test/round.test.js` (cancel requires reason E15) |
| A-08 | - | Manual UI review; `apps/admin-portal` separates Mission Control and Insights |
| A-09 | 15 | `services/game-service/test/audit.test.js` (reconstruct transitions and draws) |
| P-01 | 14 | `tests/accessibility/public-fallback.md` (manual), `apps/public-galaxy` renderer fallback unit |
| P-02 | - | `services/game-service/test/projection.test.js` (QR + countdown fields in Waiting) |
| P-03 | 8 | `tests/contracts/projection-redaction.test.js` |
| P-04 | 7, 12 | `tests/contracts/projection-redaction.test.js` (winner names per consent) |
| P-05 | 11 | `services/game-service/test/float.test.js` |
| P-06 | 10 | `tests/e2e/reconnect.test.js` (sequence gap -> snapshot) |
| P-07 | 14 | Manual: `tests/accessibility/public-fallback.md`; `apps/public-galaxy/src/renderer/*` |
| S-01..S-03 | 12 | `tests/contracts/projection-redaction.test.js` (stage payload allowlist) |
| BR-01 | 2 | `services/game-service/test/board.test.js` |
| BR-02 | 1 | `packages/game-rules/test/board.test.js`, `services/game-service/test/board.test.js` |
| BR-03 | - | `services/game-service/test/discovery.test.js` |
| BR-04 | 1, 8 | `services/game-service/test/board.test.js` |
| BR-05 | 3, 9 | `services/game-service/test/round.test.js` |
| BR-06, BR-07 | 3 | `services/game-service/test/round.test.js` (atomic lock, DEFERRED) |
| BR-08 | 4 | `packages/game-rules/test/pool.test.js`, `services/game-service/test/round.test.js` (E20) |
| BR-09, BR-10 | 5 | `services/game-service/test/draw.test.js` (UNIQUE constraint, concurrent draws) |
| BR-11 | 8 | `services/game-service/test/authz.test.js` |
| BR-12, BR-13, BR-14, BR-15 | 6, 7 | `packages/game-rules/test/bingo.test.js`, `services/game-service/test/draw.test.js` |
| BR-16, BR-17 | - | `packages/game-rules/test/soul.test.js`, `services/game-service/test/float.test.js` |
| BR-18 | 12 | `tests/contracts/projection-redaction.test.js` |
| BR-19 | 10 | `packages/ui` clock-sync unit, `tests/e2e/reconnect.test.js` |
| BR-20 | 8, 15 | `services/game-service/test/authz.test.js`, `audit.test.js` |
| E1-E23 | - | `tests/contracts/copy-catalog.test.js` (every exception ID has copy and recovery) |
| 15.4 targets | - | `tests/load/reconnect-storm.js` (reported in `reports/qa/load-report.json`) |
