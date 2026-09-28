// Stage 15 (D-36): the big screen's cinematic space backdrop (space.js + the Blender renders in assets/space):
// space.json normalisation and loading (a plain dark sky without it), the micro movement's bounds and speed (nothing
// near 3 Hz, the plate always covering the region), reduced motion and the 'low' level, the falling-star schedule
// (one at a time, fading in and out), and the renderers' wiring: the nebula / aurora shader, the forest, the fireflies
// and the doodad stickers are gone from every tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import {
  SPACE_BASE, SPACE_LIMITS, FALLING_STAR_FADE, normalizeSpace, spaceFiles, loadSpace, plateSize, backdropPlacement, constellationPlacement,
  constellationStars, starPeriod, meteorPose, fallingStarEvent, fallingStarAlpha, fallingStarAt,
} from '../src/renderer/space.js';
import { loadSceneAssets } from '../src/galaxy.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../../..');
const src = (p) => readFileSync(resolve(here, '../src', p), 'utf8');
/** The example of the brief (the orchestrator's schema). */
const EXAMPLE = {
  version: 1, region: { width: 1248, height: 1080 }, overscan: 1.1,
  backdrop: { file: 'backdrop.jpg', drift: { px: 12, periodS: 80 }, breathe: { amount: 0.012, periodS: 50 }, parallax: 0.35 },
  constellations: { file: 'constellations.png', lineShimmer: { amount: 0.25, periodS: 9 }, stars: [{ x: 0.18, y: 0.22, r: 2.4, b: 0.95, t: 0.13 }, { x: 0.3, y: 0.12, r: 1.8, b: 0.8, t: 0.61 }], twinkle: { amount: 0.35, periodS: 5.5 }, parallax: 0.5 },
  meteors: [{ file: 'meteor-1.png', x: 0.04, y: 0.9, size: 0.34, rotDeg: 0, spinDegPerS: 1.5, drift: { x: 0.006, y: 0.008, periodS: 26 }, front: true, parallax: 1.3 }],
  fallingStars: { file: 'falling-star.png', everyS: [6, 12], durationS: [0.9, 1.5], angleDeg: [15, 32], lengthFrac: [0.18, 0.32], area: [0.05, 0.03, 0.95, 0.5], maxAlpha: 0.9 },
};
const SPEC = normalizeSpace(EXAMPLE);
const W = 1248, H = 1080;
/** Direction changes per second of a sampled signal, halved: its highest repetition rate (Hz). */
/** Plates compared to a pixel's billionth (they come out of a cover fit). */
const near = (a, b, msg) => { for (const k of Object.keys(b)) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${msg || ''} ${k}: ${a[k]} vs ${b[k]}`); assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort()); };
/** Pixel size of a baseline / progressive JPEG (its SOF marker) or a VP8X / VP8 / VP8L WebP, from the file header. */
function imageSize(file) {
  const b = readFileSync(file);
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i < b.length;) {
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xc3) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) }; }
  }
  throw new Error(`${file}: not a JPEG / WebP`);
}
function hz(values, dt) {
  let prev = 0, turns = 0;
  for (let i = 1; i < values.length; i++) { const d = values[i] - values[i - 1]; const s = Math.abs(d) < 1e-12 ? 0 : Math.sign(d); if (s && prev && s !== prev) turns++; if (s) prev = s; }
  return turns / 2 / (dt * (values.length - 1));
}

test('space.json: the schema normalises (defaults, clamps, one falling star at a time); anything else is a plain dark sky', () => {
  assert.equal(SPEC.version, 1); assert.equal(SPEC.overscan, 1.1);
  assert.deepEqual(SPEC.backdrop, { file: 'backdrop.jpg', drift: { px: 12, periodS: 80 }, breathe: { amount: 0.012, periodS: 50 }, parallax: 0.35 });
  assert.equal(SPEC.constellations.stars.length, 2); assert.deepEqual(SPEC.meteors[0].drift, { x: 0.006, y: 0.008, periodS: 26 });
  assert.equal(SPEC.meteors[0].front, true);
  assert.deepEqual([...SPEC.fallingStars.everyS], [6, 12]);
  assert.ok(Object.isFrozen(SPEC) && Object.isFrozen(SPEC.constellations.stars[0]));
  for (const bad of [null, undefined, 'x', 42, {}, { version: 2 }, { version: 'one' }, []]) assert.equal(normalizeSpace(bad), null);
  const bare = normalizeSpace({ version: 1 });
  assert.deepEqual([bare.backdrop.file, bare.constellations.file, bare.meteors.length, bare.fallingStars], [null, null, 0, null], 'nothing to draw: a dark sky');
  // no data file can make the sky busy or a falling star overlap another
  const wild = normalizeSpace({ version: 1, backdrop: { file: 'b.jpg', drift: { px: 500, periodS: 0.05 }, breathe: { amount: 0.4, periodS: 0.1 } }, constellations: { twinkle: { amount: 3, periodS: 0.2 }, lineShimmer: { amount: -1, periodS: 0 } }, meteors: [{ file: 'm.webp', spinDegPerS: 720, drift: { x: 2, periodS: 0.01 } }, { file: '../etc/passwd.png' }, { file: 'x.gif' }], fallingStars: { file: 'f.webp', everyS: [0.1, 0.2], durationS: [3, 9], maxAlpha: 5 } });
  assert.equal(wild.backdrop.drift.px, SPACE_LIMITS.maxDriftPx); assert.equal(wild.backdrop.breathe.amount, SPACE_LIMITS.maxBreathe);
  for (const p of [wild.backdrop.drift.periodS, wild.backdrop.breathe.periodS, wild.constellations.twinkle.periodS, wild.constellations.lineShimmer.periodS, wild.meteors[0].drift.periodS]) assert.ok(p >= SPACE_LIMITS.minPeriodS);
  assert.deepEqual([wild.constellations.twinkle.amount, wild.constellations.lineShimmer.amount], [1, 0]);
  assert.equal(wild.meteors.length, 1, 'bad file names are left out'); assert.equal(wild.meteors[0].spinDegPerS, SPACE_LIMITS.maxSpinDegPerS);
  assert.ok(wild.fallingStars.everyS[0] >= wild.fallingStars.durationS[1] + 0.5, 'the gap is never shorter than a flight');
  assert.equal(wild.fallingStars.maxAlpha, SPACE_LIMITS.maxAlpha);
  assert.deepEqual(spaceFiles(SPEC), { backdrop: `${SPACE_BASE}/backdrop.jpg`, constellations: `${SPACE_BASE}/constellations.png`, meteors: [`${SPACE_BASE}/meteor-1.png`], fallingStar: `${SPACE_BASE}/falling-star.png` });
});

test('the shipped space.json (the Blender renders) is a usable spec whose files exist', () => {
  const dir = join(ROOT, 'assets/space');
  const raw = JSON.parse(readFileSync(join(dir, 'space.json'), 'utf8'));
  const spec = normalizeSpace(raw);
  assert.ok(spec, 'version 1');
  const files = spaceFiles(spec, dir);
  for (const f of [files.backdrop, files.constellations, files.fallingStar, ...files.meteors]) assert.ok(f && existsSync(f), `${f} on disk`);
  assert.equal(spec.meteors.length, raw.meteors.length, 'every meteor kept');
  assert.ok(spec.meteors.some((m) => m.front) && spec.constellations.stars.length > 0);
  for (const m of spec.meteors.filter((x) => x.front)) assert.ok(m.x < 0.12 || m.x > 0.88 || m.y < 0.12 || m.y > 0.88, `front meteor ${m.file} at a corner or edge, where Souls never go`);
  // D-57: the plates are rendered at 2 x for 4K screens; the layout region (what they cover) is unchanged
  assert.deepEqual(raw.region, { width: 1248, height: 1080 });
  const plate2x = { width: Math.round(1248 * raw.overscan * 2), height: Math.round(1080 * raw.overscan * 2) };
  assert.deepEqual(plate2x, { width: 2746, height: 2376 });
  assert.deepEqual(imageSize(files.backdrop), plate2x, 'backdrop.jpg decodes at 2 x the overscanned region');
  assert.deepEqual(imageSize(files.constellations), plate2x, 'constellations.webp decodes at 2 x the overscanned region');
});

test('loadSpace: space.json and its images through injectable loaders; a missing image leaves out its layer; no json, no space', async () => {
  const asked = [];
  const fetchImpl = async (u) => { asked.push(u); if (u.endsWith('/space.json')) return { ok: true, json: async () => EXAMPLE }; return { ok: false }; };
  const loadImage = async (u) => { asked.push(u); if (u.includes('meteor')) throw new Error('404'); return { src: u, width: 100, height: 50 }; };
  const s = await loadSpace({ base: '/x/space', fetchImpl, loadImage });
  assert.deepEqual(s.spec, SPEC);
  assert.equal(s.images.backdrop.src, '/x/space/backdrop.jpg'); assert.equal(s.images.constellations.src, '/x/space/constellations.png');
  assert.deepEqual(s.images.meteors, [null], 'the meteor that failed is left out');
  assert.equal(s.images.fallingStar.src, '/x/space/falling-star.png');
  assert.equal(asked[0], '/x/space/space.json');
  for (const fetchImpl2 of [async () => ({ ok: false, json: async () => ({}) }), async () => { throw new Error('offline'); }, async () => ({ ok: true, json: async () => { throw new SyntaxError('bad'); } }), async () => ({ ok: true, json: async () => ({ version: 7 }) })]) {
    assert.equal(await loadSpace({ fetchImpl: fetchImpl2, loadImage }), null);
  }
});

test('galaxy.js loads the space (assets/space) with its other scene files and hands it to every renderer; no nebula.svg any more', async () => {
  const had = { fetch: globalThis.fetch, Image: globalThis.Image };
  const served = (url) => join(ROOT, url.split('?')[0]);
  globalThis.fetch = async (u) => { const f = served(u); return existsSync(f) ? { ok: true, json: async () => JSON.parse(readFileSync(f, 'utf8')) } : { ok: false, json: async () => { throw new Error('404'); } }; };
  globalThis.Image = class { set src(v) { this._src = v; setTimeout(() => (existsSync(served(v)) ? this.onload && this.onload() : this.onerror && this.onerror()), 1); } get src() { return this._src; } get width() { return 1373; } get height() { return 1188; } };
  try {
    const assets = await loadSceneAssets('/assets/scene', '/tokens');
    assert.ok(assets.space && assets.space.spec, 'space.json from /assets/space');
    assert.ok(assets.space.images.backdrop && assets.space.images.constellations && assets.space.images.meteors.every(Boolean));
    assert.ok(!('nebula' in assets));
    const none = await loadSceneAssets('/assets/no-such-scene', '/tokens', '/assets/no-such-space');
    assert.equal(none.space, null, 'no space.json: a plain dark sky');
  } finally { globalThis.fetch = had.fetch; if (had.Image) globalThis.Image = had.Image; else delete globalThis.Image; }
  const galaxy = readFileSync(resolve(here, '../src/galaxy.js'), 'utf8');
  assert.match(galaxy, /const common = \{ container, atlas, space, background/);
  assert.doesNotMatch(galaxy, /nebula\.svg/);
});

test('micro movement: the backdrop drifts and breathes within bounds, always covering the region; nothing repeats near 3 Hz', () => {
  const dt = 1 / 30, T = 200;
  const xs = [], ys = [], ss = [], lines = [], stars = [], mx = [], my = [];
  for (let t = 0; t <= T; t += dt) {
    const cam = { dx: 12 * Math.sin(t / 7), dy: 7 * Math.cos(t / 9) };
    for (const [w, h] of [[W, H], [1040, 900], [1664, 1440], [1200, 1400]]) {
      const b = backdropPlacement(SPEC, w, h, t, { camera: cam, aspect: 1373 / 1188 });
      assert.ok(b.x - b.w / 2 <= 1e-9 && b.x + b.w / 2 >= w - 1e-9 && b.y - b.h / 2 <= 1e-9 && b.y + b.h / 2 >= h - 1e-9, `${w}x${h} covered at ${t.toFixed(2)}`);
    }
    const b = backdropPlacement(SPEC, W, H, t, { camera: cam });
    assert.ok(Math.abs(b.scale - 1) <= SPEC.backdrop.breathe.amount + 1e-12);
    assert.ok(Math.abs(b.x - W / 2) <= 12 + 12 * 0.35 + 1e-9 && Math.abs(b.y - H / 2) <= 12 * 0.6 + 7 * 0.35 + 1e-9);
    xs.push(b.x); ys.push(b.y); ss.push(b.scale);
    const plate = constellationPlacement(SPEC, W, H, t, { camera: cam });
    assert.ok(plate.alpha >= 1 - SPEC.constellations.lineShimmer.amount - 1e-12 && plate.alpha <= 1);
    lines.push(plate.alpha);
    const st = constellationStars(SPEC, plate, H, t);
    st.forEach((s, i) => { const b0 = SPEC.constellations.stars[i].b; assert.ok(s.a <= b0 + 1e-12 && s.a >= b0 * (1 - SPEC.constellations.twinkle.amount) - 1e-12); });
    stars.push(st[0].a);
    const m = meteorPose(SPEC.meteors[0], W, H, t);
    mx.push(m.x); my.push(m.y);
    assert.ok(Math.abs(m.x - SPEC.meteors[0].x * W) <= 0.006 * W + 1e-9 && m.y <= SPEC.meteors[0].y * H + 1e-9 && m.y >= (SPEC.meteors[0].y - 0.008) * H - 1e-9);
    assert.ok(Math.abs(m.rotDeg - 1.5 * t) < 1e-9, 'slow spin');
  }
  for (const [name, v] of Object.entries({ xs, ys, ss, lines, stars, mx, my })) assert.ok(hz(v, dt) < 1, `${name}: ${hz(v, dt).toFixed(3)} Hz`);
  // each star keeps its own period and phase (neighbours drift apart)
  assert.notEqual(starPeriod(SPEC, SPEC.constellations.stars[0]), starPeriod(SPEC, SPEC.constellations.stars[1]));
  // stars stay on the lines at any aspect: both are placed in the plate's frame
  const p1 = constellationPlacement(SPEC, 1200, 1400, 0, { reducedMotion: true, aspect: 1373 / 1188 });
  const s1 = constellationStars(SPEC, p1, 1400, 0, { reducedMotion: true })[0];
  assert.ok(Math.abs(s1.x - (p1.x + ((0.18 - 0.5) / 1.1) * p1.w)) < 1e-9);
  near(plateSize(SPEC, W, H), { w: W * 1.1, h: H * 1.1 });
  near(plateSize(SPEC, W, H, 2), { w: H * 1.1 * 2, h: H * 1.1 }, 'a wide image covers the height');
  near(plateSize(SPEC, W, H, 0.5), { w: W * 1.1, h: W * 1.1 * 2 }, 'a tall one the width');
});

test('reduced motion: every layer at rest and no falling star; low quality: no falling star and no meteor spin', () => {
  const cam = { dx: 9, dy: -5 };
  for (const t of [0, 3.3, 47, 600]) {
    near(backdropPlacement(SPEC, W, H, t, { camera: cam, reducedMotion: true }), { x: W / 2, y: H / 2, w: W * 1.1, h: H * 1.1, scale: 1 });
    const plate = constellationPlacement(SPEC, W, H, t, { camera: cam, reducedMotion: true });
    assert.equal(plate.alpha, 1); assert.deepEqual([plate.x, plate.y], [W / 2, H / 2]);
    assert.deepEqual(constellationStars(SPEC, plate, H, t, { reducedMotion: true }).map((s) => s.a), SPEC.constellations.stars.map((s) => s.b));
    const m = meteorPose(SPEC.meteors[0], W, H, t, { camera: cam, reducedMotion: true });
    assert.deepEqual([m.x, m.y, m.rotDeg], [SPEC.meteors[0].x * W, SPEC.meteors[0].y * H, SPEC.meteors[0].rotDeg]);
    assert.equal(meteorPose(SPEC.meteors[0], W, H, t, { quality: 'low' }).rotDeg, SPEC.meteors[0].rotDeg, 'low: no spin');
  }
  for (let t = 0; t < 400; t += 0.25) {
    assert.equal(fallingStarAt(SPEC, W, H, t, { reducedMotion: true }), null);
    assert.equal(fallingStarAt(SPEC, W, H, t, { quality: 'low' }), null);
  }
  assert.equal(fallingStarAt(normalizeSpace({ version: 1 }), W, H, 30), null, 'no falling stars in the spec');
});

test('falling stars: seeded schedule, one at a time every 6..12 s, each a single fade in and out along its angle', () => {
  const fs = SPEC.fallingStars;
  const events = Array.from({ length: 60 }, (_, k) => fallingStarEvent(fs, 'galaxy', k));
  assert.deepEqual(events.map((e) => e.start), Array.from({ length: 60 }, (_, k) => fallingStarEvent(fs, 'galaxy', k).start), 'deterministic');
  assert.notDeepEqual(events.map((e) => e.start), Array.from({ length: 60 }, (_, k) => fallingStarEvent(fs, 'other', k).start), 'another seed, another sky');
  assert.ok(events[0].start >= fs.everyS[0], 'the sky starts calm');
  events.forEach((e, k) => {
    if (k) { const gap = e.start - events[k - 1].start; assert.ok(gap >= fs.everyS[0] - 1e-9 && gap <= fs.everyS[1] + 1e-9, `gap ${gap}`); assert.ok(e.start >= events[k - 1].start + events[k - 1].durationS); }
    assert.ok(e.durationS >= fs.durationS[0] && e.durationS <= fs.durationS[1]);
    assert.ok(e.angleDeg >= fs.angleDeg[0] && e.angleDeg <= fs.angleDeg[1] && e.lengthFrac >= fs.lengthFrac[0] && e.lengthFrac <= fs.lengthFrac[1]);
    assert.ok(e.from[0] >= fs.area[0] && e.from[0] <= fs.area[2] && e.from[1] >= fs.area[1] && e.from[1] <= fs.area[3]);
  });
  // one flight: fades in over the first 15 %, out over the last 35 %, never above maxAlpha, moving along its angle
  const e = events[3];
  const at = (p) => fallingStarAt(SPEC, W, H, e.start + p * e.durationS, { seed: 'galaxy' });
  assert.equal(fallingStarAlpha(0, 0.9), 0); assert.equal(fallingStarAlpha(1, 0.9), 0);
  assert.ok(Math.abs(at(FALLING_STAR_FADE.in).alpha - 0.9) < 1e-9 && Math.abs(at(0.5).alpha - 0.9) < 1e-9);
  assert.ok(at(0.05).alpha < at(0.1).alpha && at(0.8).alpha > at(0.95).alpha, 'one rise, one fall');
  const a0 = at(0.001), a1 = at(0.6), ang = (e.angleDeg * Math.PI) / 180;
  assert.equal(a0.k, 3);
  assert.ok(Math.abs(Math.atan2(a1.y - a0.y, a1.x - a0.x) - ang) < 1e-6, 'along its angle (screen y down)');
  assert.ok(Math.abs(a0.length - e.lengthFrac * W) < 1e-9);
  assert.equal(fallingStarAt(SPEC, W, H, e.start - 0.01, { seed: 'galaxy' }), fallingStarAt(SPEC, W, H, e.start - 0.01, { seed: 'galaxy' }));
  // over an hour: about mean flight / mean gap of the time, never two at once, alpha a single rise and fall per star
  let lit = 0, frames = 0, lastK = -1;
  const alphas = new Map();
  for (let t = 0; t < 3600; t += 1 / 20) {
    frames++;
    const s = fallingStarAt(SPEC, W, H, t, { seed: 'galaxy' });
    if (!s) continue;
    lit++; assert.ok(s.k >= lastK); lastK = s.k;
    assert.ok(s.alpha >= 0 && s.alpha <= fs.maxAlpha + 1e-12);
    if (!alphas.has(s.k)) alphas.set(s.k, []);
    alphas.get(s.k).push(s.alpha);
  }
  const share = lit / frames;
  assert.ok(share > 0.08 && share < 0.2, `a falling star ${(share * 100).toFixed(1)} % of the time`);
  for (const [k, v] of alphas) assert.ok(hz(v, 1 / 20) * (v.length / 20) <= 1.01, `star ${k}: one fade in and out`);
});

test('renderers: the nebula / aurora shader, fireflies, forest and doodads are gone; every tier draws the space layers', () => {
  const three = src('renderer/three.js');
  for (const gone of [/doodadSvg|DOODAD_|doodadLayout|updateDoodads/, /paintForest|FOREST_LAYERS|forestPlanes/, /AURORA|auroraPhase|auroraU/, /FIREFLY|fireflies|ffMat/, /NEBULA_|nebula/]) assert.doesNotMatch(three, gone);
  assert.match(three, /import \{ backdropPlacement, constellationPlacement, constellationStars, meteorPose, fallingStarAt \} from '\.\/space\.js';/);
  assert.match(three, /const backdrop = spec \? spacePlane\(spaceImages\.backdrop, \{ renderOrder: 0, transparent: false, mipmaps: true \}\) : null;/);
  // D-57: the 2 x plates are mipmapped (with anisotropy) so a 1080p screen minifies them cleanly
  assert.match(three, /const constLines = spec \? spacePlane\(spaceImages\.constellations, \{ renderOrder: 1, mipmaps: true \}\) : null;/);
  assert.match(three, /map\.minFilter = mipmaps \? THREE\.LinearMipmapLinearFilter : THREE\.LinearFilter;/);
  assert.match(three, /if \(mipmaps\) map\.anisotropy = Math\.min\(8, renderer\.capabilities\.getMaxAnisotropy\(\)\);/);
  assert.match(three, /renderOrder: m\.front \? 70 : 5, parent: m\.front \? overlay : scene/, 'front meteors after the Souls, the rest behind the orbit');
  assert.match(three, /spacePlane\(spaceImages\.fallingStar, \{ renderOrder: 12, additive: true \}\)/);
  assert.match(three, /fallingStarAt\(spec, width, height, t, \{ seed, reducedMotion, quality: f\.quality \}\)/);
  assert.match(three, /const opts = \{ camera: reducedMotion \? null : f\.camera, reducedMotion \};/);
  for (const r of ['canvas2d.js', 'webgl2.js']) {
    const s = src(`renderer/${r}`);
    assert.match(s, /from '\.\/space\.js'/); assert.doesNotMatch(s, /nebula/);
    assert.match(s, /reducedMotion: true/, `${r}: the space layers at rest`);
    assert.match(s, /drawMeteors\(true\)/, `${r}: front meteors after the Souls`);
    assert.doesNotMatch(s, /fallingStar/, `${r}: no falling stars in the fallbacks`);
  }
  assert.match(src('renderer/static.js'), /createCanvas2dRenderer\(\{ \.\.\.opts, staticMode: true \}\)/, 'static = canvas2d at rest (space included)');
});
