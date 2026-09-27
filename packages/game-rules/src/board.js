import { CELLS } from './lines.js';
import { shuffle } from './random.js';

export const REQUIRED_SELECTIONS = CELLS;

/**
 * Validate a draft selection set (BR-02). Returns { ok, code, message }.
 * skills: Map<id, {status,...}>
 */
export function validateSelections(skillIds, skills) {
  if (!Array.isArray(skillIds)) return { ok: false, code: 'VALIDATION', message: 'skillIds must be an array' };
  if (skillIds.length > REQUIRED_SELECTIONS) return { ok: false, code: 'VALIDATION', message: `at most ${REQUIRED_SELECTIONS} skills` };
  const seen = new Set();
  for (const id of skillIds) {
    if (typeof id !== 'string' || !id) return { ok: false, code: 'VALIDATION', message: 'invalid skill id' };
    if (seen.has(id)) return { ok: false, code: 'DUPLICATE_SKILL', message: 'You already added this skill.', exceptionId: 'E4' };
    seen.add(id);
    const s = skills.get(id);
    if (!s || s.status !== 'active') return { ok: false, code: 'VALIDATION', message: `unknown or inactive skill ${id}` };
  }
  return { ok: true };
}

/** True when the set is exactly 16 unique active skills and may be finalized. */
export function isComplete(skillIds, skills) {
  const v = validateSelections(skillIds, skills);
  return v.ok && skillIds.length === REQUIRED_SELECTIONS;
}

/** Server-side randomization (BR-04): returns cells [{position, skillId}] in position order. */
export function randomizeBoard(skillIds, rng) {
  if (skillIds.length !== CELLS) throw new RangeError(`exactly ${CELLS} skills required`);
  const order = shuffle(skillIds, rng);
  return order.map((skillId, position) => ({ position, skillId }));
}

/** Match mask for a board given the set of drawn skill ids (BR-11). cells: [{position, skillId}] */
export function matchMask(cells, drawnSet) {
  let m = 0;
  for (const c of cells) if (drawnSet.has(c.skillId)) m |= (1 << c.position);
  return m >>> 0;
}
