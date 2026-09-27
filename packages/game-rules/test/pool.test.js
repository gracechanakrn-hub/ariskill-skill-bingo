import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDrawPool, boardCanWin, readiness, isEligibleSkill, POOL_MINIMUM } from '../src/pool.js';
import { CELLS, LINE_MASKS } from '../src/lines.js';
import { SKILLS, ELIGIBLE_IDS, CORE_CRITICAL_IDS, OPTIONAL_IDS, cellsFrom } from './helpers.js';

test('BR-08 / D-33: pool contains every active skill present on an active board (any kind), unique', () => {
  const b1 = { cells: cellsFrom([...CORE_CRITICAL_IDS.slice(0, 6), ...OPTIONAL_IDS.slice(0, 10)]) };
  const b2 = { cells: cellsFrom([...CORE_CRITICAL_IDS.slice(3, 12), ...OPTIONAL_IDS.slice(5, 12)]) };
  const pool = buildDrawPool([b1, b2], SKILLS);
  const expected = [...new Set([...b1.cells, ...b2.cells].map(c => c.skillId))].sort();
  assert.deepEqual(pool, expected);
  assert.equal(new Set(pool).size, pool.length);
  for (const id of pool) assert.ok(isEligibleSkill(SKILLS.get(id)));
  for (const id of OPTIONAL_IDS.slice(0, 12)) assert.ok(pool.includes(id), `non-core/critical ${id} is drawable`);
  // skills on no active board are never in the pool
  for (const id of ELIGIBLE_IDS) if (!expected.includes(id)) assert.ok(!pool.includes(id));
});
test('isEligibleSkill: any active skill of any kind; inactive or unknown never', () => {
  for (const kind of new Set([...SKILLS.values()].map(s => s.kind))) {
    const s = [...SKILLS.values()].find(x => x.kind === kind && x.status === 'active');
    assert.equal(isEligibleSkill(s), true, kind);
    assert.equal(isEligibleSkill({ ...s, status: 'inactive' }), false, kind);
  }
  assert.equal(isEligibleSkill(undefined), false);
});
test('inactive skills are excluded', () => {
  const skills = new Map(SKILLS); const id = ELIGIBLE_IDS[0]; const opt = OPTIONAL_IDS.find(o => !ELIGIBLE_IDS.slice(0, CELLS - 1).includes(o));
  skills.set(id, { ...skills.get(id), status: 'inactive' });
  skills.set(opt, { ...skills.get(opt), status: 'inactive' });
  const pool = buildDrawPool([{ cells: cellsFrom([...ELIGIBLE_IDS.slice(0, CELLS - 1), opt]) }], skills);
  assert.ok(!pool.includes(id)); assert.ok(!pool.includes(opt)); assert.equal(pool.length, CELLS - 2);
});
test('A-03 / OD-07: readiness reports pool size and whether any board can win', () => {
  const winnable = { cells: cellsFrom(ELIGIBLE_IDS.slice(0, CELLS)) };
  const r1 = readiness([winnable], SKILLS);
  assert.equal(r1.poolSize, CELLS); assert.equal(r1.canStart, true); assert.equal(r1.anyBoardCanWin, true); assert.equal(r1.poolMinimum, POOL_MINIMUM);
  // A board with one inactive skill on every line cannot complete any line. Positions 1, 7, 8, 14 hit every row and
  // column; 5 (main diagonal) and 6 (anti-diagonal) block the diagonals.
  const blockers = [1, 5, 6, 8, 14, 7];
  const ids = ELIGIBLE_IDS.slice(0, CELLS);
  const skills = new Map(SKILLS);
  for (const p of blockers) skills.set(ids[p], { ...skills.get(ids[p]), status: 'inactive' });
  for (const l of LINE_MASKS) assert.ok(l.positions.some(p => blockers.includes(p)), `${l.id} blocked`);
  const blocked = { cells: cellsFrom(ids) };
  const r2 = readiness([blocked], skills);
  assert.equal(r2.anyBoardCanWin, false); assert.equal(r2.boardsThatCanWin, 0); assert.equal(r2.canStart, true); assert.equal(r2.poolSize, CELLS - blockers.length);
  // pool below the minimum cannot start
  const tinySkills = new Map(SKILLS); const tinyIds = ELIGIBLE_IDS.slice(0, CELLS);
  for (const id of tinyIds.slice(POOL_MINIMUM - 1)) tinySkills.set(id, { ...tinySkills.get(id), status: 'inactive' });
  const tiny = readiness([{ cells: cellsFrom(tinyIds) }], tinySkills);
  assert.equal(tiny.poolSize, POOL_MINIMUM - 1); assert.equal(tiny.canStart, false);
  assert.equal(boardCanWin(winnable.cells, new Set(ELIGIBLE_IDS.slice(0, 4))), true);
  assert.equal(boardCanWin(winnable.cells, new Set(ELIGIBLE_IDS.slice(0, 3))), false);
});
