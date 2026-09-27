// packages/ui/soul3d pure maths (D-29 docs/art/soul-decorations.md): the body gradient tint at a height (with parity
// values computed independently in Python, as the Blender per-vertex bake does), the charm placement (basis, position,
// scale) and the card framing shared by the Galaxy entrance and impostors. No DOM, no WebGL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../vendor/three/index.js';
import {
  GRADIENT_SPAN, gradientT, gradientSrgbAt, gradientLinearAt, tintGradient, tintGradientVertex, tintGradientColors, tintVertex,
  tintPalette, hexToLinear, hexToSrgb, srgbToLinear, EYE_WHITE,
} from '../soul3d/tint.js';
import { charmBasis, charmPlacement, basisQuaternion, placePoint } from '../soul3d/placement.js';
import { cardCamera, CARD_FILL, SOUL_VIEW, modelToViewBox } from '../soul3d/studio.js';
import { GRADIENTS, SOUL_CATALOG } from '../../game-rules/src/soul-catalog.js';
import { BOUNDS, ORB, MAPPING } from '../soul-baseline-shape.js';
import { fixtureSlots } from './decor-fixture.js';

const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
const byId = (id) => GRADIENTS.find((g) => g.id === id);

test('gradient span and factor: t = clamp((top - h) / (top - bottom), 0, 1) over the catalog span', () => {
  assert.deepEqual({ ...GRADIENT_SPAN }, { top: 1.9, bottom: 0 });
  assert.equal(SOUL_CATALOG.gradientSpan.space, 'srgb');
  assert.equal(gradientT(1.9), 0); assert.equal(gradientT(0), 1); assert.equal(gradientT(0.95), 0.5);
  assert.equal(gradientT(2.4), 0, 'above the span: the top colour (the orb and neck)');
  assert.equal(gradientT(-0.3), 1, 'below: the bottom colour');
  assert.equal(gradientT(NaN), 0);
  assert.equal(gradientT(1, { top: 1, bottom: 1 }), 0, 'degenerate span');
});

test('gradient at a height: sRGB mix of top / bottom then linear - parity values from an independent implementation', () => {
  // python: s2l(c) per channel of mix(hex(top), hex(bottom), t) (scratch reference, same as the Blender bake)
  const PARITY = {
    aurora: [[0, [0.119538, 0.502886, 0.672443]], [0.475, [0.159725, 0.57758, 0.677764]], [0.95, [0.206853, 0.658375, 0.683108]], [1.9, [0.323143, 0.838799, 0.693872]]],
    dawn: [[0, [0.278894, 0.617207, 0.48515]], [0.95, [0.514918, 0.593905, 0.423268]], [1.425, [0.665387, 0.58245, 0.394159]], [1.9, [0.838799, 0.571125, 0.366253]]],
    twilight: [[0.475, [0.473531, 0.457824, 0.879622]], [0.95, [0.439657, 0.561521, 0.83077]], [1.9, [0.376262, 0.806952, 0.73791]]],
  };
  for (const [id, rows] of Object.entries(PARITY)) {
    const g = tintGradient(byId(id));
    for (const [h, lin] of rows) assert.ok(near(gradientLinearAt(h, g), lin, 2e-6), `${id} h ${h}: ${gradientLinearAt(h, g)}`);
  }
  // the mix is in sRGB, not in linear light
  const g = tintGradient(byId('dawn'));
  const linMix = hexToLinear(byId('dawn').top).map((v, i) => (v + hexToLinear(byId('dawn').bottom)[i]) / 2);
  assert.ok(!near(gradientLinearAt(0.95, g), linMix, 1e-3));
  assert.ok(near(gradientSrgbAt(0.95, g), hexToSrgb(byId('dawn').top).map((v, i) => (v + hexToSrgb(byId('dawn').bottom)[i]) / 2)));
});

test('gradient vertex tint: fill from the height, then the D-27 mask mixes toward highlight / eye white / outline / highlight', () => {
  for (const grad of GRADIENTS) {
    const g = tintGradient(grad);
    const L = (hex) => hexToLinear(hex);
    for (const h of [0, 0.7, 1.9]) assert.ok(near(tintGradientVertex(h, 0, 0, 0, 0, g), gradientLinearAt(h, g)), `${grad.id} body at ${h}`);
    assert.ok(near(tintGradientVertex(0.4, 1, 0, 0, 0, g), L(grad.highlight)), 'drips');
    assert.ok(near(tintGradientVertex(1.2, 0, 1, 0, 0, g), L(EYE_WHITE)), 'eye discs');
    assert.ok(near(tintGradientVertex(1.2, 0, 0, 1, 0, g), L(grad.outline)), 'groove ring');
    assert.ok(near(tintGradientVertex(2.1, 0, 0, 0, 1, g), L(grad.highlight)), 'orb');
    // partial masks chain in order, in linear light (the same maths as a v1 palette whose fill is the local gradient)
    const fill = gradientLinearAt(0.8, g);
    const asPalette = { fill: fill.map((v) => v), highlight: g.highlight, outline: g.outline, glow: g.glow, eye: g.eye };
    assert.ok(near(tintGradientVertex(0.8, 0.3, 0.6, 0.25, 0.5, g), tintVertex(0.3, 0.6, 0.25, 0.5, asPalette)));
  }
});

test('tintGradientColors: one height per vertex, deterministic Float32Array, uint8 masks read as /255, bad input rejected', () => {
  const mask = new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 128]);
  const heights = new Float32Array([0.1, 0.6, 1.15, 2.1]);
  const a = tintGradientColors(mask, heights, GRADIENTS[4]);
  const b = tintGradientColors(Float32Array.from(mask, (v) => v / 255), Float32Array.from(heights), { ...GRADIENTS[4] });
  assert.ok(a instanceof Float32Array && a.length === 12);
  assert.deepEqual(Buffer.from(a.buffer), Buffer.from(b.buffer));
  const g = tintGradient(GRADIENTS[4]);
  assert.ok(near([...a.slice(0, 3)], gradientLinearAt(heights[0], g), 1e-6), 'plain body vertex = the gradient at its height');
  assert.ok(near([...a.slice(3, 6)], hexToLinear(GRADIENTS[4].highlight), 1e-6));
  assert.ok(near([...a.slice(6, 9)], hexToLinear(EYE_WHITE), 1e-6));
  assert.throws(() => tintGradientColors(mask, new Float32Array(3), GRADIENTS[0]), RangeError);
  assert.throws(() => tintGradientColors(mask, null, GRADIENTS[0]), RangeError);
  assert.throws(() => tintGradient(null), TypeError);
  // every gradient differs; equal inputs are byte-identical
  const seen = new Set(GRADIENTS.map((gr) => Buffer.from(tintGradientColors(mask, heights, gr).buffer).toString('hex')));
  assert.equal(seen.size, GRADIENTS.length);
});

test('BR-17: every gradient renders with about the same mean relative luminance over the span (as tinted, sRGB mix)', () => {
  // The catalog equalises the endpoints' mean (0.575 +- 0.01). As rendered, the sRGB mix bows the middle darker, so the
  // tinted mean over the span is ~0.556 .. 0.570: still one band (spread < 0.02), with no gradient standing out.
  const lum = (lin) => 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const means = GRADIENTS.map((grad) => {
    const g = tintGradient(grad);
    let sum = 0; const N = 64;
    for (let i = 0; i <= N; i++) sum += lum(gradientLinearAt((i / N) * 1.9, g));
    return sum / (N + 1);
  });
  for (const [i, m] of means.entries()) assert.ok(Math.abs(m - 0.565) <= 0.015, `${GRADIENTS[i].id} mean luminance ${m.toFixed(4)}`);
  assert.ok(Math.max(...means) - Math.min(...means) < 0.02, `spread ${(Math.max(...means) - Math.min(...means)).toFixed(4)}`);
  // v1 palettes still tint as before (palette fill everywhere)
  assert.ok(near(tintVertex(0, 0, 0, 0, tintPalette({ fill: '#74D6C8', highlight: '#E3FFF8', outline: '#2A5AA6', glow: '#72E8CF' })), hexToLinear('#74D6C8')));
  assert.equal(srgbToLinear(1), 1);
});

test('charm basis: z = normal, y = up orthogonalised against it, x = y x z (orthonormal, right-handed)', () => {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const cases = [[[0, 0, 1], [0, 1, 0]], [[-0.29963, -0.09988, 0.94881], [0, 1, 0]], [[0.8, 0, 0.6], [0, 1, 0]], [[0, 0.19996, 0.9798], [0.1, 1, 0.05]], [[1, 2, 3], [0, 1, 0]]];
  for (const [normal, up] of cases) {
    const b = charmBasis(normal, up);
    const nn = Math.hypot(...normal);
    assert.ok(near(b.z, normal.map((v) => v / nn), 1e-12), 'z is the unit normal');
    for (const v of [b.x, b.y, b.z]) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-12);
    assert.ok(Math.abs(dot(b.x, b.y)) < 1e-12 && Math.abs(dot(b.y, b.z)) < 1e-12 && Math.abs(dot(b.x, b.z)) < 1e-12);
    assert.ok(near(cross(b.x, b.y), b.z, 1e-12), 'right-handed');
    assert.ok(near(cross(b.y, b.z), b.x, 1e-12), 'x = y x z');
    assert.ok(dot(b.y, up) > 0, 'icon up follows the slot up');
  }
  // up parallel to the normal falls back to model +Y (then +Z); a zero normal is unusable
  const d = charmBasis([0, 1, 0], [0, 1, 0]);
  assert.ok(d && Math.abs(dot(d.y, d.z)) < 1e-12 && Math.abs(Math.hypot(...d.x) - 1) < 1e-12);
  assert.equal(charmBasis([0, 0, 0]), null);
  assert.equal(charmBasis(null), null);
});

test('charm placement: position = centre - normal * sink * thickness * size, scale = size, matrix maps the charm frame', () => {
  const slot = { index: 3, centre: [-0.15, 0.72, 0.4], normal: [-0.30077, 0.20051, 0.93238], up: [0, 1, 0], size: 0.17, sink: 0.35 };
  const T = 0.22;
  const p = charmPlacement(slot, T);
  const nrm = Math.hypot(...slot.normal), z = slot.normal.map((v) => v / nrm);
  const push = 0.35 * T * 0.17;
  assert.ok(near(p.position, slot.centre.map((c, i) => c - z[i] * push), 1e-12));
  assert.equal(p.scale, 0.17);
  // origin (back centre) -> position; front centre (0,0,T) pokes out by (1 - sink) * T * size beyond the slot centre
  assert.ok(near(placePoint(p, [0, 0, 0]), p.position, 1e-12));
  const front = placePoint(p, [0, 0, T]);
  assert.ok(near(front, slot.centre.map((c, i) => c + z[i] * (1 - 0.35) * T * 0.17), 1e-12));
  // rim of the 1.0-diameter outline: 0.5 * size from the axis, along the basis
  const top = placePoint(p, [0, 0.5, 0]);
  assert.ok(Math.abs(Math.hypot(...top.map((v, i) => v - p.position[i])) - 0.085) < 1e-12);
  // quaternion agrees with Three.js for the same basis
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...p.basis.x), new THREE.Vector3(...p.basis.y), new THREE.Vector3(...p.basis.z));
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  assert.ok(near(p.quaternion, [q.x, q.y, q.z, q.w], 1e-9) || near(p.quaternion, [-q.x, -q.y, -q.z, -q.w], 1e-9));
  const composed = new THREE.Matrix4().compose(new THREE.Vector3(...p.position), new THREE.Quaternion(...p.quaternion), new THREE.Vector3(p.scale, p.scale, p.scale));
  assert.ok(near(composed.elements, p.matrix, 1e-9), 'position + quaternion + scale reproduce the matrix');
  // unusable slots
  assert.equal(charmPlacement(null, T), null);
  assert.equal(charmPlacement({ ...slot, size: 0 }, T), null);
  assert.equal(charmPlacement({ ...slot, centre: [0, 'x', 0] }, T), null);
  assert.ok(near(charmPlacement({ ...slot, sink: undefined }, T).position, slot.centre, 1e-12), 'no sink: the back sits on the centre');
});

test('placement of every slot: front hemisphere, same scale for every charm (BR-17), all basis quaternions valid', () => {
  const slots = fixtureSlots();
  const places = slots.map((s) => charmPlacement(s, 0.2));
  assert.equal(new Set(places.map((p) => p.scale)).size, 1);
  for (const p of places) {
    assert.ok(p.basis.z[2] > 0, 'faces the front');
    assert.ok(Math.abs(Math.hypot(...p.quaternion) - 1) < 1e-9);
    assert.ok(near(basisQuaternion(p.basis), p.quaternion));
  }
});

test('card framing: the phone lens and eye, narrowed so the resting figure fills the card like the flat Soul fills its viewBox', () => {
  assert.equal(CARD_FILL, (BOUNDS.y1 - BOUNDS.y0) / 200);
  const cam = cardCamera();
  assert.equal(cam.eye[2], SOUL_VIEW.camera.z, 'same distance as the phone reveal camera (same perspective)');
  assert.ok(Math.abs(cam.eye[1] - cam.target[1] - (SOUL_VIEW.camera.y - SOUL_VIEW.camera.lookY)) < 1e-12, 'same pitch');
  assert.ok(cam.fov > 20 && cam.fov < SOUL_VIEW.camera.fov, `narrower than the phone lens: ${cam.fov}`);
  const camera = new THREE.PerspectiveCamera(cam.fov, 1, 0.1, 30);
  camera.position.fromArray(cam.eye); camera.lookAt(new THREE.Vector3().fromArray(cam.target)); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const ndcY = (y) => new THREE.Vector3(0, y, 0).project(camera).y;
  const feet = ndcY(0), top = ndcY(SOUL_VIEW.fitHeight);
  assert.ok(Math.abs(feet + CARD_FILL) < 0.02 && Math.abs(top - CARD_FILL) < 0.02, `feet ${feet}, top ${top}`);
  assert.ok(Math.abs(top - feet - 2 * CARD_FILL) < 0.01, 'the figure spans CARD_FILL of the card, like every flat Soul (same size, BR-17)');
  // model -> viewBox mapping of the flat Soul (the charms' front2d come from it)
  assert.deepEqual(modelToViewBox([0.105, 2.1]).map((v) => Number(v.toFixed(1))), [ORB.cx, ORB.cy]);
  assert.equal(MAPPING.scale, 70);
});
