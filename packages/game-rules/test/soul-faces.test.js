// Soul faces, config v3 (D-31, docs/art/soul-faces.md "Config v3" and "Picks"; BR-16, BR-17): the face plate, the eyes and
// the antenna charm (topper) are picked from the seed only; v1 and v2 Souls stored earlier keep validating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  soulSeed, soulConfigFromSeed, decoratedSoulConfig, validateSoulConfig, neutralSoulConfig, pickPlate, pickEyes, pickTopper, pickCharms,
  SOUL_CONFIG_VERSION, SOUL_CONFIG_SCHEMA_V3, SOUL_FORBIDDEN_FIELDS,
} from '../src/soul.js';
import { hashString, seededRng, shuffle } from '../src/random.js';
import { CATALOG_VERSION, SLOT_COUNT, KINDS, CHARMS, CHARM_BY_ID, PLATE_IDS, EYE_IDS } from '../src/soul-catalog.js';
import { SKILL_MASTER } from './helpers.js';
import realtime from '../../../contracts/realtime-events.json' with { type: 'json' };

const split = (core, technical, soft) => ({ core, technical, soft });
const seeds = (n, prefix = 'p') => Array.from({ length: n }, (_, i) => soulSeed({ eventId: 'evt_faces', participantId: `${prefix}${i}`, roundId: 'round_1' }));
const MIXED = { domainCounts: { Development: 10, Design: 8, Cloud: 4, 'IT Security': 2, Data: 1 }, selectedKinds: split(7, 6, 12), matchedKinds: split(1, 3, 3) };
const SELECTIONS = [split(10, 10, 5), split(1, 22, 2), split(0, 25, 0), split(7, 6, 12), split(1, 1, 23), split(0, 0, 25), split(25, 0, 0)];
const CHARM_IDS = CHARMS.map(c => c.id);
/** The spec formula, computed independently of soul.js: free = every catalog charm id, catalog order, minus `charms`. */
const specTopper = (seed, charms) => { const free = CHARM_IDS.filter(id => !charms.includes(id)); return free[hashString(`${seed}:topper`) % free.length]; };
const V3_KEYS = ['version', 'catalog', 'seed', 'gradient', 'glow', 'face', 'plate', 'eyes', 'charms', 'topper', 'constellation', 'driftPhase'];

// Stored Souls from earlier contracts, exactly as the service saved them (never rebuilt): v1 before contract 1.1.0 (the
// neutral cohort member 2 of assets/souls/cohort.json) and v2 under 1.1.0 (the stage-12 builder, catalog 1).
const STORED_V1 = {
  version: 1, seed: '0e7c71a4f4779e', body: 1, palette: 3, eyes: 3, antenna: 2, mouth: 1, glow: 0,
  constellation: [{ domain: 'Corporate & Business Support', weight: 0.444 }, { domain: 'Operations Support', weight: 0.333 }, { domain: 'Architecture', weight: 0.111 }, { domain: 'Risk & Compliance', weight: 0.111 }],
  driftPhase: 0.133,
};
const STORED_V2 = {
  version: 2, catalog: 1, seed: '0e7c71a4f4779e', gradient: 5, glow: 0, face: 'pirate',
  charms: ['tech-microchip', 'tech-magnifier', 'tech-lightbulb', 'core-twin-lilac', 'tech-drone', 'tech-server', 'tech-padlock', 'tech-book', 'tech-robot', 'soft-sunflower'],
  constellation: [{ domain: 'Design', weight: 1 }], driftPhase: 0.133,
};
const STORED_V2_INPUTS = { domainCounts: { Design: 2 }, selectedKinds: split(1, 22, 2), matchedKinds: split(0, 3, 1) };

// ---- picks --------------------------------------------------------------------------------------------------------------
test('plate and eyes: the spec formulas, deterministic, always a catalog id', () => {
  for (const seed of [...seeds(300), '', 'abc', '0e7c71a4f4779e']) {
    const plate = pickPlate(seed), eyes = pickEyes(seed);
    assert.equal(plate, PLATE_IDS[hashString(`${seed}:plate`) % PLATE_IDS.length], seed);
    assert.equal(eyes, EYE_IDS[hashString(`${seed}:eyes`) % EYE_IDS.length], seed);
    assert.ok(PLATE_IDS.includes(plate) && EYE_IDS.includes(eyes), seed);
    assert.equal(pickPlate(seed), plate); assert.equal(pickEyes(seed), eyes);
  }
});

test('plate and eyes: 10 000 seeds spread over all 10 of each roughly uniformly (chi-square, p > 0.001; each within 15 % of its share)', () => {
  const N = 10000; const plates = new Map(PLATE_IDS.map(id => [id, 0])); const eyes = new Map(EYE_IDS.map(id => [id, 0]));
  for (const seed of seeds(N)) { plates.set(pickPlate(seed), plates.get(pickPlate(seed)) + 1); eyes.set(pickEyes(seed), eyes.get(pickEyes(seed)) + 1); }
  for (const [what, hits] of [['plate', plates], ['eyes', eyes]]) {
    assert.equal(hits.size, 10, what);
    const expected = N / hits.size;
    const chi2 = [...hits.values()].reduce((a, o) => a + (o - expected) ** 2 / expected, 0);
    assert.ok(chi2 < 27.88, `${what} chi-square ${chi2.toFixed(2)} over ${[...hits.values()]}`); // df 9, alpha 0.001
    for (const [id, h] of hits) assert.ok(Math.abs(h - expected) < expected * 0.15, `${what} ${id}: ${h} of ${N}`);
  }
});

test('topper: never one of the Soul\'s charms, always a catalog charm, exactly the spec formula (property test over seeds and charm sets)', () => {
  let n = 0;
  const check = (seed, charms) => {
    const topper = pickTopper(seed, charms);
    assert.ok(CHARM_BY_ID.has(topper), `${seed}: ${topper} is a catalog charm`);
    assert.ok(!charms.includes(topper), `${seed}: ${topper} is not one of ${charms}`);
    assert.equal(topper, specTopper(seed, charms), seed);
    assert.equal(pickTopper(seed, [...charms]), topper, 'deterministic');
    n += 1;
  };
  // the charm sets real Souls get
  for (const [i, seed] of seeds(2000).entries()) check(seed, pickCharms(seed, SELECTIONS[i % SELECTIONS.length]));
  // any set of catalog charms, from none to all but one
  for (const [i, seed] of seeds(1500, 'set').entries()) {
    const size = i < 1000 ? i % (SLOT_COUNT + 1) : CHARM_IDS.length - 1 - (i % 20);
    check(seed, shuffle(CHARM_IDS, seededRng(`set:${i}`)).slice(0, size));
  }
  assert.equal(n, 3500);
  const [seed] = seeds(1);
  const allButOne = CHARM_IDS.filter(id => id !== 'soft-feather');
  assert.equal(pickTopper(seed, allButOne), 'soft-feather', 'one charm left: that one');
  assert.equal(pickTopper(seed, CHARM_IDS), null, 'no charm left (never for a real Soul): null');
  for (const none of [undefined, null, 'tech-hammer', [], ['not-a-charm']]) assert.equal(pickTopper(seed, none), specTopper(seed, []), `charms ${JSON.stringify(none)} take nothing away`);
});

test('topper: over many seeds every one of the 150 catalogue charms tops some Soul, of every kind', () => {
  const seen = new Set();
  for (const [i, seed] of seeds(10000).entries()) seen.add(pickTopper(seed, pickCharms(seed, SELECTIONS[i % SELECTIONS.length])));
  assert.equal(seen.size, CHARMS.length);
  for (const k of KINDS) assert.ok(CHARMS.filter(c => c.kind === k).every(c => seen.has(c.id)), k);
});

test('BR-17 / privacy: plate and eyes depend on the seed only, the topper on the seed and the Soul\'s charms only; the counts never pick them', () => {
  for (const [i, seed] of seeds(200).entries()) {
    const a = decoratedSoulConfig(seed, MIXED);
    const b = decoratedSoulConfig(seed, { domainCounts: { Cloud: 25 }, selectedKinds: SELECTIONS[i % SELECTIONS.length], matchedKinds: split(0, 0, 9) });
    assert.equal(b.plate, a.plate); assert.equal(b.eyes, a.eyes);
    assert.equal(a.plate, pickPlate(seed)); assert.equal(a.eyes, pickEyes(seed));
    assert.equal(a.topper, pickTopper(seed, a.charms)); assert.equal(b.topper, pickTopper(seed, b.charms));
    if (JSON.stringify(b.charms) === JSON.stringify(a.charms)) assert.equal(b.topper, a.topper);
  }
  for (const k of ['plate', 'eyes', 'topper']) assert.ok(!SOUL_FORBIDDEN_FIELDS.includes(k), `${k} is a cosmetic id, not a forbidden field`);
});

// ---- config v3 -----------------------------------------------------------------------------------------------------------
test('config v3: exactly these keys in this order (spec, SOUL_CONFIG_SCHEMA_V3, contract shapes.SoulConfig); version 3, catalog CATALOG_VERSION', () => {
  assert.equal(SOUL_CONFIG_VERSION, 3); assert.equal(CATALOG_VERSION, 2);
  const cfg = decoratedSoulConfig(seeds(1)[0], MIXED);
  assert.deepEqual(Object.keys(cfg), V3_KEYS);
  assert.deepEqual(Object.keys(SOUL_CONFIG_SCHEMA_V3), V3_KEYS);
  assert.deepEqual(Object.keys(realtime.shapes.SoulConfig), V3_KEYS, 'contracts/realtime-events.json shapes.SoulConfig');
  assert.ok(Object.isFrozen(SOUL_CONFIG_SCHEMA_V3));
  assert.equal(cfg.version, 3); assert.equal(cfg.catalog, CATALOG_VERSION);
  assert.equal(validateSoulConfig(cfg).ok, true);
  const skillStrings = new Set(SKILL_MASTER.skills.flatMap(s => [s.id, s.name]));
  for (const v of [cfg.face, cfg.plate, cfg.eyes, cfg.topper, ...cfg.charms]) assert.ok(!skillStrings.has(v), `${v} is not a skill id or skill name`);
});

test('config v3: the v2 decoration is unchanged; v3 only adds plate, eyes and topper (a Soul stored at stage 12 would be rebuilt the same)', () => {
  const cfg = decoratedSoulConfig(STORED_V2.seed, STORED_V2_INPUTS);
  const { plate, eyes, topper, ...rest } = cfg;
  assert.deepEqual({ ...rest, version: 2, catalog: 1 }, STORED_V2);
  assert.deepEqual([plate, eyes, topper], [pickPlate(STORED_V2.seed), pickEyes(STORED_V2.seed), pickTopper(STORED_V2.seed, STORED_V2.charms)]);
});

test('config v3: every built config validates across seeds and selections (face never null, 10 distinct charms, topper free)', () => {
  const faces = new Set();
  for (const [i, seed] of seeds(1000, 'v').entries()) {
    const matchedKinds = [split(0, 0, 0), split(2, 1, 0), split(0, 3, 1), split(1, 1, 4)][i % 4];
    const cfg = decoratedSoulConfig(seed, { domainCounts: { Design: 3, Cloud: i % 7 }, selectedKinds: SELECTIONS[i % SELECTIONS.length], matchedKinds });
    assert.deepEqual(validateSoulConfig(cfg), { ok: true }, seed);
    assert.equal(cfg.charms.length, SLOT_COUNT); assert.equal(new Set(cfg.charms).size, SLOT_COUNT); assert.ok(!cfg.charms.includes(cfg.topper));
    faces.add(cfg.face);
  }
  assert.equal(faces.size, 3);
});

test('BR-17: validate rejects every broken v3 field, each for its own reason', () => {
  const cfg = decoratedSoulConfig(seeds(1)[0], MIXED);
  const spare = CHARM_IDS.find(id => !cfg.charms.includes(id) && id !== cfg.topper);
  const bad = {
    'unknown plate': [{ plate: 'star' }, 'plate unknown'], 'plate as an index': [{ plate: 0 }, 'plate unknown'], 'plate null': [{ plate: null }, 'plate unknown'],
    'an eyes id as plate': [{ plate: 'button' }, 'plate unknown'],
    'unknown eyes': [{ eyes: 'laser' }, 'eyes unknown'], 'v1 eyes index': [{ eyes: 3 }, 'eyes unknown'], 'a plate id as eyes': [{ eyes: 'bean' }, 'eyes unknown'],
    'topper in charms': [{ topper: cfg.charms[3] }, 'topper repeats a charm'], 'unknown topper': [{ topper: 'tech-crown' }, 'topper unknown'],
    'topper null': [{ topper: null }, 'topper unknown'], 'topper a list': [{ topper: [spare] }, 'topper unknown'],
    'face null': [{ face: null }, 'face unknown'], 'face gold': [{ face: 'gold' }, 'face unknown'],
    'nine charms': [{ charms: cfg.charms.slice(0, 9) }, 'charms must fill every slot'], 'no charms': [{ charms: [] }, 'charms must fill every slot'],
    'eleven charms': [{ charms: [...cfg.charms, spare] }, 'charms must fill every slot'],
    'duplicate charm': [{ charms: [cfg.charms[0], ...cfg.charms.slice(0, 9)] }, 'duplicate charm'],
    'unknown charm': [{ charms: ['tech-crown', ...cfg.charms.slice(1)] }, 'unknown charm tech-crown'], 'charms not a list': [{ charms: spare }, 'charms is not a list'],
    'catalog 1': [{ catalog: 1 }, 'catalog version unknown'], 'future catalog': [{ catalog: CATALOG_VERSION + 1 }, 'catalog version unknown'],
    'catalog as text': [{ catalog: '2' }, 'catalog version unknown'],
    'gradient 12': [{ gradient: 12 }, 'gradient out of range'], 'glow 3': [{ glow: 3 }, 'glow out of range'], 'seed not a string': [{ seed: 42 }, 'seed invalid'],
    'constellation too long': [{ constellation: new Array(6).fill({ domain: 'Cloud', weight: 0.1 }) }, 'constellation invalid'],
    'driftPhase -0.1': [{ driftPhase: -0.1 }, 'driftPhase out of range'],
    'extra key': [{ sparkle: true }, 'unknown field sparkle'], 'a v1 trait': [{ antenna: 0 }, 'unknown field antenna'],
    'a forbidden field': [{ matchedCount: 7 }, 'forbidden field matchedCount'],
  };
  for (const [name, [patch, reason]] of Object.entries(bad)) assert.deepEqual(validateSoulConfig({ ...cfg, ...patch }), { ok: false, reason }, name);
  for (const k of V3_KEYS.filter(key => key !== 'version')) {
    const { [k]: _, ...missing } = cfg;
    assert.deepEqual(validateSoulConfig(missing), { ok: false, reason: `missing field ${k}` }, `missing ${k}`);
  }
  assert.equal(validateSoulConfig({ ...cfg, version: 2 }).ok, false, 'a v3 config is not a valid v2 config');
  assert.deepEqual(validateSoulConfig({ ...STORED_V2, version: 3 }), { ok: false, reason: 'missing field plate' }, 'nor a v2 config a valid v3 one');
  assert.deepEqual(validateSoulConfig(cfg), { ok: true }, 'the untouched config is valid');
});

// ---- earlier versions -------------------------------------------------------------------------------------------------
test('stored v1 and v2 Souls and the v2 neutral fallback keep validating under config v3 (catalog 1 or 2)', () => {
  const rebuilt = soulConfigFromSeed(STORED_V1.seed);
  for (const k of ['body', 'palette', 'eyes', 'antenna', 'mouth', 'glow', 'driftPhase']) assert.equal(rebuilt[k], STORED_V1[k], `the v1 fixture is a real v1 config (${k})`);
  const { version, ...unversionedV1 } = STORED_V1;
  const neutral = neutralSoulConfig('0e7c71a4f4779e');
  const ok = {
    'v1': STORED_V1, 'v1 without version': unversionedV1, 'v2, catalog 1': STORED_V2, 'v2, catalog 2': { ...STORED_V2, catalog: 2 },
    'v2 face without charms': { ...STORED_V2, charms: [] }, 'neutral v2 (catalog 2)': neutral, 'neutral v2, catalog 1': { ...neutral, catalog: 1 },
  };
  for (const [name, cfg] of Object.entries(ok)) assert.deepEqual(validateSoulConfig(cfg), { ok: true }, name);
  assert.equal(neutral.version, 2); assert.equal(neutral.catalog, CATALOG_VERSION);
  assert.equal(validateSoulConfig({ ...STORED_V2, face: null }).ok, false, 'v2 rules unchanged: face null only with no charms');
  assert.equal(validateSoulConfig({ ...STORED_V2, topper: 'tech-hammer' }).ok, false, 'v3 keys never slip into a v2 config');
});
