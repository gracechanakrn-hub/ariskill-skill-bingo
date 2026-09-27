// Soul decoration catalog invariants (D-29, docs/art/soul-decorations.md "Catalog" and "Invariants and tests"; BR-17, req 9.1).
// Catalog 2 (D-31, docs/art/soul-faces.md "Catalog 2") adds the face plates and eye designs of the v3 Soul.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SOUL_CATALOG, CATALOG_VERSION, SLOT_COUNT, KINDS, FACE_BY_KIND, FACES, GRADIENTS, CHARMS, CHARM_BY_ID, CHARMS_BY_KIND, PLATES, PLATE_IDS, EYES, EYE_IDS, skillKindOf,
} from '../src/soul-catalog.js';
import { SOUL_TRAITS } from '../src/soul.js';
import { SKILL_MASTER } from './helpers.js';

/** Relative luminance: sRGB -> linear, Rec.709 weights. */
function luminance(hex) {
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const HEX = /^#[0-9A-F]{6}$/i;

test('150 charms with unique ids, 50 per kind, lists and lookups agree', () => {
  assert.equal(CATALOG_VERSION, 2); assert.equal(SLOT_COUNT, 10);
  assert.deepEqual(KINDS, ['core', 'technical', 'soft'], 'tie-break order core > technical > soft');
  assert.equal(CHARMS.length, 150);
  assert.equal(new Set(CHARMS.map(c => c.id)).size, 150);
  assert.equal(CHARM_BY_ID.size, 150);
  for (const k of KINDS) {
    assert.equal(CHARMS_BY_KIND[k].length, 50, k);
    assert.deepEqual([...CHARMS_BY_KIND[k]], CHARMS.filter(c => c.kind === k).map(c => c.id), `${k} in catalog order`);
  }
  for (const c of CHARMS) {
    assert.ok(KINDS.includes(c.kind), c.id); assert.equal(typeof c.name, 'string'); assert.ok(c.name.length > 0, c.id);
    assert.match(c.id, /^[a-z0-9]+(-[a-z0-9]+)+$/, 'ids are lowercase slugs'); assert.ok(!c.id.startsWith('skill_'), 'no skill id is a charm id');
    for (const k of ['size', 'scale', 'rarity', 'tier', 'rank', 'power', 'weight']) assert.ok(!(k in c), `${c.id} has no ${k} (every charm is the same size, BR-17)`);
  }
});

test('stars: 10 shapes x 5 shades, each pair exactly once; the 5 shades share one fill brightness', () => {
  const { starShapes, starShades } = SOUL_CATALOG;
  assert.equal(starShapes.length, 10); assert.equal(starShades.length, 5);
  const shapes = new Set(starShapes.map(s => s.id)), shades = new Set(starShades.map(s => s.id));
  assert.equal(shapes.size, 10); assert.equal(shades.size, 5);
  const pairs = new Set();
  for (const c of CHARMS.filter(x => x.kind === 'core')) { assert.ok(shapes.has(c.shape), c.id); assert.ok(shades.has(c.shade), c.id); pairs.add(`${c.shape}|${c.shade}`); }
  assert.equal(pairs.size, 50);
  const fills = starShades.map(s => { assert.match(s.fill, HEX); return luminance(s.fill); });
  assert.ok(Math.max(...fills) - Math.min(...fills) <= 0.01, `star fills ${fills.map(v => v.toFixed(4))}`);
});

test('12 gradients with one mean relative luminance (0.575 +- 0.01, within 0.01 of one another); the first 8 keep the v1 palette names', () => {
  assert.equal(GRADIENTS.length, 12);
  assert.equal(new Set(GRADIENTS.map(g => g.id)).size, 12);
  assert.deepEqual(GRADIENTS.slice(0, 8).map(g => g.id), [...SOUL_TRAITS.palette]);
  const means = GRADIENTS.map(g => {
    for (const k of ['top', 'bottom', 'highlight', 'outline', 'glow']) assert.match(g[k], HEX, `${g.id}.${k}`);
    return (luminance(g.top) + luminance(g.bottom)) / 2;
  });
  for (const [i, m] of means.entries()) assert.ok(Math.abs(m - 0.575) <= 0.01, `${GRADIENTS[i].id} mean luminance ${m.toFixed(4)}`);
  assert.ok(Math.max(...means) - Math.min(...means) <= 0.01, `spread ${(Math.max(...means) - Math.min(...means)).toFixed(4)}`);
  assert.deepEqual(SOUL_CATALOG.gradientSpan, { top: 1.9, bottom: 0, space: 'srgb' });
});

test('faces: FACE_BY_KIND covers every kind with a distinct face, each described', () => {
  assert.deepEqual(FACE_BY_KIND, { core: 'nerdy', technical: 'pirate', soft: 'angel' });
  for (const k of KINDS) assert.ok(FACES.includes(FACE_BY_KIND[k]), k);
  assert.equal(new Set(FACES).size, KINDS.length);
  for (const f of FACES) assert.equal(typeof SOUL_CATALOG.faceInfo[f]?.description, 'string', f);
});

test('catalog 2: 10 face plates and 10 eye designs, ids and names exactly as docs/art/soul-faces.md, in that order', () => {
  assert.equal(SOUL_CATALOG.version, 2);
  assert.deepEqual(PLATES.map(p => [p.id, p.name]), [
    ['crack', 'lightning crack'], ['bean', 'bean'], ['notch', 'notched'], ['skull-x', 'skull with a scar'], ['bow', 'bow'],
    ['round', 'round'], ['bat', 'bat wing'], ['dome', 'dome'], ['skull', 'skull'], ['cracked-bow', 'cracked bow'],
  ]);
  assert.deepEqual(EYES.map(e => [e.id, e.name]), [
    ['button', 'button eyes'], ['lashes', 'closed eyes with lashes'], ['hearts', 'heart eyes'], ['sleepy', 'sleepy eyes'], ['wink', 'a blue eye and a cross eye'],
    ['sparkle', 'sparkle eyes'], ['fierce', 'fierce cream eyes'], ['fierce-red', 'fierce red eyes'], ['bead', 'bead eyes'], ['happy', 'happy squint eyes'],
  ]);
  for (const [list, ids, what] of [[PLATES, PLATE_IDS, 'plate'], [EYES, EYE_IDS, 'eyes']]) {
    assert.equal(list.length, 10, what); assert.equal(new Set(ids).size, 10, `${what} ids are unique`);
    assert.deepEqual([...ids], list.map(x => x.id), `${what} ids in catalog order`);
    for (const x of list) {
      assert.deepEqual(Object.keys(x), ['id', 'name'], `${what} ${x.id}: id and name only (no size, rarity or tier, BR-17)`);
      assert.match(x.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are lowercase slugs');
      assert.equal(typeof x.name, 'string'); assert.ok(x.name.trim().length > 0, `${what} ${x.id} has a name`);
      assert.ok(!CHARM_BY_ID.has(x.id) && !FACES.includes(x.id), `${what} ${x.id} is not a charm or face id`);
    }
  }
  assert.ok(Object.isFrozen(PLATES) && Object.isFrozen(PLATE_IDS) && Object.isFrozen(EYES) && Object.isFrozen(EYE_IDS));
  assert.ok(PLATES.every(Object.isFrozen) && EYES.every(Object.isFrozen));
});

test('skill kinds: every skill-master kind label maps to a catalog kind; the draw flags are not labels', () => {
  const labels = new Set(SKILL_MASTER.skills.map(s => s.kind));
  assert.deepEqual([...labels].sort(), ['Core Skill', 'Hard Skill', 'Soft Skill']);
  assert.equal(skillKindOf('Core Skill'), 'core'); assert.equal(skillKindOf('Hard Skill'), 'technical'); assert.equal(skillKindOf('Soft Skill'), 'soft');
  for (const bad of ['Core', 'Critical Skill', 'core', undefined, null, 'toString', '__proto__']) assert.equal(skillKindOf(bad), null, String(bad));
});

test('the catalog is frozen data and its JSON block parses as strict JSON (build tools read it without a JS engine)', () => {
  assert.ok(Object.isFrozen(SOUL_CATALOG) && Object.isFrozen(CHARMS) && Object.isFrozen(CHARMS[0]) && Object.isFrozen(GRADIENTS[0]));
  const src = readFileSync(new URL('../src/soul-catalog.js', import.meta.url), 'utf8');
  const block = src.split('// BEGIN SOUL_CATALOG_JSON\nconst DATA = ')[1].split(';\n// END SOUL_CATALOG_JSON')[0];
  assert.deepEqual(JSON.parse(block), JSON.parse(JSON.stringify(SOUL_CATALOG)));
});
