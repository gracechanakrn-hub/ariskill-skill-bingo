// Admin API surface over the shared api client. All paths are relative to /api/v1.
import { createApiClient, ApiError } from '/packages/ui/api-client.js';
import { createClockSync } from '/packages/ui/clock-sync.js';
import { getToken } from './auth.js';

export { ApiError };
export const EVENT_ID = 'evt_demo';

export function createAdminApi({ eventId = EVENT_ID } = {}) {
  let withClock = null;
  const clockSync = createClockSync({ fetchTime: () => withClock.get('/time') });
  withClock = createApiClient({ baseUrl: '/api/v1', getToken, clockSync });
  return {
    eventId,
    client: withClock,
    clockSync,
    snapshot: () => withClock.get(`/admin/events/${eventId}/snapshot`),
    insights: () => withClock.get(`/admin/events/${eventId}/insights`),
    audit: ({ roundId = null, limit = 200 } = {}) => {
      const q = new URLSearchParams();
      if (roundId) q.set('roundId', roundId);
      q.set('limit', String(limit));
      return withClock.get(`/admin/events/${eventId}/audit?${q.toString()}`);
    },
    joinLink: () => withClock.get(`/admin/events/${eventId}/join-link`),
    createRound: (body) => withClock.post(`/admin/events/${eventId}/rounds`, body),
    command: (roundId, body, idempotencyKey) => withClock.post(`/admin/rounds/${encodeURIComponent(roundId)}/commands`, body, { idempotencyKey }),
    newIdempotencyKey: () => withClock.newIdempotencyKey(),
    streamUrl: `/api/v1/admin/events/${eventId}/stream`,
  };
}
