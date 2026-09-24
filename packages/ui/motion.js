// AriSkill Skill Bingo - motion runtime (packages/ui/motion.js)
// Browser ESM, Node-importable (no top-level window/document access).
// Spec: docs/motion/motion-spec.md. Tokens: tokens/motion.json (MOTION below mirrors it 1:1;
// packages/ui/test/motion.test.js asserts deep equality, so edit both together).
//
// Hard rules implemented here (requirement 11, contracts/realtime-events.json clientRules):
//   - animation never blocks or mutates canonical state: every helper returns immediately and only
//     toggles CSS classes / custom properties on the elements it is given;
//   - replayed / snapshot-derived events never celebrate (createCelebrationGuard);
//   - coordinated cues are keyed to server timestamps through an injected clock (scheduleAt).

export const MOTION = Object.freeze({
  "version": "1.0.0",
  "durations": {
    "instant": 0,
    "fast": 120,
    "base": 180,
    "medium": 280,
    "slow": 400,
    "reveal": 800,
    "soulReveal": 2000,
    "celebrate": 1000
  },
  "easing": {
    "standard": "cubic-bezier(0.2,0,0,1)",
    "emphasized": "cubic-bezier(0.3,0,0,1)",
    "exit": "cubic-bezier(0.4,0,1,1)",
    "linear": "linear"
  },
  "delays": {
    "matchAfterDraw": 200,
    "lineTraceAfterMatch": 350,
    "winnerTextReady": 280,
    "floatPublicOffset": 300,
    "reducedFade": 0
  },
  "stagger": {
    "gridCell": 20,
    "lineCell": 120
  },
  "interactions": {
    "addSkill": {
      "class": "m-add",
      "duration": "fast..base",
      "range": [
        120,
        180
      ],
      "ms": 150,
      "easing": "standard",
      "reduced": "fade"
    },
    "removeSkill": {
      "class": "m-remove",
      "duration": "fast..base",
      "range": [
        120,
        180
      ],
      "ms": 150,
      "easing": "exit",
      "reduced": "fade"
    },
    "boardComplete": {
      "class": "m-board-complete",
      "max": 800,
      "ms": 780,
      "cellMs": 300,
      "staggerMs": 20,
      "cells": 25,
      "easing": "standard",
      "reduced": "static-glow"
    },
    "boardLock": {
      "class": "m-lock",
      "max": 400,
      "ms": 400,
      "easing": "emphasized",
      "reduced": "static-border"
    },
    "drawArrival": {
      "class": "m-draw-arrival",
      "ms": 400,
      "easing": "emphasized",
      "matchDelayMs": 200,
      "reduced": "fade"
    },
    "match": {
      "class": "m-match",
      "range": [
        200,
        350
      ],
      "ms": 300,
      "easing": "standard",
      "persistClass": "is-matched",
      "reduced": "static"
    },
    "bingoLine": {
      "class": "m-line-trace",
      "once": true,
      "ms": 800,
      "cellStepMs": 120,
      "cellMs": 320,
      "easing": "standard",
      "persistClass": "is-on-line",
      "reduced": "static-outline"
    },
    "winnerView": {
      "class": "m-winner-burst",
      "readableWithin": 1000,
      "ms": 1000,
      "textReadyMs": 280,
      "easing": "emphasized",
      "reduced": "fade"
    },
    "soulReveal": {
      "class": "m-soul-reveal",
      "range": [
        1500,
        2500
      ],
      "ms": 2000,
      "stages": {
        "glow": [
          0,
          700
        ],
        "silhouette": [
          600,
          1400
        ],
        "features": [
          1300,
          2000
        ]
      },
      "easing": "emphasized",
      "skippableAfterFirstView": true,
      "reduced": "fade"
    },
    "float": {
      "class": "m-float-countdown",
      "launchClass": "m-float-launch",
      "countdown": [
        3,
        2,
        1
      ],
      "stepMs": 1000,
      "tickMs": 600,
      "launch": {
        "ms": 600,
        "easing": "exit",
        "publicOffsetMs": 300
      },
      "reduced": "fade"
    },
    "galaxyEntrance": {
      "class": "m-entrance-arc",
      "arcMs": 1800,
      "pulseMs": 400,
      "settleMs": 600,
      "easing": "emphasized",
      "reduced": "fade"
    },
    "orbit": {
      "class": "m-orbit",
      "maxAngularSpeedDegPerSec": 6,
      "maxCameraDriftPxPerSec": 12,
      "maxCameraYawDeg": 8,
      "periodMs": 60000,
      "reduced": "static"
    },
    "pulseSoft": {
      "class": "m-pulse-soft",
      "periodMs": 2400,
      "opacityRange": [
        0.82,
        1
      ],
      "reduced": "static"
    },
    "fade": {
      "class": "m-fade",
      "ms": 180,
      "easing": "standard",
      "reduced": "fade"
    }
  },
  "flashSafety": {
    "maxFlashesPerSecond": 3,
    "maxLuminanceDeltaPercent": 10,
    "maxFlashAreaPercentOfViewport": 25,
    "noSaturatedRedFlash": true
  },
  "budgets": {
    "frameMsMobile": 16.7,
    "frameMsVenue": 16.7,
    "minFpsVenue": 30,
    "maxConcurrentAnimatedElementsMobile": 30,
    "maxConcurrentAnimatedElementsVenue": 200,
    "compositorOnlyProperties": [
      "transform",
      "opacity"
    ]
  }
});

export const REDUCED_MOTION_ATTR = 'data-reduced-motion';
export const REDUCED_MOTION_STORAGE_KEY = 'ariskill.reducedMotion';

/** Ordered cell positions (row-major 0..24) for each of the 12 Bingo lines (contracts/bingo-rules.json). */
export const LINE_POSITIONS = Object.freeze({
  'row-0': Object.freeze([0, 1, 2, 3, 4]),
  'row-1': Object.freeze([5, 6, 7, 8, 9]),
  'row-2': Object.freeze([10, 11, 12, 13, 14]),
  'row-3': Object.freeze([15, 16, 17, 18, 19]),
  'row-4': Object.freeze([20, 21, 22, 23, 24]),
  'col-0': Object.freeze([0, 5, 10, 15, 20]),
  'col-1': Object.freeze([1, 6, 11, 16, 21]),
  'col-2': Object.freeze([2, 7, 12, 17, 22]),
  'col-3': Object.freeze([3, 8, 13, 18, 23]),
  'col-4': Object.freeze([4, 9, 14, 19, 24]),
  'diag-main': Object.freeze([0, 6, 12, 18, 24]),
  'diag-anti': Object.freeze([4, 8, 12, 16, 20]),
});

/**
 * Event type -> surface -> motion binding. Used by the app agents to wire realtime events to classes.
 * `celebrate: true` bindings must pass through createCelebrationGuard().shouldCelebrate first.
 * `sound` is the audio cue id (docs/audio); sound never carries required information.
 */
export const EVENT_MOTION = Object.freeze({
  'board.ready':          { participant: { className: 'm-board-complete', fn: 'staggerIndex+animateOnce', reduced: 'static-glow', sound: 'registration_ready', celebrate: true } },
  'board.locked_active':  { participant: { className: 'm-lock', fn: 'animateOnce', reduced: 'static-border', sound: null, celebrate: false } },
  'round.locked':         { participant: { className: 'm-lock', fn: 'animateOnce', reduced: 'static-border', sound: null, celebrate: false },
                            public: { className: 'm-fade', fn: 'animateOnce', reduced: 'fade', sound: null, celebrate: false } },
  'round.started':        { participant: { className: 'm-fade', fn: 'animateOnce', reduced: 'fade', sound: null, celebrate: false },
                            public: { className: 'm-fade', fn: 'animateOnce', reduced: 'fade', sound: null, celebrate: false } },
  'draw.accepted':        { participant: { className: 'm-draw-arrival', then: 'm-match (+is-matched)', fn: 'animateOnce, applyMatch', reduced: 'fade / static', sound: 'draw_reveal, cell_match, draw5_unlock (drawNumber===5)', celebrate: true },
                            public: { className: 'm-draw-arrival', fn: 'animateOnce', reduced: 'fade', sound: 'draw_reveal', celebrate: true },
                            stage: { className: 'm-fade', fn: 'animateOnce', reduced: 'fade', sound: null, celebrate: false } },
  'draw.match_counts_updated': { public: { className: 'm-fade', fn: 'animateOnce', reduced: 'fade', sound: null, celebrate: false },
                            stage: { className: 'm-fade', fn: 'animateOnce', reduced: 'fade', sound: null, celebrate: false } },
  'bingo.detected':       { participant: { className: 'm-line-trace', fn: 'lineTracePositions+animateOnce', reduced: 'static-outline', sound: 'bingo', celebrate: true },
                            public: { className: 'm-winner-burst', fn: 'animateOnce', reduced: 'fade', sound: 'bingo', celebrate: true } },
  'result.published':     { participant: { className: 'm-winner-burst', fn: 'animateOnce', reduced: 'fade', sound: null, celebrate: true },
                            public: { className: 'm-winner-burst', fn: 'animateOnce', reduced: 'fade', sound: null, celebrate: true },
                            stage: { className: 'm-fade', fn: 'animateOnce', reduced: 'fade', sound: null, celebrate: false } },
  'soul.created':         { participant: { className: 'm-soul-reveal', fn: 'animateOnce', reduced: 'fade', sound: 'soul_reveal', celebrate: true } },
  'soul.float_accepted':  { participant: { className: 'm-float-launch', fn: 'scheduleAt+animateOnce', reduced: 'fade', sound: 'float_launch', celebrate: true },
                            public: { className: 'm-entrance-arc', fn: 'scheduleAt+animateOnce', reduced: 'fade', sound: 'float_launch', celebrate: true } },
  'system.snapshot_required': { all: { className: null, fn: 'guard.markSnapshotApplied', reduced: null, sound: null, celebrate: false } },
});

// ---------------------------------------------------------------------------------------------
// Environment helpers (safe in Node: no top-level access, every call guards for globals)
// ---------------------------------------------------------------------------------------------

function doc() { return typeof document !== 'undefined' ? document : null; }
function win() { return typeof window !== 'undefined' ? window : null; }

/** True when the user or the OS asked for reduced motion. Explicit attribute wins over media query. */
export function prefersReducedMotion() {
  const d = doc();
  const attr = d && d.documentElement ? d.documentElement.getAttribute(REDUCED_MOTION_ATTR) : null;
  if (attr === 'true') return true;
  if (attr === 'false') return false;
  const w = win();
  try {
    return Boolean(w && typeof w.matchMedia === 'function' && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch { return false; }
}

/** Sets data-reduced-motion on <html> and persists the choice (best effort). Returns the applied value. */
export function setReducedMotion(enabled) {
  const value = enabled ? 'true' : 'false';
  const d = doc();
  if (d && d.documentElement) d.documentElement.setAttribute(REDUCED_MOTION_ATTR, value);
  try { const w = win(); if (w && w.localStorage) w.localStorage.setItem(REDUCED_MOTION_STORAGE_KEY, value); } catch { /* storage unavailable */ }
  return enabled;
}

/** Restores a persisted choice (if any) onto <html>. Call once at app start. Returns the restored value or null. */
export function restoreReducedMotion() {
  try {
    const w = win();
    const stored = w && w.localStorage ? w.localStorage.getItem(REDUCED_MOTION_STORAGE_KEY) : null;
    if (stored === 'true' || stored === 'false') { setReducedMotion(stored === 'true'); return stored === 'true'; }
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------------------------
// One-shot class animations
// ---------------------------------------------------------------------------------------------

const defaultTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};

/**
 * Adds `className` to `el`, removes it on `animationend` (from the element itself) or after
 * `durationMs` (+ grace) as a fallback. Never blocks; state changes must be applied by the caller
 * BEFORE calling this. Returns a cancel function that removes the class and listeners immediately.
 *
 * Under reduced motion the class is still applied: motion.css swaps it for a fade/static end state.
 */
export function animateOnce(el, className, opts = {}) {
  const { durationMs = MOTION.durations.slow, onEnd, graceMs = 50, timers = defaultTimers } = opts;
  if (!el || !className) return () => {};
  let done = false;
  let timeoutId = null;
  const cleanup = (reason) => {
    if (done) return;
    done = true;
    if (timeoutId !== null) timers.clearTimeout(timeoutId);
    if (typeof el.removeEventListener === 'function') el.removeEventListener('animationend', onAnimEnd);
    el.classList.remove(className);
    if (typeof onEnd === 'function') { try { onEnd(reason); } catch { /* listener error must not break the caller */ } }
  };
  function onAnimEnd(ev) { if (!ev || ev.target === el || ev.target === undefined) cleanup('animationend'); }
  el.classList.add(className);
  if (typeof el.addEventListener === 'function') el.addEventListener('animationend', onAnimEnd);
  timeoutId = timers.setTimeout(() => cleanup('timeout'), Math.max(0, durationMs) + graceMs);
  return () => cleanup('cancel');
}

/**
 * Applies the persistent matched state (`is-matched`) immediately and, only when `celebrate` is true,
 * plays the short `.m-match` pulse. The final state never depends on the animation.
 */
export function applyMatch(cellEl, { celebrate = false, timers } = {}) {
  if (!cellEl) return () => {};
  cellEl.classList.add(MOTION.interactions.match.persistClass);
  if (!celebrate) return () => {};
  return animateOnce(cellEl, MOTION.interactions.match.class, { durationMs: MOTION.interactions.match.ms, timers });
}

/** Sets `--i` (0-based index) on each child of `cells` (an element with children, or an iterable of elements). */
export function staggerIndex(cells) {
  const list = cells && cells.children ? Array.from(cells.children) : Array.from(cells || []);
  list.forEach((c, i) => { if (c && c.style && typeof c.style.setProperty === 'function') c.style.setProperty('--i', String(i)); });
  return list.length;
}

/** Ordered cell positions to trace for a line id; [] for an unknown id. */
export function lineTracePositions(lineId) {
  const p = LINE_POSITIONS[lineId];
  return p ? p.slice() : [];
}

/**
 * Marks the cells of `lineId` with `is-on-line` and `--line-i` (0..4 trace order) so `.m-line-trace`
 * on the grid traces the line once. `cellsByPosition` is an array/NodeList indexed by position 0..24.
 * Returns the positions marked.
 */
export function markLine(cellsByPosition, lineId) {
  const positions = lineTracePositions(lineId);
  positions.forEach((pos, i) => {
    const c = cellsByPosition && cellsByPosition[pos];
    if (!c) return;
    c.classList.add(MOTION.interactions.bingoLine.persistClass);
    if (c.style && typeof c.style.setProperty === 'function') c.style.setProperty('--line-i', String(i));
  });
  return positions;
}

// ---------------------------------------------------------------------------------------------
// Celebration guard: once per key, live events only, never from replay/snapshot
// ---------------------------------------------------------------------------------------------

/**
 * @param {{ getConnectionEpoch: () => number, maxKeys?: number }} deps
 *   getConnectionEpoch: the sse-client's `connectionEpoch` counter (increments on every (re)connect).
 */
export function createCelebrationGuard({ getConnectionEpoch, maxKeys = 2000 } = {}) {
  if (typeof getConnectionEpoch !== 'function') throw new TypeError('createCelebrationGuard requires getConnectionEpoch()');
  const seen = new Set();
  let snapshotSequence = -Infinity;
  let lastDecision = null;

  function remember(key) {
    seen.add(key);
    if (seen.size > maxKeys) { const first = seen.values().next().value; seen.delete(first); }
  }

  return {
    /**
     * @param {string} eventKey  stable key, e.g. `${type}:${eventId}` or `float:${soulId}`
     * @param {{ epoch?: number, connectionEpoch?: number, sequence?: number, replay?: boolean }} meta
     *   epoch (alias connectionEpoch, matching sse-client onEvent meta) = connection epoch the event arrived in;
     *   sequence = envelope sequence; replay = true for SSE resume replays / HTTP replays.
     * @returns {boolean} true exactly once per key, and only for a live event of the current epoch that is
     *   newer than the last applied snapshot.
     */
    shouldCelebrate(eventKey, meta = {}) {
      const { sequence, replay } = meta;
      const epoch = meta.epoch !== undefined ? meta.epoch : meta.connectionEpoch;
      let reason = 'ok';
      if (typeof eventKey !== 'string' || !eventKey) reason = 'no-key';
      else if (seen.has(eventKey)) reason = 'duplicate';
      else if (replay === true) reason = 'replay';
      else if (epoch === undefined || epoch !== getConnectionEpoch()) reason = 'stale-epoch';
      else if (Number.isFinite(sequence) && sequence <= snapshotSequence) reason = 'snapshot-covered';
      lastDecision = { eventKey, reason };
      if (reason !== 'ok') { if (reason !== 'no-key') remember(eventKey); return false; }
      remember(eventKey);
      return true;
    },
    /** Records that a snapshot up to `sequence` was applied: everything <= it renders final state, no celebration. */
    markSnapshotApplied(sequence) {
      if (Number.isFinite(sequence) && sequence > snapshotSequence) snapshotSequence = sequence;
      return snapshotSequence;
    },
    /** Forgets all keys (e.g. when a new round starts and keys are scoped per round). */
    reset() { seen.clear(); snapshotSequence = -Infinity; lastDecision = null; },
    snapshotSequence: () => snapshotSequence,
    lastDecision: () => lastDecision,
    size: () => seen.size,
  };
}

// ---------------------------------------------------------------------------------------------
// Server-timestamp synchronized cues
// ---------------------------------------------------------------------------------------------

/** Converts an ISO string or epoch ms number to epoch ms (NaN if unparseable). */
export function toEpochMs(serverIsoOrEpochMs) {
  if (typeof serverIsoOrEpochMs === 'number') return serverIsoOrEpochMs;
  if (serverIsoOrEpochMs instanceof Date) return serverIsoOrEpochMs.getTime();
  return Date.parse(String(serverIsoOrEpochMs));
}

/**
 * Runs `fn({ lateMs })` when the server-corrected clock reaches `at`. `clockNow()` must return
 * server-aligned epoch ms (client now + server offset). If the time has already passed, `fn` runs on the
 * next tick with `lateMs > 0` (never silently dropped: the visual must still reach its final state).
 * Returns a cancel function.
 */
export function scheduleAt(serverIsoOrEpochMs, clockNow, fn, { timers = defaultTimers } = {}) {
  const at = toEpochMs(serverIsoOrEpochMs);
  if (!Number.isFinite(at) || typeof clockNow !== 'function' || typeof fn !== 'function') return () => {};
  const delay = Math.max(0, at - clockNow());
  let cancelled = false;
  const id = timers.setTimeout(() => {
    if (cancelled) return;
    const lateMs = Math.max(0, clockNow() - at);
    fn({ lateMs, at });
  }, delay);
  return () => { cancelled = true; timers.clearTimeout(id); };
}

/**
 * Synchronized Float countdown: onTick(3) at startAt, onTick(2) at +stepMs, onTick(1) at +2*stepMs,
 * onLaunch() at +3*stepMs. If the clock is already past some ticks (late arrival / reconnect), only the
 * current digit is shown immediately and earlier ones are skipped; a fully elapsed countdown launches at once.
 * Returns a cancel function. Never blocks; game state (the Float command) is issued by the caller.
 */
export function runFloatCountdown({ startAt, clockNow, onTick, onLaunch, stepMs = MOTION.interactions.float.stepMs, countdown = MOTION.interactions.float.countdown, timers = defaultTimers } = {}) {
  const start = toEpochMs(startAt);
  if (!Number.isFinite(start) || typeof clockNow !== 'function') return () => {};
  const cancels = [];
  const now = clockNow();
  const tickTimes = countdown.map((n, i) => ({ n, at: start + i * stepMs }));
  const launchAt = start + countdown.length * stepMs;
  // Latest tick that is already due: show it immediately; skip older ones.
  const due = tickTimes.filter(t => t.at <= now);
  const pending = tickTimes.filter(t => t.at > now);
  if (launchAt > now) {
    if (due.length && typeof onTick === 'function') {
      const cur = due[due.length - 1];
      cancels.push(scheduleAt(now, clockNow, () => onTick(cur.n, { at: cur.at }), { timers }));
    }
    for (const t of pending) cancels.push(scheduleAt(t.at, clockNow, () => { if (typeof onTick === 'function') onTick(t.n, { at: t.at }); }, { timers }));
  }
  cancels.push(scheduleAt(launchAt, clockNow, (info) => { if (typeof onLaunch === 'function') onLaunch(info); }, { timers }));
  return () => { for (const c of cancels) c(); };
}

/** Server-aligned clock factory: `makeServerClock(offsetMs)` -> () => Date.now() + offsetMs. */
export function makeServerClock(offsetMs = 0, nowFn = () => Date.now()) {
  return () => nowFn() + offsetMs;
}

/**
 * Public entrance timing for a `soul.float_accepted` event: entrance starts at
 * `entrance.enteredAt (or occurredAt) + delays.floatPublicOffset` on every surface so phone launch and Galaxy
 * entrance line up on the server clock.
 */
export function entranceStartMs(envelopeOrEntrance, offsetMs = MOTION.delays.floatPublicOffset) {
  const e = envelopeOrEntrance || {};
  const base = e.enteredAt || (e.payload && e.payload.entrance && e.payload.entrance.enteredAt) || e.occurredAt;
  const ms = toEpochMs(base);
  return Number.isFinite(ms) ? ms + offsetMs : NaN;
}

/** Sets `--from-x/--from-y` (px) on a Soul element for `.m-entrance-arc` given the configured edge. */
export function setEntranceEdge(el, edge, { width = 1000, height = 600 } = {}) {
  if (!el || !el.style || typeof el.style.setProperty !== 'function') return;
  const map = { left: [-width * 0.6, 0], right: [width * 0.6, 0], top: [0, -height * 0.6], bottom: [0, height * 0.6] };
  const [x, y] = map[edge] || map.left;
  el.style.setProperty('--from-x', `${Math.round(x)}px`);
  el.style.setProperty('--from-y', `${Math.round(y)}px`);
}

/** CSS custom property name for a duration token, e.g. cssVar('fast') -> '--motion-fast'. */
export function cssVar(token) { return `--motion-${token.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}`; }
