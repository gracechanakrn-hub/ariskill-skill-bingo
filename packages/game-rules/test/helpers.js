import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
export const SKILL_MASTER = JSON.parse(readFileSync(join(here, '../../skill-master/data/skill-master.json'), 'utf8'));
export const SKILLS = new Map(SKILL_MASTER.skills.map(s => [s.id, s]));
/** Draw-eligible skills (D-33, BR-08): every active skill, whatever its kind. */
export const ELIGIBLE_IDS = SKILL_MASTER.skills.filter(s => s.status === 'active').map(s => s.id).sort();
export const CORE_CRITICAL_IDS = SKILL_MASTER.skills.filter(s => s.status === 'active' && (s.isCore || s.isCritical)).map(s => s.id).sort();
export const OPTIONAL_IDS = SKILL_MASTER.skills.filter(s => s.status === 'active' && !(s.isCore || s.isCritical)).map(s => s.id).sort();
export function cellsFrom(ids) { return ids.map((skillId, position) => ({ position, skillId })); }
