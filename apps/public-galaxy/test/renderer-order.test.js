import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendererOrder, normaliseMode, entranceTimings, DEFAULT_ORDER } from '../src/galaxy.js';
import { DEFAULT_SCENE_CONFIG } from '../src/renderer/scene.js';

test('renderer order: three -> webgl2 -> canvas2d -> static by default (scene-config webgl2 maps onto the Three tier)', () => {
  assert.deepEqual(rendererOrder(), [...DEFAULT_ORDER]);
  assert.deepEqual(rendererOrder({ fallback: ['webgl2', 'canvas2d', 'static'] }), ['three', 'webgl2', 'canvas2d', 'static']);
  assert.deepEqual(rendererOrder({ fallback: ['canvas2d'] }), ['canvas2d', 'static']);
  assert.equal(rendererOrder()[0], 'three');
  assert.equal(rendererOrder().at(-1), 'static');
});

test('renderer order: URL switches and reduced motion', () => {
  assert.deepEqual(rendererOrder({ mode: 'static' }), ['static']);
  assert.deepEqual(rendererOrder({ mode: 'canvas2d' }), ['canvas2d', 'static']);
  assert.deepEqual(rendererOrder({ mode: 'three' }), ['three', 'webgl2', 'canvas2d', 'static']);
  assert.deepEqual(rendererOrder({ mode: 'webgl2' }), rendererOrder({ mode: 'three' }), 'webgl2 is an alias of three');
  assert.deepEqual(rendererOrder({ reducedMotion: true }), ['static']);
  assert.deepEqual(rendererOrder({ reducedMotion: true, mode: 'three' }), ['three', 'webgl2', 'canvas2d', 'static'], 'an explicit mode wins for rehearsal');
});

test('normaliseMode accepts three|canvas2d|static and the legacy webgl2 alias', () => {
  assert.equal(normaliseMode('three'), 'three');
  assert.equal(normaliseMode('webgl2'), 'three');
  assert.equal(normaliseMode('canvas2d'), 'canvas2d');
  assert.equal(normaliseMode('static'), 'static');
  assert.equal(normaliseMode('gl'), null);
  assert.equal(normaliseMode(null), null);
});

test('entrance timings come from tokens/motion.json#galaxyEntrance and fall back to scene-config', () => {
  const motion = { interactions: { galaxyEntrance: { arcMs: 1800, pulseMs: 400, settleMs: 600 } } };
  assert.deepEqual(entranceTimings(DEFAULT_SCENE_CONFIG, motion), { arcMs: 1800, pulseMs: 400, settleMs: 600 });
  assert.deepEqual(entranceTimings(DEFAULT_SCENE_CONFIG, null), { arcMs: 2200, pulseMs: 600, settleMs: 1200 });
  assert.deepEqual(entranceTimings(DEFAULT_SCENE_CONFIG, { interactions: { galaxyEntrance: { arcMs: 0 } } }), { arcMs: 2200, pulseMs: 600, settleMs: 1200 });
});
