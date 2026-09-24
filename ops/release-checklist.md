# Release Checklist (go / no-go)

Build ID: `____________` (from `build/build-info.json`)  Schema version: `____`  Asset manifest hash: `____________`

## Hard QC (must all be green in `reports/qa/release-gate.json`)
- [ ] Functional: unit, state-machine, service, contract, e2e suites pass
- [ ] Data: schema constraints + migration up/down verified; retention job tested
- [ ] Concurrency: duplicate/stale/simultaneous commands, winner atomicity, reconnect gaps
- [ ] Security: threat model reviewed; authz tests; secret scan clean; dependency scan (zero third-party deps)
- [ ] Privacy: public/stage forbidden-key scan clean; consent policy configured; deletion/retention verified
- [ ] Accessibility: keyboard/screen reader walkthrough; contrast; reflow; reduced motion; silent mode
- [ ] Performance: load test at capacity + 50 %; p95 draw fan-out <= 1 s; frame time on venue hardware
- [ ] Compatibility: phone/browser matrix and exact venue display hardware
- [ ] Resilience: renderer/audio/asset/realtime fallbacks; restart recovery; no stale celebration
- [ ] Operations: dashboards/alerts, runbook practiced, backup, rehearsal done, rollback tested

## Deployment conditions (from critique round 1 / red-team)
- [ ] `BINGO_ENV=production`, all secrets set (`BINGO_ADMIN_TOKEN`, `BINGO_STAGE_TOKEN`, `BINGO_JOIN_SECRET`, `BINGO_SESSION_SECRET`); server refuses to start otherwise
- [ ] `BINGO_SESSION_RATE_PER_MIN` sized for the crowd (recommended 300 for a NAT'd venue) and recorded here: `______`
- [ ] `BINGO_TRUST_PROXY=1` ONLY when a trusted reverse proxy rewrites inbound `X-Forwarded-For`; otherwise unset. Recorded: `______`
- [ ] TLS and HSTS terminated at ingress; `BINGO_PUBLIC_BASE_URL` is the https venue URL (QR payload)
- [ ] Venue join-rate check passed in rehearsal: 10 phones join within 60 s on the venue network without a 429
- [ ] Admin and stage tokens distributed out of band; never shown on screen

## Approvals (named humans)
- [ ] Product owner (requirement lock and go)  ______
- [ ] Engineering  ______
- [ ] Design / brand (verified tokens replaced provisional)  ______
- [ ] Security / privacy  ______
- [ ] Accessibility  ______
- [ ] QA  ______
- [ ] Event operations  ______

## Waivers
| ID | Item | Approver | Expiry | Impact | Mitigation |
|---|---|---|---|---|---|

## Freeze
- [ ] Non-critical changes frozen before dress rehearsal
- [ ] Rollback build ID recorded: `____________` and verified deployable
