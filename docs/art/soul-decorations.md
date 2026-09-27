# Soul decorations: faces, charms and body gradients (stage 12, D-29)

> Stage 13 (D-31): Souls created from contract 1.2.0 on also get a random face plate, eyes and antenna charm, and lose the button eyes and the orb. See `docs/art/soul-faces.md`; everything here still holds for gradients, body charms and v2 Souls.

When a round finishes, every participant's baseline Soul (D-27, `docs/art/soul-baseline.md`) is decorated with a face, 10 skill charms and a body gradient. The server decides the decoration once, when it creates the Soul, and saves it in the Soul's config. The phone and the big screens only look pieces up in a fixed catalog. **No AI runs in the game.** Gemini and Blender are used once, by developers, to build the catalog.

After Ready to Float, the big screen shows the same decorated Soul the phone showed: the same 3D model, charms, face and colours.

## Rules (server, at round end)

| Input | Decides | Rule |
|---|---|---|
| The 25 selected skills | charm split | 10 charm slots, split across core / technical / soft in proportion to the selected skills' kinds |
| Matched tiles when the round ends | face | the kind with the most matched tiles; ties go core > technical > soft; no matches at all counts as a tie, so the face is nerdy |
| The Soul seed (the "generation token") | gradient, charm variants, slot order, glow | seeded picks, repeatable for ever |

Skill kinds come from `kind` in `packages/skill-master/data/skill-master.json`. That field is unrelated to the `isCore` draw flag.

| skill-master `kind` | catalog kind | skills in the catalogue | face | charm family (50 each) |
|---|---|---|---|---|
| `Core Skill` | `core` | 7 | nerdy: round glasses | stars: 10 shapes x 5 shades |
| `Hard Skill` | `technical` | 189 | pirate: eye patch, strap, bandana | tools: hammer, laptop, book, pen, ... |
| `Soft Skill` | `soft` | 22 | angel: glowing halo, soft blush | wellbeing and life items: earphones, flowers, ... |

**Charm split.**
1. Each kind's quota is `10 * count / 25`, rounded down.
2. Leftover slots go by largest remainder. Ties between remainders go core > technical > soft.
3. Any kind with at least one selected skill gets at least one slot. The slot is taken from the kind that has the most slots; if two kinds tie on slots, it is taken from the lower-priority kind (soft first, then technical).

Examples: 10/10/5 (technical/core/soft) gives 4/4/2. 22/2/1 (technical/soft/core) gives 8/1/1. 25 technical gives 10/0/0.

**Picks.** Everything below is deterministic from the seed (`hashString` / `seededRng` in `packages/game-rules/src/random.js`):
- The charm variants within each kind are distinct.
- The order of the 10 charms across the slots is a seeded shuffle.
- The gradient is uniform over the 12 gradients.
- The glow is uniform over the 3 glow styles, as before.

**Config v2**, saved in `souls.config_json` and served to the phone, public and stage:

```
{ version: 2, catalog: 1, seed, gradient: 0..11, glow: 0..2, face: 'nerdy'|'pirate'|'angel'|null,
  charms: [10 charm ids, index = slot], constellation: [...], driftPhase }
```

- `face: null` with `charms: []` is the neutral fallback when validation fails (BR-17 failure handling).
- Version 1 configs (Souls created before this stage) still render as the plain baseline with their palette.
- The raw inputs (selected kinds, matched counts, skill ids) never enter the config.

## Catalog

`packages/game-rules/src/soul-catalog.js` is pure data with no imports, so the service, the browsers (served under `/packages`) and the build tools can all import it. The JSON between its markers is strict JSON, so Python reads it too.

- **Charms.** 150 charms, each with an `id`, `kind`, `name` and a `look` hint for the artwork. Stars also have `shape` and `shade`.
  - Ids are permanent, because saved Souls refer to them. Never rename, reuse or delete one. New items get new ids and a new catalog `version`.
- **Gradients.** 12 body gradients, each defined by `top`, `bottom`, `highlight`, `outline` and `glow`.
  - The first 8 keep the v1 palette names and their highlight, outline and glow colours.
  - All 12 have the same mean relative luminance (0.575 ± 0.01 over the two end colours; 0.556 to 0.570 as rendered, averaged over the height span), so no colour is rarer or better (BR-17, requirement 9.1: no rarity tiers).
- **Star shades.** The 5 shades share one fill brightness.

## Asset formats

Model space means the glTF scene space of `assets/souls/baseline/soul-baseline-*.glb`: +Y is up, +Z is the front, units are model units, the feet sit at `y = floor` (landmarks), and the model is about 2.29 tall. The mapping to Blender coordinates is `(x, z, -y)`.

| Asset | Path | Format |
|---|---|---|
| Charm icon (source art) | `assets-src/charms/icons/<id>.png` | 256x256 RGBA, one object inside a white die-cut rim, transparent outside, centred. Tech and soft icons come from Gemini; stars come from Blender (procedural). |
| Charm model | `assets/souls/charms/<id>.glb` | Puffy sticker: KHR_mesh_quantization, POSITION / NORMAL / TEXCOORD_0. The material's `baseColorTexture` refers to `<id>.png` by relative URI (external, because the page CSP blocks `blob:` fetches). Local frame: origin at the centre of the back face, front +Z, icon up +Y, outline diameter 1.0. |
| Charm texture / 2D sprite | `assets/souls/charms/<id>.png` | The icon, also used as the flat 2D charm |
| Face kit | `assets/souls/faces/face-<face>.glb` | Authored in model space, so it sits on the body at identity. Separate primitives per part, core PBR materials with fixed colours (halo emissive, blush `alphaMode: BLEND`). |
| Face sprite (2D) | `assets/souls/faces/face-<face>-front.png` | Front orthographic render of the face kit only, 800x800 RGBA, covering the renderer's 200x200 viewBox |
| Decor data | `packages/ui/soul-decor-data.js` | Generated (`tools/ai/blender/soul_decor.py`), deterministic, checked in. Holds the 10 slots, charm size, file URLs with hashes, face files and the 2D mapping. |

**Slots.** Each slot records:
- `centre`, `normal` and `up`, in model space
- `size`: the charm diameter, in model units
- `sink`: the fraction of the charm's thickness pushed into the body, so the charm reads as part of the goo
- `front2d {x, y, r}`: the position in the 200 viewBox

All 10 slots face the front hemisphere, so every charm is visible in the rest pose, in 3D and in 2D. They keep clear of:
- the eyes and glasses
- the cheeks (blush)
- the upper head (bandana)
- the neck and orb (halo)
- the arm slits and the feet

**As built (v1, `tools/ai/blender/soul_decor.py`).**
- **Size and spacing.** All 10 slots take one charm size, 0.20 model units. That is the largest the clearances allow; at 0.21 two charms touch. The minimum centre spacing is 0.212.
- **Where the slots are.** The slots sit on the chest, belly, lower belly and both upper arms, all below the chin crease.
- **Normals and sink.** Normals are averaged over the charm's disc. Sink is 0.35 everywhere.
- **Drips.** Charms sit on smooth goo between the drips. No drip reaches under a charm's icon face; a low drip edge may run under the white rim, where it reads as goo meeting the charm.
- **Charm model.** Thickness is 0.30 of the diameter, with a rounded edge and a shallow bowl back. Each is about 900 triangles.
- **Charm material.** The material uses the icon as both `baseColorTexture` and `emissiveTexture` (factor 0.32), with roughness 0.45 and metallic 0, so pastel icons stay vivid under the AgX look.
- **Charm sprite.** The runtime PNG is 128 px, and its inscribed circle is the charm outline, so the 2D sprite is drawn 2r wide centred on `front2d`.
- **Face kits.**
  - The pirate patch covers the character's left eye (+X, nearest the 3/4 rest camera).
  - The bandana is a tied band in coral with white dots; a full cap read as a toadstool.
  - The halo is warm white (#FFEFD2 emissive, strength about 3 so it blooms).
  - The blush is `alphaMode: BLEND` with alpha in COLOR_0.
- **Partial catalog.** `charm.missing` lists catalog ids whose icon does not exist yet; the renderers skip those charms one by one. When icons land, rebuild in three steps:
  1. `npm run ai:soul-decor -- --mode charms --only <ids>` (about 0.5 s a charm)
  2. `npm run ai:soul-decor -- --mode data`
  3. `node tools/assets/build-all.js`

Review renders: `reports/qa/screens/decor-{stars,slots,gradients,faces,examples,charms-sample}.png`.

**Placement of a charm.**
- **Basis:** z = `normal`, y = `up` orthogonalised against it, x = y × z.
- **Position:** `centre - normal * sink * thickness * size`.
- **Scale:** `size`.

**2D mapping.** This is the same mapping as the flat renderer 3.0 (`docs/art/soul-baseline.md`): Blender (X, Z) maps to viewBox (100 + 70 X, 178.6 - 70 Z), front orthographic.

## Colour

The body gradient runs on height above the floor, `h`. The factor is `t = clamp((top - h) / (top - bottom), 0, 1)`, with `gradientSpan` top 1.9 and bottom 0.0 (model units). The fill is `mix(top, bottom, t)`, interpolated in **sRGB** and then converted to linear.

The feature masks then apply exactly as in D-27:
- drips mix toward `highlight`
- eye discs mix toward `#F7F8FF`
- the groove mixes toward `outline`
- the orb mixes toward `highlight` and glows in `glow`

The same maths runs in the phone and big-screen 3D tint, in the Blender renders (baked per vertex) and in the 2D renderer. For 2D, a vertical `linearGradient` over the same height range stands in for the per-vertex fill.

Face kits and charms keep their own fixed colours. The Bingo Star badge stays gold and gets a round medallion backing, so it can't be mistaken for a core star charm.

## Rendering: one Soul everywhere

- **Phone.** The phone builds the Soul reveal and Float from `packages/ui/soul3d/`, which is shared with the Galaxy. That code tints the baseline mesh with the gradient, places the charm models at the slots and adds the face kit. The phone's 2D fallback uses `renderSoulSvg` v4: gradient body, face sprite and charm sprites.
- **Public Galaxy (Three.js).**
  - **Entrance.** On a Float entrance, the Galaxy shows the real 3D decorated Soul for its hero moment. That is the same figure code, lights and tone mapping as the phone.
  - **Settled.** It then settles into orbit as an impostor, meaning the same figure rendered once into its atlas cell.
- **Galaxy fallbacks.** Canvas and static fallbacks draw the 2D v4 composition. The atlas rasterises the SVG, then draws the face and charm sprites onto the cell with `drawImage`, because SVG-as-image cannot load external images.
- **Stage.** Any Soul on the stage uses the same 2D v4 renderer. The stage snapshot carries no Galaxy, so the stage sees Souls only through `soul.float_accepted`.
- **Missing pieces never break a Soul.** Each charm and the face kit load or fail on their own (`loadSoulDecor`): a missing file, an unusable slot, a 404 or a texture that fails skips that piece only, and a failed URL waits 60 s before a retry. With nothing loadable the Soul is the plain gradient baseline.
- **Loading on the big screen.** The Galaxy loads GLTFLoader and the Soul models when a round ends (on `bingo.detected`, `result.published` or a Winner snapshot) or when the first v2 Soul appears, so the first Float of a round is already in 3D. Screens with only v1 Souls never load them (D-28).
- **Impostor framing.** Impostors use the phone's 3/4 rest pose, camera distance and pitch. Only the field of view is narrower, so v1 and v2 Souls fill their cells at the same size (BR-17). Impostors have no bloom and no orb sprite, because the Galaxy draws its own halo and screen-space die-cut.

## Build (developer-side only, D-26 still holds for keys)

1. `npm run ai:charms` uses Gemini to draw the 100 technical and soft icons in one sticker style on a flat key colour. The tool then cuts them out, runs quality checks and makes a thumbnail sheet for review, and writes the provenance of every icon (model, prompt, sha256) to `assets-src/charms/provenance.json`.
2. `npm run ai:soul-decor` uses Blender to:
   - draw the 50 star icons
   - build every charm model
   - build the three face kits
   - compute the slots
   - render review sheets and example decorated Souls
   - write `packages/ui/soul-decor-data.js`
3. `node tools/assets/build-all.js` copies and checks the runtime files under `assets/souls/charms/` and `assets/souls/faces/`, and writes their manifest entries.

Shipping the Gemini-made icons as game art is a change from D-26, where Gemini output was reference only. The change is recorded as D-29, with provenance kept for every icon, and it needs the owner's sign-off (OD-19).

## Invariants and tests

- **Non-ranking (BR-17).**
  - Every charm is the same size.
  - Every gradient has the same mean brightness.
  - Every face kit has the same visual weight, and none is gold or rare.
  - The config carries no counts, ranks, sizes or brightness fields.
- **Privacy.** Public and stage payloads carry only charm ids, face and gradient, never skill ids, skill names or match counts. A charm id reveals only a coarse kind, which is less than the domain constellation those payloads already carry.
- **Determinism.** The same Soul record always gives the same config, and the same config always renders the same Soul on every screen.
