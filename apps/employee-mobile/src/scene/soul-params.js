// apps/employee-mobile/src/scene/soul-params.js - pure, deterministic derivation of the 3D Soul parameters from a
// SoulConfig (packages/ui/soul-renderer.js traits + PALETTES). No DOM, no Three.js: node-testable.
// BR-17: every Soul has the same size and brightness; nothing here reads Platform, Role, rank or winner state.
//
// Since D-27 the phone scenes draw the baseline Soul character (see "Baseline Soul" at the end: baselineParams,
// BASELINE, reveal / peel timing); since D-29 decorated (v2) configs bring a body gradient, a face kit and charms, and
// since D-31 v3 configs a face plate, eyes and an antenna charm on the v3 body, drawn by packages/ui/soul3d. The lathe
// profiles, speckles, antenna layouts and face crop above it are the
// LEGACY procedural Soul: no longer drawn by the app, kept (with their tests) because tools/ai/blender/soul_turnaround.py
// ports them and tools/ai/test/blender-port.test.js checks that port to 1e-6.
import { PALETTES, TRAITS, resolveSoul } from '../../../../packages/ui/soul-renderer.js';
import { SOUL_VIEW, outlineWidth as viewOutlineWidth } from '../../../../packages/ui/soul3d/studio.js';

/** SVG units (viewBox 200, body between y 52 and 170) -> scene units. Same for every Soul (BR-17). */
export const UNIT = 0.0135;
export const HEM_Y = 170;            // SVG hem line (bottom of the body)
export const HEAD_CENTER_Y = 84;     // SVG head bulb centre
export const SOUL_HEIGHT = (HEM_Y - 52) * UNIT; // ~1.59 units for a drop

/**
 * Radial lathe profiles per body silhouette: [radius (fraction of 100 SVG units), svgY] from the top down.
 * Derived from BODY_PATHS (head bulb r~32 centred at y 84, hem at 170, x within 48..152).
 */
export const BODY_PROFILES = Object.freeze({
  drop:   [[0, 52], [0.20, 60], [0.28, 70], [0.31, 84], [0.32, 100], [0.36, 120], [0.42, 146], [0.40, 160], [0.28, 168], [0, 170]],
  bell:   [[0, 54], [0.20, 62], [0.30, 88], [0.30, 120], [0.34, 134], [0.42, 150], [0.54, 166], [0.50, 170], [0, 171]],
  cloud:  [[0, 52], [0.22, 60], [0.32, 84], [0.36, 98], [0.50, 112], [0.46, 130], [0.52, 150], [0.40, 168], [0, 172]],
  pebble: [[0, 56], [0.24, 64], [0.36, 80], [0.38, 94], [0.50, 120], [0.48, 152], [0.34, 168], [0, 172]],
  flame:  [[0, 34], [0.04, 44], [0.08, 52], [0.18, 62], [0.28, 74], [0.30, 92], [0.40, 100], [0.44, 118], [0.50, 136], [0.48, 152], [0.30, 168], [0, 170]],
  bean:   [[0, 54], [0.20, 62], [0.32, 88], [0.34, 100], [0.42, 118], [0.54, 138], [0.50, 158], [0.36, 168], [0, 170]],
});

/** Horizontal lean (x shear per unit of height) so asymmetric silhouettes read as such in 3D. */
export const BODY_LEAN = Object.freeze({ drop: 0, bell: 0, cloud: 0, pebble: 0, flame: 0.06, bean: 0.16 });

/** Surface "jelly" displacement amplitude (bumpy bodies) - tiny, same for everyone's brightness. */
export const BODY_BUMP = Object.freeze({ drop: 0, bell: 0, cloud: 0.045, pebble: 0.02, flame: 0.03, bean: 0.015 });

function hexToInt(hex) { return parseInt(String(hex).replace('#', ''), 16); }

/** Catmull-Rom densified profile in scene units: [{ r, y }], y measured upwards from the hem (0). */
export function latheProfile(body, subdivisions = 6) {
  const raw = BODY_PROFILES[body] || BODY_PROFILES.drop;
  const pts = raw.map(([r, sy]) => ({ r: r * 100 * UNIT, y: (HEM_Y - sy) * UNIT }));
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < subdivisions; s++) {
      const t = s / subdivisions, t2 = t * t, t3 = t2 * t;
      const r = 0.5 * ((2 * p1.r) + (-p0.r + p2.r) * t + (2 * p0.r - 5 * p1.r + 4 * p2.r - p3.r) * t2 + (-p0.r + 3 * p1.r - 3 * p2.r + p3.r) * t3);
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      out.push({ r: Math.max(0, Number(r.toFixed(5))), y: Number(y.toFixed(5)) });
    }
  }
  const last = pts[pts.length - 1];
  out.push({ r: 0, y: Number(last.y.toFixed(5)) });
  // Lathe wants the profile from the bottom (y=0) up; ensure the first and last radius are exactly 0 (closed ends).
  out.reverse();
  out[0] = { r: 0, y: out[0].y };
  out[out.length - 1] = { r: 0, y: out[out.length - 1].y };
  return out;
}

/** Profile radius at a given height (linear interpolation), used to size the face decal patch. */
export function radiusAt(profile, y) {
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], b = profile[i + 1];
    const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
    if (y >= lo && y <= hi) {
      if (hi === lo) return Math.max(a.r, b.r);
      const t = (y - a.y) / (b.y - a.y);
      return a.r + (b.r - a.r) * t;
    }
  }
  return 0;
}

/**
 * Everything the 3D scene needs, derived only from config + badge. Deterministic for equal inputs.
 * Colours are integers (0xRRGGBB); geometry is in scene units; `scale` is constant (BR-17).
 */
export function soulMeshParams(config, badge = null) {
  const s = resolveSoul(config);
  const pal = PALETTES[TRAITS.palette.indexOf(s.palette)] || PALETTES[0];
  const profile = latheProfile(s.body);
  const headY = (HEM_Y - HEAD_CENTER_Y) * UNIT;
  const headR = radiusAt(profile, headY);
  const top = profile.reduce((m, p) => Math.max(m, p.y), 0);
  return Object.freeze({
    seed: s.seed,
    body: s.body,
    palette: s.palette,
    eyes: s.eyes,
    mouth: s.mouth,
    antenna: s.antenna,
    glow: s.glow,
    colors: Object.freeze({ fill: hexToInt(pal.fill), highlight: hexToInt(pal.highlight), outline: hexToInt(pal.outline), glow: hexToInt(pal.glow) }),
    profile,
    lean: BODY_LEAN[s.body] || 0,
    bump: BODY_BUMP[s.body] || 0,
    headY,
    headR,
    topY: top,
    height: top,
    scale: 1,                 // identical for every Soul (BR-17)
    glowStrength: 1,          // identical for every Soul (BR-17)
    badge: badge === 'bingo-star',
    // Slow bob phase from the seed so a group of Souls does not move in lock-step; amplitude is shared.
    bobPhase: Number(((hashSeed(s.seed) % 1000) / 1000 * Math.PI * 2).toFixed(4)),
    // Face decal crop in SVG units (centred on the head bulb); antenna and feet are rendered as meshes instead.
    faceCrop: Object.freeze({ x: 60, y: 44, size: 80 }),
  });
}

/** Small FNV-1a hash (own implementation; keeps this module free of DOM/Three imports). */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Antenna tip layout per trait: [kind, offsetY above the head top, size]. Deterministic. */
export const ANTENNA = Object.freeze({
  orb: { tip: 'sphere', stalk: 0.16, size: 0.075 },
  ring: { tip: 'torus', stalk: 0.14, size: 0.08 },
  leaf: { tip: 'leaf', stalk: 0.12, size: 0.09 },
  spark: { tip: 'spark', stalk: 0.15, size: 0.07 },
  twin: { tip: 'twin', stalk: 0.14, size: 0.06 },
  none: null,
});

/** Reveal timeline (fractions of the soulReveal token duration) mirroring motion.json stages glow/silhouette/features. */
export const REVEAL_STAGES = Object.freeze({ glow: [0, 0.35], silhouette: [0.3, 0.7], features: [0.65, 1] });

/** 0..1 progress of a stage at time fraction t (clamped). */
export function stageProgress(stage, t) {
  const [a, b] = REVEAL_STAGES[stage];
  if (t <= a) return 0;
  if (t >= b) return 1;
  return (t - a) / (b - a);
}

/** Emphasized ease (cubic-bezier(0.3,0,0,1) approximation) for the timeline. */
export function easeEmphasized(t) { const x = Math.min(1, Math.max(0, t)); return 1 - Math.pow(1 - x, 3); }
export function easeExit(t) { const x = Math.min(1, Math.max(0, t)); return x * x; }

// ---------------------------------------------------------------------------------------------------------------
// Sticker language (docs/art/sticker-art-direction.md, 3D Soul spec): glossy clay + seeded speckles + die-cut hull
// + the "peel" reveal. Pure and deterministic: the same seed always yields the same speckles (BR-17: nothing here
// reads Platform / Role / rank; every Soul gets the same count, sizes and outline).

/** Speckle colours (sticker tokens --sticker-mint / --sticker-cyan / --sticker-lilac). */
export const SPECKLE_COLORS = Object.freeze([0x7cf5c8, 0x63e6ff, 0x8b7cf0]);
/** Speckle radii in scene units: r 3-4 and 6-8 SVG units at the 200 viewBox (small / large). */
export const SPECKLE_SIZES = Object.freeze({ small: 0.045, large: 0.085 });
/** Speckles per tier (<= 14; the low tier draws fewer spheres). */
export const SPECKLE_COUNT = Object.freeze({ high: 14, low: 8 });
/** Inverted-hull outline scale per tier (white back-face hull; the low tier has no AA so it stays a touch thinner). */
export const OUTLINE_SCALE = Object.freeze({ high: 1.06, low: 1.05 });
/** Sticker peel: scale 0.92 -> 1, 6 deg tilt, 250 ms outline flash, layered on the 'features' reveal stage (700 ms). */
export const PEEL = Object.freeze({ scaleFrom: 0.92, tiltDeg: 6, flashMs: 250, stageMs: 700, flashScaleBoost: 0.04 });

export function speckleCount(quality) { return SPECKLE_COUNT[quality] ?? SPECKLE_COUNT.low; }
export function outlineScale(quality) { return OUTLINE_SCALE[quality] ?? OUTLINE_SCALE.low; }

/**
 * Seeded speckle placement on the lathe surface. Returns [{ theta, y, r, size, color }] (theta around the Y axis,
 * y up from the hem, r = profile radius at y). The face region (front of the head bulb) is kept clear.
 * Deterministic for equal (seed, profile, count).
 */
export function speckleLayout(seed, profile, count = SPECKLE_COUNT.high, { headY = 0, headR = 0 } = {}) {
  let s = hashSeed(`speckle:${seed}`) || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const top = profile.reduce((m, p) => Math.max(m, p.y), 0);
  const out = [];
  const want = Math.max(0, Math.min(14, Math.floor(count)));
  for (let attempt = 0; out.length < want && attempt < want * 6; attempt++) {
    const theta = rnd() * Math.PI * 2;
    const y = top * (0.07 + 0.86 * rnd());
    const large = rnd() < 0.35;
    const color = SPECKLE_COLORS[Math.floor(rnd() * SPECKLE_COLORS.length)];
    const r = radiusAt(profile, y);
    if (r <= 0.02) continue;
    // keep the face clear: front half (sin(theta) > 0.2) of the head bulb band
    if (headR > 0 && Math.abs(y - headY) < headR * 0.85 && Math.sin(theta) > 0.2) continue;
    out.push(Object.freeze({ theta: Number(theta.toFixed(4)), y: Number(y.toFixed(4)), r: Number(r.toFixed(4)), size: large ? SPECKLE_SIZES.large : SPECKLE_SIZES.small, color }));
  }
  return Object.freeze(out);
}

/**
 * Peel state for the features stage progress p (0..1): { scale, tilt (radians), flash (0..1) }.
 * scale 0.92 -> 1 and tilt 6 deg -> 0 on the emphasized ease; flash is one 250 ms half-sine at the start.
 */
export function stickerPeel(p) {
  const x = Math.min(1, Math.max(0, p));
  const e = easeEmphasized(x);
  const ms = x * PEEL.stageMs;
  const flash = ms < PEEL.flashMs ? Math.sin(Math.PI * (ms / PEEL.flashMs)) : 0;
  return { scale: PEEL.scaleFrom + (1 - PEEL.scaleFrom) * e, tilt: (PEEL.tiltDeg * Math.PI / 180) * (1 - e), flash: Number(flash.toFixed(4)) };
}

/** Soul group scale through the reveal: 0.25 -> 0.92 while the silhouette forms, then the peel takes it to 1. */
export function revealScale(silP, peelP) {
  const a = Math.min(1, Math.max(0, silP)), b = Math.min(1, Math.max(0, peelP));
  return 0.25 + (PEEL.scaleFrom - 0.25) * a + (1 - PEEL.scaleFrom) * easeEmphasized(b);
}

// ---------------------------------------------------------------------------------------------------------------
// Baseline Soul (D-27, docs/art/soul-baseline.md): one sculpted character for everyone (assets/souls/baseline/*.glb,
// built by tools/ai/blender/soul_baseline.py). Per player the colour (v1 palette or v2 / v3 body gradient), the glow
// style, the face kit and charms (D-29; v3 adds the face plate, eyes and antenna charm on the v3 body, D-31) and the
// Bingo Star badge vary; body / eyes / antenna / mouth stay in v1 configs but are not drawn. Size, brightness, outline
// and motion amplitudes are shared constants (BR-17), defined once in packages/ui/soul3d/studio.js (SOUL_VIEW) for the
// phone and the public Galaxy.

export const BASELINE = SOUL_VIEW;
/** Glow trait -> halo style drawn around the Soul (same peak opacity for all three, BR-17). */
export const GLOW_STYLES = Object.freeze({ soft: 'back-glow', ring: 'dashed-ring', halo: 'halo-ring' });

export function outlineWidth(quality) { return viewOutlineWidth(quality); }

/**
 * What the baseline scene draws for one Soul, from config + badge only. Deterministic; ignores body / eyes /
 * antenna / mouth (not drawn on the baseline) and anything that is not a Soul trait (Platform, Role, rank ...).
 * Colours come from the resolved Soul: the v1 palette, or the v2 gradient seen as a palette (glow, highlight, outline;
 * fill = the gradient's sRGB midpoint), so the reveal's ring, motes and halo take the Soul's own glow.
 */
export function baselineParams(config, badge = null) {
  const s = resolveSoul(config);
  const pal = s.pal || PALETTES[TRAITS.palette.indexOf(s.palette)] || PALETTES[0];
  return Object.freeze({
    seed: s.seed,
    version: s.version,
    palette: s.palette,
    glow: s.glow,
    // v2 / v3: no halo ring above the orb (or the v3 antenna charm), which would read as the angel face kit's halo
    // (D-29); the soft glow instead.
    glowStyle: (s.version >= 2 && s.glow === 'halo' ? null : GLOW_STYLES[s.glow]) || GLOW_STYLES.soft,
    hex: Object.freeze({ fill: pal.fill, highlight: pal.highlight, outline: pal.outline, glow: pal.glow }),
    colors: Object.freeze({ fill: hexToInt(pal.fill), highlight: hexToInt(pal.highlight), outline: hexToInt(pal.outline), glow: hexToInt(pal.glow) }),
    badge: badge === 'bingo-star',
    scale: 1,                 // identical for every Soul (BR-17)
    glowStrength: 1,          // identical for every Soul (BR-17)
    bobPhase: Number(((hashSeed(s.seed) % 1000) / 1000 * Math.PI * 2).toFixed(4)),
  });
}

/** The join-screen mascot: the baseline in the lilac palette. It is nobody's Soul (no seed, no badge, no label). */
export const MASCOT = Object.freeze({ palette: 'lilac', glowStyle: GLOW_STYLES.soft });
export function mascotPalette() {
  const pal = PALETTES[TRAITS.palette.indexOf(MASCOT.palette)] || PALETTES[PALETTES.length - 1];
  return Object.freeze({ fill: pal.fill, highlight: pal.highlight, outline: pal.outline, glow: pal.glow });
}
