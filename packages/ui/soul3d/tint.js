// packages/ui/soul3d/tint.js - per-vertex colours of the baseline Soul (D-27 docs/art/soul-baseline.md, D-29
// docs/art/soul-decorations.md "Colour"). The baseline GLB carries one RGBA mask per vertex in COLOR_0: R goo drips,
// G eye disc, B eye groove ring, A antenna orb. One mesh takes any Soul colour in exactly this order, in linear light:
//   1. body = the fill: a v1 palette `fill`, or (v2) the body gradient at the vertex height h above the floor:
//      t = clamp((top - h) / (top - bottom), 0, 1) over the catalog `gradientSpan`, mix(top, bottom, t) in sRGB, then
//      converted to linear
//   2. drips      mix toward highlight   by R
//   3. eye discs  mix toward #F7F8FF     by G
//   4. groove     mix toward outline     by B
//   5. orb        mix toward highlight   by A   (and the orb glows in `glow`: orbGlow() gives the per-vertex weight)
// The same maths runs in the Blender renders (baked per vertex) and, for the fill, in the 2D renderer's vertical
// linearGradient (SVG gradients interpolate in sRGB). Output is linear sRGB, which is what Three.js expects in a
// `color` attribute. Pure: no DOM, no Three.js, no reads of Platform / Role / rank (BR-17); equal inputs give
// byte-identical Float32Arrays. Shared by the phone and the public Galaxy (packages/ui/soul3d).
import { SOUL_CATALOG } from '../../game-rules/src/soul-catalog.js';

export const EYE_WHITE = '#F7F8FF';
/** Mask channel per feature, in COLOR_0 order. */
export const MASK = Object.freeze({ drip: 0, eye: 1, ring: 2, orb: 3 });
/** The mix order above as data (channel, target) so tests and docs share one source. */
export const TINT_ORDER = Object.freeze([
  Object.freeze({ channel: MASK.drip, target: 'highlight' }),
  Object.freeze({ channel: MASK.eye, target: 'eye' }),
  Object.freeze({ channel: MASK.ring, target: 'outline' }),
  Object.freeze({ channel: MASK.orb, target: 'highlight' }),
]);
/** Height range of the body gradient in model units above the floor (catalog data: top 1.9, bottom 0, sRGB mix). */
export const GRADIENT_SPAN = Object.freeze({ top: SOUL_CATALOG.gradientSpan.top, bottom: SOUL_CATALOG.gradientSpan.bottom });

/** sRGB transfer (IEC 61966-2-1), as Blender's hex_lin and Three.js ColorManagement. */
export function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function linearToSrgb(c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

function hexInt(hex) {
  if (typeof hex === 'number' && Number.isInteger(hex) && hex >= 0 && hex <= 0xffffff) return hex;
  if (typeof hex === 'string' && /^#?[0-9a-fA-F]{6}$/.test(hex)) return parseInt(hex.replace('#', ''), 16);
  throw new TypeError(`soul-tint: not a colour: ${String(hex)}`);
}
/** '#RRGGBB' / 'RRGGBB' / 0xRRGGBB -> [r, g, b] as sRGB-encoded 0..1. Throws on anything else (colours are fixed data). */
export function hexToSrgb(hex) { const n = hexInt(hex); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
/** '#RRGGBB' / 'RRGGBB' / 0xRRGGBB -> [r, g, b] in linear light. */
export function hexToLinear(hex) { return hexToSrgb(hex).map(srgbToLinear); }

/** Palette ({ fill, highlight, outline, glow } as hex strings or 0xRRGGBB) -> frozen linear triples incl. the eye white. */
export function tintPalette(palette) {
  if (!palette || typeof palette !== 'object') throw new TypeError('soul-tint: palette object required');
  const lin = (k) => Object.freeze(hexToLinear(palette[k]));
  return Object.freeze({ fill: lin('fill'), highlight: lin('highlight'), outline: lin('outline'), glow: lin('glow'), eye: Object.freeze(hexToLinear(EYE_WHITE)) });
}

/**
 * Gradient ({ top, bottom, highlight, outline, glow }, a soul-catalog GRADIENTS entry) -> frozen colours for the tint:
 * top / bottom stay sRGB-encoded (the fill is mixed in sRGB), the mask targets are linear.
 */
export function tintGradient(gradient) {
  if (!gradient || typeof gradient !== 'object') throw new TypeError('soul-tint: gradient object required');
  const lin = (k) => Object.freeze(hexToLinear(gradient[k]));
  return Object.freeze({
    top: Object.freeze(hexToSrgb(gradient.top)), bottom: Object.freeze(hexToSrgb(gradient.bottom)),
    highlight: lin('highlight'), outline: lin('outline'), glow: lin('glow'), eye: Object.freeze(hexToLinear(EYE_WHITE)),
  });
}

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0); // NaN -> 0

/** Gradient factor at height h above the floor: 0 at the span top (top colour), 1 at the bottom. */
export function gradientT(h, span = GRADIENT_SPAN) {
  const d = span.top - span.bottom;
  if (!(d > 0)) return 0;
  return clamp01((span.top - h) / d);
}
/** Body fill at height h as sRGB-encoded 0..1: mix(top, bottom, t) in sRGB. `g` from tintGradient(). */
export function gradientSrgbAt(h, g, span = GRADIENT_SPAN) {
  const t = gradientT(h, span);
  return [g.top[0] + (g.bottom[0] - g.top[0]) * t, g.top[1] + (g.bottom[1] - g.top[1]) * t, g.top[2] + (g.bottom[2] - g.top[2]) * t];
}
/** Body fill at height h in linear light (the sRGB mix, then converted). */
export function gradientLinearAt(h, g, span = GRADIENT_SPAN) { return gradientSrgbAt(h, g, span).map(srgbToLinear); }

function mixMasks(c0, c1, c2, m, pal) {
  for (const step of TINT_ORDER) {
    const t = m[step.channel];
    if (t === 0) continue;
    const to = pal[step.target];
    c0 += (to[0] - c0) * t; c1 += (to[1] - c1) * t; c2 += (to[2] - c2) * t;
  }
  return [c0, c1, c2];
}

/** Tint one vertex: mask channels in [0, 1] -> [r, g, b] linear. `pal` comes from tintPalette(). */
export function tintVertex(r, g, b, a, pal) {
  return mixMasks(pal.fill[0], pal.fill[1], pal.fill[2], [clamp01(r), clamp01(g), clamp01(b), clamp01(a)], pal);
}
/** Tint one vertex of a gradient Soul at height h above the floor. `gpal` comes from tintGradient(). */
export function tintGradientVertex(h, r, g, b, a, gpal, span = GRADIENT_SPAN) {
  const f = gradientLinearAt(h, gpal, span);
  return mixMasks(f[0], f[1], f[2], [clamp01(r), clamp01(g), clamp01(b), clamp01(a)], gpal);
}

/** Integer masks (the GLB's normalized uint8 COLOR_0) are read as value / 255; float masks are taken as 0..1. */
function maskScale(mask) { return mask instanceof Uint8Array || mask instanceof Uint8ClampedArray ? 1 / 255 : 1; }
function vertexCount(mask, itemSize) {
  if (!mask || typeof mask.length !== 'number') throw new TypeError('soul-tint: mask must be array-like');
  if (!(itemSize === 4 || itemSize === 3)) throw new RangeError('soul-tint: mask itemSize must be 4 (RGBA) or 3 (RGB, no orb)');
  if (mask.length % itemSize) throw new RangeError(`soul-tint: mask length ${mask.length} is not a multiple of ${itemSize}`);
  return mask.length / itemSize;
}

/**
 * Per-vertex colours for a whole mesh (v1 palette): Float32Array(count * 3), linear RGB, ready for a Three.js `color`
 * attribute. mask: COLOR_0 values (Uint8Array 0..255 or floats 0..1), `itemSize` 4 (RGBA; 3 means no orb channel).
 */
export function tintColors(mask, palette, { itemSize = 4 } = {}) {
  const n = vertexCount(mask, itemSize);
  const pal = tintPalette(palette);
  const k = maskScale(mask);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * itemSize;
    const c = tintVertex(mask[o] * k, mask[o + 1] * k, mask[o + 2] * k, itemSize === 4 ? mask[o + 3] * k : 0, pal);
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  return out;
}

/**
 * Per-vertex colours of a gradient Soul (v2): like tintColors, with the fill taken from `gradient` at each vertex's
 * height above the floor (`heights`, model units, one per vertex: soul3d/model.js extractSoulModel).
 */
export function tintGradientColors(mask, heights, gradient, { itemSize = 4, span = GRADIENT_SPAN } = {}) {
  const n = vertexCount(mask, itemSize);
  if (!heights || heights.length !== n) throw new RangeError(`soul-tint: need one height per vertex (${n}), got ${heights ? heights.length : 0}`);
  const gpal = tintGradient(gradient);
  const k = maskScale(mask);
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * itemSize;
    const c = tintGradientVertex(heights[i], mask[o] * k, mask[o + 1] * k, mask[o + 2] * k, itemSize === 4 ? mask[o + 3] * k : 0, gpal, span);
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  return out;
}

/** Per-vertex orb glow weight (mask A, clamped, times `strength`): Float32Array(count). The scene multiplies it by the glow colour. */
export function orbGlow(mask, { itemSize = 4, strength = 1 } = {}) {
  const n = vertexCount(mask, itemSize);
  const out = new Float32Array(n);
  if (itemSize !== 4) return out;
  const k = maskScale(mask);
  for (let i = 0; i < n; i++) out[i] = clamp01(mask[i * 4 + 3] * k) * strength;
  return out;
}
