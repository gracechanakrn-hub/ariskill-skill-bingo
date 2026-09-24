// apps/employee-mobile/src/backdrop-params.js - pure parameters for the sticker sky: the aurora band (teal -> lime)
// and the doodad placement rules (rocket by the join orb, ringed planet on waiting screens). No DOM: node-testable.

/** Aurora band tokens (sticker art direction): drift 0.01 rad/s peak, static under reduced motion. */
export const AURORA = Object.freeze({
  teal: '#4FE3C1',
  lime: '#B6FF5C',
  alpha: 0.24,
  baseAngleRad: -0.24,
  driftRadPerSec: 0.01,   // peak angular rate
  swingRad: 0.05,         // bounded swing around the base angle
  yFrac: 0.30,            // band centre as a fraction of the viewport height
  lengthFrac: 1.5,        // band length as a fraction of the viewport width
  thicknessFrac: 0.20,    // band thickness as a fraction of the viewport height
  slideFrac: 0.03,        // slow slide along the band (fraction of its length)
});

/**
 * auroraState(tSec, { width, height, reduced }) -> { angle, cx, cy, length, thickness, alpha, slide }
 * Angle swings by +-swingRad with a peak rate of driftRadPerSec; reduced motion freezes it at t = 0.
 */
export function auroraState(tSec, { width = 390, height = 844, reduced = false } = {}) {
  const t = reduced ? 0 : Math.max(0, Number(tSec) || 0);
  const omega = AURORA.driftRadPerSec / AURORA.swingRad; // so that swing * omega = peak rate
  const angle = AURORA.baseAngleRad + AURORA.swingRad * Math.sin(omega * t);
  const length = width * AURORA.lengthFrac;
  return {
    angle,
    cx: width * 0.55,
    cy: height * AURORA.yFrac,
    length,
    thickness: Math.max(48, height * AURORA.thicknessFrac),
    alpha: AURORA.alpha,
    slide: length * AURORA.slideFrac * Math.sin(omega * 0.7 * t),
  };
}

/** Doodads are hidden below this viewport width (320 px layouts keep every pixel for content). */
export const DOODAD_MIN_WIDTH = 360;
/** Screens that carry a doodad and where it parks. Slots are reserved decoration areas that never hold text or controls. */
export const DOODAD_SLOTS = Object.freeze({
  join: Object.freeze([{ kind: 'rocket', slot: 'hero-corner', size: 46 }]),
  board: Object.freeze([{ kind: 'planet', slot: 'waiting-sky', size: 60 }]),
  locked: Object.freeze([{ kind: 'planet', slot: 'waiting-sky', size: 60 }]),
  deferred: Object.freeze([{ kind: 'planet', slot: 'waiting-sky', size: 60 }]),
});

/** doodadPlan(screen, viewportWidth) -> [{ kind, slot, size }] (empty on narrow viewports and on dense screens). */
export function doodadPlan(screen, width = 390) {
  if (!Number.isFinite(width) || width < DOODAD_MIN_WIDTH) return [];
  return DOODAD_SLOTS[screen] ? DOODAD_SLOTS[screen].slice() : [];
}

/** Bob amplitude / period (sticker motion notes: +-6 px over 4-6 s; static under reduced motion). */
export const DOODAD_BOB = Object.freeze({ amplitudePx: 6, periodMs: { rocket: 5200, planet: 4600 } });
