// Sticker doodads in the Galaxy periphery (art direction v2): rocket, UFO, ringed planet, comet and gold stars from
// packages/ui/doodads.js, drawn by three.js on the `high` tier only. This module is pure (Node-testable): it decides
// how many doodads a tier shows, where each one sits, how it bobs, and which exclusion zones hide it.
//
// Placement rule: every doodad has a fixed compass angle and rides just OUTSIDE the outermost open orbit ring (the
// rings open from the inside as Souls arrive, so the doodads drift outward with the constellation). A doodad whose
// spot would leave the region (minus a margin), sit inside the panel-side margin, or cover a text zone (the title
// caption, cluster count labels) is hidden - never moved over text. The QR and the side panel live outside the
// Galaxy canvas (the canvas ends at panelX), so they can never be covered; the right margin keeps the doodads
// clear of the panel border as well.
import { hash32 } from '../../../../packages/ui/soul-renderer.js';

export const DOODAD_SET = Object.freeze([
  { name: 'rocket', angleDeg: -52, size: 84, rotDeg: -28 },
  { name: 'ufo', angleDeg: -128, size: 78, rotDeg: -8 },
  { name: 'planet', angleDeg: 146, size: 88, rotDeg: 10 },
  { name: 'comet', angleDeg: 40, size: 80, rotDeg: 0 },
  { name: 'star', angleDeg: -90, size: 58, rotDeg: 12 },
  { name: 'star', angleDeg: 4, size: 44, rotDeg: -18 },
]);

export const DOODAD_RULES = Object.freeze({
  tiers: Object.freeze({ high: DOODAD_SET.length, medium: 0, low: 0 }),
  count: Object.freeze({ min: 5, max: 8 }),
  marginPx: 28,                       // from every region edge (right edge = panel border)
  orbitClearancePx: 44,               // gap between the outer orbit and the doodad's edge
  bob: Object.freeze({ amplitudePx: 6, periodSec: [4, 6] }),
  drift: Object.freeze({ amplitudePx: 12, periodSec: [26, 40] }),
  settleLerp: 0.04,                   // per-frame ease toward a new home when the outer ring changes
  titleCaption: Object.freeze({ x: 0, y: 0, w: 470, h: 84 }),   // .galaxy::before ("ARISE / SOUL CONSTELLATION")
  labelBox: Object.freeze({ w: 84, h: 26 }),                    // .galaxy__label (80 px wide, 20 px text + shadow)
});

/** Number of doodads for a quality tier (0 on medium / low). */
export function doodadsForTier(quality) {
  const n = DOODAD_RULES.tiers[quality];
  return Number.isFinite(n) ? n : 0;
}

function seeded01(seed, key) { return (hash32(`${seed}:doodad:${key}`) % 10000) / 10000; }
function lerp(a, b, t) { return a + (b - a) * t; }

/** Rects (region px) that doodads must never cover: the title caption plus one box under each cluster label. */
export function doodadExclusions({ clusters = [] } = {}) {
  const t = DOODAD_RULES.titleCaption;
  const out = [{ kind: 'caption', x: t.x, y: t.y, w: t.w, h: t.h }];
  const lb = DOODAD_RULES.labelBox;
  for (const c of clusters) {
    if (!c || !c.label) continue;
    out.push({ kind: 'label', x: c.x - lb.w / 2, y: c.y + (c.size || 0) / 2, w: lb.w, h: lb.h });
  }
  return out;
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Bounding box of a doodad at its (bobbed) position. */
export function doodadRect(d, x = d.x, y = d.y) { return { x: x - d.size / 2, y: y - d.size / 2, w: d.size, h: d.size }; }

/**
 * Homes for the doodads of a tier. `outer` is the outermost OPEN orbit ellipse ({ rx, ry } in region px, centred on
 * cx/cy); `width`/`height` the Galaxy region. Returns [{ name, index, x, y, size, rotDeg, bobPeriod, bobPhase,
 * driftPeriod, driftPhase, visible, reason }] - hidden items keep their coordinates so a renderer can fade them.
 */
export function doodadLayout({ seed = 'arise-galaxy-2026', width = 1248, height = 1080, outer = { rx: 160, ry: 119 }, quality = 'high', exclusions = [] } = {}) {
  const n = Math.min(DOODAD_SET.length, doodadsForTier(quality));
  if (n <= 0) return [];
  const scale = height / 1080;
  const cx = width / 2, cy = height / 2;
  const margin = DOODAD_RULES.marginPx;
  const out = [];
  for (let i = 0; i < n; i++) {
    const spec = DOODAD_SET[i];
    const size = Math.round(spec.size * scale);
    const half = size / 2;
    const jitter = (seeded01(seed, `${i}:angle`) - 0.5) * 14; // +-7 deg
    const a = ((spec.angleDeg + jitter) * Math.PI) / 180;
    const pad = DOODAD_RULES.orbitClearancePx * scale + half;
    const x = cx + Math.cos(a) * (outer.rx + pad);
    const y = cy + Math.sin(a) * (outer.ry + pad);
    const bobP = DOODAD_RULES.bob.periodSec, driftP = DOODAD_RULES.drift.periodSec;
    const d = {
      name: spec.name, index: i, x, y, size, rotDeg: spec.rotDeg,
      bobPeriod: lerp(bobP[0], bobP[1], seeded01(seed, `${i}:bob`)), bobPhase: seeded01(seed, `${i}:bobPhase`),
      driftPeriod: lerp(driftP[0], driftP[1], seeded01(seed, `${i}:drift`)), driftPhase: seeded01(seed, `${i}:driftPhase`),
      visible: true, reason: null,
    };
    const r = doodadRect(d);
    if (r.x < margin || r.y < margin || r.x + r.w > width - margin || r.y + r.h > height - margin) { d.visible = false; d.reason = 'bounds'; }
    else {
      const hit = exclusions.find(z => rectsIntersect(r, z));
      if (hit) { d.visible = false; d.reason = hit.kind || 'exclusion'; }
    }
    out.push(d);
  }
  return out;
}

/** Bob (+-6 px over 4-6 s) and slow horizontal drift offsets at `tSec`; zero under reduced motion. */
export function doodadOffset(d, tSec, reducedMotion = false, scale = 1) {
  if (reducedMotion) return { dx: 0, dy: 0 };
  const t = Number(tSec) || 0;
  return {
    dx: DOODAD_RULES.drift.amplitudePx * scale * Math.sin(2 * Math.PI * (t / d.driftPeriod + d.driftPhase)),
    dy: DOODAD_RULES.bob.amplitudePx * scale * Math.sin(2 * Math.PI * (t / d.bobPeriod + d.bobPhase)),
  };
}

/** Rotation baked into the doodad atlas cell, so a sprite batch without per-instance rotation still gets tilted props. */
export function doodadRotationDeg(name, index = 0) {
  const spec = DOODAD_SET[index] && DOODAD_SET[index].name === name ? DOODAD_SET[index] : DOODAD_SET.find(s => s.name === name);
  return spec ? spec.rotDeg : 0;
}
