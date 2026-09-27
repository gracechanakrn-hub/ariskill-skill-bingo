// packages/ui/soul3d/placement.js - where a skill charm sits on the baseline Soul (D-29 docs/art/soul-decorations.md
// "Asset formats": placement of a charm). A charm model has its origin at the centre of its back face, faces +Z, icon up
// +Y and is 1.0 across; a slot (packages/ui/soul-decor-data.js) gives centre, normal and up in model space, the charm
// diameter `size` and `sink`, the fraction of the charm's thickness pushed into the goo:
//   basis     z = normal, y = up orthogonalised against it, x = y x z
//   position  centre - normal * sink * thickness * size
//   scale     size (the same for every slot, BR-17)
// Pure numbers (no Three.js): the figure turns the result into a matrix; tests check it directly.

const EPS = 1e-9;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > EPS ? [v[0] / l, v[1] / l, v[2] / l] : null;
}
const vec3 = (v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? v : null);

/**
 * Orthonormal charm basis { x, y, z } from a slot's normal and up. When `up` is (nearly) parallel to the normal the
 * model's +Y is used instead, then +Z, so a degenerate slot still gets an upright charm. Returns null for a bad normal.
 */
export function charmBasis(normal, up = [0, 1, 0]) {
  const z = unit(vec3(normal) || [0, 0, 0]);
  if (!z) return null;
  for (const cand of [vec3(up), [0, 1, 0], [0, 0, 1]]) {
    if (!cand) continue;
    const d = dot(cand, z);
    const y = unit([cand[0] - z[0] * d, cand[1] - z[1] * d, cand[2] - z[2] * d]);
    if (y) return { x: cross(y, z), y, z };
  }
  return null;
}

/**
 * Placement of a charm in a slot: { position, basis, scale, quaternion [x, y, z, w], matrix (column-major 4x4) }.
 * `thickness` is the charm model's thickness at diameter 1 (decor data charm.thickness). Null for an unusable slot.
 */
export function charmPlacement(slot, thickness) {
  if (!slot) return null;
  const centre = vec3(slot.centre), size = Number(slot.size), sink = Number(slot.sink) || 0, t = Number(thickness) || 0;
  const basis = charmBasis(slot.normal, slot.up);
  if (!centre || !basis || !(size > 0)) return null;
  const push = sink * t * size;
  const position = [centre[0] - basis.z[0] * push, centre[1] - basis.z[1] * push, centre[2] - basis.z[2] * push];
  const { x, y, z } = basis;
  const matrix = [
    x[0] * size, x[1] * size, x[2] * size, 0,
    y[0] * size, y[1] * size, y[2] * size, 0,
    z[0] * size, z[1] * size, z[2] * size, 0,
    position[0], position[1], position[2], 1,
  ];
  return { position, basis, scale: size, quaternion: basisQuaternion(basis), matrix };
}

/** Rotation matrix with columns x, y, z -> unit quaternion [x, y, z, w] (Shepperd's method, as Three.js setFromRotationMatrix). */
export function basisQuaternion({ x, y, z }) {
  const m11 = x[0], m12 = y[0], m13 = z[0], m21 = x[1], m22 = y[1], m23 = z[1], m31 = x[2], m32 = y[2], m33 = z[2];
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
}

/** Applies a charmPlacement matrix to a point of the charm's local frame (tests and hit checks). */
export function placePoint(placement, p) {
  const m = placement.matrix;
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}
