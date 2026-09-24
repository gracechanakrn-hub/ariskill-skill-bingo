# Venue performance (requirement 15.4, hard QC "Performance")

Run `run-20260922-113339`. Server-side numbers come from `tests/load/reconnect-storm.js` (`reports/qa/load-report.json`); venue rows must be measured on the real hardware and network during rehearsal.

## Automated (in-process, developer machine)

| Metric | Target (15.4) | PLAYERS=150 (gate run) | PLAYERS=450 (capacity 300 + 50 %) | Status |
|---|---|---|---|---|
| draw-next -> SSE delivery p95 (all streams) | <= 1000 ms | 19.96 ms (300 streams, 6 draws) | 58.78 ms (900 streams, 6 draws; p50 49.9 ms) | pass |
| draw-next -> SSE delivery max | informational | 20.8 ms | 60.82 ms | pass |
| draw command round trip p95 | informational | ~17 ms | 52.8 ms | pass |
| Reconnect storm recovery (all streams caught up) | <= 5000 ms | 64 ms (p95 63.62 ms) | 247 ms (p95 246.67 ms; one draw replayed to 900 streams) | pass |
| Public snapshot p95 under concurrent reads | <= 500 ms (API p95) | 41.73 ms | 12.01 ms (stage snapshot p95 295.69 ms, n=50) | pass |
| Setup API p95 (session/profile/save/finalize) | <= 500 ms | 37.23 ms | 23.27 ms (1350 calls, max 53.63 ms) | pass |
| Duplicate draw events / sequence gaps / replay below Last-Event-ID | 0 | 0 / 0 / 0 | 0 / 0 / 0 | pass |

Measured 2026-09-22 on the QA workstation (Node v26.8.2, in-process client + server, developer laptop). The 450-player column was re-measured on the corrected build (critique correction loop 1) with `PLAYERS=450 node tests/load/reconnect-storm.js`; `reports/qa/load-report.json` holds the latest run (the release gate re-executes the PLAYERS=150 run and overwrites it). The stage snapshot p95 (~300 ms at 450 players, insights aggregate cached 2 s) is the largest server cost observed and stays inside the 500 ms API target.

## Venue measurements (fill during rehearsal)

| Metric | Target | Measured | Device / network | Method | Status |
|---|---|---|---|---|---|
| Public renderer frame time at expected Soul count (300) | 60 fps target, >= 30 fps minimum | | | Chrome performance panel / `requestAnimationFrame` counter, 30 min soak | |
| Public renderer frame time at 450 Souls | >= 30 fps | | | same, seeded Galaxy | |
| LOD downgrade triggers | automatic at thresholds 120 / 300 (`scene-config.json`) | | | observe detail level switch | |
| Countdown drift between clients | <= 250 ms after correction | | | film admin, public, two phones side by side | |
| Mobile initial interactive load after QR | <= 3 s | | | Lighthouse / devtools on venue Wi-Fi, lower-end phone | |
| Draw to phone visible update on venue Wi-Fi | p95 <= 1 s | | | film admin click and phone at 60 fps, 20 draws | |
| Reconnect after Wi-Fi loss (phone, public display) | <= 5 s | | | toggle Wi-Fi, stopwatch | |
| Asset preload from venue cache / CDN | all assets before doors open | | | network panel, cache hit ratio | |
| Server CPU / memory with 450 streams | headroom > 50 % | | | `top` on the host | |

Sign-off: ______________________ Date: __________
