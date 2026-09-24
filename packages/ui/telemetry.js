// @ariskill/ui telemetry.js - privacy-safe client telemetry sink.
// v1 is NOT a network sink (docs/ux/canonical-flow.md section 6): events go to console.debug when the page is
// opened with ?debug=1 (or telemetry debug is enabled programmatically), otherwise to a no-op.
// Properties that could identify a person are dropped before any sink sees them (requirement 15.2, 16).

export const FORBIDDEN_PROPS = Object.freeze([
  'employeeRef', 'email', 'selectedSkillIds', // named by the workflow brief
  'displayName', 'sessionToken', 'joinToken', 'floatToken', 'authorization', 'participantId', // defence in depth
]);
const FORBIDDEN = new Set(FORBIDDEN_PROPS.map((k) => k.toLowerCase()));

/** Known event names (docs/ux/canonical-flow.md section 6). Unknown names are still accepted. */
export const EVENTS = Object.freeze([
  'client.join_started', 'client.profile_completed', 'client.selection_progress', 'client.board_finalized',
  'client.reconnect', 'client.renderer_mode', 'client.float_result',
]);

export function isDebugEnabled() {
  try {
    if (globalThis.__ARISKILL_DEBUG__ === true) return true;
    if (typeof location !== 'undefined' && location.search) return /[?&]debug=1(&|$)/.test(location.search);
  } catch { /* ignore */ }
  return false;
}

/**
 * createTelemetry({ sink, debug }) -> { track, setSink, sanitize }
 *  sink(event, props, meta) receives sanitized props only.
 */
export function createTelemetry({ sink = null, debug = null, now = () => Date.now() } = {}) {
  let currentSink = sink;
  function sanitize(props) {
    const clean = {}; const dropped = [];
    if (props && typeof props === 'object') {
      for (const [k, v] of Object.entries(props)) {
        if (FORBIDDEN.has(String(k).toLowerCase()) || looksLikeEmail(v)) { dropped.push(k); continue; }
        clean[k] = scalar(v);
      }
    }
    return { props: clean, dropped };
  }
  function track(event, props = {}) {
    const name = String(event || '').trim();
    if (!name) return { accepted: false, reason: 'no-event', dropped: [] };
    const { props: clean, dropped } = sanitize(props);
    const record = { event: name, props: clean, at: now() };
    const dbg = debug === null ? isDebugEnabled() : Boolean(debug);
    if (dropped.length && dbg && typeof console !== 'undefined') console.warn(`[telemetry] dropped private props on ${name}:`, dropped.join(', '));
    try {
      if (typeof currentSink === 'function') currentSink(name, clean, record);
      else if (dbg && typeof console !== 'undefined' && console.debug) console.debug('[telemetry]', name, clean);
    } catch { /* telemetry never breaks the app */ }
    return { accepted: true, event: name, props: clean, dropped };
  }
  function setSink(fn) { currentSink = typeof fn === 'function' ? fn : null; }
  return { track, setSink, sanitize };
}

function looksLikeEmail(v) { return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function scalar(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) : v;
  if (Array.isArray(v)) return v.length; // never ship lists (e.g. skill ids); keep the count only
  return '[object]';
}

const defaultTelemetry = createTelemetry();
/** track(event, props) - module-level convenience bound to the default (console/no-op) sink. */
export const track = defaultTelemetry.track;
export const setSink = defaultTelemetry.setSink;
export const sanitize = defaultTelemetry.sanitize;
