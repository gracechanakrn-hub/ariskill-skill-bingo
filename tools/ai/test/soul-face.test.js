// Pure parts of tools/ai/blender/soul_face.py (plain python3 + numpy + PIL, no Blender): the traced plate designs, the
// eye designs, the plate fitting (every plate holds every eye design), the antenna-charm slot, the data module and the
// provenance of the staged files (D-31, docs/art/soul-faces.md).
// Run: node --test tools/ai/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ROOT } from '../env.js';
import { PLATE_IDS, EYE_IDS, FACES, CHARM_BY_ID } from '../../../packages/game-rules/src/soul-catalog.js';
import { SOUL_FACE } from '../../../packages/ui/soul-face-data.js';

const SCRIPT_DIR = join(ROOT, 'tools', 'ai', 'blender');
const SCRIPT = join(SCRIPT_DIR, 'soul_face.py');
const GEN = join(ROOT, 'assets-src', 'generated', 'soul-face', 'v1');
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function py(code, timeout = 240000) {
  const r = spawnSync('python3', ['-c', `import sys, json\nsys.path.insert(0, ${JSON.stringify(SCRIPT_DIR)})\nsys.dont_write_bytecode = True\nimport soul_face as sf\nimport numpy as np\n${code}`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout, cwd: ROOT });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('script compiles without bpy; plate, eye and face ids come from the catalog', () => {
  const r = py(`print(json.dumps({'plates': sf.PLATES, 'eyes': sf.EYES, 'faces': sf.FACES, 'bpy': sf.bpy is None}))`);
  assert.deepEqual(r.plates, [...PLATE_IDS]);
  assert.deepEqual(r.eyes, [...EYE_IDS]);
  assert.deepEqual(r.faces, [...FACES]);
  assert.equal(r.bpy, true);
});

test('traced plates: one clean design per catalog plate, hashes as plates.json records, traced from the reference sheet', () => {
  const doc = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'soul-face', 'plates.json'), 'utf8'));
  assert.equal(doc.sourceSha256, sha(join(ROOT, 'docs', 'art', 'reference', 'soul-faces-reference.png')));
  assert.deepEqual(Object.keys(doc.plates), [...PLATE_IDS]);
  for (const [id, rec] of Object.entries(doc.plates)) {
    const file = join(ROOT, rec.file);
    assert.ok(existsSync(file), id);
    assert.equal(rec.sha256, sha(file), `${id} design changed since the trace`);
    assert.ok(rec.aspect > 0.55 && rec.aspect < 1.05, `${id} aspect ${rec.aspect}`);
  }
  assert.deepEqual(Object.keys(doc.plates).filter((id) => doc.plates[id].ink).sort(), ['crack', 'cracked-bow', 'skull-x']);
});

test('eye designs: both eyes of every design fit the eye frame, colours are valid, only the wink differs by side', () => {
  const r = py(`
out = {}
g = np.linspace(-1.5, 1.5, 151)
U = np.stack(np.meshgrid(g, g, indexing='ij'), -1).reshape(-1, 2)
for eid in sf.EYES:
    sides = {}
    for side in (1, -1):
        pcs = sf.eye_pieces(eid, side)
        cover = np.zeros(len(U), bool)
        for pc in pcs:
            cover |= pc['f'](U) <= 0
            sf.colour_at(pc['top'], U[:3])
        Q = U[cover]
        sides[side] = {'n': len(pcs), 'names': [p['name'] for p in pcs], 'reach': float(np.abs(Q).max()), 'area': int(cover.sum())}
    out[eid] = sides
print(json.dumps(out))`);
  assert.deepEqual(Object.keys(r), [...EYE_IDS]);
  for (const [id, s] of Object.entries(r)) {
    for (const side of ['1', '-1']) {
      assert.ok(s[side].area > 150, `${id} side ${side} draws something`);
      assert.ok(s[side].reach <= 1.25, `${id} side ${side} reaches ${s[side].reach} eye radii`);
    }
    if (id === 'wink') assert.notDeepEqual(s['1'].names, s['-1'].names);
    else assert.deepEqual(s['1'].names, s['-1'].names, id);
  }
});

test('plate fitting: every plate holds every eye design with the margin and stays between the charms and the bandana brim', () => {
  const r = py(`print(json.dumps({'fits': sf.fit_plates(), 'face': sf.FACE}))`);
  const { fits, face } = r;
  assert.deepEqual(Object.keys(fits), [...PLATE_IDS]);
  for (const [id, f] of Object.entries(fits)) {
    assert.ok(f.eyeRoom >= face.eye_margin - 1e-9, `${id} eye room ${f.eyeRoom}`);
    assert.ok(f.bottom >= face.plate_bottom - 1e-6 && f.top <= face.plate_top + 1e-6, `${id} z ${f.bottom}..${f.top}`);
    assert.ok(f.w >= face.plate_w[0] - 1e-9 && f.w <= face.plate_w[1] + 1e-9, `${id} width ${f.w}`);
  }
});

test('antenna charm slot: on the stalk axis at the old orb height, facing front, drawn at the matching 2D spot', () => {
  const t = SOUL_FACE.topper;
  assert.ok(t, 'topper slot');
  assert.deepEqual(t.normal, [0, 0, 1]);
  assert.deepEqual(t.up, [0, 1, 0]);
  assert.equal(t.size, 0.36);
  assert.equal(t.sink, 0);
  assert.ok(Math.abs(t.centre[0] - 0.1027) < 1e-4 && Math.abs(t.centre[1] - 2.1) < 1e-4, JSON.stringify(t.centre));
  // viewBox = (100 + 70 x, 178.6 - 70 y), radius = 70 * size / 2 (soul-baseline-shape.js MAPPING)
  assert.ok(Math.abs(t.front2d.x - (100 + 70 * t.centre[0])) < 0.01 && Math.abs(t.front2d.y - (178.6 - 70 * 2.1)) < 0.01);
  assert.ok(Math.abs(t.front2d.r - 70 * t.size / 2) < 0.01);
});

test('data module: generated (not the placeholder), every catalog plate / eye / face listed, byte-identical regeneration', () => {
  assert.equal(SOUL_FACE.stub, false);
  assert.equal(SOUL_FACE.version, 1);
  assert.deepEqual(Object.keys(SOUL_FACE.plates), [...PLATE_IDS]);
  assert.deepEqual(Object.keys(SOUL_FACE.eyes), [...EYE_IDS]);
  assert.deepEqual(Object.keys(SOUL_FACE.faces), [...FACES]);
  for (const group of ['plates', 'eyes', 'faces']) {
    for (const [id, f] of Object.entries(SOUL_FACE[group])) {
      assert.match(f.glb, /^\/assets\/souls\/v3\/[a-z-]+\.glb\?v=[0-9a-f]{10}$/, `${group}.${id}`);
      assert.match(f.sprite, /^\/assets\/souls\/v3\/[a-z-]+\.png\?v=[0-9a-f]{10}$/, `${group}.${id}`);
      const [x, y, w, h] = f.rect;
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 200 && y + h <= 200, `${group}.${id} rect ${f.rect}`);
    }
  }
  assert.match(SOUL_FACE.body.hero, /^\/assets\/souls\/v3\/body-hero\.glb\?v=[0-9a-f]{10}$/);
  assert.match(SOUL_FACE.shape.silhouette, /^M[\d.]+ [\d.]+c.*z$/);
  const r = spawnSync('python3', [SCRIPT, '--mode', 'data', '--check'], { encoding: 'utf8', cwd: ROOT, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('provenance records every staged file with the hash of the staged or published copy', () => {
  const prov = JSON.parse(readFileSync(join(GEN, 'provenance.json'), 'utf8'));
  const want = ['body/body-hero.glb', 'body/body-lite.glb', ...PLATE_IDS.flatMap((p) => [`plates/plate-${p}.glb`, `sprites/plate-${p}.png`]),
    ...EYE_IDS.flatMap((e) => [`eyes/eyes-${e}.glb`, `sprites/eyes-${e}.png`]), ...FACES.flatMap((f) => [`kits/face-${f}.glb`, `sprites/face-${f}.png`])];
  assert.deepEqual(Object.keys(prov.files).sort(), want.sort());
  for (const [key, rec] of Object.entries(prov.files)) {
    const staged = join(GEN, key), runtime = join(ROOT, 'assets', 'souls', 'v3', key.split('/')[1]);
    const file = existsSync(staged) ? staged : runtime;
    assert.ok(existsSync(file), key);
    assert.equal(rec.sha256, sha(file), key);
  }
  // the antenna charm is drawn from the stage-12 charm files: every catalog charm can be a topper
  assert.ok(CHARM_BY_ID.size === 150);
});
