// Shared test harness: in-memory SQLite, port 0, injectable clock, tiny HTTP client and scenario builders.
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createClock } from '../src/clock.js';
import { createLogger } from '../src/log.js';
import { createApp } from '../src/app.js';
import { SKILL_MASTER, ROLE_SKILL_LEVELS, ROLES, PLATFORMS } from '../src/skills.js';
import { signJoinToken } from '../src/auth.js';
import { CELLS, GRID, LINE_MASKS, REQUIRED_SELECTIONS } from '../../../packages/game-rules/src/index.js';

export { CELLS, GRID, LINE_MASKS, REQUIRED_SELECTIONS };
/** Draw-eligible skills (D-33, BR-08): every active skill, whatever its kind. */
export const ELIGIBLE_IDS = SKILL_MASTER.skills.filter(s => s.status === 'active').map(s => s.id).sort();
export const CORE_CRITICAL_IDS = SKILL_MASTER.skills.filter(s => s.status === 'active' && (s.isCore || s.isCritical)).map(s => s.id).sort();
export const OPTIONAL_IDS = SKILL_MASTER.skills.filter(s => s.status === 'active' && !(s.isCore || s.isCritical)).map(s => s.id).sort();
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
// D-55: platform and role are independent; pair them by index. The roles used by default are in the Skill Matrix.
export const MATRIX_ROLES = ROLES.filter(r => r.inMatrix);
export function defaultRole(i = 0) { const r = MATRIX_ROLES[i % MATRIX_ROLES.length]; return { platformId: PLATFORMS[i % PLATFORMS.length].id, roleId: r.id }; }
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
/** Start a round with Start now (D-53: REGISTRATION_OPEN -> PLAYING in one step); returns the started round summary. */
export async function startRound(t, round) {
  const s = await command(t, round.roundId, 'round.start_now', round.version, { confirmed: true });
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
/** A 16-skill selection set starting at `offset` (with a deterministic seed identical sets get identical layouts). */
export function boardSet(offset, n = REQUIRED_SELECTIONS, from = ELIGIBLE_IDS) { return from.slice(offset, offset + n); }
export function roleSkills(roleId) { return [...(ROLE_SKILL_LEVELS.get(roleId) ?? new Map()).keys()]; }

/** Re-lay a READY/LOCKED_ACTIVE board's cells in the given order (test-only: forces a known line layout for boundary tests). */
export function arrangeCells(db, boardId, orderedSkillIds) {
  if (orderedSkillIds.length !== CELLS) throw new Error(`need ${CELLS}`);
  db.run('DELETE FROM board_cells WHERE board_id = ?', boardId);
  orderedSkillIds.forEach((s, i) => db.run('INSERT INTO board_cells(board_id, position, skill_id) VALUES (?, ?, ?)', boardId, i, s));
}
/**
 * Test-only: narrow a round's pool snapshot to `skillIds`. Every active skill on an active board is draw-eligible (D-33),
 * so a round whose draws must be known exactly (BR-12 boundary, co-winners, closest-line fallback) pins its pool here. Call it after
 * round.start_now when fewer than POOL_MINIMUM skills are wanted (start checks the snapshot; draws read it each time).
 */
export function setPool(db, roundId, skillIds) { db.run('UPDATE rounds SET pool_json = ? WHERE id = ?', JSON.stringify([...skillIds].sort()), roundId); }
/** A layout with `placed` ({position: skillId}) and the remaining cells filled in order from `fill`. */
export function layoutWith(placed, fill) { const out = []; let k = 0; for (let i = 0; i < CELLS; i++) out.push(placed[i] ?? fill[k++]); return out; }
/**
 * Build a PLAYING round whose pool is exactly the GRID line skills of `p`'s board placed on `linePositions` (row 0 by
 * default), so draw GRID - 1 completes no bingo and draw GRID (= MIN_DRAW_FOR_BINGO) completes the line.
 * extraPlayers: [{ join, linePositions? }] -> each gets the same line skills at its own positions plus unique fill skills.
 */
export async function lineScenario(t, { extraPlayers = [], linePositions = LINE_MASKS[0].positions } = {}) {
  const round = await createRound(t);
  const lineSkills = ELIGIBLE_IDS.slice(0, GRID);
  const set = boardSet(0);
  const p = await join(t, { displayName: 'Line Player' });
  const b = await readyBoard(t, p, set);
  const at = (positions) => Object.fromEntries(positions.map((pos, i) => [pos, lineSkills[i]]));
  arrangeCells(t.db, b.boardId, layoutWith(at(linePositions), set.slice(GRID)));
  const others = [];
  for (const [i, o] of extraPlayers.entries()) {
    const fill = ELIGIBLE_IDS.slice(100 + i * CELLS, 100 + i * CELLS + CELLS - GRID);
    const op = await join(t, o.join ?? {});
    const ob = await readyBoard(t, op, o.linePositions ? [...lineSkills, ...fill] : boardSet(100 + i * CELLS));
    if (o.linePositions) arrangeCells(t.db, ob.boardId, layoutWith(at(o.linePositions), fill));
    others.push({ p: op, b: ob });
  }
  const started = await startRound(t, round);
  setPool(t.db, round.roundId, lineSkills);
  return { round: started, p, b, lineSkills, others };
}
