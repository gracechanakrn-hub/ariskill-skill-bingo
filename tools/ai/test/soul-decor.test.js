// Pure parts of tools/ai/blender/soul_decor.py (plain python3 + numpy, no Blender): the catalog reader, the body gradient
// maths (reference values for the phone / big-screen tint), the star icons, the slot layout and the data module.
// Run: node --test tools/ai/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../env.js';
import { SOUL_CATALOG, CHARMS } from '../../../packages/game-rules/src/soul-catalog.js';
import { SOUL_DECOR } from '../../../packages/ui/soul-decor-data.js';

const SCRIPT_DIR = join(ROOT, 'tools', 'ai', 'blender');
const SCRIPT = join(SCRIPT_DIR, 'soul_decor.py');
const GEN = join(ROOT, 'assets-src', 'generated', 'soul-decor', 'v1');

function py(code, timeout = 120000) {
  const r = spawnSync('python3', ['-c', `import sys, json\nsys.path.insert(0, ${JSON.stringify(SCRIPT_DIR)})\nsys.dont_write_bytecode = True\nimport soul_decor as sd\nimport numpy as np\n${code}`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// The spec's body colour (docs/art/soul-decorations.md "Colour"), written out independently of the Python: t on the
// height above the floor, sRGB mix of top / bottom, to linear, then the D-27 mask mixes in linear light.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255);
function specTint(h, mask, g, span = SOUL_CATALOG.gradientSpan) {
  const t = Math.min(1, Math.max(0, (span.top - h) / (span.top - span.bottom)));
  const top = rgb(g.top), bottom = rgb(g.bottom);
  let c = top.map((v, i) => lin(v * (1 - t) + bottom[i] * t));
  for (const [ch, hex] of [[0, g.highlight], [1, '#F7F8FF'], [2, g.outline], [3, g.highlight]]) {
    const to = rgb(hex).map(lin);
    c = c.map((v, i) => v + (to[i] - v) * mask[ch]);
  }
  return c;
}
// Reference values (linear RGB) the renderer's JS tint must reproduce: [gradient, h above the floor, mask RGBA] -> colour.
export const GRADIENT_REFERENCE = [
  ['aurora', 0.0, [0, 0, 0, 0], [0.119538, 0.502886, 0.672443]],
  ['aurora', 0.95, [0, 0, 0, 0], [0.206853, 0.658375, 0.683108]],
  ['aurora', 1.9, [0, 0, 0, 0], [0.323143, 0.838799, 0.693872]],
  ['aurora', 2.2, [0, 0, 0, 0], [0.323143, 0.838799, 0.693872]],
  ['lagoon', 1.0, [0, 0, 0, 0], [0.30101, 0.598245, 1.0]],
  ['sunset', 0.5, [0.5, 0, 0, 0], [0.982343, 0.615547, 0.536911]],
  ['berry', 0.4, [0.25, 0, 0, 0], [0.685746, 0.510515, 0.960093]],
  ['lemonade', 1.2, [0, 1, 0, 0], [0.930111, 0.938686, 1.0]],
  ['twilight', 0.3, [0, 0, 1, 0], [0.07036, 0.068478, 0.381326]],
  ['orchid', 2.0, [0, 0, 0, 0.5], [0.977987, 0.689039, 1.0]],
];

test('script compiles without bpy and reads the catalog exactly as the JS module exports it', () => {
  const c = spawnSync('python3', ['-m', 'py_compile', SCRIPT], { encoding: 'utf8' });
  assert.equal(c.status, 0, c.stderr);
  const r = py("cat = sd.read_catalog(); print(json.dumps({'ids': [c['id'] for c in cat['charms']], 'gradients': cat['gradients'], 'span': cat['gradientSpan'], 'shapes': [s['id'] for s in cat['starShapes']], 'shades': [s['id'] for s in cat['starShades']]}))");
  assert.deepEqual(r.ids, CHARMS.map((c) => c.id));
  assert.deepEqual(r.gradients, SOUL_CATALOG.gradients.map((g) => ({ ...g })));
  assert.deepEqual(r.span, { ...SOUL_CATALOG.gradientSpan });
  assert.equal(r.shapes.length * r.shades.length, 50);
});

test('body gradient: Python equals the spec formula and the pinned reference values (renderer parity)', () => {
  const G = Object.fromEntries(SOUL_CATALOG.gradients.map((g) => [g.id, g]));
  const cases = GRADIENT_REFERENCE.map(([id, h, m]) => ({ id, h, m }));
  const out = py(`cat = sd.read_catalog(); G = {g['id']: g for g in cat['gradients']}
cases = ${JSON.stringify(cases)}
res = []
for c in cases:
    col, glow = sd.tint_vertices(np.array([c['h']]), np.array([c['m']]), G[c['id']], cat['gradientSpan'])
    res.append([col[0].tolist(), float(glow[0])])
print(json.dumps(res))`);
  GRADIENT_REFERENCE.forEach(([id, h, m, want], i) => {
    const spec = specTint(h, m, G[id]);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(out[i][0][k] - spec[k]) < 1e-9, `${id} h ${h}: python ${out[i][0]} vs spec ${spec}`);
      assert.ok(Math.abs(spec[k] - want[k]) < 5e-6, `${id} h ${h}: spec ${spec} vs pinned ${want}`);
    }
    assert.equal(out[i][1], m[3], 'orb glow weight = mask A');
  });
});

test('star icons: 256 px sticker RGBA (plum outline, white rim, clear corners), deterministic, all 50 on disk', () => {
  const r = py(`cat = sd.read_catalog(); sh = {s['id']: s for s in cat['starShades']}
a = sd.draw_star_icon('classic', sh['lemon']); b = sd.draw_star_icon('classic', sh['lemon'])
plum = np.all(np.abs(a[..., :3].astype(int) - [0x2B, 0x23, 0x50]) < 12, axis=-1) & (a[..., 3] == 255)
white = np.all(a[..., :3] >= 250, axis=-1) & (a[..., 3] == 255)
print(json.dumps({'shape': list(a.shape), 'same': bool((a == b).all()), 'corner': int(a[0, 0, 3]), 'clearWhite': bool((a[a[..., 3] == 0][:, :3] == 255).all()), 'plum': int(plum.sum()), 'white': int(white.sum()), 'centre': int(a[128, 128, 3])}))`);
  assert.deepEqual(r.shape, [256, 256, 4]);
  assert.equal(r.same, true);
  assert.equal(r.corner, 0); assert.equal(r.centre, 255);
  assert.equal(r.clearWhite, true, 'transparent pixels stored white like the Gemini icons');
  assert.ok(r.plum > 1500 && r.white > 5000, `outline ${r.plum} px, rim ${r.white} px`);
  for (const c of CHARMS.filter((x) => x.kind === 'core')) {
    const buf = readFileSync(join(ROOT, 'assets-src', 'charms', 'icons', `${c.id}.png`));
    assert.equal(buf.readUInt32BE(16), 256); assert.equal(buf.readUInt32BE(20), 256); assert.equal(buf[25], 6, `${c.id} RGBA`);
  }
});

test('png writer and palette quantiser: lossless RGBA round trip, visually lossless palette with tRNS', () => {
  const r = py(`from PIL import Image
import io
rng = np.random.default_rng(1)
img = (rng.random((40, 50, 4)) * 255).astype(np.uint8)
back = np.asarray(Image.open(io.BytesIO(sd.png_bytes(img))).convert('RGBA'))
cat = sd.read_catalog(); sh = {s['id']: s for s in cat['starShades']}
star = sd.draw_star_icon('burst', sh['mint'])
pal, idx = sd.quantise_rgba(star)
q = np.asarray(Image.open(io.BytesIO(sd.png_indexed_bytes(pal, idx))).convert('RGBA')).astype(int)
print(json.dumps({'rgba': bool((back == img).all()), 'pal': len(pal), 'err': int(np.abs(q - star.astype(int)).max()), 'mean': float(np.abs(q - star.astype(int)).mean())}))`);
  assert.equal(r.rgba, true);
  assert.ok(r.pal <= 256);
  assert.ok(r.mean < 1.5 && r.err <= 40, `palette error mean ${r.mean} max ${r.err}`);
});

test('slots: 10 on the front of the goo, spaced, seated, clear of the face kits, slits and feet, visible; slots.json is reproducible', () => {
  const r = py(`B = sd.Body(); slots, F = sd.compute_slots(B)
probs = sd.slot_problems(B, slots, F)
stored = json.load(open(${JSON.stringify(join(GEN, 'slots.json'))}))
c = F['centre']; D = np.linalg.norm(c[:, None] - c[None], axis=-1); np.fill_diagonal(D, 9)
diff = max(max(abs(a - b) for a, b in zip(x['centre'] + x['normal'] + x['up'], y['centre'] + y['normal'] + y['up'])) for x, y in zip(slots, stored['slots']))
print(json.dumps({'probs': probs, 'n': len(slots), 'spacing': float(D.min()), 'diff': diff, 'sinks': [s['sink'] for s in slots], 'front2d': [s['front2d'] for s in slots],
  'size': sd.SLOT['size'], 'gap': sd.SLOT['gap'], 'stored2d': [s['front2d'] for s in stored['slots']], 'facing': [s['check']['facing'] for s in slots], 'rest': [s['check']['rest'] for s in slots], 'z': c[:, 2].tolist(), 'x': c[:, 0].tolist()}))`, 180000);
  assert.deepEqual(r.probs, [], r.probs.join('\n'));
  assert.equal(r.n, 10);
  assert.ok(r.size >= 0.16 && r.size <= 0.24, 'one charm diameter in the agreed range');
  assert.ok(r.spacing >= r.size + r.gap - 1e-9, `centre spacing ${r.spacing}`);
  assert.ok(r.diff < 1e-4, `slots.json differs from a fresh computation by ${r.diff}`);
  assert.deepEqual(r.front2d, r.stored2d);
  assert.ok(r.facing.every((f) => f >= 0.6) && r.rest.every((f) => f >= 0.4), 'front hemisphere, visible in the rest pose');
  assert.ok(r.z.every((z) => z - r.size / 2 >= 0.1 && z + r.size / 2 <= 1.4), 'between the feet and the bandana line');
  assert.ok(r.sinks.every((s) => s >= 0.22 && s <= 0.52));
  for (const f of r.front2d) { assert.ok(f.x > 50 && f.x < 150 && f.y > 100 && f.y < 180); assert.equal(f.r, Number((r.size * 35).toFixed(2))); }
});

test('data module: the stub shape, stub false, version 1, every catalog charm either listed or missing, byte-identical regeneration', () => {
  const d = SOUL_DECOR;
  assert.equal(d.stub, false); assert.equal(d.version, 1); assert.equal(d.catalogVersion, SOUL_CATALOG.version);
  for (const k of ['generator', 'frame', 'floor', 'height', 'gradientSpan', 'charm', 'slots', 'faces', 'sprite2d']) assert.ok(k in d, k);
  assert.deepEqual({ ...d.gradientSpan }, { top: SOUL_CATALOG.gradientSpan.top, bottom: SOUL_CATALOG.gradientSpan.bottom });
  assert.deepEqual(JSON.parse(JSON.stringify(d.sprite2d)), { viewBox: 200, size: 800, map: { x0: 100, sx: 70, y0: 178.6, sy: -70 } });
  const listed = Object.keys(d.charm.files);
  assert.deepEqual([...listed, ...d.charm.missing].sort(), CHARMS.map((c) => c.id).sort(), 'files + missing partition the catalog');
  assert.deepEqual(listed, CHARMS.map((c) => c.id).filter((id) => listed.includes(id)), 'catalog order');
  for (const id of listed) {
    assert.match(d.charm.files[id].glb, new RegExp(`^/assets/souls/charms/${id}\\.glb\\?v=[0-9a-f]{10}$`));
    assert.match(d.charm.files[id].png, new RegExp(`^/assets/souls/charms/${id}\\.png\\?v=[0-9a-f]{10}$`));
  }
  for (const f of ['nerdy', 'pirate', 'angel']) {
    assert.match(d.faces[f].glb, new RegExp(`^/assets/souls/faces/face-${f}\\.glb\\?v=[0-9a-f]{10}$`));
    assert.match(d.faces[f].sprite, new RegExp(`^/assets/souls/faces/face-${f}-front\\.png\\?v=[0-9a-f]{10}$`));
  }
  assert.equal(d.slots.length, 10);
  const size = d.slots[0].size;
  for (const s of d.slots) {
    assert.deepEqual(Object.keys(s), ['index', 'centre', 'normal', 'up', 'size', 'sink', 'front2d']);
    assert.equal(s.size, size, 'one charm size (BR-17)');
    assert.ok(Math.abs(Math.hypot(...s.normal) - 1) < 1e-4 && Math.abs(s.normal[0] * s.up[0] + s.normal[1] * s.up[1] + s.normal[2] * s.up[2]) < 1e-4);
    assert.ok(s.normal[2] > 0.55, 'faces the front (+Z)');
  }
  assert.ok(d.charm.thickness > 0.1 && d.charm.thickness < 0.5);
  for (const k of ['tools/ai/blender/soul_decor.py', 'tools/ai/blender/soul_baseline.py', 'packages/game-rules/src/soul-catalog.js']) assert.match(d.source.sha256[k], /^[0-9a-f]{64}$/, k);
  const chk = spawnSync('python3', [SCRIPT, '--mode', 'data', '--check'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(chk.status, 0, `data module is stale: ${chk.stderr}`);
});

test('provenance records every built charm and face file with its icon hash', () => {
  const prov = JSON.parse(readFileSync(join(GEN, 'provenance.json'), 'utf8'));
  for (const id of Object.keys(SOUL_DECOR.charm.files)) {
    assert.ok(prov.files[`charms/${id}.glb`] && prov.files[`charms/${id}.png`], id);
    assert.match(prov.icons[id].sha256, /^[0-9a-f]{64}$/);
    const icon = join(ROOT, prov.icons[id].file);
    assert.ok(existsSync(icon), icon);
  }
  for (const f of ['nerdy', 'pirate', 'angel']) assert.ok(prov.files[`faces/face-${f}.glb`] && prov.files[`faces/face-${f}-front.png`], f);
  const w = Object.values(prov.faceWeight);
  const mean = w.reduce((a, b) => a + b, 0) / w.length;
  assert.ok(w.every((v) => Math.abs(v - mean) <= 0.25 * mean), `face kits carry equal visual weight (BR-17): ${JSON.stringify(prov.faceWeight)}`);
});
