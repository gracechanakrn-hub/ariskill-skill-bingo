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
import taxonomy from '../../packages/skill-master/data/taxonomy.json' with { type: 'json' };
import realtime from '../../contracts/realtime-events.json' with { type: 'json' };
import { splitCharmSlots, faceForMatches, countSkillKinds, pickPlate, pickEyes, pickTopper, CHARM_BY_ID, CELLS, GRID, LINE_MASKS, REQUIRED_SELECTIONS, MIN_DRAW_FOR_BINGO, POOL_MINIMUM } from '../../packages/game-rules/src/index.js';

export { CELLS, GRID, LINE_MASKS, REQUIRED_SELECTIONS, MIN_DRAW_FOR_BINGO, POOL_MINIMUM };

export const SKILL_MASTER = skillMaster;
export const SKILLS_BY_ID = new Map(skillMaster.skills.map(s => [s.id, s]));
export const ACTIVE_IDS = skillMaster.skills.filter(s => s.status === 'active').map(s => s.id).sort();
/** Draw-eligible skills (D-33, BR-08): every active skill, whatever its kind. */
export const ELIGIBLE_IDS = ACTIVE_IDS;
export const CORE_CRITICAL_IDS = skillMaster.skills.filter(s => s.status === 'active' && (s.isCore || s.isCritical)).map(s => s.id).sort();
export const OPTIONAL_IDS = skillMaster.skills.filter(s => s.status === 'active' && !(s.isCore || s.isCritical)).map(s => s.id).sort();
// D-55: platform and role choices come from taxonomy.json (independent lists); ROLES lists the Skill Matrix roles first.
export const ALL_ROLES = taxonomy.roles.map(r => ({ id: r.id, name: r.name, inMatrix: !!r.matrixRoleId }));
export const ROLES = [...ALL_ROLES.filter(r => r.inMatrix), ...ALL_ROLES.filter(r => !r.inMatrix)];
export const PLATFORMS = taxonomy.platforms.map(p => ({ id: p.id, name: p.name }));
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
export function roleAt(i = 0) { const matrix = ROLES.filter(r => r.inMatrix); const r = matrix[i % matrix.length]; return { platformId: PLATFORMS[i % PLATFORMS.length].id, roleId: r.id }; }
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
/** Start now (D-53): REGISTRATION_OPEN -> PLAYING in one confirmed step; returns the started round summary. */
export async function startRound(t, round) {
  const s = await command(t, round.roundId, 'round.start_now', round.version, { confirmed: true });
  return s.round;
}
export async function drawUntilEnd(t, round, max = 200) {
  const results = []; let cur = round;
  for (let i = 0; i < max && cur.state === 'PLAYING'; i++) { const r = await command(t, cur.roundId, 'round.draw.next', cur.version); results.push(r); cur = r.round; }
  return { results, round: cur };
}
/** Close a WINNER round through the result-window timer (server clock is moved, then released). */
export function closeByTimer(t, roundId) {
  const r = t.db.get('SELECT published_at, ended_at, result_window_seconds FROM rounds WHERE id = ?', roundId);
  const base = Date.parse(r.published_at ?? r.ended_at);
  t.clock.set(base + (r.result_window_seconds + 5) * 1000);
  try { t.app.timers.tick(); } finally { t.clock.unfreeze(); }
  return t.db.get('SELECT state, version FROM rounds WHERE id = ?', roundId);
}
/** 16 skills drawn from `from` starting at offset; `exclude` removes ids that must not appear (e.g. names matching a privacy regex). */
export function boardSet(offset, n = REQUIRED_SELECTIONS, from = ELIGIBLE_IDS, exclude = []) { const ex = new Set(exclude); return from.filter(id => !ex.has(id)).slice(offset, offset + n); }
/**
 * Test-only: narrow a started round's pool snapshot. Every active skill on an active board is draw-eligible (D-33), so a
 * pool smaller than a board (or one that avoids a board) can only be set up by editing the snapshot the draws read.
 */
export function setPool(t, roundId, skillIds) { t.db.run('UPDATE rounds SET pool_json = ? WHERE id = ?', JSON.stringify([...skillIds].sort()), roundId); }

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

// ---- Soul decorations (D-29 contract 1.1.0, D-31 contract 1.2.0) -----------------------------------------------------
/** SoulConfig v3 keys from contracts/realtime-events.json, sorted: a new Soul's served config carries exactly these, on every screen. */
export const SOUL_CONFIG_KEYS = Object.keys(realtime.shapes.SoulConfig).sort();
/** The same keys written out (contract 1.2.0), so a contract change cannot silently change what the privacy tests accept. */
export const SOUL_CONFIG_V3_KEYS = ['catalog', 'charms', 'constellation', 'driftPhase', 'eyes', 'face', 'glow', 'gradient', 'plate', 'seed', 'topper', 'version'];
const SKILL_STRINGS = new Set(skillMaster.skills.flatMap(s => [s.id, s.name]));
const stringsIn = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(stringsIn) : []);
/** Strings anywhere in a Soul config that are a skill id or a skill name (public and stage must see none). */
export function skillStringsIn(config) { return stringsIn(config).filter(s => SKILL_STRINGS.has(s)); }
/** Charm count per kind of a config's charms. */
export function charmSplit(charms) { const out = { core: 0, technical: 0, soft: 0 }; for (const id of charms) out[CHARM_BY_ID.get(id).kind] += 1; return out; }
/** The decoration a finished ParticipantBoard must get: split from the selected skills' kinds, face from the matched tiles' kinds. */
export function expectedDecor(board) {
  const kinds = (ids) => countSkillKinds(ids.map(id => SKILLS_BY_ID.get(id)?.kind));
  const matched = new Set(board.matchedPositions);
  return { split: splitCharmSlots(kinds(board.selectedSkillIds)), face: faceForMatches(kinds(board.cells.filter(c => matched.has(c.position)).map(c => c.skillId))) };
}
/** The v3 face plate, eyes and antenna charm a config must carry: picked from its seed (and, for the topper, its charms) only. */
export function expectedSeedPicks(config) { return { plate: pickPlate(config.seed), eyes: pickEyes(config.seed), topper: pickTopper(config.seed, config.charms) }; }
