import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AURORA, AURORA_GLSL, auroraPeak, auroraContrast, skyCapContrast, auroraPhase, auroraTierGain, luminanceHex, contrastRatio } from '../src/renderer/aurora.js';
import { THREE_QUALITY } from '../src/renderer/three-quality.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../app.css'), 'utf8');

test('aurora params: teal -> lime, upper third, 0.01 rad/s drift, still under reduced motion', () => {
  assert.equal(AURORA.teal.toUpperCase(), '#4FE3C1'); assert.equal(AURORA.lime.toUpperCase(), '#B6FF5C');
  assert.ok(AURORA.band.bottom <= 0.42 && AURORA.band.centre < 1 / 3, 'ribbon lives in the upper third');
  assert.equal(AURORA.driftRadPerSec, 0.01);
  assert.equal(auroraPhase(100), 1);
  assert.equal(auroraPhase(100, true), 0);
  assert.match(AURORA_GLSL, /min\(cap, i \* cap\)/, 'shader clamps the band to the cap');
});

test('aurora cap: brightest sky pixel keeps >= 4.5:1 against the panel body text and never triggers bloom', () => {
  const peak = auroraPeak();
  assert.ok(auroraContrast('#F2F4FF') >= 4.5, `contrast ${auroraContrast('#F2F4FF').toFixed(2)}`);
  assert.ok(auroraContrast('#F4F6FF') >= 4.5);
  assert.ok(peak.luminance < 0.161, 'peak luminance under the 4.5:1 limit for #F2F4FF');
  // the nebula shader clamps nebula + aurora to skyLumCap: 5.0:1 for body text wherever the band lands
  assert.ok(AURORA.skyLumCap <= 0.161 && skyCapContrast('#F2F4FF') >= 4.5, `sky cap contrast ${skyCapContrast('#F2F4FF').toFixed(2)}`);
  for (const q of ['high', 'medium', 'low']) assert.ok(auroraTierGain(q) <= 1, `${q} never exceeds the cap`);
  for (const q of ['high', 'medium']) assert.ok(AURORA.intensityCap * auroraTierGain(q) < THREE_QUALITY[q].bloom.threshold, `${q}: aurora stays under the bloom threshold`);
  // a cap of 0.20 would fail the rule - the constant is load-bearing
  assert.ok(auroraContrast('#F2F4FF', { ...AURORA, intensityCap: 0.2 }) < 4.5);
  assert.ok(contrastRatio(luminanceHex('#E7DFFF'), luminanceHex('#2D2670')) >= 10, 'pill ink on badge (token rule)');
});

test('static / reduced tiers: app.css draws the same band as a still CSS gradient on non-Three renderers, capped', () => {
  const rule = css.match(/body:not\(\[data-renderer="three"\]\) \.galaxy::after \{[^}]+\}/);
  assert.ok(rule, 'non-three aurora rule present');
  assert.match(rule[0], /rgba\(79,227,193/, 'teal');
  assert.match(rule[0], /rgba\(182,255,92/, 'lime');
  const alphas = [...rule[0].matchAll(/rgba\((?:79,227,193|182,255,92),\.(\d+)\)/g)].map(m => Number('0.' + m[1]));
  assert.ok(alphas.length >= 3 && Math.max(...alphas) <= 0.3, 'CSS band alpha capped at .30');
  const ys = [...rule[0].matchAll(/ellipse \d+% \d+% at \d+% (\d+)%/g)].map(m => Number(m[1]));
  assert.equal(ys.length, 3);
  assert.ok(ys.every(y => y <= 33), 'CSS band sits in the upper third');
  assert.match(css, /\.galaxy__label \{[^}]*color: var\(--ui-text\)/, 'cluster labels use the full text colour over the band');
});
