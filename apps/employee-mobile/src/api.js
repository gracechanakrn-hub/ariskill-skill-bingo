// apps/employee-mobile/src/api.js - participant API (contracts/api-contract.yaml) on top of the shared kit client.
// Every mutation carries an Idempotency-Key; callers that must retry a pending command keep the key
// (saves, finalize and float pass their own key so a retry after a network failure replays the same request).
import { createApiClient, ApiError, newIdempotencyKey } from '/packages/ui/api-client.js';
import { createClockSync } from '/packages/ui/clock-sync.js';

export { ApiError, newIdempotencyKey };

export const DEFAULT_EVENT_ID = 'evt_demo';

/** Event id encoded in a join token (`v1.<eventId>.<exp>.<nonce>.<sig>`), else the default. */
export function eventIdFromToken(token) {
  if (typeof token !== 'string') return DEFAULT_EVENT_ID;
  const parts = token.split('.');
  return parts.length >= 3 && parts[1] ? parts[1] : DEFAULT_EVENT_ID;
}

export function createParticipantApi({ getToken, baseUrl = '/api/v1' } = {}) {
  // /time samples go through a plain client (no passive observation loop); every other response feeds clockSync.
  const timeClient = createApiClient({ baseUrl, retries: 1, timeoutMs: 4000 });
  const clockSync = createClockSync({ fetchTime: () => timeClient.get('/time') });
  const client = createApiClient({ baseUrl, getToken, clockSync });

  return {
    client,
    clockSync,
    time: () => client.get('/time'),
    createSession: (eventId, body) => client.post(`/events/${encodeURIComponent(eventId)}/session`, body),
    me: () => client.get('/me'),
    taxonomy: () => client.get('/taxonomy'),
    setProfile: (platformId, roleId) => client.post('/me/profile', { platformId, roleId }),
    discovery: ({ mode, q = '', limit = 500 }) => {
      const params = new URLSearchParams({ mode, limit: String(limit) });
      if (q) params.set('q', q);
      return client.get(`/skills/discovery?${params.toString()}`);
    },
    saveSelections: (skillIds, boardVersion, idempotencyKey) => client.put('/me/board/selections', { skillIds, boardVersion }, { idempotencyKey }),
    finalize: (boardVersion, idempotencyKey) => client.post('/me/board/finalize', { boardVersion }, { idempotencyKey }),
    insight: () => client.get('/me/insight'),
    float: (soulId, floatToken, idempotencyKey, greeting = null) => client.post('/me/soul/float', greeting ? { soulId, floatToken, greeting } : { soulId, floatToken }, { idempotencyKey }),
    streamUrl: `${baseUrl}/me/stream`,
  };
}
