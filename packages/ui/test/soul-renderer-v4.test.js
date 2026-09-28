// Soul renderer v4 (D-29, docs/art/soul-decorations.md "Colour" and "Rendering: one Soul everywhere"): decorated v2
// Souls in 2D - the body gradient as a vertical linearGradient over the catalog span, drips / eyes / orb from the
// gradient entry, the face and charm sprites as <image> layers at the decor slots (or handed to canvas compositing),
// the medallion Bingo Star, the alt text - and v1 configs still rendering exactly as renderer 3.0.0.
// Run: node --test packages/ui/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  renderSoulSvg, resolveSoul, soulAltText, soulSpriteLayers, decorUsable, isDecoratedConfig, gradientY, GRADIENT_SPAN,
  SOUL_RENDERER_VERSION, BADGE_LABEL, BADGE_CENTER, BADGE_MEDALLION, EYE_WHITE, FACE_ALT, ALT_KIND_ORDER, STICKER,
} from '../soul-renderer.js';
import { BOUNDS, SILHOUETTE, ORB, EYES, MAPPING } from '../soul-baseline-shape.js';
import { GRADIENTS, CHARM_BY_ID, CHARMS_BY_KIND, FACES, SOUL_CATALOG } from '../../game-rules/src/soul-catalog.js';
import { SOUL_DECOR } from '../soul-decor-data.js';
import { gradientSrgbAt, tintGradient, gradientLinearAt, linearToSrgb } from '../soul3d/tint.js';
import { decorFixture, v2Config, neutralV2 } from './decor-fixture.js';

const DECOR = decorFixture();
const CONST = [{ domain: 'Design', weight: 0.4 }];

test('v4.0.0+: v1 configs render byte-for-byte as renderer 3.0.0 (every palette x glow x badge x detail x motion)', () => {
  assert.equal(SOUL_RENDERER_VERSION, '5.0.0'); // 5.0.0 (v3 Souls, D-31) keeps v1 and v2 byte-identical: soul-renderer-v5.test.js
  const out = [];
  for (let p = 0; p < 8; p++) for (let g = 0; g < 3; g++) for (const badge of [null, 'bingo-star']) for (const detail of ['full', 'simple', 'dot']) for (const rm of [false, true]) {
    out.push(renderSoulSvg({ seed: 's' + p + g, body: 1, palette: p, eyes: 2, antenna: 1, mouth: 1, glow: g, constellation: CONST, driftPhase: 0.3 }, { detail, badge, reducedMotion: rm, size: 160 }));
  }
  out.push(renderSoulSvg(null), renderSoulSvg({}), soulAltText({ palette: 3 }, 'bingo-star'));
  // sha256 of the same 291 strings from renderer 3.0.0 (captured before the v4 change)
  assert.equal(createHash('sha256').update(out.join('\n')).digest('hex'), '073c458fb67e03f81e6f2abca796098f9e1b620dfe0a43e78cf34f6c9e2382a2');
  // a v1 config never gets images, even with usable decor data
  assert.ok(!renderSoulSvg({ seed: 'v1', palette: 2 }, { decor: DECOR }).includes('<image'));
  assert.deepEqual(soulSpriteLayers({ seed: 'v1', palette: 2 }, { decor: DECOR }), []);
});

test('resolveSoul reads v2 tolerantly: gradient entry, face, charms by slot; unknown values fall back, forbidden fields are ignored', () => {
  const cfg = v2Config({ gradient: 10 });
  const s = resolveSoul(cfg);
  assert.equal(s.version, 2); assert.ok(isDecoratedConfig(cfg)); assert.ok(!isDecoratedConfig({ palette: 1 }));
  assert.equal(s.grad, GRADIENTS[10]); assert.equal(s.palette, GRADIENTS[10].id);
  assert.deepEqual({ ...s.pal }, { name: 'lemonade', fill: '#B7C8B1', highlight: GRADIENTS[10].highlight, outline: GRADIENTS[10].outline, glow: GRADIENTS[10].glow }, 'fill = sRGB midpoint of top and bottom');
  assert.equal(s.face, 'nerdy');
  assert.deepEqual(s.charms.map((c) => c.slot), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(s.charms.map((c) => c.id), cfg.charms);
  assert.deepEqual(s.charms.map((c) => c.kind), cfg.charms.map((id) => CHARM_BY_ID.get(id).kind));
  // tolerant: bad gradient -> 0, unknown face -> null, unknown / missing charm ids skipped (slots keep their index)
  const bad = resolveSoul({ ...cfg, gradient: 99, face: 'wizard', charms: ['nope', cfg.charms[1], null, cfg.charms[3]] });
  assert.equal(bad.gradient, 0); assert.equal(bad.face, null);
  assert.deepEqual(bad.charms.map((c) => [c.slot, c.id]), [[1, cfg.charms[1]], [3, cfg.charms[3]]]);
  assert.equal(resolveSoul({ ...cfg, charms: 'x' }).charms.length, 0);
  assert.deepEqual(resolveSoul({ ...cfg, platformId: 'p', roleId: 'r', rank: 1, isWinner: true, selectedKinds: { core: 9 } }), s);
  const neutral = resolveSoul(neutralV2());
  assert.equal(neutral.version, 2); assert.equal(neutral.gradient, 0); assert.equal(neutral.face, null); assert.deepEqual(neutral.charms, []);
});

test('v2 body: vertical linearGradient top -> bottom over the catalog span, y on the flat Soul\'s floor line', () => {
  assert.deepEqual({ ...GRADIENT_SPAN }, { top: SOUL_CATALOG.gradientSpan.top, bottom: SOUL_CATALOG.gradientSpan.bottom });
  assert.equal(SOUL_CATALOG.gradientSpan.space, 'srgb', 'SVG gradients interpolate in sRGB, like the spec\'s mix');
  assert.equal(gradientY(0), BOUNDS.y1, 'h = 0 is the feet');
  assert.equal(gradientY(1.9), Number((BOUNDS.y1 - MAPPING.scale * 1.9).toFixed(1)));
  for (let gi = 0; gi < GRADIENTS.length; gi++) {
    const g = GRADIENTS[gi];
    const svg = renderSoulSvg(v2Config({ gradient: gi }), { idPrefix: 'g', reducedMotion: true, decor: DECOR });
    assert.ok(svg.includes(`<linearGradient id="g-b" gradientUnits="userSpaceOnUse" x1="0" y1="${gradientY(GRADIENT_SPAN.top)}" x2="0" y2="${gradientY(GRADIENT_SPAN.bottom)}"><stop offset="0" stop-color="${g.top}"/><stop offset="1" stop-color="${g.bottom}"/></linearGradient>`), g.id);
    assert.ok(svg.includes('<use href="#g-p" fill="url(#g-b)"/><use href="#g-p" fill="url(#g-s)"/>'), 'gradient fill, then the clay light / shade overlay');
    assert.ok(svg.includes(`<use href="#g-p" fill="none" stroke="${g.outline}" stroke-width="2.2" stroke-linejoin="round"/>`), 'same body line weight, gradient outline colour');
    // drips, eyes and orb take the gradient entry's colours
    assert.ok(svg.includes(`<use href="#g-q" stroke="${g.highlight}" filter="url(#g-k)"/>`), 'drips in the gradient highlight');
    assert.ok(svg.includes(`<ellipse rx="${EYES[0].rx}" ry="${EYES[0].ry}" fill="${EYE_WHITE}"/><ellipse rx="${EYES[0].ring.rx}" ry="${EYES[0].ring.ry}" fill="none" stroke="${g.outline}"`), 'eye groove in the gradient outline');
    assert.ok(svg.includes(`<circle cx="${ORB.cx}" cy="${ORB.cy}" r="${ORB.r}" fill="${g.highlight}" stroke="${g.outline}" stroke-width="1.6"/>`), 'orb');
    assert.ok(svg.includes(`<stop offset="0" stop-color="${g.glow}" stop-opacity=".55"/>`), 'ambient glow in the gradient glow');
    assert.ok(svg.includes(`d="${SILHOUETTE}"`), 'same character');
  }
});

test('2D / 3D colour parity: the SVG gradient colour at any height equals the 3D tint fill (sRGB mix, then linear)', () => {
  const y1 = gradientY(GRADIENT_SPAN.top), y2 = gradientY(GRADIENT_SPAN.bottom);
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  for (const g of GRADIENTS) {
    const top = hex(g.top), bottom = hex(g.bottom), tg = tintGradient(g);
    for (const h of [-0.2, 0, 0.3, 0.95, 1.4, 1.9, 2.25]) {
      // what the SVG shows at that height: offset along y1 -> y2 (pad outside), linear between the sRGB stops
      const y = BOUNDS.y1 - MAPPING.scale * h;
      const off = Math.min(1, Math.max(0, (y - y1) / (y2 - y1)));
      const svgColour = top.map((c, i) => c + (bottom[i] - c) * off);
      const fill = gradientSrgbAt(h, tg);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(svgColour[i] - fill[i]) < 0.003, `${g.id} h ${h}: ${svgColour[i]} vs ${fill[i]}`);
      const lin = gradientLinearAt(h, tg);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(linearToSrgb(lin[i]) - fill[i]) < 1e-9);
    }
  }
});

test('sprite layers: face kit over the whole viewBox, then one image per charm at its slot front2d (same size for every charm)', () => {
  const cfg = v2Config({ face: 'pirate' });
  const layers = soulSpriteLayers(cfg, { decor: DECOR });
  assert.equal(layers.length, 11);
  assert.deepEqual(layers[0], { kind: 'face', face: 'pirate', href: DECOR.faces.pirate.sprite, x: 0, y: 0, w: 200, h: 200 });
  layers.slice(1).forEach((l, i) => {
    const slot = DECOR.slots[i], p = slot.front2d;
    assert.equal(l.kind, 'charm'); assert.equal(l.slot, i); assert.equal(l.id, cfg.charms[i]);
    assert.equal(l.href, DECOR.charm.files[cfg.charms[i]].png);
    assert.ok(Math.abs(l.x + l.w / 2 - p.x) < 0.01 && Math.abs(l.y + l.h / 2 - p.y) < 0.01, 'centred on front2d');
    assert.ok(Math.abs(l.w - 2 * p.r) < 0.01 && l.w === l.h);
  });
  assert.equal(new Set(layers.slice(1).map((l) => l.w)).size, 1, 'BR-17: one charm size');
  // inline SVG: the same layers as <image> elements after the orb, before the badge; images:false omits them
  const svg = renderSoulSvg(cfg, { badge: 'bingo-star', reducedMotion: true, idPrefix: 'l', decor: DECOR });
  const imgs = [...svg.matchAll(/<image href="([^"]+)"( x="([\d.]+)" y="([\d.]+)")? width="([\d.]+)" height="([\d.]+)"\/>/g)];
  assert.equal(imgs.length, 11);
  assert.deepEqual(imgs.map((m) => m[1].replace(/&amp;/g, '&')), layers.map((l) => l.href));
  assert.ok(svg.indexOf('<image') > svg.indexOf(`r="${ORB.r}" fill=`) && svg.lastIndexOf('<image') < svg.indexOf(`aria-label="${BADGE_LABEL}"`), 'paint order: orb, face, charms, badge');
  const flat = renderSoulSvg(cfg, { badge: 'bingo-star', reducedMotion: true, idPrefix: 'l', decor: DECOR, images: false });
  assert.ok(!flat.includes('<image'), 'images: false for data: URL rasterisation');
  assert.equal(flat, svg.replace(/<image [^>]*\/>/g, ''), 'the only difference is the image layers');
  assert.ok(!renderSoulSvg(cfg, { detail: 'dot', decor: DECOR }).includes('<image'), 'dot has no layers');
  assert.ok(renderSoulSvg(cfg, { detail: 'simple', decor: DECOR }).includes('<image'), 'simple keeps them');
});

test('unusable decor data (the hand-written stub, missing files) draws the plain gradient Soul, never stub positions', () => {
  const cfg = v2Config();
  assert.equal(decorUsable(DECOR), true);
  assert.equal(decorUsable({ ...DECOR, stub: true }), false);
  assert.equal(decorUsable({ ...DECOR, slots: [] }), false);
  assert.equal(decorUsable(null), false);
  if (SOUL_DECOR.stub === true) {
    assert.equal(decorUsable(), false, 'the checked-in stub is never drawn');
    assert.ok(!renderSoulSvg(cfg).includes('<image'));
  }
  assert.deepEqual(soulSpriteLayers(cfg, { decor: { ...DECOR, stub: true } }), []);
  const noFiles = decorFixture({ charm: { thickness: 0.2, files: {} } });
  assert.equal(soulSpriteLayers(cfg, { decor: noFiles }).length, 1, 'charms without files are skipped, the face stays');
  assert.deepEqual(soulSpriteLayers(neutralV2(), { decor: DECOR }), [], 'the neutral fallback has no layers');
});

test('Bingo Star on a v2 Soul sits on a round medallion (never read as a core star charm); v1 keeps the v3 badge', () => {
  const v2 = renderSoulSvg(v2Config(), { badge: 'bingo-star', idPrefix: 'm', decor: DECOR });
  const m = v2.match(/<g role="img" aria-label="([^"]+)" transform="translate\((\d+) (\d+)\)"><title>[^<]+<\/title>(.*?)<\/g>/);
  assert.ok(m, 'labelled badge group'); assert.equal(m[1], BADGE_LABEL);
  assert.deepEqual([Number(m[2]), Number(m[3])], [BADGE_CENTER.cx, BADGE_CENTER.cy]);
  assert.ok(m[4].startsWith(`<circle r="${BADGE_MEDALLION.r}" fill="${STICKER.violetDeep}" stroke="#fff" stroke-width="2.6"/>`), 'medallion disc + white die-cut');
  assert.ok(m[4].includes(`stroke="${STICKER.gold}"`) && m[4].includes(`fill="${STICKER.gold}"`), 'gold ring and gold star');
  // clear of the orb and inside the viewBox with its die-cut
  const R = BADGE_MEDALLION.r + 1.3;
  assert.ok(Math.hypot(BADGE_CENTER.cx - ORB.cx, BADGE_CENTER.cy - ORB.cy) > R + ORB.r + 10);
  assert.ok(BADGE_CENTER.cx + R <= 200 && BADGE_CENTER.cy - R >= 0);
  // core star charms are pastel shades without a backing; the badge star is gold on violet-deep
  for (const shade of SOUL_CATALOG.starShades) assert.notEqual(shade.fill.toUpperCase(), STICKER.gold.toUpperCase());
  const v1 = renderSoulSvg({ seed: 'x', palette: 1 }, { badge: 'bingo-star' });
  assert.ok(!v1.includes(`fill="${STICKER.violetDeep}"`), 'v1 badge unchanged (no medallion)');
});

test('alt text describes colour, face and charms with counts per kind in a fixed order; no rank words, no skill data', () => {
  assert.equal(soulAltText(v2Config()), 'Arise Soul, Aurora colour, with round glasses. 10 charms: 4 technical, 4 core, 2 soft');
  assert.equal(soulAltText(v2Config({ face: 'pirate', gradient: 3 }), 'bingo-star'), `Arise Soul, Orchid colour, with ${FACE_ALT.pirate}. 10 charms: 4 technical, 4 core, 2 soft. ${BADGE_LABEL}`);
  assert.equal(soulAltText(neutralV2()), 'Arise Soul, Aurora colour, with round button eyes and a glowing antenna orb', 'neutral fallback = the plain Soul');
  assert.equal(soulAltText(v2Config({ charms: CHARMS_BY_KIND.soft.slice(0, 10), face: 'angel' })), `Arise Soul, Aurora colour, with ${FACE_ALT.angel}. 10 charms: 10 soft`);
  assert.equal(soulAltText(v2Config({ charms: [CHARMS_BY_KIND.core[0]] })), 'Arise Soul, Aurora colour, with round glasses. 1 charm: 1 core');
  assert.deepEqual([...ALT_KIND_ORDER], ['technical', 'core', 'soft']);
  assert.deepEqual(Object.keys(FACE_ALT).sort(), [...FACES].sort());
  // counts are listed in the fixed kind order, never sorted by size (no ranking)
  const skew = v2Config({ charms: [...CHARMS_BY_KIND.soft.slice(0, 7), ...CHARMS_BY_KIND.technical.slice(0, 1), ...CHARMS_BY_KIND.core.slice(0, 2)] });
  assert.match(soulAltText(skew), /10 charms: 1 technical, 2 core, 7 soft$/);
  const banned = /platform|role|rank|level|score|senior|junior|strong|weak|best|top|expert|master|winner|most|matched/i;
  for (let gi = 0; gi < GRADIENTS.length; gi++) for (const face of [...FACES, null]) {
    const t = soulAltText(v2Config({ gradient: gi, face }), 'bingo-star');
    assert.ok(!banned.test(t.replace(BADGE_LABEL, '')), t);
    for (const id of v2Config().charms) { assert.ok(!t.includes(id)); assert.ok(!t.includes(CHARM_BY_ID.get(id).name)); }
    assert.match(t, new RegExp(`^Arise Soul, ${GRADIENTS[gi].name} colour, with `));
  }
  // the SVG carries the same accessible name
  assert.ok(renderSoulSvg(v2Config(), { decor: DECOR }).includes(`aria-label="${soulAltText(v2Config())}"`));
});

test('v2 SVGs: deterministic, CSP-safe (no script / text / style / remote or data URLs), images only from the decor data, under 8 KB', () => {
  let max = 0;
  for (let gi = 0; gi < GRADIENTS.length; gi++) for (const face of FACES) for (const badge of [null, 'bingo-star']) for (const [detail, size] of [['full', 240], ['simple', 64]]) {
    const cfg = v2Config({ gradient: gi, face, seed: `s${gi}${face}` });
    const svg = renderSoulSvg(cfg, { detail, size, badge, reducedMotion: false, decor: DECOR });
    assert.equal(svg, renderSoulSvg(JSON.parse(JSON.stringify(cfg)), { detail, size, badge, reducedMotion: false, decor: DECOR }));
    assert.ok(!/<text|<foreignObject|<script|style=|href="https?:|data:/.test(svg), 'CSP-safe');
    for (const [, href] of svg.matchAll(/<image href="([^"]+)"/g)) assert.ok(href.startsWith('/assets/souls/'), href);
    assert.ok(!/level|lv\.|rank|score|tier|unlock/i.test(svg.replace(/aria-label="[^"]*"/g, '')), 'no rank marks');
    max = Math.max(max, Buffer.byteLength(svg));
  }
  assert.ok(max <= 8 * 1024, `worst case ${max} bytes`);
});

test('BR-17 in 2D: every gradient / face draws the same figure, die-cut, glow radius and line weights', () => {
  const figure = (s) => s.match(/<path id="u-p"[^>]*\/><g id="u-q"[\s\S]*?<\/g>/)[0];
  const ref = renderSoulSvg(v2Config(), { reducedMotion: true, idPrefix: 'u', decor: DECOR });
  for (let gi = 0; gi < GRADIENTS.length; gi++) for (const face of [...FACES, null]) {
    const svg = renderSoulSvg(v2Config({ gradient: gi, face }), { reducedMotion: true, idPrefix: 'u', decor: DECOR });
    assert.equal(figure(svg), figure(ref));
    assert.ok(svg.includes('stroke-width="10" stroke-linejoin="round" filter="url(#u-d)"'), 'same die-cut');
    assert.ok(svg.includes('<circle cx="100" cy="108" r="86"'), 'same glow radius');
    assert.ok(svg.includes('stroke-width="2.2"'), 'same outline weight');
  }
});

test('a decorated Soul never draws the halo glow ring above its orb (it would read as the angel halo, D-29); v1 still does', () => {
  const HALO = /<ellipse [^>]*rx="17" ry="4"/;
  const opts = { idPrefix: 'h', detail: 'full', reducedMotion: true, decor: DECOR };
  for (const face of ['nerdy', 'pirate', 'angel']) assert.doesNotMatch(renderSoulSvg(v2Config({ glow: 2, face }), opts), HALO, face);
  assert.match(renderSoulSvg({ version: 1, seed: 'v1halo', palette: 1, glow: 2 }, opts), HALO);
});

test('D-58 phone options: dieCut false drops the white die-cut; glow soft never draws the dashed ring or the halo ring', async () => {
  const { renderSoulSvg } = await import('../soul-renderer.js');
  const base = { seed: 'd58', palette: 'aurora', body: 'drop', eyes: 'dot', antenna: 'orb', mouth: 'smile', driftPhase: 0.2 };
  const ring = renderSoulSvg({ ...base, glow: 'ring' }, { size: 220, detail: 'full', reducedMotion: true, images: false });
  assert.match(ring, /stroke-dasharray="10 6"/, 'the ring trait draws the dashed ring by default');
  const phone = renderSoulSvg({ ...base, glow: 'ring' }, { size: 220, detail: 'full', reducedMotion: true, images: false, dieCut: false, glow: 'soft' });
  assert.doesNotMatch(phone, /stroke-dasharray="10 6"/, 'no dashed ring');
  const halo = renderSoulSvg({ ...base, glow: 'halo' }, { size: 220, detail: 'full', reducedMotion: true, images: false, dieCut: false, glow: 'soft' });
  assert.doesNotMatch(halo, /<ellipse[^>]*fill="none"[^>]*stroke-width="3"/, 'no halo ring');
  assert.doesNotMatch(phone, /stroke="#FFFFFF"[^>]*stroke-linejoin="round"/i, 'no white die-cut stroke');
});

test('D-58 crown in 2D: a winner wears the gold crown where the 3D crown sits (CROWN_PLACE through MAPPING), instead of the star', async () => {
  const { renderSoulSvg, soulAltText, CROWN_LABEL } = await import('../soul-renderer.js');
  const { CROWN_PLACE } = await import('../soul3d/winner.js');
  const { MAPPING } = await import('../soul-baseline-shape.js');
  const cfg = { seed: 'crown', palette: 'aurora', body: 'drop', eyes: 'dot', antenna: 'orb', mouth: 'smile', glow: 'soft', driftPhase: 0 };
  const crowned = renderSoulSvg(cfg, { badge: 'bingo-star', crown: true, reducedMotion: true, images: false });
  const m = crowned.match(/data-crown="" transform="translate\(([\d.]+) ([\d.]+)\) rotate\(([\d.-]+)\)"/);
  assert.ok(m, 'the crown group is drawn');
  assert.ok(Math.abs(Number(m[1]) - (MAPPING.cx + MAPPING.scale * CROWN_PLACE.position[0])) < 0.11, 'x from CROWN_PLACE');
  assert.ok(Math.abs(Number(m[2]) - (MAPPING.y0 - MAPPING.scale * CROWN_PLACE.position[1])) < 0.11, 'y from CROWN_PLACE');
  assert.ok(Math.abs(Number(m[3]) + CROWN_PLACE.rotationZ * 180 / Math.PI) < 0.11, 'the same tilt');
  assert.equal((crowned.match(/<circle[^>]*fill="#E0356B"/g) || []).length, 3, 'three ruby jewels');
  assert.equal((crowned.match(/<circle[^>]*fill="#4D7DFF"/g) || []).length, 5, 'two sapphire jewels + three gems');
  assert.match(crowned, new RegExp(CROWN_LABEL));
  assert.doesNotMatch(crowned, /Bingo Star badge/, 'no star badge under the crown');
  const star = renderSoulSvg(cfg, { badge: 'bingo-star', reducedMotion: true, images: false });
  assert.doesNotMatch(star, /data-crown/, 'the default keeps the star (big screen 2D tiers)');
  assert.doesNotMatch(renderSoulSvg(cfg, { crown: true, reducedMotion: true, images: false }), /data-crown/, 'no badge, no crown');
  assert.match(soulAltText(cfg, 'bingo-star', { crown: true }), /Bingo crown: completed a line this round$/);
  assert.match(soulAltText(cfg, 'bingo-star'), /Bingo Star badge/);
});
