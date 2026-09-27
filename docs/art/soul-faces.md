# Soul faces v3: face plates, eyes and the antenna charm (stage 13, D-31)

Status: approved look (partner, 2026-09-27, on `reports/qa/screens/decor-v3-*.png`), wired into the game on the phone,
the Galaxy and the 2D fallback (release report v1.5, build `bingo-de93dd1b250e`). This page is the contract for the
code; `docs/art/soul-decorations.md` (stage 12, D-29) still describes gradients, charms and face kits.

## What changes

Every Soul created from contract 1.2.0 on is a **SoulConfig v3**:

- **Face plate**: one of 10 white face shapes (the partner's sheet `docs/art/reference/soul-faces-reference.png`), picked
  from the seed.
- **Eyes**: one of 10 eye designs (`docs/art/reference/soul-eyes-reference.png`), picked from the seed.
- **Antenna charm ("topper")**: one charm from the whole 150-charm catalog replaces the glowing antenna orb, picked from
  the seed, never one of the Soul's 10 body charms.
- The v3 body has **no orb and no button eyes** (no eye domes, no grooves). The antenna ends in a short stalk with a
  small goo collar that holds the topper.
- The skill face kit (the stage-12 rule: most matched kind -> nerdy / pirate / angel, ties core > technical > soft)
  stays on top, refitted to the new face: round glasses around the new eyes, the eye patch over the character's left
  eye (+X) plus strap and bandana, the angel halo. **No blush** in v3 (it would sit under the plate).
- Body gradient, glow, the 10 body charms, constellation and driftPhase: unchanged from v2.

v1 and v2 Souls (stored before 1.2.0) keep validating and rendering exactly as before. The neutral fallback (any
decoration error at round end) stays the **v2** neutral config (`face: null, charms: []`).

## Config v3

Exact keys, in this order:

```
{ version: 3, catalog: 2, seed, gradient, glow, face, plate, eyes, charms, topper, constellation, driftPhase }
```

| key | rule |
| --- | --- |
| `version` | 3 |
| `catalog` | integer, 2 .. CATALOG_VERSION (plates and eyes exist from catalog 2) |
| `face` | one of FACES (`nerdy`, `pirate`, `angel`); never null in v3 |
| `plate` | one of PLATE_IDS |
| `eyes` | one of EYE_IDS |
| `charms` | exactly SLOT_COUNT (10) distinct known charm ids |
| `topper` | a known charm id that is not in `charms` |
| others | as v2 (`gradient` 0..11, `glow` 0..2, `constellation` <= 5, `driftPhase` 0..1, `seed` string) |

### Picks (`packages/game-rules/src/soul.js`, all from `random.js` hashString)

```
pickPlate(seed)          = PLATE_IDS[hashString(`${seed}:plate`) % PLATE_IDS.length]
pickEyes(seed)           = EYE_IDS[hashString(`${seed}:eyes`) % EYE_IDS.length]
pickTopper(seed, charms) = free[hashString(`${seed}:topper`) % free.length]
                           free = every catalog charm id, catalog order, minus `charms`
```

`decoratedSoulConfig(seed, { domainCounts, selectedKinds, matchedKinds })` returns v3 with these three added.

## Catalog 2 (`packages/game-rules/src/soul-catalog.js`)

The strict-JSON block gains `"version": 2`, `plates` and `eyes` (ids in this order; names are what screen readers hear):

| plate id | name | | eyes id | name |
| --- | --- | --- | --- | --- |
| `crack` | lightning crack | | `button` | button eyes |
| `bean` | bean | | `lashes` | closed eyes with lashes |
| `notch` | notched | | `hearts` | heart eyes |
| `skull-x` | skull with a scar | | `sleepy` | sleepy eyes |
| `bow` | bow | | `wink` | a blue eye and a cross eye |
| `round` | round | | `sparkle` | sparkle eyes |
| `bat` | bat wing | | `fierce` | fierce cream eyes |
| `dome` | dome | | `fierce-red` | fierce red eyes |
| `skull` | skull | | `bead` | bead eyes |
| `cracked-bow` | cracked bow | | `happy` | happy squint eyes |

New exports: `PLATES`, `PLATE_IDS`, `EYES`, `EYE_IDS` (frozen). `faceInfo.angel.description` stays for v2.

## Privacy

Public, stage and participant projections carry the v3 config unchanged. `plate`, `eyes` and `topper` are cosmetic ids;
the topper is random, never derived from skills. Still no skill ids, skill names or counts anywhere public.

## Assets

Built by `tools/ai/blender/soul_face.py`, staged in `assets-src/generated/soul-face/v1/` with `provenance.json`
(sha256 per file), published byte for byte to **`assets/souls/v3/`** by `tools/assets/build-soul-face.js` (step
`soul-face` of `tools/assets/build-all.js`), manifest ids `soul_face_v3_*` (kept out of the asset map like the other
decor entries).

| file | what |
| --- | --- |
| `body-hero.glb`, `body-lite.glb` | the v3 body, 24 000 / 6 000 triangles, the baseline GLB format: KHR_mesh_quantization, POSITION / NORMAL / COLOR_0 RGBA mask (R drips; G, B, A all 0), `asset.extras.landmarks` (eyes = the new eye frames, radius 0.085; `orb` = the topper centre and radius 0.18 so framing code keeps working; `topper`) |
| `plate-<id>.glb` | model space, placed at identity; one primitive per colour (top `#F7F8FF`, sides in the sheet's rim colour); core PBR, no textures |
| `eyes-<id>.glb` | model space, identity; one primitive per colour; gradients as COLOR_0 (uint16 normalized VEC4) with a white baseColorFactor; `emissiveFactor` on some parts; material `extras.emissiveFromVertexColor: true` means emissive x vertex colour |
| `face-<face>.glb` | the refitted kits, stage-12 kit format (flat colours, the halo emissive) |
| `plate-<id>.png`, `eyes-<id>.png`, `face-<face>.png` | 2D sprites: front orthographic renders (body as holdout) cropped to their content, drawn at the data `rect` |

The topper uses the stage-12 charm files (`assets/souls/charms/<id>.glb` / `.png`).

### Data module `packages/ui/soul-face-data.js` (generated, `soul_face.py --mode data`)

```js
export const SOUL_FACE = deepFreeze({
  stub: false, version: 1, catalogVersion: 2, generator: '...',
  frame: 'glTF model space of the baseline GLBs: +Y up, +Z front, model units, feet at y = floor',
  body: { hero: '/assets/souls/v3/body-hero.glb?v=<sha10>', lite: '/assets/souls/v3/body-lite.glb?v=<sha10>' },
  plates: { '<id>': { glb, sprite, rect: [x, y, w, h] } },      // all 10, rect in the 200 viewBox
  eyes:   { '<id>': { glb, sprite, rect } },                    // all 10
  faces:  { nerdy: { glb, sprite, rect }, pirate: {...}, angel: {...} },
  topper: { centre, normal, up, size, sink: 0, front2d: { x, y, r } },   // a charm slot (model space + viewBox)
  shape:  { silhouette: '<svg path d>' },                       // the v3 body outline, baseline MAPPING
  source: { ... sha256 of the generator inputs ... },
});
```

`stub: true` (the checked-in placeholder before the first build) means "not usable". There is then no v3 body to load,
so the phone and the Galaxy keep a v3 Soul in 2D, and the 2D renderer draws it exactly as the v2 Soul with the same
gradient, face kit and charms (baseline outline, button eyes, orb), with no plate, eyes or antenna charm. (A v3 body
that loads next to unusable face data, which the generator never produces, gets the charms only in 3D.)

## Rendering: one Soul everywhere

**3D** (`packages/ui/soul3d`, shared by the phone and the Galaxy):

- `loadSoulModels(mods, quality, { variant })`: `variant: 'v3'` loads `SOUL_FACE.body` (hero / lite), else the baseline.
  Callers pick the variant from the config (`version === 3`).
- `soulDecorPlan` / `loadSoulDecor` for v3: the charms as v2 (SOUL_DECOR), plus `plate`, `eyes` (SOUL_FACE files,
  identity), the v3 face kit (SOUL_FACE.faces), and `topper` = a charm model placed with
  `charmPlacement(SOUL_FACE.topper, SOUL_DECOR.charm.thickness)`. Each piece is skipped on its own if it fails
  (`missing`: `plate:<id>`, `eyes:<id>`, `face:<face>`, `topper:<id>`, charm ids).
- Plate and eye models keep their own emissive values (no face-glow boost); a material whose `userData` has
  `emissiveFromVertexColor` multiplies its emissive by the vertex colour (one onBeforeCompile line).
- `buildSoulFigure` for v3: no orb glow sprite, no orb emissive (mask A is 0 anyway); render order body < charms and
  topper < plate < eyes < face kit.

**2D** (`packages/ui/soul-renderer.js` 5.0.0): a v3 Soul draws the `SOUL_FACE.shape.silhouette` outline (die-cut,
gradient fill, rim, lines, drips, highlight as v2), no button eyes, no orb, no orb glow; then the sprites in paint order
plate, eyes, face kit, charms, topper (the topper charm PNG drawn 2r wide centred on `topper.front2d`).
`soulSpriteLayers()` returns the same layers for canvas compositing. The halo glow style is never drawn for v2+.

**Alt text v3**: `Arise Soul, <gradient> colour, with a <plate name> face, <eyes name> and <kit>. 10 charms: <n>
technical, <n> core, <n> soft. A <charm name> charm on its antenna` (kit: nerdy `round glasses`, pirate `an eye patch
and a bandana`, angel `a glowing halo`). When the eyes or the kit already read "x and y", a comma goes before the kit
(`with a bean face, a blue eye and a cross eye, and an eye patch and a bandana`). A star charm reads its shade first
(`lemon classic star`), and "a" / "an" follows the sound (`An apple charm on its antenna`, `a USB stick`). The alt text
describes the config, so it reads the same on every screen, even while the face data is the stub.

## Budgets

- All runtime assets: 6 MiB -> **7 MiB** (D-31; a phone still downloads one Soul's parts).
- `assets/souls/v3/`: body GLBs <= 400 KB each (the existing GLB rule), plate GLB <= 48 KB, eyes GLB <= 64 KB, kit GLB
  <= 96 KB, sprite PNG <= 32 KB, the directory <= 1.5 MiB.

## Build

```
python3 tools/ai/blender/soul_face.py --mode trace          # the plate sheet -> assets-src/soul-face/ (PIL)
npm run ai:soul-face                                         # Blender: body, plates, eyes, kits, sprites, data, renders
node tools/assets/build-all.js                               # publishes assets/souls/v3/ + manifest entries
```

## As built (2026-09-27)

| part | files | size | triangles |
| --- | --- | --- | --- |
| v3 body | 2 | lite 84 KB, hero 330 KB | 6 000 / 24 000 |
| face plates | 10 | 26.5 - 36.3 KB (296 KB) | 2 000 - 2 700 (plate + ink) |
| eye designs | 10 | 21.3 - 46.6 KB (273 KB) | 1 500 - 3 000 |
| face kits v3 | 3 | 14.3 - 74.8 KB (128 KB) | 1 100 - 5 848 |
| 2D sprites | 23 | 2.2 - 30.9 KB (204 KB) | - |

`assets/souls/v3/` totals 1.28 MB (budget 1.5 MB). One full build (`npm run ai:soul-face`) takes about 4 minutes.

- **Layout:** eye centres at x = +-0.145, z = 1.175 (front projection, Blender units), eye radius 0.085. Every plate is 0.56
  wide and is raised by `fit_plates` so every eye design sits at least 0.022 inside it, between z 0.895 (clear of the
  top charm row) and 1.465 (the bandana brim). Plate 0.014 thick, eyes 0.013 above the plate, insets (hearts,
  sparkles) 0.0035 above the eyes, edges rounded.
- **Colours:** the plate top is `#F7F8FF`; its sides take the rim colour each sheet tile shows (blue, teal or
  periwinkle; a soft grey where the tile shows none). Eye colours are deeper than the sheet because the studio look
  (AgX) pales light saturated colours; hearts, sparkles and the gradient eyes glow a little (emissive 0.1 - 0.35).
- **Antenna:** the head profile stops at 1.87 and a 0.036 stalk rises to 2.085 into the charm, whose bottom edge sits in a
  small goo collar. The charm is 0.36 across (the orb was 0.34), faces front and has its outline's middle on the stalk axis.
- **Kits:** glasses rims 0.118 around each eye; the patch is a 0.13 x 0.12 felt pad over the character's left eye; strap and
  temples ride the plate and step down to the goo past about 44 degrees round the head, so on a narrow plate they float
  up to 0.014 over the goo there.
- **Review sheets:** `reports/qa/screens/decor-v3-{plates,eyes,examples,example-soul}.png`.
