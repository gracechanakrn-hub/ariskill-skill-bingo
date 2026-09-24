import { LINE_MASKS } from './lines.js';

export const POOL_MINIMUM = 5;

/** A skill is draw-eligible when active and Core or Critical (D-06, BR-08). */
export function isEligibleSkill(skill) { return !!skill && skill.status === 'active' && (skill.isCore === true || skill.isCritical === true); }

/**
 * Build the draw pool: unique eligible skills present on at least one active board.
 * activeBoards: [{ cells: [{position, skillId}] }] ; skills: Map<id, skill>
 * Returns a sorted array of skill ids (deterministic ordering for fixtures).
 */
export function buildDrawPool(activeBoards, skills) {
  const pool = new Set();
  for (const b of activeBoards) for (const c of b.cells) { const s = skills.get(c.skillId); if (isEligibleSkill(s)) pool.add(c.skillId); }
  return [...pool].sort();
}

/** Whether a board could ever complete a line given the pool (A-03). */
export function boardCanWin(cells, poolSet) {
  const byPos = new Array(25);
  for (const c of cells) byPos[c.position] = c.skillId;
  return LINE_MASKS.some(l => l.positions.every(p => poolSet.has(byPos[p])));
}

/** Readiness report for admin start (BR-08, OD-07). */
export function readiness(activeBoards, skills) {
  const pool = buildDrawPool(activeBoards, skills);
  const poolSet = new Set(pool);
  const boardsThatCanWin = activeBoards.filter(b => boardCanWin(b.cells, poolSet)).length;
  return { poolSize: pool.length, poolMinimum: POOL_MINIMUM, canStart: pool.length >= POOL_MINIMUM, anyBoardCanWin: boardsThatCanWin > 0, boardsThatCanWin, pool };
}
