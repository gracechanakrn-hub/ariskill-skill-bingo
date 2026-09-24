// apps/employee-mobile/src/doodads.js - sticker doodads for the employee app (rocket parked by the join orb, ringed
// planet on the waiting screens). Flat two-tone fills, white die-cut outline, no text, creature face only on the
// planet. Inline SVG built here because packages/ui/doodads.js did not exist at integration time (see README);
// swap for the shared sprite when it lands. Placement rules live in src/backdrop-params.js (doodadPlan).
const NS = 'http://www.w3.org/2000/svg';
const C = { lilac: '#8B7CF0', deep: '#3B2A7A', rose: '#FF6FA5', cyan: '#63E6FF', gold: '#F6C453', peach: '#FFB27A', navy: '#0B1030', outline: '#FFFFFF', mint: '#7CF5C8' };

/** Element builder without innerHTML (CSP + XSS rules). */
function el(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) node.setAttribute(k, String(v));
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

/** Same shapes twice: first as a white expanded silhouette (the die-cut), then the coloured fills. */
function dieCut(shapes, width = 6) {
  const cut = el('g', { fill: C.outline, stroke: C.outline, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, ...shapes());
  return [cut, el('g', null, ...shapes())];
}

function rocketShapes() {
  return [
    el('path', { d: 'M32 5C41 13 45 25 45 41H19C19 25 23 13 32 5Z', fill: C.lilac }),
    el('path', { d: 'M32 5C41 13 45 25 45 41H33V5Z', fill: C.deep, opacity: '.55' }),
    el('path', { d: 'M32 5C36 9 39 14 40.5 20H23.5C25 14 28 9 32 5Z', fill: C.rose }),
    el('path', { d: 'M19 31L10 47H19Z', fill: C.rose }),
    el('path', { d: 'M45 31L54 47H45Z', fill: C.rose }),
    el('path', { d: 'M25 41L32 58L39 41Z', fill: C.gold }),
    el('path', { d: 'M28.5 41L32 50L35.5 41Z', fill: C.peach }),
    el('circle', { cx: 32, cy: 29, r: 5.5, fill: C.cyan }),
    el('circle', { cx: 32, cy: 29, r: 5.5, fill: 'none', stroke: C.outline, 'stroke-width': 1.6 }),
    el('circle', { cx: 30.2, cy: 27.2, r: 1.3, fill: C.outline }),
  ];
}

function planetShapes() {
  const ring = (d) => el('path', { d, fill: 'none', stroke: C.gold, 'stroke-width': 5, 'stroke-linecap': 'round', transform: 'rotate(-18 32 34)' });
  return [
    ring('M4 34A28 8.5 0 0 1 60 34'),                  // back half of the ring
    el('circle', { cx: 32, cy: 32, r: 16, fill: C.lilac }),
    el('path', { d: 'M20 40A16 16 0 0 0 48 32A13 13 0 0 1 20 40Z', fill: C.deep, opacity: '.5' }),
    el('circle', { cx: 25, cy: 25, r: 2.4, fill: C.outline, opacity: '.7' }),
    el('circle', { cx: 39, cy: 22, r: 1.4, fill: C.mint, opacity: '.9' }),
    ring('M4 34A28 8.5 0 0 0 60 34'),                  // front half of the ring
    el('circle', { cx: 27.5, cy: 31, r: 1.6, fill: C.navy }),
    el('circle', { cx: 36.5, cy: 31, r: 1.6, fill: C.navy }),
    el('path', { d: 'M29.5 35.5Q32 38 34.5 35.5', fill: 'none', stroke: C.navy, 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
  ];
}

/** doodad('rocket' | 'planet', { size }) -> <svg aria-hidden> (decorative; never carries text). */
export function doodad(kind, { size = 48 } = {}) {
  const shapes = kind === 'planet' ? planetShapes : rocketShapes;
  const svg = el('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': 'true', focusable: 'false', class: `doodad doodad--${kind}` });
  for (const g of dieCut(shapes)) svg.appendChild(g);
  return svg;
}
