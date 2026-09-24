// Soul renderer v2 (sticker language) - spec checks from docs/art/sticker-art-direction.md "Soul renderer spec".
// Run: node --test packages/ui/test   (the cohort/manifest checks live in tools/assets/test/souls.test.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSoulSvg, resolveSoul, soulAltText, TRAITS, PALETTES, BODY_PATHS, STICKER, SOUL_RENDERER_VERSION, BADGE_LABEL, BADGE_CENTER } from '../soul-renderer.js';
import { soulSeed, soulConfigFromSeed, SOUL_TRAITS } from '../../game-rules/src/soul.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tokens = JSON.parse(readFileSync(join(ROOT, 'packages/design-tokens/tokens.json'), 'utf8')).themes.dark.tokens;
const CONST = [{ domain: 'Design', weight: 0.4 }, { domain: 'Cloud', weight: 0.3 }, { domain: 'Development', weight: 0.15 }];
const sample = { seed: 'abc123', body: 0, palette: 1, eyes: 0, antenna: 0, mouth: 0, glow: 0, constellation: CONST, driftPhase: 0.42 };
const MAX_BYTES = 6 * 1024;
const count = (s, re) => (s.match(re) || []).length;

test('v2: same seed gives the same Soul, byte for byte, at every detail level and size', () => {
  assert.equal(SOUL_RENDERER_VERSION, '2.0.0');
  for (let i = 0; i < 40; i++) {
    const seed = soulSeed({ eventId: 'evt', participantId: `p${i}`, roundId: 'r1' });
    const cfg = soulConfigFromSeed(seed, { Design: 3, Cloud: 2 });
    for (const detail of ['full', 'simple', 'dot']) {
      const a = renderSoulSvg(cfg, { detail, badge: i % 3 ? null : 'bingo-star', size: 240 });
      const b = renderSoulSvg(JSON.parse(JSON.stringify(cfg)), { detail, badge: i % 3 ? null : 'bingo-star', size: 240 });
      assert.equal(a, b);
    }
  }
  // different seeds with identical traits differ only in the seeded speckles
  const x = renderSoulSvg({ ...sample, seed: 's1' }, { idPrefix: 'k', reducedMotion: true }), y = renderSoulSvg({ ...sample, seed: 's2' }, { idPrefix: 'k', reducedMotion: true });
  assert.notEqual(x, y);
  const noSpeck = (s) => s.replace(/ data-soul="[^"]*"/, '').replace(/<g clip-path="url\(#k-c\)"[\s\S]*?<\/g><\/g>/, '');
  assert.equal(noSpeck(x), noSpeck(y));
});

test('v2 look: radial clay body, peach rim, blurred top highlight, seeded speckles clipped to the body, lit orb, white die-cut + shadow', () => {
  const svg = renderSoulSvg(sample, { reducedMotion: true, idPrefix: 'v' });
  assert.match(svg, /<radialGradient id="v-b"[^>]*><stop offset="0" stop-color="#E9F6FF"\/><stop offset="\.3" stop-color="#7CC8FF"\/><stop offset="1" stop-color="#3B2A7A"\/>/, '3-stop body gradient: palette light -> base -> violet-deep');
  assert.ok(svg.includes(`<use href="#v-p" fill="url(#v-b)"`), 'body filled with the clay gradient');
  assert.match(svg, /<linearGradient id="v-r"[^>]*><stop offset="\.45" stop-color="#FFB27A" stop-opacity="0"\/><stop offset="1" stop-color="#FFB27A" stop-opacity="\.4"\/>/, 'peach rim at 40 % on the lower right');
  assert.ok(svg.includes('stroke="url(#v-r)" stroke-width="3.3" clip-path="url(#v-c)"'), 'rim is an inner stroke (clipped to the body), 2 px at 240 px');
  assert.match(svg, /<ellipse[^>]*fill="#fff" opacity="\.22" filter="url\(#v-h\)"\/>/, 'top highlight ellipse 22 % white, blurred');
  assert.match(svg, /<filter id="v-h"[^>]*><feGaussianBlur stdDeviation="1\.7"\/>/, 'highlight blur 2 px at 240 px');
  assert.match(svg, /<radialGradient id="v-o"><stop offset="0" stop-color="#fff"\/><stop offset="\.45" stop-color="#E9F6FF"\/><stop offset="1" stop-color="#E9F6FF" stop-opacity="0"\/>/, 'orb glow: white core, palette light, transparent');
  assert.ok(svg.includes('r="13" fill="url(#v-o)"/><circle cx="100" cy="35" r="6.5" fill="none" stroke="#2E4DB8" stroke-width="1.7"'), 'orb glow + 2 px outline');
  assert.match(svg, /<use href="#v-s" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round" filter="url\(#v-d\)"\/>/, 'die-cut: whole figure as a white stroke (6 px outside at 240 px) with the sticker shadow');
  assert.match(svg, /<feDropShadow dx="0" dy="5" stdDeviation="5\.8" flood-color="#05081E" flood-opacity="0\.55"\/>/, '--sticker-shadow 0 6px 14px rgba(5,8,30,.55) scaled to the viewBox');
  assert.ok(svg.includes(`<g id="v-s"><use href="#v-p"/><ellipse cx="84" cy="168"`), 'silhouette group = body + feet + antenna');
  const speck = svg.match(/<g clip-path="url\(#v-c\)" filter="url\(#v-k\)">([\s\S]*?)<\/g><\/g>/);
  assert.ok(speck, 'speckles are clipped to the body and blurred at full detail');
  const dots = count(speck[1], /<circle /g);
  assert.ok(dots >= 9 && dots <= 14, `9-14 speckles, got ${dots}`);
  for (const m of speck[1].matchAll(/<g fill="(#[0-9A-F]{6})">/g)) assert.ok(STICKER.speckle.includes(m[1]), 'speckle colours: mint / cyan / lilac tint');
  const radii = [...speck[1].matchAll(/ r="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(radii.every((r) => (r >= 2.5 && r <= 3.4) || (r >= 5 && r <= 6.7)), `two speckle sizes (3-4 px and 6-8 px at 240 px): ${radii}`);
  assert.ok(svg.includes(`fill="${STICKER.rose}" stroke="#fff"`), 'rose heart belly with a white outline');
});

test('speckle count and sizes come from the seed only: 9-14 for every seed, independent of traits, badge and constellation', () => {
  const counts = new Set();
  for (let i = 0; i < 300; i++) {
    const seed = soulSeed({ eventId: 'e', participantId: `p${i}`, roundId: 'r' });
    const cfg = soulConfigFromSeed(seed, {});
    const svg = renderSoulSvg(cfg, { reducedMotion: true, idPrefix: 'q' });
    const speck = svg.match(/<g clip-path="url\(#q-c\)" filter="url\(#q-k\)">([\s\S]*?)<\/g><\/g>/)[1];
    const c = count(speck, /<circle /g);
    assert.ok(c >= 9 && c <= 14, `${seed}: ${c}`);
    counts.add(c);
    const withBadge = renderSoulSvg({ ...cfg, constellation: CONST }, { reducedMotion: true, idPrefix: 'q', badge: 'bingo-star' });
    assert.equal(withBadge.match(/<g clip-path="url\(#q-c\)" filter="url\(#q-k\)">([\s\S]*?)<\/g><\/g>/)[1], speck, 'badge/constellation never change the speckles');
  }
  assert.equal(counts.size, 6, 'all six counts (9..14) occur across seeds');
});

test('all six bodies x eight palettes render at 240 px full and 64 px simple, SVG only, no text, no rank marks, under 6 KB', () => {
  for (let b = 0; b < 6; b++) for (let p = 0; p < 8; p++) {
    for (const [detail, size] of [['full', 240], ['simple', 64]]) {
      const svg = renderSoulSvg({ ...sample, body: b, palette: p, eyes: b, antenna: p % 6, mouth: b % 4, glow: p % 3 }, { detail, size, badge: 'bingo-star' });
      assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"') && svg.includes(`width="${size}" height="${size}"`), 'output size/API unchanged');
      assert.ok(!/<text|<image|<foreignObject|<script|href="http|data:image/.test(svg), 'no text, no raster');
      assert.ok(!/level|lv\.|rank|score|tier|unlock/i.test(svg.replace(/aria-label="[^"]*"/g, '')), 'no rank/level marks');
      assert.ok(Buffer.byteLength(svg) <= MAX_BYTES, `${detail} ${b}/${p}: ${Buffer.byteLength(svg)} bytes`);
      assert.ok(svg.includes(`d="${BODY_PATHS[TRAITS.body[b]]}"`), 'silhouettes unchanged');
      assert.ok(svg.includes(PALETTES[p].fill), 'palette base used');
      assert.ok(svg.includes(`stroke="${PALETTES[p].outline}" stroke-width="4.5"`), 'same body line weight for every Soul');
    }
  }
});

test("detail 'simple': 3 px die-cut, no filters (no speckle blur, flat offset shadow), still speckled, outlined and lit", () => {
  const simple = renderSoulSvg(sample, { detail: 'simple', badge: 'bingo-star', idPrefix: 's' });
  const full = renderSoulSvg(sample, { detail: 'full', badge: 'bingo-star', idPrefix: 's' });
  assert.ok(!simple.includes('<filter') && !simple.includes('filter=') && !simple.includes('<animate'));
  assert.match(simple, /<use href="#s-s" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round"\/>/, '3 px outside at 240 px');
  assert.match(simple, /<use href="#s-s" fill="#05081E" stroke="#05081E" stroke-width="5" stroke-linejoin="round" transform="translate\(0 5\)" opacity="\.45"\/>/, 'flat offset shadow');
  assert.ok(simple.includes('<g clip-path="url(#s-c)"><g fill="'), 'speckles kept, unblurred');
  assert.ok(simple.includes('fill="url(#s-o)"'), 'antenna orb still lit');
  assert.ok(simple.includes(BADGE_LABEL));
  assert.ok(simple.length < full.length);
  assert.ok(simple.includes('data-detail="simple"'));
  // dot is unchanged from v1 (24 px disc that always renders)
  const dot = renderSoulSvg(sample, { detail: 'dot', badge: 'bingo-star' });
  assert.ok(dot.length < 1024 && !dot.includes(BADGE_LABEL) && dot.includes('r="26"'));
});

test('Bingo Star badge: gold five-point star with a white outline, upper right, clear of the face, semantics unchanged', () => {
  const svg = renderSoulSvg(sample, { badge: 'bingo-star' });
  assert.ok(svg.includes(`<g role="img" aria-label="${BADGE_LABEL}" transform="translate(${BADGE_CENTER.cx} ${BADGE_CENTER.cy})"><title>${BADGE_LABEL}</title>`));
  assert.match(svg, /<path d="M0 -12\.4L[^"]+Z" fill="#F6C453" stroke="#fff" stroke-width="2\.6" stroke-linejoin="round"\/>/);
  assert.ok(BADGE_CENTER.cx > 100 && BADGE_CENTER.cy < 84, 'upper right');
  assert.ok(Math.hypot(BADGE_CENTER.cx - 100, BADGE_CENTER.cy - 84) > 25 + BADGE_CENTER.r + 10, 'never touches the face disc');
  assert.ok(BADGE_CENTER.cx + BADGE_CENTER.r <= 200 && BADGE_CENTER.cy - BADGE_CENTER.r >= 0);
  assert.ok(!renderSoulSvg(sample).includes(BADGE_LABEL));
  assert.equal(soulAltText(sample, 'bingo-star'), 'Arise Soul, lagoon drop with dot eyes. Bingo Star badge: completed a line this round');
  // the badge is not part of the config and never changes the body
  const strip = (s) => s.replace(/<g role="img"[\s\S]*?<\/g>/, '').replace(/aria-label="[^"]*"/, '');
  assert.equal(strip(renderSoulSvg(sample, { badge: 'bingo-star', reducedMotion: true })), strip(renderSoulSvg(sample, { reducedMotion: true })));
});

test('universal and non-ranking: no trait, speckle or outline depends on anything but the seed-derived config', () => {
  // resolveSoul ignores forbidden inputs entirely
  const a = resolveSoul({ ...sample, platformId: 'x', roleId: 'y', rank: 1, isWinner: true, score: 99 });
  const b = resolveSoul(sample);
  assert.deepEqual(a, b);
  assert.equal(renderSoulSvg({ ...sample, platformId: 'x', roleId: 'y', rank: 1, isWinner: true, score: 99 }), renderSoulSvg(sample));
  // every Soul gets the same die-cut width, shadow, glow radius and highlight regardless of traits
  for (const kind of Object.keys(TRAITS)) for (let i = 0; i < TRAITS[kind].length; i++) {
    const svg = renderSoulSvg({ ...sample, [kind]: i }, { reducedMotion: true, idPrefix: 'u' });
    assert.ok(svg.includes('stroke-width="10" stroke-linejoin="round" filter="url(#u-d)"'), `${kind} ${i}: same die-cut`);
    assert.ok(svg.includes('<circle cx="100" cy="112" r="86"'), `${kind} ${i}: same glow radius`);
    assert.ok(svg.includes('<ellipse cx="80" cy="60" rx="13" ry="6.5"'), `${kind} ${i}: same highlight`);
  }
  // trait vocabulary still equals the locked game-rules vocabulary (seed -> config mapping untouched)
  for (const k of Object.keys(SOUL_TRAITS)) assert.deepEqual([...TRAITS[k]], [...SOUL_TRAITS[k]]);
});

test('sticker constants mirror design-tokens 1.2.0 (renderer stays import-free)', () => {
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
