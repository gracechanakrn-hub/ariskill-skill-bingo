// Test fixtures for the decorated Soul (D-29): a usable decor data object with the shape of packages/ui/soul-decor-data.js
// (never its values: the checked-in file may still be the hand-written stub) and hand-made v2 configs; for the v3 Soul
// (D-31) a face data object with the shape of packages/ui/soul-face-data.js (never its values either: the checked-in
// module is the stub placeholder until the first Blender build) and hand-made v3 configs. Imported by the soul-renderer
// v4, soul3d, accessibility, phone and Galaxy tests; node --test also runs it as a file with no tests.
import { CHARMS, FACES, CHARMS_BY_KIND, PLATE_IDS, EYE_IDS } from '../../game-rules/src/soul-catalog.js';

const MAP = Object.freeze({ x0: 100, sx: 70, y0: 178.6, sy: -70 });
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => Number((x / l).toFixed(5))); };

/** Ten front-hemisphere slots on a belly-and-sides pattern (fixture numbers, not the Blender slots). */
export function fixtureSlots({ size = 0.16, sink = 0.3 } = {}) {
  const spots = [[0, 0.46, 0.42], [-0.2, 0.28, 0.38], [0.2, 0.28, 0.38], [-0.16, 0.7, 0.4], [0.16, 0.7, 0.4], [-0.44, 0.44, 0.2], [0.44, 0.44, 0.2], [-0.34, 1.02, 0.24], [0.34, 1.02, 0.24], [0, 0.9, 0.4]];
  return spots.map((c, index) => ({
    index, centre: c, normal: norm([c[0] * 1.6, (c[1] - 0.6) * 0.4, 0.9]), up: [0, 1, 0], size, sink,
    front2d: { x: Number((MAP.x0 + MAP.sx * c[0]).toFixed(1)), y: Number((MAP.y0 + MAP.sy * c[1]).toFixed(1)), r: Number(((size * MAP.sx) / 2).toFixed(2)) },
  }));
}

/** A usable (generated-looking) decor data object; `over` replaces top-level keys. */
export function decorFixture(over = {}) {
  return {
    stub: false, version: 1, catalogVersion: 1, generator: 'test fixture',
    floor: -0.02189, height: 2.29087, gradientSpan: { top: 1.9, bottom: 0 },
    charm: { thickness: 0.2, files: Object.fromEntries(CHARMS.map((c) => [c.id, { glb: `/assets/souls/charms/${c.id}.glb?v=fx`, png: `/assets/souls/charms/${c.id}.png?v=fx` }])) },
    slots: fixtureSlots(),
    faces: Object.fromEntries(FACES.map((f) => [f, { glb: `/assets/souls/faces/face-${f}.glb?v=fx`, sprite: `/assets/souls/faces/face-${f}-front.png?v=fx` }])),
    sprite2d: { viewBox: 200, size: 800, map: { ...MAP } },
    ...over,
  };
}

/** A hand-made v2 config (the exact v2 key set and order): 4 technical, 4 core, 2 soft unless `charms` is given. */
export function v2Config(over = {}) {
  const t = CHARMS_BY_KIND.technical, c = CHARMS_BY_KIND.core, s = CHARMS_BY_KIND.soft;
  const charms = [t[0], c[3], s[1], t[7], c[12], t[21], s[30], c[40], t[44], c[27]];
  return { version: 2, catalog: 1, seed: '0f1be17ca9df8f', gradient: 0, glow: 1, face: 'nerdy', charms, constellation: [{ domain: 'Design', weight: 0.6 }], driftPhase: 0.25, ...over };
}

/** The neutral fallback (face null, charms [], gradient 0). */
export function neutralV2(seed = 'neutral') { return { version: 2, catalog: 1, seed, gradient: 0, glow: 0, face: null, charms: [], constellation: [], driftPhase: 0 }; }

const v3Url = (name, ext) => `/assets/souls/v3/${name}.${ext}?v=fx`;
const v3Part = (name, rect) => ({ glb: v3Url(name, 'glb'), sprite: v3Url(name, 'png'), rect });

/**
 * A usable (generated-looking) SOUL_FACE object for the 3D path: v3 body URLs, every plate / eye design / refitted kit,
 * and the antenna-charm slot (a charm slot tilted a little off the front, so its placement is not the identity basis).
 * `over` replaces top-level keys.
 */
export function faceDataFixture(over = {}) {
  return {
    stub: false, version: 1, catalogVersion: 2, generator: 'test fixture',
    frame: 'glTF model space of the baseline GLBs: +Y up, +Z front, model units, feet at y = floor',
    floor: -0.02189, height: 2.29087,
    body: { hero: v3Url('body-hero', 'glb'), lite: v3Url('body-lite', 'glb') },
    plates: Object.fromEntries(PLATE_IDS.map((id) => [id, v3Part(`plate-${id}`, [70, 70, 60, 52])])),
    eyes: Object.fromEntries(EYE_IDS.map((id) => [id, v3Part(`eyes-${id}`, [77, 86, 46, 20])])),
    faces: Object.fromEntries(FACES.map((f) => [f, v3Part(`face-${f}`, [70, 40, 60, 60])])),
    topper: { centre: [0.1027, 2.09, -0.02], normal: norm([0.05, 0.12, 1]), up: [0, 1, 0], size: 0.36, sink: 0, front2d: { x: 107.19, y: 32.3, r: 12.6 } },
    shape: { silhouette: 'M100 180c-30 0-50-10-46-40c4-30 20-90 46-90s42 60 46 90c4 30-16 40-46 40z' },
    source: { generator: 'test fixture' },
    ...over,
  };
}

/** The checked-in placeholder before the first Blender build (stub: true, null URLs, empty maps): never usable. */
export function stubFaceData() {
  return { stub: true, version: 1, catalogVersion: 2, generator: 'placeholder', body: { hero: null, lite: null }, plates: {}, eyes: {}, faces: {}, topper: null, shape: { silhouette: null }, source: {} };
}

/**
 * A hand-made v3 config (the exact v3 key set and order): the v2 fixture's charms, a face plate, eyes and a core star
 * on the antenna that is not one of the ten, unless `over` says otherwise.
 */
export function v3Config(over = {}) {
  const { charms } = v2Config();
  return { version: 3, catalog: 2, seed: '1ec3a1b6539cad', gradient: 0, glow: 1, face: 'nerdy', plate: 'bean', eyes: 'hearts', charms, topper: CHARMS_BY_KIND.core[0], constellation: [{ domain: 'Design', weight: 0.6 }], driftPhase: 0.25, ...over };
}
