// apps/employee-mobile/src/scene/soul-tint.js - per-Soul vertex colours for the baseline Soul (D-27, D-29). The pure
// colour maths moved to packages/ui/soul3d/tint.js so the phone and the public Galaxy tint the one mesh identically
// (v1 palette fill, or the v2 body gradient over each vertex's height, then the drip / eye / groove / orb mask mixes).
// Re-exported here under the phone's historical module name.
export {
  EYE_WHITE, MASK, TINT_ORDER, GRADIENT_SPAN, srgbToLinear, linearToSrgb, hexToSrgb, hexToLinear, tintPalette, tintGradient,
  gradientT, gradientSrgbAt, gradientLinearAt, tintVertex, tintGradientVertex, tintColors, tintGradientColors, orbGlow,
} from '../../../../packages/ui/soul3d/tint.js';
