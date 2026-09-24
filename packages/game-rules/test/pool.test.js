import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDrawPool, boardCanWin, readiness, isEligibleSkill } from '../src/pool.js';
import { SKILLS, ELIGIBLE_IDS, OPTIONAL_IDS, cellsFrom } from './helpers.js';

test('BR-08: pool contains only Core/Critical active skills present on active boards, unique', () => {
  const b1 = { cells: cellsFrom([...ELIGIBLE_IDS.slice(0, 10), ...OPTIONAL_IDS.slice(0, 15)]) };
  const b2 = { cells: cellsFrom([...ELIGIBLE_IDS.slice(5, 20), ...OPTIONAL_IDS.slice(10, 20)]) };
  const pool = buildDrawPool([b1, b2], SKILLS);
  assert.deepEqual(pool, ELIGIBLE_IDS.slice(0, 20));
  for (const id of pool) assert.ok(isEligibleSkill(SKILLS.get(id)));
  for (const id of OPTIONAL_IDS.slice(0, 20)) assert.ok(!pool.includes(id));
});
test('inactive skills are excluded', () => {
  const skills = new Map(SKILLS); const id = ELIGIBLE_IDS[0];
  skills.set(id, { ...skills.get(id), status: 'inactive' });
  assert.ok(!buildDrawPool([{ cells: cellsFrom(ELIGIBLE_IDS.slice(0, 25)) }], skills).includes(id));
});
test('A-03 / OD-07: readiness reports pool size and whether any board can win', () => {
  const winnable = { cells: cellsFrom(ELIGIBLE_IDS.slice(0, 25)) };
  const r1 = readiness([winnable], SKILLS);
  assert.equal(r1.poolSize, 25); assert.equal(r1.canStart, true); assert.equal(r1.anyBoardCanWin, true);
  // A board with one optional skill per line cannot complete any line: place optionals on the anti-diagonal + others.
  const ids = ELIGIBLE_IDS.slice(0, 25).slice();
  // positions covering every row, col, and both diagonals: 4,8,12,16,20 (anti-diag) hit rows 0-4 and cols 4,3,2,1,0 and main diag at 12.
  for (const [i, p] of [4, 8, 12, 16, 20].entries()) ids[p] = OPTIONAL_IDS[i];
  const blocked = { cells: cellsFrom(ids) };
  const r2 = readiness([blocked], SKILLS);
  assert.equal(r2.anyBoardCanWin, false); assert.equal(r2.boardsThatCanWin, 0); assert.equal(r2.canStart, true);
  const tiny = readiness([{ cells: cellsFrom([...ELIGIBLE_IDS.slice(0, 4), ...OPTIONAL_IDS.slice(0, 21)]) }], SKILLS);
  assert.equal(tiny.poolSize, 4); assert.equal(tiny.canStart, false);
  assert.equal(boardCanWin(winnable.cells, new Set(ELIGIBLE_IDS.slice(0, 5))), true);
});
