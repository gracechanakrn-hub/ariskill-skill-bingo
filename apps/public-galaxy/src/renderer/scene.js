// Arise Galaxy scene model - renderer-agnostic (pure ESM, Node-testable).
// Spec: docs/art/scene-spec.md, assets/scene/scene-config.json. Consumed by webgl2.js, canvas2d.js and static.js.
//
// Responsibilities: viewport layout, LOD selection, deterministic orbit placement with collision resolution,
// star twinkle / parallax, bounded camera drift, entrance interpolation and cluster aggregation. It never
// scales, tints or reorders a Soul by anything but config / badge / soulId (BR-17).
import { ORBIT_RINGS, soulOrbitSlot, hash32 } from '../../../../packages/ui/soul-renderer.js';
import { SOUL_ACTIONS, actionDuration, actionSide } from '../../../../packages/ui/soul3d/actions.js';
import { readingSeconds } from '../greeting-bubble.js';

export const DEFAULT_SCENE_CONFIG = Object.freeze({
  background: '#0B0F1F',
  canvas: { width: 1920, height: 1080 },
  safeZone: { galaxyFraction: 0.7, panelFraction: 0.3, innerMarginPx: 32, galaxyWidthPx: 1344, panelX: 1344 },   // 70 / 30 (D-52)
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

// Mirrors assets/scene/orbit-rings.json (tools/assets/build-scene.js): ring 0 turns at 0.04 rad/s, 6 % slower per ring
// outward; `float` is the per-Soul drift (D-36): +-amplitude x the sprite size on a slow and a fast sine per axis, and a
// bob of driftAmplitude x the viewport height, each Soul with its own periods (seconds) and phases.
export const DEFAULT_RINGS = Object.freeze({
  aspect: 1.35,
  driftAmplitude: 0.012,
  float: Object.freeze({ amplitude: 0.22, slowPeriodS: [9, 19], fastPeriodS: [4, 9], bobPeriodS: [5, 8] }),
  rings: ORBIT_RINGS.map((r, i) => ({ ring: r.ring, radius: r.radius, capacity: r.capacity, angularSpeedRadPerSec: Number((0.04 * (1 - i * 0.06)).toFixed(3)) })),
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
    claim(id, { ring: found.ring, slot: found.slot, angle, radius: rings[found.ring].radius, float: floatParams(id, ringsData.float) });
  }
  return placements;
}

/**
 * Per-Soul float parameters (D-36), fixed by the Soul id: periods (seconds) and phases (0..1) of a slow and a fast sine
 * per axis, and the bob period. Cosmetic only; never derived from anything but the id (BR-17).
 */
export function floatParams(soulId, float = DEFAULT_RINGS.float) {
  const f = float || DEFAULT_RINGS.float;
  const u = (k) => (hash32(`${soulId}:float:${k}`) % 10007) / 10007;
  const span = ([lo, hi], k) => lo + (hi - lo) * u(k);
  return {
    x: [span(f.slowPeriodS, 0), span(f.fastPeriodS, 1)], y: [span(f.slowPeriodS, 2), span(f.fastPeriodS, 3)],
    phase: [u(4), u(5), u(6), u(7)], bob: span(f.bobPeriodS, 8),
  };
}

/** The float offset (px) of a placed Soul at `tSec`: +-amplitude x `size` per axis, a slow sine plus a fast one. */
export function floatOffset(fp, tSec, size, amplitude = DEFAULT_RINGS.float.amplitude) {
  const w = amplitude * size;
  const wave = (periods, p0, p1) => 0.65 * Math.sin(TAU * (tSec / periods[0] + p0)) + 0.35 * Math.sin(TAU * (tSec / periods[1] + p1));
  return { dx: w * wave(fp.x, fp.phase[0], fp.phase[1]), dy: w * wave(fp.y, fp.phase[2], fp.phase[3]) };
}

/** Orbit position of a placed Soul at time `tSec` (0 = static): its ring's turn, its own float and bob. */
export function orbitPosition(placement, tSec, layout, opts = {}) {
  const ringsData = opts.rings || DEFAULT_RINGS;
  const r = ringsData.rings[placement.ring];
  const motion = opts.reducedMotion ? 0 : 1;
  const rot = motion * r.angularSpeedRadPerSec * tSec;
  const aspect = ringAspect(placement.ring, layout, ringsData, opts.spriteHalf || 0);
  const a = placement.angle + rot;
  const fp = placement.float;
  const bob = motion * (ringsData.driftAmplitude || 0.012) * layout.height * Math.sin(TAU * (tSec / (fp ? fp.bob : 6) + (opts.driftPhase || 0)));
  const drift = fp && motion ? floatOffset(fp, tSec, 2 * (opts.spriteHalf || 0), (ringsData.float || DEFAULT_RINGS.float).amplitude) : { dx: 0, dy: 0 };
  return {
    x: layout.cx + placement.radius * layout.halfH * aspect * Math.cos(a) + drift.dx,
    y: layout.cy + placement.radius * layout.halfH * Math.sin(a) + bob + drift.dy,
  };
}

// ---- Depth and life (D-36) ------------------------------------------------------------------------------------
// The rings are a tilted disc: the lower half of each ellipse is near the viewer, the upper half far away. A Soul's
// depth follows its place on the ring plus a slow per-Soul drift in and out, and sets its size, haze and parallax, and
// the draw order (far first). Every Soul orbits through the same range, so over time none is bigger or brighter than
// another (BR-17); under reduced motion everything stays flat, as before.
export const DEPTH = Object.freeze({ scale: [0.64, 1.36], alpha: [0.74, 1], parallax: [0.6, 1.4], wobble: 0.12 });

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const lerp = (a, b, t) => a + (b - a) * t;

/** Depth of a placed Soul at `tSec`: 0 = far (top of its ring) .. 1 = near (bottom). */
export function soulDepth(placement, tSec, ringsData = DEFAULT_RINGS) {
  const r = ringsData.rings[placement.ring];
  const a = placement.angle + r.angularSpeedRadPerSec * tSec;
  const fp = placement.float;
  const wobble = fp ? DEPTH.wobble * Math.sin(TAU * (tSec / (fp.x[0] * 1.7) + fp.phase[1])) : 0;
  return clamp01(0.5 + 0.44 * Math.sin(a) + wobble);
}
export const depthScale = (d) => lerp(DEPTH.scale[0], DEPTH.scale[1], d);
export const depthAlpha = (d) => lerp(DEPTH.alpha[0], DEPTH.alpha[1], d);
export const depthParallax = (d) => lerp(DEPTH.parallax[0], DEPTH.parallax[1], d);

// Life: a few Souls at a time do a micro action where they orbit (up to 3 lanes, one action per lane every 6 s; fewer on
// the lower quality levels), and one Soul at a time floats out to the front and says hi: it stays there as long as its
// bubble takes to read (3.8 s for a plain hi, up to 16 s for a 40-word greeting), then floats back, and the next one
// comes out a few seconds later. Who and what come from the time and the Soul ids only (random, never skills or
// results). Nothing starts in the first seconds (a static render, t = 0, stays calm) or while a Float entrance is in
// flight (entrances keep every live 3D tile).
export const LIFE = Object.freeze({
  startDelayS: 6, actLanes: 3, actLanesByQuality: Object.freeze({ high: 3, medium: 2, low: 0 }), actSlotS: 6, actLeadS: 0.5,
  visitDelayS: 4, visitGapS: Object.freeze([3, 7]), visitOutS: 1.6, visitBackS: 1.6, visitScale: 3.2,
  visitHeight: 0.3,        // the visitor is at least this fraction of the Galaxy height, however crowded the sky is
});

/**
 * What a visitor does while it says hi for `hiS` seconds: wave first; a wink halfway through a long hi (>= 8 s); a sway
 * before the end of a very long one (>= 12 s). Returns [{ action, at }] (seconds into the hi), never overlapping.
 */
export function visitActions(hiS) {
  const out = [{ action: 'wave', at: 0 }];
  if (hiS >= 8) out.push({ action: 'wink', at: hiS / 2 - actionDuration('wink') / 2 });
  if (hiS >= 12) out.push({ action: 'sway', at: hiS - actionDuration('sway') - 1.2 });
  return out;
}

/** Act lane `lane` at `tSec`: { key, action, t (seconds into the action) } or null between actions. */
export function actLaneAt(lane, tSec, life = LIFE) {
  const t0 = tSec - life.startDelayS - lane * (life.actSlotS / life.actLanes);
  if (t0 < 0) return null;
  const slot = Math.floor(t0 / life.actSlotS);
  const action = SOUL_ACTIONS[hash32(`act:${lane}:${slot}:a`) % SOUL_ACTIONS.length];
  const t = t0 - slot * life.actSlotS - life.actLeadS;
  if (t < 0 || t >= actionDuration(action)) return null;
  return { key: `act:${lane}:${slot}`, action, t };
}

/** Rendezvous pick: the id with the highest hash for `key` (uniform; adding a Soul rarely changes an earlier pick). */
export function pickSoul(key, ids) {
  let best = null, bestH = -1;
  for (const id of ids) { const h = hash32(`${key}:${id}`); if (h > bestH) { bestH = h; best = id; } }
  return best;
}

const easeInOut = (t) => { const x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

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
  const picks = new Map();             // life slot key -> soulId | null (decided once, at the slot's first frame)
  let visitPlan = null;                // { key, soulId, start, hiS, end, u }: the current "say hi" visit
  const hiQueue = [];                  // D-36: Souls that just floated in live, in arrival order - they say hi first
  let nextVisitAt = LIFE.startDelayS + LIFE.visitDelayS, visitCount = 0;

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

  /**
   * A Soul that just floated in live (galaxy.enter with celebrate): it takes the next "say hi" turn, after any earlier
   * arrivals, so its player sees the greeting soon. Only decorated Souls can visit; snapshot and replayed Souls never queue.
   */
  function queueHi(soulId) {
    const id = String(soulId), s = byId.get(id);
    if (reducedMotion || !s || !(s.config && Number(s.config.version) >= 2) || hiQueue.includes(id)) return false;   // no visits under reduced motion
    hiQueue.push(id);
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
    const visits = [];
    const entering = new Set();
    if (queue) for (const s of souls) { const pr = queue.progress(String(s.soulId), nowMs); if (pr && pr.phase !== 'done') entering.add(String(s.soulId)); }
    const life = reducedMotion ? { acts: new Map(), visit: null } : lifeAt(tSec, entering, detail);
    for (const s of souls) {
      const id = String(s.soulId);
      const p = placements.get(id);
      if (!p) continue;
      const home = orbitPosition(p, tSec, layout, { rings: ringsData, reducedMotion, spriteHalf: size / 2, driftPhase: s.config && s.config.driftPhase });
      const depth = reducedMotion ? 0.5 : soulDepth(p, tSec, ringsData);
      const par = reducedMotion ? 1 : depthParallax(depth);
      home.x += cam.dx * par; home.y += cam.dy * par;
      const prog = entering.has(id) ? queue.progress(id, nowMs) : null;
      if (prog) {
        entrances.push(entranceItem(s, p, home, prog, size));
        continue;
      }
      if (life.visit && life.visit.soulId === id) { visits.push(visitItem(s, p, home, depth, life.visit, size)); continue; }
      const scale = reducedMotion ? 1 : depthScale(depth), alpha = reducedMotion ? 1 : depthAlpha(depth);
      const item = { soulId: id, config: s.config, badge: s.badge || null, x: home.x, y: home.y, size, scale, alpha, detail, ring: p.ring, depth };
      const act = life.acts.get(id);
      if (act) item.act = act;
      items.push(item);
    }
    let clusters = [];
    let visible = items;
    if (count > config.lod.clusterAbove) {
      const c = clusterSouls(items, config.lod.clusterGridPx);
      visible = c.souls; clusters = c.clusters.map(k => ({ ...k, size: Math.max(size, 28), detail: 'dot', label: k.count > 1 ? `x ${k.count}` : null }));
    }
    // Far first, so nearer Souls draw over farther ones (D-36); flat under reduced motion: outer rings first, as before.
    if (reducedMotion) visible.sort((a, b) => b.ring - a.ring || a.x - b.x);
    else visible.sort((a, b) => a.depth - b.depth || a.x - b.x);
    return { layout, camera: cam, level: lv, quality, count, timeSec: tSec, spritePx: size, detail, stars, rings, souls: visible, clusters, entrances, visits, nebula: lv.nebula, ripple: brightnessRipple };
  }

  /** Who acts and who visits at `tSec`: decorated Souls not entering; one decision per life slot. */
  function lifeAt(tSec, entering, detail) {
    const ids = [];
    for (const s of souls) if (s.config && Number(s.config.version) >= 2) ids.push(String(s.soulId));
    const decide = (key, exclude) => {
      if (!picks.has(key)) {
        const pool = entering.size ? [] : ids.filter((id) => !exclude.has(id)); // nothing new starts during an entrance
        picks.set(key, pool.length ? pickSoul(key, pool) : null);
        if (picks.size > 64) picks.delete(picks.keys().next().value);
      }
      const id = picks.get(key);
      return id && byId.has(id) && !entering.has(id) ? id : null;
    };
    // the Soul out front (if any) never acts in a lane; a new visitor is never one that is mid-action; a Soul waiting for
    // its first hi does not start an action either
    const taken = new Set(hiQueue);
    if (visitPlan && tSec >= visitPlan.start - 1 && tSec < visitPlan.end) taken.add(visitPlan.soulId);
    const acts = new Map();
    const lanes = LIFE.actLanesByQuality[quality] ?? LIFE.actLanes;
    if (detail !== 'dot') {
      for (let lane = 0; lane < lanes; lane++) {
        const a = actLaneAt(lane, tSec);
        if (!a) continue;
        const id = decide(a.key, taken);
        if (!id || taken.has(id)) continue;
        taken.add(id);
        const cfg = byId.get(id).config;
        acts.set(id, { action: a.action, t: a.t, side: actionSide(`${cfg.seed}:${a.key}`, { action: a.action, face: cfg.face }) });
      }
    }
    const visit = visitNow(tSec, ids.filter((id) => !acts.has(id)), entering);
    if (visit) acts.delete(visit.soulId);
    return { acts, visit };
  }

  /**
   * The visit timeline: when the current visit is over, the next one starts a random 3-7 s later (later while a Float
   * entrance is in flight). The visitor is the earliest Soul still waiting in hiQueue (a new arrival), else a random
   * decorated Soul; its hi lasts as long as its bubble takes to read.
   * Returns { key, soulId, phase, t (0..1 in the phase), hiT, hiS, u } or null.
   */
  function visitNow(tSec, ids, entering) {
    if (visitPlan && tSec >= visitPlan.end) {
      nextVisitAt = visitPlan.end + LIFE.visitGapS[0] + (LIFE.visitGapS[1] - LIFE.visitGapS[0]) * ((hash32(`${visitPlan.key}:gap`) % 1000) / 1000);
      visitPlan = null;
    }
    if (visitPlan && tSec < visitPlan.start - 1) { visitPlan = null; nextVisitAt = tSec + LIFE.visitGapS[0]; } // time went back
    if (!visitPlan && tSec >= nextVisitAt) {
      const pool = entering.size ? [] : ids;
      const key = `visit:${visitCount}`;
      while (hiQueue.length && !byId.has(hiQueue[0])) hiQueue.shift();       // left the sky before its turn
      const waiting = hiQueue.length ? hiQueue[0] : null;
      // a new arrival first (it waits while it is still entering or finishing an action); else a random decorated Soul
      const id = waiting ? (pool.includes(waiting) ? waiting : null) : (pool.length ? pickSoul(key, pool) : null);
      if (id && id === waiting) hiQueue.shift();
      if (!id) nextVisitAt = tSec + 1;
      else {
        visitCount++;
        const s = byId.get(id);
        const hiS = readingSeconds({ label: s.label ?? null, greeting: s.greeting ?? null });
        visitPlan = { key, soulId: id, start: tSec, hiS, end: tSec + LIFE.visitOutS + hiS + LIFE.visitBackS, u: (hash32(`${key}:x`) % 1000) / 1000 };
      }
    }
    if (!visitPlan || !byId.has(visitPlan.soulId) || entering.has(visitPlan.soulId)) return null;
    const el = tSec - visitPlan.start;
    if (el < 0) return null;
    const { key, soulId, hiS, u } = visitPlan;
    if (el < LIFE.visitOutS) return { key, soulId, phase: 'out', t: el / LIFE.visitOutS, hiT: 0, hiS, u };
    if (el < LIFE.visitOutS + hiS) return { key, soulId, phase: 'hi', t: (el - LIFE.visitOutS) / hiS, hiT: el - LIFE.visitOutS, hiS, u };
    return { key, soulId, phase: 'back', t: Math.min(1, (el - LIFE.visitOutS - hiS) / LIFE.visitBackS), hiT: 0, hiS, u };
  }

  /** A Soul visiting the front: out to a spot low in the middle (near the viewer), says hi big, back home. */
  function visitItem(s, p, home, depth, v, size) {
    const id = String(s.soulId);
    const big = Math.max(LIFE.visitScale, (LIFE.visitHeight * layout.height) / size);
    const half = (size * big) / 2, m = layout.innerMargin;
    const front = {
      x: Math.min(layout.width - half - m, Math.max(half + m, layout.cx + (v.u - 0.5) * 0.45 * layout.width)),
      y: Math.min(layout.height - half * 0.95, Math.max(half + m, layout.cy + 0.16 * layout.height)),
    };
    const homeScale = depthScale(depth);
    const base = { soulId: id, key: v.key, config: s.config, badge: s.badge || null, label: s.label ?? null, greeting: s.greeting ?? null, size, detail: 'full', ring: p.ring, alpha: 1, depth: 2, phase: v.phase, t: v.t, hiS: v.hiS, act: null, visit: true };
    if (v.phase === 'hi') {
      const bob = Math.sin(TAU * v.hiT / 2.4) * 0.03 * size * big;
      const cfg = s.config;
      const now = visitActions(v.hiS).find((a) => v.hiT >= a.at && v.hiT < a.at + actionDuration(a.action));
      const act = now ? { action: now.action, t: v.hiT - now.at, side: actionSide(`${cfg.seed}:${v.key}:${now.action}`, { action: now.action, face: cfg.face }) } : null;
      return { ...base, x: front.x, y: front.y + bob, scale: big, act };
    }
    const e = easeInOut(v.t);
    const k = v.phase === 'out' ? e : 1 - e;           // 0 at home .. 1 at the front
    const lift = Math.sin(Math.PI * k) * 0.05 * layout.height;
    return { ...base, x: lerp(home.x, front.x, k), y: lerp(home.y, front.y, k) - lift, scale: lerp(homeScale, big, k) };
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
    setSouls, addSoul, queueHi, resize, frame, spritePx,
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
