// apps/employee-mobile/src/scene/soul-model.js - the baseline Soul character (D-27, docs/art/soul-baseline.md) for the
// phone scenes. Since stage 12 (D-29) the model, the studio look and the figure live in packages/ui/soul3d, shared with
// the public Galaxy so a Soul looks the same on both screens; this module re-exports them under the names the phone
// scenes and tests have always used (stage 13, D-31, adds the v3 body variant: soulBodyVariant picks it for a v3
// config). The asset map and soul3d are imported relatively (they resolve to /packages/ui in the browser, like
// soul-params.js does for the renderer).
export { readLandmarks, extractSoulModel, vertexHeights, loadSoulModel, prefetchSoulModels, loadSoulModels, soulBodyVariant } from '../../../../packages/ui/soul3d/model.js';
export { PEACH, OUTLINE, LOOK, SOUL_VIEW, makeGlowTexture, makeStudioEnvironment, applySoulToneMapping, addStudioLights, addGlowLight } from '../../../../packages/ui/soul3d/studio.js';
export { buildSoulFigure, figureColours } from '../../../../packages/ui/soul3d/figure.js';
export { buildSoulRig } from '../../../../packages/ui/soul3d/rig.js';
export { buildBadge } from '../../../../packages/ui/soul3d/badge.js';
export { loadSoulDecor, prefetchSoulDecor, hasDecor } from '../../../../packages/ui/soul3d/decor.js';
