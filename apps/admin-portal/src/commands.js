// Command runner: pending / idempotency / stale-version handling for round commands (A-04, A-05, BR-20).
// Pure module (no DOM, no imports) so it is testable with a fake api.
//
//   const runner = createCommandRunner({
//     post: (roundId, body, idempotencyKey) => Promise<response>,   // throws ApiError-like objects
//     newKey: () => string,
//     getRound: () => RoundSummary | null,                           // current summary; expectedVersion = its version
//     hooks: { onPending, onAccepted, onStale, onRejected, onNetworkError, onSettled },
//   });
//   await runner.run('round.draw.next');                            // -> { status: 'accepted'|'rejected'|'stale'|'network'|'busy'|'no-round'|'not-allowed' }
//
// Rules: one command in flight at a time (double-clicks return 'busy'); a fresh Idempotency-Key per user action,
// kept only for a retry of the SAME action after a network failure; 409 STALE_VERSION never re-fires.

import { isCommandAllowed } from './state.js';

function sameParams(a, b) {
  try { return JSON.stringify(a || {}) === JSON.stringify(b || {}); } catch { return false; }
}

export function createCommandRunner({ post, newKey, getRound, hooks = {} }) {
  if (typeof post !== 'function') throw new Error('createCommandRunner: post is required');
  const keyFn = typeof newKey === 'function' ? newKey : () => `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  let pending = null;   // { command, key, startedAt }
  let retry = null;     // { command, params, key } kept after a network failure
  const call = (name, ...args) => { try { if (typeof hooks[name] === 'function') hooks[name](...args); } catch { /* hooks never break the runner */ } };

  function sanitizeParams(command, params) {
    if (command === 'round.draw.next') return {};        // never contains a skill identifier (BR-10)
    if (command === 'round.start_now') return { confirmed: true };
    return params && typeof params === 'object' ? { ...params } : {};
  }

  async function run(command, params = {}, { force = false } = {}) {
    if (pending) return { status: 'busy', pending: pending.command };
    const round = typeof getRound === 'function' ? getRound() : null;
    if (!round || !round.roundId) return { status: 'no-round' };
    if (!force && !isCommandAllowed(round.state, command)) return { status: 'not-allowed', state: round.state };
    const safeParams = sanitizeParams(command, params);
    const key = retry && retry.command === command && retry.roundId === round.roundId && sameParams(retry.params, safeParams) ? retry.key : keyFn();
    const body = { command, expectedVersion: round.version, params: safeParams };
    pending = { command, key, startedAt: Date.now() };
    call('onPending', command, body);
    try {
      const result = await post(round.roundId, body, key);
      retry = null;
      call('onAccepted', result, command, body);
      return { status: 'accepted', result, key };
    } catch (error) {
      if (error && error.isStaleVersion) {
        retry = null;
        call('onStale', error, command, body);
        return { status: 'stale', error, key };
      }
      if (error && error.isNetwork) {
        retry = { command, params: safeParams, key, roundId: round.roundId };
        call('onNetworkError', error, command, body);
        return { status: 'network', error, key };
      }
      retry = null;
      call('onRejected', error, command, body);
      return { status: 'rejected', error, key };
    } finally {
      pending = null;
      call('onSettled', command);
    }
  }

  return {
    run,
    isPending: () => pending !== null,
    pendingCommand: () => (pending ? pending.command : null),
    retryKeyFor: (command) => (retry && retry.command === command ? retry.key : null),
    clearRetry: () => { retry = null; },
  };
}

/** Commands whose server-side transaction locks boards (BR-07): an unexpected failure is E19. */
const LOCKING_COMMANDS = new Set(['round.lock', 'round.start_now']);
const NOT_LOCK_FAILURES = new Set(['STALE_VERSION', 'ILLEGAL_TRANSITION', 'POOL_TOO_SMALL', 'POOL_EXHAUSTED', 'UNAUTHORIZED', 'FORBIDDEN', 'TOKEN_EXPIRED', 'VALIDATION', 'REASON_REQUIRED', 'NOT_FOUND', 'RATE_LIMITED', 'IDEMPOTENCY_MISMATCH', 'NETWORK', 'TIMEOUT']);

/**
 * Map a rejected command error to the exception id whose copy the UI shows (contracts/api-contract.yaml).
 * `command` lets a failed round.lock / round.start_now lock leg (INTERNAL, DB failure, any E19-flagged detail)
 * surface as E19 "The round couldn't finish locking" (UX-04).
 */
export function exceptionIdFor(error, command = null) {
  if (!error) return null;
  if (error.exceptionId) return error.exceptionId;
  if (error.details && error.details.code === 'E19') return 'E19';
  switch (error.code) {
    case 'STALE_VERSION': case 'ILLEGAL_TRANSITION': return 'E10';
    case 'POOL_TOO_SMALL': return 'E20';
    case 'POOL_EXHAUSTED': return 'E11';
    case 'DRAW_FAILED': return 'E21';
    case 'UNAUTHORIZED': case 'FORBIDDEN': return 'E9';
    default:
      if (LOCKING_COMMANDS.has(command) && !NOT_LOCK_FAILURES.has(error.code) && !error.isNetwork && !error.isAuth) return 'E19';
      return null;
  }
}
