import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_MASKS, completedLines, bingoLines, maskFromPositions, isEvaluationActive, bestLineProgress } from '../src/lines.js';
import rules from '../../../contracts/bingo-rules.json' with { type: 'json' };

test('exactly 12 lines matching the contract', () => {
  assert.equal(LINE_MASKS.length, 12);
  const contract = rules.evaluation.lines.masks;
  for (const c of contract) { const l = LINE_MASKS.find(x => x.id === c.id); assert.ok(l, c.id); assert.deepEqual([...l.positions], c.positions); }
});
test('every line has 5 distinct positions and masks are unique', () => {
  const masks = new Set();
  for (const l of LINE_MASKS) { assert.equal(new Set(l.positions).size, 5); masks.add(l.mask); }
  assert.equal(masks.size, 12);
});
test('completedLines finds rows, columns, diagonals', () => {
  assert.deepEqual(completedLines(maskFromPositions([0, 1, 2, 3, 4])).map(l => l.id), ['row-0']);
  assert.deepEqual(completedLines(maskFromPositions([4, 8, 12, 16, 20])).map(l => l.id), ['diag-anti']);
  assert.deepEqual(completedLines(maskFromPositions([0, 5, 10, 15, 20, 1, 2, 3, 4])).map(l => l.id).sort(), ['col-0', 'row-0']);
  assert.equal(completedLines(maskFromPositions([0, 1, 2, 3])).length, 0);
});
test('BR-12: no bingo before draw 5 even with a full line', () => {
  const full = maskFromPositions([0, 1, 2, 3, 4]);
  for (const n of [1, 2, 3, 4]) { assert.equal(isEvaluationActive(n), false); assert.deepEqual(bingoLines(full, n), []); }
  assert.equal(isEvaluationActive(5), true);
  assert.deepEqual(bingoLines(full, 5), ['row-0']);
  assert.deepEqual(bingoLines(full, 17), ['row-0']);
});
test('bestLineProgress', () => { assert.equal(bestLineProgress(maskFromPositions([0, 1, 2, 3])), 4); assert.equal(bestLineProgress(0), 0); });
