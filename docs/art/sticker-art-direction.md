# Art direction v2 - "Arise Soul x AriSkill" sticker language (stage 10, D-25 provisional)

Source references (docs/art/reference/): `sticker-sheet-p1.png` (the A5 sticker sheet), `Arise soul 1 (2).png` (blue jelly Soul), `arise soul art.png` (trait generator: face / eyes / bubble / body / belly / antenna), two holographic-outline sticker sheets (neon outline mood only).

## What we take from the stickers
| Element | Sticker sheet | In the product |
|---|---|---|
| Body | chibi bell / gumdrop suit, soft feet nubs, antenna stalk with a glowing orb | Soul silhouettes keep their 6 bodies but read as one clay family: rounded bell mass, two foot nubs, antenna orb always lit |
| Surface | glossy 3D clay, big soft top highlight, warm rim light, bubble speckles in two sizes (mint, cyan, lilac) | 2D SVG: highlight ellipse + rim gradient + speckle layer; 3D: MeshPhysicalMaterial clearcoat 1.0, roughness 0.35, sheen, speckle texture from the same seed |
| Die-cut | 6-8 px white sticker outline + soft drop shadow | every Soul, badge and doodad gets `--sticker-outline` (white, 6 px at 240 px Soul, scales) and `--sticker-shadow` |
| Badges | pill labels with 2 px outline, chunky rounded uppercase type, gold star, round medallions with constellation lines | tile badges (Core / Critical), draw card chip, "Bingo!" pill, Bingo Star badge, round medallions for round number |
| Sky | deep navy space, aurora band (teal -> lime), star specks | aurora band added to public, stage and employee backdrops (slow drift, reduced-motion static) |
| Doodads | rocket, UFO, ringed planet, comet, gold star | procedural sprites in the Galaxy periphery and the employee waiting screens; never over text |
| Type | bold rounded display for labels ("HOUSTON, SKILL LEVEL RISING") | display font = Fredoka (OFL, vendored) for badges, counters and hero words; body stays Plus Jakarta Sans |

## What we do NOT take
- The human-faced mascot. Souls keep the creature face (dot eyes, small mouth, optional heart belly) - no likeness of a person.
- "LEVEL 5 UNLOCKED", "LV.5", "SKILL LEVEL RISING": the Soul is universal and non-ranking (requirement, BR-17). No level, tier or score label ever appears on or near a Soul. The only badge stays the Bingo Star (line completed this round).
- Marketing slogans as product copy. Any new copy is a proposal for the copy catalog (OD-11), generated into reports/ai/ and reviewed, never auto-merged.

## Palette additions (design-tokens 1.2.0, names are final so apps can use them now)
| Token | Value | Use |
|---|---|---|
| `--sticker-navy` | #0B1030 | deepest sky |
| `--sticker-space` | #151C48 | sky mid |
| `--sticker-aurora-teal` | #4FE3C1 | aurora start |
| `--sticker-aurora-lime` | #B6FF5C | aurora end, "lime label" |
| `--sticker-lilac` | #8B7CF0 | body base (violet Soul) |
| `--sticker-violet-deep` | #3B2A7A | body shadow |
| `--sticker-mint` | #7CF5C8 | speckle |
| `--sticker-cyan` | #63E6FF | speckle / Critical |
| `--sticker-peach` | #FFB27A | warm rim |
| `--sticker-gold` | #F6C453 | star, Core |
| `--sticker-rose` | #FF6FA5 | heart belly |
| `--sticker-badge` | #2D2670 | pill fill |
| `--sticker-badge-ink` | #E7DFFF | pill text |
| `--sticker-outline` | #FFFFFF | die-cut |
| `--sticker-shadow` | 0 6px 14px rgba(5, 8, 30, .55) | die-cut shadow |
| `--font-display` | "Fredoka", "Plus Jakarta Sans", sans-serif | badges / hero |

Contrast rule unchanged: body text >= 4.5:1 on any tile surface; pill text #E7DFFF on #2D2670 = 10.1:1 (WCAG AAA; measured by the token test); lime label text is always dark navy on lime.

## Soul renderer spec (packages/ui/soul-renderer.js, 2D, unchanged seed -> same Soul)
1. Body path (existing 6 silhouettes) filled with a 3-stop radial gradient: palette light at 30% top-left, base, `--sticker-violet-deep` at the bottom edge.
2. Rim light: 2 px inner stroke at 40% peach on the lower-right; top highlight ellipse 22% white, blurred 2 px.
3. Speckles: 9-14 dots seeded from the Soul seed, two sizes (r 3-4 and 6-8 at 240 px), mint/cyan/lilac, clipped to the body.
4. Antenna orb: existing antenna type, but the orb gets a 3-stop glow (white core, palette light, transparent) and a 2 px outline.
5. Die-cut: whole figure duplicated below as a white stroke (6 px round joins) + `--sticker-shadow`. `detail: 'simple'` (thumbnails, Galaxy atlas) keeps the outline at 3 px and drops the speckle blur.
6. Bingo Star badge: gold five-point star with white outline at the upper right, unchanged semantics.

v3 (2026-09-24, D-27, renderer 3.0.0): the body path is the front view of the Arise Soul baseline model
(`docs/art/soul-baseline.md` "Flat 2D Soul") instead of the six silhouettes, and the character's own surface replaces the
v2 decorations: goo drips in the palette light (soft edge) take the place of the seeded speckles, near-white button eyes
with a groove ring in the palette outline colour replace the trait eyes, and there is no heart belly or mouth. Items 1,
2, 4, 5 and 6 stand (gradient, rim + blurred highlight, lit orb, die-cut and 3 px `simple` die-cut, badge).

## 3D Soul spec (employee soul-scene / join-scene, public Galaxy sprites)
- Same body profiles (soul-params.js) but MeshPhysicalMaterial: color = palette base, clearcoat 1, clearcoatRoughness 0.15, roughness 0.35, sheen 0.6 sheenColor peach, transmission 0. Speckle as an emissive-lit vertex-color or small spheres (<= 14) from the same seed.
- Antenna orb: emissive sphere + additive sprite glow; bloom already exists.
- Sticker die-cut in 3D: back-face inverted hull (white, unlit) scaled 1.06 - the classic toon-outline trick - so the orb reveal reads as a sticker peeling off the sky.
- Galaxy atlas: rebuilt from the 2D renderer at detail 'simple' so phone and Galaxy match.

## Doodads (assets/scene/doodads.svg sprite + procedural fallback)
rocket, UFO, ringed planet, comet, gold star, small constellation medallion. Each: flat 2-tone fill, white die-cut outline, no text. Public Galaxy: 5-8 drifting at the periphery on high tier only. Employee: one rocket parked near the join orb, one planet on the waiting screens. Stage: none (presenter legibility).

## Motion notes
Sticker "peel" reveal = scale 0.92 -> 1.0 with a 6 deg tilt and outline flash (250 ms); aurora drifts 0.01 rad/s; doodads bob +-6 px over 4-6 s; all respect prefers-reduced-motion and the flash-safety tokens (no more than 3 luminance flips/s, additive glow capped).

## AI-assisted production (keys in .env, tools/ai/*)
- Gemini image models: mood boards and reference plates per screen (not shipped in the app; land in assets-src/generated/ with prompt + model + sha256 provenance) to guide the procedural art.
- Blender (bpy, tools/ai/blender/): renders the clay Soul turnarounds from the same body profiles for the marketing sheet and for the Galaxy atlas if the procedural sprite is judged weaker.
- OpenAI text models: copy proposals (CW) for existing copy.json keys and UX/UI template proposals; written to reports/ai/ as proposals for the content owner (OD-11).
Generated bitmaps are never required at runtime: every screen must look finished with the procedural art alone.
