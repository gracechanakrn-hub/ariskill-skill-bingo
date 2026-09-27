// Test fixtures for the v3 Soul (stage 13, D-31, docs/art/soul-faces.md): a usable face data object with the shape of
// packages/ui/soul-face-data.js (never its values: the checked-in file may still be the stub placeholder), the stub
// placeholder itself, hand-made v3 configs, and the v2 inputs whose renderer 4.0.0 output the v5 tests pin byte for
// byte. Imported by the soul-renderer v5 and accessibility tests; node --test also runs it as a file with no tests.
import { CHARMS, CHARMS_BY_KIND, FACES, PLATE_IDS, EYE_IDS } from '../../game-rules/src/soul-catalog.js';

/** A v3 body outline in the baseline MAPPING (fixture numbers: a closed cubic path with the antenna stalk, no orb). */
export const FIXTURE_SILHOUETTE = 'M100 180.1c-16 0-40-2-46-12c-5-9 4-22 10-34c9-18 6-44 12-62c6-16 18-22 26-26c3-2 4-6 4-10c0-5 1-8 1-10c1 0 2 3 2 8c0 4 1 8 4 10c8 6 12 16 11 28c6 18 3 44 12 62c6 12 15 25 10 34c-6 10-30 12-46 12z';

const url = (name, ext) => `/assets/souls/v3/${name}.${ext}?v=fx`;
const part = (name, rect) => ({ glb: url(name, 'glb'), sprite: url(name, 'png'), rect });

/** A usable (generated-looking) face data object; every plate and eye design gets its own rect. `over` replaces top-level keys. */
export function faceFixture(over = {}) {
  return {
    stub: false, version: 1, catalogVersion: 2, generator: 'test fixture',
    frame: 'glTF model space of the baseline GLBs: +Y up, +Z front, model units, feet at y = floor',
    floor: -0.02189, height: 2.29087,
    body: { hero: url('body-hero', 'glb'), lite: url('body-lite', 'glb') },
    plates: Object.fromEntries(PLATE_IDS.map((id, i) => [id, part(`plate-${id}`, [70 + i * 0.4, 70.25, 60 - i * 0.8, 52])])),
    eyes: Object.fromEntries(EYE_IDS.map((id, i) => [id, part(`eyes-${id}`, [77, 86 + i * 0.3, 46, 20.5])])),
    faces: { nerdy: part('face-nerdy', [72, 83, 56, 26]), pirate: part('face-pirate', [62.5, 50, 80, 62.75]), angel: part('face-angel', [74, 12, 52, 20]) },
    topper: { centre: [0.1027, 2.1, -0.064], normal: [0, 0, 1], up: [0, 1, 0], size: 0.36, sink: 0, front2d: { x: 107.19, y: 31.6, r: 12.6 } },
    shape: { silhouette: FIXTURE_SILHOUETTE },
    source: { generator: 'test fixture' },
    ...over,
  };
}

/** The checked-in placeholder before the first build (stub: true, empty maps): never usable. */
export function stubFace() {
  return { stub: true, version: 1, catalogVersion: 2, generator: 'placeholder', body: { hero: null, lite: null }, plates: {}, eyes: {}, faces: {}, topper: null, shape: { silhouette: null }, source: {} };
}

/**
 * A hand-made v3 config (the exact v3 key set and order): 4 technical, 4 core, 2 soft charms and a core star on the
 * antenna unless `over` says otherwise.
 */
export function v3Config(over = {}) {
  const t = CHARMS_BY_KIND.technical, c = CHARMS_BY_KIND.core, s = CHARMS_BY_KIND.soft;
  const charms = [t[0], c[3], s[1], t[7], c[12], t[21], s[30], c[40], t[44], c[27]];
  return { version: 3, catalog: 2, seed: '1ec3a1b6539cad', gradient: 0, glow: 1, face: 'nerdy', plate: 'bean', eyes: 'hearts', charms, topper: c[0], constellation: [{ domain: 'Design', weight: 0.6 }], driftPhase: 0.25, ...over };
}

/**
 * The v2 inputs whose renderer 4.0.0 output (SVG, sprite layers, alt text) the v5 tests pin byte for byte: their own
 * decor data (one charm listed as not built), so the pin never moves with the shared decor fixture or a regenerated
 * soul-decor-data.js; 48 configs over every gradient, face and glow with four charm sets (split, none, one kind,
 * unknown / missing / null ids).
 */
export function v2PinCases() {
  const files = Object.fromEntries(CHARMS.map((c) => [c.id, { glb: `/assets/souls/charms/${c.id}.glb?v=pin`, png: `/assets/souls/charms/${c.id}.png?v=pin` }]));
  const slots = Array.from({ length: 10 }, (_, index) => ({ index, front2d: { x: 78 + (index % 5) * 11, y: 118 + Math.floor(index / 5) * 22 + index * 0.37, r: 7 } }));
  const faces = Object.fromEntries(FACES.map((f) => [f, { glb: `/assets/souls/faces/face-${f}.glb?v=pin`, sprite: `/assets/souls/faces/face-${f}-front.png?v=pin` }]));
  const decor = { stub: false, charm: { thickness: 0.3, files, missing: ['core-classic-peach'] }, slots, faces, sprite2d: { viewBox: 200 } };
  const t = CHARMS_BY_KIND.technical, c = CHARMS_BY_KIND.core, s = CHARMS_BY_KIND.soft;
  const sets = [[t[0], c[3], s[1], t[7], c[12], t[21], s[30], c[40], t[44], c[27]], [], s.slice(0, 10), [c[0], 'nope', 'core-classic-peach', null, t[3]]];
  const configs = [];
  for (let gradient = 0; gradient < 12; gradient++) {
    [...FACES, null].forEach((face, fi) => {
      configs.push({ version: 2, catalog: 1, seed: `pin-${gradient}-${face}!`, gradient, glow: (gradient + fi) % 3, face, charms: sets[(gradient + fi) % 4], constellation: [], driftPhase: (gradient * 4 + fi) / 48 });
    });
  }
  return { decor, configs };
}
