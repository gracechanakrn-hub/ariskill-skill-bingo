import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSelections, isComplete, randomizeBoard, randomizePartialBoard, matchMask, REQUIRED_SELECTIONS } from '../src/board.js';
import { CELLS } from '../src/lines.js';
import { seededRng } from '../src/random.js';
import { SKILLS, ELIGIBLE_IDS } from './helpers.js';

const N = REQUIRED_SELECTIONS;
test('REQUIRED_SELECTIONS is one skill per cell (16)', () => { assert.equal(N, CELLS); assert.equal(N, 16); });
test('BR-02: duplicates rejected with E4, more than 16 rejected, unknown rejected', () => {
  const ids = ELIGIBLE_IDS.slice(0, N);
  assert.equal(validateSelections(ids, SKILLS).ok, true);
  const dup = validateSelections([...ids.slice(0, N - 1), ids[0]], SKILLS);
  assert.equal(dup.ok, false); assert.equal(dup.code, 'DUPLICATE_SKILL'); assert.equal(dup.exceptionId, 'E4');
  assert.equal(validateSelections(ELIGIBLE_IDS.slice(0, N + 1), SKILLS).ok, false);
  assert.equal(validateSelections([...ids.slice(0, N - 1), 'skill_nope'], SKILLS).ok, false);
  assert.equal(isComplete(ids, SKILLS), true);
  assert.equal(isComplete(ids.slice(0, N - 1), SKILLS), false);
});
test('BR-04: randomization is a permutation of the 16 skills and is deterministic for a seed', () => {
  const ids = ELIGIBLE_IDS.slice(0, N);
  const a = randomizeBoard(ids, seededRng('fixture-1'));
  const b = randomizeBoard(ids, seededRng('fixture-1'));
  const c = randomizeBoard(ids, seededRng('fixture-2'));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(a.map(x => x.position), [...Array(CELLS).keys()]);
  assert.deepEqual(a.map(x => x.skillId).sort(), ids.slice().sort());
  assert.throws(() => randomizeBoard(ids.slice(0, N - 1), seededRng(1)));
  assert.throws(() => randomizeBoard(ELIGIBLE_IDS.slice(0, N + 1), seededRng(1)));
});
test('matchMask marks only drawn skills', () => {
  const ids = ELIGIBLE_IDS.slice(0, N);
  const cells = ids.map((skillId, position) => ({ position, skillId }));
  assert.equal(matchMask(cells, new Set()), 0);
  assert.equal(matchMask(cells, new Set([ids[0], ids[N - 1]])), (1 | (1 << (N - 1))) >>> 0);
});
test('D-53 randomizePartialBoard: 1-16 skills land on unique random cells, the rest stay blank; 0 or 17 throw RangeError', () => {
  for (let n = 1; n <= N; n++) {
    const ids = ELIGIBLE_IDS.slice(0, n);
    const cells = randomizePartialBoard(ids, seededRng(`partial-${n}`));
    assert.equal(cells.length, n);
    const positions = cells.map(c => c.position);
    assert.equal(new Set(positions).size, n, 'unique positions');
    assert.deepEqual(positions, positions.slice().sort((a, b) => a - b), 'position order');
    for (const p of positions) assert.ok(Number.isInteger(p) && p >= 0 && p < CELLS);
    assert.deepEqual(cells.map(c => c.skillId).sort(), ids.slice().sort(), 'every skill placed once');
    assert.deepEqual(randomizePartialBoard(ids, seededRng(`partial-${n}`)), cells, 'deterministic for a seed');
  }
  // positions really vary across seeds for a small board
  const layouts = new Set(); for (let s = 0; s < 20; s++) layouts.add(randomizePartialBoard(ELIGIBLE_IDS.slice(0, 3), seededRng(`vary-${s}`)).map(c => c.position).join(','));
  assert.ok(layouts.size > 1);
  assert.throws(() => randomizePartialBoard([], seededRng(1)), RangeError);
  assert.throws(() => randomizePartialBoard(ELIGIBLE_IDS.slice(0, N + 1), seededRng(1)), RangeError);
});
