// Quality table for the Three.js renderer (pure, Node-testable). scene-config#performance still decides star
// layers, rings, twinkle and the entrance trail; this table adds what only the Three path has: resolution
// scale and bloom parameters (off on `low`). The space backdrop's own rule (space.js): no falling stars and no meteor
// spin on `low`.
export const THREE_QUALITY = Object.freeze({
  high: { resolutionScale: 1.0, maxPixelRatio: 2, bloom: { strength: 0.62, radius: 0.55, threshold: 0.58 } },
  medium: { resolutionScale: 0.85, maxPixelRatio: 1.5, bloom: { strength: 0.52, radius: 0.5, threshold: 0.62 } },
  low: { resolutionScale: 0.7, maxPixelRatio: 1, bloom: null },
});

/** Transient bloom bumps (strength added to the base, decaying linearly). Flash safety: single, non-repeating. */
export const BLOOM_PULSE = Object.freeze({ entrance: 0.45, winner: 0.3 });

/**
 * A Bingo winner on the big screen (stage 15, D-36, with the gold crown of packages/ui/soul3d/winner.js): drawn `scale`
 * times its size in a gold glow `halo` sizes wide (colour `rgb`, opacity `alpha`, brighter during the outline flash),
 * laid under its own palette light, so it stands out in the crowd. An owner-approved exception to BR-17's equal size and
 * brightness, scoped to the winner on this screen; the phone and the 2D fallback tiers keep every Soul equal.
 */
export const WINNER_LOOK = Object.freeze({ scale: 1.3, halo: 3.4, rgb: Object.freeze([1.0, 0.76, 0.28]), alpha: 0.72 });

export function qualitySettings(quality) { return THREE_QUALITY[quality] || THREE_QUALITY.high; }

/** Effective renderer pixel ratio for a quality level. */
export function pixelRatioFor(quality, dpr = 1) {
  const s = qualitySettings(quality);
  return Math.max(0.5, Math.min(Number(dpr) || 1, s.maxPixelRatio) * s.resolutionScale);
}

/** Bloom strength for a level with an optional transient boost; 0 means the pass is disabled. */
export function bloomStrength(quality, boost = 0) {
  const s = qualitySettings(quality);
  if (!s.bloom) return 0;
  return s.bloom.strength + Math.max(0, Math.min(1, boost));
}

/** Linear decay of a pulse started at `startMs` with duration `durationMs` (0 when finished). */
export function pulseValue(peak, startMs, durationMs, nowMs) {
  if (!Number.isFinite(startMs) || durationMs <= 0) return 0;
  const t = (nowMs - startMs) / durationMs;
  if (t < 0 || t >= 1) return 0;
  return peak * (1 - t);
}

/** Winner outline flash on the winning Souls (art direction v2): 250 ms, held for 60 % then eased out = one
 * luminance flip (flash-safety: never repeated, never faster than the winner cadence). */
export const OUTLINE_FLASH = Object.freeze({ ms: 250, hold: 0.6 });

/** Flash amount 0..1 at `nowMs` for a flash started at `startMs` (0 before the start and after `ms`). */
export function outlineFlash(startMs, nowMs, flash = OUTLINE_FLASH) {
  if (!Number.isFinite(startMs) || !(flash.ms > 0)) return 0;
  const t = (nowMs - startMs) / flash.ms;
  if (t < 0 || t >= 1) return 0;
  if (t <= flash.hold) return 1;
  return 1 - (t - flash.hold) / (1 - flash.hold);
}

/** Die-cut hull width on screen (px) for a sprite `sizePx` tall: the 3D spec's 1.06 inverted hull (3 % radius),
 * floored so the outline still reads at 26 px cluster-era sprites and capped so 72 px Souls stay stickers, not blobs. */
export const HULL = Object.freeze({ ratio: 0.045, minPx: 1.5, maxPx: 4.5, flashScale: 2.0 });
export function hullPx(sizePx) { return Math.max(HULL.minPx, Math.min(HULL.maxPx, (Number(sizePx) || 0) * HULL.ratio)); }
