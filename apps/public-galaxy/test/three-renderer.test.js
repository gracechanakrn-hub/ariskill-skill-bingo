import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as nodeModule from 'node:module';
import { THREE_QUALITY, qualitySettings, pixelRatioFor, bloomStrength, pulseValue, BLOOM_PULSE } from '../src/renderer/three-quality.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const rendererPath = resolve(here, '../src/renderer/three.js');
const source = readFileSync(rendererPath, 'utf8');

test('three renderer imports the vendored library by absolute path only (no CDN, no import map, no npm)', () => {
  assert.match(source, /from '\/packages\/vendor\/three\/index\.js'/);
  assert.match(source, /from '\/packages\/vendor\/three\/addons\.js'/);
  assert.doesNotMatch(source, /https?:\/\//, 'no remote URLs');
  assert.doesNotMatch(source, /from ['"]three['"]/, 'no bare specifier (would need an import map)');
  assert.doesNotMatch(source, /innerHTML|eval\(|new Function/, 'CSP-safe: no innerHTML / eval');
});

test('three renderer module exports createThreeRenderer (resolved through the vendored path)', async () => {
  if (typeof nodeModule.registerHooks !== 'function') { assert.ok(true, 'registerHooks unavailable on this Node; source checks only'); return; }
  const hook = nodeModule.registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('/packages/')) return { url: pathToFileURL(resolve(repoRoot, '.' + specifier)).href, shortCircuit: true };
      return next(specifier, context);
    },
  });
  try {
    const mod = await import(pathToFileURL(rendererPath).href);
    assert.equal(typeof mod.createThreeRenderer, 'function');
    assert.equal(mod.THREE_RENDERER_KIND, 'three');
    assert.throws(() => mod.createThreeRenderer({ container: null, atlas: null }), /DOM/, 'refuses to build without a document (galaxy.js then falls back)');
  } finally { hook.deregister(); }
});

test('quality table: bloom off on low, resolution scale per level, pixel ratio bounded', () => {
  assert.equal(THREE_QUALITY.low.bloom, null);
  assert.ok(THREE_QUALITY.high.bloom.strength > 0 && THREE_QUALITY.medium.bloom.strength > 0);
  assert.ok(THREE_QUALITY.high.resolutionScale > THREE_QUALITY.medium.resolutionScale && THREE_QUALITY.medium.resolutionScale > THREE_QUALITY.low.resolutionScale);
  assert.equal(pixelRatioFor('high', 2), 2);
  assert.equal(pixelRatioFor('medium', 2), 1.5 * 0.85);
  assert.equal(pixelRatioFor('low', 2), 0.7);
  assert.equal(pixelRatioFor('unknown', 1), 1);
  assert.equal(qualitySettings('nope'), THREE_QUALITY.high);
  assert.ok(THREE_QUALITY.high.fireflies >= THREE_QUALITY.medium.fireflies && THREE_QUALITY.medium.fireflies >= THREE_QUALITY.low.fireflies);
});

test('bloom strength: base plus a clamped transient boost; pulses decay to zero (single, non-repeating)', () => {
  assert.equal(bloomStrength('low', 1), 0);
  assert.equal(bloomStrength('high', 0), THREE_QUALITY.high.bloom.strength);
  assert.equal(bloomStrength('high', 5), THREE_QUALITY.high.bloom.strength + 1);
  assert.equal(pulseValue(BLOOM_PULSE.entrance, 1000, 400, 1000), BLOOM_PULSE.entrance);
  assert.equal(pulseValue(BLOOM_PULSE.entrance, 1000, 400, 1200), BLOOM_PULSE.entrance / 2);
  assert.equal(pulseValue(BLOOM_PULSE.entrance, 1000, 400, 1400), 0);
  assert.equal(pulseValue(1, NaN, 400, 1400), 0);
  assert.equal(pulseValue(1, 1000, 400, 900), 0);
  assert.ok(BLOOM_PULSE.entrance <= 0.5 && BLOOM_PULSE.winner <= 0.5, 'restrained pulses');
});
