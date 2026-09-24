# Stage dashboard (`/stage`)

Read-only, distance-readable presenter view for AriSkill Skill Bingo (requirements 4.4, 5.4 S-01..S-03, 7.3, 12, 16).
Served by the game service at `/stage` from this folder; native ES modules, no build step, CSP `default-src 'self'`
(no inline scripts). The app holds the **stage token only** and issues only `GET` requests
(`/api/v1/time`, `/api/v1/stage/events/{id}/snapshot`, `/api/v1/stage/events/{id}/stream`).

## Files

| Path | Role |
|---|---|
| `index.html` | Shell: tokens.css -> base.css -> motion.css -> app.css, `<html class="theme-venue">`, one module script |
| `app.css` | 1920x1080 grid (status strip / participation tiles / main / footer), venue type scale, no scrolling |
| `src/main.js` | Boot, token gate, snapshot -> SSE -> reducer wiring, celebration guard, audio, timers |
| `src/state.js` | Pure reducer + view-model derivation (tested) |
| `src/view.js` | DOM tiles via `dom.h` (never `innerHTML`), copy via `t()` / `exception()` with documented fallbacks |
| `src/insights.js` | Pure formatters for insight tiles (tested) |
| `src/api.js` | Stage token handling (`?token=` once -> sessionStorage, URL stripped), read-only API client |
| `app.css` | Venue type scale + tile polish; the insights HUD (right side of the live layout) uses vendored Space Grotesk (`packages/vendor/space-grotesk`, OFL) at 500/700 |
| `src/backdrop.js` | Ambient Three.js backdrop (stage 9.3, D-22 + art direction v2 aurora): lazy `import('/packages/vendor/three/index.js')`, aria-hidden canvas behind the tiles; pure layout helpers (stars, fireflies, foliage, aurora) tested |
| `test/*.test.js` | `node --test apps/stage-dashboard/test` |

## Run

```sh
SEED_PLAYERS=30 node services/game-service/src/seed.js
node services/game-service/src/server.js          # prints the stage token (dev: dev-stage-token)
open "http://127.0.0.1:<port>/stage/?token=<stage token>"   # or paste the token into the prompt
```

Optional `?event=<eventId>` (default `evt_demo`).

## Behaviour

- **Token**: `?token=` is stored in `sessionStorage` and removed from the URL; without one a minimal prompt is shown.
  401/403 -> E9 copy, token cleared.
- **Layout auto-maps from the round state** (requirement 7.3):
  - `insights` focus (no round, DRAFT, REGISTRATION_OPEN, LOCKED, EXHAUSTED, CLOSED, CANCELLED): status strip
    (countdown to `lockAt`, locked/waiting + `startOverdue` hint, notices, next-round schedule), six participation
    tiles, five insight panels with full lists (top 10 skills, Core/Critical/Optional density, Platform and Role
    engagement top 8 by joined + suppression note, matrix alignment rate + version, top 10 skills beyond the
    matrix). Previous winners appear as a line inside the status strip.
  - `live` focus (PLAYING, WINNER): current draw + last 10 draws + pacing/matched, winners tile with
    `winningDrawNumber` and `publishedAt`, compact insights (top 5 / top 3 / top 5). The winners tile never
    shrinks or clips (`.winners { flex: 0 0 auto }`, excluded from `clipPartialRows`); beyond 6 co-winners the list
    drops one type step and shows "+N more". In WINNER the current-draw card collapses to one line so the
    recent-draw list keeps its rows; the draw tile takes the remaining height (`flex: 1 1 0`) and hides only whole rows.
- **Realtime**: stage snapshot -> `applySnapshot` -> SSE `since=sequence`; events go through `reduce`; reconnect,
  gaps and `system.snapshot_required` refetch + `acknowledgeSnapshot`. The full snapshot is also refetched every
  15 s (insights are server-computed with a 2 s cache) and `/time` is polled every 5 s for the contact age.
  Reconnect banner keeps the last frame; the footer pill turns to "Last update N s ago" when the server has not
  been reached for > 10 s.
- **Motion**: `.m-fade` on changed tiles, `.m-draw-arrival` on live draws, `.m-winner-burst` (restrained) on a live
  result; all gated by `createCelebrationGuard` so replays/snapshots never re-celebrate. Reduced-motion toggle
  persisted by `motion.js`.
- **Backdrop (game experience, D-22)**: `mountBackdrop(document.body)` runs after first paint (`requestIdleCallback`) and
  inserts an `aria-hidden` `<canvas class="stage-backdrop">` at z-index 0 behind `#app`: violet nebula plane (fbm noise,
  drift 0.012 rad/s), two star layers with slow twinkle (0.6-1.1 Hz), 38 gold/violet fireflies on Lissajous drift
  (pulse 0.15-0.25 Hz, kept out of the footer band) and two procedural foliage silhouettes in the bottom corners. All
  layouts come from a seeded PRNG (`BACKDROP_SEED`), so every load is identical. Rendered at 0.5 device pixels, capped
  at 30 fps, paused when the tab is hidden. Reduced motion (toggle or OS preference) freezes it to one static frame;
  when WebGL is unavailable or anything throws, no canvas is inserted and the CSS gradient on `<body>` remains.
  `<html data-backdrop="webgl|css">` reports the mode. Tiles keep an opaque `--ui-surface` under a <= 10 % white gloss,
  so text contrast is independent of the backdrop (worst case 5.07:1 Optional grey, body text 10.7:1).
- **Aurora band (art direction v2, `docs/art/sticker-art-direction.md`)**: three teal -> lime ribbons across the upper
  sky (`auroraField(BACKDROP_SEED + 6)`, centres at v 0.70-0.86 so they show through the status-strip / tile gaps and
  the side gutters at 1080p), drawn as one additive full-screen plane between the nebula and the stars, drifting at
  0.01 rad/s (`AURORA_DRIFT_RAD_PER_S`). The light is pre-compensated against the violet sky base so the hue stays
  teal / lime, and the shader clamps the added light to `AURORA_LUMINANCE_CAP` (Rec. 709 Y 0.22): the measured band
  peak is <= ~0.13 linear in every frame (static frame included), so even body text keeps >= 4.5:1 over it (no text sits on the sky anyway; the footer band
  under the aurora-free lower sky measures 15.9:1 body / 9.0:1 muted). Zero below v = 0.5. Reduced motion freezes it
  with the rest of the scene (time 0); without WebGL the `<body>` gradient carries a static CSS aurora ribbon
  (`color-mix` on the `--sticker-aurora-*` tokens). `auroraSample()` is the JS twin of the fragment shader and is
  what the tests exercise (bounds, determinism, drift rate, luminance cap, shader source parity).
- **Tile polish (CSS only, app.css "Game polish")**: glossy squircle surfaces (`corner-shape: squircle` where
  supported, 28 px radius otherwise), top highlight, inner shadow, soft violet glow; gold corner light + glowing star on
  the winners card; warm glow on "Bingo is live" (`.draw__pacing--live`) and the "Bingo!" hero. Type sizes and the
  1920x1080 no-scroll rule are unchanged; `prefers-contrast: more` removes the gloss and hides the backdrop.
- **Sticker language (art direction v2, CSS only, app.css "Sticker language")**: pill badges in the display face
  (`--font-display`, fallback "Plus Jakarta Sans" 800; Fredoka resolves to its 700 max) with a 2 px outline, a white
  die-cut (`--sticker-outline`, 4 px; 3 px on the small recent-draw chips) and `--sticker-shadow`: the Round status chip
  (Locked = badge fill + peach outline, Playing = lime fill + navy type, Bingo = gold type + gold outline), the Core
  (gold) / Critical (cyan) / Optional (badge) chips in the hero, draw card and recent-draw rows, and the "Bingo!" hero
  pill with the gold star. The round number renders as a medallion (`.sk-medallion::before` from `data-number`: circle,
  constellation dots, dashed mint ring; the "Round N" text stays in the `<h1>` for assistive tech). The current-draw
  card and the winner card carry the die-cut + shadow (`.sk-card`); matched-board counts, draw numbers and the winners
  title use the display face. Token names are the final design-tokens 1.2.0 names with the brief's values as `var()`
  fallbacks. No doodads on stage, no new animation (flash safety: the winner celebration stays the single one-shot
  `.m-winner-burst`), `prefers-contrast: more` keeps the outlines but drops shadows, glows, gloss, the backdrop canvas
  and the CSS aurora. Contrast: ink on badge 10.1:1, gold on badge 8.0:1, navy on lime 15.4:1 / gold 11.4:1 / cyan
  12.6:1, body text on tiles 10.7:1, muted 6.05:1.
- **Audio**: muted by default (`startMuted`), master mute + volume in the footer (persisted per app by
  `audio.js`); cues `draw_reveal` (+`draw5_unlock`), `bingo` (once per round), `float_launch` (once per Soul),
  `reconnect`; captions go to the footer live region.
- **Accessibility**: landmarks (`header`/`main`/`footer`), headings per tile, polite live region for draws, results
  and state changes (no focus theft), kind always shown as icon + label, keyboard order skip link -> main ->
  footer controls, no global shortcuts, 44 px targets.
- **Privacy**: only the stage projection is rendered; no `joinUrl`, no per-person data, cohorts < 5 are already
  suppressed server-side and the count of hidden groups is shown with `stage.suppressed`.

## Copy keys used

Catalog (`packages/contracts/copy.json`): `app.title`, `stage.*`, `public.playing.*`, `public.winner.*`,
`public.waiting.title|previous`, `public.cancelled`, `public.exhausted`, `admin.lockCountdown`,
`admin.startOverdue`, `play.waitingStart`, `board.noRound`, `result.bingo`, `reconnect`, `syncing`, E1, E9, E12, E14.

Keys **missing from the catalog** are rendered through `tx()` with the fallbacks in `view.js#FALLBACK_COPY`
(proposed for the copy owner, OD-11): `stage.count.*`, `stage.state.*`, `stage.locksAt`, `stage.waitingDraw`,
`stage.recentDraws`, `stage.winners`, `stage.noWinners`, `stage.publishedAt`, `stage.topSkills`, `stage.density`,
`stage.platforms`, `stage.roles`, `stage.eng.joined`, `stage.eng.completed`, `stage.participants`,
`stage.matrixVersion`, `stage.noInsights`, `stage.noCohorts`, `stage.hiddenCohorts`, `stage.selections`,
`stage.live`, `stage.stale`, `stage.connecting`, `stage.sound`, `stage.on`, `stage.off`, `stage.volume`,
`stage.reducedMotion`, `stage.token`, `stage.tokenSubmit`, `stage.skip`, `stage.retry`, `stage.moreWinners`. Adding them to the
catalog needs no code change.

## Tests and checks

```sh
node --test apps/stage-dashboard/test
for f in apps/stage-dashboard/src/*.js; do node --check "$f"; done
grep -c "<script" apps/stage-dashboard/index.html          # 1 (external module)
grep -rn "innerHTML\|/admin\|adminToken\|\.post(" apps/stage-dashboard/src   # no matches (comment only)
```

Screenshots from the QA run: `reports/qa/screens/stage-*.png`; game-experience captures (headless Chrome with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, 1920x1080):
`reports/qa/screens/stage-game-{locked,playing,winner,reduced}.png`; sticker-language + aurora captures (same
Chrome flags, own server on port 8104 with its own DB, `SEED_PLAYERS=30`, round driven with admin commands):
`reports/qa/screens/stage-sticker-{locked,playing,winner,reduced}.png`.
