// Arise Soul: deterministic cosmetic configuration from a server-provided seed (BR-16, BR-17).
// Forbidden inputs: Platform, Role, matrix alignment, winner status (except the separate badge), any personal attribute.
import { hashString } from './random.js';

export const SOUL_CONFIG_VERSION = 1;
export const SOUL_TRAITS = Object.freeze({
  body: ['drop', 'bell', 'cloud', 'pebble', 'flame', 'bean'],          // silhouette family; all equal size
  palette: ['aurora', 'lagoon', 'sunset', 'orchid', 'mint', 'coral', 'sky', 'lilac'],
  eyes: ['dot', 'star', 'sleepy', 'wide', 'wink', 'sparkle'],
  antenna: ['orb', 'ring', 'leaf', 'spark', 'none', 'twin'],
  mouth: ['smile', 'open', 'tiny', 'none'],
  glow: ['soft', 'ring', 'halo'],
});
export const SOUL_CONFIG_SCHEMA = {
  version: 'int', seed: 'string (hex)', body: 'index into SOUL_TRAITS.body', palette: 'index', eyes: 'index', antenna: 'index', mouth: 'index', glow: 'index',
  constellation: '[{domain, weight 0..1}] top 5 selected-skill domains (accent placement only)',
  driftPhase: 'float 0..1 (orbit start offset, cosmetic)',
};

/** Seed string from the Soul record identity only. */
export function soulSeed({ eventId, participantId, roundId }) {
  const h = hashString(`${eventId}|${participantId}|${roundId}`);
  return h.toString(16).padStart(14, '0');
}

/** Deterministic trait selection. domainCounts: {domain: count} from the 25 selected skills. */
export function soulConfigFromSeed(seed, domainCounts = {}) {
  const pick = (name, salt) => hashString(`${seed}:${salt}`) % SOUL_TRAITS[name].length;
  const total = Object.values(domainCounts).reduce((a, b) => a + b, 0) || 1;
  const constellation = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, weight: Math.round((count / total) * 1000) / 1000 }));
  return {
    version: SOUL_CONFIG_VERSION,
    seed,
    body: pick('body', 'body'), palette: pick('palette', 'palette'), eyes: pick('eyes', 'eyes'),
    antenna: pick('antenna', 'antenna'), mouth: pick('mouth', 'mouth'), glow: pick('glow', 'glow'),
    constellation,
    driftPhase: (hashString(`${seed}:drift`) % 1000) / 1000,
  };
}

/** Invariant check used before release/serving (BR-17): config has no forbidden fields and indices are in range. */
export function validateSoulConfig(cfg) {
  const forbidden = ['platformId', 'roleId', 'size', 'power', 'rank', 'strength', 'brightness', 'quality', 'inMatrixCount', 'beyondMatrixCount', 'isWinner'];
  for (const k of forbidden) if (k in cfg) return { ok: false, reason: `forbidden field ${k}` };
  for (const k of ['body', 'palette', 'eyes', 'antenna', 'mouth', 'glow']) {
    if (!Number.isInteger(cfg[k]) || cfg[k] < 0 || cfg[k] >= SOUL_TRAITS[k].length) return { ok: false, reason: `trait ${k} out of range` };
  }
  if (!Array.isArray(cfg.constellation) || cfg.constellation.length > 5) return { ok: false, reason: 'constellation invalid' };
  return { ok: true };
}

/** Neutral fallback used when a config fails validation (BR-17 failure handling). */
export function neutralSoulConfig(seed) { return { version: SOUL_CONFIG_VERSION, seed, body: 0, palette: 0, eyes: 0, antenna: 4, mouth: 0, glow: 0, constellation: [], driftPhase: 0 }; }
