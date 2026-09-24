# Game Experience Brief (v1.1, product-owner direction, 2026-09-22)

Supplements `art-direction.md` and `scene-spec.md`. Three references were supplied (not copied): a mobile learning-game home with a violet night-forest backdrop, glossy squircle tiles arranged along a path with gold stars, a radial progress ring, a treasure-chest reward and an achievements row; a dreamy purple-and-blue enchanted-forest illustration site with warm orange accents, fireflies, and a soft glowing cottage; a dark violet forest with a hooded figure holding a glowing magenta orb, drifting light motes. The product owner wants Skill Bingo to feel like this: a game, animated, atmospheric.

## Direction (applies to all surfaces; venue rules still win on public/stage)

- **World:** a violet night cosmos seen from a forest clearing. Foreground: soft dark tree/foliage silhouettes framing the edges (never crossing the public info safe zone). Mid: drifting fireflies/light motes. Back: nebula gradients, star layers, orbit rings. Warm orange/gold accents for reward moments (Core amber already fits).
- **Souls:** the same procedural droplet companions, now rendered in 3D on the Galaxy (billboarded glow sprites with bloom, additive halos, gentle bob) and as a hero object on the phone (jelly-like blob with fresnel rim light, floating above a glowing ring, motes rising). Equal size and brightness for everyone remains a hard rule (BR-17).
- **Tiles:** bingo cells and skill chips take the glossy squircle look (top highlight, inner shadow, soft outer glow when matched); matched cells get a gold star accent; the completed line traces with a light sweep.
- **Progress:** a radial ring (`17 / 25`) with a warm "You're doing great" style micro-copy from the catalog only; achievements-style cards are NOT added (no rank, no streaks: out of scope).
- **Reveal moments:** the Soul reveal opens like the orb reference: darkness, a glowing sphere forming in the centre, light motes gather, then the Soul resolves; Float lifts the Soul upward with a trail; the public entrance arrives on the same server timestamp with a trail and a bloom pulse.
- **Motion limits:** all existing motion tokens, reduced-motion twins, no flashing above 3/s, bounded camera drift, no infinite loops on the info panel remain in force. Ambient loops (fireflies, star twinkle, Soul bob) are slow and low-amplitude to avoid fatigue over a two-hour event.
- **Performance:** public target 60 fps at 450 Souls on medium; phone hero scene must run at 30 fps on a low-end phone class with a static fallback; Three.js is loaded lazily on the phone (only for the Soul screen, prefetched during play) so the initial load stays under 3 s.

## Technology

Three.js 0.186.0 vendored at `packages/vendor/three` (`index.js` core, `addons.js` for EffectComposer/RenderPass/ShaderPass/UnrealBloomPass/OutputPass). Import by absolute path from apps: `/packages/vendor/three/index.js`. WebGL unavailable -> keep the existing Canvas 2D and static fallbacks.

## v2 sticker language (2026-09-23, D-25)

The product owner supplied the "Arise Soul x AriSkill" sticker sheet as the art reference. The visual language above is
now carried by `docs/art/sticker-art-direction.md` (source of truth for stage 10): clay-glossy speckled Souls with a lit
antenna orb and a white die-cut outline + shadow, pill badges in the rounded display face (`--font-display` = Fredoka,
OFL, vendored at `packages/vendor/fredoka/`), aurora night sky and flat 2-tone space doodads. Shipped so far:
design-tokens 1.2.0 (`--sticker-*`, `--font-display`), `packages/ui/soul-renderer.js` 2.0.0 (contact sheet
`reports/qa/screens/soul-v2-sheet.png`), `packages/ui/doodads.js` + `assets/scene/doodads.svg`. Unchanged: the seed ->
Soul mapping, the six silhouettes, equal size/brightness for everyone and the no-level/no-rank rule (BR-17).
