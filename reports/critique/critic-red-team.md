# Red-team critique — AriSkill Skill Bingo (stage 7, soft critique)

Run `run-20260922-113339` · build `bingo-ce0d1074e6df` · reviewer: Red-team Critic (abuse / privacy leakage / spoofing / replay / overload) · 2026-09-22 · Node v26.8.2

Authorized internal security review of the team's own pre-release build. Read-only on the product; probed a dedicated server on `:8113` with an isolated DB (`scratchpad/critic-red.sqlite`) and helper servers on `:8123/:8124/:8125` for rate-limit cases (all killed). Probe scripts: `scratchpad/red/{lib,p1-auth,p2-idor-idem,p3-float-race-sse,p4-float,p5-static-headers-audit,p6-retention}.mjs`.

## Verdict

**Recommendation: approve-with-follow-ups.**

No blocking security defects were found. Every threat-model control T1–T14 that is a code responsibility exists and was exercised and confirmed. The full automated suite is green (151/151; `node --test packages/game-rules/test services/game-service/test tests/contracts tests/e2e`) and the checked-in release gate is `AUTOMATED_GREEN_MANUAL_PENDING` (18/18 automated, 0 critical/0 major). The QA-reported backend defects DEF-01 and DEF-02 are fixed in this build (their regression tests now pass); DEF-03 (stage `galaxy`) is resolved (the stage projection no longer emits `galaxy`). The residual security exposures are either **accepted v1 decisions** (T9 guest-flow spoofing, OD-02) or **deployment-configuration conditions** (session rate limit behind NAT, `X-Forwarded-For` trust, TLS/HSTS at ingress) that must be enforced through the release checklist and runbook before go-live. Eight manual sign-offs (threat-model/pen-test, privacy, a11y, perf, compat, resilience, migrations, ops rehearsal) remain open in the gate and are the gating items for release, not code.

## Blocking findings

None.

| ID | Requirement / Threat | Severity | Reproduction / evidence | Impact | Smallest viable correction |
|----|----------------------|----------|-------------------------|--------|----------------------------|
| — | — | — | No blocking defect identified across auth, IDOR, idempotency, concurrency, float replay, SSE isolation, projection redaction, static traversal, headers, body limits, audit exposure, log leakage, retention, secrets. | — | — |

## Non-blocking improvements (prioritised)

| # | ID / Threat | Severity | Evidence | Impact | Smallest viable correction |
|---|-------------|----------|----------|--------|----------------------------|
| 1 | RISK-01 / T10 (deployment condition) | major (deployment only; not a code defect) | Contract `session: 5/min per IP`; `p1` helper server with `BINGO_SESSION_RATE_PER_MIN=5`, `BINGO_TRUST_PROXY` unset: 8 joins from one socket IP → `201 201 201 201 201 429 429 429`. Behind venue NAT/a cloud LB every phone shares one egress IP. | Only 5 employees per minute can join for the whole audience if deployed off the venue LAN. | Before any non-LAN deploy, set `BINGO_SESSION_RATE_PER_MIN` to the crowd size (runbook §8 suggests ~300) and, if a trusted proxy fronts the service, `BINGO_TRUST_PROXY=1`. Make this a release-checklist gate. Already documented; needs enforcement. |
| 2 | T9 identity spoofing (accepted residual, OD-02) | minor (accepted) | `p1`: re-joining with the same `employeeRef` (case/space-normalised) returns the **same** `participantId`, overwrites `displayName` and `consentPublicName`, and issues a fresh session (`T9.rejoin-*` PASS). | If an `employeeRef` is known/guessable, an attacker can hijack another employee's participant: read their board/private insight, flip their public-name consent, or set the public label. Explicitly accepted for v1 (guest flow weaker than SSO). | No change required for v1. Before wider use, adopt SSO or HR-issued one-time codes (threat-model T9 mitigation); avoid guessable/sequential refs in production. |
| 3 | T10 / XFF trust (hardening) | minor | `p5` helper `BINGO_TRUST_PROXY=1`: rotating `X-Forwarded-For` → all `201` (per-XFF buckets); same XFF → `201×5` then `429`. With trust proxy **unset**, XFF is ignored (socket bucket enforced). | If `BINGO_TRUST_PROXY=1` is set without a proxy that overwrites the client XFF, a client can spoof XFF to bypass the session limit. Default (unset) is safe. | Enable `BINGO_TRUST_PROXY` only behind a proxy that strips/rewrites inbound `X-Forwarded-For`. Optionally log a startup warning when trust-proxy is on. |
| 4 | 15.3 observability (minor) | minor | `services/game-service/src/app.js` `authorize()` audits rejections only when `need !== 'participant'`; admin/stage rejections are audited (`authz` test, `auth.reject` rows). | Failed auth against participant-scoped endpoints (`/me*`) is not written to `audit_log`. No security bypass; a reconstruction gap only. | Audit all `authorize` rejections, including participant-scope, or record them at a lower level. |
| 5 | T11 secrets hygiene (hardening) | minor | Tarball ships `services/game-service/src/config.js` (`DEV_DEFAULTS` `dev-admin-token`/`dev-stage-token`/…), `seed.js`, and READMEs naming the dev tokens. Assembly secret scan passes (patterns don't match plain literals). Production guard verified: refuses missing secrets and `BINGO_RNG_SEED`, never falls back to dev values in prod. | Dev tokens are inert in production, but a misconfigured deploy (`BINGO_ENV=development`) would accept them as admin/stage credentials. | Ensure the deploy sets `BINGO_ENV=production` (release-checklist item); optionally exclude `seed.js`/dev-only paths from `build/dist` and scrub dev tokens from shipped READMEs. |
| 6 | T6 TLS/HSTS (deployment) | info | `p5`: app sets CSP/nosniff/frame-DENY/referrer/no-store but no `Strict-Transport-Security` (expected — TLS termination is an ingress responsibility per T6). | Without ingress TLS+HSTS, same-origin SSE trust and token confidentiality are not enforced in transit. | Terminate TLS and add HSTS at the ingress/proxy; confirm in the deploy checklist. |
| 7 | DEF-04 (cosmetic) | preference | `contracts/api-contract.yaml` lists `INTERNAL`; `services/game-service/src/errors.js` builds it inline outside `ERROR_CODES`. | Catalogue/contract drift only; no runtime effect. | Add `INTERNAL` to `ERROR_CODES`. |

## Controls verified (T1–T14)

| # | Threat | Result | Evidence |
|---|--------|--------|----------|
| T1 | QR sharing outside venue | **pass** | Join token HMAC-signed, event-scoped, 12 h TTL, rotates below 1 h; tamper/expired/wrong-secret/NaN-exp/cross-event all → `401 E2`; forged token for unknown event → `404`; joining still requires an `employeeRef` (`p1`). |
| T2 | Unauthorized round control | **pass** | Separate admin/stage bearer tokens, `timingSafeEqual`; stage & participant tokens `403` on admin snapshot and commands; missing/invalid `401 E9`; rejections audited (`auth.reject`) (`p1`, `authz.test.js`). |
| T3 | Event enumeration | **pass** | Unknown event → `404` with no data; public snapshot is allowlisted and forbidden-key clean; sessions require a signed token; session creation rate-limited per IP (`p1`, `p5`). |
| T4 | Replayed Float actions | **pass** | One-use token consumed atomically; legit float `accepted/replay=false`; same token new key → `replay=true` identical entrance; exactly one public entrance; guess and cross-participant reuse → `409 E13`; token not re-exposed after consume (`p4`). |
| T5 | Duplicate / stale / concurrent admin commands | **pass** | Idempotency-Key + body-hash (diff body → `422`, same body → replay with `Idempotent-Replay: true`), per-actor keying; `expectedVersion` → `STALE_VERSION`; concurrent `round.draw.next` → one `200`, one `409 STALE_VERSION`; double-lock same key safe; UNIQUE(round,number)/(round,skill) backstops (`p2`, `p3`). |
| T6 | Event-message spoofing | **partial (deployment)** | No client publish path (SSE is read-only fan-out); clients treat events as hints and reload authoritative snapshots. TLS/HSTS are an ingress responsibility (not set by the app) — see improvement #6. |
| T7 | Projection data leakage | **pass** | Allowlist + recursive `redact`; forbidden-key and privacy-regex scans of public/stage/participant snapshots, all SSE payloads, audit and error bodies came back empty (`p2`, `p3`, `p5`); `projection-redaction.test.js` 6/6, `public-stage-views.test.js` green. |
| T8 | Manipulated client marks cells / declares winner | **pass** | Finalize ignores client `positions`/`cells`/`skillIds` and still yields server-randomised 25 unique cells; `round.draw.next` ignores client-supplied `skillId`/`skill` in params; participants cannot POST commands (`p2`, `p3`). |
| T9 | Employee identity spoofing | **partial (accepted, OD-02)** | Same `employeeRef` maps to the same participant and overwrites name/consent + issues a session — see improvement #2. Accepted for v1 per threat model. |
| T10 | Overload / reconnect storm | **pass (config caveat)** | Token-bucket limits (commands 10/s per actor verified via inadvertent `429`; session per IP), SSE replay window 500, `since` ahead → `system.snapshot_required`, negative `since` → `400`; RISK-01 + XFF are deployment conditions (improvements #1, #3). |
| T11 | Secrets in bundles or repo | **pass** | SBOM/assembly secret scan clean; production refuses missing secrets and `BINGO_RNG_SEED`, and does not fall back to dev values; dev-token defaults in the tarball are inert in prod — hardening note #5. |
| T12 | Supply-chain compromise | **pass** | `build/sbom.json`: 6 workspace components, **0 third-party runtime dependencies**; assembly `deps.thirdParty` check enforced. |
| T13 | XSS via display names / reasons | **pass** | `dom.h` uses `textContent`; no `html:` escape-hatch or `innerHTML/insertAdjacentHTML` with server strings in any app; soul SVG parsed via `DOMParser('image/svg+xml')`; QR is self-generated with `escapeAttr`; CSP `default-src 'self'`, no `script-src 'unsafe-inline'` (`p5`, source review). |
| T14 | Path traversal in static serving | **pass** | `safeResolve` confines to root; `../`, `%2e%2e`, `....//`, encoded and mixed traversals to `data/*.sqlite`, `.env`-like, `package.json`, `config.js` all → `404`; sqlite/dotfiles never served; legit assets served with correct MIME (`p5`). |

Additional checks passed: participant SSE stream isolation (no other participants' ids or forbidden keys), STALE_VERSION snapshots carry no secrets, structured logs contain no `employeeRef`/session/join/float tokens/secrets/selections (only the dev startup banner prints dev tokens, dev env only), and the retention job purges all participant-identifying rows (participants/boards/souls/float_tokens/sessions → 0) while keeping one aggregate archive and marking the event `archived` (`p6`).

---

```yaml
stage_id: 7-critique-red-team
status: submitted
artifacts:
  - reports/critique/critic-red-team.md
  - scratchpad/red/lib.mjs
  - scratchpad/red/p1-auth.mjs
  - scratchpad/red/p2-idor-idem.mjs
  - scratchpad/red/p3-float-race-sse.mjs
  - scratchpad/red/p4-float.mjs
  - scratchpad/red/p5-static-headers-audit.mjs
  - scratchpad/red/p6-retention.mjs
counts_by_severity:
  blocking: 0
  critical: 0
  major: 0            # RISK-01 is a deployment condition, not a code defect
  minor: 4            # T9 residual, XFF trust, participant-reject audit gap, dev-token hygiene
  preference: 1       # DEF-04 catalogue drift
  deployment_conditions: 3   # RISK-01 session limit, XFF trust, TLS/HSTS
controls_verified:
  T1: pass
  T2: pass
  T3: pass
  T4: pass
  T5: pass
  T6: partial   # TLS/HSTS is an ingress responsibility
  T7: pass
  T8: pass
  T9: partial   # accepted v1 guest-flow residual (OD-02)
  T10: pass     # with documented rate-limit/XFF deployment config
  T11: pass
  T12: pass
  T13: pass
  T14: pass
recommendation: approve-with-follow-ups
```
