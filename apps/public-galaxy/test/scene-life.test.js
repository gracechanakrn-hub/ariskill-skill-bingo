// Stage 15 (D-36): depth and layers in the Galaxy's movement, micro actions where Souls orbit, and one Soul at a time
// floating to the front to wave hi. scene.js only plans; the renderers draw what frame() returns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createScene, placeSouls, soulDepth, depthScale, depthAlpha, actLaneAt, pickSoul, visitActions, LIFE, DEPTH,
  DEFAULT_RINGS, DEFAULT_SCENE_CONFIG,
} from '../src/renderer/scene.js';
import { SOUL_ACTIONS, actionDuration } from '../../../packages/ui/soul3d/actions.js';
import { createEntranceQueue } from '../src/entrance-queue.js';
import { readingSeconds } from '../src/greeting-bubble.js';

const decorated = (n, from = 0) => Array.from({ length: n }, (_, k) => {
  const i = k + from;
  return { soulId: `soul_${i}`, badge: null, edge: 'bottom', config: { version: 2, catalog: 1, seed: `seed-${i}`, gradient: i % 12, glow: 0, face: ['nerdy', 'pirate', 'angel'][i % 3], charms: [], constellation: [], driftPhase: (i % 10) / 10 } };
});
const v1 = (n) => Array.from({ length: n }, (_, i) => ({ soulId: `old_${i}`, badge: null, config: { seed: `o${i}`, body: 0, palette: i % 8, driftPhase: 0 } }));
const sceneWith = (list, opts = {}) => { const s = createScene({ config: DEFAULT_SCENE_CONFIG, rings: DEFAULT_RINGS, starLayers: [], ...opts }); s.setSouls(list); return s; };

test('depth: near at the bottom of a ring, far at the top; size and haze follow; every Soul averages the same over an orbit (BR-17)', () => {
  const p = placeSouls(decorated(40));
  for (const pl of p.values()) {
    const bottom = { ...pl, angle: Math.PI / 2, float: undefined }, top = { ...pl, angle: -Math.PI / 2, float: undefined };
    assert.ok(soulDepth(bottom, 0) > 0.9 && soulDepth(top, 0) < 0.1);
    const period = (2 * Math.PI) / DEFAULT_RINGS.rings[pl.ring].angularSpeedRadPerSec;
    let sum = 0, n = 0;
    for (let t = 0; t < period; t += period / 400) { const d = soulDepth(pl, t); assert.ok(d >= 0 && d <= 1); sum += depthScale(d); n++; }
    assert.ok(Math.abs(sum / n - 1) < 0.03, `mean scale ${sum / n}`);
  }
  assert.equal(depthScale(0), DEPTH.scale[0]); assert.equal(depthScale(1), DEPTH.scale[1]);
  assert.equal(depthAlpha(1), 1); assert.ok(depthAlpha(0) >= 0.7, 'far Souls stay clearly visible');
});

test('frame: Souls come sorted far to near with depth, scale and alpha; reduced motion keeps the flat Galaxy', () => {
  const scene = sceneWith(decorated(40));
  const f = scene.frame(30, 30000);
  assert.equal(f.souls.length + f.visits.length, 40);
  for (let i = 1; i < f.souls.length; i++) assert.ok(f.souls[i - 1].depth <= f.souls[i].depth, 'far first');
  for (const s of f.souls) { assert.equal(s.scale, depthScale(s.depth)); assert.equal(s.alpha, depthAlpha(s.depth)); }
  const flat = sceneWith(decorated(40), { reducedMotion: true });
  for (const t of [0, 30, 95]) {
    const g = flat.frame(t, t * 1000);
    assert.equal(g.visits.length, 0);
    for (const s of g.souls) { assert.equal(s.scale, 1); assert.equal(s.alpha, 1); assert.equal(s.act, undefined); }
  }
});

test('life plan: nothing in the first seconds (static renders stay calm); at most 3 actions and 1 visit at any time', () => {
  for (let lane = 0; lane < LIFE.actLanes; lane++) assert.equal(actLaneAt(lane, 0), null);
  const scene = sceneWith(decorated(30));
  assert.equal(scene.frame(0, 0).visits.length, 0);
  assert.ok(scene.frame(0, 0).souls.every((s) => !s.act));
  let sawAct = false, sawVisit = false;
  for (let t = 0; t < 240; t += 0.25) {
    const f = scene.frame(t, t * 1000);
    const acting = f.souls.filter((s) => s.act);
    assert.ok(acting.length <= LIFE.actLanes, `t=${t}`);
    assert.ok(f.visits.length <= 1);
    for (const s of acting) {
      assert.ok(SOUL_ACTIONS.includes(s.act.action));
      assert.ok(s.act.t >= 0 && s.act.t < actionDuration(s.act.action));
      assert.ok(s.act.side === 'left' || s.act.side === 'right');
    }
    if (f.visits.length) {
      const v = f.visits[0];
      assert.ok(!f.souls.some((s) => s.soulId === v.soulId), 'a visiting Soul leaves the orbit list');
      assert.ok(!acting.some((s) => s.soulId === v.soulId));
      sawVisit = true;
    }
    sawAct ||= acting.length > 0;
  }
  assert.ok(sawAct && sawVisit);
});

/** Steps a scene at 60 fps from t0 to t1 and returns the frames ({ t, f }). */
function run(scene, t0, t1, dt = 1 / 60) { const out = []; for (let t = t0; t <= t1; t += dt) out.push({ t, f: scene.frame(t, t * 1000) }); return out; }
/** The visits in a run: [{ soulId, key, start, hiStart, backStart, end, frames }]. */
function visitsIn(frames) {
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    const v = frames[i].f.visits[0];
    if (!v) continue;
    let cur = out[out.length - 1];
    if (!cur || cur.key !== v.key) { cur = { soulId: v.soulId, key: v.key, start: frames[i].t, first: i, frames: [] }; out.push(cur); }
    cur.frames.push({ i, t: frames[i].t, v });
    if (v.phase === 'hi' && cur.hiStart === undefined) cur.hiStart = frames[i].t;
    if (v.phase === 'back' && cur.backStart === undefined) cur.backStart = frames[i].t;
    cur.end = frames[i].t; cur.last = i;
  }
  return out;
}

test('say hi: out to the front (hero size, inside the Galaxy), wave first, back to exactly its orbit place', () => {
  const scene = sceneWith(decorated(24));
  const L = scene.layout;
  const frames = run(scene, 0, 40);
  const [visit] = visitsIn(frames);
  assert.ok(visit, 'a visit within 40 s');
  assert.ok(visit.start >= LIFE.startDelayS + LIFE.visitDelayS - 1e-9, 'not before the first ten seconds');
  const id = visit.soulId;
  const before = frames[visit.first - 1].f.souls.find((s) => s.soulId === id), start = frames[visit.first].f.visits[0];
  assert.ok(before, 'orbiting just before the visit');
  assert.ok(Math.hypot(before.x - start.x, before.y - start.y) < before.size * 0.1, 'leaves from its own place');
  assert.ok(Math.abs(before.scale - start.scale) < 0.05);
  const hi = visit.frames.find((x) => x.v.phase === 'hi').v;
  assert.ok(hi.scale >= LIFE.visitScale);
  assert.ok(hi.size * hi.scale >= LIFE.visitHeight * L.height - 1e-9, 'a hero-sized hi, however crowded the sky');
  assert.equal(hi.act.action, 'wave', 'it waves first');
  const half = (hi.size * hi.scale) / 2;
  assert.ok(hi.x - half >= 0 && hi.x + half <= L.width && hi.y - half >= 0 && hi.y + half <= L.height + 1, 'fully inside the Galaxy');
  const last = frames[visit.last].f.visits[0], after = frames[visit.last + 1].f.souls.find((s) => s.soulId === id);
  assert.equal(last.phase, 'back');
  assert.ok(after, 'back in the orbit list');
  assert.ok(Math.hypot(last.x - after.x, last.y - after.y) < after.size * 0.1, 'lands on its own moving place');
});

test('say hi lasts as long as the bubble takes to read; long hellos also wink and sway; the next visit follows 3-7 s later', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  const greets = [null, 'Go team!', words(12), words(25), words(40)];
  const list = decorated(15).map((s, i) => ({ ...s, label: `Name ${i}`, greeting: greets[i % greets.length] }));
  const scene = sceneWith(list);
  const frames = run(scene, 0, 400, 1 / 30);
  const visits = visitsIn(frames).slice(0, -1);             // the last one may be cut off by the end of the run
  assert.ok(visits.length >= 8);
  let longSeen = false;
  for (const v of visits) {
    const s = list.find((x) => x.soulId === v.soulId);
    const want = readingSeconds({ label: s.label, greeting: s.greeting });
    const hiS = v.backStart - v.hiStart;
    assert.ok(Math.abs(hiS - want) < 0.1, `${v.soulId}: hi ${hiS.toFixed(2)} s, reading time ${want.toFixed(2)} s`);
    const acts = v.frames.filter((x) => x.v.phase === 'hi' && x.v.act).map((x) => x.v.act.action);
    const order = [...new Set(acts)];
    assert.deepEqual(order, visitActions(want).map((a) => a.action), `${v.soulId}: ${order}`);
    if (want >= 12) longSeen = true;
  }
  assert.ok(longSeen, 'a 40-word hello was on screen');
  for (let k = 1; k < visits.length; k++) {
    const gap = visits[k].start - visits[k - 1].end;
    assert.ok(gap >= LIFE.visitGapS[0] - 0.1 && gap <= LIFE.visitGapS[1] + 0.1, `gap ${gap.toFixed(2)} s`);
  }
  // the actions of a long hi never overlap and all end before it floats back
  for (const hiS of [3.8, 8, 12, 16]) {
    const a = visitActions(hiS);
    for (let k = 1; k < a.length; k++) assert.ok(a[k].at >= a[k - 1].at + actionDuration(a[k - 1].action));
    assert.ok(a[a.length - 1].at + actionDuration(a[a.length - 1].action) <= hiS);
  }
});

test('only decorated Souls act or visit; picks are random and fair across Souls; entering Souls never do', () => {
  const scene = sceneWith([...v1(10), ...decorated(20)]);
  const count = new Map();
  for (let t = 0; t < 1800; t += 0.5) {
    const f = scene.frame(t, t * 1000);
    for (const s of f.souls) if (s.act) { assert.ok(s.soulId.startsWith('soul_')); count.set(s.soulId, (count.get(s.soulId) || 0) + 1); }
    for (const v of f.visits) assert.ok(v.soulId.startsWith('soul_'));
  }
  assert.equal(count.size, 20, 'every decorated Soul gets a turn');
  const mean = [...count.values()].reduce((a, b) => a + b, 0) / count.size;
  assert.ok(Math.max(...count.values()) < mean * 3, 'no Soul is favoured');
  assert.equal(pickSoul('k', ['a', 'b', 'c']), pickSoul('k', ['c', 'b', 'a']), 'order does not matter');
});

test('nothing new starts while a Float entrance is in flight; fewer act lanes on lower quality levels', () => {
  const queue = createEntranceQueue({ maxConcurrent: 6, arcMs: 2200, pulseMs: 600, settleMs: 1200 });
  const scene = sceneWith(decorated(20), { queue });
  scene.addSoul({ ...decorated(1, 99)[0] });
  queue.enqueue('soul_99', 0);                             // in flight from 0 to 4 s of wall time
  // map scene time t to wall time so the entrance covers t = 5.9 .. 9.9 s: the first act slots start in that window
  const f = (t) => scene.frame(t, (t - 5.9) * 1000);
  for (let t = 5.9; t < 9.8; t += 0.1) { const g = f(t); assert.equal(g.visits.length, 0); assert.ok(g.souls.every((s) => !s.act), `t=${t}`); }
  const low = sceneWith(decorated(20), { quality: 'low' }), med = sceneWith(decorated(20), { quality: 'medium' });
  let lowActs = 0, medMax = 0, lowVisit = false;
  for (let t = 0; t < 120; t += 0.25) {
    const a = low.frame(t, t * 1000), b = med.frame(t, t * 1000);
    lowActs += a.souls.filter((s) => s.act).length; lowVisit ||= a.visits.length > 0;
    medMax = Math.max(medMax, b.souls.filter((s) => s.act).length);
  }
  assert.equal(lowActs, 0, 'low quality: no micro actions'); assert.ok(lowVisit, 'low quality still says hi');
  assert.ok(medMax <= 2 && medMax > 0);
});

test('a Soul that just floated in says hi next, after earlier arrivals; random visitors fill the gaps; replays never queue', () => {
  const queue = createEntranceQueue({ maxConcurrent: 6, arcMs: 2200, pulseMs: 600, settleMs: 1200 });
  const scene = sceneWith(decorated(60), { queue });
  const before = run(scene, 0, 40, 1 / 30);                // the usual random visits first
  // at t = 40 s two players float in live (Nok first), one Soul arrives by replay, and an undecorated one floats
  const nok = { ...decorated(1, 100)[0], label: 'Nok', greeting: 'Good luck, everyone!' }, pim = { ...decorated(1, 101)[0], label: 'Pim', greeting: null };
  for (const s of [nok, pim]) { scene.addSoul(s); queue.enqueue(s.soulId, 40000); assert.equal(scene.queueHi(s.soulId), true); }
  assert.equal(scene.queueHi('soul_100'), false, 'queued once');
  scene.addSoul(decorated(1, 102)[0]);                    // replay / snapshot: no queueHi
  scene.addSoul(v1(1)[0]); assert.equal(scene.queueHi('old_0'), false, 'undecorated Souls never visit');
  const after = run(scene, 40, 140, 1 / 30);
  const visits = visitsIn(after).filter((v) => v.start >= 40.5);
  assert.deepEqual(visits.slice(0, 2).map((v) => v.soulId), ['soul_100', 'soul_101'], 'arrivals first, in arrival order');
  assert.ok(visits[0].start >= 44 - 1e-6, 'not before its entrance is over');
  assert.ok(visits[0].start < 40 + 4 + (LIFE.visitOutS + 16 + LIFE.visitBackS) + LIFE.visitGapS[1] + 1, `Nok says hi at ${visits[0].start.toFixed(1)} s`);
  assert.equal(visits[0].frames.find((x) => x.v.phase === 'hi').v.greeting, 'Good luck, everyone!');
  // waiting for their turn, the arrivals never start a random micro action
  for (const { t, f } of after) for (const s of f.souls) if ((s.soulId === 'soul_100' && t < visits[0].start) || (s.soulId === 'soul_101' && t < visits[1].start)) assert.ok(!s.act, `${s.soulId} acting at ${t}`);
  assert.ok(visits.length >= 5 && visits.slice(2).every((v) => !['soul_100', 'soul_101'].includes(v.soulId) || v.start > visits[1].end), 'then random visitors again');
  assert.ok(visitsIn(before).length >= 1);
  // reduced motion: no visits, so nobody queues
  const calm = sceneWith(decorated(5), { reducedMotion: true });
  calm.addSoul(decorated(1, 200)[0]);
  assert.equal(calm.queueHi('soul_200'), false);
});

