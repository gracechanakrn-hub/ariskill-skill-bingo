// The big screen's cinematic space backdrop (stage 15, D-36): Blender renders in /assets/space/ described by
// space.json - a backdrop plate, the constellation lines (the stars on them are drawn here, so each can twinkle), a few
// meteors at the corners and edges, and now and then a falling star - replacing the nebula / aurora shader, the forest
// silhouettes, the fireflies and the doodad stickers. Pure ESM, Node-testable: schema, loader and the micro movement.
// Every motion is slow and calm: the fastest repeats in no less than a second (well under the 3 Hz motion rule), a
// falling star is one fade in and out, never a flash. Reduced motion: every layer at rest and no falling stars; the
// 'low' quality level: no falling stars and no meteor spin. No space.json (or an unusable one): a plain dark sky.
// Coordinates: x, y and area are fractions of the Galaxy region; star radii and drift px are at 1080 rows.

export const SPACE_BASE = '/assets/space';
export const SPACE_VERSION = 1;
/** Slowest-allowed periods and the like, so no data file can make the sky busy (motion rule: nothing near 3 Hz). */
export const SPACE_LIMITS = Object.freeze({ minPeriodS: 1, maxSpinDegPerS: 12, maxBreathe: 0.03, maxDriftPx: 40, maxAlpha: 0.95, maxHz: 3 });
/** Falling-star fades as fractions of its flight. */
export const FALLING_STAR_FADE = Object.freeze({ in: 0.15, out: 0.35 });

const TAU = Math.PI * 2;
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const period = (v, d) => Math.max(SPACE_LIMITS.minPeriodS, num(v, d));
const file = (v) => (typeof v === 'string' && /^[A-Za-z0-9._-]+\.(png|jpg|jpeg|webp)$/i.test(v) ? v : null);
const range = (v, d, lo = -Infinity, hi = Infinity) => {
  const a = Array.isArray(v) && v.length === 2 ? [num(v[0], d[0]), num(v[1], d[1])] : d.slice();
  const out = [clamp(Math.min(a[0], a[1]), lo, hi), clamp(Math.max(a[0], a[1]), lo, hi)];
  return Object.freeze(out);
};
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };

/**
 * space.json -> the frozen spec the renderers draw, every field defaulted and clamped (periods at least SPACE_LIMITS
 * .minPeriodS, spin and breathing bounded, falling stars spaced so two never overlap). Null for anything that is not
 * a version 1 space file: the Galaxy then draws a plain dark sky.
 */
export function normalizeSpace(json) {
  if (!json || typeof json !== 'object' || num(json.version, 0) !== SPACE_VERSION) return null;
  const region = { width: Math.max(1, num(json.region && json.region.width, 1248)), height: Math.max(1, num(json.region && json.region.height, 1080)) };
  const b = json.backdrop || {};
  const backdrop = {
    file: file(b.file),
    drift: { px: clamp(num(b.drift && b.drift.px, 12), 0, SPACE_LIMITS.maxDriftPx), periodS: period(b.drift && b.drift.periodS, 80) },
    breathe: { amount: clamp(num(b.breathe && b.breathe.amount, 0.012), 0, SPACE_LIMITS.maxBreathe), periodS: period(b.breathe && b.breathe.periodS, 50) },
    parallax: clamp(num(b.parallax, 0.35), 0, 2),
  };
  const c = json.constellations || {};
  const constellations = {
    file: file(c.file),
    lineShimmer: { amount: clamp01(num(c.lineShimmer && c.lineShimmer.amount, 0.25)), periodS: period(c.lineShimmer && c.lineShimmer.periodS, 9) },
    stars: (Array.isArray(c.stars) ? c.stars : []).filter((s) => s && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y)))
      .map((s) => ({ x: num(s.x, 0), y: num(s.y, 0), r: clamp(num(s.r, 2), 0.5, 12), b: clamp01(num(s.b, 0.8)), t: num(s.t, 0) - Math.floor(num(s.t, 0)) })),
    twinkle: { amount: clamp01(num(c.twinkle && c.twinkle.amount, 0.35)), periodS: period(c.twinkle && c.twinkle.periodS, 5.5) },
    parallax: clamp(num(c.parallax, 0.5), 0, 2),
  };
  const meteors = (Array.isArray(json.meteors) ? json.meteors : []).filter((m) => m && file(m.file)).map((m) => ({
    file: file(m.file), x: num(m.x, 0), y: num(m.y, 0), size: clamp(num(m.size, 0.2), 0.01, 1.5),
    rotDeg: num(m.rotDeg, 0), spinDegPerS: clamp(num(m.spinDegPerS, 0), -SPACE_LIMITS.maxSpinDegPerS, SPACE_LIMITS.maxSpinDegPerS),
    drift: { x: clamp(num(m.drift && m.drift.x, 0), -0.1, 0.1), y: clamp(num(m.drift && m.drift.y, 0), -0.1, 0.1), periodS: period(m.drift && m.drift.periodS, 26) },
    front: m.front === true, parallax: clamp(num(m.parallax, 1), 0, 3),
  }));
  const f = json.fallingStars;
  let fallingStars = null;
  if (f && typeof f === 'object' && file(f.file)) {
    const durationS = range(f.durationS, [0.9, 1.5], 0.3, 4);
    // one at a time: the gap is never shorter than the longest flight plus a breath
    const everyS = range(f.everyS, [6, 12], durationS[1] + 0.5, 600);
    fallingStars = {
      file: file(f.file), everyS, durationS, angleDeg: range(f.angleDeg, [15, 32], -80, 80), lengthFrac: range(f.lengthFrac, [0.18, 0.32], 0.02, 1),
      area: (() => { const a = Array.isArray(f.area) && f.area.length === 4 ? f.area.map((v, i) => num(v, [0.05, 0.03, 0.95, 0.5][i])) : [0.05, 0.03, 0.95, 0.5]; return [Math.min(a[0], a[2]), Math.min(a[1], a[3]), Math.max(a[0], a[2]), Math.max(a[1], a[3])]; })(),
      maxAlpha: clamp(num(f.maxAlpha, 0.9), 0, SPACE_LIMITS.maxAlpha),
    };
  }
  return deepFreeze({ version: SPACE_VERSION, region, overscan: clamp(num(json.overscan, 1.1), 1, 1.5), backdrop, constellations, meteors, fallingStars });
}

/** The files a spec draws, as URLs under `base` (backdrop, constellation lines, each meteor, the falling star). */
export function spaceFiles(spec, base = SPACE_BASE) {
  const url = (f) => (f ? `${base}/${f}` : null);
  return { backdrop: url(spec.backdrop.file), constellations: url(spec.constellations.file), meteors: spec.meteors.map((m) => url(m.file)), fallingStar: url(spec.fallingStars && spec.fallingStars.file) };
}

/**
 * Loads space.json and its images: { spec, images: { backdrop, constellations, meteors: [...], fallingStar } } (an
 * image that fails is null: that layer is left out), or null when there is no usable space.json (a plain dark sky).
 * Never rejects. `fetchImpl` / `loadImage` are injectable (tests; the browser's fetch and an Image loader by default).
 */
export async function loadSpace({ base = SPACE_BASE, fetchImpl = (u) => fetch(u), loadImage = null } = {}) {
  let spec = null;
  try { const res = await fetchImpl(`${base}/space.json`); if (res && res.ok !== false) spec = normalizeSpace(await res.json()); } catch { spec = null; }
  if (!spec) return null;
  const load = loadImage || browserImage;
  const img = (u) => (u ? Promise.resolve().then(() => load(u)).catch(() => null) : Promise.resolve(null));
  const f = spaceFiles(spec, base);
  const [backdrop, constellations, fallingStar, ...meteors] = await Promise.all([img(f.backdrop), img(f.constellations), img(f.fallingStar), ...f.meteors.map(img)]);
  return { spec, images: { backdrop, constellations, meteors, fallingStar } };
}
function browserImage(url) {
  return new Promise((resolve, reject) => { const im = new Image(); im.decoding = 'async'; im.onload = () => resolve(im); im.onerror = () => reject(new Error(`space image failed: ${url}`)); im.src = url; });
}

// ---- micro movement (pure; t in seconds, W x H the Galaxy region in px) -------------------------------------------------

/**
 * A plate covering the region times the overscan, centred: { x, y (centre, px), w, h } for an image of `aspect`
 * (width / height; the region's by default), cover-fitted like CSS background-size: cover.
 */
export function plateSize(spec, W, H, aspect = W / H) {
  const ov = spec ? spec.overscan : 1.1;
  const w0 = W * ov, h0 = H * ov;
  const s = Math.max(w0 / (aspect || 1), h0);
  return { w: s * (aspect || 1), h: s };
}

/**
 * The backdrop at t: { x, y (centre, px), w, h, scale } - a slow Lissajous drift of ±drift.px (at 1080 rows) over
 * drift.periodS, a scale breathing of ±breathe.amount over breathe.periodS and the camera parallax, always covering
 * the region. Reduced motion: centred, still.
 */
export function backdropPlacement(spec, W, H, tSec, { camera = null, reducedMotion = false, aspect } = {}) {
  const base = plateSize(spec, W, H, aspect);
  if (!spec || reducedMotion) return { x: W / 2, y: H / 2, w: base.w, h: base.h, scale: 1 };
  const b = spec.backdrop, k = H / 1080, t = Number(tSec) || 0;
  const scale = 1 + b.breathe.amount * Math.sin(TAU * t / b.breathe.periodS);
  let dx = b.drift.px * k * Math.sin(TAU * t / b.drift.periodS);
  let dy = b.drift.px * k * 0.6 * Math.sin(TAU * t / (b.drift.periodS * 1.37) + 1.1);
  if (camera) { dx += (camera.dx || 0) * b.parallax; dy += (camera.dy || 0) * b.parallax; }
  const w = base.w * scale, h = base.h * scale;
  // never uncover an edge of the region
  const mx = Math.max(0, (w - W) / 2), my = Math.max(0, (h - H) / 2);
  return { x: W / 2 + clamp(dx, -mx, mx), y: H / 2 + clamp(dy, -my, my), w, h, scale };
}

/**
 * The constellation plate at t: { x, y, w, h, alpha } - the lines' plate (region times overscan, centred) with the
 * camera parallax, the lines shimmering between 1 - amount and 1 of their alpha. Reduced motion: still, alpha 1.
 */
export function constellationPlacement(spec, W, H, tSec, { camera = null, reducedMotion = false, aspect } = {}) {
  const base = plateSize(spec, W, H, aspect);
  if (!spec || reducedMotion) return { x: W / 2, y: H / 2, w: base.w, h: base.h, alpha: 1 };
  const c = spec.constellations, t = Number(tSec) || 0;
  const alpha = 1 - c.lineShimmer.amount * (0.5 - 0.5 * Math.cos(TAU * t / c.lineShimmer.periodS));
  const dx = camera ? (camera.dx || 0) * c.parallax : 0, dy = camera ? (camera.dy || 0) * c.parallax : 0;
  return { x: W / 2 + dx, y: H / 2 + dy, w: base.w, h: base.h, alpha };
}

/** A star's own twinkle period: the spec's, stretched 0.8 .. 1.2 x by its phase (so neighbours drift apart). */
export function starPeriod(spec, star) { return spec.constellations.twinkle.periodS * (0.8 + 0.4 * ((star.t * 7.31) % 1)); }

/**
 * The constellation stars at t on a constellation `plate` (constellationPlacement): [{ x, y, r (px), a (0..1) }].
 * A star's x, y are region fractions, mapped through the plate so stars and lines stay together at any aspect; its
 * brightness b twinkles down by up to twinkle.amount with its own phase t and period. Reduced motion: a = b.
 */
export function constellationStars(spec, plate, H, tSec, { reducedMotion = false } = {}) {
  if (!spec) return [];
  const c = spec.constellations, ov = spec.overscan, k = H / 1080, t = Number(tSec) || 0;
  return c.stars.map((s) => {
    const x = plate.x + ((s.x - 0.5) / ov) * plate.w, y = plate.y + ((s.y - 0.5) / ov) * plate.h;
    const a = reducedMotion ? s.b : s.b * (1 - c.twinkle.amount * (0.5 - 0.5 * Math.cos(TAU * (t / starPeriod(spec, s) + s.t))));
    return { x, y, r: s.r * k, a };
  });
}

/**
 * A meteor at t: { x, y (centre, px), size (px, the sprite height), rotDeg, front } - its spot plus a slow drift loop
 * (an ellipse of ±drift.x, ±drift.y region fractions over drift.periodS) and the camera parallax, turning at
 * spinDegPerS. Reduced motion: at its spot, unturned. 'low' quality: no spin.
 */
export function meteorPose(m, W, H, tSec, { camera = null, reducedMotion = false, quality = 'high' } = {}) {
  const t = Number(tSec) || 0;
  let x = m.x * W, y = m.y * H;
  if (!reducedMotion) {
    const a = TAU * t / m.drift.periodS;
    x += m.drift.x * W * Math.sin(a); y += m.drift.y * H * (Math.cos(a) - 1) * 0.5;
    if (camera) { x += (camera.dx || 0) * m.parallax; y += (camera.dy || 0) * m.parallax; }
  }
  const spin = reducedMotion || quality === 'low' ? 0 : m.spinDegPerS * t;
  return { x, y, size: m.size * H, rotDeg: m.rotDeg + spin, front: m.front };
}

/** Deterministic 0..1 from a seed and a label (FNV-1a + avalanche), for the falling-star schedule. */
function unit(seed, label) {
  let h = 0x811c9dc5;
  const s = `${seed}:${label}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const pick = (r, u) => r[0] + (r[1] - r[0]) * u;

const schedules = new WeakMap();   // falling-star spec -> Map(seed -> ascending start times), grown as time passes
/** The seed's start times, grown until it has index `k` and a start later than `until`. */
function starts(fs, seed, { k = 0, until = -Infinity } = {}) {
  let bySeed = schedules.get(fs);
  if (!bySeed) { bySeed = new Map(); schedules.set(fs, bySeed); }
  let arr = bySeed.get(seed);
  if (!arr) { arr = []; bySeed.set(seed, arr); }
  while (arr.length <= k || arr[arr.length - 1] <= until) arr.push((arr.length ? arr[arr.length - 1] : 0) + pick(fs.everyS, unit(seed, `gap:${arr.length}`)));
  return arr;
}

/**
 * The k-th falling star of a seed's schedule: { k, start, durationS, angleDeg, lengthFrac, from: [x, y] (region
 * fractions, the head at the start) }. Stars follow each other every everyS (seeded), never overlapping; the first
 * comes one gap after t = 0, so the sky starts calm. Start times are cached per spec and seed (a frame costs a lookup).
 */
export function fallingStarEvent(fs, seed, k) {
  return {
    k, start: starts(fs, seed, { k })[k], durationS: pick(fs.durationS, unit(seed, `dur:${k}`)), angleDeg: pick(fs.angleDeg, unit(seed, `ang:${k}`)),
    lengthFrac: pick(fs.lengthFrac, unit(seed, `len:${k}`)),
    from: [pick([fs.area[0], fs.area[2]], unit(seed, `x:${k}`)), pick([fs.area[1], fs.area[3]], unit(seed, `y:${k}`))],
  };
}

/** Alpha of a falling star at flight progress p (0..1): fades in over the first 15 %, out over the last 35 %. */
export function fallingStarAlpha(p, maxAlpha) {
  if (!(p > 0) || p >= 1) return 0;
  const s = (v) => { const x = clamp01(v); return x * x * (3 - 2 * x); };
  return maxAlpha * s(p / FALLING_STAR_FADE.in) * (1 - s((p - (1 - FALLING_STAR_FADE.out)) / FALLING_STAR_FADE.out));
}

/**
 * The falling star in the sky at t, if any: { x, y (the head, px), angleDeg (the streak's rotation: its head points
 * along it, screen y down), length (px), alpha, p (0..1) }. The head moves 1.2 streak lengths along the angle over
 * the flight. Null between stars, under reduced motion and on the 'low' quality level.
 */
export function fallingStarAt(spec, W, H, tSec, { seed = 'space', reducedMotion = false, quality = 'high' } = {}) {
  const fs = spec && spec.fallingStars;
  if (!fs || reducedMotion || quality === 'low') return null;
  const t = Number(tSec) || 0;
  // the last star that started by t (binary search in the cached, ascending start times)
  const arr = starts(fs, seed, { until: t });
  let lo = 0, hi = arr.length - 1;
  if (!(arr[0] <= t)) return null;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (arr[mid] <= t) lo = mid; else hi = mid - 1; }
  const ev = fallingStarEvent(fs, seed, lo);
  const p = (t - ev.start) / ev.durationS;
  if (p >= 1) return null;
  const length = ev.lengthFrac * W, travel = 1.2 * length * p, a = (ev.angleDeg * Math.PI) / 180;
  return { x: ev.from[0] * W + Math.cos(a) * travel, y: ev.from[1] * H + Math.sin(a) * travel, angleDeg: ev.angleDeg, length, alpha: fallingStarAlpha(p, fs.maxAlpha), p, k: ev.k };
}
