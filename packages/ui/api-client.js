// @ariskill/ui api-client.js - fetch wrapper for contracts/api-contract.yaml.
//  - Authorization: Bearer <token> when getToken() returns one
//  - Idempotency-Key on every mutation (auto crypto.randomUUID()), reused across retries
//  - error envelope -> ApiError { code, message, exceptionId, details, status, correlationId, serverTime }
//  - retries on network failure / 502 / 503 / 504 only (same key, backoff); never on 4xx / 409 / 500
//  - lastServerTime from every response; feeds clock-sync.observe() when provided

export class ApiError extends Error {
  constructor({ code = 'UNKNOWN', message = 'Request failed', exceptionId = null, details = null, status = 0, correlationId = null, serverTime = null, cause = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.exceptionId = exceptionId;
    this.details = details;
    this.status = status;
    this.correlationId = correlationId;
    this.serverTime = serverTime;
    if (cause) this.cause = cause;
  }
  get isNetwork() { return this.code === 'NETWORK' || this.code === 'TIMEOUT'; }
  get isStaleVersion() { return this.code === 'STALE_VERSION'; }
  /** STALE_VERSION carries { currentVersion, snapshot } in details (contract). */
  get staleSnapshot() { return this.isStaleVersion && this.details ? this.details.snapshot || null : null; }
  get isAuth() { return this.status === 401 || this.status === 403; }
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

export function newIdempotencyKey() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // RFC 4122 v4 fallback built from getRandomValues (still no third-party code)
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes); else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * createApiClient({ baseUrl = '', getToken, clockSync, fetch, retries = 3, backoffMs = 300, timeoutMs = 10000, onServerTime })
 *  get(path, opts) / post(path, body, opts) / put(path, body, opts) / request(method, path, opts)
 *  opts: { idempotencyKey, headers, signal, timeoutMs, retries }
 *  lastServerTime (ISO|null), lastServerTimeMs, lastCorrelationId
 * `baseUrl` is prefixed to `path` (use '/api/v1'). Paths starting with http(s) are used as-is.
 */
export function createApiClient({
  baseUrl = '',
  getToken = null,
  clockSync = null,
  fetch: fetchImpl = null,
  retries = 3,
  backoffMs = 300,
  timeoutMs = 10_000,
  onServerTime = null,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
} = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  let lastServerTime = null;
  let lastCorrelationId = null;

  function url(path) {
    if (/^https?:\/\//i.test(path)) return path;
    const base = String(baseUrl || '').replace(/\/+$/, '');
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  async function headersFor(method, opts) {
    const h = { Accept: 'application/json', ...(opts.headers || {}) };
    if (method !== 'GET' && method !== 'HEAD') h['Content-Type'] = 'application/json';
    const token = typeof getToken === 'function' ? await getToken() : null;
    if (token) h.Authorization = `Bearer ${token}`;
    if (method !== 'GET' && method !== 'HEAD') h['Idempotency-Key'] = opts.idempotencyKey;
    return h;
  }

  function noteServerTime(payload, sentAt, receivedAt) {
    const iso = payload && typeof payload === 'object' ? payload.serverTime : null;
    if (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))) {
      lastServerTime = iso;
      const sample = { serverTime: iso, sentAt, receivedAt };
      if (clockSync && typeof clockSync.observe === 'function') { try { clockSync.observe(sample); } catch { /* ignore */ } }
      if (typeof onServerTime === 'function') { try { onServerTime(sample); } catch { /* ignore */ } }
    }
    if (payload && typeof payload === 'object' && payload.correlationId) lastCorrelationId = payload.correlationId;
  }

  async function readBody(res) {
    const text = await res.text().catch(() => '');
    if (!text) return null;
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  function toApiError(status, payload, extra = {}) {
    const env = payload && typeof payload === 'object' && payload.error && typeof payload.error === 'object' ? payload.error : null;
    return new ApiError({
      code: env ? env.code || `HTTP_${status}` : `HTTP_${status}`,
      message: env ? env.message || `Request failed (${status})` : `Request failed (${status})`,
      exceptionId: env ? env.exceptionId ?? null : null,
      details: env ? env.details ?? null : null,
      status,
      correlationId: payload && payload.correlationId ? payload.correlationId : null,
      serverTime: payload && payload.serverTime ? payload.serverTime : null,
      ...extra,
    });
  }

  async function request(method, path, opts = {}) {
    method = method.toUpperCase();
    const mutating = method !== 'GET' && method !== 'HEAD';
    const options = { ...opts, idempotencyKey: opts.idempotencyKey || (mutating ? newIdempotencyKey() : undefined) };
    const maxAttempts = 1 + Math.max(0, Number.isFinite(options.retries) ? options.retries : retries);
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    let attempt = 0; let lastErr = null;
    while (attempt < maxAttempts) {
      attempt++;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs || timeoutMs) : null;
      const onOuterAbort = () => controller && controller.abort(options.signal.reason);
      if (options.signal) { if (options.signal.aborted) { throw new ApiError({ code: 'ABORTED', message: 'Request aborted', status: 0 }); } options.signal.addEventListener('abort', onOuterAbort, { once: true }); }
      const sentAt = now();
      let res;
      try {
        res = await doFetch(url(path), { method, headers: await headersFor(method, options), body, signal: controller ? controller.signal : undefined, credentials: 'same-origin', cache: 'no-store' });
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (options.signal) options.signal.removeEventListener('abort', onOuterAbort);
        if (options.signal && options.signal.aborted) throw new ApiError({ code: 'ABORTED', message: 'Request aborted', status: 0, cause: err });
        const timedOut = controller && controller.signal.aborted;
        lastErr = new ApiError({ code: timedOut ? 'TIMEOUT' : 'NETWORK', message: timedOut ? 'Request timed out' : 'Network error', status: 0, cause: err });
        if (attempt < maxAttempts) { await sleep(backoffDelay(backoffMs, attempt)); continue; }
        throw lastErr;
      }
      if (timer) clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', onOuterAbort);
      const receivedAt = now();
      const payload = res.status === 204 ? null : await readBody(res);
      noteServerTime(payload, sentAt, receivedAt);
      if (res.ok) return payload;
      const apiErr = toApiError(res.status, payload);
      if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) { lastErr = apiErr; await sleep(backoffDelay(backoffMs, attempt)); continue; }
      throw apiErr; // 4xx (incl. 409 STALE_VERSION / ROUND_LOCKED) and 500 are never retried automatically
    }
    throw lastErr;
  }

  return {
    request,
    get: (path, opts = {}) => request('GET', path, opts),
    post: (path, body, opts = {}) => request('POST', path, { ...opts, body }),
    put: (path, body, opts = {}) => request('PUT', path, { ...opts, body }),
    del: (path, opts = {}) => request('DELETE', path, opts),
    newIdempotencyKey,
    get lastServerTime() { return lastServerTime; },
    get lastServerTimeMs() { return lastServerTime ? Date.parse(lastServerTime) : null; },
    get lastCorrelationId() { return lastCorrelationId; },
    get baseUrl() { return baseUrl; },
  };
}

function backoffDelay(base, attempt) {
  const exp = base * 2 ** (attempt - 1);
  return Math.min(5000, exp) + Math.floor(Math.random() * base * 0.5);
}
