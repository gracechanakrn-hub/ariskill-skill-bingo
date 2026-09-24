import { bingoLines, isEvaluationActive } from './lines.js';
import { matchMask } from './board.js';
import { pickOne } from './random.js';

/** Choose the next skill from the remaining pool (BR-10). Returns skillId. */
export function drawNext(remainingPool, rng) { if (!remainingPool.length) return null; return pickOne(remainingPool, rng); }

/**
 * Evaluate all active boards after draw `drawNumber` whose cumulative drawn set is `drawnSet`.
 * activeBoards: [{ boardId, participantId, cells }]
 * Returns { drawNumber, evaluationActive, matches: [{boardId, participantId, mask, matchedCount, newlyMatched:int[]}], winners: [{boardId, participantId, lineIds}] }
 */
export function evaluateDraw(activeBoards, drawnSet, drawNumber, newSkillId) {
  const matches = [];
  const winners = [];
  for (const b of activeBoards) {
    const mask = matchMask(b.cells, drawnSet);
    let count = 0; for (let p = 0; p < 25; p++) if (mask & (1 << p)) count++;
    const newlyMatched = newSkillId ? b.cells.filter(c => c.skillId === newSkillId).map(c => c.position) : [];
    matches.push({ boardId: b.boardId, participantId: b.participantId, mask, matchedCount: count, newlyMatched });
    const lines = bingoLines(mask, drawNumber);
    if (lines.length) winners.push({ boardId: b.boardId, participantId: b.participantId, lineIds: lines });
  }
  return { drawNumber, evaluationActive: isEvaluationActive(drawNumber), matches, winners };
}

/**
 * Deterministically simulate a whole round for fixtures/tests.
 * Returns { draws: [{number, skillId}], winners, winningDrawNumber|null, outcome: 'WINNER'|'EXHAUSTED' }
 */
export function simulateRound(activeBoards, pool, rng) {
  let remaining = pool.slice();
  const drawn = new Set();
  const draws = [];
  let n = 0;
  while (remaining.length) {
    n += 1;
    const skillId = drawNext(remaining, rng);
    remaining = remaining.filter(s => s !== skillId);
    drawn.add(skillId);
    draws.push({ number: n, skillId });
    const ev = evaluateDraw(activeBoards, drawn, n, skillId);
    if (ev.winners.length) return { draws, winners: ev.winners, winningDrawNumber: n, outcome: 'WINNER' };
  }
  return { draws, winners: [], winningDrawNumber: null, outcome: 'EXHAUSTED' };
}
