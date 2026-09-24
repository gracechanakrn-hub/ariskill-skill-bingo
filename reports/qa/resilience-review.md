# Resilience review (requirement 15.4, AC 10, AC 14, hard QC "Resilience")

Run `run-20260922-113339`. Rows with automated evidence link to the test that proves the behaviour on the server; client-side fallbacks need the manual drill once the apps are delivered.

| # | Failure | Expected fallback | Automated evidence | Manual drill | Status |
|---|---|---|---|---|---|
| 1 | Primary Galaxy renderer (WebGL2) unavailable or crashes | Canvas 2D, then static scene; info panel keeps working (AC 14) | none (client) - `assets/scene/scene-config.json` fallback order webgl2 -> canvas2d -> static validated by `tools/assets/test` | Headless Chrome (no WebGL) screenshot of `/public`; force `webgl` off in chrome://flags on the venue device | |
| 2 | Optional audio asset missing / autoplay denied / muted | Silent mode, captions, no errors | `tools/assets/test/audio.test.js` manifest + fallbacks | Deny autoplay, delete a cue file from the cache, mute the device | |
| 3 | Asset delivery slow or partial | LOD downgrade, thumbnails / simple / dot Soul variants | `assets/souls/fallback/*` present; manifest checksums (`tools/assets/test`) | Throttle to Slow 3G in devtools on `/public` | |
| 4 | Realtime stream drops (Wi-Fi loss) | Client reconnects with Last-Event-ID; missed events replay in order; no duplicate celebration | `tests/e2e/reconnect.test.js` (drop, resume, exact replay, no gap, no duplicate soul.float_accepted); `tests/load/reconnect-storm.js` (all streams drop at once: 300 streams recovered in 64 ms, see `reports/qa/load-report.json`) | Toggle Wi-Fi on a phone and on the public device during play | |
| 5 | Replay window exceeded / client far behind | `system.snapshot_required` -> snapshot refetch; state equals live state | `reconnect.test.js` stale resume test; `services/game-service/test/projection.test.js` | Leave a phone in airplane mode for > 500 events, reconnect | |
| 6 | Duplicate / concurrent Next Skill clicks | Exactly one draw; second answer STALE_VERSION; retry with same key replays | `tests/e2e/admin-operations.test.js` (simultaneous draw-next, same-key retry); `services/game-service/test/draw.test.js` | Double-click Next Skill on the admin device | |
| 7 | Draw transaction failure | Nothing committed, DRAW_FAILED (E21), retry with the same key | `services/game-service/test/draw.test.js` (rollback) | Kill the DB file mid-round in staging | |
| 8 | Server restart mid-round | Durable state; clients resume via snapshot + Last-Event-ID; no automatic start or draw | Not automated (process restart) - state is durable in SQLite (`db.js`, WAL) | Restart the service during PLAYING; verify admin, public, phones recover; verify no draw happened | |
| 9 | Admin refresh / stale Mission Control | STALE_VERSION carries the current snapshot; UI refreshes | `admin-operations.test.js` stale version test | Refresh the admin tab mid-round | |
| 10 | Lock countdown reached while the admin is away | Lock only, never auto-start; startOverdue flag after 60 s | `services/game-service/test/round.test.js` | Let the countdown reach 00:00 without touching admin | |
| 11 | Cancellation mid-play | Boards DEFERRED, public notice E15, next round reassigns drafts | `admin-operations.test.js` cancel test; `employee-journey.test.js` next-round test | Cancel with a reason during rehearsal | |
| 12 | Exhausted pool | EXHAUSTED state, notice, Souls still created | `services/game-service/test/draw.test.js` (E23) | Play a small seeded round to exhaustion | |
| 13 | Float retry / double tap | One entrance; replay returns the original | `employee-journey.test.js`, `reconnect.test.js`, `services/game-service/test/float.test.js` | Double-tap Float on a slow network | |
| 14 | No stale celebration after reconnect | Replayed events carry the original sequence ids; clients dedup by id and celebrate only when `meta.replay === false` | `reconnect.test.js` (replay ids equal live ids); `packages/ui/test/motion.test.js` celebration guard | Reconnect a phone right after a Bingo; no second burst | |
| 15 | Rate limiting under abuse | 429 RATE_LIMITED, nothing mutated | `admin-operations.test.js` burst test; `services/game-service/test/authz.test.js` | n/a | |

## Defect history relevant to resilience

- DEF-02 (was major, `services/game-service/src/queries.js` displayRound): cancelling a DRAFT next round during play used to switch the public/stage display to the cancelled round. Fixed and verified by `tests/e2e/public-stage-views.test.js` "DEF-02" (passing): the PLAYING round stays on public and stage. The rehearsal workaround is no longer required.
- Late joiner after lock (contract 1.0.2): the draft is parked as DEFERRED(late) with the E8 notice and reassigned at the next registration open; verified in `tests/e2e/employee-journey.test.js` (row 11 above also covers deferral on cancel).
- Reconnect storm re-run on the fixed build (PLAYERS=450, 900 streams): all streams caught up in 247 ms, 0 duplicate draw events, 0 replays below Last-Event-ID (`reports/qa/venue-performance.md`).

Sign-off: ______________________ Date: __________
