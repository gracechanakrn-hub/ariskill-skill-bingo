// Isomorphic accessors for the copy catalog and contract constants.
import copy from './copy.json' with { type: 'json' };
export const COPY = copy;
export function t(key, vars = {}) {
  const raw = copy.key[key];
  if (raw === undefined) return key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}
export function exception(id) { return copy.exceptions[id] || null; }
export const ROUND_STATES = ['DRAFT','REGISTRATION_OPEN','LOCKED','PLAYING','WINNER','EXHAUSTED','CLOSED','CANCELLED'];
export const BOARD_STATES = ['DRAFT','READY','LOCKED_ACTIVE','DEFERRED','FINISHED'];
export const PUBLIC_STATE_BY_ROUND = { DRAFT:'Waiting', REGISTRATION_OPEN:'Waiting', LOCKED:'Waiting', CLOSED:'Waiting', PLAYING:'Playing', WINNER:'Winner', EXHAUSTED:'Waiting', CANCELLED:'Waiting' };
