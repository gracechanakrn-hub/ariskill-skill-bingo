// Independent QA harness (stage 6.7). Boots the game service in-process (createApp, in-memory SQLite, port 0) so every
// suite runs isolated from other agents' servers; talks to it only through HTTP + SSE like a real client would.
// Deliberately does not import services/game-service/test/helpers.js: QA evidence must not depend on the authors' harness.
import { loadConfig } from '../../services/game-service/src/config.js';
import { openDatabase } from '../../services/game-service/src/db.js';
import { createClock } from '../../services/game-service/src/clock.js';
import { createLogger } from '../../services/game-service/src/log.js';
import { createApp } from '../../services/game-service/src/app.js';
import { signJoinToken } from '../../services/game-service/src/auth.js';
import skillMaster from '../../packages/skill-master/data/skill-master.json' with { type: 'json' };

export const SKILL_MASTER = skillMaster;
export const SKILLS_BY_ID = new Map(skillMaster.skills.map(s => [s.id, s]));
export const ACTIVE_IDS = skillMaster.skills.filter(s => s.status === 'active').map(s => s.id).sort();
export const ELIGIBLE_IDS = skillMaster.skills.filter(s => s.status === 'active' && (s.isCore || s.isCritical)).map(s => s.id).sort();
export const OPTIONAL_IDS = skillMaster.skills.filter(s => s.status === 'active' && !(s.isCore || s.isCritical)).map(s => s.id).sort();
export const ROLES = skillMaster.roles.map(r => ({ id: r.id, name: r.name, platformId: r.platformId }));
export const PLATFORMS = skillMaster.platforms.map(p => ({ id: p.id, name: p.name }));
export const DEFAULT_EVENT_ID = 'evt_qa';

let keyCounter = 0;
export const nextKey = (p = 'qa') => `${p}-${Date.now().toString(36)}-${(keyCounter++).toString(36)}`;
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Start an in-process server. Overrides go to loadConfig (e.g. rngSeed, rateLimits, extra: { sseReplayLimit }).
 * Returns { app, db, clock, config, baseUrl, api, eventId, joinToken(), admin, stage, close() }.
 */
export async function startServer({ eventId = DEFAULT_EVENT_ID, eventName = 'QA Event', ...overrides } = {}) {
  const config = loadConfig({}, {
    env: 'test', dbPath: ':memory:', port: 0, host: '127.0.0.1',
    adminToken: 'qa-admin-token', stageToken: 'qa-stage-token', joinSecret: 'qa-join-secret', sessionSecret: 'qa-session-secret',
    rateLimits: { commandsPerSec: 100000, sessionPerMin: 1000000, discoveryPerSec: 100000 },
    sseHeartbeatMs: 250, logLevel: 'silent', defaultEventId: eventId, defaultEventName: eventName,
    ...overrides,
  });
  const db = openDatabase(':memory:');
  const clock = createClock();
  const app = createApp({ db, clock, config, log: createLogger('silent') });
  app.game.ensureEvent(eventId, eventName);
  const addr = await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const api = makeApi(baseUrl);
  const joinToken = (expOffsetSec = 3600, forEvent = eventId) => signJoinToken(config.joinSecret, forEvent, Math.floor(clock.now() / 1000) + expOffsetSec);
  return { app, db, clock, config, baseUrl, api, eventId, joinToken, admin: config.adminToken, stage: config.stageToken, close: async () => { clock.unfreeze(); await app.close(); db.close(); } };
}

export function makeApi(baseUrl) {
  async function call(method, path, { body, token, key, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = `Bearer ${token}`;
    if (key) h['Idempotency-Key'] = key;
    const res = await fetch(baseUrl + '/api/v1' + path, { method, headers: h, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  return {
    call,
    get: (path, token, headers) => call('GET', path, { token, headers }),
    post: (path, body, token, key = nextKey(), headers) => call('POST', path, { body, token, key, headers }),
    put: (path, body, token, key = nextKey(), headers) => call('PUT', path, { body, token, key, headers }),
  };
}

// ---- scenario builders (all through the public HTTP API) ------------------------------------------------------
export async function createRound(t, { title = 'QA Round', lockAtMs = 10 * 60 * 1000, resultWindowSeconds = 12, open = true } = {}) {
  const r = await t.api.post(`/admin/events/${t.eventId}/rounds`, { title, lockAt: new Date(t.clock.now() + lockAtMs).toISOString(), resultWindowSeconds }, t.admin);
  if (r.status !== 201) throw new Error(`createRound failed: ${r.status} ${JSON.stringify(r.body)}`);
  let round = r.body.round;
  if (open) round = (await command(t, round.roundId, 'round.registration.open', round.version)).round;
  return round;
}
export async function tryCommand(t, roundId, cmd, expectedVersion, params = {}, key = nextKey('cmd')) {
  return t.api.post(`/admin/rounds/${roundId}/commands`, { command: cmd, expectedVersion, params }, t.admin, key);
}
export async function command(t, roundId, cmd, expectedVersion, params = {}, key = nextKey('cmd')) {
  const r = await tryCommand(t, roundId, cmd, expectedVersion, params, key);
  if (r.status !== 200) { const e = new Error(`${cmd} failed: ${r.status} ${JSON.stringify(r.body)}`); e.response = r; throw e; }
  return r.body;
}
export function roleAt(i = 0) { const r = ROLES[i % ROLES.length]; return { platformId: r.platformId, roleId: r.id }; }
export async function join(t, { employeeRef = `emp-${nextKey()}`, displayName = 'QA Player', consent = true, profile = roleAt(0), token = null } = {}) {
  const s = await t.api.post(`/events/${t.eventId}/session`, { joinToken: token ?? t.joinToken(), employeeRef, displayName, consentPublicName: consent });
  if (s.status !== 201) { const e = new Error(`session failed: ${s.status} ${JSON.stringify(s.body)}`); e.response = s; throw e; }
  const p = { token: s.body.sessionToken, participantId: s.body.participantId, employeeRef, displayName, consent };
  if (profile) { const r = await t.api.post('/me/profile', profile, p.token); if (r.status !== 200) throw new Error(`profile failed: ${JSON.stringify(r.body)}`); }
  return p;
}
export async function me(t, p) { const r = await t.api.get('/me', p.token); if (r.status !== 200) throw new Error(`/me failed: ${r.status}`); return r.body; }
export async function saveBoard(t, p, skillIds, boardVersion = null, key = nextKey('save')) {
  if (boardVersion === null) boardVersion = (await me(t, p)).board?.version ?? 0;
  return t.api.put('/me/board/selections', { skillIds, boardVersion }, p.token, key);
}
export async function finalizeBoard(t, p, key = nextKey('fin')) {
  const m = await me(t, p);
  return t.api.post('/me/board/finalize', { boardVersion: m.board?.version ?? 0 }, p.token, key);
}
export async function readyBoard(t, p, skillIds) {
  const s = await saveBoard(t, p, skillIds); if (s.status !== 200) throw new Error(`save failed: ${s.status} ${JSON.stringify(s.body)}`);
  const f = await finalizeBoard(t, p); if (f.status !== 200) throw new Error(`finalize failed: ${f.status} ${JSON.stringify(f.body)}`);
  return f.body.board;
}
export async function startRound(t, round) {
  const l = await command(t, round.roundId, 'round.lock', round.version);
  const s = await command(t, round.roundId, 'round.start', l.resultingVersion);
  return s.round;
}
export async function drawUntilEnd(t, round, max = 200) {
  const results = []; let cur = round;
  for (let i = 0; i < max && cur.state === 'PLAYING'; i++) { const r = await command(t, cur.roundId, 'round.draw.next', cur.version); results.push(r); cur = r.round; }
  return { results, round: cur };
}
/** Close a WINNER/EXHAUSTED round through the result-window timer (server clock is moved, then released). */
export function closeByTimer(t, roundId) {
  const r = t.db.get('SELECT published_at, ended_at, result_window_seconds FROM rounds WHERE id = ?', roundId);
  const base = Date.parse(r.published_at ?? r.ended_at);
  t.clock.set(base + (r.result_window_seconds + 5) * 1000);
  try { t.app.timers.tick(); } finally { t.clock.unfreeze(); }
  return t.db.get('SELECT state, version FROM rounds WHERE id = ?', roundId);
}
/** 25 skills drawn from `from` starting at offset; `exclude` removes ids that must not appear (e.g. names matching a privacy regex). */
export function boardSet(offset, n = 25, from = ELIGIBLE_IDS, exclude = []) { const ex = new Set(exclude); return from.filter(id => !ex.has(id)).slice(offset, offset + n); }
export function mixedSet(eligibleCount, eligibleOffset = 0, optionalOffset = 0) {
  return [...ELIGIBLE_IDS.slice(eligibleOffset, eligibleOffset + eligibleCount), ...OPTIONAL_IDS.slice(optionalOffset, optionalOffset + (25 - eligibleCount))];
}

// ---- SSE ---------------------------------------------------------------------------------------------------------
export function parseSseFrame(frame) {
  const ev = { id: null, event: null, data: null, comment: null };
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) { ev.comment = line.slice(1).trim(); continue; }
    const i = line.indexOf(':'); if (i < 0) continue;
    const f = line.slice(0, i), v = line.slice(i + 1).trim();
    if (f === 'id') ev.id = Number(v); else if (f === 'event') ev.event = v; else if (f === 'data') { try { ev.data = JSON.parse(v); } catch { ev.data = v; } }
  }
  return ev.event || ev.comment ? ev : null;
}
/**
 * Open a persistent SSE stream (fetch + ReadableStream). Returns a handle:
 *   { status, contentType, events (typed only), comments, lastId, close(), waitFor(pred, timeoutMs), onEvent(fn), done }
 * Dropping the connection (close()) simulates a client-side network loss; resume by opening a new stream with `since`
 * or the Last-Event-ID header.
 */
export async function openStream(baseUrl, path, { token = null, since = null, lastEventId = null, headers = {} } = {}) {
  const h = { Accept: 'text/event-stream', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (lastEventId !== null) h['Last-Event-ID'] = String(lastEventId);
  const url = baseUrl + '/api/v1' + path + (since !== null ? `${path.includes('?') ? '&' : '?'}since=${since}` : '');
  const ac = new AbortController();
  const res = await fetch(url, { headers: h, signal: ac.signal });
  const handle = { status: res.status, contentType: res.headers.get('content-type'), events: [], comments: [], lastId: null, closed: false, listeners: new Set(), waiters: new Set() };
  handle.close = () => { if (handle.closed) return; handle.closed = true; ac.abort(); };
  handle.onEvent = (fn) => { handle.listeners.add(fn); return () => handle.listeners.delete(fn); };
  handle.waitFor = (pred, timeoutMs = 3000, what = 'event') => new Promise((resolve, reject) => {
    if (pred(handle.events)) return resolve(handle.events);
    const timer = setTimeout(() => { handle.waiters.delete(w); reject(new Error(`timeout waiting for ${what} on ${path} (received ${handle.events.map(e => e.event).join(',') || 'nothing'})`)); }, timeoutMs);
    const w = () => { if (pred(handle.events)) { clearTimeout(timer); handle.waiters.delete(w); resolve(handle.events); } };
    handle.waiters.add(w);
  });
  if (!res.ok || !res.body) { handle.done = Promise.resolve(); handle.closed = true; try { handle.errorBody = JSON.parse(await res.text()); } catch { /* ignore */ } return handle; }
  handle.done = (async () => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const ev = parseSseFrame(frame); if (!ev) continue;
          if (ev.event) { handle.events.push(ev); if (ev.id !== null) handle.lastId = ev.id; for (const fn of handle.listeners) fn(ev); for (const w of [...handle.waiters]) w(); }
          else handle.comments.push(ev.comment);
        }
      }
    } catch { /* aborted */ } finally { handle.closed = true; }
  })();
  return handle;
}
/** Convenience: read a stream for a while (or until `until` matches) then close it. */
export async function readSse(baseUrl, path, { token = null, since = null, lastEventId = null, until = null, timeoutMs = 1200 } = {}) {
  const s = await openStream(baseUrl, path, { token, since, lastEventId });
  if (s.status !== 200) return { status: s.status, events: [], comments: [], body: s.errorBody ?? null, contentType: s.contentType };
  if (until) { try { await s.waitFor(until, timeoutMs, 'until-predicate'); } catch { /* timeout -> return what we have */ } } else await sleep(timeoutMs);
  s.close(); await s.done;
  return { status: s.status, events: s.events, comments: s.comments, contentType: s.contentType, lastId: s.lastId };
}

// ---- privacy scanning (independent of the service implementation) --------------------------------------------------
const SKIP_WORDS = new Set(['any', 'other', 'aggregate']);
/** Keys named in a contracts/projections/*.json forbidden list (first word of each phrase when it looks like a key). */
export function forbiddenKeysFromContract(contract) {
  const out = new Set();
  for (const phrase of contract.forbidden ?? []) { const w = String(phrase).split(/\s+/)[0]; if (/^[a-z][A-Za-z_]+$/.test(w) && !SKIP_WORDS.has(w)) out.add(w); }
  return [...out];
}
/** Recursively find keys of `obj` that are in `keys`. Returns json paths. */
export function findKeys(obj, keys) {
  const set = new Set(keys); const found = [];
  const walk = (v, path) => { if (!v || typeof v !== 'object') return; if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; } for (const k of Object.keys(v)) { if (set.has(k)) found.push(`${path}.${k}`); walk(v[k], `${path}.${k}`); } };
  walk(obj, '$'); return found;
}
export const PRIVACY_TEXT_REGEX = /employee|email|selectedSkillIds|floatToken|sessionToken/i;
/** Skill ids whose id or name would trip PRIVACY_TEXT_REGEX (e.g. "Employee Experience") - excluded from privacy-scan boards. */
export const REGEX_TRIPPING_SKILL_IDS = skillMaster.skills.filter(s => PRIVACY_TEXT_REGEX.test(`${s.id} ${s.name} ${s.domain ?? ''} ${s.cluster ?? ''}`)).map(s => s.id);
export function privacyTextHits(obj) { const text = JSON.stringify(obj); const m = text.match(new RegExp(PRIVACY_TEXT_REGEX.source, 'gi')); return m ? [...new Set(m)] : []; }
