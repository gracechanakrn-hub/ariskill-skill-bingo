// Soul renderer v4 drawing v1 configs (Arise Soul baseline, D-27): they render exactly as renderer 3.0.0 did - spec
// checks from docs/art/soul-baseline.md "Flat 2D Soul" and docs/art/sticker-art-direction.md "Soul renderer spec".
// The decorated v2 path (D-29) is covered by soul-renderer-v4.test.js.
// Run: node --test packages/ui/test   (the cohort/manifest checks live in tools/assets/test/souls.test.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSoulSvg, resolveSoul, soulAltText, TRAITS, PALETTES, BODY_PATHS, STICKER, EYE_WHITE, SOUL_RENDERER_VERSION, BADGE_LABEL, BADGE_CENTER } from '../soul-renderer.js';
import * as SHAPE from '../soul-baseline-shape.js';
import { soulSeed, soulConfigFromSeed, SOUL_TRAITS } from '../../game-rules/src/soul.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tokens = JSON.parse(readFileSync(join(ROOT, 'packages/design-tokens/tokens.json'), 'utf8')).themes.dark.tokens;
const CONST = [{ domain: 'Design', weight: 0.4 }, { domain: 'Cloud', weight: 0.3 }, { domain: 'Development', weight: 0.15 }];
const sample = { seed: 'abc123', body: 0, palette: 1, eyes: 0, antenna: 0, mouth: 0, glow: 0, constellation: CONST, driftPhase: 0.42 };
const MAX_BYTES = 6 * 1024;
const sha256 = (p) => createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex');

/** Absolute on-curve and control points of an 'M x y c ... z' path (the generated shape uses M/c/z only). */
function pathPoints(d) {
  const pts = [];
  let x = 0, y = 0;
  for (const [, cmd, args] of d.matchAll(/([Mcz])([^Mcz]*)/g)) {
    const v = (args.match(/-?(?:\d+\.?\d*|\.\d+)/g) || []).map(Number);
    if (cmd === 'M') { x = v[0]; y = v[1]; pts.push([x, y]); }
    if (cmd === 'c') for (let i = 0; i + 5 < v.length; i += 6) { pts.push([x + v[i], y + v[i + 1]], [x + v[i + 2], y + v[i + 3]]); x += v[i + 4]; y += v[i + 5]; pts.push([x, y]); }
  }
  return pts;
}

test('v1 configs: same config gives the same Soul, byte for byte, at every detail level and size', () => {
  assert.equal(SOUL_RENDERER_VERSION, '5.0.0');
  for (let i = 0; i < 40; i++) {
    const seed = soulSeed({ eventId: 'evt', participantId: `p${i}`, roundId: 'r1' });
    const cfg = soulConfigFromSeed(seed, { Design: 3, Cloud: 2 });
    for (const detail of ['full', 'simple', 'dot']) {
      const a = renderSoulSvg(cfg, { detail, badge: i % 3 ? null : 'bingo-star', size: 240 });
      const b = renderSoulSvg(JSON.parse(JSON.stringify(cfg)), { detail, badge: i % 3 ? null : 'bingo-star', size: 240 });
      assert.equal(a, b);
    }
  }
  // the seed only names the Soul (data-soul, default ids): with a fixed idPrefix two seeds draw the same character
  const x = renderSoulSvg({ ...sample, seed: 's1' }, { idPrefix: 'k', reducedMotion: true }), y = renderSoulSvg({ ...sample, seed: 's2' }, { idPrefix: 'k', reducedMotion: true });
  assert.notEqual(x, y);
  const noSeed = (s) => s.replace(/ data-soul="[^"]*"/, '');
  assert.equal(noSeed(x), noSeed(y));
});

test('v3 look: the 3D baseline front view - clay body, drips, button eyes, crease + slits, lit orb, highlight, white die-cut + shadow', () => {
  const svg = renderSoulSvg(sample, { reducedMotion: true, idPrefix: 'v' });
  const pal = PALETTES[1];
  assert.ok(svg.includes(`<path id="v-p" d="${SHAPE.SILHOUETTE}"/>`), 'silhouette = the generated front projection of the 3D model');
  assert.match(svg, /<radialGradient id="v-b"[^>]*><stop offset="\.05" stop-color="#E9F6FF"\/><stop offset="\.6" stop-color="#7CC8FF"\/><stop offset="1" stop-color="#3B2A7A"\/>/, '3-stop body gradient: palette light -> base -> violet-deep');
  assert.ok(svg.includes(`<use href="#v-p" fill="url(#v-b)" stroke="${pal.outline}" stroke-width="2.2" stroke-linejoin="round"/>`), 'body filled with the clay gradient, thin palette outline');
  assert.match(svg, /<linearGradient id="v-r"[^>]*><stop offset="\.45" stop-color="#FFB27A" stop-opacity="0"\/><stop offset="1" stop-color="#FFB27A" stop-opacity="\.4"\/>/, 'peach rim at 40 % on the lower right');
  // drips: every generated capsule, in the palette light with a soft edge, over a faint contact shade
  const q = svg.match(/<g id="v-q" stroke-linecap="round">(.*?)<\/g>/);
  assert.ok(q, 'drip strokes defined once');
  assert.equal((q[1].match(/<path /g) || []).length, SHAPE.DRIP_STROKES.length);
  for (const [w, d] of SHAPE.DRIP_STROKES) assert.ok(q[1].includes(`<path stroke-width="${w}" d="${d}"/>`));
  assert.ok(svg.includes(`<use href="#v-q" stroke="${pal.highlight}" filter="url(#v-k)"/>`), 'drips in the palette light, soft edge');
  assert.ok(svg.includes(`<use href="#v-q" stroke="${pal.outline}" opacity=".2" transform="translate(.4 1)"/>`), 'contact shade under the drips');
  assert.match(svg, /<filter id="v-k"><feGaussianBlur stdDeviation="\.3"\/><\/filter>/);
  // eyes: near-white disc + groove ring in the outline colour; the right eye mirrors the left about x = 100
  const e = SHAPE.EYES[0];
  assert.ok(svg.includes(`<g id="v-e" transform="translate(${e.cx} ${e.cy}) rotate(${e.rot})"><ellipse rx="${e.rx}" ry="${e.ry}" fill="${EYE_WHITE}"/><ellipse rx="${e.ring.rx}" ry="${e.ring.ry}" fill="none" stroke="${pal.outline}" stroke-width="1.3"/></g>`));
  assert.ok(svg.includes('<use href="#v-e" transform="matrix(-1 0 0 1 200 0)"/>'));
  assert.equal(EYE_WHITE, '#F7F8FF', 'docs/art/soul-baseline.md tint rule');
  // antenna orb: glow behind the sticker, palette light disc with a thin outline and a specular dot
  assert.match(svg, /<radialGradient id="v-o"><stop offset="0" stop-color="#fff"\/><stop offset="\.45" stop-color="#E9F6FF"\/><stop offset="1" stop-color="#E9F6FF" stop-opacity="0"\/>/, 'orb glow: white core, palette light, transparent');
  assert.ok(svg.includes(`<circle cx="${SHAPE.ORB.cx}" cy="${SHAPE.ORB.cy}" r="26" fill="url(#v-o)"/>`));
  assert.ok(svg.includes(`<circle cx="${SHAPE.ORB.cx}" cy="${SHAPE.ORB.cy}" r="${SHAPE.ORB.r}" fill="${pal.highlight}" stroke="${pal.outline}" stroke-width="1.6"/>`));
  // inner lines (chin crease + arm slits) as a soft fold shade; key-light highlight 30 % white, blurred
  assert.ok(svg.includes(`<path d="${SHAPE.LINES}" fill="none" stroke="${pal.outline}" stroke-width="4" stroke-linecap="round" opacity=".25" filter="url(#v-h)"/>`), 'fold shade, not a line');
  assert.match(svg, /<ellipse [^>]*fill="#fff" opacity="\.3" filter="url\(#v-h\)"\/>/);
  assert.match(svg, /<filter id="v-h"[^>]*><feGaussianBlur stdDeviation="1\.7"\/>/, 'highlight blur 2 px at 240 px');
  // sticker die-cut
  assert.match(svg, /<use href="#v-p" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round" filter="url\(#v-d\)"\/>/, 'die-cut: the whole figure as a white stroke (6 px outside at 240 px) with the sticker shadow');
  assert.match(svg, /<feDropShadow dx="0" dy="5" stdDeviation="5\.8" flood-color="#05081E" flood-opacity="0\.55"\/>/, '--sticker-shadow 0 6px 14px rgba(5,8,30,.55) scaled to the viewBox');
  // v2 parts are gone: no speckles, no heart belly, no trait eyes / mouth
  for (const c of [...STICKER.speckle, STICKER.rose]) assert.ok(!svg.includes(c), `no v2 colour ${c}`);
  assert.ok(!/stroke-dasharray|<text/.test(svg));
});

test('D-27: only palette, glow and the Bingo Star badge change the drawing', () => {
  const opts = { reducedMotion: true, idPrefix: 'u' };
  const ref = renderSoulSvg(sample, opts);
  for (const kind of ['body', 'eyes', 'antenna', 'mouth']) {
    for (let i = 0; i < TRAITS[kind].length; i++) assert.equal(renderSoulSvg({ ...sample, [kind]: i }, opts), ref, `${kind} ${TRAITS[kind][i]} is kept in the config but not drawn`);
  }
  for (const constellation of [[], CONST, [{ domain: 'Cloud', weight: 1 }]]) assert.equal(renderSoulSvg({ ...sample, constellation }, opts), ref, 'constellation is not drawn');
  assert.equal(renderSoulSvg({ ...sample, driftPhase: 0.9 }, opts), ref, 'driftPhase only offsets the glow breath');
  const palettes = new Set(TRAITS.palette.map((_, i) => renderSoulSvg({ ...sample, palette: i }, opts)));
  assert.equal(palettes.size, 8, 'every palette draws differently');
  const glows = new Set(TRAITS.glow.map((_, i) => renderSoulSvg({ ...sample, glow: i }, opts)));
  assert.equal(glows.size, 3, 'every glow style draws differently');
  assert.notEqual(renderSoulSvg(sample, { ...opts, badge: 'bingo-star' }), ref);
});

test('all 8 palettes x 3 glows x badge x motion render at 240 px full and 64 px simple: SVG only, no text, no rank marks, under 6 KB', () => {
  let max = 0;
  for (let p = 0; p < 8; p++) for (let g = 0; g < 3; g++) for (const badge of [null, 'bingo-star']) for (const reducedMotion of [false, true]) {
    for (const [detail, size] of [['full', 240], ['simple', 64]]) {
      const svg = renderSoulSvg({ ...sample, seed: soulSeed({ eventId: 'e', participantId: `p${p}${g}`, roundId: 'r' }), palette: p, glow: g }, { detail, size, badge, reducedMotion });
      assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"') && svg.includes(`width="${size}" height="${size}"`), 'output size/API unchanged');
      assert.ok(!/<text|<image|<foreignObject|<script|href="http|data:image|style=/.test(svg), 'no text, no raster, no inline style (CSP)');
      assert.ok(!/level|lv\.|rank|score|tier|unlock/i.test(svg.replace(/aria-label="[^"]*"/g, '')), 'no rank/level marks');
      max = Math.max(max, Buffer.byteLength(svg));
      assert.ok(Buffer.byteLength(svg) <= MAX_BYTES, `${detail} ${p}/${g}: ${Buffer.byteLength(svg)} bytes`);
      assert.ok(svg.includes(`fill="url(#`) && svg.includes(PALETTES[p].fill), 'palette base used');
      assert.ok(svg.includes(`stroke="${PALETTES[p].outline}" stroke-width="2.2"`), 'same body line weight for every Soul');
    }
  }
  assert.ok(max <= MAX_BYTES, `worst case ${max} bytes`);
});

test("detail 'simple': 3 px die-cut, no filters (crisp drips, flat offset shadow), still outlined, dripping and lit", () => {
  const simple = renderSoulSvg(sample, { detail: 'simple', badge: 'bingo-star', idPrefix: 's' });
  const full = renderSoulSvg(sample, { detail: 'full', badge: 'bingo-star', idPrefix: 's' });
  assert.ok(!simple.includes('<filter') && !simple.includes('filter=') && !simple.includes('<animate'));
  assert.match(simple, /<use href="#s-p" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round"\/>/, '3 px outside at 240 px');
  assert.match(simple, /<use href="#s-p" fill="#05081E" stroke="#05081E" stroke-width="5" stroke-linejoin="round" transform="translate\(0 5\)" opacity="\.45"\/>/, 'flat offset shadow');
  assert.ok(simple.includes(`<use href="#s-q" stroke="${PALETTES[1].highlight}"/>`), 'drips kept, crisp');
  assert.ok(simple.includes('fill="url(#s-o)"'), 'antenna orb still lit');
  assert.ok(simple.includes(`fill="${EYE_WHITE}"`), 'button eyes');
  assert.ok(simple.includes(BADGE_LABEL));
  assert.ok(simple.length < full.length);
  assert.ok(simple.includes('data-detail="simple"'));
  // dot is unchanged from v1 (24 px disc that always renders)
  const dot = renderSoulSvg(sample, { detail: 'dot', badge: 'bingo-star' });
  assert.ok(dot.length < 1024 && !dot.includes(BADGE_LABEL) && dot.includes('r="26"'));
});

test('Bingo Star badge: gold five-point star with a white outline, upper right, clear of the figure, semantics unchanged', () => {
  const svg = renderSoulSvg(sample, { badge: 'bingo-star' });
  assert.ok(svg.includes(`<g role="img" aria-label="${BADGE_LABEL}" transform="translate(${BADGE_CENTER.cx} ${BADGE_CENTER.cy})"><title>${BADGE_LABEL}</title>`));
  assert.match(svg, /<path d="M0 -12\.4L[^"]+Z" fill="#F6C453" stroke="#fff" stroke-width="2\.6" stroke-linejoin="round"\/>/);
  assert.deepEqual({ ...BADGE_CENTER }, { cx: 166, cy: 38, r: 13 }, 'badge position unchanged from v2');
  assert.ok(BADGE_CENTER.cx > SHAPE.ORB.cx && BADGE_CENTER.cy < SHAPE.EYES[0].cy, 'upper right, beside the antenna orb (3D badge_anchor side)');
  assert.ok(SHAPE.BADGE_ANCHOR.x > 100 && SHAPE.BADGE_ANCHOR.y < SHAPE.EYES[0].cy, '3D badge anchor is upper right as well');
  // clear of the figure: every silhouette point at the badge's height sits left of the badge minus both die-cuts
  const reach = BADGE_CENTER.r + 1.3 + 5;
  for (const [x, y] of pathPoints(SHAPE.SILHOUETTE)) if (Math.abs(y - BADGE_CENTER.cy) <= reach) assert.ok(x < BADGE_CENTER.cx - reach, `silhouette point (${x}, ${y}) under the badge`);
  assert.ok(Math.hypot(BADGE_CENTER.cx - SHAPE.ORB.cx, BADGE_CENTER.cy - SHAPE.ORB.cy) > BADGE_CENTER.r + SHAPE.ORB.r + 10, 'never touches the orb');
  assert.ok(BADGE_CENTER.cx + BADGE_CENTER.r <= 200 && BADGE_CENTER.cy - BADGE_CENTER.r >= 0);
  assert.ok(!renderSoulSvg(sample).includes(BADGE_LABEL));
  assert.equal(soulAltText(sample, 'bingo-star'), 'Arise Soul, lagoon colour, with round button eyes and a glowing antenna orb. Bingo Star badge: completed a line this round');
  // the badge is not part of the config and never changes the body
  const strip = (s) => s.replace(/<g role="img"[\s\S]*?<\/g>/, '').replace(/aria-label="[^"]*"/, '');
  assert.equal(strip(renderSoulSvg(sample, { badge: 'bingo-star', reducedMotion: true })), strip(renderSoulSvg(sample, { reducedMotion: true })));
});

test('universal and non-ranking: nothing depends on anything but palette, glow and the badge flag', () => {
  // resolveSoul ignores forbidden inputs entirely
  const a = resolveSoul({ ...sample, platformId: 'x', roleId: 'y', rank: 1, isWinner: true, score: 99 });
  const b = resolveSoul(sample);
  assert.deepEqual(a, b);
  assert.equal(renderSoulSvg({ ...sample, platformId: 'x', roleId: 'y', rank: 1, isWinner: true, score: 99 }), renderSoulSvg(sample));
  // every Soul gets the same figure, die-cut width, shadow, glow radius, highlight and line weights
  const figure = (s) => s.match(/<path id="u-p"[^>]*\/><g id="u-q"[\s\S]*?<\/g>/)[0];
  const ref = figure(renderSoulSvg(sample, { reducedMotion: true, idPrefix: 'u' }));
  for (const kind of Object.keys(TRAITS)) for (let i = 0; i < TRAITS[kind].length; i++) {
    const svg = renderSoulSvg({ ...sample, [kind]: i }, { reducedMotion: true, idPrefix: 'u' });
    assert.equal(figure(svg), ref, `${kind} ${i}: same figure`);
    assert.ok(svg.includes('stroke-width="10" stroke-linejoin="round" filter="url(#u-d)"'), `${kind} ${i}: same die-cut`);
    assert.ok(svg.includes('<circle cx="100" cy="108" r="86"'), `${kind} ${i}: same glow radius`);
    assert.ok(svg.includes(`<ellipse cx="${SHAPE.HIGHLIGHTS[0][0]}" cy="${SHAPE.HIGHLIGHTS[0][1]}"`), `${kind} ${i}: same highlight`);
  }
  // trait vocabulary still equals the locked game-rules vocabulary (seed -> config mapping untouched)
  for (const k of Object.keys(SOUL_TRAITS)) assert.deepEqual([...TRAITS[k]], [...SOUL_TRAITS[k]]);
  // the legacy v2 silhouettes stay exported (backward compatibility) but are never drawn
  assert.deepEqual(Object.keys(BODY_PATHS), [...TRAITS.body]);
  for (const d of Object.values(BODY_PATHS)) assert.ok(!renderSoulSvg(sample).includes(d));
});

test('baseline shape module: generated from the current 3D model, pure data, inside the viewBox, symmetric where the model is', () => {
  const src = readFileSync(join(ROOT, 'packages/ui/soul-baseline-shape.js'), 'utf8');
  assert.ok(src.startsWith('// GENERATED by tools/assets/build-soul-shape.py'), 'generated header');
  assert.ok(!/\bimport\b|\brequire\(/.test(src), 'pure data, no imports');
  assert.equal(SHAPE.SHAPE_SOURCE.generator, 'tools/assets/build-soul-shape.py');
  assert.equal(SHAPE.SHAPE_SOURCE.modelSha256, sha256(SHAPE.SHAPE_SOURCE.model), 'the 3D model changed: regenerate with Blender --background --factory-startup --python tools/assets/build-soul-shape.py');
  assert.equal(SHAPE.SHAPE_SOURCE.dripsSha256, sha256(SHAPE.SHAPE_SOURCE.drips), 'the drip list changed: regenerate the flat shape');
  // mapping and bounds: the figure (feet .. orb) is centred vertically and keeps a margin for die-cut, shadow and halo
  const { x0, y0, x1, y1 } = SHAPE.BOUNDS;
  assert.ok(x0 >= 40 && x1 <= 160 && y0 >= 16 && y1 <= 184, `bounds ${JSON.stringify(SHAPE.BOUNDS)}`);
  assert.ok(Math.abs((y0 + y1) / 2 - 100) <= 0.5 && Math.abs((x0 + x1) / 2 - 100) <= 3);
  assert.equal(SHAPE.MAPPING.cx, 100);
  const pts = pathPoints(SHAPE.SILHOUETTE);
  assert.ok(/^M[-\d. ]+(c[-\d. ]+)+z$/.test(SHAPE.SILHOUETTE), 'silhouette: M + relative cubics + z');
  const within = (m) => ([x, y]) => x >= x0 - m && x <= x1 + m && y >= y0 - m && y <= y1 + m;
  assert.ok(pts.filter((_, i) => i % 3 === 0).every(within(0.5)), 'on-curve points inside the bounds');
  assert.ok(pts.every(within(3)), 'control points hug the bounds');
  const last = pts[pts.length - 1];
  assert.ok(Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < 0.3, 'closed');
  assert.ok(/^(M[-\d. ]+(c[-\d. ]+)+)+$/.test(SHAPE.LINES), 'lines: open cubic strokes');
  for (const [w, d] of SHAPE.DRIP_STROKES) {
    assert.ok(w > 0 && w <= 12 && /^(M[-\d. ]+l[-\d. ]+)+$/.test(d), `drip stroke ${w}`);
    for (const m of d.matchAll(/l(-?[\d.]+)\s?(-?[\d.]+)/g)) assert.ok(Number(m[1]) !== 0 || Number(m[2]) !== 0, 'no zero-length drip');
  }
  assert.ok(SHAPE.DRIPS.length >= 15, `${SHAPE.DRIPS.length} drips seen from the front`);
  for (const [cx, cy] of SHAPE.DRIPS) assert.ok(cx > x0 && cx < x1 && cy > y0 && cy < y1);
  // eyes are mirror images (azimuth +-31.4 deg in the model), the antenna leans to the character's left (viewer's right)
  const [l, r] = SHAPE.EYES;
  assert.equal(r.cx, Number((200 - l.cx).toFixed(1))); assert.equal(r.cy, l.cy); assert.equal(r.rot, -l.rot);
  assert.deepEqual([r.rx, r.ry, r.ring.rx, r.ring.ry], [l.rx, l.ry, l.ring.rx, l.ring.ry]);
  assert.ok(l.ring.rx > l.rx && l.ring.ry > l.ry, 'groove ring outside the disc');
  assert.ok(SHAPE.ORB.cx > 100 && SHAPE.ORB.cy - SHAPE.ORB.r >= y0 - 0.5, 'orb at the top, leaning right');
  // every number is rounded to 0.1
  const data = src.split('\n').filter((line) => !line.includes('SHAPE_SOURCE') && !line.startsWith('//')).join('\n');
  for (const m of data.matchAll(/-?\d*\.\d+/g)) assert.ok(/^-?\d*\.\d$/.test(m[0]), `not rounded to 0.1: ${m[0]}`);
});

test('sticker constants mirror design-tokens 1.2.0 (renderer stays token-import-free)', () => {
  assert.equal(STICKER.outline, tokens['--sticker-outline']);
  assert.equal(STICKER.violetDeep, tokens['--sticker-violet-deep']);
  assert.equal(STICKER.peach, tokens['--sticker-peach']);
  assert.equal(STICKER.gold, tokens['--sticker-gold']);
  assert.equal(STICKER.rose, tokens['--sticker-rose']);
  assert.equal(STICKER.navy, tokens['--sticker-navy']);
  assert.equal(STICKER.speckle[0], tokens['--sticker-mint']);
  assert.equal(STICKER.speckle[1], tokens['--sticker-cyan']);
  assert.equal(tokens['--sticker-shadow'], `0 ${STICKER.shadow.dy}px ${STICKER.shadow.blur}px rgba(5, 8, 30, ${STICKER.shadow.opacity})`);
});
