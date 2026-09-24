// Authentication and authorization primitives (D-07, requirement 15.2):
// - event join tokens: HMAC-SHA256 signed, short-lived, rotated
// - participant sessions: random bearer tokens stored as SHA-256 hashes with 24 h expiry
// - admin / stage bearer tokens from configuration, compared timing-safely
// - float tokens: random, hashed for lookup, plaintext encrypted at rest so only the owner projection can re-show it
// - in-memory token-bucket rate limiter
import { createHmac, timingSafeEqual, randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { ApiError } from './errors.js';
import { sha256Hex, randomToken, newId } from './ids.js';

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) { timingSafeEqual(ba, ba); return false; }
  return timingSafeEqual(ba, bb);
}

// ---- join tokens ------------------------------------------------------------
// Format: v1.<eventId>.<expEpochSeconds>.<nonce>.<base64url hmac-sha256(secret, 'v1.eventId.exp.nonce')>
export function signJoinToken(secret, eventId, expEpochSeconds) {
  const nonce = randomBytes(6).toString('base64url');
  const body = `v1.${eventId}.${expEpochSeconds}.${nonce}`;
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
/** Returns { eventId, exp } or throws TOKEN_EXPIRED / VALIDATION. */
export function verifyJoinToken(secret, token, nowMs) {
  if (typeof token !== 'string') throw new ApiError('VALIDATION', 'joinToken required');
  const parts = token.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') throw new ApiError('TOKEN_EXPIRED');
  const [v, eventId, expStr, nonce, mac] = parts;
  const body = `${v}.${eventId}.${expStr}.${nonce}`;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(mac, expected)) throw new ApiError('TOKEN_EXPIRED');
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp * 1000 <= nowMs) throw new ApiError('TOKEN_EXPIRED');
  return { eventId, exp };
}
/** Current join link for the event: reuse the stored token while > rotateBelowHours remain, else mint a new one. */
export function currentJoinLink(db, config, clock, eventId) {
  const nowMs = clock.now();
  const row = db.get('SELECT token, expires_at FROM join_tokens WHERE event_id = ?', eventId);
  const rotateBelowMs = config.joinTokenRotateBelowHours * 3600 * 1000;
  if (row && Date.parse(row.expires_at) - nowMs > rotateBelowMs) return { joinUrl: joinUrl(config, row.token), expiresAt: row.expires_at };
  const exp = Math.floor(nowMs / 1000) + config.joinTokenTtlHours * 3600;
  const token = signJoinToken(config.joinSecret, eventId, exp);
  const expiresAt = new Date(exp * 1000).toISOString();
  db.run('INSERT INTO join_tokens(event_id, token, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(event_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at, created_at = excluded.created_at', eventId, token, expiresAt, clock.iso());
  return { joinUrl: joinUrl(config, token), expiresAt };
}
export function joinUrl(config, token) { return `${config.publicBaseUrl.replace(/\/$/, '')}/play?t=${encodeURIComponent(token)}`; }

// ---- participant identity + sessions ----------------------------------------
export function employeeRefHash(config, eventId, employeeRef) {
  return createHmac('sha256', config.sessionSecret).update(`${eventId}|${String(employeeRef).trim().toLowerCase()}`).digest('hex');
}
export function issueSession(db, config, clock, participantId, eventId) {
  const token = randomToken(32);
  const expiresAt = new Date(clock.now() + config.sessionTtlHours * 3600 * 1000).toISOString();
  db.run('INSERT INTO sessions(token_hash, participant_id, event_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', sha256Hex(token), participantId, eventId, clock.iso(), expiresAt);
  return { sessionToken: token, expiresAt };
}
/** Resolve a bearer token to a participant row, or throw UNAUTHORIZED / TOKEN_EXPIRED. */
export function resolveSession(db, clock, token) {
  const s = db.get('SELECT s.participant_id, s.event_id, s.expires_at FROM sessions s WHERE s.token_hash = ?', sha256Hex(token));
  if (!s) return null;
  if (Date.parse(s.expires_at) <= clock.now()) throw new ApiError('TOKEN_EXPIRED');
  const p = db.get('SELECT * FROM participants WHERE id = ?', s.participant_id);
  if (!p) return null;
  return p;
}

// ---- request principal --------------------------------------------------------
export function bearerOf(req) {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}
/**
 * Determine the principal of a request: { kind: 'admin'|'stage'|'participant'|'anonymous', participant?, actor }.
 * Admin and stage tokens win over sessions; a bearer that matches nothing is 'invalid'.
 */
export function principalOf(req, db, config, clock) {
  const token = bearerOf(req);
  if (!token) return { kind: 'anonymous', actor: `ip:${clientIp(req, config)}` };
  if (safeEqual(token, config.adminToken)) return { kind: 'admin', actor: 'admin' };
  if (safeEqual(token, config.stageToken)) return { kind: 'stage', actor: 'stage' };
  const participant = resolveSession(db, clock, token); // may throw TOKEN_EXPIRED
  if (participant) return { kind: 'participant', actor: participant.id, participant };
  return { kind: 'invalid', actor: `ip:${clientIp(req, config)}` };
}
/** Client address for per-IP limits. X-Forwarded-For is honoured only when BINGO_TRUST_PROXY=1 (first hop), otherwise the socket address is used. */
export function clientIp(req, config = null) {
  const xf = req.headers['x-forwarded-for'];
  if (config?.trustProxy && typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

// ---- float token at-rest protection ---------------------------------------------
function aesKey(config) { return createHash('sha256').update(`float:${config.sessionSecret}`).digest(); }
export function encryptToken(config, plaintext) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', aesKey(config), iv);
  const enc = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}
export function decryptToken(config, blob) {
  try {
    const b = Buffer.from(blob, 'base64url');
    const d = createDecipheriv('aes-256-gcm', aesKey(config), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return null; }
}

// ---- rate limiting ------------------------------------------------------------------
/** Token bucket per key. capacity tokens, refilled at ratePerSec. */
export function createLimiter(capacity, ratePerSec, clock) {
  const buckets = new Map();
  return {
    take(key) {
      const now = clock.now();
      let b = buckets.get(key);
      if (!b) { b = { tokens: capacity, at: now }; buckets.set(key, b); }
      b.tokens = Math.min(capacity, b.tokens + (Math.max(0, now - b.at) / 1000) * ratePerSec);
      b.at = now;
      if (b.tokens >= 1) { b.tokens -= 1; return true; }
      return false;
    },
    reset() { buckets.clear(); },
  };
}
export function createRateLimits(config, clock) {
  const rl = config.rateLimits || {};
  return {
    commands: createLimiter(rl.commandsPerSec ?? 10, rl.commandsPerSec ?? 10, clock),
    session: createLimiter(rl.sessionPerMin ?? 5, (rl.sessionPerMin ?? 5) / 60, clock),
    discovery: createLimiter(rl.discoveryPerSec ?? 20, rl.discoveryPerSec ?? 20, clock),
  };
}
export { newId };
