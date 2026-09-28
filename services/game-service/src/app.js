// HTTP router and handlers implementing contracts/api-contract.yaml exactly (paths, methods, auth, envelopes, error codes).
// createApp({ db, clock, config, log }) returns { server, close, ... } without listening, so tests bind to port 0.
import http from 'node:http';
import { URL } from 'node:url';
import { ApiError, isApiError } from './errors.js';
import { newId, sha256Hex } from './ids.js';
import { principalOf, clientIp, currentJoinLink, createRateLimits } from './auth.js';
import { createGame } from './game.js';
import { createParticipants } from './participants.js';
import { createProjections } from './projections.js';
import { createHub } from './sse.js';
import { createTimers } from './timers.js';
import { runRetention } from './retention.js';
import { serveStatic, INDEX_HTML } from './static.js';
import { createLogger } from './log.js';
import { json } from './db.js';
import { getEvent } from './queries.js';

export const API_PREFIX = '/api/v1';
export const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:",  // connect-src blob: lets GLTFLoader decode embedded GLB textures (D-41)
  'Cache-Control': 'no-store',
});

export function createApp({ db, clock, config, log = createLogger(config.logLevel) }) {
  // Wire the modules; the hub is referenced lazily to break the game -> hub -> projections -> game cycle.
  const hubRef = { publish: (rows) => hub.publish(rows), counts: () => hub.counts() };
  const game = createGame({ db, clock, config, log, hub: hubRef });
  const participants = createParticipants({ db, clock, config, game, log });
  const projections = createProjections({ db, clock, config, game, participants, hub: hubRef });
  const hub = createHub({ db, config, clock, projections, log });
  const timers = createTimers({ db, game, clock, config, log, projections });
  const limits = createRateLimits(config, clock);

  // ---- helpers -------------------------------------------------------------------------------------------------
  function send(res, status, body, extraHeaders = {}) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, ...extraHeaders });
    res.end(data);
  }
  function ok(ctx, data, status = 200) { return { status, body: { ...data, correlationId: ctx.correlationId, serverTime: clock.iso() } }; }
  function readBody(req) {
    return new Promise((resolvePromise, reject) => {
      const chunks = []; let size = 0;
      let rejected = false;
      req.on('data', (c) => { if (rejected) return; size += c.length; if (size > config.jsonBodyLimitBytes) { rejected = true; chunks.length = 0; req.resume(); reject(new ApiError('VALIDATION', `request body exceeds ${config.jsonBodyLimitBytes} bytes`)); return; } chunks.push(c); });
      req.on('end', () => resolvePromise(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  function requireEvent(eventId) { const e = getEvent(db, eventId); if (!e) throw new ApiError('NOT_FOUND', 'event not found'); return e; }
  function sinceOf(req, url) {
    const raw = url.searchParams.get('since') ?? req.headers['last-event-id'] ?? null;
    if (raw === null || raw === '') return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 0) throw new ApiError('VALIDATION', 'since must be a non-negative integer');
    return n;
  }
  function intParam(v, d, max) { const n = Number.parseInt(v ?? '', 10); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : d; }

  // ---- routes ----------------------------------------------------------------------------------------------------
  const routes = [
    { m: 'GET', p: /^\/time$/, auth: 'none', h: (ctx) => ok(ctx, { epochMs: clock.now() }) },
    { m: 'GET', p: /^\/events\/([^/]+)\/snapshot$/, auth: 'none', h: (ctx) => { requireEvent(ctx.params[0]); return ok(ctx, projections.publicSnapshot(ctx.params[0])); } },
    { m: 'GET', p: /^\/events\/([^/]+)\/join-info$/, auth: 'none', h: (ctx) => { requireEvent(ctx.params[0]); return ok(ctx, currentJoinLink(db, config, clock, ctx.params[0])); } },
    { m: 'GET', p: /^\/events\/([^/]+)\/stream$/, auth: 'none', sse: 'public' },
    { m: 'POST', p: /^\/events\/([^/]+)\/session$/, auth: 'none', limit: 'session', h: (ctx) => ok(ctx, participants.createSession(ctx.params[0], ctx.body, ctx.meta), 201) },

    { m: 'GET', p: /^\/me$/, auth: 'participant', h: (ctx) => ok(ctx, projections.participantSnapshot(ctx.principal.participant)) },
    { m: 'GET', p: /^\/me\/stream$/, auth: 'participant', sse: 'participant' },
    { m: 'GET', p: /^\/taxonomy$/, auth: 'participant', h: (ctx) => ok(ctx, participants.taxonomy()) },
    { m: 'POST', p: /^\/me\/profile$/, auth: 'participant', limit: 'commands', h: (ctx) => ok(ctx, participants.setProfile(ctx.principal.participant, ctx.body, ctx.meta)) },
    { m: 'GET', p: /^\/skills\/discovery$/, auth: 'participant', limit: 'discovery', h: (ctx) => ok(ctx, participants.discovery(ctx.principal.participant, Object.fromEntries(ctx.url.searchParams))) },
    { m: 'PUT', p: /^\/me\/board\/selections$/, auth: 'participant', limit: 'commands', idem: true, h: (ctx) => { const r = participants.saveSelections(ctx.principal.participant, ctx.body, ctx.meta); return ok(ctx, { board: r.board, resultingVersion: r.resultingVersion, ...(r.notice ? { notice: r.notice } : {}) }); } },
    { m: 'POST', p: /^\/me\/board\/finalize$/, auth: 'participant', limit: 'commands', idem: true, h: (ctx) => ok(ctx, participants.finalize(ctx.principal.participant, ctx.body, ctx.meta)) },
    { m: 'GET', p: /^\/me\/insight$/, auth: 'participant', h: (ctx) => ok(ctx, participants.insight(ctx.principal.participant)) },
    { m: 'POST', p: /^\/me\/soul\/float$/, auth: 'participant', limit: 'commands', idem: true, h: (ctx) => ok(ctx, participants.float(ctx.principal.participant, ctx.body, ctx.meta)) },

    { m: 'GET', p: /^\/admin\/events\/([^/]+)\/snapshot$/, auth: 'admin', h: (ctx) => { requireEvent(ctx.params[0]); return ok(ctx, projections.adminSnapshot(ctx.params[0])); } },
    { m: 'GET', p: /^\/admin\/events\/([^/]+)\/stream$/, auth: 'admin', sse: 'admin' },
    { m: 'POST', p: /^\/admin\/events\/([^/]+)\/rounds$/, auth: 'admin', limit: 'commands', idem: true, h: (ctx) => ok(ctx, game.createRound(ctx.params[0], ctx.body, ctx.meta), 201) },
    { m: 'POST', p: /^\/admin\/rounds\/([^/]+)\/commands$/, auth: 'admin', limit: 'commands', idem: true, h: (ctx) => ok(ctx, game.command(ctx.params[0], ctx.body, ctx.meta)) },
    // D-53: delete a round (any state) and, outside production, clear every round, player and Soul of an event
    { m: 'DELETE', p: /^\/admin\/rounds\/([^/]+)$/, auth: 'admin', limit: 'commands', idem: true, h: (ctx) => ok(ctx, game.deleteRound(ctx.params[0], ctx.meta)) },
    { m: 'POST', p: /^\/admin\/events\/([^/]+)\/test-mode$/, auth: 'admin', limit: 'commands', idem: true, h: (ctx) => { requireEvent(ctx.params[0]); return ok(ctx, game.setTestMode(ctx.params[0], ctx.body, ctx.meta)); } },
    { m: 'POST', p: /^\/admin\/events\/([^/]+)\/reset$/, auth: 'admin', limit: 'commands', idem: true, h: (ctx) => { requireEvent(ctx.params[0]); if (ctx.body?.confirm !== 'DELETE') throw new ApiError('VALIDATION', 'type DELETE to confirm'); return ok(ctx, game.resetEvent(ctx.params[0], ctx.meta)); } },
    { m: 'GET', p: /^\/admin\/events\/([^/]+)\/insights$/, auth: 'admin', h: (ctx) => { requireEvent(ctx.params[0]); return ok(ctx, projections.insights(ctx.params[0])); } },
    { m: 'GET', p: /^\/admin\/events\/([^/]+)\/audit$/, auth: 'admin', h: (ctx) => {
      requireEvent(ctx.params[0]);
      const roundId = ctx.url.searchParams.get('roundId'); const limit = intParam(ctx.url.searchParams.get('limit'), 200, 2000);
      const rows = roundId
        ? db.all('SELECT * FROM audit_log WHERE event_id = ? AND round_id = ? ORDER BY id DESC LIMIT ?', ctx.params[0], roundId, limit)
        : db.all('SELECT * FROM audit_log WHERE event_id = ? ORDER BY id DESC LIMIT ?', ctx.params[0], limit);
      return ok(ctx, { entries: rows.map(a => ({ id: a.id, at: a.at, actor: a.actor, action: a.action, target: a.target, roundId: a.round_id, expectedVersion: a.expected_version, actualVersion: a.actual_version, outcome: a.outcome, correlationId: a.correlation_id, commandId: a.command_id, details: json.parse(a.details_json) })) });
    } },
    { m: 'GET', p: /^\/admin\/events\/([^/]+)\/join-link$/, auth: 'admin', h: (ctx) => { requireEvent(ctx.params[0]); return ok(ctx, currentJoinLink(db, config, clock, ctx.params[0])); } },

    { m: 'GET', p: /^\/stage\/events\/([^/]+)\/snapshot$/, auth: 'stage', h: (ctx) => { requireEvent(ctx.params[0]); return ok(ctx, projections.stageSnapshot(ctx.params[0])); } },
    { m: 'GET', p: /^\/stage\/events\/([^/]+)\/stream$/, auth: 'stage', sse: 'stage' },
  ];

  function authorize(route, principal, ctx) {
    const need = route.auth;
    if (need === 'none') return;
    const kind = principal.kind;
    const reject = (code) => {
      if (need !== 'participant') game.audit({ eventId: ctx.params?.[0]?.startsWith('evt_') ? ctx.params[0] : null, actor: principal.actor, action: 'auth.reject', target: ctx.url.pathname, outcome: 'rejected', correlationId: ctx.correlationId, details: { required: need, presented: kind, method: ctx.req.method } });
      throw new ApiError(code);
    };
    if (kind === 'anonymous' || kind === 'invalid') reject('UNAUTHORIZED');
    if (need === 'participant' && kind !== 'participant') reject('FORBIDDEN');
    if (need === 'admin' && kind !== 'admin') reject('FORBIDDEN');
    if (need === 'stage' && !['admin', 'stage'].includes(kind)) reject('FORBIDDEN');
  }

  // ---- request pipeline -----------------------------------------------------------------------------------------------
  async function handle(req, res) {
    const correlationId = typeof req.headers['x-correlation-id'] === 'string' && req.headers['x-correlation-id'].length <= 64 ? req.headers['x-correlation-id'] : newId('correlation');
    const url = new URL(req.url, 'http://localhost');
    const started = Date.now();
    let status = 200;
    try {
      if (!url.pathname.startsWith(API_PREFIX + '/') && url.pathname !== API_PREFIX) {
        if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) { res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : INDEX_HTML); return; }
        if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url.pathname, { headers: SECURITY_HEADERS })) return;
        status = 404; send(res, 404, new ApiError('NOT_FOUND', 'not found').toBody(correlationId, clock.iso())); return;
      }
      const path = url.pathname.slice(API_PREFIX.length) || '/';
      let route = null, params = null, methodMismatch = false;
      for (const r of routes) { const m = r.p.exec(path); if (m) { if (r.m === req.method) { route = r; params = m.slice(1); break; } methodMismatch = true; } }
      if (!route) throw new ApiError('NOT_FOUND', methodMismatch ? 'method not allowed for this path' : 'unknown operation');
      const ctx = { req, res, url, params, correlationId, principal: null, body: null, meta: null };
      ctx.principal = principalOf(req, db, config, clock);
      authorize(route, ctx.principal, ctx);
      if (route.limit && !limits[route.limit].take(route.limit === 'session' ? clientIp(req, config) : ctx.principal.actor)) throw new ApiError('RATE_LIMITED', 'too many requests');
      if (route.sse) {
        const eventId = route.sse === 'participant' ? ctx.principal.participant.event_id : params[0];
        requireEvent(eventId);
        hub.subscribe(req, res, { audience: route.sse, eventId, participantId: ctx.principal.participant?.id ?? null, since: sinceOf(req, url) });
        log.info('sse subscribed', { correlationId, eventId, audience: route.sse });
        return;
      }
      let raw = Buffer.alloc(0);
      if (req.method === 'POST' || req.method === 'PUT') {
        try { raw = await readBody(req); } catch (e) { res.setHeader('Connection', 'close'); throw e; }
        if (raw.length) { try { ctx.body = JSON.parse(raw.toString('utf8')); } catch { throw new ApiError('VALIDATION', 'body must be valid JSON'); } }
        if (ctx.body !== null && (typeof ctx.body !== 'object' || Array.isArray(ctx.body))) throw new ApiError('VALIDATION', 'body must be a JSON object');
        ctx.body ??= {};
      }
      ctx.meta = { actor: ctx.principal.actor, correlationId, commandId: null, ip: clientIp(req, config) };
      let result;
      if (route.idem) {
        const key = req.headers['idempotency-key'];
        if (typeof key !== 'string' || !key.trim() || key.length > 200) throw new ApiError('VALIDATION', 'Idempotency-Key header required');
        ctx.meta.commandId = key;
        const hash = sha256Hex(raw);
        const nowIso = clock.iso();
        const stored = db.get('SELECT * FROM idempotency WHERE key = ? AND actor = ? AND expires_at > ?', key, ctx.principal.actor, nowIso);
        if (stored) {
          if (stored.body_hash !== hash) throw new ApiError('IDEMPOTENCY_MISMATCH');
          status = stored.status; send(res, stored.status, json.parse(stored.response_json), { 'Idempotent-Replay': 'true' }); return;
        }
        result = route.h(ctx);
        db.run('INSERT OR REPLACE INTO idempotency(key, actor, body_hash, status, response_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', key, ctx.principal.actor, hash, result.status, JSON.stringify(result.body), nowIso, new Date(clock.now() + config.idempotencyTtlHours * 3600 * 1000).toISOString());
      } else {
        result = route.h(ctx);
      }
      status = result.status; send(res, result.status, result.body);
    } catch (e) {
      const err = isApiError(e) ? e : null;
      if (!err) log.error('unhandled error', { correlationId, path: url.pathname, error: e?.stack ?? String(e) });
      status = err ? err.http : 500;
      if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
      send(res, status, (err ?? new ApiError('INTERNAL')).toBody(correlationId, clock.iso()));
    } finally {
      if (url.pathname.startsWith(API_PREFIX)) log.info('request', { correlationId, method: req.method, path: url.pathname, status, ms: Date.now() - started });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res).catch((e) => { log.error('handler crashed', { error: e?.stack ?? String(e) }); try { res.destroy(); } catch { /* ignore */ } }); });
  server.keepAliveTimeout = 65000;

  function ensureDefaultEvent() { return game.ensureEvent(config.defaultEventId, config.defaultEventName); }
  function listen(port = config.port, host = config.host) { return new Promise((resolvePromise) => server.listen(port, host, () => resolvePromise(server.address()))); }
  function close() {
    timers.stop(); hub.close();
    return new Promise((resolvePromise) => { server.closeAllConnections?.(); server.close(() => resolvePromise()); });
  }
  return { server, db, clock, config, log, game, participants, projections, hub, timers, limits, listen, close, ensureDefaultEvent, runRetention: (nowMs) => runRetention({ db, config, clock, projections, log }, nowMs) };
}
