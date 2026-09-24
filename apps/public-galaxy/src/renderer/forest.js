// Procedural enchanted-forest frame for the Three.js renderer (docs/art/game-experience-brief.md).
// `forestLayout()` is pure and deterministic (seeded PRNG from hash32) so it can be unit-tested in Node; it
// describes soft tree / foliage / bush silhouettes along the LEFT, TOP and BOTTOM edges of the Galaxy region
// only. The right edge (which abuts the information panel) is left clear. `paintForest()` rasterises a layout
// into an offscreen canvas (browser only, called once at load). No image assets are used.
import { hash32 } from '../../../../packages/ui/soul-renderer.js';

/** Depth layers, back to front. `parallax` is the fraction of the camera drift applied to the plane. */
export const FOREST_LAYERS = Object.freeze([
  { name: 'far', parallax: 0.25, color: [44, 26, 88], alpha: 0.62, softness: 0.55, scale: 0.82 },
  { name: 'mid', parallax: 0.5, color: [22, 11, 50], alpha: 0.84, softness: 0.42, scale: 1.0 },
  { name: 'near', parallax: 0.85, color: [7, 4, 20], alpha: 0.96, softness: 0.3, scale: 1.18 },
]);

/** Extent limits (fractions of the region) that keep the frame at the edges and out of the Soul field. */
export const FOREST_LIMITS = Object.freeze({ leftFraction: 0.26, topFraction: 0.17, bottomFraction: 0.15 });

/** Small deterministic PRNG (mulberry32) seeded from a string. */
export function seededRandom(seed) {
  let a = hash32(String(seed)) >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round1(v) { return Math.round(v * 10) / 10; }

/**
 * Deterministic silhouette layout for one depth layer.
 * @returns {{ layer, width, height, trees, canopy, vines, bushes, grass }} all coordinates in region pixels
 */
export function forestLayout(seed, width, height, layerIndex = 2) {
  const layer = FOREST_LAYERS[Math.max(0, Math.min(FOREST_LAYERS.length - 1, layerIndex))];
  const rnd = seededRandom(`${seed}:forest:${layer.name}`);
  const between = (lo, hi) => lo + (hi - lo) * rnd();
  const w = Math.max(1, width), h = Math.max(1, height);
  const s = layer.scale * (h / 1080);
  const out = { layer: layer.name, width: w, height: h, trees: [], canopy: [], vines: [], bushes: [], grass: [] };

  // Left edge trees: trunks rooted below the bottom edge, canopy blobs clustered around the trunk top.
  const treeCount = 2 + layerIndex;
  const leftLimit = w * FOREST_LIMITS.leftFraction;
  for (let i = 0; i < treeCount; i++) {
    const x = round1(between(-0.03 * w, leftLimit * 0.55));
    const trunkW = round1(between(10, 24) * s);
    const top = round1(between(0.28, 0.58) * h);
    const canopy = [];
    const blobs = 6 + Math.floor(rnd() * 6);
    for (let b = 0; b < blobs; b++) {
      const r = round1(between(38, 96) * s);
      const cx = Math.min(leftLimit - r * 0.4, x + between(-1.3, 1.3) * r * 1.4);
      canopy.push({ cx: round1(cx), cy: round1(top + between(-0.9, 0.9) * r), r });
    }
    const branches = [];
    for (let k = 0; k < 2 + Math.floor(rnd() * 2); k++) {
      const y1 = top + between(40, 220) * s;
      const len = between(50, 150) * s;
      branches.push({ x1: x, y1: round1(y1), x2: round1(Math.min(leftLimit, x + len)), y2: round1(y1 - between(10, 70) * s), w: round1(Math.max(2, trunkW * between(0.18, 0.4))) });
    }
    out.trees.push({ x, trunkW, top, baseY: round1(h + 12), canopy, branches });
  }

  // Hanging canopy across the top edge; density falls off towards the right so the field stays open.
  const topLimit = h * FOREST_LIMITS.topFraction;
  for (let x = -40; x < w * 0.82; x += between(52, 108) * s) {
    const rightness = x / w;
    if (rightness > 0.42 && rnd() < 0.35 + rightness * 0.6) continue;
    const r = round1(between(44, 118) * s);
    const cy = Math.min(topLimit - r * 0.5, between(-0.7, 0.35) * r);
    out.canopy.push({ cx: round1(x), cy: round1(cy), r });
    if (layerIndex === 2 && rnd() < 0.35) out.vines.push({ x: round1(x + between(-20, 20)), y1: round1(Math.max(0, cy)), y2: round1(Math.min(topLimit, cy + between(60, 170) * s)), w: round1(between(1.5, 3.5) * s) });
  }

  // Bushes along the bottom edge (full width of the region) and grass blades for the near layer.
  const bottomLimit = h * (1 - FOREST_LIMITS.bottomFraction);
  for (let x = -40; x < w + 40; x += between(64, 128) * s) {
    const rx = round1(between(66, 150) * s), ry = round1(between(38, 82) * s);
    const cy = Math.max(bottomLimit + ry * 0.55, h - between(0.02, 0.07) * h);
    out.bushes.push({ cx: round1(x), cy: round1(cy), rx, ry });
  }
  const blades = layerIndex === 2 ? 110 : layerIndex === 1 ? 40 : 0;
  for (let i = 0; i < blades; i++) {
    const bh = between(22, 78) * s;
    out.grass.push({ x: round1(between(-10, w + 10)), h: round1(bh), lean: round1(between(-16, 16) * s), w: round1(between(2.5, 6) * s) });
  }
  return out;
}

/** Bounding checks used by tests and by the renderer's self-check: every shape stays on the framed edges. */
export function forestWithinLimits(layout) {
  const { width: w, height: h } = layout;
  const left = w * FOREST_LIMITS.leftFraction, top = h * FOREST_LIMITS.topFraction, bottom = h * (1 - FOREST_LIMITS.bottomFraction);
  for (const t of layout.trees) {
    if (t.x + t.trunkW > left) return false;
    for (const c of t.canopy) if (c.cx + c.r * 0.6 > left) return false;
    for (const b of t.branches) if (Math.max(b.x1, b.x2) > left) return false;
  }
  for (const c of layout.canopy) if (c.cy + c.r * 0.5 > top) return false;
  for (const v of layout.vines) if (v.y2 > top) return false;
  for (const b of layout.bushes) if (b.cy - b.ry * 0.55 < bottom) return false;
  return true;
}

/**
 * Paints a layout into a canvas (transparent background). Foliage uses radial gradients so silhouettes have
 * soft, leafy edges without canvas filters. Returns the canvas.
 */
export function paintForest(canvas, layout, layerIndex = 2) {
  const layer = FOREST_LAYERS[Math.max(0, Math.min(FOREST_LAYERS.length - 1, layerIndex))];
  const [r, g, b] = layer.color;
  const solid = `rgba(${r},${g},${b},1)`;
  const clear = `rgba(${r},${g},${b},0)`;
  const ctx = canvas.getContext('2d');
  const sx = canvas.width / layout.width, sy = canvas.height / layout.height;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);
  const blob = (cx, cy, rad, softness = layer.softness) => {
    const grad = ctx.createRadialGradient(cx, cy, rad * (1 - softness) * 0.5, cx, cy, rad);
    grad.addColorStop(0, solid); grad.addColorStop(1 - softness * 0.6, solid); grad.addColorStop(1, clear);
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
  };
  ctx.lineCap = 'round';
  for (const t of layout.trees) {
    ctx.fillStyle = solid;
    ctx.beginPath(); ctx.moveTo(t.x - t.trunkW * 0.9, t.baseY); ctx.lineTo(t.x + t.trunkW * 0.9, t.baseY); ctx.lineTo(t.x + t.trunkW * 0.35, t.top); ctx.lineTo(t.x - t.trunkW * 0.35, t.top); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = solid;
    for (const br of t.branches) { ctx.lineWidth = br.w; ctx.beginPath(); ctx.moveTo(br.x1, br.y1); ctx.quadraticCurveTo((br.x1 + br.x2) / 2, br.y1 - 10, br.x2, br.y2); ctx.stroke(); }
    for (const c of t.canopy) blob(c.cx, c.cy, c.r);
  }
  for (const c of layout.canopy) blob(c.cx, c.cy, c.r);
  ctx.strokeStyle = solid;
  for (const v of layout.vines) { ctx.lineWidth = v.w; ctx.beginPath(); ctx.moveTo(v.x, v.y1); ctx.quadraticCurveTo(v.x + 6, (v.y1 + v.y2) / 2, v.x, v.y2); ctx.stroke(); ctx.beginPath(); ctx.arc(v.x, v.y2, v.w * 1.6, 0, Math.PI * 2); ctx.fillStyle = solid; ctx.fill(); }
  for (const bsh of layout.bushes) {
    ctx.save(); ctx.translate(bsh.cx, bsh.cy); ctx.scale(bsh.rx / bsh.ry, 1); blob(0, 0, bsh.ry, layer.softness * 0.8); ctx.restore();
  }
  ctx.fillStyle = solid;
  for (const gr of layout.grass) {
    ctx.beginPath(); ctx.moveTo(gr.x - gr.w / 2, layout.height + 2); ctx.quadraticCurveTo(gr.x + gr.lean * 0.4, layout.height - gr.h * 0.55, gr.x + gr.lean, layout.height - gr.h); ctx.lineTo(gr.x + gr.w / 2, layout.height + 2); ctx.closePath(); ctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}
