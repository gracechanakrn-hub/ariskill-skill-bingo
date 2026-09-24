# Accessibility review (requirement 12.2, AC 13, hard QC "Accessibility")

Run `run-20260922-113339`. Automated evidence: `node --test tests/accessibility` (static checks per app; skipped while an app is not delivered). Manual scripts: `tests/accessibility/README.md`. Fill one row per app x check; Status `pass` / `fail` / `n.a.`; attach evidence under `build/screenshots/a11y/`.

## Automated (per app)

| App | Delivered | Static checks (`tests/accessibility`) | Notes |
|---|---|---|---|
| employee-mobile | | | |
| admin-portal | | | |
| public-galaxy | | | |
| stage-dashboard | | | |

## Manual walkthrough summary

| App | Keyboard only | Screen reader | Contrast AA | Zoom 200 % / reflow 320 px | Reduced motion | Silent / muted | Touch targets 44 px | Live-region announcements, no focus theft | Status | Tester | Device / AT | Date |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| employee-mobile (critical) | | | | | | | | | | | | |
| admin-portal (critical) | | | | | | | | | | | | |
| public-galaxy (venue legibility) | | | | | | | | | | | | |
| stage-dashboard | | | | | | | | | | | | |

## Findings

| # | App | WCAG SC | Severity (critical / major / minor) | Description | Location (file:line) | Fix owner | Status |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Contrast token pairs checked

| Token pair (text / background) | Ratio | AA (4.5:1 body, 3:1 large/UI) | Where used |
|---|---|---|---|
| | | | |

Sign-off: ______________________ Date: __________
