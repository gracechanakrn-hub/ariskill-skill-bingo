// Soul decorations (D-29, docs/art/soul-decorations.md "Rules" and "Invariants and tests"; BR-16, BR-17): charm split, face,
// gradient and charm picks, and the v2 config rules that stored Souls and the neutral fallback keep. The builder returns v3
// since D-31; its face plate, eyes and antenna charm are tested in soul-faces.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  soulSeed, soulConfigFromSeed, decoratedSoulConfig, validateSoulConfig, neutralSoulConfig, splitCharmSlots, faceForMatches, countSkillKinds,
  pickGradient, pickGlow, pickCharms, SOUL_CONFIG_VERSION, SOUL_CONFIG_SCHEMA, SOUL_CONFIG_SCHEMA_V2, SOUL_CONFIG_SCHEMA_V3, SOUL_FORBIDDEN_FIELDS,
} from '../src/soul.js';
import { CATALOG_VERSION, CHARM_BY_ID, CHARMS, GRADIENTS, SLOT_COUNT, KINDS } from '../src/soul-catalog.js';
import { SKILL_MASTER } from './helpers.js';
import { REQUIRED_SELECTIONS } from '../src/board.js';
import realtime from '../../../contracts/realtime-events.json' with { type: 'json' };

const split = (core, technical, soft) => ({ core, technical, soft });
const seeds = (n, prefix = 'p') => Array.from({ length: n }, (_, i) => soulSeed({ eventId: 'evt_decor', participantId: `${prefix}${i}`, roundId: 'round_1' }));
const kindsOf = (charms) => { const out = split(0, 0, 0); for (const id of charms) out[CHARM_BY_ID.get(id).kind] += 1; return out; };
const MIXED = { domainCounts: { Development: 10, Design: 8, Cloud: 4, 'IT Security': 2, Data: 1 }, selectedKinds: split(7, 6, 12), matchedKinds: split(1, 3, 3) };
/** The v2 config the stage-12 builder made for the same inputs: the v3 config without plate, eyes and topper. */
const asV2 = ({ plate, eyes, topper, ...rest }) => ({ ...rest, version: 2 });

// ---- charm split -----------------------------------------------------------------------------------------------------
test('split: the spec examples (10/10/5 -> 4/4/2, 22 tech / 2 soft / 1 core -> 8/1/1, one kind only -> 10/0/0)', () => {
  assert.equal(SLOT_COUNT, 10);
  assert.deepEqual(splitCharmSlots({ technical: 10, core: 10, soft: 5 }), split(4, 4, 2));
  assert.deepEqual(splitCharmSlots({ technical: 22, soft: 2, core: 1 }), split(1, 8, 1));
  assert.deepEqual(splitCharmSlots({ technical: 25, soft: 0, core: 0 }), split(0, 10, 0));
  assert.deepEqual(splitCharmSlots({ core: 25 }), split(10, 0, 0));
  assert.deepEqual(splitCharmSlots({ soft: 25 }), split(0, 0, 10));
});

test('split: any kind picked gets at least one slot, taken from the kind with the most slots (24/1/0, 24/0/1, 1/1/23)', () => {
  assert.deepEqual(splitCharmSlots({ technical: 24, soft: 1 }), split(0, 9, 1));
  assert.deepEqual(splitCharmSlots({ technical: 24, core: 1 }), split(1, 9, 0));
  assert.deepEqual(splitCharmSlots({ soft: 24, core: 1 }), split(1, 0, 9));
  assert.deepEqual(splitCharmSlots({ technical: 1, soft: 1, core: 23 }), split(8, 1, 1));
  assert.deepEqual(splitCharmSlots({ core: 1, technical: 23, soft: 1 }), split(1, 8, 1));
  assert.deepEqual(splitCharmSlots({ core: 1, technical: 1, soft: 23 }), split(1, 1, 8));
});

test('split: remainder ties go core > technical > soft; slot-count ties give from the lower-priority kind', () => {
  // one leftover slot, equal remainders
  assert.deepEqual(splitCharmSlots(split(3, 11, 11)), split(1, 5, 4), 'technical beats soft');
  assert.deepEqual(splitCharmSlots(split(11, 11, 3)), split(5, 4, 1), 'core beats technical');
  assert.deepEqual(splitCharmSlots(split(11, 3, 11)), split(5, 1, 4), 'core beats soft');
  assert.deepEqual(splitCharmSlots(split(5, 5, 5)), split(4, 3, 3), 'three-way tie');
  assert.deepEqual(splitCharmSlots(split(1, 1, 1)), split(4, 3, 3), 'three-way tie, total 3');
  // the minimum slot is taken from a tie on slots: the lower-priority kind gives
  assert.deepEqual(splitCharmSlots(split(12, 12, 1)), split(5, 4, 1), 'core 5 / technical 5 -> technical gives');
  assert.deepEqual(splitCharmSlots(split(1, 12, 12)), split(1, 5, 4), 'technical 5 / soft 5 -> soft gives');
  assert.deepEqual(splitCharmSlots(split(12, 1, 12)), split(5, 1, 4), 'core 5 / soft 5 -> soft gives');
});

test('split: total 0 gives no slots; missing, negative and non-numeric counts count as 0', () => {
  assert.deepEqual(splitCharmSlots(split(0, 0, 0)), split(0, 0, 0));
  assert.deepEqual(splitCharmSlots({}), split(0, 0, 0));
  assert.deepEqual(splitCharmSlots(null), split(0, 0, 0));
  assert.deepEqual(splitCharmSlots({ core: -3, technical: 'many', soft: NaN }), split(0, 0, 0));
  assert.deepEqual(splitCharmSlots({ core: -3, technical: 25 }), split(0, 10, 0));
  assert.deepEqual(splitCharmSlots(split(1, 1, 1), 0), split(0, 0, 0));
  assert.deepEqual(splitCharmSlots(split(1, 1, 1), 2), split(1, 1, 0), 'fewer slots than kinds picked still terminates and sums up');
});

test('split: for every selection of 16 (the 4 x 4 board; 25 kept to show the rule is size-agnostic) the slots sum to 10, follow the kinds picked and stay within 2 of the exact share', () => {
  for (const [N, combos] of [[REQUIRED_SELECTIONS, 153], [25, 351]]) {
    let n = 0;
    for (let c = 0; c <= N; c++) for (let t = 0; t + c <= N; t++) {
      const counts = split(c, t, N - c - t);
      const s = splitCharmSlots(counts);
      assert.equal(s.core + s.technical + s.soft, 10, JSON.stringify(counts));
      for (const k of KINDS) {
        assert.equal(s[k] >= 1, counts[k] >= 1, `${k} ${JSON.stringify(counts)}`);
        assert.ok(Math.abs(s[k] - (10 * counts[k]) / N) < 2, `${k} near its share ${JSON.stringify(counts)} -> ${JSON.stringify(s)}`);
      }
      n += 1;
    }
    assert.equal(n, combos);
  }
  for (let total = 1; total <= 60; total++) {
    const c = total % 5, t = Math.floor((total - c) / 2);
    const s = splitCharmSlots(split(c, t, total - c - t));
    assert.equal(s.core + s.technical + s.soft, 10, `total ${total}`);
  }
});

test('kind counts come from the skill-master kind labels (unrelated to isCore); every catalogue skill has a kind', () => {
  assert.deepEqual(countSkillKinds(['Core Skill', 'Hard Skill', 'Hard Skill', 'Soft Skill', 'Critical Skill', undefined, null]), split(1, 2, 1));
  assert.deepEqual(countSkillKinds([]), split(0, 0, 0));
  assert.deepEqual(countSkillKinds(SKILL_MASTER.skills.map(s => s.kind)), split(7, 189, 22));
  const coreFlagOnly = SKILL_MASTER.skills.filter(s => s.isCore && s.kind !== 'Core Skill');
  assert.ok(coreFlagOnly.length > 0 && countSkillKinds(coreFlagOnly.map(s => s.kind)).core === 0, 'isCore does not make a skill a core-kind skill');
});

// ---- face -------------------------------------------------------------------------------------------------------------
test('face: the kind with the most matched tiles; ties core > technical > soft; no matches is nerdy', () => {
  assert.equal(faceForMatches(split(0, 0, 0)), 'nerdy');
  assert.equal(faceForMatches({}), 'nerdy');
  assert.equal(faceForMatches(undefined), 'nerdy');
  assert.equal(faceForMatches({ technical: 3 }), 'pirate');
  assert.equal(faceForMatches({ soft: 1 }), 'angel');
  assert.equal(faceForMatches({ core: 1 }), 'nerdy');
  assert.equal(faceForMatches(split(1, 4, 2)), 'pirate');
  assert.equal(faceForMatches(split(2, 1, 3)), 'angel');
  assert.equal(faceForMatches(split(1, 1, 0)), 'nerdy', 'core = technical -> core');
  assert.equal(faceForMatches(split(1, 0, 1)), 'nerdy', 'core = soft -> core');
  assert.equal(faceForMatches(split(0, 2, 2)), 'pirate', 'technical = soft -> technical');
  assert.equal(faceForMatches(split(2, 2, 2)), 'nerdy', 'three-way tie -> core');
  assert.equal(faceForMatches(split(1, 2, 2)), 'pirate');
});

// ---- seeded picks and determinism ---------------------------------------------------------------------------------------
test('determinism: the same seed and counts give the same config; the counts change only face and charms', () => {
  const [seed, other] = seeds(2);
  const a = decoratedSoulConfig(seed, MIXED);
  pickCharms(other, split(3, 3, 4)); decoratedSoulConfig(other, MIXED); // no hidden state between calls
  assert.deepEqual(decoratedSoulConfig(seed, MIXED), a);
  assert.deepEqual(decoratedSoulConfig(seed, JSON.parse(JSON.stringify(MIXED))), a);
  const b = decoratedSoulConfig(seed, { domainCounts: {}, selectedKinds: split(0, 25, 0), matchedKinds: split(0, 0, 4) });
  for (const k of ['version', 'catalog', 'seed', 'gradient', 'glow', 'plate', 'eyes', 'driftPhase']) assert.deepEqual(b[k], a[k], k);
  assert.equal(b.face, 'angel'); assert.deepEqual(kindsOf(b.charms), split(0, 10, 0));
  assert.notDeepEqual(decoratedSoulConfig(other, MIXED), a, 'another Soul record gets another config');
});

test('constellation and driftPhase are exactly the v1 values; glow is picked as in v1', () => {
  for (const seed of seeds(50)) {
    const v1 = soulConfigFromSeed(seed, MIXED.domainCounts);
    const cfg = decoratedSoulConfig(seed, MIXED);
    assert.deepEqual(cfg.constellation, v1.constellation); assert.equal(cfg.driftPhase, v1.driftPhase); assert.equal(cfg.glow, v1.glow); assert.equal(pickGlow(seed), v1.glow);
  }
  assert.deepEqual(decoratedSoulConfig('abc').constellation, []);
});

test('gradients: many seeds spread over all 12 roughly uniformly (chi-square, p > 0.001); glow covers all 3', () => {
  assert.equal(GRADIENTS.length, 12);
  const N = 12000; const hits = new Array(12).fill(0); const glows = new Array(3).fill(0);
  for (const seed of seeds(N)) { hits[pickGradient(seed)] += 1; glows[pickGlow(seed)] += 1; }
  const expected = N / 12;
  const chi2 = hits.reduce((a, o) => a + (o - expected) ** 2 / expected, 0);
  assert.ok(chi2 < 31.26, `chi-square ${chi2.toFixed(2)} over ${hits}`); // df 11, alpha 0.001
  for (const h of hits) assert.ok(Math.abs(h - expected) < expected * 0.15, `gradient share ${h} of ${N}`);
  for (const g of glows) assert.ok(Math.abs(g - N / 3) < (N / 3) * 0.1, `glow share ${g}`);
});

test('charms: the split of the config is the split of the selection; variants are distinct within a kind; the slot order is shuffled', () => {
  const selections = [split(10, 10, 5), split(1, 22, 2), split(0, 25, 0), split(7, 6, 12), split(1, 1, 23)];
  const slotKinds = Array.from({ length: SLOT_COUNT }, () => new Set());
  for (const [i, seed] of seeds(500).entries()) {
    const selectedKinds = selections[i % selections.length];
    const cfg = decoratedSoulConfig(seed, { selectedKinds, matchedKinds: split(0, 1, 0) });
    assert.equal(cfg.charms.length, SLOT_COUNT);
    assert.equal(new Set(cfg.charms).size, SLOT_COUNT, 'distinct charms');
    assert.deepEqual(kindsOf(cfg.charms), splitCharmSlots(selectedKinds));
    if (selectedKinds === selections[0]) cfg.charms.forEach((id, slot) => slotKinds[slot].add(CHARM_BY_ID.get(id).kind));
  }
  for (const [slot, kinds] of slotKinds.entries()) assert.equal(kinds.size, 3, `slot ${slot} holds every kind across seeds`);
});

test('charms: over many seeds every one of the 150 catalogue charms is used', () => {
  const seen = new Set();
  for (const seed of seeds(300)) for (const kind of KINDS) for (const id of pickCharms(seed, { [kind]: SLOT_COUNT })) seen.add(id);
  assert.equal(seen.size, CHARMS.length);
  assert.equal(CHARMS.length, 150);
});

test('charms: variants are keyed by the seed only, so one kind keeps its variants when another kind\'s count changes', () => {
  for (const seed of seeds(40)) {
    const a = pickCharms(seed, split(1, 8, 1)), b = pickCharms(seed, split(0, 9, 1)), c = pickCharms(seed, split(1, 9, 0));
    const tech = (ids) => ids.filter(id => CHARM_BY_ID.get(id).kind === 'technical');
    assert.deepEqual(pickCharms(seed, split(1, 8, 1)), a);
    assert.ok(new Set(tech(a)).isSubsetOf(new Set(tech(b))));
    assert.deepEqual(new Set(tech(b)), new Set(tech(c)));
    assert.equal(a.filter(id => id.startsWith('core-'))[0], c.filter(id => id.startsWith('core-'))[0]);
  }
});

// ---- config shape, contract and BR-17 -----------------------------------------------------------------------------------
test('each config version carries exactly its contract keys: v3 SoulConfig, v2 SoulConfigV2, v1 SoulConfigV1', () => {
  assert.equal(SOUL_CONFIG_VERSION, 3);
  const cfg = decoratedSoulConfig(seeds(1)[0], MIXED);
  assert.deepEqual(Object.keys(cfg), Object.keys(SOUL_CONFIG_SCHEMA_V3));
  assert.deepEqual(Object.keys(SOUL_CONFIG_SCHEMA_V3), Object.keys(realtime.shapes.SoulConfig), 'contracts/realtime-events.json shapes.SoulConfig');
  assert.deepEqual(Object.keys(SOUL_CONFIG_SCHEMA_V2), Object.keys(realtime.shapes.SoulConfigV2), 'contracts/realtime-events.json shapes.SoulConfigV2');
  assert.deepEqual(Object.keys(SOUL_CONFIG_SCHEMA), Object.keys(realtime.shapes.SoulConfigV1), 'contracts/realtime-events.json shapes.SoulConfigV1');
  assert.deepEqual(Object.keys(asV2(cfg)), ['version', 'catalog', 'seed', 'gradient', 'glow', 'face', 'charms', 'constellation', 'driftPhase']);
  assert.deepEqual(Object.keys(asV2(cfg)), Object.keys(SOUL_CONFIG_SCHEMA_V2));
  assert.equal(cfg.version, 3); assert.equal(cfg.catalog, CATALOG_VERSION);
  assert.equal(validateSoulConfig(cfg).ok, true); assert.equal(validateSoulConfig(asV2(cfg)).ok, true, 'the same decoration as a v2 config');
});

test('BR-17: built configs carry no forbidden field; each forbidden field (ranks and the raw inputs) is rejected', () => {
  for (const k of ['selectedKinds', 'matchedKinds', 'kindCounts', 'skillIds', 'matchedCount', 'rank', 'size', 'brightness', 'isWinner', 'platformId', 'roleId']) assert.ok(SOUL_FORBIDDEN_FIELDS.includes(k), k);
  const cfg = decoratedSoulConfig(seeds(1)[0], MIXED);
  for (const k of SOUL_FORBIDDEN_FIELDS) {
    assert.ok(!(k in cfg), k);
    const bad = validateSoulConfig({ ...cfg, [k]: 1 });
    assert.equal(bad.ok, false, k); assert.equal(bad.reason, `forbidden field ${k}`);
    assert.equal(validateSoulConfig({ ...soulConfigFromSeed('abc'), [k]: 1 }).ok, false, `v1 ${k}`);
  }
  assert.ok(!JSON.stringify(cfg).includes('Hard Skill') && !JSON.stringify(cfg).includes('skill_'), 'no skill-master data inside the config');
});

test('BR-17: malformed v2 configs are rejected', () => {
  const cfg = asV2(decoratedSoulConfig(seeds(1)[0], MIXED));
  assert.equal(validateSoulConfig(cfg).ok, true);
  const [a, b] = cfg.charms;
  const bad = {
    'gradient 12': { gradient: 12 }, 'gradient -1': { gradient: -1 }, 'gradient 1.5': { gradient: 1.5 }, 'glow 3': { glow: 3 },
    'face gold': { face: 'gold' }, 'face missing': { face: undefined }, 'face null with charms': { face: null },
    'nine charms': { charms: cfg.charms.slice(0, 9) }, 'eleven charms': { charms: [...cfg.charms, CHARMS.find(c => !cfg.charms.includes(c.id)).id] },
    'unknown charm': { charms: ['tech-crown', ...cfg.charms.slice(1)] }, 'duplicate charm': { charms: [a, a, ...cfg.charms.slice(2)] }, 'charms not an array': { charms: b },
    'catalog 0': { catalog: 0 }, 'future catalog': { catalog: CATALOG_VERSION + 1 }, 'seed not a string': { seed: 42 },
    'constellation too long': { constellation: new Array(6).fill({ domain: 'Cloud', weight: 0.1 }) }, 'driftPhase 2': { driftPhase: 2 },
    'unknown key': { sparkle: true }, 'a v3 key': { plate: 'round' },
  };
  for (const [name, patch] of Object.entries(bad)) assert.equal(validateSoulConfig({ ...cfg, ...patch }).ok, false, name);
  const { gradient, ...missing } = cfg;
  assert.equal(validateSoulConfig(missing).ok, false, 'missing key');
  for (const v of [null, undefined, 'config', 7, [], [cfg]]) assert.equal(validateSoulConfig(v).ok, false, String(v));
  assert.equal(validateSoulConfig({ ...cfg, charms: [] }).ok, true, 'a v2 face without charms is allowed (no kind counted)');
  for (const catalog of [1, 2]) assert.equal(validateSoulConfig({ ...cfg, catalog }).ok, true, `v2 with catalog ${catalog}`);
});

test('BR-17: the neutral fallback is a valid v2 config with no face, no charms, gradient 0 and glow 0 (still v2 under config v3)', () => {
  const n = neutralSoulConfig('abc');
  assert.deepEqual(n, { version: 2, catalog: CATALOG_VERSION, seed: 'abc', gradient: 0, glow: 0, face: null, charms: [], constellation: [], driftPhase: 0 });
  assert.notEqual(n.version, SOUL_CONFIG_VERSION, 'v3 has no undecorated form, so the fallback stays v2');
  assert.equal(validateSoulConfig(n).ok, true);
  assert.deepEqual(Object.keys(n), Object.keys(SOUL_CONFIG_SCHEMA_V2));
  // the service path: an invalid config is replaced by the neutral one
  const served = (cfg, seed) => (validateSoulConfig(cfg).ok ? cfg : neutralSoulConfig(seed));
  const invalid = { ...decoratedSoulConfig('abc', MIXED), matchedCount: 7 };
  assert.deepEqual(served(invalid, 'abc'), n);
});

test('garbage inputs never throw; with no kind counted there are no charms, v3 rejects that and the neutral v2 Soul is served', () => {
  const seed = seeds(1)[0];
  const served = (cfg) => (validateSoulConfig(cfg).ok ? cfg : neutralSoulConfig(seed));
  for (const inputs of [undefined, {}, { selectedKinds: null, matchedKinds: null, domainCounts: null }, { selectedKinds: { core: 'x', technical: -4, soft: Infinity }, matchedKinds: { technical: NaN } }]) {
    const cfg = decoratedSoulConfig(seed, inputs);
    assert.deepEqual(decoratedSoulConfig(seed, inputs), cfg, 'still deterministic');
    assert.deepEqual(cfg.charms, [], 'no kinds counted -> no charms'); assert.equal(cfg.face, 'nerdy');
    assert.deepEqual(validateSoulConfig(cfg), { ok: false, reason: 'charms must fill every slot' }, JSON.stringify(inputs));
    assert.deepEqual(served(cfg), neutralSoulConfig(seed));
  }
  assert.equal(validateSoulConfig(decoratedSoulConfig(seed, { selectedKinds: { soft: 1, technical: 'x' } })).ok, true, 'one kind counted is enough for a valid v3 Soul');
});
