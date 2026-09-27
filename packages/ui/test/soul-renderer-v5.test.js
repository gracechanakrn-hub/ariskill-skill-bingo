// Soul renderer v5 (D-31, docs/art/soul-faces.md "Rendering" and "Alt text v3"): v3 Souls in 2D - the face data's v3
// outline with the v2 gradient body and no button eyes or orb, the plate / eyes / face-kit / charm / antenna-charm sprite
// layers (inline <image> or canvas compositing), the v2 look while the face data is unusable, alt text v3 - and v1 / v2
// configs still rendering exactly as renderer 4.0.0.
// Run: node --test packages/ui/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  renderSoulSvg, resolveSoul, soulAltText, soulSpriteLayers, faceUsable, decorUsable, indefiniteArticle, charmAltName,
  SOUL_RENDERER_VERSION, FACE_ALT_V3, BADGE_LABEL, BADGE_CENTER, BADGE_MEDALLION, EYE_WHITE, STICKER, VIEWBOX,
} from '../soul-renderer.js';
import { SILHOUETTE, ORB } from '../soul-baseline-shape.js';
import { SOUL_FACE } from '../soul-face-data.js';
import { SOUL_DECOR } from '../soul-decor-data.js';
import { SOUL_CATALOG, GRADIENTS, CHARMS, CHARM_BY_ID, CHARMS_BY_KIND, FACES, PLATES, PLATE_IDS, EYES, EYE_IDS } from '../../game-rules/src/soul-catalog.js';
import { spriteRects } from '../../../apps/public-galaxy/src/renderer/atlas.js';
import { decorFixture } from './decor-fixture.js';
import { faceFixture, stubFace, v3Config, v2PinCases, FIXTURE_SILHOUETTE } from './face-fixture.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DECOR = decorFixture();
const FACE = faceFixture();
const OPTS = { decor: DECOR, face: FACE };
const r2 = (v) => Number(v.toFixed(2));
const rectFields = ([x, y, w, h]) => ({ x: r2(x), y: r2(y), w: r2(w), h: r2(h) });
const IMG = /<image href="([^"]+)"(?: x="([-\d.]+)" y="([-\d.]+)")? width="([\d.]+)" height="([\d.]+)"\/>/g;
const RANK = /platform|role|rank|level|score|senior|junior|strong|weak|best|top|expert|master|winner|most|least|more than|matched|skill/i;
const PLATE_NAME = Object.fromEntries(PLATES.map((p) => [p.id, p.name]));
const EYES_NAME = Object.fromEntries(EYES.map((e) => [e.id, e.name]));

/** The same Soul as a v2 config: the v2 look a v3 Soul falls back to (plate, eyes and topper keys are ignored by v2). */
const asV2 = (cfg) => ({ ...cfg, version: 2 });
/** True when `words` appears in `text` as whole words ("pen" is not named by "pencil"). */
const named = (text, words) => new RegExp(`(^|[^\\w-])${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`).test(text);

test('v5.0.0: v2 configs render byte for byte as renderer 4.0.0 (SVG at every level, sprite layers, alt text); v1 is pinned in the v4 tests', () => {
  assert.equal(SOUL_RENDERER_VERSION, '5.0.0');
  const { decor, configs } = v2PinCases();
  const out = [];
  for (const [i, cfg] of configs.entries()) {
    for (const detail of ['full', 'simple', 'dot']) for (const badge of [null, 'bingo-star']) for (const images of [true, false]) {
      out.push(renderSoulSvg(cfg, { detail, badge, images, decor, reducedMotion: i % 2 === 0, size: detail === 'simple' ? 64 : 240, idPrefix: i % 3 ? `p${i}` : undefined }));
    }
    out.push(renderSoulSvg(cfg, { decor: { ...decor, stub: true } }));
    out.push(JSON.stringify(soulSpriteLayers(cfg, { decor })), soulAltText(cfg), soulAltText(cfg, 'bingo-star'));
  }
  // sha256 of the same 768 strings from renderer 4.0.0 (captured before the v5 change)
  assert.equal(createHash('sha256').update(out.join('\n')).digest('hex'), '1ddc42ae0f573671f382a4c10b1a5a289f7e028a84903cb10744cd425525191a');
  // face data never reaches a v1 or v2 Soul
  const cfg = configs[0];
  assert.equal(renderSoulSvg(cfg, { decor, face: FACE }), renderSoulSvg(cfg, { decor, face: stubFace() }));
  assert.equal(renderSoulSvg({ seed: 'v1', palette: 2 }, OPTS), renderSoulSvg({ seed: 'v1', palette: 2 }));
  assert.deepEqual(soulSpriteLayers({ seed: 'v1', palette: 2 }, OPTS), []);
});

test('resolveSoul reads v3 tolerantly: plate, eyes and antenna charm from the catalog; unknown ids, or a topper among the charms, resolve to null', () => {
  const cfg = v3Config();
  const s = resolveSoul(cfg);
  assert.equal(s.version, 3);
  assert.equal(s.plate, 'bean'); assert.equal(s.eyes, 'hearts'); assert.deepEqual(s.topper, { id: 'core-classic-lemon', kind: 'core' });
  assert.equal(s.grad, GRADIENTS[0]); assert.equal(s.face, 'nerdy'); assert.equal(s.charms.length, 10);
  for (const id of PLATE_IDS) assert.equal(resolveSoul(v3Config({ plate: id })).plate, id);
  for (const id of EYE_IDS) assert.equal(resolveSoul(v3Config({ eyes: id })).eyes, id);
  const bad = resolveSoul(v3Config({ plate: 'moon', eyes: 'laser', topper: 'nope' }));
  assert.deepEqual([bad.plate, bad.eyes, bad.topper], [null, null, null]);
  assert.equal(resolveSoul(v3Config({ topper: cfg.charms[4] })).topper, null, 'never one of the ten body charms');
  assert.deepEqual(resolveSoul({ ...cfg, platformId: 'p', roleId: 'r', rank: 1, isWinner: true, matchedKinds: { core: 3 } }), s, 'forbidden inputs are ignored');
  assert.equal(resolveSoul({ ...cfg, version: 4 }).version, 3, 'a later version reads as v3');
});

test('faceUsable: generated face data only (never the stub placeholder), with the outline as SVG path data and the three sprite maps', () => {
  assert.equal(faceUsable(FACE), true);
  assert.equal(faceUsable(stubFace()), false);
  assert.equal(faceUsable({ ...FACE, stub: true }), false);
  assert.equal(faceUsable(null), false);
  assert.equal(faceUsable({ ...FACE, shape: { silhouette: null } }), false);
  assert.equal(faceUsable({ ...FACE, shape: { silhouette: '' } }), false);
  assert.equal(faceUsable({ ...FACE, shape: { silhouette: 'M0 0"/><script>z' } }), false, 'only path data goes into d=""');
  for (const key of ['plates', 'eyes', 'faces']) assert.equal(faceUsable({ ...FACE, [key]: null }), false, key);
  assert.equal(faceUsable({ ...FACE, topper: null }), true, 'a missing antenna slot only skips the antenna charm');
  assert.equal(faceUsable(), SOUL_FACE.stub !== true && faceUsable(SOUL_FACE), 'the default is the checked-in module');
  if (SOUL_FACE.stub === true) assert.equal(faceUsable(), false, 'the checked-in stub is never drawn');
});

test('v3 body: exactly the v2 drawing on the face data\'s outline, minus the button eyes, the orb and its glow', () => {
  const cfg = v3Config({ gradient: 5, glow: 0 });
  for (const detail of ['full', 'simple']) for (const badge of [null, 'bingo-star']) for (const reducedMotion of [false, true]) {
    const o = { ...OPTS, detail, badge, reducedMotion, idPrefix: 't', label: 'x', images: false };
    const v3 = renderSoulSvg(cfg, o);
    const pal = resolveSoul(cfg).pal;
    const v2 = renderSoulSvg(asV2(cfg), o);
    const expected = v2
      .replace(`<path id="t-p" d="${SILHOUETTE}"/>`, `<path id="t-p" d="${FIXTURE_SILHOUETTE}"/>`)
      .replace(/<radialGradient id="t-o">.*?<\/radialGradient>/, '')
      .replace(/<circle [^>]*fill="url\(#t-o\)"\/>/, '')
      .replace(/<g id="t-e"[^>]*>.*?<\/g><use href="#t-e"[^>]*\/>/, '')
      .replace(`<circle cx="${ORB.cx}" cy="${ORB.cy}" r="${ORB.r}" fill="${pal.highlight}" stroke="${pal.outline}" stroke-width="1.6"/><circle cx="${ORB.spec.x}" cy="${ORB.spec.y}" r="2.6" fill="#fff"/>`, '');
    assert.notEqual(expected, v2, 'the v2 drawing had eyes and an orb to take out');
    assert.equal(v3, expected, `${detail} ${badge} ${reducedMotion}`);
    // what that means, spelled out
    assert.ok(!v3.includes(SILHOUETTE) && v3.includes(`d="${FIXTURE_SILHOUETTE}"`), 'the v3 outline');
    assert.ok(v3.includes('<use href="#t-p" fill="url(#t-b)"/><use href="#t-p" fill="url(#t-s)"/>'), 'gradient body with the clay light / shade');
    assert.ok(v3.includes(`stroke="${GRADIENTS[5].outline}" stroke-width="2.2"`), 'the v2 outline weight and colour');
    assert.ok(v3.includes('<use href="#t-q" stroke=') && v3.includes('stroke="url(#t-r)"'), 'drips and rim');
    assert.ok(!/id="t-e"|href="#t-e"|id="t-o"|url\(#t-o\)/.test(v3) && !v3.includes(EYE_WHITE), 'no button eyes, no orb glow');
    assert.ok(!v3.includes(`cx="${ORB.cx}"`), 'no orb');
  }
});

test('v3 sprite layers: plate, eyes and face kit at their data rects, then the charms by slot, then the antenna charm 2 r wide on topper.front2d', () => {
  for (const [plate, eyes, face] of [['bean', 'hearts', 'nerdy'], ['cracked-bow', 'wink', 'pirate'], ['crack', 'happy', 'angel']]) {
    const cfg = v3Config({ plate, eyes, face });
    const layers = soulSpriteLayers(cfg, OPTS);
    assert.deepEqual(layers.map((l) => l.kind), ['plate', 'eyes', 'face', ...Array(10).fill('charm'), 'topper'], 'paint order');
    assert.deepEqual(layers[0], { kind: 'plate', plate, href: FACE.plates[plate].sprite, ...rectFields(FACE.plates[plate].rect) });
    assert.deepEqual(layers[1], { kind: 'eyes', eyes, href: FACE.eyes[eyes].sprite, ...rectFields(FACE.eyes[eyes].rect) });
    assert.deepEqual(layers[2], { kind: 'face', face, href: FACE.faces[face].sprite, ...rectFields(FACE.faces[face].rect) });
    // the charms exactly as the v2 Soul has them (same slots, same size: BR-17)
    assert.deepEqual(layers.slice(3, 13), soulSpriteLayers(asV2(cfg), { decor: DECOR }).slice(1));
    const { x, y, r } = FACE.topper.front2d;
    assert.deepEqual(layers[13], { kind: 'topper', id: cfg.topper, href: DECOR.charm.files[cfg.topper].png, x: r2(x - r), y: r2(y - r), w: r2(2 * r), h: r2(2 * r) });
  }
  // every plate and eye design is looked up by its own id
  assert.equal(new Set(PLATE_IDS.map((plate) => JSON.stringify(soulSpriteLayers(v3Config({ plate }), OPTS)[0]))).size, PLATE_IDS.length);
  assert.equal(new Set(EYE_IDS.map((eyes) => JSON.stringify(soulSpriteLayers(v3Config({ eyes }), OPTS)[1]))).size, EYE_IDS.length);
});

test('inline v3 SVG: the same layers as <image> elements after the highlight, before the badge; images: false omits them; dot has none', () => {
  const cfg = v3Config({ face: 'pirate' });
  const layers = soulSpriteLayers(cfg, OPTS);
  const svg = renderSoulSvg(cfg, { ...OPTS, badge: 'bingo-star', reducedMotion: true, idPrefix: 'l' });
  const imgs = [...svg.matchAll(IMG)];
  assert.equal(imgs.length, 14);
  assert.deepEqual(imgs.map((m) => [m[1].replace(/&amp;/g, '&'), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]), layers.map((l) => [l.href, l.x, l.y, l.w, l.h]), 'every v3 layer carries its x / y');
  assert.ok(svg.indexOf('<image') > svg.lastIndexOf('<ellipse') && svg.lastIndexOf('<image') < svg.indexOf(`aria-label="${BADGE_LABEL}"`), 'paint order: body, highlight, sprites, badge');
  const flat = renderSoulSvg(cfg, { ...OPTS, badge: 'bingo-star', reducedMotion: true, idPrefix: 'l', images: false });
  assert.ok(!flat.includes('<image'));
  assert.equal(flat, svg.replace(/<image [^>]*\/>/g, ''), 'the only difference is the image layers');
  assert.ok(!renderSoulSvg(cfg, { ...OPTS, detail: 'dot' }).includes('<image'), 'dot has no layers');
  assert.equal(renderSoulSvg(cfg, { ...OPTS, detail: 'dot' }), renderSoulSvg(asV2(cfg), { ...OPTS, detail: 'dot', label: soulAltText(cfg) }), 'dot: the v2 disc');
  assert.equal([...renderSoulSvg(cfg, { ...OPTS, detail: 'simple' }).matchAll(IMG)].length, 14, 'simple keeps them');
});

test('a missing piece skips only its own layer: plate, eyes or kit without a file or rect, charm.missing, no antenna slot, stub decor data', () => {
  const cfg = v3Config();
  const kinds = (face, decor = DECOR, c = cfg) => soulSpriteLayers(c, { decor, face }).map((l) => l.kind === 'charm' ? `charm:${l.slot}` : l.kind);
  const all = kinds(FACE);
  const without = (...drop) => all.filter((k) => !drop.includes(k));
  const plates = { ...FACE.plates }; delete plates.bean;
  assert.deepEqual(kinds({ ...FACE, plates }), without('plate'));
  assert.deepEqual(kinds({ ...FACE, eyes: { ...FACE.eyes, hearts: { ...FACE.eyes.hearts, rect: [1, 2, 0, 4] } } }), without('eyes'), 'rect with no width');
  assert.deepEqual(kinds({ ...FACE, eyes: { ...FACE.eyes, hearts: { ...FACE.eyes.hearts, rect: [1, 2, 3] } } }), without('eyes'), 'rect of three numbers');
  assert.deepEqual(kinds({ ...FACE, faces: { ...FACE.faces, nerdy: { ...FACE.faces.nerdy, sprite: null } } }), without('face'));
  assert.deepEqual(kinds({ ...FACE, topper: null }), without('topper'));
  assert.deepEqual(kinds({ ...FACE, topper: { ...FACE.topper, front2d: { x: 107, y: 31, r: 0 } } }), without('topper'));
  assert.deepEqual(kinds(FACE, decorFixture({ charm: { ...DECOR.charm, missing: [cfg.topper, cfg.charms[2]] } })), without('topper', 'charm:2'), 'charm.missing: not built yet');
  assert.deepEqual(kinds(FACE, { ...DECOR, stub: true }), ['plate', 'eyes', 'face'], 'stub decor data: no charm files, the face stays');
  assert.deepEqual(kinds(FACE, DECOR, v3Config({ plate: 'moon', topper: 'nope' })), without('plate', 'topper'), 'unknown ids');
  // the SVG follows the same layers and keeps the v3 body either way
  const svg = renderSoulSvg(cfg, { decor: { ...DECOR, stub: true }, face: { ...FACE, plates } });
  assert.equal([...svg.matchAll(IMG)].length, 2);
  assert.ok(svg.includes(FIXTURE_SILHOUETTE) && !svg.includes(EYE_WHITE));
});

test('unusable face data (the stub): a v3 Soul draws exactly as the v2 Soul with the same gradient, face kit and charms, so it never looks broken', () => {
  for (const face of [stubFace(), null, { ...FACE, shape: {} }]) {
    for (const cfg of [v3Config(), v3Config({ gradient: 7, face: 'angel', glow: 2 })]) {
      for (const [detail, badge] of [['full', 'bingo-star'], ['simple', null]]) {
        const o = { decor: DECOR, face, detail, badge, idPrefix: 'f' };
        const v3 = renderSoulSvg(cfg, o);
        assert.equal(v3, renderSoulSvg(asV2(cfg), { ...o, label: soulAltText(cfg, badge) }), 'baseline outline, button eyes, orb, v2 face kit and charms');
        assert.ok(v3.includes(SILHOUETTE) && v3.includes(EYE_WHITE) && v3.includes(`r="${ORB.r}"`));
      }
      assert.deepEqual(soulSpriteLayers(cfg, { decor: DECOR, face }), soulSpriteLayers(asV2(cfg), { decor: DECOR }));
    }
  }
  if (SOUL_FACE.stub === true) {
    assert.equal(renderSoulSvg(v3Config(), { decor: DECOR }), renderSoulSvg(asV2(v3Config()), { decor: DECOR, label: soulAltText(v3Config()) }), 'the checked-in stub');
  }
  // and with no usable decor data either: the plain gradient Soul
  assert.ok(!renderSoulSvg(v3Config(), { decor: { ...DECOR, stub: true }, face: stubFace() }).includes('<image'));
});

test('decorated Souls never draw the halo glow style and put the Bingo Star on a medallion: v2 and v3, usable face data or not', () => {
  const HALO = /<ellipse [^>]*rx="17" ry="4"/;
  for (const face of [FACE, stubFace()]) for (const kit of FACES) {
    const svg = renderSoulSvg(v3Config({ glow: 2, face: kit }), { decor: DECOR, face, idPrefix: 'h', reducedMotion: true, badge: 'bingo-star' });
    assert.doesNotMatch(svg, HALO, kit);
    assert.ok(svg.includes(`<circle r="${BADGE_MEDALLION.r}" fill="${STICKER.violetDeep}" stroke="#fff" stroke-width="2.6"/>`), 'medallion');
    assert.ok(svg.includes('<circle cx="100" cy="108" r="86"'), 'the soft glow instead');
  }
  assert.match(renderSoulSvg({ version: 1, seed: 'v1halo', palette: 1, glow: 2 }, { reducedMotion: true }), HALO, 'v1 still draws it');
});

test('v3 SVGs: deterministic, CSP-safe, images only from the data; every plate / eyes / face draws the same figure, die-cut and glow (BR-17)', () => {
  const figure = (svg) => svg.match(/<path id="u-p"[^>]*\/><g id="u-q"[\s\S]*?<\/g>/)[0];
  const ref = figure(renderSoulSvg(v3Config(), { ...OPTS, reducedMotion: true, idPrefix: 'u' }));
  let max = 0;
  for (const plate of PLATE_IDS) for (const [e, eyes] of EYE_IDS.entries()) {
    const face = FACES[e % 3], gradient = (e + PLATE_IDS.indexOf(plate)) % GRADIENTS.length;
    const cfg = v3Config({ plate, eyes, face, gradient, seed: `v3-${plate}-${eyes}` });
    const svg = renderSoulSvg(cfg, { ...OPTS, badge: 'bingo-star', size: 240 });
    assert.equal(svg, renderSoulSvg(JSON.parse(JSON.stringify(cfg)), { ...OPTS, badge: 'bingo-star', size: 240 }), 'same config -> same bytes');
    const reordered = Object.fromEntries(Object.entries(cfg).reverse());
    assert.equal(svg, renderSoulSvg(reordered, { ...OPTS, badge: 'bingo-star', size: 240 }), 'key order does not matter');
    assert.ok(!/<text|<foreignObject|<script|style=|href="https?:|data:/.test(svg), 'CSP-safe');
    for (const [, href] of svg.matchAll(/<image href="([^"]+)"/g)) assert.ok(href.startsWith('/assets/souls/'), href);
    assert.ok(!/level|lv\.|rank|score|tier|unlock/i.test(svg.replace(/aria-label="[^"]*"/g, '')), 'no rank marks');
    const same = renderSoulSvg(cfg, { ...OPTS, reducedMotion: true, idPrefix: 'u' });
    assert.equal(figure(same), ref, `${plate} ${eyes}: same figure`);
    assert.ok(same.includes('stroke-width="10" stroke-linejoin="round" filter="url(#u-d)"') && same.includes('<circle cx="100" cy="108" r="86"') && same.includes('stroke-width="2.2"'));
    max = Math.max(max, Buffer.byteLength(svg));
  }
  assert.ok(max <= 8 * 1024, `worst case ${max} bytes`);
});

test('alt text v3: colour, "a <plate> face", the eyes and the kit, the charm counts per kind, then the antenna charm', () => {
  assert.equal(soulAltText(v3Config()), 'Arise Soul, Aurora colour, with a bean face, heart eyes and round glasses. 10 charms: 4 technical, 4 core, 2 soft. A lemon classic star charm on its antenna');
  assert.equal(soulAltText(v3Config({ plate: 'skull', eyes: 'sleepy', face: 'angel', gradient: 3 }), 'bingo-star'),
    `Arise Soul, Orchid colour, with a skull face, sleepy eyes and a glowing halo. 10 charms: 4 technical, 4 core, 2 soft. A lemon classic star charm on its antenna. ${BADGE_LABEL}`);
  // a look item that already reads "x and y" gets a serial comma before the last item, so the list stays three items
  assert.equal(soulAltText(v3Config({ plate: 'bat', eyes: 'wink', face: 'pirate', topper: 'soft-apple' })),
    'Arise Soul, Aurora colour, with a bat wing face, a blue eye and a cross eye, and an eye patch and a bandana. 10 charms: 4 technical, 4 core, 2 soft. An apple charm on its antenna');
  assert.equal(soulAltText(v3Config({ plate: 'skull-x', eyes: 'fierce', face: 'pirate', topper: 'tech-usb' })),
    'Arise Soul, Aurora colour, with a skull with a scar face, fierce cream eyes, and an eye patch and a bandana. 10 charms: 4 technical, 4 core, 2 soft. A USB stick charm on its antenna');
  // every plate x eyes x face: the rule, and one sentence of look with no blush (v3 has none)
  assert.deepEqual({ ...FACE_ALT_V3 }, { nerdy: 'round glasses', pirate: 'an eye patch and a bandana', angel: 'a glowing halo' });
  for (const plate of PLATE_IDS) for (const eyes of EYE_IDS) for (const face of FACES) {
    const kit = FACE_ALT_V3[face], p = PLATE_NAME[plate], e = EYES_NAME[eyes];
    const serial = e.includes(' and ') || kit.includes(' and ') ? ',' : '';
    const t = soulAltText(v3Config({ plate, eyes, face }));
    assert.equal(t, `Arise Soul, Aurora colour, with a ${p} face, ${e}${serial} and ${kit}. 10 charms: 4 technical, 4 core, 2 soft. A lemon classic star charm on its antenna`);
    assert.ok(!/blush|orb/.test(t), t);
  }
  assert.deepEqual(PLATES.filter((p) => indefiniteArticle(p.name) === 'an'), [], 'no plate name starts with a vowel sound');
});

test('alt text v3 names the antenna charm naturally: its catalog name, a star read shade first, with "a" / "an" by sound', () => {
  const body = new Set(v3Config().charms);
  const shapes = Object.fromEntries(SOUL_CATALOG.starShapes.map((x) => [x.id, x.name]));
  const shades = Object.fromEntries(SOUL_CATALOG.starShades.map((x) => [x.id, x.name]));
  const an = [];
  for (const ch of CHARMS) {
    const name = charmAltName(ch.id);
    assert.equal(name, ch.kind === 'core' ? `${shades[ch.shade]} ${shapes[ch.shape]}` : ch.name, ch.id);
    assert.ok(!name.includes(','), name);
    if (body.has(ch.id)) continue; // the antenna charm is never one of the ten
    const t = soulAltText(v3Config({ topper: ch.id }));
    const m = /\. (A|An) (.+) charm on its antenna$/.exec(t);
    assert.ok(m && m[2] === name, t);
    if (m[1] === 'An') an.push(name);
  }
  assert.deepEqual(an.sort(), ['apple', 'earphones', 'ice cream', 'umbrella'], 'the catalog names with a vowel sound (review this list when names change)');
  assert.equal(charmAltName('nope'), null);
  // the rule itself
  const cases = { apple: 'an', 'ice cream': 'an', umbrella: 'an', earphones: 'an', orchid: 'an', 'USB stick': 'a', 'LED lamp': 'an', unicorn: 'a', useful: 'a', '3D printer': 'a', 'hot-air balloon': 'a', 'yarn ball': 'a', 'lemon classic star': 'a' };
  for (const [phrase, a] of Object.entries(cases)) assert.equal(indefiniteArticle(phrase), a, phrase);
  // tolerant: no antenna sentence without a known antenna charm, no plate phrase without a known plate
  assert.equal(soulAltText(v3Config({ topper: 'nope' })), 'Arise Soul, Aurora colour, with a bean face, heart eyes and round glasses. 10 charms: 4 technical, 4 core, 2 soft');
  assert.equal(soulAltText(v3Config({ plate: 'moon', eyes: 'laser', face: 'wizard', charms: [] })), 'Arise Soul, Aurora colour. A lemon classic star charm on its antenna');
  assert.equal(soulAltText(v3Config({ plate: 'moon' })).split('. ')[0], 'Arise Soul, Aurora colour, with heart eyes and round glasses');
});

test('alt text v3: no rank words, no skill data, the body charms never named, kinds in the fixed order; the SVG carries it; the stub keeps it', () => {
  const t = CHARMS_BY_KIND.technical, c = CHARMS_BY_KIND.core, s = CHARMS_BY_KIND.soft;
  const splits = [[4, 4, 2], [8, 1, 1], [10, 0, 0], [0, 10, 0], [0, 0, 10], [1, 2, 7]];
  for (const [ti, ci, si] of splits) for (const [i, plate] of PLATE_IDS.entries()) {
    const charms = [...t.slice(0, ti), ...c.slice(1, ci + 1), ...s.slice(0, si)];
    const free = CHARMS.filter((ch) => !charms.includes(ch.id));
    const topper = free[(i * 37) % free.length].id;
    const cfg = v3Config({ plate, eyes: EYE_IDS[(i * 3) % 10], face: FACES[i % 3], gradient: i, charms, topper });
    const text = soulAltText(cfg, 'bingo-star');
    const own = text.replace(BADGE_LABEL, '').replace(`${charmAltName(topper)} charm`, 'charm');
    assert.ok(!RANK.test(own), text);
    for (const id of charms) assert.ok(![CHARM_BY_ID.get(id).name, charmAltName(id), id].some((w) => named(text, w)), `${id} named in "${text}"`);
    const kinds = [...text.matchAll(/(\d+) (technical|core|soft)/g)].map((m) => m[2]);
    assert.deepEqual(kinds, ['technical', 'core', 'soft'].filter((k) => kinds.includes(k)), 'fixed order technical, core, soft');
    assert.equal(renderSoulSvg(cfg, { ...OPTS, badge: 'bingo-star' }).match(/aria-label="([^"]*)"/)[1], text);
    assert.equal(renderSoulSvg(cfg, { decor: DECOR, face: stubFace(), badge: 'bingo-star' }).match(/aria-label="([^"]*)"/)[1], text, 'the text describes the Soul, not the state of the face data');
  }
});

test('Galaxy atlas: soulSpriteLayers() composites generically - every v3 layer kind maps to a cell rect, and the atlas draws each layer it gets', () => {
  const layers = soulSpriteLayers(v3Config({ face: 'angel' }), OPTS);
  const k = 96 / VIEWBOX;
  const rects = spriteRects(layers, 96, 192, 48);
  assert.deepEqual(rects.map((r) => r.kind), ['plate', 'eyes', 'face', ...Array(10).fill('charm'), 'topper']);
  rects.forEach((r, i) => { const l = layers[i]; assert.deepEqual([r.href, r.x, r.y, r.w, r.h], [l.href, 192 + l.x * k, 48 + l.y * k, l.w * k, l.h * k]); });
  const atlas = readFileSync(join(ROOT, 'apps/public-galaxy/src/renderer/atlas.js'), 'utf8');
  assert.match(atlas, /soulSpriteLayers\(soul\.config\)/);
  assert.match(atlas, /images: false/, 'the rasterised SVG leaves the layers to drawImage');
  assert.doesNotMatch(atlas, /\.kind\s*[!=]==/, 'no layer kind is filtered out');
});

// ---------- the delivered face data (skipped while packages/ui/soul-face-data.js is the stub placeholder) ----------

const skip = faceUsable(SOUL_FACE) ? false : 'soul-face-data.js is still the stub placeholder';

/** On-curve and control points of an 'M x y c ... z' path, subpath by subpath (the generator writes M / c / z only). */
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

test('delivered face data in 2D: every plate / eyes / kit sprite on disk at a rect in the viewBox, the outline clear of the badge, the antenna charm on top', { skip }, () => {
  const F = SOUL_FACE;
  const inside = ([x, y, w, h]) => x >= 0 && y >= 0 && x + w <= VIEWBOX + 0.01 && y + h <= VIEWBOX + 0.01;
  for (const [map, ids, prefix] of [[F.plates, PLATE_IDS, 'plate'], [F.eyes, EYE_IDS, 'eyes'], [F.faces, FACES, 'face']]) {
    for (const id of ids) {
      const f = map[id];
      assert.ok(f && typeof f.sprite === 'string' && f.sprite.startsWith(`/assets/souls/v3/${prefix}-${id}.png`), `${prefix} ${id}`);
      assert.ok(Array.isArray(f.rect) && f.rect.length === 4 && f.rect.every(Number.isFinite) && f.rect[2] > 0 && f.rect[3] > 0 && inside(f.rect), `${prefix} ${id} rect ${f.rect}`);
      assert.ok(existsSync(join(ROOT, f.sprite.split('?')[0])), `${f.sprite} on disk`);
    }
  }
  // the outline: M / c / z subpaths inside the viewBox with room for the die-cut, clear of the Bingo Star medallion
  const d = F.shape.silhouette;
  assert.match(d, /^(M[-\d. ]+(c[-\d. ]+)+z)+$/);
  const pts = pathPoints(d);
  assert.ok(pts.every(([x, y]) => x >= 5 && x <= VIEWBOX - 5 && y >= 5 && y <= VIEWBOX - 5), 'inside the viewBox');
  const reach = BADGE_MEDALLION.r + 1.3 + 5;
  for (const [x, y] of pts) if (Math.abs(y - BADGE_CENTER.cy) <= reach) assert.ok(x < BADGE_CENTER.cx - reach, `outline point (${x}, ${y}) under the badge`);
  // the antenna charm: one charm disc at the top of the figure, clear of the medallion, inside the viewBox
  const { x, y, r } = F.topper.front2d;
  assert.ok(r > 0 && x - r >= 0 && x + r <= VIEWBOX && y - r >= 0, `topper ${x} ${y} ${r}`);
  assert.ok(y <= Math.min(...pts.map((p) => p[1])) + r * 2, 'on the antenna, at the top of the outline');
  assert.ok(Math.hypot(BADGE_CENTER.cx - x, BADGE_CENTER.cy - y) > BADGE_MEDALLION.r + 1.3 + r + 4, 'clear of the Bingo Star');
});

test('delivered face data: a v3 Soul with every layer stays under 10 KB and draws the v3 outline with no eyes or orb', { skip }, () => {
  let max = 0;
  for (const [i, plate] of PLATE_IDS.entries()) {
    const cfg = v3Config({ plate, eyes: EYE_IDS[9 - i], face: FACES[i % 3], seed: `delivered-${plate}` });
    const svg = renderSoulSvg(cfg, { badge: 'bingo-star', size: 240 });
    assert.ok(svg.includes(`d="${SOUL_FACE.shape.silhouette}"`) && !svg.includes(EYE_WHITE) && !svg.includes(`cx="${ORB.cx}"`));
    const layers = soulSpriteLayers(cfg);
    assert.deepEqual(layers.slice(0, 3).map((l) => l.kind), ['plate', 'eyes', 'face']);
    if (decorUsable(SOUL_DECOR) && !(SOUL_DECOR.charm.missing || []).length) assert.equal(layers.length, 14);
    max = Math.max(max, Buffer.byteLength(svg));
  }
  assert.ok(max <= 10 * 1024, `worst case ${max} bytes`);
});
