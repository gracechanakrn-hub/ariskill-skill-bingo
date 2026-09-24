# Admin portal (`/admin`) - Mission Control, Insights, Audit

Static, build-free ES-module app served by the game service at `/admin` (`apps/admin-portal`). Zero third-party
code; CSP `default-src 'self'` safe (no inline scripts, no `innerHTML` with server strings). Light operational
theme via `data-theme="light"` on `<html>`.

## Run

```sh
export BINGO_ENV=development BINGO_DB_PATH=/tmp/admin.sqlite PORT=8102 BINGO_PUBLIC_BASE_URL=http://127.0.0.1:8102
SEED_PLAYERS=24 node services/game-service/src/seed.js
node services/game-service/src/server.js
open http://127.0.0.1:8102/admin            # sign in with the admin token (dev: dev-admin-token)
```

Development only: on loopback hosts `http://127.0.0.1:8102/admin/?token=dev-admin-token` reads the token once,
stores it in `sessionStorage` and strips it from the URL (used for headless screenshots). Tabs deep-link with
`#mission`, `#insights`, `#audit`.

## Structure

| File | Role |
|---|---|
| `index.html`, `app.css` | shell (tokens -> base.css -> motion.css -> app.css), skip link, toast region |
| `src/main.js` | bootstrap: sign-in, snapshot + SSE (`snapshot -> applySnapshot -> start({since})`, refetch + `acknowledgeSnapshot` on reconnect/gap), tabs, header status, audio, renders |
| `src/auth.js` | token in `sessionStorage`; dev-only `?token=` consumption |
| `src/api.js` | admin endpoints over `/packages/ui/api-client.js` (+ clock sync) |
| `src/state.js` | **pure** reducers / view-models: `normaliseSnapshot`, `reduceEvent`, `roundViewModel`, helpers (tested) |
| `src/commands.js` | **pure** command runner: pending, fresh `Idempotency-Key` per user action (kept only for a retry of the same action after a network failure), `expectedVersion` from the current summary, 409 `STALE_VERSION` never re-fires (tested with a fake api) |
| `src/copy.js` | `t()` / `exception()` from `/packages/contracts`, plus proposed `adminLocal.*` labels (see below) |
| `src/dialogs.js` | toasts; confirm / reason / round-form dialogs with `focusTrap`, Escape, focus restore |
| `src/views/mission-control.js` | round list, create-round form (built once), layout |
| `src/views/round-panel.js` | current round panel per state (A2.DRAFT ... A2.END) |
| `src/views/insights.js` | aggregate Insights (A3), polled every 10 s while the tab is visible |
| `src/views/audit.js` | audit table (A4), newest first, round filter |
| `test/*.test.js` | `node --test apps/admin-portal/test` |

## Behaviour summary

- **Command safety (A-04/A-05/BR-20):** every command posts `{ command, expectedVersion, params }` with an
  `Idempotency-Key`; one command in flight (double-clicks return `busy`); `round.draw.next` always sends `params: {}`;
  409 `STALE_VERSION` -> E10 toast, round replaced from `details.snapshot`, admin snapshot refetched, no auto re-fire;
  `ILLEGAL_TRANSITION` / `POOL_TOO_SMALL` / `POOL_EXHAUSTED` / `DRAW_FAILED` show the exception copy; an unexpected
  failure of `round.lock` (or the lock leg of `round.start_now`) shows E19 and leaves the panel untouched until the
  snapshot refresh; `REASON_REQUIRED` is prevented client-side (dialog requires a reason) and otherwise shown as the
  server message.
- **State controls:** DRAFT (Edit dialog, Open registration, Cancel) - REGISTRATION_OPEN (live counts, join QR +
  URL, lock countdown via clock-sync; Reschedule is the primary safe default; Lock now and Start now are ghost
  buttons behind confirmation dialogs (`adminLocal.lockNowConfirm`, `admin.startNowConfirm`); Cancel) - LOCKED (readiness panel, Start disabled + E20 when pool < 5, `admin.startOverdue` warning, Cancel) -
  PLAYING (Next Skill with pending state, pacing hint, newest-first draw list with Core/Critical chips, cancel with
  reason) - WINNER (co-winners with lineIds + winning draw, result-window countdown, no actions) - EXHAUSTED (E23 +
  E11, Close, Cancel) - CLOSED/CANCELLED (Create next round focuses the form).
- **Audio:** `draw_leadin` on Next Skill press, `draw_reveal` on live `draw.accepted`, `bingo` once per round on
  `bingo.detected`, `error_soft` on any E-code toast, `reconnect` on reconnecting; master mute + volume in the header;
  unlock on the first click/keydown; replays suppressed via `meta.replay` + `setReplaying`.
- **Accessibility:** keyboard operable, visible focus (kit rings), labelled controls, dialogs with focus trap +
  Escape + focus restore, polite live region for command results / accepted draws (assertive for bingo), tabs with
  arrow-key navigation scoped to the tablist (no global shortcuts), status pills always carry text.

## Copy

All catalog strings come from `packages/contracts/copy.json` via `t()` / `exception()`. The catalog has no keys for
the operational admin chrome (sign-in, audit headers, count labels, dialog buttons). Those labels live in
`src/copy.js` under `adminLocal.*` as **proposed additions** for the copy owner (OD-11); once adopted into
`copy.json` they resolve from the catalog first and the local table becomes dead.
