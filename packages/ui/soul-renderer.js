// Arise Soul renderer v2 - deterministic modular SVG sprites in the "Arise Soul x AriSkill" sticker language
// (workflow stage 3.2 + stage 10 / D-25, BR-16/BR-17; spec: docs/art/sticker-art-direction.md "Soul renderer spec").
// Standalone ESM: no DOM, no imports; runs in browsers and Node >= 24. Same input -> byte-identical output.
//
// Inclusivity invariants (see docs/art/soul-system.md):
//   - every Soul is drawn in the same 200x200 viewBox at the same silhouette scale;
//   - the eight palettes sit in one luminance band; glow variants have equal peak opacity;
//   - constellation glyphs are all the same size (weight only orders their placement);
//   - speckle count/size/colour come from the seed only, never from any input that could rank;
//   - Platform, Role, matrix alignment and winner status are NOT inputs (the badge is a separate flag).
//
// v2 look (all detail levels except 'dot'): radial clay gradient body (palette light top-left -> base -> violet-deep at the
// bottom edge), peach rim light lower-right, blurred top highlight, 9-14 seeded speckles clipped to the body, glowing antenna
// orb, white die-cut outline + soft shadow behind the whole figure. 'simple' keeps the die-cut at 3 px (at 240 px) and drops
// every filter (no blur, flat offset shadow) so thumbnails and the Galaxy atlas stay cheap.

export const SOUL_RENDERER_VERSION = '2.0.0';
export const VIEWBOX = 200;

/** Sticker constants mirrored from design-tokens 1.2.0 (--sticker-*); the renderer stays import-free. Tested for parity. */
export const STICKER = Object.freeze({
  outline: '#FFFFFF', violetDeep: '#3B2A7A', peach: '#FFB27A', gold: '#F6C453', rose: '#FF6FA5', navy: '#0B1030',
  shadow: { dy: 6, blur: 14, color: '#05081E', opacity: 0.55 }, // "0 6px 14px rgba(5, 8, 30, .55)" at a 240 px Soul
  speckle: ['#7CF5C8', '#63E6FF', '#D9CDFF'], // mint, cyan, lilac tint (light lilac so it reads on the lilac body base)
});
// Die-cut widths in px at the 240 px reference size (viewBox 200 => 1 px = 0.8333 units). Stroke is centred on the
// silhouette, so the visible band outside the body is half the stroke width.
const REF_PX = 200 / 240;
const DIECUT_FULL = 6 * REF_PX * 2;   // 6 px outside the body
const DIECUT_SIMPLE = 3 * REF_PX * 2; // 3 px outside the body

export const TRAITS = Object.freeze({
  body: ['drop', 'bell', 'cloud', 'pebble', 'flame', 'bean'],
  palette: ['aurora', 'lagoon', 'sunset', 'orchid', 'mint', 'coral', 'sky', 'lilac'],
  eyes: ['dot', 'star', 'sleepy', 'wide', 'wink', 'sparkle'],
  antenna: ['orb', 'ring', 'leaf', 'spark', 'none', 'twin'],
  mouth: ['smile', 'open', 'tiny', 'none'],
  glow: ['soft', 'ring', 'halo'],
});

/** Eight equal-value palettes: fill (body), highlight (face/belly/antenna), outline (thick soft line), glow (ambient). */
export const PALETTES = Object.freeze([
  { name: 'aurora', fill: '#74D6C8', highlight: '#E3FFF8', outline: '#2A5AA6', glow: '#72E8CF' },
  { name: 'lagoon', fill: '#7CC8FF', highlight: '#E9F6FF', outline: '#2E4DB8', glow: '#82D9FF' },
  { name: 'sunset', fill: '#FFB58C', highlight: '#FFEBDD', outline: '#A8436E', glow: '#FFB07C' },
  { name: 'orchid', fill: '#E3A3F2', highlight: '#FAE8FF', outline: '#6E3AB8', glow: '#E69EFF' },
  { name: 'mint',   fill: '#95DE95', highlight: '#EEFFEC', outline: '#2C7F66', glow: '#98F0A4' },
  { name: 'coral',  fill: '#FFA0A8', highlight: '#FFE6E8', outline: '#A3376A', glow: '#FF9EB4' },
  { name: 'sky',    fill: '#A3B8FF', highlight: '#EEF1FF', outline: '#3A44A8', glow: '#A9BEFF' },
  { name: 'lilac',  fill: '#CDB9FF', highlight: '#F4EEFF', outline: '#5D3FA6', glow: '#D0BCFF' },
]);

/** Outer silhouettes. Head bulb centred at (100,84) r~32 in every body; hem at y=170; x within 48..152. */
export const BODY_PATHS = Object.freeze({
  drop:   'M100 52C118 52 129 66 131 84C133 102 142 124 142 146C142 164 122 170 100 170C78 170 58 164 58 146C58 124 67 102 69 84C71 66 82 52 100 52Z',
  bell:   'M100 54C119 54 130 68 130 88C130 104 128 120 132 134C138 150 150 156 154 166C155 170 146 171 100 171C54 171 45 170 46 166C50 156 62 150 68 134C72 120 70 104 70 88C70 68 81 54 100 54Z',
  cloud:  'M100 52C120 52 132 66 132 84C142 86 152 98 150 112C160 122 158 142 146 150C150 164 134 172 120 168C110 176 90 176 80 168C66 172 50 164 54 150C42 142 40 122 50 112C48 98 58 86 68 84C68 66 80 52 100 52Z',
  pebble: 'M100 56C126 56 140 74 138 94C152 104 156 132 148 152C140 168 118 172 100 172C82 172 60 168 52 152C44 132 48 104 62 94C60 74 74 56 100 56Z',
  flame:  'M100 52C114 50 124 60 128 74C136 82 130 92 140 100C150 112 144 120 150 136C154 152 144 164 130 168C118 172 108 166 100 170C92 166 82 172 70 168C56 164 46 152 50 136C56 120 50 112 60 100C70 92 64 82 72 74C76 62 82 54 90 54C86 46 84 40 88 34C94 38 96 46 100 52Z',
  bean:   'M100 54C120 54 132 68 132 88C134 106 152 116 156 138C160 158 146 172 128 170C114 168 108 160 96 160C84 160 72 170 60 168C46 166 42 150 50 138C58 126 70 118 70 100C68 74 80 54 100 54Z',
});

/** Orbit rings: radius as a fraction of the Galaxy half-height; capacity = evenly spaced slots. */
export const ORBIT_RINGS = Object.freeze([
  { ring: 0, radius: 0.12, capacity: 6 },
  { ring: 1, radius: 0.22, capacity: 14 },
  { ring: 2, radius: 0.32, capacity: 24 },
  { ring: 3, radius: 0.42, capacity: 36 },
  { ring: 4, radius: 0.52, capacity: 52 },
  { ring: 5, radius: 0.62, capacity: 72 },
  { ring: 6, radius: 0.72, capacity: 96 },
  { ring: 7, radius: 0.82, capacity: 128 },
  { ring: 8, radius: 0.92, capacity: 160 },
]);
export const ORBIT_CAPACITY = ORBIT_RINGS.reduce((a, r) => a + r.capacity, 0);

// ---------- helpers ----------

/** Small deterministic 32-bit string hash (FNV-1a with a final avalanche). Own implementation, no imports. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}

function traitName(kind, value) {
  const list = TRAITS[kind];
  if (typeof value === 'string' && list.includes(value)) return value;
  const i = Number.isInteger(value) ? value : 0;
  return list[((i % list.length) + list.length) % list.length];
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
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
function twinkle(cx, cy, r) { // 4-point soft sparkle
  const q = r * 0.22;
  return `M${n(cx)} ${n(cy - r)}Q${n(cx + q)} ${n(cy - q)} ${n(cx + r)} ${n(cy)}Q${n(cx + q)} ${n(cy + q)} ${n(cx)} ${n(cy + r)}Q${n(cx - q)} ${n(cy + q)} ${n(cx - r)} ${n(cy)}Q${n(cx - q)} ${n(cy - q)} ${n(cx)} ${n(cy - r)}Z`;
}

/** Normalised config: trait names + palette object. Accepts indices or names. */
export function resolveSoul(config = {}) {
  const c = config || {};
  const body = traitName('body', c.body), palette = traitName('palette', c.palette), eyes = traitName('eyes', c.eyes);
  const antenna = traitName('antenna', c.antenna), mouth = traitName('mouth', c.mouth), glow = traitName('glow', c.glow);
  const pal = PALETTES[TRAITS.palette.indexOf(palette)];
  const constellation = Array.isArray(c.constellation) ? c.constellation.slice(0, 5) : [];
  const driftPhase = typeof c.driftPhase === 'number' && Number.isFinite(c.driftPhase) ? Math.min(1, Math.max(0, c.driftPhase)) : 0;
  return { seed: String(c.seed ?? 'soul'), body, palette, eyes, antenna, mouth, glow, pal, constellation, driftPhase };
}

/** Accessible description. Never mentions Platform, Role, rank or capability. */
export function soulAltText(config, badge = null) {
  const s = resolveSoul(config);
  let t = `Arise Soul, ${s.palette} ${s.body} with ${s.eyes} eyes`;
  if (badge === 'bingo-star') t += '. Bingo Star badge: completed a line this round';
  return t;
}

// ---------- parts ----------

const EYE_L = 89, EYE_R = 111, EYE_Y = 83;

function eyesSvg(kind, pal) {
  const o = pal.outline;
  const dot = (cx) => `<circle cx="${cx}" cy="${EYE_Y}" r="5" fill="${o}"/>`;
  switch (kind) {
    case 'dot': return dot(EYE_L) + dot(EYE_R);
    case 'star': return `<path d="${starPath(EYE_L, EYE_Y, 7.6, 3.4)}" fill="${o}"/><path d="${starPath(EYE_R, EYE_Y, 7.6, 3.4)}" fill="${o}"/>`;
    case 'sleepy': {
      const lid = (cx) => `<path d="M${cx - 6} ${EYE_Y - 1}A6 6 0 0 0 ${cx + 6} ${EYE_Y - 1}Z" fill="${o}"/><path d="M${cx - 7} ${EYE_Y - 2}Q${cx} ${EYE_Y - 6} ${cx + 7} ${EYE_Y - 2}" fill="none" stroke="${o}" stroke-width="2.4" stroke-linecap="round"/>`;
      return lid(EYE_L) + lid(EYE_R);
    }
    case 'wide': {
      const eye = (cx) => `<circle cx="${cx}" cy="${EYE_Y}" r="7.5" fill="#fff" stroke="${o}" stroke-width="1.8"/><circle cx="${cx}" cy="${EYE_Y + 0.5}" r="4.4" fill="${o}"/><circle cx="${cx - 1.6}" cy="${EYE_Y - 1.4}" r="1.5" fill="#fff"/>`;
      return eye(EYE_L) + eye(EYE_R);
    }
    case 'wink': return dot(EYE_L) + `<path d="M${EYE_R - 6} ${EYE_Y + 1}Q${EYE_R} ${EYE_Y - 6} ${EYE_R + 6} ${EYE_Y + 1}" fill="none" stroke="${o}" stroke-width="3" stroke-linecap="round"/>`;
    case 'sparkle': {
      const eye = (cx) => `<circle cx="${cx}" cy="${EYE_Y}" r="5" fill="${o}"/><circle cx="${cx - 1.7}" cy="${EYE_Y - 1.6}" r="1.6" fill="#fff"/><path d="${twinkle(cx + (cx < 100 ? -8 : 8), EYE_Y - 8, 3.6)}" fill="${o}" opacity=".9"/>`;
      return eye(EYE_L) + eye(EYE_R);
    }
    default: return dot(EYE_L) + dot(EYE_R);
  }
}

function mouthSvg(kind, pal) {
  const o = pal.outline;
  switch (kind) {
    case 'smile': return `<path d="M93 94Q100 102 107 94" fill="none" stroke="${o}" stroke-width="2.6" stroke-linecap="round"/>`;
    case 'open': return `<ellipse cx="100" cy="96.5" rx="3.8" ry="4.8" fill="${o}"/>`;
    case 'tiny': return `<circle cx="100" cy="96" r="1.9" fill="${o}"/>`;
    default: return '';
  }
}

/** Antenna silhouette (no fill/stroke attributes) - reused by the die-cut. Same geometry as antennaSvg. */
function antennaSil(kind) {
  const stalk = '<path d="M100 56V40"/>';
  switch (kind) {
    case 'orb': return stalk + '<circle cx="100" cy="35" r="6.5"/>';
    case 'ring': return stalk + '<circle cx="100" cy="35" r="7"/>';
    case 'leaf': return '<path d="M100 56C100 46 104 38 100 40"/><path d="M100 44C100 32 108 26 118 26C118 38 112 46 100 44Z"/>';
    case 'spark': return stalk + `<path d="${twinkle(100, 33, 10)}"/>`;
    case 'twin': return '<path d="M96 57C94 50 90 45 85 41M104 57C106 50 110 45 115 41"/><circle cx="84" cy="38" r="4.5"/><circle cx="116" cy="38" r="4.5"/>';
    default: return '';
  }
}

/** Antenna with the lit orb: 3-stop glow (white core -> palette light -> transparent) behind every orb + a 2 px outline. */
function antennaSvg(kind, pal, id) {
  const o = pal.outline, f = pal.fill, g = `url(#${id}-o)`;
  const stalk = `<path d="M100 56V40" stroke="${o}" stroke-width="3" stroke-linecap="round"/>`;
  const orb = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${n(r * 2)}" fill="${g}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${o}" stroke-width="1.7"/>`;
  switch (kind) {
    case 'orb': return stalk + orb(100, 35, 6.5) + '<circle cx="97.8" cy="32.8" r="1.6" fill="#fff"/>';
    case 'ring': return stalk + `<circle cx="100" cy="35" r="9" fill="${g}"/><circle cx="100" cy="35" r="7" fill="none" stroke="${o}" stroke-width="2.8"/><circle cx="100" cy="35" r="2.2" fill="#fff" stroke="${o}" stroke-width="1"/>`;
    case 'leaf': return `<path d="M100 56C100 46 104 38 100 40" fill="none" stroke="${o}" stroke-width="3" stroke-linecap="round"/><path d="M100 44C100 32 108 26 118 26C118 38 112 46 100 44Z" fill="${f}" stroke="${o}" stroke-width="2.4" stroke-linejoin="round"/><path d="M102 42L114 30" stroke="${o}" stroke-width="1.4" stroke-linecap="round"/>`;
    case 'spark': return stalk + `<circle cx="100" cy="33" r="14" fill="${g}"/><path d="${twinkle(100, 33, 10)}" fill="${pal.highlight}" stroke="${o}" stroke-width="1.7" stroke-linejoin="round"/>`;
    case 'twin': return `<path d="M96 57C94 50 90 45 85 41M104 57C106 50 110 45 115 41" fill="none" stroke="${o}" stroke-width="3" stroke-linecap="round"/>` + orb(84, 38, 4.5) + orb(116, 38, 4.5);
    default: return '';
  }
}

function glowSvg(kind, pal, id, motion, phase) {
  const anim = motion ? `<animate attributeName="opacity" values=".78;1;.78" dur="4.8s" begin="-${n(phase * 4.8)}s" repeatCount="indefinite"/>` : '';
  let s = `<circle cx="100" cy="112" r="86" fill="url(#${id}-g)">${anim}</circle>`;
  if (kind === 'ring') s += `<circle cx="100" cy="112" r="80" fill="none" stroke="${pal.glow}" stroke-width="1.6" stroke-dasharray="10 6" opacity=".42"/>`;
  if (kind === 'halo') s += `<ellipse cx="100" cy="21" rx="24" ry="5.5" fill="none" stroke="${pal.highlight}" stroke-width="3" opacity=".85"/>`;
  return s;
}

const GLYPH_KINDS = ['dot', 'diamond', 'star', 'ring'];
const CONST_ANGLES = [-52, 52, -104, 104, 180]; // degrees from top, clockwise; rank order = weight order

function constellationSvg(items, pal) {
  if (!items.length) return '';
  const sorted = items.slice().sort((a, b) => (b.weight || 0) - (a.weight || 0) || String(a.domain).localeCompare(String(b.domain)));
  let s = '';
  sorted.slice(0, 5).forEach((it, i) => {
    const a = (CONST_ANGLES[i] * Math.PI) / 180;
    const cx = 100 + 84 * Math.sin(a), cy = 112 - 84 * Math.cos(a);
    const kind = GLYPH_KINDS[hash32('domain:' + String(it.domain)) % GLYPH_KINDS.length];
    const h = pal.highlight, g = pal.glow;
    if (kind === 'dot') s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="3.2" fill="${h}" stroke="${g}" stroke-width="2" stroke-opacity=".6"/>`;
    else if (kind === 'diamond') s += `<path d="M${n(cx)} ${n(cy - 4.5)}L${n(cx + 4.5)} ${n(cy)}L${n(cx)} ${n(cy + 4.5)}L${n(cx - 4.5)} ${n(cy)}Z" fill="${h}" stroke="${g}" stroke-width="2" stroke-opacity=".6"/>`;
    else if (kind === 'star') s += `<path d="${twinkle(cx, cy, 5.5)}" fill="${h}" stroke="${g}" stroke-width="1.5" stroke-opacity=".6"/>`;
    else s += `<circle cx="${n(cx)}" cy="${n(cy)}" r="3.6" fill="none" stroke="${h}" stroke-width="2.2"/>`;
  });
  return s;
}

export const BADGE_LABEL = 'Bingo Star badge: completed a line this round';
/** Bingo Star: gold five-point star with a white die-cut outline, upper right, clear of the face and the antenna. */
export const BADGE_CENTER = Object.freeze({ cx: 166, cy: 38, r: 13 });
function badgeSvg() {
  const { cx, cy, r } = BADGE_CENTER;
  return `<g role="img" aria-label="${BADGE_LABEL}" transform="translate(${cx} ${cy})"><title>${BADGE_LABEL}</title><path d="${starPath(0, 0.6, r, r * 0.46)}" fill="${STICKER.gold}" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="${starPath(-1.4, -1, 6.2, 2.8)}" fill="#FFF0B3" opacity=".75"/></g>`;
}

const HEART = 'M100 150C91 143 87 138 87 133C87 128.5 90.5 126 94 126C96.8 126 98.8 127.5 100 130C101.2 127.5 103.2 126 106 126C109.5 126 113 128.5 113 133C113 138 109 143 100 150Z';

// ---------- speckles ----------

/** 9-14 seeded bubble speckles (two sizes, mint/cyan/lilac) placed in the head bulb or the lower mass; clipped to the body. */
function speckles(seed, blurred, id) {
  const r01 = (i, salt) => hash32(`${seed}:sp:${i}:${salt}`) / 4294967296;
  const count = 9 + (hash32(`${seed}:sp:n`) % 6);
  const by = [[], [], []];
  for (let i = 0; i < count; i++) {
    let cx, cy;
    if (r01(i, 'z') < 0.42) { // head bulb: centre (100,84) r 32
      const a = r01(i, 'a') * Math.PI * 2, rr = Math.sqrt(r01(i, 'r')) * 29;
      cx = 100 + rr * Math.cos(a); cy = 84 + rr * Math.sin(a);
    } else { // lower mass, widening toward the hem
      cy = 108 + r01(i, 'y') * 56;
      const half = 28 + ((cy - 108) / 56) * 14;
      cx = 100 + (r01(i, 'x') * 2 - 1) * half;
    }
    const big = r01(i, 's') < 0.35;
    const r = big ? 5 + r01(i, 'q') * 1.7 : 2.5 + r01(i, 'q') * 0.8; // 6-8 px / 3-4 px at 240 px
    by[hash32(`${seed}:sp:${i}:c`) % 3].push(`<circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${n(r)}"/>`);
  }
  const groups = by.map((list, k) => (list.length ? `<g fill="${STICKER.speckle[k]}">${list.join('')}</g>` : '')).join('');
  return `<g clip-path="url(#${id}-c)"${blurred ? ` filter="url(#${id}-k)"` : ''}>${groups}</g>`;
}

// ---------- main ----------

/**
 * Render a Soul as a complete <svg> string.
 * @param {object} config SoulConfig (indices or names) - see packages/game-rules/src/soul.js
 * @param {object} opts { size=160, badge=null|'bingo-star', detail='full'|'simple'|'dot', reducedMotion=false, label=null, idPrefix }
 *   size          CSS px of the square output (viewBox is always 200); the die-cut and shadow scale with it.
 *   badge         'bingo-star' draws the gold star (upper right); never part of the config (BR-17).
 *   detail        'full' = gradients, filters (highlight blur, speckle blur, drop shadow), constellation, optional glow breath;
 *                 'simple' = same look without filters (3 px die-cut, flat offset shadow) for thumbnails / the Galaxy atlas;
 *                 'dot' = 24 px glowing disc for very dense Galaxies (no badge).
 *   reducedMotion removes the glow breath <animate>; label overrides the alt text; idPrefix namespaces defs ids.
 */
export function renderSoulSvg(config, opts = {}) {
  const { size = 160, badge = null, detail = 'full', reducedMotion = false, label = null, idPrefix } = opts;
  const s = resolveSoul(config);
  const pal = s.pal;
  const id = idPrefix || `soul-${s.seed.replace(/[^A-Za-z0-9_-]/g, '')}`;
  const alt = esc(label || soulAltText(config, detail === 'dot' ? null : badge)); // dot never draws the badge
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" width="${size}" height="${size}" role="img" aria-label="${alt}" data-soul="${esc(s.seed)}" data-detail="${detail}">`;

  if (detail === 'dot') {
    return open + `<defs><radialGradient id="${id}-g"><stop offset="0" stop-color="${pal.glow}" stop-opacity=".9"/><stop offset=".45" stop-color="${pal.glow}" stop-opacity=".35"/><stop offset="1" stop-color="${pal.glow}" stop-opacity="0"/></radialGradient></defs>` +
      `<circle cx="100" cy="100" r="90" fill="url(#${id}-g)"/><circle cx="100" cy="100" r="26" fill="${pal.fill}" stroke="${pal.outline}" stroke-width="6"/><circle cx="100" cy="100" r="11" fill="${pal.highlight}"/></svg>`;
  }

  const full = detail !== 'simple';
  const body = BODY_PATHS[s.body];
  const sh = STICKER.shadow, W = '#fff'; // short form of STICKER.outline (#FFFFFF) in the markup
  // defs: body path (reused by clip + die-cut + fill), clay gradient, rim gradient, orb glow, ambient glow, silhouette, filters
  let defs = `<defs><path id="${id}-p" d="${body}"/>` +
    `<clipPath id="${id}-c"><use href="#${id}-p"/></clipPath>` +
    `<radialGradient id="${id}-b" cx=".34" cy=".26" r=".95"><stop offset="0" stop-color="${pal.highlight}"/><stop offset=".3" stop-color="${pal.fill}"/><stop offset="1" stop-color="${STICKER.violetDeep}"/></radialGradient>` +
    `<linearGradient id="${id}-r" x2="1" y2="1"><stop offset=".45" stop-color="${STICKER.peach}" stop-opacity="0"/><stop offset="1" stop-color="${STICKER.peach}" stop-opacity=".4"/></linearGradient>` +
    `<radialGradient id="${id}-o"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="${pal.highlight}"/><stop offset="1" stop-color="${pal.highlight}" stop-opacity="0"/></radialGradient>` +
    `<g id="${id}-s"><use href="#${id}-p"/><ellipse cx="84" cy="168" rx="11" ry="8"/><ellipse cx="116" cy="168" rx="11" ry="8"/>${antennaSil(s.antenna)}</g>`;
  if (full) {
    defs += `<radialGradient id="${id}-g"><stop offset="0" stop-color="${pal.glow}" stop-opacity=".55"/><stop offset=".55" stop-color="${pal.glow}" stop-opacity=".18"/><stop offset="1" stop-color="${pal.glow}" stop-opacity="0"/></radialGradient>` +
      `<filter id="${id}-d" x="-.25" y="-.25" width="1.5" height="1.6"><feDropShadow dx="0" dy="${n(sh.dy * REF_PX)}" stdDeviation="${n((sh.blur / 2) * REF_PX)}" flood-color="${sh.color}" flood-opacity="${sh.opacity}"/></filter>` +
      `<filter id="${id}-h" x="-.3" y="-.6" width="1.6" height="2.2"><feGaussianBlur stdDeviation="${n(2 * REF_PX)}"/></filter>` +
      `<filter id="${id}-k"><feGaussianBlur stdDeviation=".5"/></filter>`;
  }
  defs += '</defs>';

  // die-cut: whole figure as a white stroke + shadow (full: soft drop shadow; simple: flat offset copy)
  const dieCut = full
    ? `<use href="#${id}-s" fill="${W}" stroke="${W}" stroke-width="${n(DIECUT_FULL)}" stroke-linejoin="round" filter="url(#${id}-d)"/>`
    : `<use href="#${id}-s" fill="${sh.color}" stroke="${sh.color}" stroke-width="${n(DIECUT_SIMPLE)}" stroke-linejoin="round" transform="translate(0 ${n(sh.dy * REF_PX)})" opacity=".45"/>` +
      `<use href="#${id}-s" fill="${W}" stroke="${W}" stroke-width="${n(DIECUT_SIMPLE)}" stroke-linejoin="round"/>`;
  const feet = `<ellipse cx="84" cy="168" rx="11" ry="8" fill="url(#${id}-b)" stroke="${pal.outline}" stroke-width="3.5"/><ellipse cx="116" cy="168" rx="11" ry="8" fill="url(#${id}-b)" stroke="${pal.outline}" stroke-width="3.5"/>`;
  const bodySvg = `<use href="#${id}-p" fill="url(#${id}-b)" stroke="${pal.outline}" stroke-width="4.5" stroke-linejoin="round"/>`;
  const rim = `<use href="#${id}-p" fill="none" stroke="url(#${id}-r)" stroke-width="${n(2 * REF_PX * 2)}" clip-path="url(#${id}-c)"/>`;
  const highlight = `<ellipse cx="80" cy="60" rx="13" ry="6.5" transform="rotate(-34 80 60)" fill="#fff" opacity=".22"${full ? ` filter="url(#${id}-h)"` : ''}/>`;
  const face = `<circle cx="100" cy="84" r="25" fill="${pal.highlight}"/>`;
  const belly = `<path d="${HEART}" fill="${STICKER.rose}" stroke="${W}" stroke-width="1.6" stroke-linejoin="round"/>`;
  const ambient = full ? glowSvg(s.glow, pal, id, !reducedMotion, s.driftPhase) + constellationSvg(s.constellation, pal) : '';

  return open + defs + ambient + dieCut + feet + bodySvg + speckles(s.seed, full, id) + rim + highlight + face + belly +
    antennaSvg(s.antenna, pal, id) + eyesSvg(s.eyes, pal) + mouthSvg(s.mouth, pal) + (badge === 'bingo-star' ? badgeSvg() : '') + '</svg>';
}

/**
 * Deterministic orbit slot for a Soul. `count` = number of Souls currently in the Galaxy (opens rings from the inside out).
 * Returns { ring, slot, capacity, radius, angle } - angle in radians, slot-centred with a small per-Soul jitter.
 */
export function soulOrbitSlot(soulId, count = 1) {
  const id = String(soulId);
  const need = Math.max(1, Math.floor(count) || 1);
  let active = 0, cum = 0;
  while (active < ORBIT_RINGS.length && cum < need) { cum += ORBIT_RINGS[active].capacity; active++; }
  const pick = hash32(id + ':ring') % cum;
  let ring = 0, acc = 0;
  for (let i = 0; i < active; i++) { acc += ORBIT_RINGS[i].capacity; if (pick < acc) { ring = i; break; } }
  const r = ORBIT_RINGS[ring];
  const slot = hash32(id + ':slot') % r.capacity;
  const jitter = ((hash32(id + ':jitter') % 1000) / 1000 - 0.5) * 0.5; // +-0.25 slot width
  const angle = ((slot + 0.5 + jitter) / r.capacity) * Math.PI * 2;
  return { ring, slot, capacity: r.capacity, radius: r.radius, angle };
}

export default renderSoulSvg;
