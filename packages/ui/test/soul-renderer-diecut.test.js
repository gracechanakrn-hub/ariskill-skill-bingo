// Stage 15 (D-36): the big screen draws Souls without the white die-cut outline. renderSoulSvg({ dieCut: false })
// leaves out the outline and its sticker shadow; the default output stays byte for byte (the v1 / v2 pins cover it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSoulSvg } from '../soul-renderer.js';
import { v3Config } from './face-fixture.js';

const V2 = { version: 2, catalog: 1, seed: 'diecut-v2', gradient: 3, glow: 0, face: 'nerdy', charms: [], constellation: [], driftPhase: 0 };
const V1 = { body: 0, palette: 1, eyes: 0, antenna: 0, mouth: 0, glow: 0, constellation: [], driftPhase: 0, seed: 'diecut-v1' };

test('dieCut: false drops the white outline and its shadow at every detail; true (the default) is unchanged', () => {
  for (const cfg of [V1, V2, v3Config()]) {
    for (const detail of ['full', 'simple']) {
      const on = renderSoulSvg(cfg, { detail, idPrefix: 'x' });
      assert.equal(renderSoulSvg(cfg, { detail, idPrefix: 'x', dieCut: true }), on, 'explicit true = the default');
      const off = renderSoulSvg(cfg, { detail, idPrefix: 'x', dieCut: false });
      assert.match(on, /stroke="#fff"/, 'the default has the white outline');
      assert.doesNotMatch(off, /<use href="#x-p" fill="#fff" stroke="#fff"/, `${detail}: no white outline`);
      assert.doesNotMatch(off, /feDropShadow/, `${detail}: no sticker shadow`);
      assert.ok(off.length < on.length);
      assert.ok(off.includes('<use href="#x-p" fill="url(#x-b)"'), 'the body is still drawn');
    }
    assert.equal(renderSoulSvg(cfg, { detail: 'dot', dieCut: false }), renderSoulSvg(cfg, { detail: 'dot' }), 'dot has no die-cut anyway');
  }
});
