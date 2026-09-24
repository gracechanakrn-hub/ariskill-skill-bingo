# AriSkill Skill Bingo

Synchronized live-event web game for Arise: employees actively pick 25 skills, the server randomizes a 5 x 5 board, the MC draws Core/Critical skills, everyone who completes a line on the same draw co-wins, and every player receives a non-ranking Arise Soul they can float into the public Arise Galaxy.

Four interfaces share one authoritative game state:

| Interface | Path | Audience |
|---|---|---|
| Employee mobile | `/play?t=<join token>` | players (QR on the public screen) |
| Admin portal | `/admin` | event admin / MC |
| Public event screen | `/public` | venue projector (65 % Galaxy, 35 % info panel) |
| Stage dashboard | `/stage` | presenter (read-only) |

## Quick start

```bash
node --version          # >= 24 (verified on 26.8)
npm run seed            # creates the demo event, one round, simulated players; prints URLs + dev tokens
npm start               # http://localhost:8080
npm test                # unit, service, contract, e2e suites
npm run assemble        # deterministic build: build/build-info.json, sbom, dist tarball
npm run qc              # hard QC gate -> reports/qa/release-gate.json
```

No third-party runtime dependencies. Clients are native ES-module apps with no build step.

## Repository map

Follows `docs/ariskill-skill-bingo-agent-workflow.md` section 19: `apps/` (four clients), `services/game-service` (authoritative server), `packages/` (contracts, game-rules, design-tokens, ui, skill-master), `contracts/` (state machine, rules, realtime events, API, projections), `docs/` (requirements, decisions, ux, art, audio, motion, security), `assets/` + `assets-src/` + `tools/assets` (generated assets with generators and manifests), `tests/`, `reports/`, `ops/`, `build/`.

## Provenance

Requirement: `docs/requirements/ariskill-skill-bingo-requirements.md` (locked passes 1-3). Workflow: `docs/ariskill-skill-bingo-agent-workflow.md`. Decisions: `docs/decisions/`. Stack verification: `docs/stack-verification.md`. Run ID: `build/RUN_ID`.
