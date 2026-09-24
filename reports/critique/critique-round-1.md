# Critique Round 1 - Orchestrator Triage

Run `run-20260922-113339` · Build `bingo-ce0d1074e6df` · Critics: UX, Game Fairness, Visual/Motion, Event Operations, Red-team (individual reports in this folder).

**Recommendations received:** 5 x approve-with-follow-ups. Critical findings: 0. No hard-QC violation was revealed, so critique remains a soft gate; the orchestrator triaged once and issued a single consolidated repair brief per owning workstream (correction loop 1 of 2).

## Accepted for repair (correction loop 1)

| ID | Source | Severity | Requirement | Finding | Owner | Correction |
|---|---|---|---|---|---|---|
| VM-01 / EO-01 | Visual, Ops | major | S-03, 4.4 | Stage dashboard in WINNER hides co-winner names and empties recent draws (flex shrink + partial-row clipping) | stage-dashboard | `.winners { flex: 0 0 auto }`, draw tile flexes, exclude winners list from clipPartialRows; re-capture stage-winner.png |
| UX-01 | UX | major | 4.1, M-13 | "Build my board for the next round" only shows after Float; Float is optional, so non-floaters are locked out of round N+1 | employee-mobile | Show the next-round action whenever nextRound is DRAFT/REGISTRATION_OPEN regardless of Float |
| UX-03 | UX | major | A-01, 4.2 | Lock now is the primary button and unconfirmed (irreversible) | admin-portal | Confirmation dialog on Lock now; demote to ghost style |
| F-01 | Fairness | major | BR-06, E8, AC-9 | A late joiner's draft lives only in tab sessionStorage; server never creates DEFERRED(late) | game-service + employee-mobile | Server stores a late draft as a DEFERRED board (reason `late`) on the locked/playing round and reassigns it when the next round opens; client keeps its local fallback |
| EO-02 | Ops | major | P-04, 12.1 | Non-consented winners appear only as `Soul #NNNN`; the player never sees their own pseudonym, so the MC cannot verify a winner | game-service + employee-mobile + ops | Add `participant.publicLabel` to the participant projection (contract 1.0.2); show it on the result view; runbook step for winner verification |
| EO-03 | Ops, Red-team | major (deployment) | 15.2, OD-14 | Join rate limit behind NAT unverified at venue | orchestrator (ops docs) | Release checklist + rehearsal script: 10 phones join within 60 s on the venue network; record `BINGO_SESSION_RATE_PER_MIN` / `BINGO_TRUST_PROXY` |
| EO-04 | Ops | major (evidence) | 18 | QA summary, privacy/resilience reviews, rehearsal script still list DEF-01/02 as open; 5 screenshots show the pre-fix pseudonym collision | qa + app owners | Reconcile documents to the current build; re-capture winner screens with >= 2 winners, one non-consented |
| UX-04 | UX | minor | E19 | E19 (lock failed) never surfaced in the admin portal | admin-portal | Map a failed `round.lock` response to E19 copy |
| VM-04 | Visual | minor | 11 | `pill--live` pulses infinitely on the public audience panel, contradicting the motion spec | public-galaxy | Remove the infinite pulse from the public panel pill |

## Deferred to the versioned backlog (not blocking v1)

UX minor/preference items (copy fallback keys for OD-11, stage truncation, E4 toast noise), F-02 (seed layout by set to remove cheap re-rolls), F-03 (pseudonym space 4 digits), F-04 (timer-lock retry audit storm), F-05 (role change after finalize), F-06 (shared admin actor identity), VM-02..VM-16 (sub-32 px secondary text, cluster labels at the safe-zone edge, reduced-motion static instead of 400 ms fade, base.css fallback colours inverted vs tokens, halo variant reading, stage reconnect banner hides hero), EO-05..EO-13 (runbook next-round loop, presenter narration card, rollback WAL files, TLS topology, extra drills), Red-team minors (T9 identity overwrite on re-join pending SSO, audit failed auth on participant endpoints, dev tokens present in shipped config.js/seed.js but inert in production), DEF-04 cosmetic.

## Deployment conditions carried into the release checklist

1. `BINGO_SESSION_RATE_PER_MIN` sized for the crowd and `BINGO_TRUST_PROXY=1` only behind a proxy that rewrites inbound `X-Forwarded-For`.
2. TLS and HSTS terminated at ingress.
3. `BINGO_ENV=production` with all secrets set (server refuses to start otherwise).

## Strengths to preserve (consensus)

Skill-level Core/Critical pool snapshotted at lock; cryptographic draws with the seed refused in production; single transaction for draw, matches, evaluation, winners, state, and outbox; idempotency and version checks; Souls equal by construction with an inclusive cohort; safe zone hard-clipped; motion within requirement ranges with reduced-motion twins; E1-E23 reachable with correct copy; zero third-party dependencies and a reproducible build.

## Decision

Critique outcome: **approve-with-follow-ups**. Release remains blocked on the eight manual sign-offs listed in `reports/qa/release-gate.json` and on the correction loop above.
