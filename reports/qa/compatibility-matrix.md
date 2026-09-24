# Compatibility matrix (requirement 18.2, hard QC "Compatibility", OD-14)

Run `run-20260922-113339`. Status vocabulary: `pass` / `fail` / `blocked` / empty = not yet tested. Fill Build with `build/RUN_ID` (+ `build/build-info.json` buildId once assembled). Evidence = screenshot path under `build/screenshots/` or a note.

## Venue assumptions (OD-14, to verify before rehearsal)

| Item | Assumption | Verified value | Status |
|---|---|---|---|
| Public display | 1920 x 1080, modern Chromium (kiosk), WebGL2 available | | |
| Stage display | 1920 x 1080 (or presenter laptop), modern Chromium | | |
| Admin device | Laptop 1440 x 900, Chrome/Edge current | | |
| Network | Venue Wi-Fi shared by phones, displays and admin; captive portal? | | |
| Audio | Venue PA fed from the public display device | | |
| Spare device | Second display device with cached assets | | |

## Employee mobile (`/play`)

| Class | Device | OS | Browser | Join via QR | Build board (25) | Realtime + reconnect | Soul + Float | Reflow 320 px / zoom | Status | Build | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Lower-end Android | e.g. Samsung A1x / A2x | Android 12-13 | Chrome current | | | | | | | | |
| Lower-end Android | Xiaomi Redmi 9/10 class | Android 11-13 | Chrome current | | | | | | | | |
| Mid Android | Pixel 6a / Samsung A5x | Android 14 | Chrome current | | | | | | | | |
| Mid Android | any | Android 14 | Samsung Internet | | | | | | | | |
| Older iPhone | iPhone SE 2 / iPhone XR | iOS 16-17 | Safari | | | | | | | | |
| Current iPhone | iPhone 13-15 | iOS 17-18 | Safari | | | | | | | | |
| Current iPhone | iPhone 13-15 | iOS 17-18 | Chrome (WebKit) | | | | | | | | |
| In-app browser | any | any | LINE / Teams / Outlook in-app webview | | | | | | | | |
| Tablet | iPad | iPadOS current | Safari | | | | | | | | |

## Admin portal (`/admin`)

| Device | OS | Browser | Mission Control | Confirm dialogs | Reconnect after Wi-Fi loss | Insights | Status | Build | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| Admin laptop (exact venue unit) | | Chrome current | | | | | | | |
| Admin laptop | | Edge current | | | | | | | |
| Backup tablet | | Safari / Chrome | | | | | | | |

## Public Galaxy (`/public`)

| Device | GPU / renderer | Resolution | Browser | WebGL2 path | Canvas 2D fallback | Static fallback | Audio autoplay | 30 min soak (fps) | Status | Build | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Exact venue display device | | 1920 x 1080 | Chromium kiosk | | | | | | | | |
| Spare display device | | 1920 x 1080 | Chromium | | | | | | | | |
| Presenter laptop (backup) | | | Chrome | | | | | | | | |

## Stage dashboard (`/stage`)

| Device | Resolution | Browser | Read-only verified | Realtime + reconnect | Insights readable at distance | Status | Build | Evidence |
|---|---|---|---|---|---|---|---|---|
| Stage display device | 1920 x 1080 | Chromium | | | | | | |
| Presenter laptop | | Chrome | | | | | | |

## Notes

- Automated API/SSE compatibility is covered by `tests/e2e` and `tests/contracts` (server side); this matrix covers client rendering and devices only.
- Headless Chrome (no WebGL) screenshots per app are produced by the app workstreams under `build/screenshots/`; they exercise the Canvas 2D fallback path.
