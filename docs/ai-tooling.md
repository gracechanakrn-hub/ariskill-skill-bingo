# AI tooling (developer side) - `tools/ai/*`

Optional, developer-machine-only helpers that produce **reference material and proposals**. Nothing under `tools/ai/`
is imported by `services/` or `apps/`, nothing it produces is required at runtime, and no key ever reaches a browser or
a log. Zero third-party dependencies (Node >= 24 `fetch`, Python 3 stdlib, Blender's bundled Python).

| Command | Provider | Purpose | Writes |
|---|---|---|---|
| `npm run ai:visuals` | Gemini image model | art-direction plates (Soul family sheet, aurora backdrops, doodads, tile study, orb reveal keyframes) | `assets-src/generated/<batch>/*.png` + `provenance.json` |
| `npm run ai:copy` | OpenAI Responses API | 2 alternative phrasings per `copy.json` key (+ E1-E23) and the candidate key `select.encouragement` | `reports/ai/copy-proposals.{json,md}` |
| `npm run ai:uxui` | OpenAI Responses API | UX/UI template proposal per screen (layout regions, components, tokens, motion, a11y) | `reports/ai/uxui-template.{json,md}` |
| `npm run ai:blender` | Blender (Eevee, `bpy`) | clay Soul turnarounds + 6-body x 3-palette contact sheet from the repo's own body profiles | `assets-src/generated/blender/<run>/*.png` + `provenance.json` |
| `npm run test:ai` | - | tests for the pure parts (prompt builders, schemas, dry-run shaping, Python port) | - |

Every command supports `--dry-run`: it prints the exact prompts/requests it would send, writes them to
`reports/ai/dry-run/<tool>-<name>-<stamp>.json` (auth headers masked, everything passed through `redact()`), and exits 0
without contacting any provider. Without a key the real run stops with `GEMINI_API_KEY is empty. Put it in .env ...`.

## 1. Fill `.env`

```sh
cp .env.example .env      # already done in this checkout; .env is git-ignored
# then paste the keys:
GEMINI_API_KEY=AIza...    # https://aistudio.google.com/apikey
OPENAI_API_KEY=sk-...     # https://platform.openai.com/api-keys
# optional overrides (defaults shown in .env.example):
# GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview   OPENAI_TEXT_MODEL=gpt-5.1   BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender
```

`tools/ai/env.js` loads `.env` with Node's built-in `process.loadEnvFile`; `requireKey()` gives a key-free error;
`redact()` masks `sk-...` / `AIza...` values in every line the tools print or write. Never paste a key on a command line.

Verify the image model id before the first real run (ids change often):
`curl -s "https://generativelanguage.googleapis.com/v1beta/models" -H "x-goog-api-key: $GEMINI_API_KEY" | grep '"name"' | grep -i image`

## 2. Run each tool

### Visual plates (Gemini) - `tools/ai/gemini-visuals.js`

```sh
npm run ai:visuals -- --list                              # plates in tools/ai/prompts/visuals.json
npm run ai:visuals -- --dry-run                           # all six prompts, nothing sent
npm run ai:visuals -- --only soul-family-sheet            # one plate -> assets-src/generated/<timestamp>/soul-family-sheet.png
npm run ai:visuals -- --batch v2-plates                   # all plates into a named batch
npm run ai:visuals -- --model gemini-3-pro-image-preview --only backdrop-public-16x9
npm run ai:visuals -- --batch v2-plates --only tile-study --refine "make the middle tile a touch more mint"   # multi-turn edit -> tile-study-r1.png
```

Prompts follow the 5-part framework (type / subject / environment / technical / constraints) with the sticker style
anchor and the hard "no human face, no text, no level/rank labels, equal size and brightness" lines appended to every
plate. `--refine` replays the original user turn and the model turn (thought signatures kept in `provenance.json`)
and asks for the edit with an explicit KEEP list (the plate's `keep` array), as the image-generation skill prescribes.

### Copy proposals (OpenAI) - `tools/ai/openai-copy.js`

```sh
npm run ai:copy -- --dry-run                 # developer prompt + every batch request
npm run ai:copy                              # ~6 requests (24 keys each) + 1 candidate request
npm run ai:copy -- --only exception. --only soul.     # key prefixes
```

Reads `packages/contracts/copy.json`, requirement sections 1, 8.1-8.3, 9.1, 9.3 and `docs/requirements/glossary.md`
at run time. Hard rules in the developer prompt: Souls are non-ranking (no level/tier/score language), no analyst/export
language, provisional labels, E1-E23 meaning intact, English only, placeholders unchanged. Every returned alternative
is linted again locally (`tools/ai/lib/copy-rules.js`); rejected ones stay in the report struck through so the reviewer
sees what the model tried. **The tool never edits `copy.json`** - the report header says so; adoption is the content
owner's call under OD-11.

### UX/UI template proposals (OpenAI) - `tools/ai/openai-uxui.js`

```sh
npm run ai:uxui -- --list
npm run ai:uxui -- --dry-run
npm run ai:uxui -- --only stage --only public
```

One strict-JSON request per screen (employee join / select / board / playing / result / soul; stage; public; admin)
seeded with the current structure from the app READMEs, the sticker art direction and the requirement's design,
motion and accessibility sections. Token names are constrained to `tokens.json` 1.1.0 plus the `--sticker-*` names of
the art direction (design-tokens 1.2.0 pending); anything else is flagged as an unknown token in the report.

### Blender renders - `tools/ai/blender-render.js` + `tools/ai/blender/soul_turnaround.py`

```sh
npm run ai:blender -- --dry-run --seed 1f3a9c      # command, py_compile, seed -> body/palette port
npm run ai:blender -- --mode smoke                   # one body, one view, 256 px: proves the pipeline in ~5 s
npm run ai:blender -- --seed 1f3a9c                 # default `all`: front / 3-4 / side turnaround + contact sheet at 1024 px
npm run ai:blender -- --mode sheet --palettes aurora,lagoon,lilac --size 1600
npm run ai:blender -- --mode single --body bean --palette sunset --view side
npm run ai:blender -- --mode sheet --no-outline --size 800      # plain clay, no die-cut
```

The script is a Python port of `apps/employee-mobile/src/scene/soul-params.js` (profiles, Catmull-Rom lathe, lean /
bump, FNV `hashSeed`) and `packages/game-rules/src/soul.js` (cyrb53 `hashString` -> trait indices), so a seed renders the
same body and palette as on the phone; `tools/ai/test/blender-port.test.js` compares both within 1e-6. Materials:
Principled BSDF with coat 1.0 / coat roughness 0.15, roughness 0.35, sheen 0.6 tinted peach; emissive antenna orb;
9-14 seeded speckle spheres (mint / cyan / lilac); white inverted-hull die-cut outline (a separate shadow-less bmesh
shell whose front faces are transparent and back faces emit white - per-material backface culling proved unreliable
for generated shells in Blender 5.2, and a shadow-casting hull darkened the body); three-point lighting; transparent
PNG; Eevee. `--no-outline` renders the plain clay body (debug / alternative look). Blender lives at `BLENDER_BIN` (default macOS app path); `bpy` is only
importable inside Blender, so the dry run validates with `python3 -m py_compile` and `--print-profiles`.

## 3. Review outputs

- `assets-src/generated/<batch>/provenance.json` - one entry per PNG: `model`, full `prompt`, `temperature`, `sha256`,
  `bytes`, `createdAt`, `license: "AI-generated reference, not shipped"`, plus the model parts needed for `--refine`.
- `assets-src/generated/blender/<run>/provenance.json` - script sha256, Blender version, seed, per-file sha256 and
  timings (`render-log.json` has the per-view seconds).
- `reports/ai/copy-proposals.md` / `.json` - read, pick, then hand the chosen lines to the content owner (OD-11).
  Lint-rejected lines are struck through; `missing` lists keys a batch failed to cover.
- `reports/ai/uxui-template.md` / `.json` - one section per screen; "Unknown token names flagged" must be resolved
  before any of it is applied by hand.
- `reports/ai/dry-run/*.json` - the exact request bodies; useful for reviewing prompts before spending money.

Look at the Gemini plates with the checklist from the skill: AI artefacts, a human face slipping in, any letters or
level-like marks, uneven figure sizes. Anything that fails is regenerated (or `--refine`d), never retouched into the
product.

## 4. Provenance and licensing rule

Generated bitmaps (Gemini plates, Blender renders) are **reference material**. They live in `assets-src/generated/`
(PNGs git-ignored, JSON provenance kept) and are never loaded at runtime: every screen must look finished with the
procedural art alone (`docs/art/sticker-art-direction.md`, "AI-assisted production"). A bitmap may only become a
runtime asset when a later decision records it in `assets/manifest/assets.yaml` through the normal generator path
with `source_file`, `license`, `generator_script`, checksum and `approved_by` filled, and the provenance entry (model,
prompt, sha256) attached to that decision. Copy and UX/UI outputs are proposals; `packages/contracts/copy.json`,
`packages/design-tokens/tokens.json` and `apps/*` are never modified by these tools.

## 5. Cost notes (from the image-generation skill, 2026-09)

- Gemini 3.1 Flash Image: best default for scenes; Gemini 3 Pro Image for higher-detail final plates; Gemini 2.5
  Flash Image has a free tier (~500/day) for drafts (`--model gemini-2.5-flash-image`). Six plates per batch; a refine
  costs one more generation each.
- GPT Image 2 (not used here) for readable text on images: $0.006 / $0.053 / $0.211 per 1024x1024 at low / medium / high
  quality; up to 2 minutes per complex prompt. GPT Image 1.5 is the transparent-PNG fallback. Gemini cannot render
  transparency or reliable text, which is why the plates carry "no text" and the UI text stays in the procedural layer.
- OpenAI text (Responses API, `gpt-5.1`): the copy run sends the ~3 k-token developer prompt with each of ~7 requests
  and asks for up to 12 k output tokens per batch; the UX/UI run sends ~9 requests with a ~6 k-token developer prompt.
  Token counts land in the `usage` array of each report. Use `--only` to trial a subset first.
- Blender is local and free; a 1024 px turnaround takes seconds on this machine (smoke render: ~3 s for one view).

## Soul baseline character (Blender, no key needed)

The 3D baseline Soul (D-27, `docs/art/soul-baseline.md`) is rebuilt from source with one command:

```
npm run ai:soul-baseline                  # full build: master .blend, web GLBs, renders, provenance (about 30 s)
npm run ai:soul-baseline -- --mode build  # quick preview: match.png + overlay.png against the reference
npm run ai:soul-baseline -- --mode fit    # refit the camera to the reference silhouette and landmarks
```

Everything that shapes the character lives in two files: the proportions and profiles in `tools/ai/blender/soul_baseline.py` (`BASE`, `EYE`), and the drip list in `tools/ai/blender/soul_baseline_splats.json` (reference pixel positions and radii). Edit, rebuild, then compare `match.png` with the reference. The web GLBs in `assets-src/generated/soul-baseline/v1/` are copied into `assets/souls/baseline/` by `node tools/assets/build-all.js`.

## Charm icons (npm run ai:charms)

The 100 technical and soft charm icons of the Soul decorations (D-29, `docs/art/soul-decorations.md`) are drawn once by Gemini and cut out locally. Unlike the plates above, they **ship as game art** (owner sign-off OD-19), so every icon carries its provenance. The 50 core stars are procedural (`npm run ai:soul-decor`).

```
npm run ai:charms -- --list                          # 100 ids: kind, attempts, QA state, look
npm run ai:charms -- --dry-run --pilot               # the requests, redacted, in reports/ai/dry-run/ (nothing sent)
npm run ai:charms -- --pilot                         # the 6 pilot charms (3 technical, 3 soft)
npm run ai:charms                                    # every charm without a passing icon (resumable)
npm run ai:charms -- --only tech-pen,soft-rose --regen   # new attempts for outliers, even if they pass QA
npm run ai:charms -- --process                       # redo cut-out, QA, sheets and provenance from the saved raws
# options: --kind technical|soft  --model <id>  --concurrency 3  --temperature <n>  --max-attempts 3  --refs 0
```

- **Model.** `gemini-3.1-flash-image` (GA) unless `--model` or `GEMINI_IMAGE_MODEL` says otherwise. In the pilot it beat `gemini-3-pro-image`: it followed the looks more faithfully (pro drew a three-leaf clover and a headband instead of earbuds), kept flatter cel shading and took about 10 s per image instead of 20 s. The choice is recorded in `tools/ai/prompts/charms.json` (`modelChoice`).
- **Prompt.** `tools/ai/prompts/charms.json` holds one 5-part family style with the catalog `look` filled in. The style asks for:
  - a chunky, rounded object with a bold plum outline (#2B2350), two-tone cel shading, one small upper-left highlight and 3-4 colours from the sticker palette;
  - a thick, even white die-cut around the whole object, with gaps and holes filled white;
  - the sticker centred and filling about 75% of the square, on flat chroma-key green `#00FF00`;
  - no text, logos, faces, hands, scenery or shadow.

  `overrides.<id>.detail` adds item-specific lines, such as blank screens, no digits or tinted glass. Style references (`references.use`) are supported but off: a pilot A/B showed they pull the palette toward the reference objects.
- **Raw images.** They go to `assets-src/generated/charms/raw/<id>-a<n>.png`, which is git-ignored. The model answers in JPEG, so the tool stores the decoded pixels as a lossless PNG. `rawSha256` is the hash of the bytes the API returned; `fileSha256` is the hash of the stored PNG. Every attempt, including failed requests, is logged in `assets-src/generated/charms/attempts.json` with its prompt, model, token usage and QA result.
- **Cut-out** (`tools/ai/lib/charm_cutout.py`, python3 + numpy + PIL):
  1. Flood-fill the key from the image border. A pixel counts as background if it is close to the measured key or strongly key-hued.
  2. Keep the largest component, and treat everything it encloses as part of it. Paint any key-coloured pixels inside it (see-through holes, specks) white.
  3. Unmix the edge pixels between key and white: alpha is 1 minus the key share, and the colour becomes white.
  4. Crop to the die-cut box with 6% padding, centre it on a square and resample premultiplied to **256x256 RGBA** (8-bit, non-interlaced) in `assets-src/charms/icons/<id>.png`.

  Transparent and edge pixels are stored white, so texture filtering never pulls a dark or green fringe.
- **QA** writes every metric to `reports/ai/charms-qa.json`. The checks:
  - background uniformity: at least 97% of it within 36 of the key;
  - exactly one sticker component;
  - coverage: raw box 55-95% of the frame, not touching the edge, final fill 22-86%;
  - white rim all around: rings 2-3 px inside the edge at least 95% white, and the rim at least 3 px wide;
  - centred: box offset 2 px or less, alpha centroid 12% or less;
  - no key colour left inside.

  The contact sheets `reports/qa/screens/charms-technical.png` and `charms-soft.png` show each icon at 128 px and 48 px on mid-violet, with failures boxed in red.
- **Review loop.** Look at both sheets. For an outlier that passes QA but looks wrong, do two things in charms.json:
  - add an override detail;
  - flag the shipped attempt with `review.<id> = {attempt, note}`.

  The flagged icon keeps shipping and is boxed amber on the sheet. The next plain `npm run ai:charms` regenerates flagged charms together with missing or failing ones; `--only <id> --regen` forces a new attempt for any charm.

  Limits and rules:
  - A run allows at most 3 attempts per charm (`maxAttempts`). Pilot and compare attempts don't count toward it.
  - The latest passing attempt ships. `ship.<id> = n` pins an attempt, and `reject.<id> = [n]` excludes attempts.
  - `budget` (260) caps the total requests, retries included.
  - Backoff covers 429, 5xx and network errors. A run stops after 5 charms fail in a row, for example when the project's prepaid credits run out (HTTP 402). Top up, then rerun: runs resume.
- **Provenance.** `assets-src/charms/provenance.json` has one entry per icon:
  - `id`, `file`, `model`, the full `prompt`, `temperature`, `attempt`
  - `rawSha256`, `sha256` of the cut-out, `createdAt`
  - `shipped` (QA pass)
  - `license: "AI-generated with Google Gemini (<model>); shipped as game art under D-29, owner sign-off OD-19"`

  No key is ever written: requests send it only in the `x-goog-api-key` header, and every printed or written line goes through `redact()`.
