// Pure helpers of the ambient backdrop (src/backdrop.js): deterministic layouts, frame cap, safe fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, starField, fireflyField, foliageBlobs, frameDue, webglAvailable, mountBackdrop, BACKDROP_FPS, BACKDROP_PIXEL_RATIO, BACKDROP_SEED, auroraField, auroraSample, auroraLuminance, auroraFragmentShader, AURORA_DRIFT_RAD_PER_S, AURORA_LUMINANCE_CAP, AURORA_RIBBONS } from '../src/backdrop.js';

test('createRng is deterministic and bounded', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const sa = Array.from({ length: 50 }, () => a()), sb = Array.from({ length: 50 }, () => b()), sc = Array.from({ length: 50 }, () => c());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('starField is deterministic, clip-space bounded and sized within range', () => {
  const f1 = starField(200, 7, { sizeMin: 1, sizeMax: 3 }), f2 = starField(200, 7, { sizeMin: 1, sizeMax: 3 });
  assert.deepEqual(Array.from(f1.positions), Array.from(f2.positions));
  assert.equal(f1.positions.length, 600); assert.equal(f1.sizes.length, 200); assert.equal(f1.colors.length, 600);
  for (let i = 0; i < 200; i++) {
    assert.ok(f1.positions[i * 3] >= -1 && f1.positions[i * 3] <= 1);
    assert.ok(f1.positions[i * 3 + 1] >= -1 && f1.positions[i * 3 + 1] <= 1);
    assert.equal(f1.positions[i * 3 + 2], 0);
    assert.ok(f1.sizes[i] >= 1 && f1.sizes[i] <= 3);
    assert.ok(f1.phases[i] >= 0 && f1.phases[i] < 1);
  }
});

test('fireflyField stays above the footer band and uses only gold or violet', () => {
  const f = fireflyField(60, 3);
  for (let i = 0; i < 60; i++) {
    assert.ok(f.positions[i * 3 + 1] > -0.82 - 1e-9, 'never in the footer band');
    assert.ok(f.positions[i * 3 + 1] <= 1);
    const gold = f.colors[i * 3] === 1 && f.colors[i * 3 + 2] < 0.5;
    const violet = f.colors[i * 3 + 2] === 1 && f.colors[i * 3] < 1;
    assert.ok(gold || violet);
    assert.ok(f.sizes[i] >= 9 && f.sizes[i] <= 19);
  }
});

test('foliageBlobs is deterministic and stays inside the texture quarter', () => {
  const a = foliageBlobs(5), b = foliageBlobs(5);
  assert.deepEqual(a, b);
  assert.equal(a.blobs.length, 110); assert.equal(a.fronds.length, 9);
  for (const bl of a.blobs) { assert.ok(bl.x >= 0 && bl.x <= 1 && bl.y >= 0 && bl.y <= 1); assert.ok(bl.alpha > 0 && bl.alpha <= 1); assert.ok(bl.rx > 0 && bl.ry > 0); }
  for (const fr of a.fronds) assert.ok(fr.angle > 0 && fr.angle < Math.PI / 2 && fr.length <= 1);
});

test('frameDue caps the loop at 30 fps', () => {
  assert.equal(BACKDROP_FPS, 30); assert.equal(BACKDROP_PIXEL_RATIO, 0.5);
  assert.equal(frameDue(null, 100), true);
  assert.equal(frameDue(100, 110), false);
  assert.equal(frameDue(100, 130), false);
  assert.equal(frameDue(100, 132), true);
  assert.equal(frameDue(100, 200), true);
  let rendered = 0, last = null;
  for (let ts = 0; ts < 1000; ts += 1000 / 60) { if (frameDue(last, ts)) { rendered++; last = ts; } }
  assert.ok(rendered <= 31 && rendered >= 29, `rendered ${rendered} frames in 1 s`);
});

test('webglAvailable is false without a document or a context', () => {
  assert.equal(webglAvailable(null), false);
  assert.equal(webglAvailable({ createElement: () => ({ getContext: () => null }) }), false);
  assert.equal(webglAvailable({ createElement: () => { throw new Error('boom'); } }), false);
});

test('mountBackdrop falls back to CSS mode without WebGL and never throws', async () => {
  const ctl = await mountBackdrop(null, {});
  assert.equal(ctl.mode, 'css');
  assert.doesNotThrow(() => { ctl.setReducedMotion(true); ctl.dispose(); });
  const fakeDoc = { createElement: () => ({ getContext: () => null }) };
  const ctl2 = await mountBackdrop({ ownerDocument: fakeDoc }, { win: {}, loadThree: async () => { throw new Error('must not load'); } });
  assert.equal(ctl2.mode, 'css');
});

// ---- aurora band (art direction v2) ---------------------------------------------------------------------------
test('auroraField is deterministic and keeps every ribbon in the upper sky', () => {
  const a = auroraField(BACKDROP_SEED + 6), b = auroraField(BACKDROP_SEED + 6), c = auroraField(BACKDROP_SEED + 7);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.ribbons, c.ribbons);
  assert.equal(a.ribbons.length, AURORA_RIBBONS);
  assert.equal(a.drift, AURORA_DRIFT_RAD_PER_S); assert.equal(AURORA_DRIFT_RAD_PER_S, 0.01);
  assert.equal(a.cap, AURORA_LUMINANCE_CAP);
  for (const r of a.ribbons) {
    assert.ok(r.y >= 0.70 && r.y <= 0.86, 'centre in the upper sky');
    assert.ok(r.amp > 0 && r.amp <= 0.07 && r.y - r.amp > 0.6, 'wave never dips into the tile area');
    assert.ok(r.width > 0 && r.width <= 0.11 && r.freq > 0 && r.speed >= 0.6 && r.speed <= 1.4 && r.gain >= 0.8 && r.gain <= 1.2);
    assert.ok(r.phase >= 0 && r.phase < Math.PI * 2);
  }
});

test('auroraSample stays in [0, 1], under the luminance cap, and never touches the lower sky', () => {
  const field = auroraField(BACKDROP_SEED + 6);
  let maxY = 0, lit = 0, samples = 0;
  for (const t of [0, 1, 37.5, 600, 3600]) {
    for (let v = 0; v <= 1.0001; v += 0.02) {
      for (let u = 0; u <= 1.0001; u += 0.02) {
        const c = auroraSample(field, u, v, t);
        samples++;
        for (const ch of c) assert.ok(ch >= 0 && ch <= 1, `channel in range (${u}, ${v}, ${t})`);
        const y = auroraLuminance(c);
        assert.ok(y <= AURORA_LUMINANCE_CAP + 1e-9, `luminance ${y} over the cap at (${u}, ${v}, ${t})`);
        if (v < 0.5) assert.deepEqual(c, [0, 0, 0], 'no light under the tiles / footer band');
        if (y > 0.02) lit++;
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert.ok(maxY > AURORA_LUMINANCE_CAP * 0.9, `the band reaches its cap somewhere (max ${maxY})`);
  assert.ok(lit / samples > 0.03, 'a visible ribbon, not a few pixels');
  // top edge fades out so the band does not hard-clip at the viewport edge
  assert.deepEqual(auroraSample(field, 0.5, 1.0, 0), [0, 0, 0]);
});

test('auroraSample is deterministic and drifts slowly (0.01 rad/s)', () => {
  const field = auroraField(BACKDROP_SEED + 6);
  assert.deepEqual(auroraSample(field, 0.3, 0.78, 12), auroraSample(field, 0.3, 0.78, 12));
  // one second of drift moves the ribbon by well under a pixel's worth of light; two minutes is clearly visible
  let maxDelta1s = 0, maxDelta2min = 0;
  for (let u = 0; u <= 1.0001; u += 0.05) for (let v = 0.6; v <= 0.95; v += 0.05) {
    const a = auroraSample(field, u, v, 0), b = auroraSample(field, u, v, 1), c = auroraSample(field, u, v, 120);
    for (let i = 0; i < 3; i++) { maxDelta1s = Math.max(maxDelta1s, Math.abs(a[i] - b[i])); maxDelta2min = Math.max(maxDelta2min, Math.abs(a[i] - c[i])); }
  }
  assert.ok(maxDelta1s < 0.02, `1 s drift changes a channel by ${maxDelta1s}`);
  assert.ok(maxDelta2min > 0.02, `2 min drift is visible (${maxDelta2min})`);
  // teal on the left, lime on the right (hue travels with u)
  const left = auroraSample(field, 0.05, field.ribbons[0].y, 0), right = auroraSample(field, 0.95, field.ribbons[0].y, 0);
  if (auroraLuminance(left) > 0.02 && auroraLuminance(right) > 0.02) assert.ok(right[0] / right[1] > left[0] / left[1], 'more red (lime) on the right than on the left (teal)');
});

test('auroraFragmentShader mirrors the reference sampler (ribbon count, cap clamp, Rec. 709 weights, additive output)', () => {
  const src = auroraFragmentShader(3);
  assert.match(src, /#define RIBBONS 3\b/);
  assert.match(src, /uniform vec4 uRibbonA\[RIBBONS\]/);
  assert.match(src, /uniform vec3 uRibbonB\[RIBBONS\]/);
  assert.match(src, /vec3\(0\.2126, 0\.7152, 0\.0722\)/);
  assert.match(src, /if \(y > uCap\) col \*= uCap \/ y;/);
  assert.match(src, /smoothstep\(0\.50, 0\.66, v\) \* smoothstep\(1\.0, 0\.94, v\)/);
  assert.match(auroraFragmentShader(0), /#define RIBBONS 1\b/, 'never an empty uniform array');
});
