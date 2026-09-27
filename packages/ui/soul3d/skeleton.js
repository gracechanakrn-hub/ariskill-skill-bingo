// packages/ui/soul3d/skeleton.js - the procedural skeleton of a 3D Soul for its idle micro actions (stage 15, D-36):
// no Blender export, the bones and the skin weights come from the body's own shape. Both bodies (the baseline for v1 / v2
// Souls, the v3 body) share the lower body of tools/ai/blender/soul_baseline.py: a round belly between two hanging arm
// lobes, cut apart by narrow slits (|x| about 0.32 .. 0.37) below y about 0.38, and two small feet at the front bottom.
// Model space throughout: +Y up, +Z front, the character's left is +X, feet at y = floor.
//   bones    root at the feet > spine (waist) > head (below the chin; eyeL / eyeR at the eye landmarks), armL / armR
//            (children of the spine) hinged at the top of the slits, legL / legR (children of the root) above the feet
//   weights  smooth masks: an arm owns its outer bottom lobe (outside the slit, fading out above the slit top), a leg
//            its inner bottom lobe (a soft hump over the foot, fading out toward the centre line, the slit and above
//            the foot); the rest blends root > spine > head by height. At most three bones per vertex, summing to 1.
//            Tuned on the shipped hero mesh so the strongest pose of each action stretches no triangle edge by more
//            than about 1.5x (the armpit at the top of the slit, the belly bottom beside the lifted foot).
// The eyes carry no body weights: the v3 eye models ride on the eye bones, the baseline's button eyes and orb follow
// the head. Pure numbers (no Three.js): the figure builds the bones and the skinned meshes from them.

/** Bone names in skeleton order (the skinIndex values), and each bone's parent. */
export const SOUL_BONES = Object.freeze(['root', 'spine', 'head', 'armL', 'armR', 'legL', 'legR', 'eyeL', 'eyeR']);
export const BONE_PARENT = Object.freeze({ root: null, spine: 'root', head: 'spine', armL: 'spine', armR: 'spine', legL: 'root', legR: 'root', eyeL: 'head', eyeR: 'head' });
const BONE_INDEX = Object.freeze(Object.fromEntries(SOUL_BONES.map((b, i) => [b, i])));

/**
 * Pivots and masks in model units, measured on the shipped GLBs (both bodies): the slits separate the arm lobes from
 * the belly at |x| 0.32 .. 0.37 up to y 0.38; the feet sit below y 0.12 at |x| 0.02 .. 0.26; the face plate starts at
 * y 0.90 (so everything from the chin up is pure head); the upper-arm charm slots (|x| 0.44, y 0.58 .. 0.62) carry no
 * arm weight, so no charm drifts off the moving shoulder. The arm hinges at the top of its slit, where the skin between
 * arm and belly is shortest.
 */
export const SKELETON = Object.freeze({
  spineY: 0.42,                                   // waist pivot (top of the slits)
  headY: 0.80,                                    // neck pivot, below the chin
  arm: Object.freeze([0.35, 0.42, 0.04]),         // left shoulder hinge at the top of the slit (x mirrored for the right arm)
  leg: Object.freeze([0.14, 0.24, 0.10]),         // left hip (x mirrored)
  spineBand: Object.freeze([0.28, 0.56]),         // root -> spine blend (height)
  headBand: Object.freeze([0.72, 0.88]),          // spine -> head blend (height)
  armX: Object.freeze([0.31, 0.39]),              // |x| fade in, across the slit (wide enough to spread the armpit stretch)
  armY: Object.freeze([0.38, 0.56]),              // fade out above the slit top, below the upper-arm charm slots
  legCentre: Object.freeze([0.0, 0.15]),          // fade in from the centre line (x toward the leg's side), soft between the feet
  legX: Object.freeze([0.17, 0.31]),              // fade out toward the slit (a hump over the foot, not a plateau)
  legY: Object.freeze([0.10, 0.28]),              // fade out above the foot
});

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
/** smoothstep(e0, e1, v): 0 below e0, 1 above e1, C1 in between. */
function smooth(e0, e1, v) { const t = clamp01((v - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }

/**
 * Bone pivots in model space for a body's landmarks (readLandmarks): the eye bones sit on the eye landmarks (the
 * character's left eye, +X, is eyeL); the rest is shared by both bodies. { root: [x, y, z], ... }.
 */
export function bonePivots(landmarks) {
  const S = SKELETON;
  const floor = Number.isFinite(landmarks && landmarks.floor) ? landmarks.floor : -0.02189;
  const eyes = (landmarks && Array.isArray(landmarks.eyes) ? landmarks.eyes : []).map((e) => e.centre).filter(Boolean);
  const left = eyes.find((c) => c[0] > 0) || [0.145, 1.175, 0.3787];
  const right = eyes.find((c) => c[0] < 0) || [-left[0], left[1], left[2]];
  return Object.freeze({
    root: [0, floor, 0], spine: [0, S.spineY, 0], head: [0, S.headY, 0],
    armL: [S.arm[0], S.arm[1], S.arm[2]], armR: [-S.arm[0], S.arm[1], S.arm[2]],
    legL: [S.leg[0], S.leg[1], S.leg[2]], legR: [-S.leg[0], S.leg[1], S.leg[2]],
    eyeL: left.slice(), eyeR: right.slice(),
  });
}

/**
 * Every bone's weight at a model-space point: Float64Array(SOUL_BONES.length), summing to 1. The arm and leg masks
 * never overlap (the arm fades in across the slit, the leg fades out before it), so the root / spine / head split of
 * what is left never goes negative.
 */
export function boneWeights(x, y, z, out = new Float64Array(SOUL_BONES.length)) {
  const S = SKELETON;
  out.fill(0);
  const ax = Math.abs(x), side = x >= 0 ? 1 : -1;
  const arm = smooth(S.armX[0], S.armX[1], ax) * (1 - smooth(S.armY[0], S.armY[1], y));
  const leg = smooth(S.legCentre[0], S.legCentre[1], ax) * (1 - smooth(S.legX[0], S.legX[1], ax)) * (1 - smooth(S.legY[0], S.legY[1], y));
  const rest = 1 - arm - leg;
  const spineUp = smooth(S.spineBand[0], S.spineBand[1], y), headUp = smooth(S.headBand[0], S.headBand[1], y);
  out[BONE_INDEX.root] = rest * (1 - spineUp);
  out[BONE_INDEX.spine] = rest * (spineUp - headUp);
  out[BONE_INDEX.head] = rest * headUp;
  out[side > 0 ? BONE_INDEX.armL : BONE_INDEX.armR] = arm;
  out[side > 0 ? BONE_INDEX.legL : BONE_INDEX.legR] = leg;
  return out;
}

/** The bone with the largest weight at a model-space point (a charm rides on it rigidly). */
export function dominantBone(p) {
  const w = boneWeights(p[0], p[1], p[2]);
  let best = 0;
  for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i;
  return SOUL_BONES[best];
}

/**
 * Skin attributes for a body: model-space positions (Float32Array n * 3) -> { index: Uint16Array(n * 4), weight:
 * Float32Array(n * 4) }, the four largest influences per vertex (unused slots index 0 / weight 0), renormalised in
 * float32 so each vertex sums to 1.
 */
export function computeSkinWeights(positions) {
  const n = Math.floor(positions.length / 3);
  const index = new Uint16Array(n * 4), weight = new Float32Array(n * 4);
  const w = new Float64Array(SOUL_BONES.length), order = SOUL_BONES.map((_, i) => i);
  for (let v = 0; v < n; v++) {
    boneWeights(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2], w);
    order.sort((a, b) => w[b] - w[a] || a - b);
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += w[order[k]];
    for (let k = 0; k < 4; k++) {
      const b = order[k], wk = w[b] / sum;
      index[v * 4 + k] = wk > 0 ? b : 0;
      weight[v * 4 + k] = wk > 0 ? wk : 0;
    }
  }
  return { index, weight };
}

/**
 * Model-space positions of a body model (soul3d/model.js: the stored, dequantised attribute under its node TRS):
 * Float32Array(count * 3). `position` is a BufferAttribute-like object (getX / getY / getZ, count).
 */
export function modelSpacePositions(position, { position: t, quaternion: q, scale: s }) {
  const n = position.count;
  const out = new Float32Array(n * 3);
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  // rotation matrix of q (x, y, z, w), row-major
  const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
  const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
  const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
  for (let i = 0; i < n; i++) {
    const x = position.getX(i) * s.x, y = position.getY(i) * s.y, z = position.getZ(i) * s.z;
    out[i * 3] = r00 * x + r01 * y + r02 * z + t.x;
    out[i * 3 + 1] = r10 * x + r11 * y + r12 * z + t.y;
    out[i * 3 + 2] = r20 * x + r21 * y + r22 * z + t.z;
  }
  return out;
}
