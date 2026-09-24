/** Private Role Skill Matrix insight (M-12). roleSkillIds: Set of skill ids mapped to the participant's role at matrixVersion. */
export function matrixInsight(selectedSkillIds, roleSkillIds, matrixVersion) {
  let inMatrixCount = 0;
  for (const id of selectedSkillIds) if (roleSkillIds.has(id)) inMatrixCount++;
  return { matrixVersion, totalSelected: selectedSkillIds.length, inMatrixCount, beyondMatrixCount: selectedSkillIds.length - inMatrixCount };
}
