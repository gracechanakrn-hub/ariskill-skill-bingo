# assets-src/souls - Arise Soul source parameters

The Soul "source art" is code, not a drawing: silhouettes, palettes and parts live in `packages/ui/soul-renderer.js` (`BODY_PATHS`, `PALETTES`, part functions) and the neutral review cohort is described by `cohort.json` here. Runtime files under `assets/souls/**` are generated and must never be hand-edited.

## cohort.json

| Field | Meaning |
|---|---|
| `eventId`, `roundId`, `participantPrefix`, `size` | synthetic identities `neutral-01..24`; the seed is `soulSeed({eventId, participantId, roundId})` from `packages/game-rules/src/soul.js` |
| `badgeMembers` | which members show the cosmetic Bingo Star so badge placement can be reviewed; it is not part of any config |

Domain mixes for the constellation are drawn from the Skill Master domain list with the seeded generator (`seededRng`), so the cohort covers several domains without any Platform/Role input.

## Regenerate

```
node tools/assets/build-souls.js     # assets/souls/{cohort,fallback,thumbnails}/*.svg, cohort.json, sheet.html + manifest entries
node tools/assets/build-scene.js     # assets/scene/* + manifest entries
node --test tools/assets/test/souls.test.js
```

Both scripts are deterministic (run twice, diff is empty). To change the look, edit the renderer (silhouettes/palettes/parts) or `cohort.json`, regenerate, then re-screenshot `assets/souls/sheet.html` for the inclusivity review (`reports/qa/soul-cohort-sheet.png`).

## Formats

Runtime format is SVG (decision recorded in the stage report: PNG rasterisation is not required; renderers rasterise SVG at load into size buckets). Licence: internal-original for everything in `assets/souls/**`.
