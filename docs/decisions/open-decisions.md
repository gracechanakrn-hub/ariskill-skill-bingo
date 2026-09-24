# Open Decisions

Every entry has a question, recommended default (which the build uses), owner, and the gate or artifact it blocks. Work outside the `blocks` boundary continues.

| ID | Question | Recommended default (in use) | Owner | Blocks |
|---|---|---|---|---|
| OD-01 | Expected concurrent players / Souls? | Size for 300 players + 50% headroom (450) in load tests. | Event owner | Capacity plan, performance budgets, load-test acceptance |
| OD-02 | Employee authentication method? | Signed event join token + employee reference (D-07); switch to company SSO if available. | Security owner | Session/API security design, security gate |
| OD-03 | Public winner name policy? | Explicit consent at join; consented display name, otherwise pseudonym `Soul #NNNN`. | Privacy owner | Public winner projection, consent copy, privacy gate |
| OD-04 | Round start grace window? | 60 s after lock, then operator warning; never auto-start. | Event owner | Admin timing copy, acceptance tests, runbook |
| OD-05 | Winner display duration? | 12 s (configurable 10-15). | Event owner | Public Winner timing, venue rehearsal |
| OD-06 | Draw pacing? | Manual Next Skill; UI hint 5-8 s; never auto-fires. | Event owner | Admin copy, MC rehearsal script |
| OD-07 | What if no board can win? | Warn before start; admin must reschedule or cancel. | Product owner | Start readiness, exception copy, mechanic sign-off |
| OD-08 | Raw data retention? | 90 days, then anonymized aggregates only. | Privacy owner | Data lifecycle job, privacy approval |
| OD-09 | Soul persistence after event? | Retain with participant data only; deleted with it. | Privacy owner | Soul lifecycle, deletion behavior, privacy approval |
| OD-10 | Matrix version? | Snapshot `matrixVersion` at board finalization; private insight uses it. | AriSkill data owner | Insight contract, analytics acceptance |
| OD-11 | Localization and operational chrome copy? | English v1 with externalized strings (`packages/contracts/copy.json`). Admin and stage apps ship proposed operational labels (`adminLocal.*` in apps/admin-portal/src/copy.js; `FALLBACK_COPY` in apps/stage-dashboard/src/view.js) that resolve from copy.json first once the content owner adopts them. | Content owner | Final copy, layout validation, content sign-off |
| OD-12 | Existing brand/design system? | Provisional tokens in `packages/design-tokens` clearly labelled; replace before visual QA. | Design owner | Visual QA and final UI sign-off (not mechanics) |
| OD-13 | Core/Critical derivation (D-06) acceptable to AriSkill data owners? | Skill-level flags derived from the matrix. | AriSkill data owner | Draw-pool acceptance test sign-off |
| OD-14 | Venue hardware (public/stage displays, admin device, network)? | Assume 1920x1080 displays, modern Chromium, venue Wi-Fi; verify before rehearsal. | Event operations | Compatibility gate, rehearsal |
| OD-15 | Human approvals at Gates 1-3, security/privacy, go-live (D-09)? | Orchestrator provisional acceptance recorded; go-live not claimed. | Product owner | Release / go-live |
