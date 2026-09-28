// Skill Master index (packages/skill-master/data/skill-master.json, D-05/D-06). Loaded once; read-only.
import skillMaster from '../../../packages/skill-master/data/skill-master.json' with { type: 'json' };
// Platform and role choices come from the owner's lists (D-55, tools/data/build_taxonomy.mjs); the Skill Matrix still supplies
// the skills. A role in the matrix keeps the matrix role id, so ROLE_SKILL_LEVELS applies to it unchanged.
import taxonomy from '../../../packages/skill-master/data/taxonomy.json' with { type: 'json' };
import { isEligibleSkill, countSkillKinds } from '../../../packages/game-rules/src/index.js';

export const SKILL_MASTER = skillMaster;
export const MATRIX_VERSION = skillMaster.matrixVersion;
export const SKILLS = new Map(skillMaster.skills.map(s => [s.id, s]));
export const TAXONOMY_VERSION = taxonomy.version;
export const PLATFORMS = taxonomy.platforms.map(p => ({ id: p.id, name: p.name }));
export const ROLES = taxonomy.roles.map(r => ({ id: r.id, name: r.name, inMatrix: !!r.matrixRoleId }));
export const PLATFORM_BY_ID = new Map(PLATFORMS.map(p => [p.id, p]));
export const ROLE_BY_ID = new Map(ROLES.map(r => [r.id, r]));

/** roleId -> Map<skillId, level ('core'|'critical'|'optional')> */
export const ROLE_SKILL_LEVELS = new Map();
/** skillId -> number of roles mapping it (matrix frequency, used by the popular fallback). */
export const MATRIX_FREQUENCY = new Map();
for (const m of skillMaster.roleSkillMap) {
  if (!ROLE_SKILL_LEVELS.has(m.roleId)) ROLE_SKILL_LEVELS.set(m.roleId, new Map());
  ROLE_SKILL_LEVELS.get(m.roleId).set(m.skillId, m.level);
  MATRIX_FREQUENCY.set(m.skillId, (MATRIX_FREQUENCY.get(m.skillId) ?? 0) + 1);
}

export function roleSkillSet(roleId) { return new Set((ROLE_SKILL_LEVELS.get(roleId) ?? new Map()).keys()); }
export function roleLevel(roleId, skillId) { return ROLE_SKILL_LEVELS.get(roleId)?.get(skillId) ?? null; }

/** Draw/cell kind label: Core | Critical | Optional (contract Draw.skill.kind is Core|Critical|Optional; any active skill may be drawn, D-33). */
export function skillKind(skill) { return skill?.isCore ? 'Core' : skill?.isCritical ? 'Critical' : 'Optional'; }
export function isEligible(skillId) { return isEligibleSkill(SKILLS.get(skillId)); }

/** Draw-shaped skill descriptor. */
export function skillRef(skillId) {
  const s = SKILLS.get(skillId);
  if (!s) return { id: skillId, name: skillId, kind: 'Optional', domain: null };
  return { id: s.id, name: s.name, kind: skillKind(s), domain: s.domain };
}
/** Discovery-shaped descriptor. */
export function discoverySkill(skill, roleId) {
  return { id: skill.id, name: skill.name, domain: skill.domain, cluster: skill.cluster, kind: skill.kind, isCore: !!skill.isCore, isCritical: !!skill.isCritical, eligible: isEligibleSkill(skill), roleLevel: roleLevel(roleId, skill.id) };
}
export function domainCounts(skillIds) {
  const out = {};
  for (const id of skillIds) { const d = SKILLS.get(id)?.domain ?? 'Unknown'; out[d] = (out[d] ?? 0) + 1; }
  return out;
}
/** Soul decoration kind counts {core, technical, soft} from each skill's Skill Master `kind` (D-29; unrelated to isCore). */
export function kindCounts(skillIds) { return countSkillKinds(skillIds.map(id => SKILLS.get(id)?.kind)); }
