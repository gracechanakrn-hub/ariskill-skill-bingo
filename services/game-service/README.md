# AriSkill Skill Bingo - Game Service

Authoritative game service for the synchronized live-event game: HTTP API + Server-Sent Events, SQLite durable store
(`node:sqlite`), transactional round/board/draw/winner/Soul/Float logic, audience projections with redaction, audit log,
idempotency, timers, retention, seed script and deterministic fixture. **Zero third-party dependencies** (Node >= 24, ES modules).

The service implements `contracts/api-contract.yaml` exactly and serves the four static clients.

## Run

```bash
npm run seed     # creates data/bingo.sqlite, event evt_demo, "Round 1" (DRAFT, lockAt +10 min) and 40 simulated READY boards
npm start        # http://127.0.0.1:8080  (development prints the dev admin/stage tokens)
```

`npm run seed` is idempotent (re-running does not duplicate participants or boards). `SEED_PLAYERS=80 npm run seed` changes the
number of simulated players. The seed prints the admin, stage and public URLs, a sample player join URL and the dev tokens.

URLs (default `BINGO_PUBLIC_BASE_URL=http://localhost:8080`):

| Path | Purpose |
|---|---|
| `/` | tiny index linking the four apps |
| `/play?t=<joinToken>` | employee mobile (`apps/employee-mobile`) |
| `/admin` | admin portal (`apps/admin-portal`), bearer `BINGO_ADMIN_TOKEN` |
| `/public` | public Arise Galaxy screen (`apps/public-galaxy`) |
| `/stage` | stage dashboard (`apps/stage-dashboard`), bearer `BINGO_STAGE_TOKEN` |
| `/packages/*`, `/assets/*`, `/tokens/*`, `/contracts/*` | shared trees served from the repo root |
| `/api/v1/...` | the API (see `contracts/api-contract.yaml`) |

App directories that do not exist yet answer 404; nothing crashes. ES modules are served as `text/javascript`.

## Environment

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | |
| `HOST` | `127.0.0.1` in development, else `0.0.0.0` | |
| `BINGO_ENV` | `development` | `development` / `test` / `production` |
| `BINGO_DB_PATH` | `data/bingo.sqlite` | `:memory:` for tests/smoke runs |
| `BINGO_ADMIN_TOKEN` | dev: `dev-admin-token` | required in production |
| `BINGO_STAGE_TOKEN` | dev: `dev-stage-token` | read-only presenter scope; required in production |
| `BINGO_JOIN_SECRET` | dev: `dev-join-secret` | HMAC key for QR join tokens; required in production |
| `BINGO_SESSION_SECRET` | dev: `dev-session-secret` | employee-reference hashing and Float-token at-rest encryption; required in production |
| `BINGO_PUBLIC_BASE_URL` | `http://localhost:<PORT>` | used in join URLs (QR payload) |
| `BINGO_RESULT_WINDOW_SECONDS` | `12` | clamped 10-15 (OD-05) |
| `BINGO_START_GRACE_SECONDS` | `60` | `startOverdue` warning after lock (OD-04); never auto-starts |
| `BINGO_RETENTION_DAYS` | `90` | retention job (OD-08) |
| `BINGO_RNG_SEED` | unset | deterministic draws/board layouts for tests and fixtures; **refused in production** |
| `BINGO_EVENT_ID` / `BINGO_EVENT_NAME` | `evt_demo` / `AriSkill Skill Bingo Demo` | default event created at startup |
| `BINGO_LOG_LEVEL` | `info` (`silent` in test) | JSON lines on stdout; never logs tokens, employee references or selections |
| `BINGO_SSE_HEARTBEAT_MS` | `15000` | SSE comment heartbeat |
| `BINGO_SESSION_RATE_PER_MIN` | `5` | session creations per minute **per client IP** (contract default). A venue behind NAT shares one IP: raise this (e.g. `300`) for the event network |
| `BINGO_TRUST_PROXY` | unset | `1` to key per-IP limits on the first `X-Forwarded-For` hop when a trusted reverse proxy fronts the service; leave unset when clients connect directly |

In production the process exits with status 1 if any secret is missing or if `BINGO_RNG_SEED` is set.

## Architecture (src/)

| Module | Responsibility |
|---|---|
| `server.js` | entry: config, DB, timers, listen, graceful shutdown |
| `app.js` | router and handlers, auth/authz, rate limits, idempotency, security headers, static serving, `createApp({db, clock, config})` |
| `config.js` | env parsing, dev defaults, production guard |
| `db.js` | `node:sqlite` open/migrate, embedded schema, `transaction()` (BEGIN IMMEDIATE) |
| `game.js` | round commands (`round.*`), atomic lock, start, the single-transaction draw, cancel/close, round end (Souls + Float tokens), timer transitions, outbox + audit |
| `participants.js` | session, profile, taxonomy, discovery, board save/finalize, private insight, Soul float |
| `projections.js` | public/stage/admin/participant snapshots and per-event payloads by allowlist; `redact()`, `FORBIDDEN_KEYS`, `findForbiddenKeys()` |
| `sse.js` | SSE hub, replay (`since` / `Last-Event-ID`, last 500), `system.snapshot_required`, heartbeat, connection counts |
| `timers.js` / `retention.js` | 250 ms tick: lockAt -> lock only, result window -> CLOSED, start-overdue flag, hourly retention |
| `auth.js` | join tokens (HMAC), sessions (hashed), bearer principals, timing-safe compare, token-bucket limiter, Float-token encryption |
| `queries.js`, `skills.js`, `ids.js`, `clock.js`, `log.js`, `errors.js`, `static.js` | helpers |
| `seed.js` | demo seed and `--fixture` |

`services/analytics-projection/src/insights.js` is a pure aggregate function (cohort suppression < 5, D-15) imported by the
projections module; it is never on the draw path and is cached for 2 s.

Key invariants: the server is the only authority for positions, draws, matches, winners, time and Float state. `round.draw.next`
is one `BEGIN IMMEDIATE` transaction (verify state + version, pick from the remaining pool with `secureRng`, persist the draw
under UNIQUE(round, number) / UNIQUE(round, skill), compute matches, evaluate winners from draw 5, persist winners, transition,
increment version, write audit + outbox rows); events are published only after COMMIT; any failure rolls back and answers
`DRAW_FAILED` (E21). Same `Idempotency-Key` returns the stored response; same key with a different body is 422.

## Tests

```bash
node --test services/game-service/test
```

Each test file starts the app on port 0 with an in-memory database, an injectable clock (`t.clock.set/advance`, then
`t.app.timers.tick()`) and relaxed rate limits. Coverage includes: E4 duplicate / 26th rejected / no prefill (E16); finalize
permutation and ignored client positions; save after lockAt (E8, BR-07); atomic lock; E20 pool minimum; `start_now`
confirmation; draw-4/draw-5 boundary; co-winners; concurrent draws; idempotent draws; unique draws; DRAW_FAILED rollback;
EXHAUSTED (E23); cancel (E15); Float once/replay/expired; authz 401/403 with audit; rate limits; forbidden-key scans of every
public/stage snapshot and SSE payload; participant stream isolation; SSE resume and `system.snapshot_required`; discovery modes;
private insight; cohort suppression; audit reconstruction; retention.

## Fixture

```bash
node services/game-service/src/seed.js --fixture   # writes tests/fixtures/seeded-round.json
```

The fixture runs the real service commands in memory with `BINGO_RNG_SEED=fixture-1`: six boards (two identical pairs so the
winning draw always produces co-winners), lock, start and draws until the round leaves PLAYING. It records the boards to post,
the expected pool, board layouts, draw order, winning draw number and co-winner employee references. Determinism does not depend
on random ids: draws are seeded by `(seed, eventId, round number, draw number)` over the sorted remaining pool and board layouts
by `(seed, sorted skill ids)`. To replay: start a fresh server with `BINGO_ENV=test BINGO_DB_PATH=:memory: BINGO_RNG_SEED=fixture-1`,
create the first round of `evt_demo`, open registration, join the six players with their explicit profiles, save + finalize the
listed `skillIds`, lock, start and draw.

## Smoke run

```bash
BINGO_ENV=test BINGO_DB_PATH=:memory: PORT=0 node services/game-service/src/server.js
curl -s http://127.0.0.1:<port>/api/v1/events/evt_demo/snapshot
curl -s -H 'Authorization: Bearer <admin token>' http://127.0.0.1:<port>/api/v1/admin/events/evt_demo/snapshot
```
