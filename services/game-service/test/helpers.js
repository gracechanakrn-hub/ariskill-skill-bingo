// Shared test harness: in-memory SQLite, port 0, injectable clock, tiny HTTP client and scenario builders.
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createClock } from '../src/clock.js';
import { createLogger } from '../src/log.js';
import { createApp } from '../src/app.js';
import { SKILL_MASTER, ROLE_SKILL_LEVELS, ROLES } from '../src/skills.js';
import { signJoinToken } from '../src/auth.js';

export const ELIGIBLE_IDS = SKILL_MASTER.skills.filter(s => s.isCore || s.isCritical).map(s => s.id).sort();
export const OPTIONAL_IDS = SKILL_MASTER.skills.filter(s => !(s.isCore || s.isCritical)).map(s => s.id).sort();
export const ALL_IDS = SKILL_MASTER.skills.map(s => s.id).sort();
export const EVENT_ID = 'evt_test';
let keyCounter = 0;
export const nextKey = (p = 'k') => `${p}-${Date.now().toString(36)}-${(keyCounter++).toString(36)}`;

export async function startServer(overrides = {}) {
  const config = loadConfig({}, { env: 'test', dbPath: ':memory:', port: 0, host: '127.0.0.1', adminToken: 'test-admin', stageToken: 'test-stage', joinSecret: 'js', sessionSecret: 'ss', rateLimits: { commandsPerSec: 10000, sessionPerMin: 100000, discoveryPerSec: 10000 }, sseHeartbeatMs: 200, logLevel: 'silent', ...overrides });
  const db = openDatabase(':memory:');
  const clock = createClock();
  const app = createApp({ db, clock, config, log: createLogger('silent') });
  app.game.ensureEvent(EVENT_ID, 'Test Event');
  const addr = await app.listen(0, '127.0.0.1');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const api = makeApi(baseUrl);
  const joinToken = () => signJoinToken(config.joinSecret, EVENT_ID, Math.floor(clock.now() / 1000) + 3600);
  const t = { app, db, clock, config, baseUrl, api, joinToken, admin: config.adminToken, stage: config.stageToken, close: async () => { await app.close(); db.close(); } };
  return t;
}

export function makeApi(baseUrl) {
  async function call(method, path, { body, token, key, headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = `Bearer ${token}`;
    if (key) h['Idempotency-Key'] = key;
    const res = await fetch(baseUrl + '/api/v1' + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
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

// ---- scenario builders -------------------------------------------------------------------------------------
export async function createRound(t, { title = 'Round 1', lockAtMs = 10 * 60 * 1000, resultWindowSeconds = 12, open = true } = {}) {
  const r = await t.api.post(`/admin/events/${EVENT_ID}/rounds`, { title, lockAt: new Date(t.clock.now() + lockAtMs).toISOString(), resultWindowSeconds }, t.admin);
  if (r.status !== 201) throw new Error(`createRound failed: ${JSON.stringify(r.body)}`);
  let round = r.body.round;
  if (open) round = (await command(t, round.roundId, 'round.registration.open', round.version)).round;
  return round;
}
export async function command(t, roundId, cmd, expectedVersion, params = {}, key = nextKey('cmd')) {
  const r = await t.api.post(`/admin/rounds/${roundId}/commands`, { command: cmd, expectedVersion, params }, t.admin, key);
  if (r.status !== 200) { const e = new Error(`${cmd} failed: ${r.status} ${JSON.stringify(r.body)}`); e.response = r; throw e; }
  return r.body;
}
export async function tryCommand(t, roundId, cmd, expectedVersion, params = {}, key = nextKey('cmd')) {
  return t.api.post(`/admin/rounds/${roundId}/commands`, { command: cmd, expectedVersion, params }, t.admin, key);
}
export function defaultRole(i = 0) { const r = ROLES[i % ROLES.length]; return { platformId: r.platformId, roleId: r.id }; }
export async function join(t, { employeeRef = `emp-${nextKey()}`, displayName = 'Test Player', consent = true, profile = defaultRole(0) } = {}) {
  const s = await t.api.post(`/events/${EVENT_ID}/session`, { joinToken: t.joinToken(), employeeRef, displayName, consentPublicName: consent });
  if (s.status !== 201) throw new Error(`session failed: ${JSON.stringify(s.body)}`);
  const p = { token: s.body.sessionToken, participantId: s.body.participantId, employeeRef, displayName };
  if (profile) { const r = await t.api.post('/me/profile', profile, p.token); if (r.status !== 200) throw new Error(`profile failed: ${JSON.stringify(r.body)}`); }
  return p;
}
export async function saveBoard(t, p, skillIds, boardVersion = null) {
  if (boardVersion === null) { const me = await t.api.get('/me', p.token); boardVersion = me.body.board?.version ?? 0; }
  return t.api.put('/me/board/selections', { skillIds, boardVersion }, p.token);
}
export async function finalizeBoard(t, p) {
  const me = await t.api.get('/me', p.token);
  return t.api.post('/me/board/finalize', { boardVersion: me.body.board.version }, p.token);
}
export async function readyBoard(t, p, skillIds) {
  const s = await saveBoard(t, p, skillIds); if (s.status !== 200) throw new Error(`save failed: ${JSON.stringify(s.body)}`);
  const f = await finalizeBoard(t, p); if (f.status !== 200) throw new Error(`finalize failed: ${JSON.stringify(f.body)}`);
  return f.body.board;
}
/** Lock + start a round; returns the started round summary. */
export async function startRound(t, round) {
  const l = await command(t, round.roundId, 'round.lock', round.version);
  const s = await command(t, round.roundId, 'round.start', l.resultingVersion);
  return s.round;
}
/** Draw until the round leaves PLAYING (or max draws). Returns { results, round }. */
export async function drawUntilEnd(t, round, max = 200) {
  const results = []; let cur = round;
  for (let i = 0; i < max && cur.state === 'PLAYING'; i++) { const r = await command(t, cur.roundId, 'round.draw.next', cur.version); results.push(r); cur = r.round; }
  return { results, round: cur };
}
/** Read SSE frames from a stream for a while. Returns parsed events array; stops after idleMs without data or when predicate matches. */
export async function readSse(baseUrl, path, { token = null, since = null, headers = {}, until = null, timeoutMs = 1500 } = {}) {
  const h = { Accept: 'text/event-stream', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  const url = baseUrl + '/api/v1' + path + (since !== null ? `?since=${since}` : '');
  const ac = new AbortController();
  const res = await fetch(url, { headers: h, signal: ac.signal });
  const events = []; let buf = '';
  const reader = res.body.getReader(); const dec = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([reader.read(), new Promise(r => setTimeout(() => r({ done: false, value: null }), Math.max(1, deadline - Date.now())))]);
      if (chunk.done) break;
      if (!chunk.value) break;
      buf += dec.decode(chunk.value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const ev = parseFrame(frame); if (ev) events.push(ev);
      }
      if (until && until(events)) break;
    }
  } finally { ac.abort(); }
  return { status: res.status, events, contentType: res.headers.get('content-type') };
}
function parseFrame(frame) {
  const ev = { id: null, event: null, data: null, comment: null };
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) { ev.comment = line.slice(1).trim(); continue; }
    const i = line.indexOf(':'); if (i < 0) continue;
    const f = line.slice(0, i), v = line.slice(i + 1).trim();
    if (f === 'id') ev.id = Number(v); else if (f === 'event') ev.event = v; else if (f === 'data') ev.data = JSON.parse(v);
  }
  return ev.event || ev.comment ? ev : null;
}
/** Boards that share row 0 (positions 0-4) cannot be hand-built (server shuffles); with a deterministic seed identical sets get identical layouts. */
export function boardSet(offset, n = 25, from = ELIGIBLE_IDS) { return from.slice(offset, offset + n); }
export function roleSkills(roleId) { return [...(ROLE_SKILL_LEVELS.get(roleId) ?? new Map()).keys()]; }

/** Re-lay a READY/LOCKED_ACTIVE board's cells in the given order (test-only: forces a known line layout for boundary tests). */
export function arrangeCells(db, boardId, orderedSkillIds) {
  if (orderedSkillIds.length !== 25) throw new Error('need 25');
  db.run('DELETE FROM board_cells WHERE board_id = ?', boardId);
  orderedSkillIds.forEach((s, i) => db.run('INSERT INTO board_cells(board_id, position, skill_id) VALUES (?, ?, ?)', boardId, i, s));
}
/** A 25-skill set with exactly `eligibleCount` draw-eligible skills (rest optional). */
export function mixedSet(eligibleCount, eligibleOffset = 0, optionalOffset = 0) {
  return [...ELIGIBLE_IDS.slice(eligibleOffset, eligibleOffset + eligibleCount), ...OPTIONAL_IDS.slice(optionalOffset, optionalOffset + (25 - eligibleCount))];
}
/** Build a PLAYING round whose pool is exactly the 5 eligible skills of `p`'s board placed in row 0 (positions 0-4). */
export async function fiveSkillLineScenario(t, { extraPlayers = [], linePositions = [0, 1, 2, 3, 4] } = {}) {
  const round = await createRound(t);
  const eligible5 = ELIGIBLE_IDS.slice(0, 5);
  const set = mixedSet(5);
  const p = await join(t, { displayName: 'Line Player' });
  const b = await readyBoard(t, p, set);
  const layout = new Array(25).fill(null); const opt = OPTIONAL_IDS.slice(0, 20);
  linePositions.forEach((pos, i) => { layout[pos] = eligible5[i]; });
  let k = 0; for (let i = 0; i < 25; i++) if (!layout[i]) layout[i] = opt[k++];
  arrangeCells(t.db, b.boardId, layout);
  const others = [];
  for (const o of extraPlayers) { const op = await join(t, o.join ?? {}); const ob = await readyBoard(t, op, o.set ?? mixedSet(5, 0, 20)); if (o.layout) arrangeCells(t.db, ob.boardId, o.layout(eligible5)); others.push({ p: op, b: ob }); }
  const started = await startRound(t, round);
  return { round: started, p, b, eligible5, others };
}
