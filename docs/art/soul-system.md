# Arise Soul Character System (Stage 3.2)

Status: submitted, provisional visual style (OD-12). **v2 (2026-09-23, D-25):** the surface treatment moved to the
"Arise Soul x AriSkill" sticker language - see `docs/art/sticker-art-direction.md` (source of truth for the renderer
spec) and the contact sheet `reports/qa/screens/soul-v2-sheet.png`. What changed in the renderer (2.0.0): clay radial
gradient body, peach rim light, blurred top highlight, 9-14 seed-derived speckles clipped to the body, glowing antenna
orb, rose heart belly, white die-cut outline + `--sticker-shadow`, and the Bingo Star is now a gold star with a white
outline at the upper right (`BADGE_CENTER` = (166,38) r 13). What did not change: the six silhouettes, the seed ->
config mapping, the eight palettes, the equal-size / equal-brightness / non-ranking rules, the API and output size.
Where this document and the sticker brief disagree on surface details, the brief wins; the principles below stand. Owner: art-director-agent. Code: `packages/ui/soul-renderer.js` (runtime), `tools/assets/build-souls.js` (cohort generator), tests `tools/assets/test/souls.test.js`. Rules source: requirements 9.3, BR-16, BR-17; locked vocabulary `packages/game-rules/src/soul.js`.

## 1. Principles

1. A Soul is an abstract, friendly, luminous companion - never an assessment avatar.
2. **Same seed -> same Soul**, everywhere (mobile reveal, public Galaxy, thumbnails), byte-identical SVG.
3. **Equal by construction**: one viewBox (200 x 200), one silhouette scale, one glow radius, one outline weight, eight equal-value palettes, glyphs of one size. There is no trait axis for size, brightness, quality or rarity, so none can be mapped from Platform, Role, matrix alignment or results.
4. The Bingo Star badge is the only result-linked element; it is small, cosmetic, opt-in (`badge` is a separate parameter, never inside the config) and has a text equivalent.

## 2. Anatomy (all bodies share this)

Coordinates in the 200 x 200 viewBox; y down.

| Part | Geometry | Notes |
|---|---|---|
| Glow | radial gradient circle centre (100,112) r 86 | identical radius and peak opacity for every Soul; variant adds a ring or halo |
| Soft outline | body path stroked 13 px in `glow`, Gaussian blur 3.5 | the "thick soft outline" from the mood references |
| Body silhouette | one of six closed cubic paths, hem at y 170, x within 48..156 | head bulb at (100,84) r ~32 in every body |
| Feet | two ellipses (84,168) and (116,168) rx 11 ry 8, peeking 6 px below the hem | the stubby legs from the reference |
| Highlights | 4 white blobs (head rim, body side, two small bubbles) | translucent-droplet read |
| Face disc | circle (100,84) r 25 in `highlight` | the inner white sphere from the reference |
| Eyes | pair centred (89,83) and (111,83) | six variants |
| Mouth | centred (100,95) | four variants |
| Belly mark | heart path centred (100,138), 26 px wide, `highlight` fill | constant for all Souls (belonging mark, not a score) |
| Antenna | stalk (100,56)->(100,40) + tip | six variants; `none` removes stalk and tip |
| Constellation | 0-5 glyphs on a circle r 84 around (100,112) | see section 6 |
| Badge | circle (170,170) r 13 | see section 7 |

Margins: every path coordinate stays within 24..176 so the 13 px glow stroke never clips the viewBox (tested).

## 3. Silhouette rules (six bodies)

| Body | Read | Rule |
|---|---|---|
| drop | classic teardrop, narrow hem (x 58..142) | the reference silhouette |
| bell | narrow waist, flared skirt (x 46..154), straight hem with a lip | flare never exceeds 154 so the badge stays clear |
| cloud | lobed sides, three bumps per side, scalloped hem | lobes are symmetric |
| pebble | squat rounded oval (x 48..152), rounder head join | widest body; same height as all others |
| flame | wavy sides, a single lick curling up-left of the head (tip at (88,34)), notched hem | lick stays left of the antenna stalk at x 100 |
| bean | kidney: bulges right, dented left waist, notch at the hem | asymmetric on purpose; the only leaning body |

All six share head position, height (52/54 -> 170) and the feet; differences are silhouette only. No body is taller, wider by more than 12 %, or brighter than another.

## 4. Palettes (eight, equal value)

Defined in `PALETTES` (renderer) and reproduced in `docs/art/moodboard.md`. Each has `fill` (body), `highlight` (face disc, belly, antenna tip, glyphs), `outline` (deep hue of the same family, 4.5 px) and `glow` (ambient). Constraints (tested): fill relative luminance 0.44-0.62, outline spread <= 0.10, highlight >= 0.80. Palette names are nature/light words, never metals, gems or tiers.

## 5. Expression rules

- Eyes: `dot` (r 5), `star` (5-point), `sleepy` (lower half-disc + lid arc), `wide` (white ring, pupil, catchlight), `wink` (dot + closed arc), `sparkle` (dot + catchlight + twinkle above). Eye colour is always the palette `outline` on the `highlight` face disc.
- Mouth: `smile` (arc), `open` (small ellipse), `tiny` (dot), `none`.
- Antenna: `orb` (stalk + filled orb), `ring` (stalk + hollow ring with dot), `leaf` (curved stalk + leaf with vein), `spark` (stalk + four-point spark), `none`, `twin` (two curved stalks with small orbs).
- Glow: `soft` (radial only), `ring` (radial + dashed orbit ring r 80, 42 % opacity), `halo` (radial + thin halo ellipse at y 21). Peak glow opacity is identical (0.55) in all three.
- Expressions are moods, not states: no variant means "winner", "tired", "junior" or "expert". Copy never interprets expressions.
- Motion: the only per-Soul animation is a 4.8 s glow breath (0.78-1.0 opacity) with a start offset from `driftPhase`; removed under `reducedMotion`.

## 6. Constellation rule

Input: `config.constellation = [{ domain, weight }]` (top 5 domains of the 25 selected skills by count, weights sum to <= 1, computed server-side in `soulConfigFromSeed`). Domains come only from `packages/skill-master/data/skill-master.json` (18 values such as Development, Design, Cloud, IT Security, Artificial Intelligence (AI), Data & Analytics, User Experience).

Rendering:

- 1-5 glyphs, **all the same size** (4-6 px), in `highlight` with a `glow` halo stroke.
- Placement by weight rank only: rank 1 at -52 deg (upper-left), rank 2 at +52 deg, rank 3 at -104 deg, rank 4 at +104 deg, rank 5 at 180 deg (below the feet), on a circle r 84 around (100,112).
- Glyph shape comes from a hash of the domain name (`dot`, `diamond`, `star`, `ring`), so the same domain always uses the same glyph - a recognisable accent, never a score.
- Weight never changes size, opacity, colour or count of glyphs; with one domain the weight value has no effect at all (tested).
- Renderers must not draw more glyphs, larger glyphs or extra glow for "more skills" or "aligned skills".

## 7. Bingo Star badge

- Separate parameter: `renderSoulSvg(config, { badge: 'bingo-star' })`; `badge` is **not** part of `SoulConfig` and is never derived from it.
- Small round badge bottom-right: circle (170,170) r 13, cream fill `#FFF0B3`, dark ochre `#7A5C10` 2 px ring and five-point star. Fixed colours for every palette (it is a badge, not a Soul trait).
- Never overlaps the face disc (distance 110 px > 25 + 13 + 10 margin, tested) or the belly mark.
- Accessible: the badge group has `role="img"`, `aria-label` and `<title>` = "Bingo Star badge: completed a line this round", and the Soul's `aria-label` appends the same sentence.
- `detail: 'dot'` never draws the badge (high-density mode) and its alt text omits it; `simple` keeps it.

## 8. Fallback and accessible representations

| Mode | When | What |
|---|---|---|
| `full` | mobile reveal, public Galaxy <= 120 Souls or >= 56 px on screen, thumbnails | gradients, blur filter, highlights, constellation, badge, optional glow breath |
| `simple` | Galaxy 120-300 Souls or 24-56 px, `prefers-contrast: more`, Canvas 2D / static fallback, missing asset | flat fill, outline, face, belly, antenna, eyes, mouth, badge; no filters/gradients/animation; ~1.6 KB |
| `dot` | Galaxy > 300 Souls or < 24 px, aggregate clusters | glowing disc in palette fill/outline/highlight; ~0.6 KB |
| Alt text | always | `soulAltText(config, badge)` -> "Arise Soul, `<palette>` `<body>` with `<eyes>` eyes[. Bingo Star badge: completed a line this round]" |
| Neutral Soul | config fails `validateSoulConfig` | `neutralSoulConfig(seed)` (drop, aurora, dot eyes, no antenna, smile, soft) |

Alt text never mentions Platform, Role, rank, level, score or capability (tested with a banned-word list). A custom `label` option is allowed for context ("Your Soul") but must follow the same rule.

## 9. Parameter schema (restated)

```jsonc
// SoulConfig (packages/game-rules/src/soul.js SOUL_CONFIG_SCHEMA), produced server-side from the Soul record seed only
{
  "version": 1,
  "seed": "hex string (14 chars) = hash(eventId|participantId|roundId)",
  "body": 0,      // index into ['drop','bell','cloud','pebble','flame','bean']
  "palette": 0,   // index into ['aurora','lagoon','sunset','orchid','mint','coral','sky','lilac']
  "eyes": 0,      // ['dot','star','sleepy','wide','wink','sparkle']
  "antenna": 0,   // ['orb','ring','leaf','spark','none','twin']
  "mouth": 0,     // ['smile','open','tiny','none']
  "glow": 0,      // ['soft','ring','halo']
  "constellation": [{ "domain": "Design", "weight": 0.4 }], // <= 5, accent placement only
  "driftPhase": 0.42 // 0..1 orbit/breath start offset, cosmetic
}
// Separate, never inside the config:  badge: 'bingo-star' | null
```

Renderer options: `{ size = 160, badge = null, detail = 'full' | 'simple' | 'dot', reducedMotion = false, label = null, idPrefix = 'soul-<seed>' }`. Forbidden inputs (rejected by `validateSoulConfig`): platformId, roleId, size, power, rank, strength, brightness, quality, inMatrixCount, beyondMatrixCount, isWinner.

## 10. Seed examples (from the neutral cohort, `assets/souls/cohort.json`)

Seeds are `soulSeed({ eventId: 'cohort-review', participantId: 'neutral-NN', roundId: 'r1' })`. Indices: body / palette / eyes / antenna / mouth / glow.

| # | seed | body | palette | eyes | antenna | mouth | glow | driftPhase | reads as |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `140e6ebb0fff0f` | 0 | 5 | 5 | 5 | 2 | 1 | 0.285 | coral drop with sparkle eyes |
| 2 | `0e7c71a4f4779e` | 1 | 3 | 3 | 2 | 1 | 0 | 0.133 | orchid bell with wide eyes |
| 3 | `185edf81266a86` | 0 | 7 | 5 | 5 | 0 | 0 | 0.161 | lilac drop with sparkle eyes (review badge) |
| 4 | `0c8fda8ffef1d5` | 4 | 4 | 5 | 4 | 2 | 1 | 0.082 | mint flame with sparkle eyes |
| 5 | `0e39e2f5047a44` | 2 | 3 | 0 | 5 | 2 | 2 | 0.703 | orchid cloud with dot eyes |
| 6 | `1a094e030d5e89` | 5 | 6 | 0 | 1 | 1 | 2 | 0.526 | sky bean with dot eyes |
| 7 | `045e48e3566287` | 2 | 5 | 5 | 0 | 2 | 2 | 0.033 | coral cloud with sparkle eyes |
| 8 | `1ef9240343b1a0` | 3 | 1 | 5 | 3 | 3 | 0 | 0.992 | lagoon pebble with sparkle eyes |
| 9 | `0f1be17ca9df8f` | 1 | 5 | 4 | 5 | 2 | 2 | 0.974 | coral bell with wink eyes |
| 10 | `0539dc0c10513f` | 4 | 4 | 5 | 5 | 1 | 2 | 0.072 | mint flame with sparkle eyes |

The full 24-member cohort, its configs and alt texts are in `assets/souls/cohort.json`; the visual sheet is `assets/souls/sheet.html` (screenshot `reports/qa/soul-cohort-sheet.png`).

## 11. Inclusivity checklist

- [x] No skin tone: fills are pastel light/nature hues; no beige/brown/peach-flesh ramps; the face disc is the palette highlight (near white) for every palette.
- [x] No gender expression: no hair, lashes, lips, jewellery, clothing or body-curve cues; eyes/mouths are symmetric marks.
- [x] No body-size cue: all bodies share height and width band; "pebble" and "bell" are silhouettes, not weights, and copy never names them as such.
- [x] No status cue: no crowns, tiers, metals, gems, rarity glows, size differences or extra sparkle for any input.
- [x] Platform/Role are not inputs to the seed, traits, palette, constellation or badge (`soulSeed` uses eventId|participantId|roundId only; `validateSoulConfig` rejects forbidden fields; cohort test checks for leaks).
- [x] Constellation reflects domain mix only, at one glyph size, and the domain list is the Skill Master domain list (18 values), never Platform or Role names.
- [x] Alt text template excludes Platform/Role/rank words (tested).
- [x] Badge is small, cosmetic, separately flagged, text-equivalent, never obscures the face.
- [x] Neutral fallback exists for invalid configs.
- [ ] Human inclusivity review of the contact sheet - **pending** (Gate 3, D-09).

## 12. Asset package

Per cohort member (workflow 9.3 mapping for a 2D sprite pipeline, D-13): source = `assets-src/souls/cohort.json` parameters + renderer; runtime = `assets/souls/cohort/<seed>.svg`; LODs = `fallback/<seed>-simple.svg`, `fallback/<seed>-dot.svg`; thumbnail = `thumbnails/<seed>-64.svg`; bounds `[200,200,0]`, pivot `[100,112,0]` (glow centre); triangle count 0; texture memory = file bytes; licence internal-original; checksum sha256 in `assets/manifest/assets.yaml`. Production Souls are rendered at runtime from the config (no per-participant files are stored).
