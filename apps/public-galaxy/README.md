# Public Galaxy (`/public`) - AriSkill Skill Bingo public event screen

Workflow stage 6.4, game-experience upgrade 9.1 (D-22). Left 70 % persistent Arise Galaxy, right 30 % (D-52; 65 / 35 before)
information panel with Waiting / Playing / Winner states. Native ESM, no build step, CSP-safe (no inline
scripts; the Soul atlas rasterises SVG through `data:` image URLs, allowed by `img-src 'self' data: blob:`).
The only third-party code is the vendored Three.js 0.186.0 (`/packages/vendor/three`, D-22), imported by
absolute path from `src/renderer/three.js` - never a CDN, import map or npm install.

```
index.html                 <html class="theme-venue">; galaxy region + panel + footer; no inline script
app.css                    70/30 grid (D-52), safe-zone panel (opaque, 32 px inner margin), venue type sizes
src/main.js                bootstrap: clock sync, snapshot + SSE (acknowledge pattern), audio, panel, galaxy
src/state.js               public projection reducer + panel view-model (pure, tested)
src/panel.js               panel DOM (dom.h only; QR via renderQr), auto-fit for long names / many co-winners
src/greeting-bubble.js     "say hi" speech bubble (D-36): text, size, reading time and placement (pure, tested) + the DOM bubble
src/copy.js                t()/exception() re-exports + fallbacks for control labels missing from copy.json
src/galaxy.js              renderer selection (three -> webgl2 -> canvas2d -> static), lazy Three import, loop, perf auto-downgrade, resize
src/entrance-queue.js      Float entrance queue: max 6 concurrent, 12 queued, overflow settles instantly (tested)
src/renderer/scene.js      renderer-agnostic scene model: layout, LOD, orbit placement + collision, drift, clusters; D-36: float,
                           depth (scale / haze / parallax), idle micro actions (acts) and the "say hi" visit timeline
src/renderer/space.js      D-36 space backdrop: space.json schema + loader, drift / twinkle / spin / falling stars (pure, tested)
src/renderer/impostor.js   3D impostors + live tiles (entrances, the visit, performers) on soul3d rigs; the winner's crown
src/renderer/atlas.js      renderSoulSvg -> Image -> offscreen canvas atlas at the 'simple' sticker (48..192 px cells = 1.5 x the
                           device size, scene.js#atlasCellFor; keyed by soulId+detail+badge+cell; 'full' is capped to 'simple')
src/renderer/three.js      PRIMARY: Three.js scene - the space backdrop (D-36: Blender plate, constellations, meteors, falling
                           stars), 3 star Points layers, dashed ring LineLoops, additive palette halos behind the stickers (a
                           winner's gold one, WINNER_LOOK), entrance trail / winner burst particles; EffectComposer (RenderPass ->
                           UnrealBloomPass -> RenderPass(overlay, no clear) -> OutputPass): the overlay holds the Soul stickers (no
                           die-cut on the big screen; the winner outline flash in the fragment shader) and the live 3D tiles, drawn
                           AFTER bloom so they stay crisp; DOM overlays for cluster labels and the greeting bubble
src/renderer/aurora.js, doodads-layout.js, forest.js  kept, but no longer drawn on the big screen (D-36 replaced them with the space)
src/renderer/three-quality.js  resolution scale / bloom per quality level, bloom pulse, WINNER_LOOK, outline flash + hull helpers (pure, tested)
src/renderer/webgl2.js     tier 2 (kept): batched textured quads via a single VAO, point-sprite stars, GL_LINES rings, context-loss hand-over
src/renderer/canvas2d.js   same scene with drawImage from the atlas, additive stars/glow, dashed rings
src/renderer/static.js     one composed frame (space backdrop at rest + star layer 1 + rings + Souls at `simple`), no loop
test/*.test.js             node:test for scene, entrance queue and state
```

## Run

```sh
cd "<repo root>"
export BINGO_ENV=development BINGO_DB_PATH=/tmp/public.sqlite PORT=8103 BINGO_PUBLIC_BASE_URL=http://127.0.0.1:8103
SEED_PLAYERS=40 node services/game-service/src/seed.js
node services/game-service/src/server.js
open http://127.0.0.1:8103/public
node --test apps/public-galaxy/test
```

URL switches (rehearsal only): `?mode=static|canvas2d|three` forces a renderer (`webgl2` is accepted as an
alias of `three`), `?quality=high|medium|low` sets the starting performance level (bloom is off on `low`),
`?motion=reduced` behaves like `prefers-reduced-motion` (static composition), `?event=<id>` selects the event
(default `evt_demo`). `window.__galaxy` exposes `stats`, `setSouls(list)`, `setQuality(q)`, `winner()` and
`loseContext()` for rehearsal checks.

## Behaviour summary

- **Panel states** come from `panelViewModel(state, now)`: Waiting (next round title, "Registration ends"
  countdown via clock sync, the QR card with "Scan to join" only, previous winners, cancelled/exhausted notice,
  or E1 copy when nothing is scheduled), Playing (`public.playing.draw`, auto-fit skill name - never its kind -,
  `public.playing.matched`, and a card with the previous five draws), Winner (the Blender "BINGO!" badge,
  winner and co-winner labels; auto-return follows `round.closed`, with `scheduleAt(resultWindowEndsAt)` as a
  display-only fallback). Stage 15 (D-36) layout and type: see the section below.
- **Realtime**: `GET /snapshot` -> `applyPublicSnapshot` -> `createSseClient({ since })`; on reconnect (epoch > 1)
  or gap the snapshot is refetched, applied and acknowledged; the celebration guard + id keys make draws, bingo,
  and Float entrances celebrate exactly once. Reconnect banner uses `t('reconnect')` (E12) and retains the last
  frame; a stale pill appears when the last server time is older than 10 s (a `/time` ping every 5 s keeps it honest).
- **Galaxy**: star layers with parallax + twinkle from the JSON, nebula.svg as an image, orbit rings, Souls placed
  by `soulOrbitSlot` with forward-scan collision resolution (stable across snapshots), bounded Lissajous drift
  (no shake), LOD by count (full <= 120, simple <= 300, dot above; clusters above 300), entrance arc -> pulse ->
  settle from the event's `edge`, snapshot Souls render in orbit silently. Auto-downgrade high -> medium -> low
  when the 2 s average frame cost exceeds 25 ms (30 s cooldown, never auto-upgrade).
- **Renderers**: Three.js (primary) -> raw WebGL2 -> Canvas 2D -> static. `galaxy.js` imports
  `src/renderer/three.js` lazily; if the vendor import or the WebGL context fails the chain continues. The mode
  indicator ("2D mode" / "Static mode") is shown in the footer only on the 2D tiers. On `webglcontextlost` the
  GL renderers dispose and hand over to Canvas 2D (`window.__galaxy.loseContext()` simulates it).
- **Three scene** (docs/art/game-experience-brief.md): violet night cosmos - domain-warped nebula shader, three
  twinkling star layers with parallax to the bounded camera drift, faint additive orbit rings, a few hundred
  warm-gold / violet fireflies, Souls as instanced atlas quads (same size and brightness for everyone, BR-17)
  with an additive palette halo behind each and gentle bob, clusters above 300 Souls as a neutral glow sprite
  with a DOM count label, a procedural forest silhouette frame (left / top / bottom edges only, deterministic
  from `SCENE_SEED`, three depth layers with slight parallax) and UnrealBloom post-processing (moderate
  strength; off on `low`; resolution scale 1.0 / 0.85 / 0.7 per level). Entrances arc in with a particle trail
  (high level) and a single decaying bloom pulse; timings come from `tokens/motion.json#galaxyEntrance`
  (1800 / 400 / 600 ms). The winner moment is one radial burst of warm motes plus a 2.6 s warm tint on the
  fireflies (no flashing, no camera shake, Souls untouched). The canvas and the label overlay are sized to the
  Galaxy region, so nothing is drawn at x >= panelX.
- **Audio**: `createAudioManager({ app: 'public' })`; "Click to enable sound" unlocks and starts the ambient bed;
  master mute + volume in the footer; captions go to a polite live region in the footer.
- **Accessibility**: the canvas is `aria-hidden`; an off-screen live region reports the Soul count; the panel is
  plain text at venue sizes; reduced motion renders the static composition; no element flashes above 3/s.

## Critique corrections

- VM-04 (round 1): the audience panel's `pill--live` no longer pulses (`app.css` overrides base.css's infinite
  `ui-pulse`); the only looping motion on the public screen is the Galaxy orbit / ambient glow.

## Known limitations / notes

- Copy keys for operator controls (`public.audio.enable|mute|unmute|volume`, `public.renderer.canvas2d|static`,
  `public.stale`, `public.galaxy.summary`, `public.loading`, `public.error`, `public.waiting.locksIn`,
  `public.winner.coWinners`, `public.connection.live`, `public.round`) do not exist in `packages/contracts/copy.json`
  yet; `src/copy.js` falls back to the listed English defaults until the copy owner adds them.
- `assets/scene/nebula.svg` already contains the nine dashed orbit ellipses; the renderers draw their own rings on
  top at identical geometry (they coincide exactly at 1248 x 1080), so the `low` level still shows the baked
  hairlines.
- The outer rings' ellipse aspect is clamped horizontally so no Soul is placed outside the Galaxy viewport
  (ring 8 would otherwise extend 46 px past the edges at 1248 px width).

## Sticker language (stage 10 / D-25, docs/art/sticker-art-direction.md)

- **Decorated Souls (stage 12, D-29, `docs/art/soul-decorations.md`).** A v2 Soul is the same decorated 3D Soul the
  phone showed, built by the shared `packages/ui/soul3d` rig: the Float entrance flies the live 3D figure, turning from
  side-on to the rest pose along its arc, and settled Souls are impostors of that figure baked into their atlas cell
  (within the frame budget, entrances first, page uploads capped at 5 per second). GLTFLoader and the models load when a
  round ends or when the first v2 Soul appears; screens with only v1 Souls never load them (D-28). The canvas2d, static
  and webgl2 tiers draw the 2D composition: the SVG without images, then the face and charm sprites drawn onto the cell.
  The static tier now repaints after a resize (it went blank before, a pre-stage-12 bug).
- **v3 Souls (stage 13, D-31, `docs/art/soul-faces.md`).** The impostor stage (`src/renderer/impostor.js`) loads both
  body variants when it starts (the baseline and the v3 body of `packages/ui/soul-face-data.js`, each cached) and
  builds every decorated Soul on the body and die-cut hull of its own variant (`soulBodyVariant`): a v3 Soul bakes and
  flies its Float entrance on the v3 body with its face plate, eyes, refitted face kit and antenna charm, like the phone.
  When the v3 body cannot load (the face data is still the stub, a 404) v2 Souls stay 3D and v3 Souls keep the 2D
  composition in their cell and their atlas sprite in the entrance; the stage only fails when no body loads at all.
  A variant still loading 9 s into start-up (`IMPOSTOR.variantWaitMs`) counts as missing, so one hung download cannot
  trip the 12 s init timeout; it joins the stage when it lands, and later bakes and entrances use it. The keeper rig (the shader programs kept for the stage's lifetime) is unchanged: every variant shares its programs.
- **Souls = die-cut stickers in the sky.** The atlas is rebuilt from soul-renderer 3.0.0 at detail `simple`: the Arise
  Soul baseline character of D-27, drawn from its 3D model. The taller figure with the antenna orb spans y 19.8 .. 180.1
  of the 200 x 200 cell viewBox before the die-cut, so nothing is clipped (checked at 48-128 px cells,
  `reports/qa/screens/public-baseline-galaxy.png`). The `full` level is capped (its SVG filters blur at cell size and
  rasterise slowly). Cells are 1.5 x the on-screen device size
  (`ATLAS_CELLS` 48/64/96/128/192). Measured at 1920x1080, dpr 1: 12-16 Souls draw at 72 px -> 128 px cells (die-cut
  1.6 px, drips 1.3-5.8 px wide in the texture); 22 -> 61 px -> 96; 120 -> 46 px -> 96; 300 -> 34 px -> 64; 450 -> 26 px
  -> 48 px cells = 11 shelf rows of one 2048^2 page (16 MB, 4.1 MB used; the dpr 2 worst case, 600 Souls at 96 px cells,
  is 2 pages of the 3-page budget). The Three tier draws the stickers in a second `RenderPass` after `UnrealBloomPass`
  (`overlayPass.clear = false` composes them into the bloomed buffer), so they are flat, crisp print on a glowing sky;
  the fragment shader adds a screen-space **die-cut hull** (max alpha over 8 taps at `hullPx(size)` = 4.5 % of the
  sprite, 1.5..4.5 px - the 2D analogue of the 3D spec's 1.06 inverted hull) and drops the flat offset shadow texels so
  the sky shows through. **Halos** are the palette `glow` colour as additive light behind each sticker (2.1 x size,
  alpha .30 + .34 x entrance glow), bloomed with the sky - they never replace the outline.
- **Winner:** the burst is unchanged; `result.published` winner Soul ids trigger a **250 ms outline flash** (hull
  widens 2 x and turns `--sticker-gold`, held 60 % then eased out = one luminance flip, `three-quality.js#outlineFlash`).
  Note: a Soul belongs to a round and floats after the result, so the winners' own Souls are normally not in the
  Galaxy yet during the winner window; the flash is exercised through `window.__galaxy.flash(ids)` (rehearsal hook).
- **Aurora band:** teal -> lime ribbon over the upper third, additive, 0.01 rad/s drift (still under reduced motion),
  hosted by the nebula fragment shader so the SUM nebula + aurora is clamped to `AURORA.skyLumCap` = 0.14 luminance
  (5.0:1 against the panel body text #F2F4FF; the band's own additive cap is 0.16 x lime). The panel is opaque and
  outside the canvas; the cap protects the Galaxy-side captions (title caption and cluster labels, both now the full
  text colour with a text shadow). Non-Three tiers (static / reduced / canvas2d / webgl2) draw one still frame of the
  band as a CSS gradient on `.galaxy::after` (peak alpha .17).
- **Doodads (high tier only):** rocket, UFO, ringed planet, comet and two gold stars from `packages/ui/doodads.js`,
  rasterised once into a 6 x 128 px strip (rotation baked in). Each has a fixed compass angle and rides 44 px outside
  the outermost OPEN orbit ring, easing outward as rings open; bob +-6 px over 4-6 s plus a 12 px drift over 26-40 s.
  A doodad whose spot would leave the region margins, cover the title caption or a cluster count label is hidden
  (faded), never moved onto text; the side panel and QR are outside the canvas. 5-6 are visible up to ring 6 (300
  Souls), 2 at 450 Souls. None on `medium` / `low` (`doodadsForTier`).
- **Panel:** display font (Fredoka) for the "LIVE MISSION" / eyebrows, counters ("Draw 4", countdown, cluster labels)
  and the "Bingo!" hero, which is a pill (gold ink on `--sticker-badge`, 5 px white die-cut + `--sticker-shadow`, gold
  star badge with a white outline); round number = round medallion with a lilac constellation ring; Core / Critical
  chips = outlined sticker pills (kind colour ink on badge fill); "Scan to join" = badge-fill card with a white
  die-cut + shadow around the QR, lime label with navy ink; previous-winner rows unchanged. DOM untouched.
  Contrast: pill ink 10.1:1, gold on badge 8.0:1, core 8.2:1, critical 7.9:1, navy on lime 15.4:1, body text on the
  panel background 13.3:1 (measured on the screenshots' padding column).

## Stage 15 (D-36): the living Galaxy, space, "say hi", the winner's crown, the panel

- **Motion.** Every Soul orbits (0.04 rad/s) with a slow float on top (`assets-src/scene/scene-params.json`
  `orbit.float`: up to 0.22 of its size, periods 4-19 s, a 5-8 s bob). Depth: a Soul near the bottom of its ring is
  nearer - bigger (0.64-1.36), clearer (haze 0.74-1), more parallax (0.6-1.4) - and the sky draws far to near; every
  Soul averages the same over an orbit (BR-17). Idle micro actions (`packages/ui/soul3d/actions.js`: wink 1.5 s, wave
  3.2 s, step 2.2 s, turn 4 s, sway 3 s) play on the impostor stage's live tiles, one per lane per 6 s slot: 3 lanes
  on `high`, 2 on `medium`, none on `low`. Nothing new starts during an entrance; reduced motion turns all of it off.
- **Say hi.** Every 3-7 s one Soul flies to the front (1.6 s), grows to at least 30 % of the Galaxy's height, waves
  and shows "Hi, I'm {name}, {greeting}" in a speech bubble (`src/greeting-bubble.js`; the name is the public label:
  the display name only with consent), then flies back (1.6 s). The bubble takes up to 40 words / 280 characters: its
  type shrinks (26 -> 19 px at 1080 rows) and its width grows (380 -> 580 px) with the text, and it stays for the
  reading time (3 words/s + 1.2 s, 3.8-16 s); the visitor winks after 8 s and sways after 12 s. A Soul without a
  greeting says "Hi, I'm {name}!" ("Hi!" without a public name). A Soul that just floated in live takes the next turn,
  in arrival order (`scene.queueHi`, from `galaxy.enter` with `celebrate`), so its player sees the greeting within
  moments; random Souls fill the gaps. Greetings come from the phone (D-42, `SoulEntrance.greeting`);
  `BINGO_GREETINGS=off` removes them. Moderation sign-off: OD-24.
- **Space.** The sky is `assets/space/` - built with `blender -b -P tools/ai/blender/galaxy_space.py`, then
  `python3 tools/assets/build-galaxy-space.py`; `node tools/assets/build-galaxy-space.js` (in build-all) checks the
  pack against its provenance and lists it in the manifest: a Blender plate (nebula, milky way, a distant galaxy, a
  planet limb) that drifts and breathes, four constellations whose stars twinkle, five meteors (the two big ones at
  the corners in front of the Souls) and a falling star every 6-12 s. Reduced motion: at rest, no falling stars;
  `low`: no falling stars, no meteor spin. The doodads, forest, fireflies, aurora and the "ARISE / SOUL
  CONSTELLATION" caption are gone from the big screen, and so is the white die-cut (`dieCut: false`).
- **Winner.** A Bingo winner (badge `bingo-star`) wears a gold crown instead of the medallion
  (`packages/ui/soul3d/winner.js`: the Blender GLB `assets/souls/winner/crown.glb`, the same crown from primitives
  until it loads) and is drawn 1.3x in a gold glow (`WINNER_LOOK`, three.js tier only; the phone and the 2D tiers keep
  every Soul equal). This is an exception to BR-17's equal size and brightness: OD-25.
- **Panel.** The phone's fonts (Electrolize UI; Asleepytiming / Comfortaa titles, OD-23) under the AriSkill sign
  (`art/ariskill-sign.webp`, the phone's D-41 sign); a round sound button top right (turn sound on, then mute /
  unmute); no reconnect banner or reconnect text, and no "LIVE MISSION" caption. Sound captions go to screen readers
  only (`#caption`, visually hidden); the footer shows only the stale-data pill. Waiting: the round, "Registration ends" and the
  countdown, then the QR card (min(22vh, 240 px)) with "Scan to join" only. Playing: the draw card (number and
  skill, never its kind; no "Bingo is live" badge) and a card with the previous five draws. Winner: the Blender
  "BINGO!" badge (`art/bingo-badge.webp`, `tools/ai/blender/bingo_badge.py`), then the winners and the co-winner
  line as one group. Every state spreads evenly under the same top zone (the sign, then the round and "Live" over
  a hairline).

## Validation record (2026-09-27, stage 15)

- Tests: public Galaxy 92/92 (state, scene, scene-life incl. arrivals first, space, greeting bubble, impostor-live incl. the winner look,
  three renderer), UI kit 157/157 (actions, acting rig, die-cut, crown incl. the shipped GLB), assets 92/92
  (galaxy-space, winner-crown, integration), accessibility 49/49; release gate 18/18 (build id: `docs/release-report.md`, v1.6).
- Panel: the computed styles and boxes of all 103 panel elements match the approved review build in Waiting / Playing
  / Winner at 1920 x 1080 (only the QR differs: another join URL). `reports/qa/screens/big-screen-stage15-panel.png`.
- 70 / 30 split (D-52, the owner's request in the stage session): scene config aligned (`safeZone` 0.7 / 0.3, panelX
  1344); the 576 px panel checked in all three states and the Galaxy at 1920 x 1080 with the space plate cover-fitted.
- Live (port 8093, scratch database): three.js tier; every space layer, the sign and the crown GLB loaded (200); a
  visitor said hi in its bubble and the winner wore the crown in its gold glow; no console errors. A Soul floated in
  live ("Nok", "Good luck, everyone! 🚀") said hi 13.6 s after its Float, after one visit already under way.
  `reports/qa/screens/big-screen-stage15.webp`.

## Validation record (run-20260923, stage 10 - sticker language)

- Screenshots (headless Chrome, SwiftShader GL via CDP, 1920x1080, own server on :8103 with a fresh 40-player DB, 14
  tester Souls floated): `reports/qa/screens/public-sticker-waiting.png` (round 2 registration open: QR sticker card,
  countdown, 14 Souls + doodads + aurora), `public-sticker-playing.png` (draw 4, Critical pill), `public-sticker-winner.png`
  (round 2 winner mid-burst: "Bingo!" pill, medallion), `public-sticker-winner-flash.png` (frozen frame with the outline
  flash on four floated Souls, `debug().flash.value` = 1 when captured), `public-sticker-galaxy.png` (14 Souls at 72 px,
  128 px cells), `public-sticker-perf450.png` (450 synthetic Souls on `high`: clusters + labels, 2 doodads left, none
  over labels), `public-sticker-reduced.png` (prefers-reduced-motion -> static tier with the CSS band).
- Contrast, measured on the screenshots (aurora-hued pixels in the ribbon rows, stars / sprites excluded): brightest
  band pixel L = 0.138-0.149 -> 4.8-5.1:1 against #F2F4FF (galaxy, waiting, winner); reduced tier CSS band L = 0.043
  (10.3:1). Isolated bloomed-star pixels inside the band can reach L 0.20 (3.8:1), as before the aurora existed.
- Render-call cost (JS time of `composer.render`, SwiftShader, 6 s windows): `high` 12 Souls avg 0.29 ms / max 0.5,
  120 avg 0.36 / 0.5, 300 avg 0.46 / 0.6, 450 avg 0.58 / 0.7; `medium` 0.26 / 0.30 / 0.39 / 0.44 ms (max 0.7).
  SwiftShader rasterises the sticker pass (9 taps per fragment) at 3-18 fps at 1920x1080 - the software raster, not
  the scene; the 60 fps / 450 Souls target is still owed to the venue GPU rehearsal. Tests: 49 (36 + 13 new).

## Validation record (run-20260922-113339, stage 9.1 - Three renderer)

- Headless Chrome 1920x1080 with software WebGL (`--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader --ignore-gpu-blocklist`), six real participants (curl-driven sessions) across
  rounds 5-6, Souls floated live: `reports/qa/screens/public-three-waiting.png` (QR, forest frame, fireflies),
  `public-three-playing.png`, `public-three-winner.png` (burst captured ~0.5 s after `result.published`),
  `public-three-galaxy.png` (16 Souls with bloom), `public-three-entrance.png` (two arcs mid-flight with trails),
  `public-three-perf450.png` (synthetic 450 Souls on `medium`: clusters + DOM labels), plus
  `public-three-contextloss.png` (after `loseContext()`: canvas2d), and switch checks (`?motion=reduced` ->
  static, `?quality=low` -> three without bloom, `?mode=webgl2` -> three, no WebGL at all -> canvas2d).
- Render-call cost on `medium` (JS time of `composer.render`, SwiftShader; GPU work is off-thread so real-GPU
  frame time is still owed to the venue rehearsal; two sweeps): 12 Souls avg 0.27-0.43 ms, 120 avg 0.32-0.51 ms,
  300 avg 0.37-0.94 ms, 450 avg 0.50-0.99 ms / max 1.4 ms. SwiftShader itself rasterises at 7-19 fps at
  1920x1080, which is the software raster, not the scene; the 60 fps / 450 Souls target must be confirmed on
  the venue GPU.
- Auto-downgrade: sampler now needs 8 samples in the 2 s window (was 30, unreachable below 15 fps), ignores the
  first 3 s after start (shader compile / atlas upload) and caps a single sample at 100 ms.

## Validation record (run-20260922-113339, stage 6.4)

- Screenshots (headless Chrome 1920x1080, Canvas 2D fallback because headless has no WebGL):
  `reports/qa/screens/public-waiting.png` (registration open, countdown, QR), `public-playing.png`,
  `public-winner.png` (round 4: two co-winners on the same draw, "Alex T." consented + "Soul #6533" non-consented
  pseudonym; produced with `BINGO_RNG_SEED` set so two identical selections get identical layouts), `public-entrance.png` (two live Float entrances mid-animation), `public-galaxy.png`
  (12 floated Souls in orbit, previous winners), `public-static.png` (`?mode=static`), `public-reduced.png`
  (prefers-reduced-motion -> static), `public-reconnect.png` (server stopped: E12 banner, last frame retained),
  `public-recovery.png` (server back: banner cleared, snapshot re-applied), `public-perf120/300/450.png`
  (synthetic Souls injected through `window.__galaxy.setSouls` for LOD/cluster and frame-cost checks).
- Canvas 2D frame cost (JS render-call time, software raster, loaded dev machine): 12 Souls avg 0.28 ms / max 5 ms;
  120 Souls avg 0.33 ms / max 2.9 ms (60 fps); 300 Souls avg 0.45 ms / max 4.8 ms (59 fps); 450 Souls on
  `medium` avg 0.42 ms / max 7.2 ms (59 fps). Skia rasterises drawImage calls off the JS thread, so these numbers
  under-report raster cost; the 30-minute soak on venue hardware (WebGL2 path) is still owed to QA/rehearsal.
- WebGL2 path: exercised once under headless Chrome with SwiftShader software GL (`--use-angle=swiftshader`),
  `reports/qa/screens/public-webgl.png`: shaders compile, atlas/nebula textures upload, 12 Souls render with the
  same composition as Canvas 2D, no console errors (JS render-call cost avg 0.08 ms). Real-GPU behaviour, context
  loss and the 30-minute soak must still be verified on the venue machine.
