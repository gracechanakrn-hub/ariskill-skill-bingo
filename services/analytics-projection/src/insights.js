// Aggregate-only Insights projection (requirement 16, contracts/projections/insights.json, D-15 cohort suppression).
// Pure function over already-loaded rows: never emits per-participant values, employee references or display names.
// Analytics are not on the authoritative draw path (game service caches the result for ~2 s).

import { CELLS } from '../../../packages/game-rules/src/lines.js';

export const MIN_COHORT = 5;

function rate(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 1000 : null; }
function kindOf(s) { return s?.isCore ? 'Core' : s?.isCritical ? 'Critical' : 'Optional'; }

/**
 * @param {object} input
 * @param {Array<{participantId:string, platformId:string|null, roleId:string|null}>} input.participants  joined participants (with a session)
 * @param {Array<{participantId:string, state:string, selectedSkillIds:string[], matrixVersion:string|null}>} input.boards  boards of the current or last round
 * @param {Map<string, object>} input.skills  Skill Master map (id -> skill)
 * @param {Array<{id,name}>} input.platforms
 * @param {Array<{id,name,platformId}>} input.roles
 * @param {(roleId:string) => Set<string>} input.roleSkillSet  role -> skill ids at matrixVersion
 * @param {string} input.matrixVersion
 * @param {string} input.computedAt ISO
 */
export function computeInsights({ participants, boards, skills, platforms, roles, roleSkillSet, matrixVersion, computedAt, minCohort = MIN_COHORT }) {
  const joined = participants.length;
  const completedStates = new Set(['READY', 'LOCKED_ACTIVE', 'FINISHED']);
  const completedBoards = boards.filter(b => completedStates.has(b.state) && b.selectedSkillIds.length === CELLS);
  const active = boards.filter(b => b.state === 'LOCKED_ACTIVE' || b.state === 'FINISHED').length;
  const deferred = boards.filter(b => b.state === 'DEFERRED').length;
  const completedByParticipant = new Set(completedBoards.map(b => b.participantId));

  const participation = {
    joined, completed: completedBoards.length, active, deferred,
    joinedRate: null, completedRate: rate(completedBoards.length, joined), activeRate: rate(active, joined), deferredRate: rate(deferred, joined),
  };

  // Cohort engagement with suppression (D-15): cohorts with fewer than minCohort joined participants are omitted and counted.
  let suppressedCohorts = 0;
  const cohort = (items, key, catalogue) => {
    const out = [];
    for (const c of catalogue) {
      const members = items.filter(p => p[key] === c.id);
      if (members.length === 0) continue;
      if (members.length < minCohort) { suppressedCohorts += 1; continue; }
      out.push({ [key]: c.id, name: c.name, joined: members.length, completed: members.filter(m => completedByParticipant.has(m.participantId)).length });
    }
    return out.sort((a, b) => b.joined - a.joined || a.name.localeCompare(b.name));
  };
  const platformEngagement = cohort(participants, 'platformId', platforms);
  const roleEngagement = cohort(participants, 'roleId', roles);

  // Skill popularity and Core/Critical density across completed boards.
  const counts = new Map();
  const density = { core: 0, critical: 0, optional: 0, totalSelections: 0 };
  for (const b of completedBoards) for (const id of b.selectedSkillIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
    const s = skills.get(id);
    density.totalSelections += 1;
    if (s?.isCore) density.core += 1; else if (s?.isCritical) density.critical += 1; else density.optional += 1;
  }
  const topSkills = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
    .map(([skillId, count]) => ({ skillId, name: skills.get(skillId)?.name ?? skillId, kind: kindOf(skills.get(skillId)), count }));

  // Matrix alignment: mean of inMatrixCount/CELLS over completed boards whose participant has a role; beyond-matrix aggregate.
  const roleOf = new Map(participants.map(p => [p.participantId, p.roleId]));
  const beyond = new Map();
  let alignSum = 0, alignN = 0;
  for (const b of completedBoards) {
    const roleId = roleOf.get(b.participantId);
    if (!roleId) continue;
    const set = roleSkillSet(roleId);
    let inMatrix = 0;
    for (const id of b.selectedSkillIds) { if (set.has(id)) inMatrix += 1; else beyond.set(id, (beyond.get(id) ?? 0) + 1); }
    alignSum += inMatrix / CELLS; alignN += 1;
  }
  const matrixAlignment = { rate: alignN ? Math.round((alignSum / alignN) * 1000) / 1000 : null, matrixVersion, participants: alignN };
  const skillsBeyondMatrix = [...beyond.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
    .map(([skillId, count]) => ({ skillId, name: skills.get(skillId)?.name ?? skillId, count }));

  return { participation, platformEngagement, roleEngagement, topSkills, coreCriticalDensity: density, matrixAlignment, skillsBeyondMatrix, suppressedCohorts, matrixVersion, computedAt };
}

/** Keys the stage dashboard may show (contracts/projections/stage.json insights block). */
export function stageInsights(full) {
  if (!full) return null;
  const { topSkills, coreCriticalDensity, platformEngagement, roleEngagement, matrixAlignment, skillsBeyondMatrix, suppressedCohorts } = full;
  return { topSkills, coreCriticalDensity, platformEngagement, roleEngagement, matrixAlignment, skillsBeyondMatrix, suppressedCohorts };
}
