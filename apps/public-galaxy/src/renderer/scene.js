// Arise Galaxy scene model - renderer-agnostic (pure ESM, Node-testable).
// Spec: docs/art/scene-spec.md, assets/scene/scene-config.json. Consumed by webgl2.js, canvas2d.js and static.js.
//
// Responsibilities: viewport layout, LOD selection, deterministic orbit placement with collision resolution,
// star twinkle / parallax, bounded camera drift, entrance interpolation and cluster aggregation. It never
// scales, tints or reorders a Soul by anything but config / badge / soulId (BR-17).
import { ORBIT_RINGS, soulOrbitSlot, hash32 } from '../../../../packages/ui/soul-renderer.js';

export const DEFAULT_SCENE_CONFIG = Object.freeze({
  background: '#0B0F1F',
  canvas: { width: 1920, height: 1080 },
  safeZone: { galaxyFraction: 0.65, panelFraction: 0.35, innerMarginPx: 32, galaxyWidthPx: 1248, panelX: 1248 },
  camera: { driftRadiusFraction: 0.015, driftPeriodSeconds: 40, maxAngularSpeedDegPerSec: 0.5, shake: 'forbidden' },
  entrance: { defaultEdge: 'bottom', edges: ['left', 'right', 'top', 'bottom'], arcDurationMs: 2200, pulseDurationMs: 600, settleDurationMs: 1200, maxConcurrent: 6, queueOverflow: 'settle-instantly' },
  lod: { fullBelowCount: 120, simpleBelowCount: 300, dotAbove: 300, fullMinPx: 56, simpleMinPx: 24, clusterAbove: 300, clusterGridPx: 96 },
  performance: {
    high: { maxSouls: 600, starLayers: 3, nebula: true, orbitRings: true, glowFilters: true, twinkle: true, entranceTrail: true, targetFps: 60 },
    medium: { maxSouls: 450, starLayers: 2, nebula: true, orbitRings: true, glowFilters: false, twinkle: true, entranceTrail: false, targetFps: 60 },
    low: { maxSouls: 300, starLayers: 1, nebula: true, orbitRings: false, glowFilters: false, twinkle: false, entranceTrail: false, targetFps: 30 },
    autoDowngrade: { belowFps: 45, sampleSeconds: 5, cooldownSeconds: 30 },
  },
  fallback: { order: ['webgl2', 'canvas2d', 'static'] },
});

export const DEFAULT_RINGS = Object.freeze({
  aspect: 1.35,
  driftAmplitude: 0.012,
  rings: ORBIT_RINGS.map((r, i) => ({ ring: r.ring, radius: r.radius, capacity: r.capacity, angularSpeedRadPerSec: Number((0.02 * Math.pow(0.94, i)).toFixed(3)) })),
});

const TAU = Math.PI * 2;
export const ATLAS_BUCKETS = Object.freeze([32, 64, 128, 192]);

/** Galaxy viewport layout. `width`/`height` are the Galaxy region (already 65 % of the screen). */
export function layoutViewport(width, height, cfg = DEFAULT_SCENE_CONFIG) {
  const w = Math.max(1, Number(width) || 1), hgt = Math.max(1, Number(height) || 1);
  const reference = cfg.canvas || DEFAULT_SCENE_CONFIG.canvas;
  return {
    width: w, height: hgt, cx: w / 2, cy: hgt / 2, halfH: hgt / 2,
    scale: hgt / reference.height,                 // 1.0 at 1080 rows
    innerMargin: (cfg.safeZone && cfg.safeZone.innerMarginPx) || 32,
  };
}

/** Level of detail from Soul count and on-screen sprite size (scene-config#lod). */
export function selectLod(count, spritePx, lod = DEFAULT_SCENE_CONFIG.lod) {
  const n = Math.max(0, Number(count) || 0), px = Number(spritePx) || 0;
  if (n <= lod.fullBelowCount || px >= lod.fullMinPx) return 'full';
  if (n <= lod.simpleBelowCount || px >= lod.simpleMinPx) return 'simple';
  return 'dot';
}

/** Atlas bucket (32/64/128/192) for a requested on-screen size in device pixels. */
export function bucketFor(devicePx) {
  for (const b of ATLAS_BUCKETS) if (devicePx <= b) return b;
  return ATLAS_BUCKETS[ATLAS_BUCKETS.length - 1];
}

/** Number of rings opened for `count` Souls (rings open from the inside as cumulative capacity >= count). */
export function activeRingCount(count, rings = DEFAULT_RINGS.rings) {
  const need = Math.max(1, Math.floor(count) || 1);
  let active = 0, cum = 0;
  while (active < rings.length && cum < need) { cum += rings[active].capacity; active++; }
  return active;
}

/** Same on-screen size for every Soul: derived from the tightest open ring so neighbours never overlap. */
export function spriteSizePx(layout, count, ringsData = DEFAULT_RINGS) {
  const active = activeRingCount(count, ringsData.rings);
  let minSpacing = Infinity;
  for (let i = 0; i < active; i++) {
    const r = ringsData.rings[i];
    const meanRadius = r.radius * layout.halfH * (1 + ringsData.aspect) / 2;
    minSpacing = Math.min(minSpacing, (TAU * meanRadius) / r.capacity);
  }
  const size = Math.round(Math.min(layout.halfH * 0.22, minSpacing * 1.15));
  return Math.max(20, Math.min(128, size));
}

/** Effective ellipse aspect for a ring: horizontal clamp so the outer rings never leave the Galaxy viewport. */
export function ringAspect(ring, layout, ringsData = DEFAULT_RINGS, spriteHalf = 0) {
  const r = ringsData.rings[ring];
  const rx = r.radius * layout.halfH;
  if (rx <= 0) return ringsData.aspect;
  return Math.min(ringsData.aspect, Math.max(0.6, (layout.cx - spriteHalf) / rx));
}

/**
 * Deterministic placement for an ordered list of SoulEntrance records. Keeps `existing` placements stable and
 * resolves slot collisions by scanning forward in the ring, spilling to the next ring outward when a ring is full.
 * Returns a Map soulId -> { ring, slot, angle, radius }.
 */
export function placeSouls(souls, existing = new Map(), ringsData = DEFAULT_RINGS) {
  const rings = ringsData.rings;
  const placements = new Map();
  const taken = new Set();
  const count = Math.max(1, souls.length);
  const claim = (id, p) => { placements.set(id, p); taken.add(`${p.ring}:${p.slot}`); };
  for (const s of souls) {
    const id = String(s.soulId);
    if (existing.has(id)) claim(id, existing.get(id));
  }
  for (const s of souls) {
    const id = String(s.soulId);
    if (placements.has(id)) continue;
    const want = soulOrbitSlot(id, count);
    let ring = want.ring, slot = want.slot, found = null;
    for (let hop = 0; hop < rings.length && !found; hop++) {
      const cap = rings[ring].capacity;
      for (let k = 0; k < cap; k++) {
        const candidate = (slot + k) % cap;
        if (!taken.has(`${ring}:${candidate}`)) { found = { ring, slot: candidate }; break; }
      }
      if (!found) { ring = (ring + 1) % rings.length; slot = 0; }
    }
    if (!found) found = { ring: want.ring, slot: want.slot }; // 588+ Souls: share (clusters take over anyway)
    const cap = rings[found.ring].capacity;
    const jitter = ((hash32(id + ':jitter') % 1000) / 1000 - 0.5) * 0.5;
    const angle = ((found.slot + 0.5 + jitter) / cap) * TAU;
    claim(id, { ring: found.ring, slot: found.slot, angle, radius: rings[found.ring].radius });
  }
  return placements;
}

/** Orbit position of a placed Soul at time `tSec` (0 = static). */
export function orbitPosition(placement, tSec, layout, opts = {}) {
  const ringsData = opts.rings || DEFAULT_RINGS;
  const r = ringsData.rings[placement.ring];
  const motion = opts.reducedMotion ? 0 : 1;
  const rot = motion * r.angularSpeedRadPerSec * tSec;
  const aspect = ringAspect(placement.ring, layout, ringsData, opts.spriteHalf || 0);
  const a = placement.angle + rot;
  const bob = motion * (ringsData.driftAmplitude || 0.012) * layout.height * Math.sin(TAU * (tSec / 6 + (opts.driftPhase || 0)));
  return {
    x: layout.cx + placement.radius * layout.halfH * aspect * Math.cos(a),
    y: layout.cy + placement.radius * layout.halfH * Math.sin(a) + bob,
  };
}

/** Bounded Lissajous camera drift (never a shake). */
export function cameraOffset(tSec, layout, camera = DEFAULT_SCENE_CONFIG.camera, reducedMotion = false) {
  if (reducedMotion) return { dx: 0, dy: 0 };
  const R = (camera.driftRadiusFraction || 0.015) * layout.height;
  const a = TAU * (tSec / (camera.driftPeriodSeconds || 40));
  return { dx: R * Math.sin(a), dy: R * 0.6 * Math.sin(2 * a + Math.PI / 3) };
}

/** Star brightness with twinkle (amplitude +- fraction, period seconds, per-star phase 0..1). */
export function starAlpha(star, tSec, layer, twinkle = true) {
  const b = star.b;
  if (!twinkle || !layer.twinkleAmplitude) return b;
  return b * (1 + layer.twinkleAmplitude * Math.sin(TAU * (tSec / layer.twinklePeriodSeconds + star.t)));
}

/** Entrance start point: 8 % outside the viewport on the given edge, horizontally/vertically aligned with the target. */
export function entranceStart(edge, target, layout) {
  const pad = 0.08;
  switch (edge) {
    case 'left': return { x: -layout.width * pad, y: target.y };
    case 'right': return { x: layout.width * (1 + pad), y: target.y };
    case 'top': return { x: target.x, y: -layout.height * pad };
    default: return { x: target.x, y: layout.height * (1 + pad) };
  }
}

/** Quadratic arc between start and target lifting towards the viewport centre; t in 0..1 (eased by caller). */
export function arcPoint(start, target, t, layout) {
  const mx = (start.x + target.x) / 2, my = (start.y + target.y) / 2;
  const toCx = layout.cx - mx, toCy = layout.cy - my;
  const len = Math.hypot(toCx, toCy) || 1;
  const lift = Math.min(layout.height * 0.12, len * 0.35);
  const ctrl = { x: mx + (toCx / len) * lift, y: my + (toCy / len) * lift };
  const u = 1 - t;
  return { x: u * u * start.x + 2 * u * t * ctrl.x + t * t * target.x, y: u * u * start.y + 2 * u * t * ctrl.y + t * t * target.y };
}

export function easeStandard(t) { // approximates cubic-bezier(0.2,0,0,1)
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/** Aggregate Souls on rings >= 7 into clusterGridPx cells (count > clusterAbove). */
export function clusterSouls(items, gridPx) {
  const cells = new Map();
  const rest = [];
  for (const it of items) {
    if (it.ring < 7) { rest.push(it); continue; }
    const key = `${Math.floor(it.x / gridPx)}:${Math.floor(it.y / gridPx)}`;
    let c = cells.get(key);
    if (!c) { c = { key, x: 0, y: 0, count: 0, config: it.config, soulId: it.soulId }; cells.set(key, c); }
    c.x += it.x; c.y += it.y; c.count++;
  }
  const clusters = [...cells.values()].map(c => ({ ...c, x: c.x / c.count, y: c.y / c.count }));
  return { souls: rest, clusters };
}

/**
 * Scene state machine: holds Souls, placements and entrance progress; `frame()` returns draw lists.
 * @param {object} opts { config, rings, starLayers: [{layer, parallax, twinkleAmplitude, twinklePeriodSeconds, stars}], quality, reducedMotion, queue }
 */
export function createScene(opts = {}) {
  const config = opts.config || DEFAULT_SCENE_CONFIG;
  const ringsData = opts.rings || DEFAULT_RINGS;
  const starLayers = opts.starLayers || [];
  const queue = opts.queue || null;
  let reducedMotion = !!opts.reducedMotion;
  let quality = opts.quality || 'high';
  let layout = layoutViewport(config.safeZone.galaxyWidthPx, config.canvas.height, config);
  const souls = [];                    // ordered SoulEntrance list
  const byId = new Map();
  let placements = new Map();
  let maxDetail = 'full';
  let brightnessRipple = 0;            // 0..1, decays over 350 ms after a draw

  function level() { return config.performance[quality] || config.performance.high; }

  function setSouls(list) {
    souls.length = 0; byId.clear();
    for (const s of list || []) { if (s && s.soulId && !byId.has(String(s.soulId))) { souls.push(s); byId.set(String(s.soulId), s); } }
    placements = placeSouls(souls, placements, ringsData);
  }
  function addSoul(entry) {
    if (!entry || !entry.soulId || byId.has(String(entry.soulId))) return false;
    souls.push(entry); byId.set(String(entry.soulId), entry);
    placements = placeSouls(souls, placements, ringsData);
    return true;
  }

  function resize(width, height) { layout = layoutViewport(width, height, config); }
  function spritePx() { return spriteSizePx(layout, souls.length, ringsData); }
  function lodFor(count, px) {
    const lod = selectLod(count, px, config.lod);
    if (maxDetail === 'simple' && lod === 'full') return 'simple';
    if (maxDetail === 'dot') return 'dot';
    return lod;
  }

  /** Draw lists for time tSec (seconds since scene start; static renderers pass 0) and nowMs (wall/server ms for entrances). */
  function frame(tSec, nowMs) {
    const lv = level();
    const cam = cameraOffset(tSec, layout, config.camera, reducedMotion);
    const count = souls.length;
    const size = spritePx();
    const detail = lodFor(count, size);
    const stars = [];
    const layersToDraw = Math.min(lv.starLayers, starLayers.length);
    const twinkle = lv.twinkle && !reducedMotion;
    const ripple = brightnessRipple > 0 ? 1 + 0.10 * brightnessRipple : 1;
    for (let i = 0; i < layersToDraw; i++) {
      const layer = starLayers[i];
      const par = reducedMotion ? 0 : layer.parallax;
      const out = { layer: layer.layer, color: layer.color, parallax: layer.parallax, points: [] };
      for (const s of layer.stars) {
        out.points.push({ x: s.x * layout.width + cam.dx * par, y: s.y * layout.height + cam.dy * par, r: s.r * layout.scale, a: Math.min(1, starAlpha(s, tSec, layer, twinkle) * ripple) });
      }
      stars.push(out);
    }
    const rings = lv.orbitRings ? ringsData.rings.map((r, i) => ({ ring: i, cx: layout.cx + cam.dx, cy: layout.cy + cam.dy, rx: r.radius * layout.halfH * ringAspect(i, layout, ringsData, size / 2), ry: r.radius * layout.halfH })) : [];
    const items = [];
    const entrances = [];
    for (const s of souls) {
      const id = String(s.soulId);
      const p = placements.get(id);
      if (!p) continue;
      const home = orbitPosition(p, tSec, layout, { rings: ringsData, reducedMotion, spriteHalf: size / 2, driftPhase: s.config && s.config.driftPhase });
      home.x += cam.dx; home.y += cam.dy;
      const prog = queue ? queue.progress(id, nowMs) : null;
      if (prog && prog.phase !== 'done') {
        entrances.push(entranceItem(s, p, home, prog, size));
        continue;
      }
      items.push({ soulId: id, config: s.config, badge: s.badge || null, x: home.x, y: home.y, size, scale: 1, alpha: 1, detail, ring: p.ring });
    }
    let clusters = [];
    let visible = items;
    if (count > config.lod.clusterAbove) {
      const c = clusterSouls(items, config.lod.clusterGridPx);
      visible = c.souls; clusters = c.clusters.map(k => ({ ...k, size: Math.max(size, 28), detail: 'dot', label: k.count > 1 ? `x ${k.count}` : null }));
    }
    // Outer rings first, then slot, so inner Souls draw last (nearest).
    visible.sort((a, b) => b.ring - a.ring || a.x - b.x);
    return { layout, camera: cam, level: lv, quality, count, timeSec: tSec, spritePx: size, detail, stars, rings, souls: visible, clusters, entrances, nebula: lv.nebula, ripple: brightnessRipple };
  }

  function entranceItem(s, p, home, prog, size) {
    const id = String(s.soulId);
    const edge = s.edge || config.entrance.defaultEdge;
    const base = { soulId: id, config: s.config, badge: s.badge || null, size, detail: 'full', ring: p.ring, phase: prog.phase, t: prog.t, trail: [] };
    if (reducedMotion || prog.phase === 'fade') {
      return { ...base, x: home.x, y: home.y, scale: 1, alpha: prog.phase === 'fade' ? easeStandard(prog.t) : 1, glow: 0 };
    }
    if (prog.phase === 'arc') {
      const start = entranceStart(edge, home, layout);
      const e = easeStandard(prog.t);
      const pos = arcPoint(start, home, e, layout);
      const trail = [];
      for (let k = 1; k <= 4; k++) { const tt = Math.max(0, e - k * 0.035); trail.push({ ...arcPoint(start, home, tt, layout), alpha: 0.35 - k * 0.07 }); }
      return { ...base, x: pos.x, y: pos.y, scale: 1, alpha: 1, glow: 0.55, trail };
    }
    if (prog.phase === 'pulse') {
      const k = Math.sin(Math.PI * prog.t); // 0 -> 1 -> 0
      return { ...base, x: home.x, y: home.y, scale: 1 + 0.12 * k, alpha: 1, glow: 0.55 + 0.45 * k };
    }
    // settle: glow eases back, scale 1
    return { ...base, x: home.x, y: home.y, scale: 1, alpha: 1, glow: 0.55 * (1 - easeStandard(prog.t)) };
  }

  return {
    setSouls, addSoul, resize, frame, spritePx,
    get layout() { return layout; },
    get count() { return souls.length; },
    get placements() { return placements; },
    setQuality(q) { if (config.performance[q]) quality = q; },
    get quality() { return quality; },
    setReducedMotion(v) { reducedMotion = !!v; },
    get reducedMotion() { return reducedMotion; },
    setMaxDetail(d) { maxDetail = d; },
    ripple() { brightnessRipple = 1; },
    tick(dtMs) { if (brightnessRipple > 0) brightnessRipple = Math.max(0, brightnessRipple - dtMs / 350); },
    config, ringsData,
  };
}

// ---- v2 sticker atlas cells (art direction v2 / D-25) ----
// The Galaxy atlas is rasterised from the 2D renderer at detail 'simple' (3 px die-cut and r 3-4 / 6-8 speckles at
// a 240 px Soul). Those features only survive if the cell is larger than the on-screen sprite: cells are picked at
// ATLAS_SUPERSAMPLE x the device size (bilinear minification stays under 2 x) in 48..192 px steps.
// Measured at 1920x1080 (dpr 1): 12-16 Souls draw at 72 px -> 128 px cells; 22 -> 61 px -> 96; 120 -> 46 px -> 96;
// 300 -> 34 px -> 64; 450 -> 26 px -> 48 (11 shelf rows of a single 2048^2 page).
export const ATLAS_CELLS = Object.freeze([48, 64, 96, 128, 192]);
export const ATLAS_SUPERSAMPLE = 1.5;
export const STICKER_REF_PX = 240;

/** Atlas cell edge (px) for a sprite drawn at `devicePx` device pixels. */
export function atlasCellFor(devicePx) {
  const want = Math.max(1, Number(devicePx) || 1) * ATLAS_SUPERSAMPLE;
  for (const c of ATLAS_CELLS) if (want <= c) return c;
  return ATLAS_CELLS[ATLAS_CELLS.length - 1];
}

/** Sticker features (px) inside a cell: die-cut band outside the body, small / large speckle radius. */
export function stickerFeaturePx(cell) {
  const k = cell / STICKER_REF_PX;
  return { dieCut: 3 * k, speckleSmall: 3 * k, speckleLarge: 6 * k };
}

/** Shelf-packing footprint of `count` sprites in `cell` px cells on `pageSize`^2 RGBA pages. */
export function atlasFootprint(count, cell, pageSize = 2048) {
  const n = Math.max(0, Math.floor(count) || 0);
  const perRow = Math.max(1, Math.floor(pageSize / cell));
  const rowsPerPage = Math.max(1, Math.floor(pageSize / cell));
  const rows = Math.ceil(n / perRow);
  const pages = Math.max(1, Math.ceil(rows / rowsPerPage));
  return { cell, perRow, rows, pages, pageBytes: pageSize * pageSize * 4, bytes: pages * pageSize * pageSize * 4, usedBytes: n * cell * cell * 4 };
}

/** On-screen sprite size and atlas cell for `count` Souls in a `width` x `height` Galaxy at `dpr` (measurement helper). */
export function atlasCellPlan(count, width = 1248, height = 1080, dpr = 1, ringsData = DEFAULT_RINGS) {
  const layout = layoutViewport(width, height);
  const px = spriteSizePx(layout, count, ringsData);
  const cell = atlasCellFor(px * dpr);
  return { count, spritePx: px, devicePx: px * dpr, cell, detail: selectLod(count, px), features: stickerFeaturePx(cell), footprint: atlasFootprint(count, cell) };
}
