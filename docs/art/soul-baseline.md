# Arise Soul baseline character (stage 11, D-27)

The baseline Soul is the single character every player's Soul is built on. It replaces the six procedural body
silhouettes. It was sculpted to match the reference supplied on 2026-09-24.

| Reference | What it shows |
|---|---|
| `docs/art/reference/soul-baseline-reference.png` | 3/4 clay view, the target the model is fitted to |
| `docs/art/reference/Arise soul 1 (2).png` | the same character from the front, as a blue jelly with white bubbles |

## The character

- **Head** is a round ball, widest at the eyes. It pulls up into a thin neck and a round antenna orb, off-centre toward the character's left and back.
- **Eyes** are two large domed buttons, each ringed by a thin groove. There is no mouth and no pupils.
- **Body** is a round belly below a soft chin crease, with two drooping arms webbed into the sides of the head. Narrow slits open between arms and belly from mid-height down. Two small feet sit at the bottom.
- **Goo drips** are 25 raised, melted blobs placed where they sit in the reference. The unseen back gets 18 seeded drips in the same style.

## How it is made (reproducible, no hand sculpting)

`tools/ai/blender/soul_baseline.py`, run inside Blender 5.2 with its bundled NumPy and OpenVDB.

1. The body is a signed-distance field: two lathe profiles measured row by row from the reference silhouette (a teardrop head on a curved axis, plus arm cones and a belly), smooth-unioned. Slits are smooth-subtracted.
2. A pinhole camera is fitted to the reference silhouette and to three landmarks (both eye centres and the orb). Result: silhouette overlap (IoU) 0.933, mean landmark error 2.9 px.
3. Eyes are an outward displacement that follows the head surface, with the groove traced along the true surface.
4. Drips are listed as reference pixels in `tools/ai/blender/soul_baseline_splats.json` and back-projected onto the body through the fitted camera.
5. The field is sampled as a sparse narrow band (3 mm voxels) and meshed by OpenVDB. Per-vertex masks mark drips (R), eye discs (G), eye groove ring (B) and antenna orb (A), so any palette can tint one mesh.

```
Blender --background --factory-startup --python tools/ai/blender/soul_baseline.py -- --mode produce --out assets-src/generated/soul-baseline/v1 --voxel 0.003
```

The build takes about 30 s and writes everything below plus `provenance.json`, which holds sha256 hashes for the script, the drip list and every output.

| Output | Use |
|---|---|
| `soul-baseline.blend` | master scene: 956k-vertex mesh, clay material and 8 palette materials. Git-ignored, regenerate with the command above |
| `soul-baseline-hero.glb` | web model: 24k triangles, 330 KB. Used for the phone Soul reveal and Float |
| `soul-baseline-lite.glb` | web model: 6k triangles, 84 KB. Used for the join mascot and the outline hull |
| `match.png`, `turn-*.png`, `colour-*.png` | clay render at the reference angle, turntable views, palette renders |

## Web model format

- glTF 2.0 binary with `KHR_mesh_quantization`: int16 positions, int8 normals, uint8 RGBA mask in `COLOR_0`.
- Y is up and the character faces +Z. The feet sit at y ≈ 0 and the model is about 2.29 units tall. The node transform carries the dequantisation.
- `asset.extras.landmarks` gives the orb centre and radius, both eye centres, normals and radii, the height, and a badge anchor (upper right of the head, for the Bingo Star).
- `POSITION` min/max hold the raw stored int16 values, as glTF 2.0 requires even for normalised data. `tools/assets/build-soul-baseline.js` rejects a file that stores them as floats, because three.js derives its bounding volume from them.
- The runtime copies live in `assets/souls/baseline/` (copied and checked by `tools/assets/build-soul-baseline.js` through `build-all`). The app loads them with `GLTFLoader` from `packages/vendor/three/loaders.js`. That file is kept apart from `addons.js` so screens that only need bloom, such as the public Galaxy, never download the loader.

To tint for a palette from `packages/ui/soul-renderer.js` (`PALETTES`), mix colours in this order:

1. Body is `fill`.
2. Drips mix toward `highlight` by mask R.
3. Eye discs mix toward near-white `#F7F8FF` by mask G.
4. The groove ring mixes toward `outline` by mask B.
5. The orb mixes toward `highlight` by mask A, and also glows in `glow`.

Mask A peaks at about 0.5 on the orb's surface, because v1 centres the orb's soft edge on the sphere itself. The orb is therefore a half mix toward `highlight`, and both the Blender materials and the phone are tuned to that. To get a fully highlight-coloured orb, move the soft edge outward in `vertex_masks` and halve the emission multipliers in both places.

## Trait mapping (what varies per player)

The Soul stays universal and non-ranking. Nothing about it depends on role, platform, skills or score. The seeded config from `packages/game-rules` is unchanged, and so are the contracts.

| Trait | On the baseline |
|---|---|
| palette (8) | body, drip, ring and orb colours |
| glow (3) | halo style in scenes, unchanged |
| Bingo Star badge | unchanged meaning, anchored at `badge_anchor` |
| body, eyes, antenna, mouth | kept in the config but **not drawn yet**. The baseline has fixed button eyes, fixed antenna and no mouth. Drawing them as trait layers on the baseline is the follow-up |

Deliberately excluded (D-25 still holds): no human face, and no level, tier or rank marks on or near a Soul.

## Flat 2D Soul (soul-renderer 3.0.0; 4.0.0 adds the D-29 decorations, see `docs/art/soul-decorations.md`)

The flat Soul (phone SVG path, thumbnails, fallbacks, the public Galaxy atlas) is the front view of the same model, not
a redrawing. `tools/assets/build-soul-shape.py` imports `soul_baseline.py` (functions only, the model script is not
changed), builds the same op list (`model_ops`: body, button eyes, 25 reference drips, 18 back drips), samples it on a
4 mm grid seen from the front (orthographic along +Y, so the character's left lands on the viewer's right) and writes
`packages/ui/soul-baseline-shape.js`: checked in, generated, deterministic (byte-identical under Blender 5.2's Python
and plain python3 + numpy), already in the renderer's 200 x 200 viewBox and rounded to 0.1. Model (x, z) maps to
(100 + 70 x, 178.6 - 70 z): the figure (feet .. orb) spans y 19.8 .. 180.1, centred at y 100, x 49.3 .. 150.7.

| Export | Taken from the model |
|---|---|
| `SILHOUETTE` | marching squares on the silhouette field (min of the SDF along the view axis), least-squares cubic Bezier fit (Schneider) within 0.4 units: 32 segments with the neck, the orb, the slits' see-through notches and the drips on the outline |
| `DRIPS`, `DRIP_STROKES` | the drip mask (R > 0.5 of `vertex_masks`) on the front surface points: 26 blobs as ellipses (image moments; clusters split), drawn as round-capped strokes |
| `EYES` | eye disc (mask G) and groove ring (mask B): disc ellipse + ring centre line, averaged with the mirror eye (azimuth +-31.4 deg) |
| `ORB` | the antenna sphere (`BASE.orb`) and its key-light specular point |
| `LINES` | chin crease (valley of the body-only depth map, fitted as a symmetric arch) and the two arm slits (see-through gaps of the body-only silhouette field) |
| `HIGHLIGHTS` | the head area that best mirrors the Eevee key light into the viewer |
| `BADGE_ANCHOR` | glTF `landmarks.badge_anchor` projected, for reference; the 2D badge keeps `BADGE_CENTER` (166, 38), upper right beside the orb |

Drawing, per palette: body = the v2 clay gradient (palette light top-left -> `fill` -> `--sticker-violet-deep` at the
bottom edge) with a 2.2-unit outline in `outline`; drips in `highlight` with a soft edge over a faint contact shade;
eye discs `#F7F8FF` with the groove ring in `outline`; the orb in `highlight` with the orb glow; chin crease and slits as
a soft fold in `outline`; a key-light highlight; the white die-cut and shadow (`detail: 'simple'`: 3 px die-cut, flat
shadow, no filters). Only palette, glow style and the Bingo Star badge vary; the constellation glyphs and seeded
speckles of v2 are not drawn either. Alt text: "Arise Soul, `<palette>` colour, with round button eyes and a glowing
antenna orb". Every SVG stays under 6 KB (cohort maximum 5.4 KB).

Regenerate whenever `soul_baseline.py` or `soul_baseline_splats.json` changes (the module records both sha256 values and
`packages/ui/test/soul-renderer.test.js` fails until they match again):

```
Blender --background --factory-startup --python tools/assets/build-soul-shape.py            # about 10 s, writes the module
Blender --background --factory-startup --python tools/assets/build-soul-shape.py -- --check  # exit 1 when stale
node tools/assets/build-souls.js && node tools/assets/build-asset-map.js                     # cohort, thumbnails, fallbacks, sheet
```

`-- --debug <dir>` also writes a numpy-shaded front view of the model and an overlay of the extracted geometry.
Evidence: `reports/qa/screens/soul-v3-sheet.png` (8 palettes, simple detail, badge, glow styles, the 3D front render
next to the 2D) and `reports/qa/screens/public-baseline-galaxy.png` (16 floated Souls in the public Galaxy).
