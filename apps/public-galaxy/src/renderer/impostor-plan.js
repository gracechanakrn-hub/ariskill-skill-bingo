// Impostor and Float-entrance planning for decorated (v2 / v3) Souls on the public Galaxy (D-29 docs/art/
// soul-decorations.md "Public Galaxy", D-31). Pure ESM, Node-testable; impostor.js does the WebGL work.
//   - A settled decorated Soul is drawn from an atlas cell holding an impostor: the same 3D figure as the phone
//     (packages/ui/soul3d buildSoulRig + the card stage), rendered once and cached by soulId + badge + cell. Bakes run
//     a few per frame after the frame is drawn (a time budget, entrances first), never inside the measured render.
//   - A Float entrance shows the live 3D figure for its hero moment (P-05: animate once, then settle): it turns from
//     side-on to the rest pose along the arc, bobs gently, gets one die-cut flash at the pulse and is exactly at rest
//     (yaw 0, lift 0) through the settle, so the hand-off to the impostor is seamless.
//   - Live tiles (stage 15, D-36) also carry the Souls acting in orbit (idle micro actions) and the one Soul visiting
//     the front to say hi, in that priority after the entrances: every tile but the bake tile is live, a visit takes
//     a 2 x 2 block when one is free (it is drawn up to 3.2 x), and an item without a tile keeps its atlas sprite.
//   - v1 configs, 'dot' Souls and any failure keep the 2D composition (the renderer's SVG + sprites).
import { isDecoratedConfig } from '../../../../packages/ui/soul-renderer.js';

export const IMPOSTOR = Object.freeze({
  budgetMs: 6,          // bake time allowed after a frame (the Galaxy passes what is left of its frame budget)
  maxPerPump: 4,        // never more bakes than this in one pump, however fast they are
  minPerPump: 1,        // always make progress while jobs wait (even when one bake exceeds the budget)
  initTimeoutMs: 12000, // loader + baseline models + first compile; slower than this and the Galaxy stays 2D
  variantWaitMs: 9000,  // a body variant still loading this far into init counts as missing (it joins when it lands)
  decorWaitMs: 6000,    // a Soul whose charms / face have not landed by then is baked plain, then re-baked when they land
  stage: 768,           // square offscreen canvas: 3 x 3 tiles of 256 px (8 live tiles, 1 bake cell)
  tile: 256,
  bakeTile: 8,          // the bake cell's tile (bottom right)
  visitSpan: 2,         // a visit renders into a 2 x 2 block (512 px) when one is free, else into one tile
});

/** Live render roles in tile priority order: Float entrances, the say-hi visit, Souls acting in orbit. */
export const LIVE_ROLES = Object.freeze(['entrance', 'visit', 'performer']);
const TILES_PER_ROW = IMPOSTOR.stage / IMPOSTOR.tile;

/** The tiles a block covers: `span` x `span` tiles from its top-left tile `index` (null when it leaves the grid). */
export function blockTiles(index, span = 1, per = TILES_PER_ROW) {
  const col = index % per, row = Math.floor(index / per);
  if (col + span > per || row + span > per) return null;
  const out = [];
  for (let r = 0; r < span; r++) for (let c = 0; c < span; c++) out.push((row + r) * per + col + c);
  return out;
}

/**
 * Tiles for a new live item, given the tiles already `used`: span 1 takes the first free tile; span 2 takes the first
 * 2 x 2 block of free tiles, or else one tile. The bake tile is never live. Returns { index, span, tiles } or null.
 */
export function allocateLiveTile(used, span = 1, { per = TILES_PER_ROW, bakeTile = IMPOSTOR.bakeTile } = {}) {
  const taken = new Set(used); taken.add(bakeTile);
  if (span > 1) {
    for (let i = 0; i < per * per; i++) {
      const tiles = blockTiles(i, span, per);
      if (tiles && tiles.every((t) => !taken.has(t))) return { index: i, span, tiles };
    }
  }
  for (let i = 0; i < per * per; i++) if (!taken.has(i)) return { index: i, span: 1, tiles: [i] };
  return null;
}

/** True when a Galaxy item should be drawn from a 3D impostor (a decorated v2 / v3 config at a sprite level). */
export function wantsImpostor(soul, detail = 'simple') {
  return !!soul && detail !== 'dot' && isDecoratedConfig(soul.config);
}

/** Cache key of an impostor: the 3D Soul looks the same at every detail level, so only soul, badge and cell matter. */
export function impostorKey(soulId, badge, cell) { return `${soulId}|3d|${badge || ''}|${cell}`; }

/**
 * Tile rect in the stage canvas: { x, y (canvas px, top left), glY (GL px, bottom left), size }; `span` > 1 is a block
 * of span x span tiles from tile `index` (a visit), so the square may grow to span tiles.
 */
export function tileRect(index, { stage = IMPOSTOR.stage, tile = IMPOSTOR.tile, size = tile, span = 1 } = {}) {
  const per = Math.floor(stage / tile);
  const col = index % per, row = Math.floor(index / per);
  const s = Math.max(1, Math.min(tile * span, Math.round(size)));
  const x = col * tile, y = row * tile;
  return { x, y, glY: stage - y - s, size: s };
}
/** UV rect of a rendered tile square, in the Galaxy sprite batch order (u0, v0 = bottom, u1, v1 = top; flipY false). */
export function tileUv(rect, stage = IMPOSTOR.stage) {
  return { u0: rect.x / stage, v0: (rect.y + rect.size) / stage, u1: (rect.x + rect.size) / stage, v1: rect.y / stage };
}

/** Live entrance render size (device px) for a sprite `sizePx` at `scale`: supersampled like the atlas, capped by the tile. */
export function liveTileSize(sizePx, scale = 1, pixelRatio = 1, { supersample = 2, tile = IMPOSTOR.tile } = {}) { // D-57: matches ATLAS_SUPERSAMPLE
  const want = Math.ceil(Math.max(8, (Number(sizePx) || 0) * (Number(scale) || 1) * (Number(pixelRatio) || 1) * supersample));
  return Math.min(tile, want);
}

const ease = (t) => { const x = Math.min(1, Math.max(0, t)); return 1 - Math.pow(1 - x, 3); };

/** The entrance turn: the Soul arrives side-on (yaw offset) and turns to its rest pose by the end of the arc. */
export const ENTRANCE_POSE = Object.freeze({ turnRad: 1.25, bobAmplitude: 0.05, bobHz: 1.1, flashBoost: 0.7 });

/**
 * 3D pose for an entrance phase: { yaw (added to the rest yaw), lift (scene units), outline (die-cut multiplier) }.
 * phase 'arc' | 'pulse' | 'settle' | 'fade' | 'done' with t 0..1. The scene already moves, scales and fades the sprite;
 * this is only what a flat sprite cannot do. Reduced motion (and fade / settle / done): the rest pose.
 */
export function entrancePose(phase, t = 0, { reducedMotion = false } = {}) {
  const rest = { yaw: 0, lift: 0, outline: 1 };
  if (reducedMotion) return rest;
  const x = Math.min(1, Math.max(0, Number(t) || 0));
  if (phase === 'arc') {
    const e = ease(x);
    const bob = ENTRANCE_POSE.bobAmplitude * Math.sin(Math.PI * 2 * ENTRANCE_POSE.bobHz * x * 2.2) * (1 - e);
    return { yaw: ENTRANCE_POSE.turnRad * (1 - e), lift: bob, outline: 1 };
  }
  if (phase === 'pulse') return { yaw: 0, lift: 0, outline: 1 + ENTRANCE_POSE.flashBoost * Math.sin(Math.PI * x) }; // one die-cut flash
  return rest;
}

/**
 * Bake queue: one job per key, entrances (priority 1) before settled Souls (priority 0), FIFO within a priority.
 * take(isReady) removes and returns the next job whose decorations have settled (isReady(job) true), or null.
 */
export function createBakeQueue() {
  const jobs = new Map();       // key -> job (insertion order = FIFO)
  return {
    add(job) {
      const had = jobs.get(job.key);
      if (had) { had.priority = Math.max(had.priority || 0, job.priority || 0); return had; }
      jobs.set(job.key, job);
      return job;
    },
    has(key) { return jobs.has(key); },
    take(isReady = () => true) {
      let best = null;
      for (const j of jobs.values()) {
        if (!isReady(j)) continue;
        if (!best || (j.priority || 0) > (best.priority || 0)) best = j;
        if (best && (best.priority || 0) >= 1) break;
      }
      if (best) jobs.delete(best.key);
      return best;
    },
    drain() { const all = [...jobs.values()]; jobs.clear(); return all; },
    get size() { return jobs.size; },
  };
}

/** Pump budget after a frame that cost `frameMs`: what is left of `targetMs`, within [minMs, IMPOSTOR.budgetMs]. */
export function pumpBudget(frameMs, { targetMs = 12, minMs = 2 } = {}) {
  return Math.max(minMs, Math.min(IMPOSTOR.budgetMs, targetMs - (Number(frameMs) || 0)));
}
