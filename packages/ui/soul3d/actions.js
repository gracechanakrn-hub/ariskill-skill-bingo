// packages/ui/soul3d/actions.js - the idle micro actions of a 3D Soul on the big screen (stage 15, D-36): a Soul now and
// then winks, waves an arm, takes a small step, turns round once or sways like jelly, then settles back into its rest
// pose so the hand-off to its baked impostor is seamless. Pure maths (no Three.js): actionPose(action, t) gives the
// pose at t seconds - a rotation / offset / scale per skeleton bone (skeleton.js SOUL_BONES, each bone's rest frame is
// model space: +Y up, +Z front, the character's left is +X) plus a yaw of the whole figure - and the rig applies it
// (buildSoulRig({ actions: true }).setPose).
// Every action eases in and out and starts and ends exactly at REST_POSE; nothing here touches colour, light or
// opacity (no luminance change, no flash) and no motion repeats faster than 3 Hz (the wave is the fastest, 2 Hz).
// Reduced motion: no actions (callers skip them; actionPose(..., { reducedMotion: true }) is the rest pose anyway).
import { SOUL_BONES } from './skeleton.js';

/** The actions, and how long each one lasts (seconds). */
export const SOUL_ACTIONS = Object.freeze(['wink', 'wave', 'step', 'turn', 'sway']);
export const ACTION_DURATION = Object.freeze({ wink: 1.5, wave: 3.2, step: 2.2, turn: 4.0, sway: 3.0 });
/** Largest excursions (radians / model units / scale), for tests and callers that budget screen space. */
export const ACTION_LIMITS = Object.freeze({ armLift: 1.2, legLift: 0.08, bodyRoll: 0.12, headRoll: 0.1, minEyeScale: 0.1, maxHz: 3 });

const deepFreeze = (o) => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return o; };
const restBone = () => ({ rot: [0, 0, 0], pos: [0, 0, 0], scale: [1, 1, 1] });
/** The rest pose: no yaw, every bone at its bind transform. Frozen; actionPose returns it (not a copy) at rest. */
export const REST_POSE = deepFreeze({ yaw: 0, bones: Object.fromEntries(SOUL_BONES.map((b) => [b, restBone()])) });

/** True for a pose that equals REST_POSE (the rig then shows its plain, unskinned meshes). */
export function isRestPose(pose) {
  if (!pose || pose === REST_POSE) return true;
  if (pose.yaw) return false;
  const bones = pose.bones || {};
  return SOUL_BONES.every((b) => {
    const q = bones[b];
    return !q || (q.rot.every((v) => v === 0) && q.pos.every((v) => v === 0) && q.scale.every((v) => v === 1));
  });
}

/** Duration of an action in seconds (0 for an unknown one). */
export function actionDuration(action) { return ACTION_DURATION[action] || 0; }

/**
 * 'left' or 'right' from a seed (FNV-1a, deterministic): which arm waves, which foot steps, which eye winks, which way
 * the Soul turns and sways. One exception: a pirate winks its right eye, since the patch covers its left one (+X).
 * opts: { action, face } (the Soul's face kit, resolveSoul(config).face).
 */
export function actionSide(seed, { action = null, face = null } = {}) {
  if (action === 'wink' && face === 'pirate') return 'right';
  let h = 0x811c9dc5;
  const s = `${String(seed)}:side`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= h >>> 15;
  return h & 1 ? 'left' : 'right';
}

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const smooth = (v) => { const x = clamp01(v); return x * x * (3 - 2 * x); };
const smoother = (v) => { const x = clamp01(v); return x * x * x * (x * (x * 6 - 15) + 10); };
/** 0 before a, rises (smoothstep) to 1 at b, holds, falls to 0 from c to d. Zero slope at every corner. */
const window4 = (t, a, b, c, d) => smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));
/** sin^2 bell over [0, T]: 0 at both ends with zero slope, 1 in the middle. */
const bell = (t, T) => { const s = Math.sin(Math.PI * clamp01(t / T)); return s * s; };

function pose() { return { yaw: 0, bones: Object.fromEntries(SOUL_BONES.map((b) => [b, restBone()])) }; }

/**
 * The pose of `action` at `t` seconds after it started: { yaw, bones: { <bone>: { rot: [x, y, z] (radians, XYZ Euler
 * in the bone's rest frame), pos: [x, y, z] (model units, added to the bind position), scale: [x, y, z] } } }.
 * opts: { side: 'left' | 'right' (actionSide(seed)), reducedMotion }. REST_POSE before 0, from the action's duration on,
 * for an unknown action and under reduced motion.
 */
export function actionPose(action, t, { side = 'left', reducedMotion = false } = {}) {
  const T = actionDuration(action);
  if (reducedMotion || !T || !(t > 0) || t >= T) return REST_POSE;
  const s = side === 'right' ? -1 : 1;             // +1: the character's left (+X)
  const p = pose();
  const B = p.bones;
  if (action === 'wink') {
    // a little head tilt toward the winking eye, and that eye closes and opens again (about 0.5 s)
    B.head.rot[2] = -s * 0.075 * window4(t, 0.1, 0.55, 1.0, 1.45);
    const shut = window4(t, 0.5, 0.68, 0.8, 1.0);
    B[s > 0 ? 'eyeL' : 'eyeR'].scale[1] = 1 - (1 - ACTION_LIMITS.minEyeScale) * shut;
  } else if (action === 'wave') {
    // the arm lifts outward (rotation about Z, away from the body), waves three times at 2 Hz, and comes back down;
    // the body leans a touch the other way
    const lift = window4(t, 0.15, 0.85, 2.35, 3.05);
    const waving = window4(t, 0.85, 1.05, 2.15, 2.35);
    const angle = 0.9 * lift + 0.22 * waving * Math.sin(2 * Math.PI * 2 * (t - 0.85));
    B[s > 0 ? 'armL' : 'armR'].rot[2] = s * angle;
    B.spine.rot[2] = s * 0.035 * lift;
  } else if (action === 'step') {
    // one foot lifts (mostly straight up, its front a little higher) and sets down; the body shifts its weight onto
    // the other foot and bobs up a little
    const leg = B[s > 0 ? 'legL' : 'legR'];
    const lift = window4(t, 0.3, 0.8, 1.0, 1.5);
    leg.pos[1] = 0.06 * lift;
    leg.rot[0] = -0.12 * lift;
    leg.rot[2] = s * 0.08 * lift;
    const shift = window4(t, 0.1, 0.6, 1.2, 1.9);
    B.root.rot[2] = s * 0.045 * shift;
    B.root.pos[1] = 0.015 * lift;
  } else if (action === 'turn') {
    // one slow full turn about the vertical axis (ends at 2 pi: the rest pose again)
    p.yaw = s * 2 * Math.PI * smoother(t / T);
  } else if (action === 'sway') {
    // a slow jelly wave: the bend starts at the feet and travels up through the waist to the head (2 swings)
    const env = bell(t, T), w = 2 * Math.PI * (2 / 3);
    B.root.rot[2] = s * 0.03 * env * Math.sin(w * t);
    B.spine.rot[2] = s * 0.085 * env * Math.sin(w * t - 0.7);
    B.head.rot[2] = s * 0.095 * env * Math.sin(w * t - 1.4);
  }
  return p;
}
