import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soulSeed, soulConfigFromSeed, validateSoulConfig, neutralSoulConfig, SOUL_TRAITS } from '../src/soul.js';
import { matrixInsight } from '../src/insight.js';

test('same seed yields the same config; different record yields a different seed', () => {
  const s1 = soulSeed({ eventId: 'evt_1', participantId: 'p_1', roundId: 'r_1' });
  assert.equal(s1, soulSeed({ eventId: 'evt_1', participantId: 'p_1', roundId: 'r_1' }));
  assert.notEqual(s1, soulSeed({ eventId: 'evt_1', participantId: 'p_2', roundId: 'r_1' }));
  const c1 = soulConfigFromSeed(s1, { Development: 10, Design: 8, Cloud: 4, 'IT Security': 2, Data: 1 });
  assert.deepEqual(c1, soulConfigFromSeed(s1, { Development: 10, Design: 8, Cloud: 4, 'IT Security': 2, Data: 1 }));
  assert.equal(validateSoulConfig(c1).ok, true);
  assert.equal(c1.constellation.length, 5);
  assert.equal(c1.constellation[0].domain, 'Development');
});
test('BR-17: config carries no rank/size/role fields and rejects forbidden ones', () => {
  const cfg = soulConfigFromSeed('abc', {});
  for (const k of ['platformId', 'roleId', 'size', 'rank', 'isWinner', 'inMatrixCount']) assert.ok(!(k in cfg));
  assert.equal(validateSoulConfig({ ...cfg, rank: 1 }).ok, false);
  assert.equal(validateSoulConfig({ ...cfg, body: 99 }).ok, false);
  assert.equal(validateSoulConfig(neutralSoulConfig('abc')).ok, true);
});
test('trait distribution covers every option across many seeds (no dead traits)', () => {
  const seen = Object.fromEntries(Object.keys(SOUL_TRAITS).map(k => [k, new Set()]));
  for (let i = 0; i < 500; i++) { const c = soulConfigFromSeed(soulSeed({ eventId: 'e', participantId: `p${i}`, roundId: 'r' })); for (const k of Object.keys(seen)) seen[k].add(c[k]); }
  for (const k of Object.keys(seen)) assert.equal(seen[k].size, SOUL_TRAITS[k].length, k);
});
test('matrix insight counts in/beyond', () => {
  const r = matrixInsight(['a', 'b', 'c'], new Set(['a', 'z']), 'v1');
  assert.deepEqual(r, { matrixVersion: 'v1', totalSelected: 3, inMatrixCount: 1, beyondMatrixCount: 2 });
});
