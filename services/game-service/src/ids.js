// Prefixed opaque identifiers. Random (not sequential) so that ids never leak ordering or counts.
import { randomBytes, createHash } from 'node:crypto';

const PREFIXES = { event: 'evt_', round: 'rnd_', participant: 'prt_', board: 'brd_', draw: 'drw_', soul: 'soul_', command: 'cmd_', session: 'ses_', correlation: 'cor_' };

export function newId(kind) {
  const p = PREFIXES[kind];
  if (!p) throw new Error(`unknown id kind ${kind}`);
  return p + randomBytes(9).toString('base64url');
}
export function sha256Hex(input) { return createHash('sha256').update(input).digest('hex'); }
export function randomToken(bytes = 32) { return randomBytes(bytes).toString('base64url'); }
