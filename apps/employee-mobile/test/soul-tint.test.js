// node --test apps/employee-mobile/test - baseline Soul vertex tint (D-27, docs/art/soul-baseline.md). Pure: no DOM, no Three.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EYE_WHITE, MASK, TINT_ORDER, srgbToLinear, linearToSrgb, hexToLinear, tintPalette, tintVertex, tintColors, orbGlow } from '../src/scene/soul-tint.js';
import { PALETTES } from '../../../packages/ui/soul-renderer.js';

const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** COLOR_0 of the shipped hero GLB as the raw uint8 RGBA mask (GLB container: header, JSON chunk, BIN chunk). */
function heroMask() {
  const buf = readFileSync(fileURLToPath(new URL('../../../assets/souls/baseline/soul-baseline-hero.glb', import.meta.url)));
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(20 + jsonLen + 8);
  const acc = json.accessors[json.meshes[0].primitives[0].attributes.COLOR_0];
  const view = json.bufferViews[acc.bufferView];
  assert.equal(acc.type, 'VEC4'); assert.equal(acc.componentType, 5121); assert.equal(acc.normalized, true);
  const stride = view.byteStride || 4, base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Uint8Array(acc.count * 4);
  for (let i = 0; i < acc.count; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = bin[base + i * stride + c];
  return out;
}

test('mix order is the spec order: fill, drips -> highlight (R), eyes -> #F7F8FF (G), ring -> outline (B), orb -> highlight (A)', () => {
  assert.equal(EYE_WHITE, '#F7F8FF');
  assert.deepEqual(MASK, { drip: 0, eye: 1, ring: 2, orb: 3 });
  assert.deepEqual(TINT_ORDER.map((s) => [s.channel, s.target]), [[0, 'highlight'], [1, 'eye'], [2, 'outline'], [3, 'highlight']]);
});

test('all 8 palettes: a pure mask channel lands exactly on its target colour, an empty mask is the fill', () => {
  assert.equal(PALETTES.length, 8);
  for (const p of PALETTES) {
    const pal = tintPalette(p);
    const L = (hex) => hexToLinear(hex);
    assert.ok(near(tintVertex(0, 0, 0, 0, pal), L(p.fill)), `${p.name} body = fill`);
    assert.ok(near(tintVertex(1, 0, 0, 0, pal), L(p.highlight)), `${p.name} drips = highlight`);
    assert.ok(near(tintVertex(0, 1, 0, 0, pal), L(EYE_WHITE)), `${p.name} eye discs = #F7F8FF`);
    assert.ok(near(tintVertex(0, 0, 1, 0, pal), L(p.outline)), `${p.name} groove ring = outline`);
    assert.ok(near(tintVertex(0, 0, 0, 1, pal), L(p.highlight)), `${p.name} orb = highlight`);
    assert.ok(near(pal.glow, L(p.glow)), `${p.name} glow kept for the orb light`);
  }
});

test('channels apply in order (a later channel wins) and partial masks mix in linear light, not in sRGB', () => {
  const p = PALETTES.find((x) => x.name === 'lagoon');
  const pal = tintPalette(p);
  const L = (hex) => hexToLinear(hex);
  assert.ok(near(tintVertex(1, 1, 0, 0, pal), L(EYE_WHITE)), 'eye disc over a drip');
  assert.ok(near(tintVertex(0, 1, 1, 0, pal), L(p.outline)), 'groove ring over the eye disc');
  assert.ok(near(tintVertex(1, 0, 1, 0, pal), L(p.outline)), 'groove ring over a drip');
  assert.ok(near(tintVertex(0, 0, 1, 1, pal), L(p.highlight)), 'orb last');
  assert.ok(near(tintVertex(1, 1, 1, 1, pal), L(p.highlight)));
  const half = tintVertex(0.5, 0, 0, 0, pal);
  assert.ok(near(half, lerp3(L(p.fill), L(p.highlight), 0.5)), 'R = 0.5 is the linear midpoint');
  const srgbMid = [0, 1, 2].map((i) => srgbToLinear((parseInt(p.fill.slice(1 + i * 2, 3 + i * 2), 16) + parseInt(p.highlight.slice(1 + i * 2, 3 + i * 2), 16)) / 510));
  assert.ok(!near(half, srgbMid, 1e-3), 'differs from an sRGB-space mix');
  // chained partials follow the formula step by step
  const [r, g, b, a] = [0.3, 0.6, 0.25, 0.5];
  let c = L(p.fill); c = lerp3(c, L(p.highlight), r); c = lerp3(c, L(EYE_WHITE), g); c = lerp3(c, L(p.outline), b); c = lerp3(c, L(p.highlight), a);
  assert.ok(near(tintVertex(r, g, b, a, pal), c));
});

test('tintColors is deterministic, byte-identical for equal inputs, and differs between palettes', () => {
  const mask = new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0.2, 0.7, 0.1, 0, 0, 0, 0.9, 0.5]);
  const a = tintColors(mask, PALETTES[1]), b = tintColors(Float32Array.from(mask), { ...PALETTES[1] });
  assert.ok(a instanceof Float32Array); assert.equal(a.length, 12);
  assert.deepEqual(Buffer.from(a.buffer), Buffer.from(b.buffer));
  const seen = new Set(PALETTES.map((p) => Buffer.from(tintColors(mask, p).buffer).toString('hex')));
  assert.equal(seen.size, 8, 'every palette gives its own colours');
  // integer palette values (0xRRGGBB) behave like hex strings
  const asInts = { fill: parseInt(PALETTES[1].fill.slice(1), 16), highlight: parseInt(PALETTES[1].highlight.slice(1), 16), outline: parseInt(PALETTES[1].outline.slice(1), 16), glow: parseInt(PALETTES[1].glow.slice(1), 16) };
  assert.deepEqual(Buffer.from(tintColors(mask, asInts).buffer), Buffer.from(a.buffer));
});

test('uint8 masks (the GLB COLOR_0) read as value / 255 and match the float path; values are clamped; bad input is rejected', () => {
  const u8 = new Uint8Array([255, 0, 0, 0, 0, 255, 0, 0, 128, 0, 0, 128]);
  const f = Float32Array.from(u8, (v) => v / 255);
  assert.deepEqual(Buffer.from(tintColors(u8, PALETTES[3]).buffer), Buffer.from(tintColors(f, PALETTES[3]).buffer));
  const pal = tintPalette(PALETTES[3]);
  assert.ok(near(tintVertex(2, -1, NaN, 0, pal), tintVertex(1, 0, 0, 0, pal)), 'clamped to [0, 1], NaN -> 0');
  assert.throws(() => tintColors(new Float32Array(5), PALETTES[0]), RangeError);
  assert.throws(() => tintColors(new Float32Array(8), PALETTES[0], { itemSize: 2 }), RangeError);
  assert.throws(() => tintColors(null, PALETTES[0]), TypeError);
  assert.throws(() => tintPalette({ fill: 'blue', highlight: '#fff', outline: '#000', glow: '#000' }), TypeError);
  assert.throws(() => tintPalette(null), TypeError);
  // RGB masks (no orb channel) are accepted
  assert.equal(tintColors(new Float32Array([1, 0, 0]), PALETTES[0], { itemSize: 3 }).length, 3);
});

test('orbGlow is mask A (clamped) times strength; RGB masks have no orb', () => {
  assert.deepEqual([...orbGlow(new Uint8Array([0, 0, 0, 255, 9, 9, 9, 0, 0, 0, 0, 128]))], [1, 0, 128 / 255].map((v) => Math.fround(v)));
  assert.deepEqual([...orbGlow(new Float32Array([0, 0, 0, 0.5]), { strength: 2 })], [1]);
  assert.deepEqual([...orbGlow(new Float32Array([0, 0, 0, 3]))], [1]);
  assert.deepEqual([...orbGlow(new Float32Array([1, 1, 1]), { itemSize: 3 })], [0]);
});

test('the shipped hero mask tints cleanly for every palette (finite, in range, exact targets on pure vertices)', () => {
  const mask = heroMask();
  const n = mask.length / 4;
  assert.equal(n, 12002);
  let eyes = 0, drips = 0, plain = 0;
  for (const p of PALETTES) {
    const col = tintColors(mask, p);
    assert.equal(col.length, n * 3);
    assert.ok(col.every((v) => Number.isFinite(v) && v >= 0 && v <= 1), `${p.name} in [0, 1]`);
    const L = (hex) => hexToLinear(hex).map((v) => Math.fround(v));
    const at = (i) => [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]];
    eyes = drips = plain = 0;
    for (let i = 0; i < n; i++) {
      const [r, g, b, a] = [mask[i * 4], mask[i * 4 + 1], mask[i * 4 + 2], mask[i * 4 + 3]];
      if (g === 255 && b === 0 && a === 0) { eyes++; assert.ok(near(at(i), L(EYE_WHITE), 1e-6), `${p.name} eye vertex ${i}`); }
      else if (r === 255 && g === 0 && b === 0 && a === 0) { drips++; assert.ok(near(at(i), L(p.highlight), 1e-6)); }
      else if (r === 0 && g === 0 && b === 0 && a === 0) { plain++; assert.ok(near(at(i), L(p.fill), 1e-6)); }
    }
  }
  assert.ok(eyes > 100 && drips > 1000 && plain > 5000, `eyes ${eyes}, drips ${drips}, plain ${plain}`);
  const glow = orbGlow(mask);
  const lit = [...glow].filter((v) => v > 0).length;
  assert.ok(lit > 500 && lit < 1500, `orb vertices ${lit}`);
});

test('sRGB transfer round-trips and hexToLinear accepts #RRGGBB, RRGGBB and 0xRRGGBB', () => {
  for (let v = 0; v <= 1.0001; v += 0.05) assert.ok(Math.abs(linearToSrgb(srgbToLinear(v)) - v) < 1e-9);
  assert.deepEqual(hexToLinear('#FFFFFF'), [1, 1, 1]);
  assert.deepEqual(hexToLinear('000000'), [0, 0, 0]);
  assert.deepEqual(hexToLinear(0x7cc8ff), hexToLinear('#7CC8FF'));
  assert.throws(() => hexToLinear('#12345'), TypeError);
  assert.throws(() => hexToLinear(0x1000000), TypeError);
});
