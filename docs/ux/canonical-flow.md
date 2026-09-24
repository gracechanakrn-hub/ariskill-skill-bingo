# Canonical Flow and Screen Map (Stage 2)

Owner: UX Flow Agent + Game Mechanics Agent (orchestrated). Version 1.0.0. Inputs: locked requirement, `contracts/*`.

All four interfaces render one authoritative server state (requirement 7.3). The tables below map every screen to the round/board state that produces it, the events that move it, and the copy key (`packages/contracts/copy.json`).

## 1. Employee mobile (`/play?t=<joinToken>`)

| # | Screen | Shown when | Primary action | Copy | Exits |
|---|---|---|---|---|---|
| E1 | Join | no session | enter employee ref, display name, consent; `event.session.create` | join.* | E2, or E2 error on expired token |
| E2 | Platform + Role | session, `participant.platformId` or `roleId` null | explicit selects (no prefill, no default option preselected); `me.profile.set` | profile.*, E16 | E3 |
| E3 | Skill selection | board DRAFT with < 25 | three discovery tabs; tap adds to next slot; chips with Remove; Undo last; search | select.* | E4 when 25th selected (auto `board.finalize`) |
| E4 | Board ready | board READY, round REGISTRATION_OPEN | view shuffled 5 x 5; countdown; Edit skills (returns to E3 with warning) | board.complete, board.waiting, board.editWarning | E5 on `round.locked` |
| E4b | No round | board DRAFT/READY, no REGISTRATION_OPEN round | keep editing; auto-refresh | board.noRound (E1) | E4 when a round opens |
| E5 | Locked, waiting for start | board LOCKED_ACTIVE, round LOCKED | none (read-only board) | play.waitingStart | E6 on `round.started` |
| E5b | Deferred | board DEFERRED | none; shows next round | board.deferred (E5), E8, E15 | E4 when next round opens |
| E6 | Playing | round PLAYING | none; matched cells auto-mark; draw list; draws 1-4 banner | play.* | E7 on `result.published`; E5b on cancel |
| E7 | Result | round WINNER/EXHAUSTED/CLOSED, board FINISHED | Reveal Soul | result.* | E8 |
| E8 | Soul reveal | soul present | staged reveal (skippable after first view); Matrix insight card (private) | soul.*, insight.* | E9 |
| E9 | Ready to Float | soul present, not floated | `3 -> 2 -> 1 -> FLOAT`; `soul.float` | soul.float | E10 |
| E10 | Floated | soul.floated | shows Soul in Galaxy state; next round info | soul.floated | E4/E4b for next round |

Cross-cutting: reconnect banner (E12/E7 copy) over any screen; sequence gap -> `me.snapshot`; all timers use server offset.

## 2. Admin portal (`/admin`)

| # | Screen | Shown when | Actions | Copy |
|---|---|---|---|---|
| A1 | Sign in | no admin token | paste token (provisional; SSO open OD-02) | - |
| A2 | Mission Control | always | round list, create round, current round panel | admin.* |
| A2.DRAFT | Round draft | round DRAFT | edit title/lockAt/result window; Open registration; Cancel | admin.openRegistration |
| A2.OPEN | Registration open | REGISTRATION_OPEN | live counts; join QR; lock countdown; Lock now; Start now (confirm modal); Reschedule; Cancel | admin.lockNow, admin.startNow, admin.startNowConfirm |
| A2.LOCKED | Locked | LOCKED | readiness panel (pool size, boards that can win); Start (disabled with E20 if pool < 5); overdue warning after 60 s; Cancel | admin.start, admin.readiness.*, admin.startOverdue |
| A2.PLAYING | Playing | PLAYING | Next Skill (pending/accepted/rejected state, disabled while pending); draw list with matched counts; pacing hint; Cancel (reason) | admin.nextSkill, admin.pacingHint |
| A2.WINNER | Winner | WINNER | co-winner list; result window countdown; no actions | - |
| A2.EXHAUSTED | Exhausted | EXHAUSTED | Close; Cancel | E11/E23 |
| A2.END | Closed/Cancelled | terminal | Create next round | - |
| A3 | Insights | always (separate tab) | aggregate metrics, cohort suppression note | admin.insights |
| A4 | Audit | always | filter by round | - |

Stale command (409 STALE_VERSION): show E10 toast and refresh from the returned snapshot; the button never re-fires automatically.

## 3. Public event screen (`/public`)

Left 65 %: Galaxy (renderer: WebGL2 -> Canvas 2D -> static). Right 35 %: info panel.

| Public state | Panel content |
|---|---|
| Waiting | next round title + countdown (or "not scheduled"), QR + join URL, previous winners, notice (cancelled/exhausted) if any |
| Playing | draw number, skill kind + name, matched boards, pacing line (`Bingo unlocks at draw 5` / `Bingo is live`), last 5 draws |
| Winner | `Bingo!`, round number, co-winner labels; auto-return to Waiting at `resultWindowEndsAt` |

Float entrances animate once per `soul.float_accepted` (dedup by soulId); on reconnect the snapshot lists Souls already in orbit without re-animating.

## 4. Stage dashboard (`/stage`)

Single read-only large-format layout: status strip (round state, countdown/current draw), participation tiles, draw/match tile, winner list with result timing, insights grid (top skills, Core/Critical density, Platform/Role engagement with suppression note, matrix alignment, skills beyond matrix). Auto-maps from round state; no presenter controls.

## 5. Concurrency and recovery behaviour (Gate 2 items)

- Draw: single durable transaction; second concurrent `round.draw.next` with the same expectedVersion is rejected STALE_VERSION; same Idempotency-Key returns the stored response.
- Winner: computed inside the draw transaction over all LOCKED_ACTIVE boards; the round enters WINNER in the same commit; later draws are ILLEGAL_TRANSITION.
- Float: `UPDATE float_tokens SET consumed_at=... WHERE hash=? AND consumed_at IS NULL`; zero rows -> return stored entrance if the token exists (replay) else E13.
- Reconnect: every audience keeps `sequence`; on gap or `system.snapshot_required` fetch snapshot; final state wins; celebrations keyed by event id are shown only for events newer than the snapshot at (re)connection time.
- Late/incomplete: lock transaction marks READY -> LOCKED_ACTIVE and everything else -> DEFERRED in one statement pair; a save arriving after `lockAt` is rejected ROUND_LOCKED even if the lock transaction has not yet run (BR-07).

## 6. Analytics event dictionary (client telemetry, privacy-safe)

| Event | Properties | Notes |
|---|---|---|
| `client.join_started` | eventId | no employeeRef |
| `client.profile_completed` | platformId, roleId | aggregate only |
| `client.selection_progress` | count (0-25), elapsedMs | completion-time metric |
| `client.board_finalized` | elapsedMs | |
| `client.reconnect` | audience, gapSize, durationMs | |
| `client.renderer_mode` | mode (webgl2/canvas2d/static), fps | public only |
| `client.float_result` | accepted, replay | |

Telemetry is not part of the authoritative path and is not implemented as a network sink in v1; the client logs to console in development and to a no-op sink otherwise.
