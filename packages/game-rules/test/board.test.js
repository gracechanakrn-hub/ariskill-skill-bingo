import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSelections, isComplete, randomizeBoard, matchMask } from '../src/board.js';
import { seededRng } from '../src/random.js';
import { SKILLS, ELIGIBLE_IDS } from './helpers.js';

test('BR-02: duplicates rejected with E4, more than 25 rejected, unknown rejected', () => {
  const ids = ELIGIBLE_IDS.slice(0, 25);
  assert.equal(validateSelections(ids, SKILLS).ok, true);
  const dup = validateSelections([...ids.slice(0, 24), ids[0]], SKILLS);
  assert.equal(dup.ok, false); assert.equal(dup.code, 'DUPLICATE_SKILL'); assert.equal(dup.exceptionId, 'E4');
  assert.equal(validateSelections(ELIGIBLE_IDS.slice(0, 26), SKILLS).ok, false);
  assert.equal(validateSelections([...ids.slice(0, 24), 'skill_nope'], SKILLS).ok, false);
  assert.equal(isComplete(ids, SKILLS), true);
  assert.equal(isComplete(ids.slice(0, 24), SKILLS), false);
});
test('BR-04: randomization is a permutation of the 25 skills and is deterministic for a seed', () => {
  const ids = ELIGIBLE_IDS.slice(0, 25);
  const a = randomizeBoard(ids, seededRng('fixture-1'));
  const b = randomizeBoard(ids, seededRng('fixture-1'));
  const c = randomizeBoard(ids, seededRng('fixture-2'));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(a.map(x => x.position), [...Array(25).keys()]);
  assert.deepEqual(a.map(x => x.skillId).sort(), ids.slice().sort());
  assert.throws(() => randomizeBoard(ids.slice(0, 24), seededRng(1)));
});
test('matchMask marks only drawn skills', () => {
  const ids = ELIGIBLE_IDS.slice(0, 25);
  const cells = ids.map((skillId, position) => ({ position, skillId }));
  assert.equal(matchMask(cells, new Set()), 0);
  assert.equal(matchMask(cells, new Set([ids[0], ids[24]])), (1 | (1 << 24)) >>> 0);
});
