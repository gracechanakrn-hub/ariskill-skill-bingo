// packages/ui/soul3d idle micro actions, the pure parts (stage 15, D-36): the action timelines of actions.js (start and
// end exactly at rest, durations, bounded angles, no motion faster than 3 Hz, mirror-symmetric sides, reduced motion)
// and the procedural skin weights of skeleton.js on the shipped body GLBs (they sum to 1, the arms land on the outer
// bottom lobes and the legs on the inner ones, everything from the chin up is head, no charm slot rides an arm or a leg).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as THREE from '../../vendor/three/index.js';
import * as loaders from '../../vendor/three/loaders.js';
import { SOUL_ACTIONS, ACTION_DURATION, ACTION_LIMITS, REST_POSE, actionPose, actionDuration, actionSide, isRestPose } from '../soul3d/actions.js';
import { SOUL_BONES, BONE_PARENT, SKELETON, bonePivots, boneWeights, dominantBone, computeSkinWeights, modelSpacePositions } from '../soul3d/skeleton.js';
import { extractSoulModel, readLandmarks } from '../soul3d/model.js';
import { soulModelUrl } from '../asset-map.js';
import { SOUL_DECOR } from '../soul-decor-data.js';
import { SOUL_FACE } from '../soul-face-data.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const B = Object.fromEntries(SOUL_BONES.map((b, i) => [b, i]));
const sample = (T, hz = 60) => Array.from({ length: Math.floor(T * hz) + 1 }, (_, i) => i / hz);
/** Every scalar channel of a pose, flattened: [yaw, root.rot.x, ...]. */
const channels = (p) => [p.yaw, ...SOUL_BONES.flatMap((b) => [...p.bones[b].rot, ...p.bones[b].pos, ...p.bones[b].scale])];
/** Channel kinds in that order: yaw, then per bone 3 rotations, 3 offsets, 3 scales. */
const KIND = ['yaw', ...SOUL_BONES.flatMap(() => ['rot', 'rot', 'rot', 'pos', 'pos', 'pos', 'scale', 'scale', 'scale'])];
/** Distance of a channel from rest; a yaw counts modulo a full turn (the turn ends at 2 pi, the rest orientation). */
const offRest = (v, i) => (i === 0 ? Math.abs(Math.atan2(Math.sin(v), Math.cos(v))) : Math.abs(v - channels(REST_POSE)[i]));

test('actions: the five of the brief, 1.5 .. 4 s each, eased in and out from exactly the rest pose back to exactly it', () => {
  assert.deepEqual([...SOUL_ACTIONS], ['wink', 'wave', 'step', 'turn', 'sway']);
  assert.equal(actionDuration('wink'), 1.5); assert.equal(actionDuration('turn'), 4); assert.equal(actionDuration('sway'), 3);
  for (const a of SOUL_ACTIONS) {
    const T = actionDuration(a);
    assert.ok(T >= 1.5 && T <= 4, `${a} lasts ${T} s`);
    assert.equal(ACTION_DURATION[a], T);
    for (const side of ['left', 'right']) {
      for (const t of [0, -1, T, T + 0.5, NaN, undefined]) assert.equal(actionPose(a, t, { side }), REST_POSE, `${a} ${side} at ${t}: exactly rest`);
      // eased: a hair after the start and before the end the Soul is still within a whisker of rest (no jump)
      for (const t of [0.02, T - 0.02]) assert.ok(channels(actionPose(a, t, { side })).every((v, i) => offRest(v, i) < 0.01), `${a} ${side} eases at ${t}`);
      assert.equal(isRestPose(actionPose(a, T / 2, { side })), false, `${a} ${side} moves`);
    }
  }
  assert.equal(actionPose('dance', 1), REST_POSE, 'an unknown action is the rest pose');
  assert.equal(actionDuration('dance'), 0);
  for (const a of SOUL_ACTIONS) for (const t of [0.3, 1, 1.4]) assert.equal(actionPose(a, t, { reducedMotion: true }), REST_POSE, 'reduced motion: no action');
  assert.ok(Object.isFrozen(REST_POSE) && Object.isFrozen(REST_POSE.bones.armL.rot), 'the rest pose is frozen');
  assert.equal(isRestPose(REST_POSE), true); assert.equal(isRestPose(null), true);
  assert.equal(isRestPose({ yaw: 0, bones: JSON.parse(JSON.stringify(REST_POSE.bones)) }), true, 'a rest-equal copy');
});

test('actions: continuous, bounded, never faster than 3 Hz; only the turn yaws; nothing but motion (no colour, light or opacity)', () => {
  const L = ACTION_LIMITS;
  for (const a of SOUL_ACTIONS) {
    const T = actionDuration(a);
    for (const side of ['left', 'right']) {
      let prev = channels(REST_POSE), extrema = new Array(prev.length).fill(0), slope = new Array(prev.length).fill(0);
      for (const t of sample(T, 120)) {
        const p = actionPose(a, t, { side });
        assert.deepEqual(Object.keys(p).sort(), ['bones', 'yaw']);
        assert.deepEqual(Object.keys(p.bones), SOUL_BONES);
        const c = channels(p);
        // continuity at 120 Hz: the turn's yaw moves at most 0.2 rad per step, a blinking eye 0.1 of its height,
        // every rotation or offset less than 0.06
        c.forEach((v, i) => { const dv = i === 0 ? Math.atan2(Math.sin(v - prev[i]), Math.cos(v - prev[i])) : v - prev[i]; assert.ok(Math.abs(dv) <= ({ yaw: 0.2, scale: 0.1 }[KIND[i]] ?? 0.06), `${a} ${side} jumps at ${t}`); const s = Math.abs(dv) > 1e-12 ? Math.sign(dv) : 0; if (s && slope[i] && s !== slope[i]) extrema[i]++; if (s) slope[i] = s; });
        prev = c;
        const bn = p.bones;
        for (const arm of ['armL', 'armR']) assert.ok(Math.abs(bn[arm].rot[2]) <= L.armLift && Math.abs(bn[arm].rot[0]) === 0);
        for (const leg of ['legL', 'legR']) assert.ok(bn[leg].pos[1] >= 0 && bn[leg].pos[1] <= L.legLift, `${a} leg lift ${bn[leg].pos[1]}`);
        assert.ok(Math.abs(bn.root.rot[2]) <= L.bodyRoll && Math.abs(bn.spine.rot[2]) <= L.bodyRoll && Math.abs(bn.head.rot[2]) <= L.headRoll);
        for (const eye of ['eyeL', 'eyeR']) assert.ok(bn[eye].scale[1] >= L.minEyeScale - 1e-12 && bn[eye].scale[1] <= 1 && bn[eye].scale[0] === 1 && bn[eye].scale[2] === 1);
        if (a !== 'turn') assert.equal(p.yaw, 0, `${a} does not yaw`);
        else assert.ok(Math.abs(p.yaw) <= 2 * Math.PI + 1e-12);
      }
      // every channel changes direction at most 2 x 3 times a second (one full swing = two extrema)
      extrema.forEach((n, i) => assert.ok(n / 2 / T <= L.maxHz, `${a} channel ${i}: ${(n / 2 / T).toFixed(2)} Hz`));
    }
  }
  // the turn is one full turn, one way or the other, and the wink closes one eye to a tenth (about half a second)
  assert.ok(Math.abs(actionPose('turn', 3.999, { side: 'left' }).yaw - 2 * Math.PI) < 1e-6);
  assert.ok(Math.abs(actionPose('turn', 3.999, { side: 'right' }).yaw + 2 * Math.PI) < 1e-6);
  const shut = sample(1.5, 100).filter((t) => actionPose('wink', t, { side: 'left' }).bones.eyeL.scale[1] < 0.5);
  assert.ok(shut.length / 100 > 0.15 && shut.length / 100 < 0.5, `eye shut for ${shut.length / 100} s`);
  assert.ok(Math.abs(Math.min(...sample(1.5, 100).map((t) => actionPose('wink', t, { side: 'left' }).bones.eyeL.scale[1])) - ACTION_LIMITS.minEyeScale) < 1e-12, 'closes to a tenth');
});

test('actions: the right side mirrors the left (bones swap, rolls and yaw flip); the side comes from the seed; pirates wink right', () => {
  const swap = { armL: 'armR', armR: 'armL', legL: 'legR', legR: 'legL', eyeL: 'eyeR', eyeR: 'eyeL' };
  for (const a of SOUL_ACTIONS) {
    for (const t of sample(actionDuration(a), 7).slice(1, -1)) {
      const l = actionPose(a, t, { side: 'left' }), r = actionPose(a, t, { side: 'right' });
      assert.ok(Math.abs(l.yaw + r.yaw) < 1e-12);
      for (const b of SOUL_BONES) {
        const q = l.bones[b], m = r.bones[swap[b] || b];
        // mirror in x: rotations about y and z flip sign, about x stay; x offsets flip; scales stay
        assert.ok(Math.abs(q.rot[0] - m.rot[0]) < 1e-12 && Math.abs(q.rot[1] + m.rot[1]) < 1e-12 && Math.abs(q.rot[2] + m.rot[2]) < 1e-12, `${a} ${b} at ${t}`);
        assert.ok(Math.abs(q.pos[0] + m.pos[0]) < 1e-12 && Math.abs(q.pos[1] - m.pos[1]) < 1e-12 && Math.abs(q.pos[2] - m.pos[2]) < 1e-12);
        assert.deepEqual(q.scale, m.scale);
      }
    }
  }
  // the left side moves the character's left (+X) parts: the left arm lifts outward (+Z roll), the left foot lifts
  assert.ok(actionPose('wave', 1.2, { side: 'left' }).bones.armL.rot[2] > 0.5 && actionPose('wave', 1.2, { side: 'left' }).bones.armR.rot[2] === 0);
  assert.ok(actionPose('step', 0.95, { side: 'left' }).bones.legL.pos[1] > 0.05);
  assert.ok(actionPose('wink', 0.75, { side: 'right' }).bones.eyeR.scale[1] < 0.2);
  const seeds = Array.from({ length: 64 }, (_, i) => `bingo-demo:player-${i}:round-3`);
  const sides = seeds.map((s) => actionSide(s));
  assert.deepEqual(sides, seeds.map((s) => actionSide(s)), 'deterministic');
  assert.ok(sides.includes('left') && sides.includes('right') && Math.abs(sides.filter((s) => s === 'left').length - 32) < 16, 'both sides, roughly half each');
  assert.ok(seeds.every((s) => actionSide(s, { action: 'wink', face: 'pirate' }) === 'right'), 'the patch covers the left eye (+X)');
  assert.ok(seeds.every((s) => actionSide(s, { action: 'wave', face: 'pirate' }) === actionSide(s)));
});

// ---- skin weights on the shipped bodies ------------------------------------------------------------------------

const parse = (url) => { const b = readFileSync(join(ROOT, url.split('?')[0].replace(/^\//, ''))); return new Promise((res, rej) => new loaders.GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', res, rej)); };
const BODIES = { 'baseline hero': soulModelUrl('hero'), 'baseline lite': soulModelUrl('lite') };
if (SOUL_FACE.stub !== true && SOUL_FACE.body) Object.assign(BODIES, { 'v3 hero': SOUL_FACE.body.hero, 'v3 lite': SOUL_FACE.body.lite });
const bodies = {};
async function body(name) {
  if (!bodies[name]) { const m = extractSoulModel(THREE, await parse(BODIES[name]), name.split(' ')[1]); bodies[name] = { m, P: modelSpacePositions(m.geometry.attributes.position, m) }; }
  return bodies[name];
}

test('skin weights on every shipped body: at most three bones, non-negative, summing to 1; the four largest are what skins', async () => {
  for (const name of Object.keys(BODIES)) {
    const { m, P } = await body(name);
    const { index, weight } = computeSkinWeights(P);
    assert.equal(index.length, m.count * 4); assert.ok(index instanceof Uint16Array && weight instanceof Float32Array);
    const w = new Float64Array(SOUL_BONES.length);
    for (let v = 0; v < m.count; v++) {
      let sum = 0, used = 0;
      for (let k = 0; k < 4; k++) { const x = weight[v * 4 + k]; assert.ok(x >= 0); sum += x; if (x > 0) { used++; assert.ok(index[v * 4 + k] < SOUL_BONES.length); } }
      assert.ok(Math.abs(sum - 1) < 1e-6, `${name} vertex ${v} sums to ${sum}`);
      assert.ok(used <= 3);
      boneWeights(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], w);
      assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-12 && w.every((x) => x >= 0));
      assert.ok(!((w[B.armL] + w[B.armR]) > 0 && (w[B.legL] + w[B.legR]) > 0), `${name} vertex ${v}: arm and leg never share a vertex`);
      assert.equal(w[B.eyeL] + w[B.eyeR], 0, 'the eyes are models on the eye bones, never body weights');
    }
    // the same positions give the same weights (a pure function of the shape)
    assert.deepEqual(computeSkinWeights(P).weight, weight);
  }
});

test('skin weights land on the lobes: arms on the outer bottom lobes (left arm on +X), legs on the inner ones, head from the chin up', async () => {
  for (const name of Object.keys(BODIES)) {
    const { m, P } = await body(name);
    const w = new Float64Array(SOUL_BONES.length);
    let armLobe = 0, legLobe = 0, headZone = 0;
    for (let v = 0; v < m.count; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      boneWeights(x, y, z, w);
      const own = x > 0 ? 'L' : 'R', other = x > 0 ? 'R' : 'L';
      assert.equal(w[B[`arm${other}`]] + w[B[`leg${other}`]], 0, `${name}: nothing crosses to the other side`);
      if (Math.abs(x) > 0.42 && y < 0.3) { armLobe++; assert.equal(w[B[`arm${own}`]], 1, `${name} arm lobe at ${x.toFixed(2)}, ${y.toFixed(2)}`); }
      if (Math.abs(x) < 0.3 && y > 0.6) assert.equal(w[B.armL] + w[B.armR], 0, 'the chest never follows an arm');
      if (Math.abs(x) > 0.14 && Math.abs(x) < 0.18 && y < 0.08) { legLobe++; assert.ok(w[B[`leg${own}`]] > 0.9, `${name} foot at ${x.toFixed(2)}, ${y.toFixed(2)}: ${w[B[`leg${own}`]]}`); }
      if (Math.abs(x) > 0.33 || y > SKELETON.legY[1]) assert.equal(w[B.legL] + w[B.legR], 0, 'the legs stop at the slit and above the foot');
      if (y > SKELETON.headBand[1]) { headZone++; assert.equal(w[B.head], 1, `${name}: the face, eyes, plate and antenna follow the head rigidly`); }
      if (y < SKELETON.spineBand[0] && Math.abs(x) < 0.3 && Math.abs(x) > 0.02 && y > SKELETON.legY[1]) assert.equal(w[B.root], 1);
    }
    assert.ok(armLobe > (name.endsWith('hero') ? 400 : 100) && legLobe > 20 && headZone > m.count / 3, `${name}: ${armLobe} arm, ${legLobe} foot, ${headZone} head vertices`);
    // the baseline's orb and button eyes (mask A / G) are pure head
    if (name.startsWith('baseline')) for (let v = 0; v < m.count; v++) if (m.mask[v * 4 + 3] > 0.1 || m.mask[v * 4 + 1] > 0.1) { boneWeights(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], w); assert.equal(w[B.head], 1); }
  }
});

test('skeleton: pivots from the landmarks (eye bones on the eyes), parents before children, charm slots ride the body', () => {
  const v3 = bonePivots(readLandmarks({ landmarks: { floor: -0.02189, eyes: [{ centre: [-0.145, 1.175, 0.3787] }, { centre: [0.145, 1.175, 0.3787] }] } }));
  assert.deepEqual(v3.eyeL, [0.145, 1.175, 0.3787], 'the character\'s left eye (+X) is eyeL, whatever the order');
  assert.deepEqual(v3.eyeR, [-0.145, 1.175, 0.3787]);
  assert.deepEqual(v3.root, [0, -0.02189, 0]);
  assert.deepEqual(v3.armR, [-SKELETON.arm[0], SKELETON.arm[1], SKELETON.arm[2]]);
  const base = bonePivots(readLandmarks({ landmarks: { eyes: [{ centre: [0.21086, 1.165, 0.34544] }, { centre: [-0.21086, 1.165, 0.34544] }] } }));
  assert.deepEqual(base.eyeL, [0.21086, 1.165, 0.34544]);
  SOUL_BONES.forEach((b, i) => { const p = BONE_PARENT[b]; assert.ok(p === null ? b === 'root' : SOUL_BONES.indexOf(p) < i, `${b} after its parent`); });
  // every charm slot of the shipped decor rides the root or the spine: no charm is carried off by a waving arm or a
  // stepping foot, and the upper-arm slots carry no arm weight at all (nothing slides under them)
  for (const s of SOUL_DECOR.slots) {
    assert.ok(['root', 'spine'].includes(dominantBone(s.centre)), `slot ${s.index} rides ${dominantBone(s.centre)}`);
    const w = boneWeights(...s.centre);
    assert.equal(w[B.armL] + w[B.armR], 0, `slot ${s.index} arm weight`);
  }
  if (SOUL_FACE.stub !== true && SOUL_FACE.topper) assert.equal(dominantBone(SOUL_FACE.topper.centre), 'head', 'the antenna charm rides the head');
  // modelSpacePositions applies the node TRS like three.js
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0.5, -0.25, 1, -1, 0.75, 0.2], 3));
  const node = { position: new THREE.Vector3(0.1, 1.2, -0.3), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.2, 0.1)), scale: new THREE.Vector3(1.15, 1.15, 1.15) };
  const out = modelSpacePositions(g.attributes.position, node), m = new THREE.Matrix4().compose(node.position, node.quaternion, node.scale);
  for (let i = 0; i < 2; i++) { const v = new THREE.Vector3().fromBufferAttribute(g.attributes.position, i).applyMatrix4(m); assert.ok(Math.abs(v.x - out[i * 3]) < 1e-6 && Math.abs(v.y - out[i * 3 + 1]) < 1e-6 && Math.abs(v.z - out[i * 3 + 2]) < 1e-6); }
});
