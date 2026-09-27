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

## v1.6 big-screen candidate (stage 15, D-36, branch `mobile-v2`)

Build `bingo-be2a06b4c257` (two consecutive assemblies gave the same id), 715 files, assets 6.63 of 7 MiB, gate `AUTOMATED_GREEN_MANUAL_PENDING` 18/18, the same 8 human sign-offs pending. Tests: 804 passing (npm test 232, public Galaxy 92, UI kit 157, phone 65, stage 35, admin 20, accessibility 49, asset pipeline 92, AI tools 52, design tokens 10). Assembled from the working tree: commit `6df5873` plus the uncommitted stage-13 and stage-15 files.

The big screen (each change approved from a render first; `apps/public-galaxy/README.md` "Stage 15"):
- **A living Galaxy:** Souls float on their orbits with depth (nearer Souls bigger and clearer), and a few do idle micro actions in 3D (wink, wave, step, turn, sway).
- **Say hi:** every few seconds one Soul flies to the front, waves and says "Hi, I'm {name}, {greeting}" in a speech bubble (up to 40 words, shown for its reading time). A Soul that just floated in goes next, so its player sees the greeting within moments (13.6 s in the live check).
- **Space:** a Blender sky - nebula, milky way, a galaxy, a planet limb, constellations, meteors, falling stars - that moves very slowly. The stickers, forest, fireflies, aurora and the white Soul border are gone from the big screen.
- **Winner:** a gold crown (Blender GLB) instead of the medallion, drawn 1.3x in a gold glow.
- **Panel:** the phone's fonts, the AriSkill sign, "Registration ends", a smaller QR with "Scan to join", a sound icon top right, a card with the previous five draws and the Blender "BINGO!" badge; no reconnect banner or text, "LIVE MISSION", skill kind or "Bingo is live"; sound captions go to screen readers only.
- **Also in this build (the other session, owner requests):** the screen split is 70 / 30 (D-52; the scene config follows, panelX 1344) and a full-screen button sits top left, fading when the mouse is still (D-51).

How it is built:
- **Assets:** `assets/space/` (178 KB, texture rather than scene data) from `tools/ai/blender/galaxy_space.py` and `tools/assets/build-galaxy-space.py`; `assets/souls/winner/crown.glb` (33 KB, 2,176 triangles) from `tools/ai/blender/winner_crown.py`. build-all checks both (`galaxy-space`, `winner-crown`) and lists them in the manifest (10 entries).
- **Code:** `packages/ui/soul3d` gains the skeleton, the actions and the crown (the `winnerCrown` rig option is the Galaxy's only; the phone keeps the medallion). The Galaxy gains the depth, float and visit timeline, the greeting bubble and the space layers. Reduced motion: no float, depth, actions or visits, and the sky at rest.
- **Panel CSS:** consolidated after review; the computed styles of all 103 panel elements match the approved review build in every state.

Live check on a test server (port 8093, scratch database, never the 8080 demo): the three.js tier loaded every space layer, the sign and the crown GLB; a visitor said hi in its bubble and the winner wore the crown; no console errors.

Open:
- **OD-24, greetings:** players' text reaches the whole room after an automatic filter only; needs an owner and HR / comms decision.
- **OD-25, winner emphasis vs BR-17:** the approved 1.3x gold winner bends the equal-size rule; needs a product sign-off (one constant turns the size back).
- **Greeting length:** the phone accepts 40 characters (D-42) while the bubble takes up to 40 words; raise the phone's limit if longer greetings are wanted.

Screens: `reports/qa/screens/big-screen-stage15.webp` (live), `big-screen-stage15-panel.png` (Waiting, Playing, Winner).

## v1.5 Soul faces candidate (stage 13, D-31 / D-32, branch `mobile-v2`)

Build `bingo-de93dd1b250e` (reproducible: two consecutive assemblies produced the same id), 670 files, gate `AUTOMATED_GREEN_MANUAL_PENDING` 18/18, the same 8 human sign-offs pending. Tests: 710 passing (game-rules 59, design-tokens 10, UI kit 138, game-service 78, employee 64, admin 20, public 62, stage 35, asset tools 72, AI tools 52, e2e + contracts + accessibility 120).

The build was assembled from a copy of the tree: commit `a697d55` (tag `stage-13-review`) plus the uncommitted stage-13 files. The in-progress 16-skill change (D-33 / D-34) was being edited in the same folder at the time, so it is not in this build. `build/` in the repo keeps the stage-12 files until the next `npm run assemble` there.

Every Soul created under contract 1.2.0 is a SoulConfig v3 (`docs/art/soul-faces.md`):
- **Face plate:** one of 10 white face shapes from the partner's sheet, picked from the Soul seed.
- **Eyes:** one of 10 eye designs, picked from the seed.
- **Antenna charm:** one of the 150 catalog charms replaces the glowing orb, picked from the seed, never one of the Soul's own 10 charms.
- **Face kit:** the skill face kit stays on top, refitted to the new face (glasses around the new eyes, eye patch and bandana, halo; no blush). Gradient, glow and the 10 body charms are as in v2.

The three picks are cosmetic and never come from skills (BR-17). Stored v1 and v2 Souls render as before, and the neutral fallback stays v2.

How it is built and drawn:
- **Art:** made in Blender by `tools/ai/blender/soul_face.py` and published to `assets/souls/v3/` (1315.5 KB of its 1.5 MiB budget).
- **Budget:** the runtime-asset budget rose from 6 to 7 MiB (D-31); the build uses 6.73 MB.
- **3D:** the phone and the Galaxy draw each Soul on the body of its own version (the new body for v3 Souls) through the shared `packages/ui/soul3d`.
- **2D:** the flat fallback is soul-renderer 5.0.0, which draws v2 Souls exactly as 4.0.0 did.
- **Robustness:** a hung body download no longer drops the Galaxy to 2D.
- **Contracts:** moved to 1.2.0 (D-32).

Live check on a test server (port 8093, scratch database, never the 8080 demo):
- **Configs:** 6 players over 2 rounds all got valid v3 Souls, and each plate, eye design and antenna charm matched its seed pick.
- **Screens:** the phone reveal and the Galaxy (impostors and a Float entrance) drew them in 3D with no console errors.
- **Galaxy timing:** under software rendering, the 3D stage was ready 2.7 to 3.4 s after load. Each impostor then took 4.4 ms, after one 0.5 s shader compile.

Open:
- **OD-20, skull and cross-eye designs:** two face plates are skulls and one eye design has a cross eye. They are the partner's designs, but at a workplace event they may read as death imagery and need a brand sign-off.
- **OD-18, face rule:** still open.
- **Backlog:** high-tier phones still prefetch the baseline hero body (330 KB) that v3 Souls do not use. `packages/ui/test` has two overlapping v3 fixtures.

Screens:
- `reports/qa/screens/decor-v3-{plates,eyes,examples,example-soul}.png` (Blender)
- `decor-v3-{phone-reveal,phone-reveal-closeup,public-entrance,public-galaxy,public-galaxy-closeup}.png` (live)

## v1.4 decorated Soul candidate (stage 12, D-29 / D-30, branch `after-gem`)

Build `bingo-5a3d6c80c6a1` (reproducible: two consecutive assemblies produced the same id), 621 files, gate `AUTOMATED_GREEN_MANUAL_PENDING` 18/18, the same 8 human sign-offs pending. Tests: 647 passing (game-rules 48, design-tokens 10, UI kit 109, game-service 75, employee 61, admin 20, public 57, stage 35, asset tools 72, AI tools 45, e2e + contracts + accessibility 115).

When a round finishes, the server decorates every baseline Soul once and saves the decoration with it (`docs/art/soul-decorations.md`):
- **Face:** the skill kind with the most matched tiles picks it: core gives nerdy glasses, technical a pirate eye patch and bandana, soft an angel halo and blush.
- **Charms:** 10 charms, split across the kinds in proportion to the 25 selected skills.
- **Colour, variants and slots:** the body gradient, the charm variants and their slots all come from the Soul seed.

No AI runs in the game. The catalog (`packages/game-rules/src/soul-catalog.js`) was built once:
- 50 procedural stars and all the 3D charm models and face kits come from Blender.
- The 100 tool and life-item icons were drawn by Gemini, with provenance per icon. All 100 pass QA; they took 126 requests in total (`reports/ai/charms-qa.json`).

The phone and the public Galaxy draw the same decorated 3D Soul from shared code (`packages/ui/soul3d`). After Ready to Float, the Galaxy flies the live 3D figure, then keeps it as an impostor of that figure. The 2D fallback (soul-renderer 4.0.0) draws the same decoration flat.

Contracts moved to 1.1.0 (SoulConfig v2). Public and stage payloads carry only charm ids, the face and the gradient, never skill ids, skill names or counts.

Open:
- **OD-18, face rule:** most Souls get the pirate face, because 87% of the skill catalogue is technical.
- **OD-19, AI art sign-off:** shipping Gemini-drawn art needs sign-off.

Screens:
- `reports/qa/screens/decor-{examples,faces,stars,gradients,slots,charms-sample}.png` (Blender)
- `decor-example-soul.png`: one full decorated Soul (Sunset colour, angel face, 10 charms), from the real rules (Blender)
- `charms-{technical,soft}.png` (icons)
- `decor-{phone-reveal,phone-reveal-closeup,public-entrance,public-galaxy}.png` (live)

## v1.3 baseline Soul candidate (stage 11, D-27 / D-28, branch `after-gem`)

Build `bingo-40ec8affc5ff` (reproducible: two consecutive assemblies produced the same id), 301 files, gate `AUTOMATED_GREEN_MANUAL_PENDING` 18/18, the same 8 human sign-offs pending. Tests: 543 passing (game-rules 23, design-tokens 10, UI kit 78, game-service 70, employee 55, admin 20, public 49, stage 35, asset tools 62, AI tools 30, e2e + contracts + accessibility 111).

The Soul is now one baseline character sculpted in Blender from the supplied reference (`docs/art/soul-baseline.md`). It is built reproducibly by `npm run ai:soul-baseline` and matches the reference silhouette at IoU 0.933. It ships as two quantised glTF models (hero 330 KB, lite 84 KB) that any palette tints through per-vertex masks. The phone shows it in 3D for the join mascot, the Soul reveal and the Float. The flat 2D Soul (thumbnails, Galaxy sprites, fallbacks) is a front projection of the same model, so 2D and 3D match. Per player the Soul varies by palette, glow and the Bingo Star badge. Trait data is unchanged, so no contract changed.

Open for sign-off: OD-16 (variety is now palette, glow and badge only) and OD-17 (new Soul alt text). Owed to a real-device check: 3D scene build time on an entry-level phone (2.5-5 s headless in software rendering; the frame-time probe falls back to the 2D Soul). Screens: `reports/qa/screens/soul-baseline-{match,turntable,colours}.png`, `employee-baseline-*.png`, `soul-v3-sheet.png`, `public-baseline-galaxy.png`.

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
