import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_MASKS, GRID, CELLS, MIN_DRAW_FOR_BINGO, completedLines, bingoLines, maskFromPositions, isEvaluationActive, bestLineProgress } from '../src/lines.js';
import rules from '../../../contracts/bingo-rules.json' with { type: 'json' };

test('grid, cells and draw boundary match the contract (4 x 4, 16 cells, bingo from draw 4)', () => {
  assert.equal(GRID, rules.grid.size); assert.equal(CELLS, rules.grid.cells); assert.equal(CELLS, GRID * GRID);
  assert.equal(GRID, 4); assert.equal(CELLS, 16);
  assert.equal(MIN_DRAW_FOR_BINGO, rules.evaluation.minDrawForBingo); assert.equal(MIN_DRAW_FOR_BINGO, GRID);
});
test('exactly 10 lines matching the contract', () => {
  assert.equal(LINE_MASKS.length, 10);
  assert.equal(rules.evaluation.lines.count, LINE_MASKS.length);
  const contract = rules.evaluation.lines.masks;
  assert.equal(contract.length, LINE_MASKS.length);
  for (const c of contract) { const l = LINE_MASKS.find(x => x.id === c.id); assert.ok(l, c.id); assert.deepEqual([...l.positions], c.positions); }
});
test('every line has GRID distinct in-range positions and masks are unique', () => {
  const masks = new Set();
  for (const l of LINE_MASKS) {
    assert.equal(new Set(l.positions).size, GRID);
    assert.ok(l.positions.every(p => p >= 0 && p < CELLS));
    assert.equal(l.mask, maskFromPositions(l.positions));
    masks.add(l.mask);
  }
  assert.equal(masks.size, LINE_MASKS.length);
});
test('completedLines finds rows, columns, diagonals', () => {
  assert.deepEqual(completedLines(maskFromPositions([0, 1, 2, 3])).map(l => l.id), ['row-0']);
  assert.deepEqual(completedLines(maskFromPositions([3, 6, 9, 12])).map(l => l.id), ['diag-anti']);
  assert.deepEqual(completedLines(maskFromPositions([0, 5, 10, 15])).map(l => l.id), ['diag-main']);
  assert.deepEqual(completedLines(maskFromPositions([0, 4, 8, 12, 1, 2, 3])).map(l => l.id).sort(), ['col-0', 'row-0']);
  assert.equal(completedLines(maskFromPositions([0, 1, 2])).length, 0);
  assert.equal(completedLines(maskFromPositions([...Array(CELLS).keys()])).length, LINE_MASKS.length);
});
test('BR-12: no bingo before draw 4 even with a full line', () => {
  const full = maskFromPositions([0, 1, 2, 3]);
  for (const n of [0, 1, 2, 3]) { assert.equal(isEvaluationActive(n), false); assert.deepEqual(bingoLines(full, n), []); }
  assert.equal(isEvaluationActive(4), true);
  assert.deepEqual(bingoLines(full, 4), ['row-0']);
  assert.deepEqual(bingoLines(full, 17), ['row-0']);
});
test('bestLineProgress', () => { assert.equal(bestLineProgress(maskFromPositions([0, 1, 2])), 3); assert.equal(bestLineProgress(maskFromPositions([0, 1, 2, 3])), 4); assert.equal(bestLineProgress(0), 0); });
