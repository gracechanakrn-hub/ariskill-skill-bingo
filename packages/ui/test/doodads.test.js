// Sticker doodads: deterministic, decorative, text-free, white die-cut, sprite sheet parity. Run: node --test packages/ui/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doodadSvg, doodadSymbol, doodadSpriteSheet, DOODAD_NAMES, DOODAD_VIEWBOX, DOODAD_SYMBOL_PREFIX } from '../doodads.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tokens = JSON.parse(readFileSync(join(ROOT, 'packages/design-tokens/tokens.json'), 'utf8')).themes.dark.tokens;

test('six doodads: rocket, ufo, planet, comet, star, medallion; deterministic; unknown names return null', () => {
  assert.deepEqual([...DOODAD_NAMES], ['rocket', 'ufo', 'planet', 'comet', 'star', 'medallion']);
  for (const name of DOODAD_NAMES) {
    const a = doodadSvg(name, 48), b = doodadSvg(name, 48);
    assert.equal(a, b);
    assert.ok(a.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="48" height="48"') && a.endsWith('</svg>'));
    assert.ok(a.includes('aria-hidden="true"') && a.includes(`data-doodad="${name}"`), 'decorative');
    assert.ok(doodadSvg(name, 96).includes('width="96" height="96"'));
    assert.ok(Buffer.byteLength(a) <= 2048, `${name} ${Buffer.byteLength(a)} bytes`);
  }
  assert.equal(doodadSvg('dragon', 48), null);
  assert.equal(doodadSymbol('dragon'), null);
  assert.equal(DOODAD_VIEWBOX, 64);
});

test('flat 2-tone + white die-cut style: no text, no raster, no filters, white outline group first, sticker colours only', () => {
  const allowed = new Set(['#0B1030', '#151C48', '#8B7CF0', '#3B2A7A', '#7CF5C8', '#63E6FF', '#FFB27A', '#F6C453', '#FF6FA5', '#FFFFFF', '#CDB9FF', '#FFF0B3']);
  for (const name of DOODAD_NAMES) {
    const svg = doodadSvg(name, 48);
    assert.ok(!/<text|<image|<foreignObject|<filter|<script|href="http/.test(svg), `${name} is vector-only and text-free`);
    assert.match(svg, /^<svg[^>]*><g fill="#FFFFFF" stroke="#FFFFFF" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">/);
    for (const hex of svg.match(/#[0-9A-Fa-f]{6}/g)) assert.ok(allowed.has(hex.toUpperCase()), `${name} uses ${hex}`);
    assert.ok(!/level|lv\.|rank|score|tier/i.test(svg));
  }
  // colours mirror the design tokens
  assert.equal(tokens['--sticker-outline'], '#FFFFFF');
  assert.equal(tokens['--sticker-gold'], '#F6C453');
  assert.equal(tokens['--sticker-lilac'], '#8B7CF0');
});

test('sprite sheet contains one symbol per doodad with the same drawing as the procedural fallback', () => {
  const sheet = doodadSpriteSheet();
  assert.ok(sheet.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && sheet.endsWith('</svg>\n'));
  for (const name of DOODAD_NAMES) {
    const sym = doodadSymbol(name);
    assert.ok(sheet.includes(sym));
    assert.ok(sym.startsWith(`<symbol id="${DOODAD_SYMBOL_PREFIX}${name}" viewBox="0 0 64 64">`));
    const inner = doodadSvg(name, 48).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    assert.ok(sym.includes(inner), `${name}: symbol and standalone share the markup`);
  }
  assert.equal((sheet.match(/<symbol /g) || []).length, DOODAD_NAMES.length);
  const built = join(ROOT, 'assets/scene/doodads.svg');
  if (existsSync(built)) assert.equal(readFileSync(built, 'utf8'), sheet, 'assets/scene/doodads.svg is stale; run node tools/assets/build-scene.js');
});
