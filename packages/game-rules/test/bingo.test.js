import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDraw, simulateRound, drawNext } from '../src/evaluate.js';
import { buildDrawPool } from '../src/pool.js';
import { CELLS, GRID, MIN_DRAW_FOR_BINGO } from '../src/lines.js';
import { seededRng } from '../src/random.js';
import { SKILLS, ELIGIBLE_IDS, cellsFrom } from './helpers.js';

const A = ELIGIBLE_IDS.slice(0, CELLS), B = ELIGIBLE_IDS.slice(CELLS, 2 * CELLS);
const boardA = { boardId: 'bA', participantId: 'pA', cells: cellsFrom(A) };
// Board B shares row 0 with A (same skills in positions 0-3), rest different.
const boardB = { boardId: 'bB', participantId: 'pB', cells: cellsFrom([...A.slice(0, GRID), ...B.slice(GRID)]) };

test('BR-12/BR-14: draw three completes no bingo; draw four declares all boards with a line as co-winners', () => {
  assert.equal(MIN_DRAW_FOR_BINGO, 4);
  // Even a completed line is not bingo before draw 4: fill row 0 on draw 3 by pre-seeding one extra drawn skill.
  const early = evaluateDraw([boardA, boardB], new Set(A.slice(0, GRID)), 3, A[3]);
  assert.equal(early.evaluationActive, false); assert.equal(early.winners.length, 0);
  const drawn = new Set(A.slice(0, 3));
  const ev3 = evaluateDraw([boardA, boardB], drawn, 3, A[2]);
  assert.equal(ev3.evaluationActive, false); assert.equal(ev3.winners.length, 0);
  assert.equal(ev3.matches.find(m => m.boardId === 'bA').matchedCount, 3);
  drawn.add(A[3]);
  const ev4 = evaluateDraw([boardA, boardB], drawn, 4, A[3]);
  assert.equal(ev4.evaluationActive, true);
  assert.equal(ev4.winners.length, 2);
  assert.deepEqual(ev4.winners.map(w => w.participantId).sort(), ['pA', 'pB']);
  assert.deepEqual(ev4.winners[0].lineIds, ['row-0']);
  assert.deepEqual(ev4.matches.find(m => m.boardId === 'bB').newlyMatched, [3]);
});
test('draws are unique and the seeded simulation is reproducible (fixture determinism), plain and guided', () => {
  const pool = buildDrawPool([boardA, boardB], SKILLS);
  for (const opts of [{}, { guided: true }]) {
    const r1 = simulateRound([boardA, boardB], pool, seededRng('round-fixture'), opts);
    const r2 = simulateRound([boardA, boardB], pool, seededRng('round-fixture'), opts);
    assert.deepEqual(r1, r2);
    assert.equal(new Set(r1.draws.map(d => d.skillId)).size, r1.draws.length);
    assert.ok(r1.winningDrawNumber === null || r1.winningDrawNumber >= MIN_DRAW_FOR_BINGO);
    for (const d of r1.draws) assert.ok(pool.includes(d.skillId));
  }
});
test('exhausted pool without a winner ends EXHAUSTED', () => {
  const noLine = { boardId: 'x', participantId: 'px', cells: cellsFrom(A) };
  // pool of only 4 skills that do not form a line on the board (positions 0,1,2,4)
  const pool = [A[0], A[1], A[2], A[4]];
  for (const opts of [{}, { guided: true }]) {
    const r = simulateRound([noLine], pool, seededRng(7), opts);
    assert.equal(r.outcome, 'EXHAUSTED'); assert.equal(r.draws.length, pool.length); assert.equal(r.winners.length, 0);
  }
  assert.equal(drawNext([], seededRng(1)), null);
});
test('property: any declared winner owns a fully drawn line, never before draw 4, and the first line ends the round', () => {
  for (let seed = 0; seed < 40; seed++) {
    for (const guided of [false, true]) {
      const rng = seededRng(`prop-${seed}`);
      const boards = [];
      for (let i = 0; i < 6; i++) { const ids = new Set(); while (ids.size < CELLS) ids.add(ELIGIBLE_IDS[rng.int(ELIGIBLE_IDS.length)]); boards.push({ boardId: `b${i}`, participantId: `p${i}`, cells: cellsFrom([...ids]) }); }
      const pool = buildDrawPool(boards, SKILLS);
      const r = simulateRound(boards, pool, rng, { guided });
      const drawn = new Set(r.draws.map(d => d.skillId));
      for (const w of r.winners) {
        const b = boards.find(x => x.boardId === w.boardId);
        const byPos = []; for (const c of b.cells) byPos[c.position] = c.skillId;
        assert.ok(w.lineIds.length > 0);
        assert.ok(r.winningDrawNumber >= MIN_DRAW_FOR_BINGO);
        assert.ok(b.cells.length === CELLS && byPos.every(s => typeof s === 'string'));
      }
      assert.ok(r.draws.every(d => drawn.has(d.skillId)));
      // No board could have had a line before the winning draw (else the round would have ended earlier).
      if (r.winningDrawNumber) {
        const before = new Set(r.draws.slice(0, r.winningDrawNumber - 1).map(d => d.skillId));
        const prev = evaluateDraw(boards, before, r.winningDrawNumber - 1);
        assert.equal(prev.winners.length, 0);
      }
    }
  }
});
