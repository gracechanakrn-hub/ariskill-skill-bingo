# Release Report - AriSkill Skill Bingo v1 candidate

**Run:** `run-20260922-113339`  **Date:** 2026-09-22  **Orchestrator:** automated workflow per `docs/ariskill-skill-bingo-agent-workflow.md`

| Item | Value |
|---|---|
| Build ID | `bingo-f584aefb2e9a` (content-hash of 238+ runtime files; reproduced byte-identically on two consecutive assemblies) |
| Artifact manifest hash | `sha256:8080056442190cf4c089124f61990d82b42667555473c4016a575d9d829475f6` (`build/artifact-manifest.yaml`) |
| Distribution | `build/dist/bingo-f584aefb2e9a.tar.gz 4ca86107b5534d5583cc57ba090c48453bb077f138da9c0ae6aa71c7ba9c6be1` |
| Contract versions | api-contract 1.0.2, realtime-events 1.0.2, projections participant 1.0.2 / admin 1.0.1, state machine 1.0.0, bingo rules 1.0.0 |
| Skill Master | `skill-matrix-2026-tech-role-20260319` (218 skills, 165 draw-eligible, 46 roles, 13 platforms) |
| Third-party runtime dependencies | 0 (SBOM: `build/sbom.json`) |
| Automated tests passing | 405 across 12 suites (release gate: 18/18 checks, 0 critical, 0 major) |
| Load evidence | 450 players (capacity + 50 %): draw fan-out p95 59 ms, reconnect storm of 900 streams recovered in 247 ms, 0 duplicate or out-of-order events |
| Hard QC decision | `AUTOMATED_GREEN_MANUAL_PENDING` (`reports/qa/release-gate.json`) |
| Critique | 5 critics, all approve-with-follow-ups; correction loop 1 applied and verified (`reports/critique/critique-round-1.md`) |
| Approved waivers | none requested |
| **Go-live decision** | **Not claimed.** Blocked on the human sign-offs below (decision D-09). |

## v1.2 sticker art-direction candidate (stage 10, D-25 / D-26)

Build `bingo-05efbe9c7c4e` (reproducible: two consecutive assemblies produced the same id), 292 files, gate `AUTOMATED_GREEN_MANUAL_PENDING` 18/18, the same 8 human sign-offs still pending. Tests after stage 10: 509 passing (game-rules 23, design-tokens 10, UI kit 77, game-service 69, employee 39, admin 20, public 49, stage 35, asset tools 53, AI tools 23, e2e + contracts + accessibility 111).

Art direction v2 aligns the product with the "Arise Soul x AriSkill" sticker sheet (docs/art/sticker-art-direction.md): Souls render as glossy clay figures with seeded bubble speckles, a lit antenna orb and a white die-cut outline; badges became outlined pills in a vendored rounded display face (Fredoka, OFL); an aurora band crosses the night sky on every screen; sticker doodads (rocket, UFO, ringed planet, comet, stars) drift at the Galaxy periphery and on the phone's waiting screens. The human-faced mascot and every level or rank label from the sheet were deliberately left out, because a Soul stays universal and non-ranking.

Developer-side AI tooling was added under tools/ai (D-26): Gemini image plates, Blender clay turnarounds and OpenAI copy and UX/UI proposals, all reading keys from a git-ignored `.env`. Nothing generated is required at runtime, no key is loaded by the service or the apps, and copy proposals never edit the catalog.

Measured contrast holds everywhere: the Galaxy sky is clamped so body text stays at or above 4.65:1 over the brightest aurora pixel, stage body text at or above 4.95:1, and phone tile text at or above 5.52:1. Owed to the venue rehearsal, unchanged: real-GPU frame time at 450 Souls, an entry-level Android check and the 30-minute soak. Screens: `reports/qa/screens/public-sticker-*.png`, `employee-sticker-*.png`, `stage-sticker-*.png`, `soul-v2-sheet.png`.

## v1.1 game-experience candidate (stage 9, D-22 / D-24)

Build `bingo-c0e55c563418` (reproducible: two consecutive assemblies produced the same id), 280 files, gate `AUTOMATED_GREEN_MANUAL_PENDING` 18/18, the same 8 human sign-offs still pending. Test totals after stage 9: game-rules 23, design-tokens 7, UI kit 66, game-service 69, employee 32, admin 20, public 36, stage 31, e2e 32, contracts 38, accessibility 41 = 395 passing. Changes over v1: Three.js 0.186.0 vendored (MIT, sha256 provenance); public Galaxy Three renderer with bloom, fireflies, forest and winner burst; employee 3D join orb, Soul reveal and Float lift-off with automatic SVG fallback; stage ambient backdrop and glossy tiles; violet tokens 1.1.0; vendored OFL fonts; gzip + immutable caching for vendor files; realtime contract 1.0.3 skip markers (DEF-05). Owed to the venue rehearsal: real-GPU frame time (60 fps @ 450 Souls), entry-level Android check, 30-minute soak. Screens: `reports/qa/screens/public-three-*.png`, `employee-game-*.png`, `stage-game-*.png`.

## Gate evidence

- Gate 1 (requirements): locked passes 1-3 from the product owner; traceability matrix `docs/requirements/traceability-matrix.md`.
- Gate 2 (mechanics): `contracts/*`, `packages/game-rules` 23 tests including property tests; state machine has no unreachable state.
- Gate 3 (visual) and asset gate: inclusive Soul cohort (`reports/qa/soul-cohort-sheet.png`), tokens contrast and colour-vision tests, manifests with sha256 and internal-original provenance, deterministic generators.
- Development: four clients, authoritative service with SQLite uniqueness constraints and single-transaction draws, shared UI kit; screenshots in `reports/qa/screens/`.
- Hard QC: functional, concurrency, security, privacy redaction (critical severity), accessibility static checks, performance, resilience all pass; one repair loop used (backend DEF-01..04).
- Critique: nine corrections applied (stage winner card, next-round path, Lock now confirmation, E19, server-side late deferral, public label for winner verification, deployment conditions, evidence reconciliation, public pill motion).

## Human sign-offs required before release (all pending)

1. Data: migration up/down verification in a disposable environment.
2. Security: threat-model review and penetration findings (`docs/security/threat-model.md`; red-team critique found no blocking defects).
3. Privacy: consent/name policy, retention and deletion verification (OD-03, OD-08, OD-09).
4. Accessibility: keyboard, screen reader, contrast, reflow, reduced-motion, silent walkthroughs (`tests/accessibility/README.md`).
5. Performance: frame time on the actual venue hardware, 30-minute 450-Soul soak.
6. Compatibility: phone/browser matrix and exact venue displays (`reports/qa/compatibility-matrix.md`).
7. Resilience: renderer/audio/realtime failure drills and restart recovery.
8. Operations: dashboards/alerts, backup, dress rehearsal (`reports/qa/rehearsal-script.md`), rollback test.

Plus the product-owner items: verified AriSkill design tokens replacing the provisional set (OD-12), SSO decision (OD-02), capacity number (OD-01), and copy review of the apps' proposed operational strings (OD-11).

## Deployment conditions

`BINGO_ENV=production` with all secrets; `BINGO_SESSION_RATE_PER_MIN` sized for the crowd; `BINGO_TRUST_PROXY=1` only behind a proxy that rewrites `X-Forwarded-For`; TLS/HSTS at ingress; tokens distributed out of band. See `ops/release-checklist.md`.

## Backlog (versioned, non-blocking)

Recorded in `reports/critique/critique-round-1.md` "Deferred" section: copy keys for OD-11, layout re-roll seeding, pseudonym space, audit of failed participant auth, runbook narration card, sub-32 px secondary text on venue displays, and the remaining minor critic items.
