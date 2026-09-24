# Stack Verification Record

**Run:** `run-20260922-113339`  
**Date:** 2026-09-22  
**Verified by:** Orchestrator (automated environment probe)

The requirement (section 13.2) keeps the implementation stack undecided until the environment is verified. This record documents what was verified on the build machine and the resulting **provisional, non-binding** selections. Every selection below must be re-verified against the real AriSkill hosting environment before production.

## Verified facts

| Capability | Verified value | Evidence |
|---|---|---|
| JavaScript runtime | Node.js v26.8.2, npm 11.19.1 | `node --version` |
| Durable store with uniqueness constraints | `node:sqlite` (built-in, SQLite with UNIQUE constraints and transactions) | in-memory probe: duplicate insert raised `ERR_SQLITE_ERROR` |
| Package manager | npm workspaces (pnpm/yarn absent) | `which pnpm yarn` |
| Containers | Docker absent | `which docker` |
| Browser for visual QC | Google Chrome (headless screenshot capable), Safari | `ls /Applications` |
| Python for data/asset tooling | Python 3.14.6, openpyxl, numpy 2.5.1 | import probe |
| Skill data source | `20260319_Skill Matrix 2026 (Tech Role)_PX.xlsx`: 218 skills, 46 roles, 13 job families | openpyxl profile |
| AriSkill design system | **Not available** for inspection | none supplied |
| AriSkill API conventions | **Not available** for inspection | none supplied |

## Provisional selections (non-binding)

| Concern | Selection | Rationale |
|---|---|---|
| Server | Node.js HTTP server, zero third-party runtime dependencies | Deterministic assembly: no lockfile drift, no supply-chain surface, reproducible hashes |
| Durable store | SQLite via `node:sqlite`, WAL mode, UNIQUE constraints on draws, board cells, winners, idempotency keys | Requirement 13.3: store must enforce uniqueness; transactions give the single-transaction draw path |
| Realtime delivery | Server-Sent Events (SSE) with monotonic `sequence` and `Last-Event-ID` resume, backed by snapshot queries | Requirement 14.2: messages are hints backed by queryable state; SSE reconnects natively and needs no extra dependency |
| Commands | JSON over HTTPS POST with `Idempotency-Key` and `expectedVersion` | Requirement 14.1 / 15.1 |
| Clients | Four static ES-module web apps served by the game service (no build step) | Responsive web, zero-dependency assembly, byte-for-byte reproducible |
| Public Galaxy renderer | WebGL2 primary, Canvas 2D fallback, static reduced-effects mode | Requirement 4.3 / P-07 |
| Runtime asset formats | Procedurally generated SVG/PNG sprites and WAV/OGG-free PCM audio produced by checked-in scripts | Source + reproducible script accompany every runtime asset (workflow 5.2) |
| Auth | Signed event join token for employees (HMAC), admin/presenter bearer tokens from environment config | SSO unavailable in this environment; open decision OD-02 remains open |

## Canonical path mapping

The workflow's provisional artifact paths are used unchanged (workflow section 5.1), except that file extensions follow the selections above (`.js` for code, `.json`/`.yaml` for contracts).
