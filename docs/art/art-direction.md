# AriSkill Skill Bingo - Art Direction (Stage 3)

Status: **submitted, provisional** (run `run-20260922-113339`). Owner: art-director-agent. Inputs: requirements 2.2, 8.1, 9, 11, 12.2; D-13 (2D sprite pipeline, WebGL2 -> Canvas 2D -> static); OD-12 (design system unknown); OD-14 (venue unknown; 1920x1080 assumed).

Everything visual in this document is **provisional** until the brand owner maps it to the verified AriSkill design system (Gate 3, OD-12). No AriSkill logo, brand font or brand colour is claimed anywhere in this stage.

## 1. Theme statement

A **warm, optimistic skill cosmos**. Each participant's 25 selections become one Arise Soul - a small, translucent, luminous companion - and many Souls make one Arise Galaxy. The hierarchy communicates **belonging and discovery**, never competition:

- every Soul is the same size, the same silhouette scale and the same brightness range;
- nothing in the image encodes capability, Platform, Role, matrix alignment or rank (BR-17);
- the Galaxy grows brighter as more people join, not as anyone "wins";
- the Bingo Star is a small round cosmetic badge with a text equivalent, never a crown, tier or rarity glow.

Language to avoid in visuals and copy: combat, tiers, rarity, leaderboards, "power", "level", medals, podiums.

## 2. Moodboard summary

See `docs/art/moodboard.md`. Derived direction: the chosen Arise Soul reference (blue-white translucent droplet: round head, antenna orb, heart belly, stubby feet, glowing lab tank) sets the **character**; the holographic pastel-neon references (thick violet outlines, star eyes, sparkles on black) set the **finish**: thick soft outline + halo glow on a deep-space background, with iridescent pastel fills instead of saturated neon.

## 3. Colour system (provisional)

Dark-first. The tokens live in `packages/design-tokens/tokens.json` and are emitted to `tokens.css` by `build.js`; the full list and rationale is in section 9.

| Role | Token | Dark value | Use |
|---|---|---|---|
| Deep-space background | `--color-bg` | `#0B0F1F` | every screen background; Galaxy base |
| Elevated / surface | `--color-bg-elevated`, `--color-surface`, `--color-surface-2` | `#121833`, `#182040`, `#1F2A4F` | cards, chips, panels |
| Text | `--color-text`, `--color-text-muted` | `#F2F4FF`, `#B4BCE0` | >= 4.5:1 on all four surfaces |
| Accent (interactive) | `--color-accent`, `--color-accent-strong` | `#A594FF`, `#CDC2FF` | buttons, links, active states |
| **Core skill** | `--color-core` | `#F5C84B` (warm amber) | Core chips, draw cards, matrix insight |
| **Critical skill** | `--color-critical` | `#6FD6FF` (cyan) | Critical chips, draw cards |
| Optional skill | `--color-optional` | `#AAB3CC` (neutral) | Optional chips |
| Match / line | `--color-match`, `--color-line` | `#8CF5C9`, `#FFF3B0` | matched cell, traced bingo line |
| Semantic | `--color-success/warning/danger/info` | `#5EE1A0 / #FFA24A / #FF7A8A / #7DB6FF` | toasts, banners |
| Focus | `--color-focus` | `#FFE68A` | 3 px focus ring, >= 3:1 on every surface |

Rules:

1. **Core = amber, Critical = cyan, Optional = neutral grey, everywhere** (chips, draw cards, stage density tiles, insight cards). The pair is a blue/yellow axis, which stays separable under protanopia, deuteranopia and tritanopia (tested with Machado 2009 simulation, deltaE >= 25).
2. **Colour is never the only signal.** Every Core/Critical/Optional chip carries a text label and a shape icon: Core = filled diamond, Critical = filled circle, Optional = outlined circle. Semantic states always carry an icon and text (E-copy in `docs/ux/state-copy.csv`).
3. Accent violet is reserved for interaction; it is never used for skill kinds.
4. Light theme (`[data-theme="light"]`) exists only for flat admin operational surfaces; public and stage displays are always dark.
5. Soul palettes (8) are a separate, equal-value family defined in `packages/ui/soul-renderer.js` and are never reused for UI semantics.

## 4. Typography (provisional)

- Geometric sans-serif is the intent. The stack is the self-hosted **Plus Jakarta Sans** (OFL-1.1, `packages/vendor/plus-jakarta-sans/`, variable weight 400-800) with the system UI font as fallback: `--font-sans: "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Chosen for a modern, minimal, less formal voice; headings carry slight negative tracking (-0.01 to -0.025em). Swap for the verified AriSkill brand font at Gate 3 if the brand owner supplies one.
- Countdowns, draw numbers and counts use `font-variant-numeric: tabular-nums` (declared by the UI kit) so digits do not jitter.
- Scale (mobile/admin, rem at 16 px base): xs 12, sm 14, md 16, lg 18, xl 22, 2xl 28, 3xl 36, display 56. Line heights: tight 1.15 (numerals, headlines), normal 1.5 (body).
- Venue scale (`.theme-venue`, public + stage at 1920x1080): xs 28, sm 32, **md 40**, lg 48, xl 64, **2xl 96**, 3xl 128, display 192 px. Line heights 1.05 / 1.3.

## 5. Spacing, shape, elevation, icons

- **8 px rhythm**: `--space-1..10` = 4, 8, 12, 16, 24, 32, 48, 64, 72, 80 px. 4 px only for icon/text optical gaps.
- **Touch targets >= 44 x 44 px** (`--touch-min`); skill chips are 44 px tall pills with 12 px horizontal padding; board cells >= 56 px on phones.
- Radius: sm 6 (inputs), md 12 (cards, cells), lg 20 (sheets, public panel), pill 999 (chips, buttons). Venue: 12 / 24 / 40.
- Elevation: two soft shadows only (`--shadow-1` rest, `--shadow-2` modal/sheet). No glow on admin surfaces. Public/stage surfaces may add a 1 px `--color-border` hairline and a restrained accent glow (<= 24 px blur, <= 0.35 opacity) that stays inside the panel.
- Iconography: 24 px grid, 2 px stroke, rounded caps and joins, single colour (`currentColor`). Only abstract/cosmic and functional glyphs (diamond, circle, star, ring, leaf, spark, QR, lock, wifi-off). No trophies, medals, ranks, arrows-up "growth" meters, or people icons that imply gender/body.
- Materials (2D sprite pipeline, D-13): translucent fill (94 % opacity) with a vertical highlight-to-fill gradient, thick 4.5 px outline in the palette's deep hue, 13 px blurred glow stroke behind it, white 35-70 % specular blobs. Public renderer draws Souls as SVG images or pre-rasterised textures; nothing photoreal.

## 6. Readability and contrast

| Context | Rule |
|---|---|
| Body text | >= 4.5:1 against its surface (tested for text + muted on all four dark surfaces and light surfaces) |
| Large text (>= 24 px or 19 px bold) and UI boundaries | >= 3:1 (accent, core, critical, optional, semantic, focus, border and line are all >= 3:1 on `--color-bg`) |
| Text on accent/semantic fills | `--color-text-inverse` >= 4.5:1 on every fill |
| Focus ring | 3 px `--color-focus`, offset 2 px, >= 3:1 on `--color-surface-2` |
| Mobile | zoom to 200 % and reflow at 320 px without horizontal scroll; no information in colour alone |
| **Venue displays (1920x1080, viewed 10-25 m)** | body >= 40 px, secondary >= 32 px, headline >= 96 px, hero numeral (draw number, countdown) >= 128 px; letter-spacing +1 % for all-caps labels; minimum stroke 3 px for icons; avoid pure white large fills (use `--color-text` off-white) to limit bloom on LED walls |
| Stage dashboard | same venue scale; tiles >= 3:1 boundaries; numbers tabular; never individual skill details |
| Reduced effects / high contrast | with `prefers-contrast: more`, drop glows, raise borders to 2 px `--color-text-muted`; Souls use `detail: 'simple'` (flat fills, no filters) |

Venue legibility must be re-verified on the actual hardware (OD-14) during rehearsal; the values above are derived for 1080p at 10-25 m and are provisional.

## 7. Public information safe zone

- Public screen = **left 65 % Galaxy | right 35 % information panel** (`docs/ux/canonical-flow.md` 3). At 1920 px: Galaxy x in [0, 1248), panel x in [1248, 1920).
- The Galaxy renderer clips **every** effect (nebula, stars, rings, Soul glow, entrance trails, winner burst) to the Galaxy viewport. No pixel of effect crosses x = 1248. This is encoded in `assets/scene/scene-config.json#safeZone` and tested.
- Inside the panel, a 32 px inner margin (`innerMarginPx`) keeps text off the edge; the panel background is opaque `--color-bg-elevated` so the Galaxy never bleeds under text.
- Stage dashboard has no Galaxy; it uses the venue type scale on flat tiles only.

## 8. Reduced-effects rules

- `prefers-reduced-motion`: no parallax, no orbit motion, no entrance arc, no bursts; entrances become a 400 ms fade at the final orbit slot; glow pulse off; camera static; UI durations collapse to a single 120 ms fade (never 0, so state changes remain perceivable).
- `static` renderer mode (P-07): nebula.svg + far star layer + Souls at `simple` detail, no animation.
- Flashing: no element changes luminance by more than 10 % more than 3 times per second; the winner burst is a single <= 800 ms bloom.
- Sound and motion never carry information alone: every cue has text in the panel (E-copy).

## 9. Provisional-to-verified token map

Every token below is **provisional**. The `verified` column is filled by the brand owner (OD-12); `tokens.json#verified.map` holds the same table as data and the test asserts it is complete.

| Token | Provisional value | Verified AriSkill token |
|---|---|---|
| `--color-bg` | `#0B0F1F` | _pending_ |
| `--color-bg-elevated` | `#121833` | _pending_ |
| `--color-surface` | `#182040` | _pending_ |
| `--color-surface-2` | `#1F2A4F` | _pending_ |
| `--color-border` | `#55679F` | _pending_ |
| `--color-text` | `#F2F4FF` | _pending_ |
| `--color-text-muted` | `#B4BCE0` | _pending_ |
| `--color-text-inverse` | `#0B0F1F` | _pending_ |
| `--color-accent` | `#A594FF` | _pending_ |
| `--color-accent-strong` | `#CDC2FF` | _pending_ |
| `--color-core` | `#F5C84B` | _pending_ |
| `--color-critical` | `#6FD6FF` | _pending_ |
| `--color-optional` | `#AAB3CC` | _pending_ |
| `--color-success` | `#5EE1A0` | _pending_ |
| `--color-warning` | `#FFA24A` | _pending_ |
| `--color-danger` | `#FF7A8A` | _pending_ |
| `--color-info` | `#7DB6FF` | _pending_ |
| `--color-focus` | `#FFE68A` | _pending_ |
| `--color-match` | `#8CF5C9` | _pending_ |
| `--color-line` | `#FFF3B0` | _pending_ |
| `--font-sans` | Plus Jakarta Sans, system-ui fallback | self-hosted OFL font (2026-09-22); brand owner may swap at Gate 3 |
| `--font-mono` | ui-monospace stack | _pending_ |
| `--font-size-xs … --font-size-display` | 12 / 14 / 16 / 18 / 22 / 28 / 36 / 56 px | _pending_ |
| `--line-height-tight`, `--line-height-normal` | 1.15, 1.5 | _pending_ |
| `--space-1 … --space-10` | 4, 8, 12, 16, 24, 32, 48, 64, 72, 80 px | _pending_ |
| `--radius-sm/md/lg/pill` | 6 / 12 / 20 / 999 px | _pending_ |
| `--shadow-1`, `--shadow-2` | soft dual shadows | _pending_ |
| `--touch-min` | 44 px | _pending (must stay >= 44)_ |
| `--z-toast`, `--z-modal` | 1000, 900 | _pending_ |
| `--duration-fast/base/slow` | 150 / 250 / 600 ms | _pending (motion-spec owns final)_ |
| `--ease-standard`, `--ease-emphasized` | `cubic-bezier(0.2,0,0,1)`, `cubic-bezier(0.05,0.7,0.1,1)` (no overshoot) | _pending_ |
| Light theme colours | see `tokens.json#themes.light` | _pending_ |
| Venue scale | see `tokens.json#themes.venue` | _pending (verify on venue hardware, OD-14)_ |

## 10. Asset list, owners, budgets, licences, fallbacks

All assets are **internal-original**, generated by checked-in scripts from parameter files (no third-party art, fonts or code). Runtime format is **SVG** for sprites and **JSON** for scene data (decision D-ART-01 in the stage report: PNG rasterisation is not required because SVG renders crisply at every LOD; renderers that need textures rasterise SVG at load time).

| Asset | Path | Owner | Generator | Budget | Fallback | Licence |
|---|---|---|---|---|---|---|
| Design tokens | `packages/design-tokens/tokens.{json,css}` | art-director-agent | `packages/design-tokens/build.js` | <= 8 KB CSS | n/a | internal |
| Soul renderer | `packages/ui/soul-renderer.js` | art-director-agent (file) / ui-kit-agent (package) | n/a | <= 20 KB source; <= 6 KB per full SVG | `detail:'simple'` (<= 2.5 KB), `detail:'dot'` (<= 1 KB) | internal |
| Soul cohort (24) | `assets/souls/cohort/<seed>.svg` | art-director-agent | `tools/assets/build-souls.js` | <= 6 KB each, 108 KB total | `assets/souls/fallback/<seed>-simple.svg`, `-dot.svg` | internal-original |
| Soul thumbnails | `assets/souls/thumbnails/<seed>-64.svg` | art-director-agent | same | <= 6 KB each | n/a | internal-original |
| Cohort sheet | `assets/souls/sheet.html` | art-director-agent | same | review only, not shipped | n/a | internal-original |
| Star field layers | `assets/scene/starfield-layer-{1,2,3}.json` | art-director-agent | `tools/assets/build-scene.js` | 22 / 12 / 5 KB | layer 1 only in `low`/static | internal-original |
| Nebula | `assets/scene/nebula.svg` | art-director-agent | same | <= 4 KB; <= 1248x1080 texture (approx. 5.4 MB RGBA when rasterised) | flat `--color-bg` | internal-original |
| Orbit rings | `assets/scene/orbit-rings.json` | art-director-agent | same | <= 2 KB | none needed | internal-original |
| Scene config | `assets/scene/scene-config.json` | art-director-agent | same | <= 4 KB | built-in defaults in the public app | internal-original |
| Asset manifest | `assets/manifest/assets.yaml` | art-director-agent (souls/scene entries) | both generators | n/a | n/a | n/a |
| Audio | `assets/audio/*`, `assets/manifest/audio.yaml` | sound-agent | `tools/assets/build-audio.py` | see sound-spec | see sound-spec | internal-original |

Runtime budgets (public Galaxy): frame time 16.7 ms at 60 fps target, minimum 30 fps; 30-minute soak at 450 Souls on `medium`; texture memory <= 64 MB; JS bundle <= 350 KB gzip; scene data <= 120 KB; Soul SVG <= 6 KB; at most 6 concurrent entrances.

Missing-asset fallback: any Soul whose SVG fails to load renders through `renderSoulSvg(config, { detail: 'simple' })` inline; if the config fails validation the neutral config (`neutralSoulConfig`) is rendered. Scene files missing -> flat background, no stars, Souls still placed by `soulOrbitSlot`.

## 11. Gate 3 checklist (self-assessed)

- [x] No visual trait implies capability, Role status or rank (same size/scale/brightness; tested in `tools/assets/test/souls.test.js`).
- [x] Public information safe zone and stage readability defined (sections 6-7, scene-config).
- [ ] Brand owner approves verified mapping - **pending human** (OD-12, D-09).
- [x] Accessibility and asset budgets defined and tested (contrast + CVD tests, size tests).
