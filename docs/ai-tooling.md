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
