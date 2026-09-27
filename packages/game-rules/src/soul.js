// Arise Soul: deterministic cosmetic configuration from a server-provided seed (BR-16, BR-17).
// Forbidden inputs: Platform, Role, matrix alignment, winner status (except the separate badge), any personal attribute.
// v1: seeded baseline traits (Souls created before stage 12; still validated and rendered). v2 (D-29,
// docs/art/soul-decorations.md): the baseline Soul decorated with a face, SLOT_COUNT skill charms and a body gradient. Its
// only inputs besides the seed are counts per skill kind (selected skills -> charm split, matched tiles -> face); the counts
// shape the decoration and never enter the config. v3 (D-31, docs/art/soul-faces.md; Souls created from contract 1.2.0):
// v2 plus a face plate, eyes and an antenna charm (topper), all three picked from the seed, never from skills. v1 and v2
// Souls stay valid, and the neutral fallback stays v2.
import { hashString, seededRng, shuffle } from './random.js';
import {
  CATALOG_VERSION, SLOT_COUNT, KINDS, FACE_BY_KIND, FACES, GRADIENTS, CHARMS, CHARMS_BY_KIND, CHARM_BY_ID, PLATE_IDS, EYE_IDS, skillKindOf,
} from './soul-catalog.js';

export const SOUL_CONFIG_VERSION = 3;
const V1 = 1, V2 = 2;
/** First catalog version with face plates and eyes: a v3 config never refers to an older one. */
const V3_MIN_CATALOG = 2;
export const SOUL_TRAITS = Object.freeze({
  body: ['drop', 'bell', 'cloud', 'pebble', 'flame', 'bean'],          // silhouette family; all equal size
  palette: ['aurora', 'lagoon', 'sunset', 'orchid', 'mint', 'coral', 'sky', 'lilac'],
  eyes: ['dot', 'star', 'sleepy', 'wide', 'wink', 'sparkle'],
  antenna: ['orb', 'ring', 'leaf', 'spark', 'none', 'twin'],
  mouth: ['smile', 'open', 'tiny', 'none'],
  glow: ['soft', 'ring', 'halo'],
});
/** Version 1 config (legacy). */
export const SOUL_CONFIG_SCHEMA = {
  version: 'int', seed: 'string (hex)', body: 'index into SOUL_TRAITS.body', palette: 'index', eyes: 'index', antenna: 'index', mouth: 'index', glow: 'index',
  constellation: '[{domain, weight 0..1}] top 5 selected-skill domains (accent placement only)',
  driftPhase: 'float 0..1 (orbit start offset, cosmetic)',
};
/** Version 2 config (Souls created under contract 1.1.0, and the neutral fallback): exactly these keys, in this order (contracts/realtime-events.json shapes.SoulConfigV2). */
export const SOUL_CONFIG_SCHEMA_V2 = Object.freeze({
  version: 'int 2', catalog: 'int: soul-catalog.js version the charm ids refer to', seed: 'string (hex)',
  gradient: 'index into GRADIENTS (0..11)', glow: 'index into SOUL_TRAITS.glow (0..2)',
  face: "'nerdy'|'pirate'|'angel', null only in the neutral fallback",
  charms: 'charm ids by slot: SLOT_COUNT of them, [] only in the neutral fallback',
  constellation: '[{domain, weight 0..1}] top 5 selected-skill domains (accent placement only)',
  driftPhase: 'float 0..1 (orbit start offset, cosmetic)',
});
const V2_KEYS = Object.keys(SOUL_CONFIG_SCHEMA_V2);
/** Version 3 config (D-31): exactly these keys, in this order (contracts/realtime-events.json shapes.SoulConfig). */
export const SOUL_CONFIG_SCHEMA_V3 = Object.freeze({
  version: 'int 3', catalog: 'int 2..CATALOG_VERSION: soul-catalog.js version the charm, plate and eye ids refer to', seed: 'string (hex)',
  gradient: 'index into GRADIENTS (0..11)', glow: 'index into SOUL_TRAITS.glow (0..2)',
  face: "'nerdy'|'pirate'|'angel', never null",
  plate: 'face plate id (PLATE_IDS), picked from the seed',
  eyes: 'eye design id (EYE_IDS), picked from the seed',
  charms: 'charm ids by slot: exactly SLOT_COUNT distinct ids',
  topper: 'antenna charm id, picked from the seed among the catalog charms not in charms',
  constellation: '[{domain, weight 0..1}] top 5 selected-skill domains (accent placement only)',
  driftPhase: 'float 0..1 (orbit start offset, cosmetic)',
});
const V3_KEYS = Object.keys(SOUL_CONFIG_SCHEMA_V3);
/** Fields no config version may carry: rank-like traits, identity, and the raw decoration inputs. */
export const SOUL_FORBIDDEN_FIELDS = Object.freeze(['platformId', 'roleId', 'size', 'power', 'rank', 'strength', 'brightness', 'quality', 'inMatrixCount', 'beyondMatrixCount', 'isWinner',
  'selectedKinds', 'matchedKinds', 'kindCounts', 'skillIds', 'matchedCount']);

/** Seed string from the Soul record identity only. */
export function soulSeed({ eventId, participantId, roundId }) {
  const h = hashString(`${eventId}|${participantId}|${roundId}`);
  return h.toString(16).padStart(14, '0');
}

function constellationOf(domainCounts) {
  const total = Object.values(domainCounts).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, weight: Math.round((count / total) * 1000) / 1000 }));
}
const driftPhaseOf = (seed) => (hashString(`${seed}:drift`) % 1000) / 1000;

/** Version 1 config: deterministic trait selection. domainCounts: {domain: count} from the 16 selected skills. */
export function soulConfigFromSeed(seed, domainCounts = {}) {
  const pick = (name, salt) => hashString(`${seed}:${salt}`) % SOUL_TRAITS[name].length;
  return {
    version: V1,
    seed,
    body: pick('body', 'body'), palette: pick('palette', 'palette'), eyes: pick('eyes', 'eyes'),
    antenna: pick('antenna', 'antenna'), mouth: pick('mouth', 'mouth'), glow: pick('glow', 'glow'),
    constellation: constellationOf(domainCounts),
    driftPhase: driftPhaseOf(seed),
  };
}

// ---- v2 rules (D-29): pure, keyed only by the seed and the given counts -------------------------------------------
/** A kind's count as a whole number >= 0 (missing, negative or non-numeric counts are 0). */
const countOf = (counts, kind) => { const v = Number(counts?.[kind]); return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0; };
const zeroKinds = () => Object.fromEntries(KINDS.map((k) => [k, 0]));

/** {core, technical, soft} counts from skill-master `kind` labels ('Core Skill' | 'Hard Skill' | 'Soft Skill'); unknown labels are skipped. */
export function countSkillKinds(kindLabels) {
  const out = zeroKinds();
  for (const label of kindLabels ?? []) { const k = skillKindOf(label); if (k) out[k] += 1; }
  return out;
}

/**
 * Charm slots per kind for the selected skills' kind counts. Quotas are floor(slotCount * count / total); leftover slots
 * go by largest remainder (ties core > technical > soft); then every kind with a selected skill gets at least one slot,
 * taken from the kind with the most slots (ties: the lower-priority kind gives, soft before technical before core).
 * Total 0 gives no slots. Exact integer maths, so remainder ties are real ties.
 */
export function splitCharmSlots(counts, slotCount = SLOT_COUNT) {
  const n = Object.fromEntries(KINDS.map((k) => [k, countOf(counts, k)]));
  const total = KINDS.reduce((a, k) => a + n[k], 0);
  const slots = zeroKinds();
  if (!total || !Number.isInteger(slotCount) || slotCount <= 0) return slots;
  const rem = {};
  for (const k of KINDS) { rem[k] = (slotCount * n[k]) % total; slots[k] = (slotCount * n[k] - rem[k]) / total; }
  let left = slotCount - KINDS.reduce((a, k) => a + slots[k], 0);
  const byRemainder = KINDS.filter((k) => n[k] > 0).sort((a, b) => rem[b] - rem[a] || KINDS.indexOf(a) - KINDS.indexOf(b));
  for (const k of byRemainder) { if (left <= 0) break; slots[k] += 1; left -= 1; }
  const givers = [...KINDS].reverse(); // on equal slots the first here gives: soft, then technical, then core
  for (const k of KINDS) {
    if (!n[k] || slots[k]) continue;
    const donor = givers.reduce((best, d) => (slots[d] > slots[best] ? d : best));
    if (slots[donor] < 2) break; // fewer slots than kinds picked: nothing left to give
    slots[donor] -= 1; slots[k] += 1;
  }
  return slots;
}

/** Face from the kind with the most matched tiles; ties core > technical > soft, so no matches at all gives nerdy. */
export function faceForMatches(matchedCounts) {
  let best = KINDS[0];
  for (const k of KINDS) if (countOf(matchedCounts, k) > countOf(matchedCounts, best)) best = k;
  return FACE_BY_KIND[best];
}

/** Body gradient index, uniform over the catalog gradients. */
export function pickGradient(seed) { return hashString(`${seed}:gradient`) % GRADIENTS.length; }
/** Glow style index, exactly as v1 picks it. */
export function pickGlow(seed) { return hashString(`${seed}:glow`) % SOUL_TRAITS.glow.length; }
/** Charm ids by slot for a split {core, technical, soft}: distinct seeded variants per kind, then a seeded shuffle of the slots. */
export function pickCharms(seed, slots) {
  const chosen = [];
  for (const k of KINDS) {
    const n = Math.min(countOf(slots, k), CHARMS_BY_KIND[k].length);
    if (n) chosen.push(...shuffle(CHARMS_BY_KIND[k], seededRng(`${seed}:charms:${k}`)).slice(0, n));
  }
  return shuffle(chosen, seededRng(`${seed}:slots`));
}

// ---- v3 picks (D-31): keyed only by the seed (and, for the topper, the Soul's own charms) ---------------------------
/** Face plate id, uniform over the catalog plates. */
export function pickPlate(seed) { return PLATE_IDS[hashString(`${seed}:plate`) % PLATE_IDS.length]; }
/** Eye design id, uniform over the catalog eyes. */
export function pickEyes(seed) { return EYE_IDS[hashString(`${seed}:eyes`) % EYE_IDS.length]; }
/**
 * Antenna charm id: a seeded pick over every catalog charm id, in catalog order, minus the Soul's own charms, so the
 * topper never repeats a body charm. Any kind can top any Soul (it is random, never a skill). null only when no charm is
 * free, which a real Soul (at most SLOT_COUNT charms) never reaches.
 */
export function pickTopper(seed, charms = []) {
  const taken = new Set(Array.isArray(charms) ? charms : []);
  const free = CHARMS.filter((c) => !taken.has(c.id)).map((c) => c.id);
  return free.length ? free[hashString(`${seed}:topper`) % free.length] : null;
}

/**
 * Version 3 config, built once at round end. selectedKinds / matchedKinds: {core, technical, soft} counts of the 16
 * selected skills and of the tiles matched when the round ends (countSkillKinds). Constellation and driftPhase are the
 * v1 values; face and charms follow the v2 rules; everything else is picked from the seed. With no kind counted there
 * are no charms, which v3 rejects, so the caller serves the neutral fallback.
 */
export function decoratedSoulConfig(seed, { domainCounts = {}, selectedKinds = {}, matchedKinds = {} } = {}) {
  const charms = pickCharms(seed, splitCharmSlots(selectedKinds));
  return {
    version: SOUL_CONFIG_VERSION,
    catalog: CATALOG_VERSION,
    seed,
    gradient: pickGradient(seed), glow: pickGlow(seed),
    face: faceForMatches(matchedKinds),
    plate: pickPlate(seed), eyes: pickEyes(seed),
    charms,
    topper: pickTopper(seed, charms),
    constellation: constellationOf(domainCounts ?? {}),
    driftPhase: driftPhaseOf(seed),
  };
}

const inRange = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
/** Rules v2 and v3 share (exact key set, catalog range, seed, gradient, glow, charm ids, constellation, driftPhase): the first broken one, or null. */
function decoratedFault(cfg, keys, minCatalog) {
  for (const k of Object.keys(cfg)) if (!keys.includes(k)) return `unknown field ${k}`;
  for (const k of keys) if (!(k in cfg)) return `missing field ${k}`;
  if (!Number.isInteger(cfg.catalog) || cfg.catalog < minCatalog || cfg.catalog > CATALOG_VERSION) return 'catalog version unknown';
  if (typeof cfg.seed !== 'string') return 'seed invalid';
  if (!inRange(cfg.gradient, GRADIENTS.length)) return 'gradient out of range';
  if (!inRange(cfg.glow, SOUL_TRAITS.glow.length)) return 'glow out of range';
  if (!Array.isArray(cfg.charms)) return 'charms is not a list';
  for (const id of cfg.charms) if (!CHARM_BY_ID.has(id)) return `unknown charm ${id}`;
  if (new Set(cfg.charms).size !== cfg.charms.length) return 'duplicate charm';
  if (!Array.isArray(cfg.constellation) || cfg.constellation.length > 5) return 'constellation invalid';
  if (typeof cfg.driftPhase !== 'number' || !(cfg.driftPhase >= 0 && cfg.driftPhase <= 1)) return 'driftPhase out of range';
  return null;
}
function validateV2(cfg) {
  const fault = decoratedFault(cfg, V2_KEYS, 1);
  if (fault) return { ok: false, reason: fault };
  if (cfg.face !== null && !FACES.includes(cfg.face)) return { ok: false, reason: 'face unknown' };
  if (cfg.charms.length !== 0 && cfg.charms.length !== SLOT_COUNT) return { ok: false, reason: 'charms must fill every slot or none' };
  if (cfg.face === null && cfg.charms.length) return { ok: false, reason: 'face null only with no charms' };
  return { ok: true };
}
function validateV3(cfg) {
  const fault = decoratedFault(cfg, V3_KEYS, V3_MIN_CATALOG);
  if (fault) return { ok: false, reason: fault };
  if (!FACES.includes(cfg.face)) return { ok: false, reason: 'face unknown' };
  if (!PLATE_IDS.includes(cfg.plate)) return { ok: false, reason: 'plate unknown' };
  if (!EYE_IDS.includes(cfg.eyes)) return { ok: false, reason: 'eyes unknown' };
  if (cfg.charms.length !== SLOT_COUNT) return { ok: false, reason: 'charms must fill every slot' };
  if (!CHARM_BY_ID.has(cfg.topper)) return { ok: false, reason: 'topper unknown' };
  if (cfg.charms.includes(cfg.topper)) return { ok: false, reason: 'topper repeats a charm' };
  return { ok: true };
}

/** Invariant check used before release/serving (BR-17): no forbidden field; v1 traits, v2 or v3 decoration in range. */
export function validateSoulConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ok: false, reason: 'config is not an object' };
  for (const k of SOUL_FORBIDDEN_FIELDS) if (k in cfg) return { ok: false, reason: `forbidden field ${k}` };
  if (cfg.version === SOUL_CONFIG_VERSION) return validateV3(cfg);
  if (cfg.version === V2) return validateV2(cfg);
  if (cfg.version !== undefined && cfg.version !== V1) return { ok: false, reason: `unknown version ${cfg.version}` };
  for (const k of ['body', 'palette', 'eyes', 'antenna', 'mouth', 'glow']) {
    if (!Number.isInteger(cfg[k]) || cfg[k] < 0 || cfg[k] >= SOUL_TRAITS[k].length) return { ok: false, reason: `trait ${k} out of range` };
  }
  if (!Array.isArray(cfg.constellation) || cfg.constellation.length > 5) return { ok: false, reason: 'constellation invalid' };
  return { ok: true };
}

/**
 * Neutral fallback used when a config fails validation (BR-17 failure handling): the plain baseline, no face, no charms.
 * Always a v2 config, also for Souls created under contract 1.2.0: v3 has no undecorated form (docs/art/soul-faces.md).
 */
export function neutralSoulConfig(seed) { return { version: 2, catalog: CATALOG_VERSION, seed, gradient: 0, glow: 0, face: null, charms: [], constellation: [], driftPhase: 0 }; }
