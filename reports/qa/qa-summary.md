# QA summary - stage 6.7 (independent QA and reliability)

Run `run-20260922-113339` | QA agent (independent from feature authors) | 2026-09-22, reconciled after critique correction loop 1 (EO-04) | Node v26.8.2

Status at hand-off: **automated evidence green; manual evidence pending.** All defects QA found on the first build (DEF-01..DEF-04) are fixed and verified on the current build; the regression tests that used to fail now pass. Release gate: `AUTOMATED_GREEN_MANUAL_PENDING` (see section 5 for the exact decision line of the last run). Critique round 1 = approve-with-follow-ups (`reports/critique/critique-round-1.md`).

## 1. What is verified automatically

| Suite | Command | Result | Covers |
|---|---|---|---|
| Employee journey | `node --test tests/e2e/employee-journey.test.js` | 8/8 pass | join with the signed token from `/join-info`; expired, tampered, foreign token -> E2; no prefill + E16 before discovery/save/finalize; discovery recommended/popular/search; 25 unique (E4 duplicate, 26th rejected, unknown skill rejected); finalize -> READY with 25 unique positions holding the requested skills, client positions ignored; edit after READY -> DRAFT and re-finalize re-randomizes; lock -> incomplete board DEFERRED with `board.deferred(incomplete)` (E5 copy), save after lock on a held board -> E8; **late joiner (contract 1.0.2 / D-20): 200 with a DEFERRED(late) board, `notice {kind:'late', exceptionId:'E8', text}`, `board.deferred(late)` event, never in the pool, no matches, no Soul, reassigned as DRAFT when the next round opens**; play to WINNER, Soul with float token, private insight only for the finished board (404 for deferred) and absent from public/stage/admin/insights, Float once + idempotent retry + replay returns the original, exactly one `soul.float_accepted`; next round reassigns deferred drafts, previousWinners shown |
| Seeded round | `node --test tests/e2e/seeded-round.test.js` | 6/6 pass | fresh server with `BINGO_RNG_SEED=fixture-1`, `evt_demo`; six fixture boards produce the fixture layouts; lock 6/0; pool = 100 and equals `expected.pool`; 28 draws replay skill id/name/kind/matchedBoards/poolRemaining exactly; no winner before draw 5; WINNER on draw 28, final version 32; co-winners fixture-001 + fixture-002 with `row-1`, consented label `Avery Rivera`, pseudonym for the other; WINNER closes draws (ILLEGAL_TRANSITION E10, no row); `result.published` on public, stage, admin and both winners' streams carries the same co-winners / Souls; `bingo.detected` exactly once after the winning draw |
| Reconnect | `node --test tests/e2e/reconnect.test.js` | 4/4 pass | public + participant streams, heartbeat; drop, events while offline, resume with `Last-Event-ID` and `since` -> exactly the missed events for that audience, in order, then live continues without a gap; stale resume beyond the replay window -> `system.snapshot_required(replay-window-exceeded)` with sequence = latest, snapshot sequence >= last event and equal to the live state; `sequence-ahead`; non-integer since 400; one `soul.float_accepted` across live + replay with the same sequence id, replayed Float emits nothing |
| Admin operations | `node --test tests/e2e/admin-operations.test.js` | 7/7 pass | stale expectedVersion E10 with currentVersion + snapshot and no mutation; duplicate Idempotency-Key -> identical body with `Idempotent-Replay`, different body 422; two simultaneous draw-next -> one accepted + STALE_VERSION, one row, same-key retry replays, same key fired twice at once -> one draw; pool < 5 -> E20 and round stays LOCKED; `start_now` without `confirmed` rejected; cancel without reason REASON_REQUIRED, cancel with reason defers every live board, `round.cancelled(reason)` + `board.deferred(cancelled)`, E15 copy; audit reconstructs every transition (validated against `contracts/round-state-machine.json`), draw order, winners, rejections, authz rejections, no secrets; burst -> 429 envelope, no mutation, bucket refill |
| Public + stage views | `node --test tests/e2e/public-stage-views.test.js` | 7/7 pass | snapshots at waiting / locked / playing / winner / galaxy / closed / round 2 and every public + stage SSE payload scanned with the contract forbidden lists (recursive) plus `/employee|email|selectedSkillIds|floatToken|sessionToken/i`; public keys inside the allowlist; stage never has join/joinUrl; consent policy in `result.published` and snapshots (`Public Name` shown, `Hidden Name` never, `Soul #NNNN` present and **identical between snapshot, previousWinners and event - DEF-01 regression**); **`participant.publicLabel` equals the label in `result.published` for the consented and the pseudonymous winner (contract 1.0.2 / EO-02)**; Galaxy labels/badges by consent; cohort suppression < 5 and reveal at 5; previousWinners after round 2; **cancelling a DRAFT next round during play keeps the PLAYING round on public and stage - DEF-02 regression**; all 12 expected event types observed, participant-only types never leak, monotonic sequence, envelope shape |
| Projection redaction (critical) | `node --test tests/contracts/projection-redaction.test.js` | 6/6 pass | contract forbidden lists per audience + individual-key list + secret strings across public/stage/admin/participant snapshots (3 phases), insights endpoint and every SSE payload of 6 streams; allowlists (stage `galaxy` now in the contract - DEF-03 closed); participant isolation; winner shapes per audience; Soul config has no identity/rank trait |
| API shapes | `node --test tests/contracts/api-shapes.test.js` | 27/27 pass (24 operations) | every operation parsed from `contracts/api-contract.yaml` has an auth-less / wrong-role / invalid / valid case; status codes, error codes, exception ids and envelope keys; error-code table equals the service catalogue; 404 envelopes; security headers; 64 KB body limit; correlation id echo |
| Copy catalog (pre-existing) | `node --test tests/contracts/copy-catalog.test.js` | 5/5 pass | |
| Load / reconnect storm | `PLAYERS=150` (gate) and `PLAYERS=450` (release run) | pass | section 2 |
| Accessibility static checks | `node --test tests/accessibility` | 41/41 pass, 3 minor diagnostics | per delivered app: lang/charset/title/viewport (zoom not disabled), skip link + single main landmark, CSP (no inline script/handlers/external origins, tokens.css + base.css), img/svg/canvas text alternatives, labelled controls (HTML + `h()` heuristics incl. template-literal ids), button names + type, no dynamic innerHTML/insertAdjacentHTML/html:, live region, tablist/aria-selected/tabpanel, reduced motion + mute, no global key shortcuts, outline removal only with `:focus-visible`, touch token never lowered, 320 px reflow, venue theme / admin light theme, copy catalog import, no client-side game randomization; shared kit 44 px token, skip-link, visually-hidden, focus-visible, reduced-motion |

Totals: e2e 32/32, contracts 38/38, accessibility 41/41 (111 tests, 0 failures); load 2 runs pass.

## 2. Load numbers (`tests/load/reconnect-storm.js`, in-process, developer laptop, corrected build)

| Metric | Target (15.4) | PLAYERS=150 (300 streams) | PLAYERS=450 = capacity 300 + 50 % (900 streams) |
|---|---|---|---|
| draw-next -> SSE delivery p95 / max | p95 <= 1000 ms | 19.96 ms / 20.8 ms | 58.78 ms / 60.82 ms (p50 49.9 ms) |
| draw command round trip p95 | informational | ~17 ms | 52.8 ms |
| Reconnect storm (all 2N streams drop, one draw offline, resume with Last-Event-ID): all caught up / p95 | <= 5000 ms | 64 ms / 63.62 ms | 247 ms / 246.67 ms |
| Public snapshot p95 (N concurrent) | <= 500 ms | 41.73 ms | 12.01 ms (stage snapshot p95 295.69 ms) |
| Setup API p95 (session, profile, save, finalize) | <= 500 ms | 37.23 ms | 23.27 ms (1350 calls) |
| Duplicate draw events / replay below Last-Event-ID / non-monotonic streams | 0 | 0 / 0 / 0 | 0 / 0 / 0 |

`reports/qa/load-report.json` = latest run (the gate re-executes PLAYERS=150). Venue network latency is not included (`reports/qa/venue-performance.md`). The stage snapshot (insights aggregate, cached 2 s) is the largest server cost at 450 players and stays inside the 500 ms API target.

## 3. Defect log (QA findings on the first build and their current status)

| ID | Severity | Location | Description | Status on the current build | Evidence |
|---|---|---|---|---|---|
| DEF-01 | major | `services/game-service/src/queries.js` `winnersOf` / `winnerLabel` | Snapshot winners and `previousWinners` labelled every non-consented winner with the same pseudonym (hash of an undefined id) while `result.published` used the correct one. | **Fixed** (`winnersOf` selects `participant_id AS id`); verified | `tests/e2e/public-stage-views.test.js` "DEF-01" passes; seeded round snapshot labels consistent |
| DEF-02 | major (low likelihood) | `services/game-service/src/queries.js` `displayRound` | Cancelling a DRAFT next round during play switched public/stage to the cancelled round. | **Fixed**; verified | `public-stage-views.test.js` "DEF-02" passes |
| DEF-03 | minor | `contracts/projections/stage.json` vs `projections.js` | Stage snapshot carried `galaxy` outside the allowlist. | **Fixed** (contract lists `galaxy`) | `projection-redaction.test.js` allowlist test |
| DEF-04 | minor | `contracts/api-contract.yaml` vs `errors.js` | `INTERNAL` listed in the contract but not in `ERROR_CODES`. | **Closed** (documented catch-all beside `ERROR_CODES`; contract test compares the catalogue minus INTERNAL) | `api-shapes.test.js` |
| DEF-05 | major | `services/game-service/src/sse.js` + `packages/ui/sse-client.js` | Sequence numbers are global per event, so filtered streams (participant above all) skipped ids on almost every event; the kit flagged each skip as a gap and every live celebration, cue and polite announcement on the phone was muted until the next snapshot. Found by the stage 9.2 employee workstream. | **Fixed** (id-only skip markers on the hub, honoured by the client; realtime-events 1.0.3) | `services/game-service/test/sse-skip.test.js`, `packages/ui/test/sse-client.test.js` skip-marker test; e2e 32/32 |
| A11Y-01 | minor | `apps/public-galaxy/index.html` | No `main` landmark / skip link (venue display; panel is an `aside`). | Open (recorded as diagnostic, not blocking); backlog | `tests/accessibility` diagnostic |
| A11Y-02 | info | `apps/admin-portal/src/main.js` | Two `h('main')` call sites (sign-in vs portal views); only one mounted at a time. | Confirm in the manual walkthrough | diagnostic |
| RISK-01 | major (deployment) | session rate limit "5/min per IP" | Behind a venue NAT all phones share one IP. | **Mitigated** (EO-03): `BINGO_SESSION_RATE_PER_MIN` (recommended 300 for a NAT'd venue) and `BINGO_TRUST_PROXY` added to the service config, recorded in `ops/release-checklist.md`; rehearsal item "10 phones join within 60 s" added to `reports/qa/rehearsal-script.md` | `services/game-service/src/config.js`, `auth.js` |
| OBS-01 | note | `tools/assembly/release-gate.js` `manual()` | Manual items count as `evidence_recorded` when the file exists, even for unfilled templates. | Open (gate now reports 8 manual pending) | gate output |
| OBS-02 | note | `packages/skill-master` | "Employee Experience" legitimately trips the privacy regex; QA boards exclude such skills; the contract forbidden-key scan is normative. | Accepted | `tests/e2e/helpers.js` |

## 4. What remains manual (templates ready, sign-off lines intentionally unfilled)

- `reports/qa/compatibility-matrix.md` - phone/browser rows (18.2) and the OD-14 venue assumptions.
- `reports/qa/privacy-review.md` - 12.1 checklist; rows 1, 5, 6, 8 need the privacy owner's decision.
- `reports/qa/accessibility-review.md` + `tests/accessibility/README.md` - keyboard / screen reader / contrast / zoom-reflow / reduced motion / silent walkthrough per app.
- `reports/qa/resilience-review.md` - renderer, audio, asset, restart drills (rows 1-3, 8 have no automated evidence).
- `reports/qa/venue-performance.md` - frame time, countdown drift, mobile load, draw-to-phone latency on venue hardware and network.
- `reports/qa/rehearsal-script.md` - workflow 17.3 checklist (now includes the EO-03 join-rate check and the DEF-02 verification instead of the workaround).

## 5. How to re-run

```bash
node --test tests/e2e tests/contracts tests/accessibility   # 111 tests
PLAYERS=150 node tests/load/reconnect-storm.js              # gate run  -> reports/qa/load-report.json
PLAYERS=450 node tests/load/reconnect-storm.js              # release run (capacity + 50 %)
node tools/assembly/release-gate.js                         # -> reports/qa/release-gate.json
```

Last gate decision recorded by QA (after correction loop 1): see `reports/qa/release-gate.json` - `AUTOMATED_GREEN_MANUAL_PENDING`, 18/18 automated checks passed, 0 critical, 0 major, 8 manual items pending. All suites create the service in-process (`createApp`, in-memory SQLite, port 0) and never touch `data/` or other agents' ports.
