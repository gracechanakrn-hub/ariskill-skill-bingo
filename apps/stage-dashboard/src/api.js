// Stage dashboard - read-only API access. Holds the STAGE token only (never an admin token) and only ever
// issues GET requests: /time, /stage/events/{id}/snapshot and the /stage/events/{id}/stream SSE feed.
import { createApiClient, ApiError } from '/packages/ui/api-client.js';
import { createClockSync } from '/packages/ui/clock-sync.js';

export const TOKEN_STORAGE_KEY = 'ariskill.stageToken';
export const DEFAULT_EVENT_ID = 'evt_demo';
export const BASE_URL = '/api/v1';
export { ApiError };

function storage() { try { return window.sessionStorage; } catch { return null; } }

/**
 * Reads the stage token once from `?token=` (development convenience), stores it in sessionStorage and strips it
 * from the URL so it never lingers in the address bar or history; otherwise returns the stored token or null.
 */
export function readToken({ location = window.location, history = window.history } = {}) {
  const store = storage();
  let token = null;
  try {
    const url = new URL(location.href);
    const fromQuery = url.searchParams.get('token');
    if (fromQuery) {
      token = fromQuery.trim();
      url.searchParams.delete('token');
      if (store) store.setItem(TOKEN_STORAGE_KEY, token);
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch { /* ignore malformed URLs */ }
  if (!token && store) token = store.getItem(TOKEN_STORAGE_KEY);
  return token || null;
}

export function saveToken(token) { const s = storage(); if (s && token) s.setItem(TOKEN_STORAGE_KEY, String(token).trim()); }
export function clearToken() { const s = storage(); if (s) s.removeItem(TOKEN_STORAGE_KEY); }

/** Event id from `?event=` (development) or the default demo event. */
export function readEventId({ location = window.location } = {}) {
  try { return new URL(location.href).searchParams.get('event') || DEFAULT_EVENT_ID; } catch { return DEFAULT_EVENT_ID; }
}

export function createStageApi({ getToken, eventId = DEFAULT_EVENT_ID }) {
  let clockSync = null;
  const api = createApiClient({ baseUrl: BASE_URL, getToken, clockSync: { observe: (s) => clockSync && clockSync.observe(s) } });
  clockSync = createClockSync({ fetchTime: () => api.get('/time') });
  return {
    api,
    clockSync,
    eventId,
    fetchSnapshot: () => api.get(`/stage/events/${encodeURIComponent(eventId)}/snapshot`),
    fetchTime: () => api.get('/time'),
    streamUrl: () => `${BASE_URL}/stage/events/${encodeURIComponent(eventId)}/stream`,
  };
}
