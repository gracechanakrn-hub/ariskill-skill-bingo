# Employee mobile (`/play`)

Responsive web app for participants of AriSkill Skill Bingo. Served by the game service at `/play` (static mount
`apps/employee-mobile`), opened from the event QR / join link `/play?t=<joinToken>`. Native ES modules, no build
step, no third-party code, CSP-safe (no inline scripts). Every screen is a projection of the participant snapshot
(`GET /api/v1/me`) plus the participant stream (`GET /api/v1/me/stream`); the client never computes matches,
winners or lock/start transitions (BR-05, BR-11, BR-19).

## Run

```bash
cd "<repo root>"
export BINGO_ENV=development BINGO_DB_PATH=/tmp/employee.sqlite PORT=8101 BINGO_PUBLIC_BASE_URL=http://127.0.0.1:8101
SEED_PLAYERS=12 node services/game-service/src/seed.js   # prints a sample /play?t=<joinToken> URL
node services/game-service/src/server.js
```

Tests (pure reducer / view-model module): `node --test apps/employee-mobile/test`.

## Structure

| File | Role |
|---|---|
| `index.html` | Document skeleton: skip link, header, banner host, `main#main`, settings footer, toast region. Loads tokens.css, base.css, motion.css, app.css and `src/main.js`. |
| `app.css` | Cosmos surface, sticker language (docs/art/sticker-art-direction.md: pill badges with a 2 px die-cut outline in the display font, Core / Critical / Optional chips, round-number medallion, "Bingo!" pill, outlined draw card, white die-cut on matched tiles, doodad slots), skill rows, chip strip, board/play/result/soul styling, `prefers-contrast: more` (gloss and shadows stripped), 320 px reflow. Tile / pill contrast is measured (see Sticker language below). |
| `src/main.js` | Bootstrap and orchestration: session, clock sync, `/me` snapshot, SSE with snapshot/acknowledge pattern, autosave (debounced 400 ms, idempotent retries, STALE_VERSION reconcile), finalize, insight, Float, toasts, settings row, telemetry. |
| `src/state.js` | Pure state: `initialState`, `applyParticipantSnapshot`, `reduceEvent(state, envelope) -> { state, effects }`, draft helpers (`addSkill`, `removeSkill`, `undoSelection`, `reconcileDraft`), selectors (`screenFor`, `editableRound`, `saveBlockedReason`, `playingBannerKey`, ...). Node-testable, no DOM. |
| `src/api.js` | Participant API on the shared `api-client` + `clock-sync`. |
| `src/audio-motion.js` | AudioManager (participant preload list, captions to the live region), celebration guard, reduced-motion / mute switches, cue helpers with app-level dedupe. |
| `src/views/join.js` | E1 Join + E2 expired link. Audio unlock runs inside the join tap. |
| `src/views/profile.js` | E2 Platform + Role: disabled placeholders, role filtered by platform, button disabled until both are chosen (E16). Never prefilled. |
| `src/views/select.js` | E3: tabs (role=tablist, arrow keys), debounced search, skill rows (`aria-pressed`, kind chip, eligibility), chip strip with Remove + one-level Undo, progress, E1/E8/E15 banners, E6/E18 retry. No "accept all" control. |
| `src/views/grid.js` | 5 x 5 grid shared by board / playing / result; state first (`.is-matched`, `.is-on-line`, `.is-locked`), one-shot classes only via the guarded effects. |
| `src/views/board.js` | E4 board ready (server countdown, Edit skills with warning), E4b no round, E5 locked, E5b deferred (incomplete / late / cancelled) with next-round info. |
| `src/views/playing.js` | E6: latest draw card, draw list, automatic matches, draws 1-4 banner vs "Bingo is live", matched count. |
| `src/views/result.js` | E7: winner / co-winner / not-winner copy, first line traced once (live only), Reveal my Soul (E22 while forming). |
| `src/views/soul.js` | E8-E10: staged reveal (skippable after first view, remembered per soulId), private Matrix insight, READY TO FLOAT countdown on the server clock, one-use Float with kept Idempotency-Key (E13 retry), floated state. |
| `src/views/common.js` | Copy access (`tl()` = shared catalogue first, local UI-chrome fallback), kind chips, notices, buttons. |
| `src/backdrop.js` | Violet night-forest backdrop layer: Canvas 2D aurora band (teal -> lime, pre-rendered once, bounded 0.01 rad/s drift), stars (slow twinkle < 0.5 Hz) and warm fireflies behind every screen, ~30 fps, paused when hidden, one static frame under reduced motion (OS preference or the in-app switch, watched live). The gradients, nebula and foliage silhouettes are CSS (`.cosmos`). |
| `src/backdrop-params.js` | Pure sticker-sky parameters: `auroraState(t, { width, height, reduced })` (angle swing bounded so the peak rate is 0.01 rad/s; frozen under reduced motion) and the doodad placement rules `doodadPlan(screen, width)` (rocket in the join hero corner, ringed planet in the waiting-sky strip on board / locked / deferred; nothing on dense screens; nothing below 360 px). |
| `src/doodads.js` | Inline SVG sticker doodads (rocket, ringed planet): flat two-tone fills, white die-cut outline, no text. Built here because `packages/ui/doodads.js` did not exist at integration time; swap for the shared sprite when it lands. |
| `src/liveness.js` | Pure liveness decision for participant stream events: the service numbers events across audiences, so the participant stream skips sequences on almost every draw and the shared sse-client reports each skip as a gap + replay. `sparseStreamLiveness` keeps the snapshot refetch but lets a genuinely new event of the acknowledged epoch celebrate / announce (see Behaviour notes). |
| `src/scene/loader.js` | Lazy access to the vendored Three.js (`/packages/vendor/three/index.js` + `addons.js`, D-22): `loadThree()` on demand, `prefetchThree()` from an idle callback while the round plays (modules, then the baseline Soul GLBs for the device tier: lite always, hero on the high tier). Once the round-end config is known (result screen), `prefetchSoulBody(config)` warms the v3 body of a v3 Soul for the tier (once; D-31) and `prefetchSoulDecor(config)` its charm / face-kit / plate / eyes / antenna-charm models. Nothing loads at startup. |
| `src/scene/capability.js` | Scene tier heuristic (`sceneQuality`: off / low / high from WebGL, DPR, cores, memory), pixel-ratio cap, and a 45-frame median frame-time probe (`> 33 ms` -> fall back to the SVG). QA override `?scene=off|low|force`. |
| `src/scene/soul-params.js` | Pure, deterministic 3D parameters from a SoulConfig. Baseline Soul (D-27): `baselineParams(config, badge)` (palette hex / ints from PALETTES, glow trait -> halo style, Bingo Star flag, seeded bob phase; ignores body / eyes / antenna / mouth, Platform, Role, rank), `BASELINE` (fit height 1.86 = the old framing, 3/4 yaw, die-cut width per tier, flash boost, orb glow, badge size / offset, bob), `outlineWidth`, `mascotPalette()` (lilac); reveal stage timing, `stickerPeel(p)` (scale 0.92 -> 1, 6 deg tilt, one 250 ms flash) and `revealScale`. The lathe profiles, speckles, antenna layouts and face crop are the legacy procedural Soul: no longer drawn, kept because tools/ai (Blender turnaround port, 1e-6 parity test) imports them. Size and glow are constants (BR-17). |
| `src/scene/soul-tint.js` | Since D-29 a thin re-export of `packages/ui/soul3d/tint.js` (shared with the Galaxy; adds the height gradient of decorated Souls). Pure per-Soul vertex colours for the baseline GLB: the COLOR_0 RGBA mask (R drips, G eye disc, B groove ring, A orb) tinted in the spec's order in linear light (fill -> highlight by R -> #F7F8FF by G -> outline by B -> highlight by A), plus `orbGlow(mask)` for the orb's emissive weight. Same maths as the Blender palette materials; deterministic Float32Array output. |
| `src/scene/soul-model.js` | Since D-29 a thin re-export of `packages/ui/soul3d` (model, figure, studio), shared with the Galaxy; since D-31 also `soulBodyVariant(config)`, which picks the v3 body (`packages/ui/soul-face-data.js`) for a v3 Soul. The baseline Soul for both scenes: loads `soul-baseline-{hero,lite}.glb` once per session per LOD (cached promise; URL from `packages/ui/asset-map.js` `soulModelUrl`, `GLTFLoader` from the vendored addons; bounds recomputed because the v1 GLBs store pre-normalised POSITION min/max), and `buildSoulFigure()`: tinted clay body (MeshPhysicalMaterial, vertex colours, clearcoat 0.8 / roughness 0.34 / peach sheen; orb emissive in the palette glow via the mask), white die-cut from the lite LOD (back faces pushed out along the normals, depth-write off, flash-able width), additive orb glow behind the orb. Also the shared look: AgX tone mapping with the Blender colour-render light energy (`LOOK`, `addStudioLights`) and a small PMREM studio environment for the clearcoat reflections. |
| `src/scene/join-scene.js` | Ambient mascot behind the Join form: the baseline Soul character (D-27 supersedes the old faceless-mascot rule: it is the brand character) from the lite GLB in the lilac palette, 3/4 view turned toward the hero copy, gentle idle bob + sway (no spin), tap pulse, lagging camera; lit orb + glow, white die-cut; no name, rank or label. Rings + ~300 motes (bloom on the high tier), one static frame under reduced motion, disposed on unmount; the CSS orb stays until it is ready or when WebGL / the model is unavailable. |
| `src/scene/soul-scene.js` | The reveal / Float hero scene: darkness -> glowing orb sprite + gathering motes -> the Soul resolves as the baseline character (hero GLB tinted in the player's palette, glossy clay, white drips / button eyes / groove ring, lit antenna orb, white die-cut) in a 3/4 view above a glowing ring with a slow bob + sway; the Bingo Star (gold, white die-cut) floats at the model's `badge_anchor` when earned; the glow trait is the halo style (soft back glow / dashed ring / halo ring above the orb). The silhouette stage fades the body in; the features stage lights the orb, badge and halo with the sticker peel (0.92 -> 1, 6 deg tilt, one 250 ms die-cut flash). Float lifts it with a mote trail and fades. Low tier: lite GLB, no clearcoat, no bloom. Model / module failure -> null (SVG path). Timed by the callers with the motion tokens; skip jumps to the end; static under reduced motion. Since D-31 the models are those of the config's body variant (`loadSoulModels(mods, quality, { variant: soulBodyVariant(config) })`): a v3 Soul stands on the v3 body, with no lit orb. |

## Sticker language (art direction v2)

- Tokens come from `packages/design-tokens/tokens.css` (`--sticker-*`, `--font-display`) and every use carries a CSS
  fallback, so the app renders the same on an older token build. Fredoka is the vendored display face
  (`/packages/vendor/fredoka/fonts.css`); body text stays Plus Jakarta Sans.
- Measured contrast (WCAG, composited over the page ink): tile name 6.5:1 and tile meta 5.5:1 on `--tile-top`,
  kind icons on tiles >= 4.3:1 (optional icon 5.2:1), selected row 6.8:1, matched tile ink on gold 7.4-14.7:1,
  pill ink on badge 10.1:1, Core pill 11.4:1, Critical pill 12.6:1, "Bingo!" pill 15.4:1, medallion 8.4:1,
  draw card 11.8:1, draw number pill 11.4:1. Script: `node` over the pairs in the stage handoff.
- No level / rank / score label ever appears on or near a Soul (BR-17); the only badge is the Bingo Star.
- Doodads never overlap text or controls (reserved slots only) and are hidden below 360 px; they bob +-6 px over
  4.6-5.2 s and stop under reduced motion. The aurora is static under reduced motion. The peel flash is a single
  250 ms pulse (flash-safety tokens), the additive glow is capped.

## Behaviour notes

- Session: `localStorage['ariskill.play.session:<eventId>']` (plus `ariskill.play.lastEvent`), so a QR re-scan or a
  closed tab keeps the session; the draft is stored under `ariskill.play.draft:<eventId>:<participantId>`. A stored
  session is reused; otherwise the join form needs `?t=`. 401/403 on `/me` or the stream drops the session and shows E2.
- Late joiners (F-01): a participant without a board may save while the round is LOCKED/PLAYING/WINNER/EXHAUSTED; the
  server parks the draft as a DEFERRED (late) board and answers with a `notice` (E8 copy). The client projects that
  response (and the `board.deferred {reason:'late'}` event) to the deferred screen with the E8 copy. An older backend
  that still answers ROUND_LOCKED keeps the local draft and shows the E8/E1 notice on the selection screen.
- Next round (UX-01): the "Build my board for the next round" card appears on the result and Soul screens whenever a
  newer round accepts boards, independent of Float; READY TO FLOAT stays available alongside it.
- Public label (EO-02): the result view shows "Shown on the public screen as: <participant.publicLabel>" (consented
  display name or Soul # pseudonym) when the backend sends it, so a winner can identify themselves to the MC.
- Draft: the local 25-skill draft is the only client-owned state. It is saved with `PUT /me/board/selections`
  (`boardVersion`, debounced 400 ms, same Idempotency-Key while the set is unchanged). On network failure the
  api-client retries with the same key; on E6 the draft stays in `sessionStorage` and is re-PUT on the next
  reconnect / snapshot / round event whenever the server set differs. STALE_VERSION applies the returned board
  snapshot and re-saves with the current version. The 25th selection triggers `POST /me/board/finalize`; failure
  shows E18 with a retry that reuses the key. A READY board whose set changes returns to DRAFT (server rule) and
  re-finalizes with a new shuffle.
- No editable round: the draft is kept locally with the E1 (no round), E8 (in progress) or E15 (cancelled)
  banner, `/me` is refreshed every 20 s, and the draft is saved as soon as a round accepts saves.
- Realtime: first `/me` snapshot -> `createSseClient({ since })`; on reconnect (`connectionEpoch > 1`) or a gap the
  snapshot is refetched and acknowledged. `reduceEvent` returns effects; each effect is gated by the celebration
  guard (`shouldCelebrate(key, meta)`) so replayed / snapshot-covered events set final state without animation or
  sound. The audio manager is put into replay mode while a snapshot is applied.
- Countdown: `formatCountdown(round.lockAt, clockSync.now())`, display only; E7 "Syncing..." while unsynced.
- Accessibility: skip link, landmarks, one h1 per screen, labelled controls, 44 px targets, `focus-visible`,
  polite live-region announcements for draws / results / lock / deferral (never moves focus), dismissible toasts,
  reduced-motion and mute switches (persisted), 320 px reflow. Kind is always icon + label + colour.
- Copy: everything user-facing comes from `packages/contracts/copy.json` via `t()` / `exception()`. A few UI-chrome
  strings the catalogue does not define yet (settings switch labels, Dismiss, Try again, Reveal my Soul, Skip
  reveal, Back to my board, Next round, ...) live in `views/common.js` `LOCAL_COPY` and are looked up only when the
  shared catalogue has no value for the key.

## Game experience (stage 9.2, D-22)

- Look: glossy squircle tiles for the board, skill rows and chips (top highlight, inner shadow, opaque surfaces for contrast), matched
  cells in warm gold with a star accent, the completed line traced with a light sweep (`.bingo-grid.m-line-trace::after`), a radial
  progress ring (`.ring`, conic-gradient driven by `--p`) next to the catalogue copy `select.progress`, and the draw as a glowing reveal
  card. Every state keeps its icon / text twin; targets stay >= 44 px; the layout reflows at 320 px (smaller tile radius and type).
- Baseline Soul (stage 11, D-27, `docs/art/soul-baseline.md`): the phone draws one sculpted character for everyone
  (`/assets/souls/baseline/soul-baseline-{hero,lite}.glb`, 330 / 84 KB, served gzipped as `model/gltf-binary`), tinted per player
  from its vertex mask. Per player only the palette, the glow style and the Bingo Star vary; body / eyes / antenna / mouth stay in
  the config but are not drawn. The Join mascot is the same character (lite, lilac). The look follows the Blender colour renders
  (`reports/qa/screens/soul-baseline-colours.png`): AgX with the same light energy, clearcoat clay, studio reflections.
- Three.js (vendored, `packages/vendor/three`) is imported only by dynamic `import()` from the Join screen (after first paint, idle) and
  the Soul screen; the Playing / locked / result screens prefetch it from an idle callback so the reveal opens instantly. WebGL missing,
  module failure or a frame-time probe above 33 ms fall back to the existing SVG Soul with the staged CSS reveal.
- Soul reveal in 3D follows the `soulReveal` token (2000 ms: glow 0-35 %, silhouette 30-70 %, features 65-100 %), is skippable after the
  first view exactly as before, and the SVG stays in the DOM (visually hidden) so the accessible name never depends on the scene. Float
  runs the `float.launch` token (600 ms) as a lift-off with a mote trail, then the floated view shows the small SVG Soul. State is applied
  first; the scene is released 400 ms after a floated state that arrived without a live launch (replay / reload).
- Decorated Soul (stage 12, D-29, `docs/art/soul-decorations.md`): the reveal and Float show the Soul as the server
  decorated it at round end, built by the shared `packages/ui/soul3d` rig the public Galaxy also uses: the catalog body
  gradient, the face kit (nerdy glasses / pirate / angel halo) and 10 skill charms at fixed slots. Each charm and the face
  load on their own and are skipped if missing; charms that are not loaded within 700 ms join after the reveal starts.
  The join mascot stays the plain lilac baseline (it has no config). The SVG fallback draws the same decoration in 2D
  (soul-renderer 4.0.0).
- v3 Soul (stage 13, D-31, `docs/art/soul-faces.md`): a v3 config reveals on the v3 body (`soulBodyVariant`: no orb, no
  button eyes) with its face plate, eyes, the refitted face kit and the antenna charm, each loaded or skipped on its own
  like the charms; no orb glow sprite, and no halo ring for any decorated Soul (the soft glow instead). When the v3 body
  cannot load (the face data is still the stub, a 404) the scene resolves null and the SVG path draws the Soul. The v3
  body is prefetched on the result screen; the join mascot stays on the baseline.
- Reduced motion: backdrop static, no nebula drift, no bob / motes drift in the scenes (one settled frame), reveal and lift-off become
  short fades, line sweep off. Flash safety: no loop above 0.5 Hz, ambient amplitudes small.
- Sparse participant stream (`src/liveness.js`): observed on the game service, `/me/stream` ids skip on every draw (1416 -> 1419 ->
  1422 ...; other audiences' events sit between). The shared sse-client marks each skip as a gap and everything until the next snapshot
  acknowledgement as `replay: true`, which silenced every live celebration, cue and polite announcement on the phone. `main.js`
  keeps the gap -> `/me` refetch contract and only overrides liveness for events of the current, acknowledged epoch that are newer than
  the applied snapshot; reconnect backlog stays silent. Root cause belongs to the shared kit / service (reported in the stage handoff).

## Manual verification

`reports/qa/screens/employee-*.png` (390 x 844 @2x, plus 320 px variants) cover join, profile, selection (empty /
17 / search / edit warning), board ready + countdown, locked, playing (draws 1-4 and from 5), result, Soul reveal,
insight, Float countdown, floated, deferred (incomplete) and cancelled (E15).
`reports/qa/screens/employee-baseline-{join,soul-reveal,floated,reduced}.png` (stage 11, SwiftShader WebGL, `?scene=force`) cover the
baseline Soul: the lilac mascot behind the Join form, the revealed Soul (palette, halo style, Bingo Star), the Float lift-off with
its mote trail, and the single static frame under `prefers-reduced-motion`.
`reports/qa/screens/employee-game-*.png` (stage 9.2, headless Chrome with SwiftShader WebGL) cover the game look: join orb
scene, progress ring + glossy rows (+320 px), glossy board (+320 px), matched gold stars, line sweep, 3D Soul forming and
revealed with bloom, Float lift-off, floated, reduced motion.
