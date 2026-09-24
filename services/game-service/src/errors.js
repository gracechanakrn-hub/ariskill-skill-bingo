// API error catalogue: exactly the codes, HTTP statuses and exception ids of contracts/api-contract.yaml.
import { exception } from '../../../packages/contracts/index.js';

export const ERROR_CODES = {
  UNAUTHORIZED: { http: 401, exceptionId: 'E9' },
  FORBIDDEN: { http: 403, exceptionId: 'E9' },
  TOKEN_EXPIRED: { http: 401, exceptionId: 'E2' },
  NOT_FOUND: { http: 404, exceptionId: null },
  VALIDATION: { http: 400, exceptionId: null },
  PROFILE_REQUIRED: { http: 409, exceptionId: 'E16' },
  DUPLICATE_SKILL: { http: 409, exceptionId: 'E4' },
  ROUND_LOCKED: { http: 409, exceptionId: 'E8' },
  STALE_VERSION: { http: 409, exceptionId: 'E10' },
  IDEMPOTENCY_MISMATCH: { http: 422, exceptionId: null, message: 'same key, different request' },
  POOL_TOO_SMALL: { http: 409, exceptionId: 'E20' },
  POOL_EXHAUSTED: { http: 409, exceptionId: 'E11' },
  REASON_REQUIRED: { http: 400, exceptionId: null },
  ILLEGAL_TRANSITION: { http: 409, exceptionId: 'E10' },
  DRAW_FAILED: { http: 500, exceptionId: 'E21' },
  FLOAT_FAILED: { http: 409, exceptionId: 'E13' },
  RATE_LIMITED: { http: 429, exceptionId: null },
};
/**
 * Router catch-all for unhandled errors (api-contract 1.0.1 `INTERNAL`, never on the draw path).
 * Kept beside ERROR_CODES because tests/contracts compares ERROR_CODES to the catalogue minus INTERNAL; ApiError resolves both.
 */
export const INTERNAL_ERROR = Object.freeze({ http: 500, exceptionId: null, message: 'unexpected server error' });
const ALL_CODES = { ...ERROR_CODES, INTERNAL: INTERNAL_ERROR };

export class ApiError extends Error {
  constructor(code, message = null, details = null, exceptionId = undefined) {
    const def = ALL_CODES[code];
    if (!def) throw new Error(`unknown error code ${code}`);
    const exId = exceptionId === undefined ? def.exceptionId : exceptionId;
    super(message ?? def.message ?? (exId ? exception(exId)?.copy : null) ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.http = def.http;
    this.exceptionId = exId;
    this.details = details;
  }
  toBody(correlationId, serverTime) {
    return { error: { code: this.code, message: this.message, exceptionId: this.exceptionId, details: this.details }, correlationId, serverTime };
  }
}

export function isApiError(e) { return e instanceof ApiError; }
