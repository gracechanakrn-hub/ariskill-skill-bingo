// Admin bearer token handling (A1). Token lives in sessionStorage only.
// Development-only convenience: `?token=` in the URL is read once, stored, and stripped from the address bar so
// headless screenshots can authenticate. It is honoured only on loopback hosts.

export const TOKEN_KEY = 'ariskill-skill-bingo:admin:token';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function storage() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

export function getToken() {
  const s = storage();
  try { return s ? s.getItem(TOKEN_KEY) : null; } catch { return null; }
}

export function setToken(token) {
  const s = storage();
  try { if (s) { if (token) s.setItem(TOKEN_KEY, token); else s.removeItem(TOKEN_KEY); } } catch { /* private mode */ }
}

export function clearToken() { setToken(null); }

export function isDevelopmentHost(loc = globalThis.location) {
  return !!loc && LOOPBACK.has(String(loc.hostname || ''));
}

/** Read `?token=` once (development only), store it, and strip it from the URL. Returns true when consumed. */
export function consumeUrlToken(loc = globalThis.location, history = globalThis.history) {
  if (!loc || !isDevelopmentHost(loc)) return false;
  let url;
  try { url = new URL(loc.href); } catch { return false; }
  const token = url.searchParams.get('token');
  if (!token) return false;
  setToken(token);
  url.searchParams.delete('token');
  try { if (history && typeof history.replaceState === 'function') history.replaceState(history.state, '', url.toString()); } catch { /* ignore */ }
  return true;
}
