# Accessibility evidence (requirement 12.2, AC 13, hard QC "Accessibility")

Automated: `node --test tests/accessibility` (source-level heuristics per app: landmarks, skip link, labels, button names, alt text, CSP inline-script ban, innerHTML with dynamic content, live region, tablist, reduced motion, 44 px touch targets in the shared kit). An app that is not delivered yet is **skipped with a message**; the checks run as soon as `apps/<app>/index.html` exists.

Manual walkthroughs below are the release evidence for `reports/qa/accessibility-review.md`. Run them on the real apps served by the game service (`npm run seed && npm start`), record pass/fail per row with device, browser, assistive technology and build id (`build/RUN_ID`).

## Common setup

- Server: `BINGO_ENV=development npm run seed` then `npm start`; open `/play?t=<token from seed output>`, `/admin`, `/public`, `/stage`.
- Screen readers: VoiceOver (iOS Safari, macOS Safari/Chrome), TalkBack (Android Chrome), NVDA (Windows Chrome/Firefox) for admin/stage.
- Zoom/reflow: browser zoom 200 % and 400 % on desktop, viewport 320 px wide on mobile (Chrome device toolbar), OS text size "Larger" on phones.
- Contrast: check every text/control token pair from `packages/design-tokens/tokens.json` with a contrast checker (AA: 4.5:1 body, 3:1 large text and UI parts); record the failing pairs.
- Reduced motion: enable "Reduce motion" (iOS/macOS/Windows) and reload; motion one-shots must be replaced by the reduced variants (motion spec section on reduced motion), no parallax, no auto-scroll.
- Silent mode: mute the device / deny autoplay; every audio cue must have a visible caption or state equivalent (audio manager `onCaption`).

## Employee mobile (`/play`) - critical flow, AA required

| # | Step | Expected |
|---|---|---|
| 1 | Open the join link, tab from the address bar | First focus stop is the skip link; activating it moves focus to `main`. |
| 2 | Join form (display name, consent checkbox) with screen reader | Every field announces its label and required state; the consent checkbox announces checked state; errors (E2 expired link) are announced from a live region without moving focus unexpectedly. |
| 3 | Platform and Role selects | Both are empty until chosen (no prefill); selecting Platform filters Roles; screen reader announces the chosen option; the "Continue" button is disabled/blocked until both are set (E16 copy when attempted). |
| 4 | Discovery tabs (Recommended / Popular / Search) | Arrow keys move between tabs, `aria-selected` follows, the panel is announced; search field has a label; result count is announced politely. |
| 5 | Add 25 skills by keyboard only | Each option is a 44 px target, toggles `aria-pressed`, the progress "n / 25 skills selected" is announced; the duplicate case (E4) is announced; the 26th is rejected with copy. |
| 6 | Finalize | "Your Skill Bingo is ready!" is announced; the 5 x 5 board is a grid with row/column semantics or a list with position + skill name; every cell shows kind by icon + label, not colour alone. |
| 7 | Lock and play | Draw announcements ("Draw 7: <skill>") arrive via the live region, focus does not move; matched cells announce "matched"; reduced-motion users get no shake/pulse. |
| 8 | Result and Soul | Winner / not-winner state is announced; the Soul image has alt text (`soulAltText`); the Float button is 44 px, its countdown is announced or has a text equivalent. |
| 9 | Reflow at 320 px and 200 % zoom | No horizontal scrolling, the board stays usable, sticky bottom bar does not cover content. |
| 10 | Silent mode | Every cue (ready, draw, match, bingo, soul, float) has a caption/toast. |

## Admin portal (`/admin`) - critical flow, AA required

| # | Step | Expected |
|---|---|---|
| 1 | Keyboard only through Mission Control | Logical tab order: round list, readiness, Next Skill, cancel; no global shortcuts; visible focus ring on every control. |
| 2 | Next Skill with screen reader | Button announces pending state (`aria-busy`/"pending") and the accepted draw; a rejected command (E10 stale) is announced and the snapshot refresh is described. |
| 3 | Confirmation dialogs (start now, cancel with reason) | Dialog is modal (`focusTrap`), focus moves in and returns to the trigger, Escape closes, the reason textarea has a label and error text. |
| 4 | Insights tab | Tables have headers; suppressed cohorts are explained in text; no colour-only encoding of Core/Critical. |
| 5 | Zoom 200 % / 1280 px | No clipping of the draw list, counters remain readable. |

## Public Galaxy (`/public`) - venue legibility

| # | Step | Expected |
|---|---|---|
| 1 | Info panel at 1920 x 1080 from 8-10 m | Body text >= 40 px, headline >= 96 px (`theme-venue`), contrast AA on the dark theme. |
| 2 | Draw and winner states | Kind icon + label + colour, matched count readable; winner labels follow consent. |
| 3 | Renderer fallback | Force WebGL off (or headless Chrome): Canvas 2D / static fallback keeps the info panel fully functional; no blank screen. |
| 4 | Reduced motion at the OS | Entrance/orbit animations reduce to fades; no flashing above 3 Hz at any time. |
| 5 | Muted / autoplay denied | Ambient and cues silent, no error dialogs, captions optional. |

## Stage dashboard (`/stage`) - read-only

| # | Step | Expected |
|---|---|---|
| 1 | Keyboard | No interactive controls beyond mute/theme; nothing traps focus. |
| 2 | Screen reader (presenter with AT) | Headings for round status, draws, winners, insights; live region announces accepted draws and results only (no per-second countdown chatter). |
| 3 | Insight explanation | Aggregate labels and cohort suppression note are readable text, not only charts; charts have text summaries. |

## Recording

Copy the tables into `reports/qa/accessibility-review.md`, fill Status (pass/fail/n.a.), Evidence (screenshot path under `build/screenshots/`), Tester, Date, Device/AT. Any fail on rows marked critical blocks the accessibility gate.
