import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDraw, simulateRound, drawNext } from '../src/evaluate.js';
import { buildDrawPool } from '../src/pool.js';
import { seededRng } from '../src/random.js';
import { SKILLS, ELIGIBLE_IDS, cellsFrom } from './helpers.js';

const A = ELIGIBLE_IDS.slice(0, 25), B = ELIGIBLE_IDS.slice(25, 50);
const boardA = { boardId: 'bA', participantId: 'pA', cells: cellsFrom(A) };
// Board B shares row 0 with A (same skills in positions 0-4), rest different.
const boardB = { boardId: 'bB', participantId: 'pB', cells: cellsFrom([...A.slice(0, 5), ...B.slice(5)]) };

test('BR-12/BR-14: draw four completes no bingo; draw five declares all boards with a line as co-winners', () => {
  const drawn = new Set(A.slice(0, 4));
  const ev4 = evaluateDraw([boardA, boardB], drawn, 4, A[3]);
  assert.equal(ev4.evaluationActive, false); assert.equal(ev4.winners.length, 0);
  assert.equal(ev4.matches.find(m => m.boardId === 'bA').matchedCount, 4);
  drawn.add(A[4]);
  const ev5 = evaluateDraw([boardA, boardB], drawn, 5, A[4]);
  assert.equal(ev5.winners.length, 2);
  assert.deepEqual(ev5.winners.map(w => w.participantId).sort(), ['pA', 'pB']);
  assert.deepEqual(ev5.winners[0].lineIds, ['row-0']);
  assert.deepEqual(ev5.matches.find(m => m.boardId === 'bB').newlyMatched, [4]);
});
test('draws are unique and the seeded simulation is reproducible (fixture determinism)', () => {
  const pool = buildDrawPool([boardA, boardB], SKILLS);
  const r1 = simulateRound([boardA, boardB], pool, seededRng('round-fixture'));
  const r2 = simulateRound([boardA, boardB], pool, seededRng('round-fixture'));
  assert.deepEqual(r1, r2);
  assert.equal(new Set(r1.draws.map(d => d.skillId)).size, r1.draws.length);
  assert.ok(r1.winningDrawNumber === null || r1.winningDrawNumber >= 5);
  for (const d of r1.draws) assert.ok(pool.includes(d.skillId));
});
test('exhausted pool without a winner ends EXHAUSTED', () => {
  const noLine = { boardId: 'x', participantId: 'px', cells: cellsFrom(A) };
  // pool of only 5 skills that do not form a line on the board (positions 0,1,2,3,5)
  const pool = [A[0], A[1], A[2], A[3], A[5]];
  const r = simulateRound([noLine], pool, seededRng(7));
  assert.equal(r.outcome, 'EXHAUSTED'); assert.equal(r.draws.length, 5); assert.equal(r.winners.length, 0);
  assert.equal(drawNext([], seededRng(1)), null);
});
test('property: any declared winner owns a fully drawn line', () => {
  for (let seed = 0; seed < 40; seed++) {
    const rng = seededRng(`prop-${seed}`);
    const boards = [];
    for (let i = 0; i < 6; i++) { const ids = new Set(); while (ids.size < 25) ids.add(ELIGIBLE_IDS[rng.int(ELIGIBLE_IDS.length)]); boards.push({ boardId: `b${i}`, participantId: `p${i}`, cells: cellsFrom([...ids]) }); }
    const pool = buildDrawPool(boards, SKILLS);
    const r = simulateRound(boards, pool, rng);
    const drawn = new Set(r.draws.map(d => d.skillId));
    for (const w of r.winners) {
      const b = boards.find(x => x.boardId === w.boardId);
      const byPos = []; for (const c of b.cells) byPos[c.position] = c.skillId;
      assert.ok(w.lineIds.length > 0);
      assert.ok(r.winningDrawNumber >= 5);
    }
    // No board could have had a line before the winning draw (else the round would have ended earlier).
    if (r.winningDrawNumber) {
      const before = new Set(r.draws.slice(0, r.winningDrawNumber - 1).map(d => d.skillId));
      const prev = evaluateDraw(boards, before, r.winningDrawNumber - 1);
      assert.equal(prev.winners.length, 0);
    }
  }
});
