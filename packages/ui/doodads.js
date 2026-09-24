// Sticker doodads - flat 2-tone space props with a white die-cut outline (art direction v2, docs/art/sticker-art-direction.md).
// Standalone ESM: no DOM, no imports; runs in browsers and Node >= 24. Same input -> byte-identical output.
//
// Rules: decorative only (aria-hidden), never carry text, never sit over text (placement is the apps' job:
// public Galaxy periphery on high tier, one rocket by the join orb and one planet on the employee waiting screens,
// none on the stage). Colours mirror design-tokens 1.2.0 --sticker-* (the module stays import-free).
//
//   import { doodadSvg, DOODAD_NAMES } from '/packages/ui/doodads.js';
//   host.innerHTML = doodadSvg('rocket', 48);                       // standalone <svg> string
//   <svg width="48" height="48"><use href="/assets/scene/doodads.svg#doodad-rocket"/></svg>   // from the sprite sheet
//
// The sprite sheet assets/scene/doodads.svg is generated from this module by tools/assets/build-scene.js
// (doodadSpriteSheet()), so the procedural fallback and the sprite are always the same drawing.

export const DOODADS_VERSION = '1.0.0';
export const DOODAD_VIEWBOX = 64;
export const DOODAD_NAMES = Object.freeze(['rocket', 'ufo', 'planet', 'comet', 'star', 'medallion']);
export const DOODAD_SYMBOL_PREFIX = 'doodad-';

const C = Object.freeze({
  navy: '#0B1030', space: '#151C48', lilac: '#8B7CF0', deep: '#3B2A7A', mint: '#7CF5C8', cyan: '#63E6FF',
  peach: '#FFB27A', gold: '#F6C453', rose: '#FF6FA5', outline: '#FFFFFF', lilacLight: '#CDB9FF', goldLight: '#FFF0B3',
});
const DIECUT_WIDTH = 6; // px at the 64 px reference size (3 px visible outside the silhouette); scales with size

function n(v) { return Number(v.toFixed(1)).toString(); }
function starPath(cx, cy, outer, inner, points = 5) {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    d += (i ? 'L' : 'M') + n(cx + r * Math.cos(a)) + ' ' + n(cy + r * Math.sin(a));
  }
  return d + 'Z';
}

// Each doodad = { sil: silhouette shapes without paint (the die-cut is drawn from them), art: painted shapes }.
const RING_BACK = 'M4 34A28 8.5 0 0 1 60 34', RING_FRONT = 'M4 34A28 8.5 0 0 0 60 34';
const DOODADS = Object.freeze({
  rocket: {
    sil: '<path d="M32 5C41 13 45 25 45 41H19C19 25 23 13 32 5Z"/><path d="M19 31L10 47H19Z"/><path d="M45 31L54 47H45Z"/><path d="M25 41L32 58L39 41Z"/>',
    art: `<path d="M32 5C41 13 45 25 45 41H19C19 25 23 13 32 5Z" fill="${C.lilac}"/><path d="M32 5C41 13 45 25 45 41H33V5Z" fill="${C.deep}" opacity=".55"/>` +
      `<path d="M32 5C36 9 39 14 40.5 20H23.5C25 14 28 9 32 5Z" fill="${C.rose}"/><path d="M19 31L10 47H19Z" fill="${C.rose}"/><path d="M45 31L54 47H45Z" fill="${C.rose}"/>` +
      `<path d="M25 41L32 58L39 41Z" fill="${C.gold}"/><path d="M28.5 41L32 50L35.5 41Z" fill="${C.peach}"/>` +
      `<circle cx="32" cy="29" r="5.5" fill="${C.cyan}" stroke="${C.outline}" stroke-width="1.6"/><circle cx="30.2" cy="27.2" r="1.3" fill="${C.outline}"/>`,
  },
  ufo: {
    sil: '<path d="M20 30A12 12 0 0 1 44 30Z"/><ellipse cx="32" cy="34" rx="27" ry="8"/>',
    art: `<path d="M20 30A12 12 0 0 1 44 30Z" fill="${C.cyan}"/><path d="M24 30A12 12 0 0 1 44 30Z" fill="${C.outline}" opacity=".35"/>` +
      `<ellipse cx="32" cy="34" rx="27" ry="8" fill="${C.lilac}"/><path d="M5 34A27 8 0 0 0 59 34Z" fill="${C.deep}" opacity=".55"/>` +
      `<circle cx="18" cy="35" r="2.4" fill="${C.gold}"/><circle cx="32" cy="38" r="2.4" fill="${C.gold}"/><circle cx="46" cy="35" r="2.4" fill="${C.gold}"/>` +
      `<path d="M26 44L22 56M38 44L42 56" stroke="${C.mint}" stroke-width="2" stroke-linecap="round" opacity=".8"/>`,
  },
  planet: {
    sil: `<path d="${RING_BACK}" fill="none" stroke-width="5" stroke-linecap="round" transform="rotate(-18 32 34)"/><circle cx="32" cy="32" r="16"/><path d="${RING_FRONT}" fill="none" stroke-width="5" stroke-linecap="round" transform="rotate(-18 32 34)"/>`,
    art: `<path d="${RING_BACK}" fill="none" stroke="${C.gold}" stroke-width="5" stroke-linecap="round" transform="rotate(-18 32 34)"/>` +
      `<circle cx="32" cy="32" r="16" fill="${C.peach}"/><path d="M20 40A16 16 0 0 0 48 32A13 13 0 0 1 20 40Z" fill="${C.rose}" opacity=".55"/>` +
      `<circle cx="25" cy="25" r="2.4" fill="${C.outline}" opacity=".7"/><circle cx="39" cy="22" r="1.4" fill="${C.outline}" opacity=".9"/>` +
      `<path d="${RING_FRONT}" fill="none" stroke="${C.gold}" stroke-width="5" stroke-linecap="round" transform="rotate(-18 32 34)"/>` +
      `<circle cx="27.5" cy="31" r="1.6" fill="${C.navy}"/><circle cx="36.5" cy="31" r="1.6" fill="${C.navy}"/><path d="M29.5 35.5Q32 38 34.5 35.5" fill="none" stroke="${C.navy}" stroke-width="1.5" stroke-linecap="round"/>`,
  },
  comet: {
    sil: '<path d="M38 24L4 42L40 34Z"/><path d="M42 30L14 58L46 38Z"/><circle cx="44" cy="22" r="10"/>',
    art: `<path d="M38 24L4 42L40 34Z" fill="${C.peach}"/><path d="M42 30L14 58L46 38Z" fill="${C.goldLight}"/>` +
      `<circle cx="44" cy="22" r="10" fill="${C.gold}"/><path d="M44 12A10 10 0 0 1 54 22A7 10 0 0 0 44 12Z" fill="${C.peach}" opacity=".7"/><circle cx="40" cy="18" r="2.6" fill="${C.outline}" opacity=".85"/>`,
  },
  star: {
    sil: `<path d="${starPath(32, 33, 26, 11)}"/>`,
    art: `<path d="${starPath(32, 33, 26, 11)}" fill="${C.gold}"/><path d="${starPath(32, 33, 26, 11)}" fill="${C.peach}" opacity=".45" clip-path="inset(0 0 0 50%)"/>` +
      `<path d="${starPath(28, 30, 9, 4)}" fill="${C.goldLight}" opacity=".85"/>`,
  },
  medallion: {
    sil: '<circle cx="32" cy="32" r="27"/>',
    art: `<circle cx="32" cy="32" r="27" fill="${C.deep}"/><circle cx="32" cy="32" r="21" fill="none" stroke="${C.lilac}" stroke-width="2"/>` +
      `<path d="M22 27L32 20L42 28L38 42L26 40Z" fill="none" stroke="${C.mint}" stroke-width="1.5" stroke-linejoin="round" opacity=".9"/>` +
      `<g fill="${C.cyan}"><circle cx="22" cy="27" r="2.2"/><circle cx="32" cy="20" r="2.2"/><circle cx="42" cy="28" r="2.2"/><circle cx="38" cy="42" r="2.2"/><circle cx="26" cy="40" r="2.2"/></g>` +
      `<path d="${starPath(32, 32, 4, 1.6)}" fill="${C.goldLight}"/>`,
  },
});

function dieCut(sil) {
  return `<g fill="${C.outline}" stroke="${C.outline}" stroke-width="${DIECUT_WIDTH}" stroke-linejoin="round" stroke-linecap="round">${sil}</g>`;
}

/** Inner markup (die-cut + art) for one doodad; null for an unknown name. */
export function doodadInner(name) {
  const d = DOODADS[name];
  return d ? dieCut(d.sil) + d.art : null;
}

/**
 * Standalone decorative <svg> for a doodad. Returns null for an unknown name so callers can fall through.
 * @param {'rocket'|'ufo'|'planet'|'comet'|'star'|'medallion'} name
 * @param {number} size CSS px (square); viewBox is always 64
 */
export function doodadSvg(name, size = 48) {
  const inner = doodadInner(name);
  if (!inner) return null;
  const px = Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : 48;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DOODAD_VIEWBOX} ${DOODAD_VIEWBOX}" width="${px}" height="${px}" aria-hidden="true" focusable="false" class="doodad doodad--${name}" data-doodad="${name}">${inner}</svg>`;
}

/** `<symbol id="doodad-<name>">` for the sprite sheet. */
export function doodadSymbol(name) {
  const inner = doodadInner(name);
  return inner ? `<symbol id="${DOODAD_SYMBOL_PREFIX}${name}" viewBox="0 0 ${DOODAD_VIEWBOX} ${DOODAD_VIEWBOX}">${inner}</symbol>` : null;
}

/** The whole sprite sheet (assets/scene/doodads.svg). Use with <use href="/assets/scene/doodads.svg#doodad-rocket">. */
export function doodadSpriteSheet() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" data-doodads="${DOODADS_VERSION}">` +
    `<defs>${DOODAD_NAMES.map(doodadSymbol).join('')}</defs></svg>\n`;
}

export default doodadSvg;
