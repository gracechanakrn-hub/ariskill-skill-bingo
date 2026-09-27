# @ariskill/ui - shared client kit

Zero-dependency, build-free ES modules and CSS shared by the four static clients
(`/play`, `/admin`, `/public`, `/stage`). The game service serves this folder at
`/packages/ui/*`, so every app imports with absolute paths and never bundles:

```html
<link rel="stylesheet" href="/packages/design-tokens/tokens.css">
<link rel="stylesheet" href="/packages/ui/base.css">
<script type="module" src="/play/app.js"></script>
```

```js
// apps/employee-mobile/app.js (served at /play)
import { createApiClient, ApiError } from '/packages/ui/api-client.js';
import { createClockSync, formatCountdown } from '/packages/ui/clock-sync.js';
import { createSseClient } from '/packages/ui/sse-client.js';
import { createStore, applySnapshot, applyEvent } from '/packages/ui/store.js';
import { h, mount, announce, focusTrap, escapeHtml, setPending } from '/packages/ui/dom.js';
import { plural, formatInt, formatTime, relativeSeconds, pseudonymLabel } from '/packages/ui/format.js';
import { qrToSvg } from '/packages/ui/qr.js';
import { track } from '/packages/ui/telemetry.js';
import { t, exception } from '/packages/contracts/index.js';
```

Everything runs in modern browsers as native ESM. The modules also import in Node (used by the tests);
`dom.js` and `telemetry.js` guard every `window` / `document` access.

Sibling modules owned by other agents (`soul-renderer.js` with its generated `soul-baseline-shape.js`, `doodads.js`, `audio.js`, `motion.js`, `motion.css`) live in
the same folder and are exported by the same `"./*"` rule. `soul-renderer.js` and `doodads.js` are documented below.

## Modules

### api-client.js

```js
const api = createApiClient({
  baseUrl: '/api/v1',
  getToken: () => sessionStorage.getItem('sessionToken'), // participant / admin / stage bearer; null for public
  clockSync,                                               // optional: receives serverTime from every response
});
const snap = await api.get('/me');                                                   // GET
const saved = await api.put('/me/board/selections', { skillIds, boardVersion });     // PUT with auto Idempotency-Key
const key = api.newIdempotencyKey();                                                 // keep the key while a command is pending
const res = await api.post(`/admin/rounds/${roundId}/commands`, { command: 'round.draw.next', expectedVersion, params: {} }, { idempotencyKey: key });
```

- `Authorization: Bearer <token>` is added whenever `getToken()` returns a value.
- Every non-GET request carries `Idempotency-Key` (auto `crypto.randomUUID()`); pass `idempotencyKey` yourself
  when the UI must retry a pending command after a page reload.
- Retries (same key, exponential backoff, default 3) happen only on network failure / timeout and 502 / 503 / 504.
  4xx (including 409 `STALE_VERSION`, `ROUND_LOCKED`) and 500 are never retried automatically.
- Errors are `ApiError { code, message, exceptionId, details, status, correlationId, serverTime }` with helpers
  `isNetwork`, `isStaleVersion`, `staleSnapshot` (the `details.snapshot` from a 409), `isAuth`.
- `api.lastServerTime` (ISO) and `api.lastServerTimeMs` expose the newest `serverTime` seen.

```js
try { await api.post(...); }
catch (err) {
  if (err instanceof ApiError && err.isStaleVersion) { applySnapshot(store, err.staleSnapshot); toast(exception('E10').copy); }
  else if (err.exceptionId) toast(exception(err.exceptionId).copy);
}
```

### clock-sync.js

```js
const clockSync = createClockSync({ fetchTime: () => api.get('/time') });
await clockSync.sync();            // 3 samples of GET /api/v1/time, median offset, monotonic anchor
clockSync.startAutoResync(60_000); // optional periodic correction
clockSync.now();                   // corrected epoch ms - use for DISPLAY only
formatCountdown(round.lockAt, clockSync.now()); // 'mm:ss', never negative, '00:00' at/after target
```

Rules: countdowns are display only. Lock and start are driven by `round.locked` / `round.started` events, never
by the local clock reaching zero. Passing `clockSync` to `createApiClient` feeds passive samples; a drift above
250 ms schedules a resync automatically. Show `exception('E7').copy` ("Syncing with the event...") while
`clockSync.isSynced` is false.

### sse-client.js

`EventSource` cannot send `Authorization`, so this client reads `text/event-stream` over `fetch` and a
`ReadableStream`. It handles `id:` / `event:` / `data:` / `retry:` lines, comment heartbeats, resume
(`Last-Event-ID` header and `?since=`), duplicate suppression, gap detection, 45 s silence detection and
exponential reconnect backoff (max 10 s).

```js
const sse = createSseClient({
  url: '/api/v1/me/stream',
  getToken: () => sessionStorage.getItem('sessionToken'),
  since: snapshot.sequence,                 // cursor from the snapshot you already applied
  onEvent(envelope, meta) {
    applyEvent(store, envelope, reduce);    // final state always follows the event / snapshot
    if (!meta.replay) celebrate(envelope);  // see "celebration suppression"
  },
  onGap: refreshSnapshot,                   // sequence gap or system.snapshot_required
  onStatus(status, { connectionEpoch, resumedFrom }) {
    banner(status === 'open' ? null : t('reconnect'));  // 'connecting' | 'open' | 'reconnecting' | 'closed'
    if (status === 'open' && connectionEpoch > 1) refreshSnapshot();
  },
});
sse.start();

async function refreshSnapshot() {
  const snap = await api.get('/me');
  applySnapshot(store, snap);
  sse.acknowledgeSnapshot(snap.sequence);   // cursor := snapshot.sequence; events <= it are replay
}
```

Properties: `status`, `connectionEpoch` (1 on the first connection, +1 on every reconnect), `lastSequence`,
`liveFromSequence`, `stop()`, `reconnectNow()` (call on `online` / `visibilitychange`). 401/403/404 responses
close the client (`status === 'closed'`, `stoppedReason`) instead of retrying.

`parseSseChunk(buffer) -> { frames, rest }` is exported for tests and custom transports.

#### Reconnect + celebration suppression pattern

The contract (`contracts/realtime-events.json` clientRules, requirement 11) says replayed events set the final
state without re-triggering celebrations. The kit implements this with `meta.replay`:

1. First connection: fetch the snapshot, `applySnapshot`, then `createSseClient({ since: snapshot.sequence })`.
   Events with `sequence > since` are live (`meta.replay === false`).
2. On every reconnect (`connectionEpoch` increments) the client marks all events as replay until you call
   `sse.acknowledgeSnapshot(snapshot.sequence)`. Fetch the snapshot in `onStatus('open')` when
   `connectionEpoch > 1`, apply it, acknowledge it. Events with a higher sequence are live again.
3. On `onGap` (gap or `system.snapshot_required`) do the same: fetch, apply, acknowledge. Until then events are
   delivered with `meta.replay === true` and `meta.gap === true`.
4. Apps that key celebrations by id (e.g. `soul.float_accepted` dedup by `soulId`) should still keep their own
   `Set` of celebrated ids; `meta.replay` covers the transport, the id set covers app-level re-renders.

### store.js

```js
const store = createStore({ sequence: -1 });
store.subscribe((next, prev) => render(next));
applySnapshot(store, snapshot);                                   // snapshot always wins; sets sequence
applyEvent(store, envelope, (state, env) => ({ ...state, round: env.payload.round })); // ignored when sequence <= last
select(store, (s) => s.round?.state, (state) => announce(`Round ${state}`));
```

### dom.js

```js
const button = h('button', { className: 'btn btn--primary', type: 'button', onClick: save, disabled: !ready, 'aria-describedby': 'hint', dataset: { skillId } }, t('board.edit'));
mount('#app', h('main', { id: 'main', className: 'container stack' }, header, button));
announce(t('play.draw', { number: 7 }) + ' ' + draw.skill.name);   // one shared aria-live region, never moves focus
const release = focusTrap(dialog, { onEscape: close });            // returns release() restoring focus
setPending(button, true);                                          // .is-pending + aria-busy + disabled (spinner from base.css)
escapeHtml(userText);
```

`h` supports `className` / `class`, `dataset`, `style` objects (incl. custom properties), `aria-*`, `on*`
listeners, boolean attributes (`disabled`, `hidden`, `aria-pressed: true`), `ref`, `text`, `html` and SVG tags.

### format.js

`plural(3, 'skill')`, `formatInt(12345)`, `formatTime(iso, { timeZone })` (HH:mm), `relativeSeconds(iso, clockSync.now())`,
`pseudonymLabel(soulId)` (client fallback when the server sends `label: null`), `ordinal`, `padTwo`.

### qr.js

```js
const { joinUrl } = await api.get(`/events/${eventId}/join-info`);
qrHost.innerHTML = qrToSvg(joinUrl, { size: 320, margin: 4, ariaLabel: `Join link QR code: ${joinUrl}` });
// or: const { size, modules } = encodeQr(joinUrl);   // modules[y][x] === true means dark
```

Byte mode, error correction M, versions 1-10 (up to 213 UTF-8 bytes), all 8 masks with penalty scoring. Verified
module-for-module against an independent encoder for all versions and masks (see `test/qr.test.js`). The join URL
is short-lived and rotated; re-render whenever `join-info` changes.

### telemetry.js

`track('client.reconnect', { audience: 'public', gapSize, durationMs })` - a no-op sink that logs to
`console.debug` when the page is opened with `?debug=1`. Props named `employeeRef`, `email`, `selectedSkillIds`
(and a few more identifiers) are dropped before any sink sees them; arrays are reduced to their length.

### base.css

Reset, layout primitives (`.container`, `.stack`, `.cluster`, `.grid`, `.card`, `.app-header`, `.sticky-bottom`)
and components: `.btn` (`--primary`, `--danger`, `--ghost`, `.is-pending`), `.chip` + `.chip__remove`, `.option`,
`.input` / `.select` / `.textarea` / `.checkbox`, `.tabs` + `.tab[aria-selected]`, `.pill--live|reconnecting|...`,
`.toast` / `.banner--reconnecting`, `.modal-backdrop` + `.modal`, `.countdown` (tabular numerals),
`.bingo-grid` + `.bingo-cell.is-matched|.is-line|--core|--critical`, `.progress`, `.stat`, `.draw-card`,
`.table`, `.qr`, `.skip-link`, `.visually-hidden`.

All colours, type, spacing, radii, shadows, z-index and motion come from `/packages/design-tokens/tokens.css`
custom properties with fallbacks, so the CSS renders before tokens load. `prefers-reduced-motion` removes
transitions and spinners, `prefers-contrast: more` and `forced-colors` thicken borders. Every status also has text
or an icon (matched cells show a check, pills have a label), focus rings are 3 px, touch targets >= 44 px.

Recommended document skeleton:

```html
<a class="skip-link" href="#main">Skip to content</a>
<header class="app-header">...</header>
<main id="main" class="container app-main stack" tabindex="-1">...</main>
<div class="toast-region" aria-live="polite"></div>
```

### soul-renderer.js (v4.0.0, the Arise Soul baseline character, decorated since D-29)

```js
import { renderSoulSvg, soulAltText, resolveSoul, TRAITS, PALETTES, STICKER, EYE_WHITE, BADGE_LABEL, BADGE_CENTER, soulOrbitSlot } from '/packages/ui/soul-renderer.js';
const svg = renderSoulSvg(soul.config, { size: 220, badge: soul.badge, detail: 'full', reducedMotion: prefersReducedMotion(), label: alt, idPrefix: `soul-${soul.soulId}` });
```

Deterministic: same config -> byte-identical SVG (viewBox `0 0 200 200`, no DOM). Since D-27 every Soul is the one
baseline character of `docs/art/soul-baseline.md`, drawn from its 3D model: the only import is
`soul-baseline-shape.js`, a generated, checked-in data module (silhouette, drips, eyes, orb, chin crease and arm slits
as a front orthographic projection of `tools/ai/blender/soul_baseline.py`, written by `tools/assets/build-soul-shape.py`;
see "Flat 2D Soul" in that doc). The look keeps the `docs/art/sticker-art-direction.md` sticker language: radial clay
gradient body (palette light top-left -> base -> `--sticker-violet-deep` at the bottom edge) with a thin palette outline,
2 px peach rim on the lower right, goo drips in the palette light (soft edge), near-white `EYE_WHITE` button eyes ringed
by a groove in the palette outline colour, the antenna neck with a lit orb (glow: white core -> palette light ->
transparent), a blurred key-light highlight, and the whole figure duplicated below as a white die-cut stroke (6 px at
240 px, round joins) with `--sticker-shadow`.

| Option | Default | Meaning |
|---|---|---|
| `size` | `160` | CSS px of the square output; die-cut, rim and shadow scale with it |
| `badge` | `null` | `'bingo-star'` draws the gold five-point star (white outline, upper right at `BADGE_CENTER`, beside the antenna orb); never part of the config (BR-17) |
| `detail` | `'full'` | `'full'` gradients + filters (soft drips and fold lines, highlight blur, drop shadow), glow style, glow breath; `'simple'` same character without any filter (3 px die-cut, flat offset shadow, crisp drips) for thumbnails and the Galaxy atlas; `'dot'` 24 px glowing disc, no badge |
| `reducedMotion` | `false` | removes the only animation (4.8 s glow breath) |
| `label` | `null` | overrides the alt text (must follow the same no-Platform/Role/rank rule) |
| `idPrefix` | `soul-<seed>` | namespaces gradient/clip/filter ids so many Souls can be inlined |

Per player only the palette, the glow style (`soft` / `ring` / `halo`) and the badge flag change the drawing. The
seeded body / eyes / antenna / mouth traits and the constellation stay in the config (no contract change) and in
`resolveSoul`, but are not drawn on the baseline yet; `BODY_PATHS` (the six v2 silhouettes) stays exported for
backward compatibility only. Invariants (tested in `test/soul-renderer.test.js` and `tools/assets/test/souls.test.js`):
same figure, glow radius, line weights, die-cut width and highlight for every Soul; forbidden inputs (`platformId`,
`roleId`, `rank`, `isWinner`, ...) are ignored; every SVG stays under 6 KB (worst case about 5.6 KB with a 19-character
id prefix, badge and glow breath); no `<text>`, no raster, no inline style. `STICKER` mirrors the design-tokens 1.2.0
`--sticker-*` values. The shape module records the sha256 of the model script and drip list it was projected from, and
the tests fail when the 3D model changes without a regenerated shape.

**Decorated Souls (v4.0.0, D-29, `docs/art/soul-decorations.md`).** A v2 config (`isDecoratedConfig`) is drawn as the
same baseline with its catalog gradient instead of a palette: a vertical `linearGradient` over the model's height span
(`GRADIENT_SPAN`, `gradientY(h)` maps a model height to viewBox y) under a light/shade overlay, drips, orb and groove in
the gradient's highlight / outline, then the face sprite and the charm sprites as `<image>` layers at the slots of
`soul-decor-data.js` (`front2d`). `{ images: false }` omits the external images (SVG rasterised through a `data:` URL
cannot load them); `soulSpriteLayers(config)` returns the same layers in paint order for canvas compositing.
`decorUsable()` is false while `soul-decor-data.js` is the hand-written stub, so stub geometry never ships. The Bingo
Star badge on a decorated Soul sits on a round medallion (`BADGE_MEDALLION`) so it cannot be mistaken for a core star
charm. Alt text: "Arise Soul, Aurora colour, with round glasses. 10 charms: 4 technical, 4 core, 2 soft" (`FACE_ALT`,
kinds always in `ALT_KIND_ORDER`, never sorted by count). v1 configs render byte-identically to 3.0.0. A v2 SVG with
eleven image layers stays under 8 KB.

### soul3d/ (shared 3D Soul, phone and public Galaxy)

```js
import { loadSoulModels, loadSoulDecor, buildSoulRig, createSoulCardStage, LOOK } from '/packages/ui/soul3d/index.js';
```

One code path draws the 3D Soul on the phone (reveal, Float) and on the public Galaxy (Float entrance, settled
impostors), so both show the same decorated Soul. Three.js is always passed in.

| Module | Holds |
|---|---|
| `tint.js` | pure colour maths: `tintGradientColors(mask, heights, gradient)` (sRGB mix of the gradient over height, then linear, then the D-27 mask mixes) and the v1 palette tint |
| `placement.js` | pure: `charmPlacement(slot, thickness)` -> position, basis, scale for a charm at a slot |
| `model.js` | baseline GLB load and cache (`loadSoulModel(s)`), with per-vertex heights |
| `decor.js` | `loadSoulDecor(mods, config)` never rejects: each charm and the face kit load (or are skipped) on their own; a failed URL waits 60 s before a retry |
| `figure.js`, `rig.js`, `badge.js` | `buildSoulFigure` / `buildSoulRig`: body, die-cut hull, orb glow, charms at their slots, face kit at identity, the medallion badge, the phone's 3/4 rest pose |
| `studio.js`, `card.js` | `LOOK` (AgX, exposure, lights, studio reflections) and a square card stage the Galaxy uses to bake impostors |

The phone's `apps/employee-mobile/src/scene/soul-model.js` and `soul-tint.js` are thin re-exports of these modules.

### doodads.js

```js
import { doodadSvg, doodadSpriteSheet, DOODAD_NAMES } from '/packages/ui/doodads.js';
host.innerHTML = doodadSvg('rocket', 48);                                  // standalone decorative <svg> (aria-hidden)
// or, from the generated sprite sheet (same drawing):
// <svg width="48" height="48" aria-hidden="true"><use href="/assets/scene/doodads.svg#doodad-planet"/></svg>
```

`DOODAD_NAMES` = `rocket`, `ufo`, `planet`, `comet`, `star`, `medallion`; 64 x 64 viewBox, flat 2-tone sticker fills with
a white die-cut outline, no text, never over text. `doodadSvg` returns `null` for an unknown name so callers can fall
through. `assets/scene/doodads.svg` is generated from this module by `tools/assets/build-scene.js` (manifest id
`scene_doodads`), so the procedural fallback and the sprite never drift. Placement rules (public periphery on high
tier only, one rocket by the join orb, one planet on waiting screens, none on stage) are the apps' responsibility.

## Tests

```sh
node --test packages/ui/test
for f in packages/ui/*.js; do node --check "$f"; done
```
