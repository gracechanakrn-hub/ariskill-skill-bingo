// Pure parts of tools/ai/blender/soul_baseline.py (runs in plain python3 + numpy, no Blender needed).
// Run: node --test tools/ai/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../env.js';
import { PALETTES } from '../../../packages/ui/soul-renderer.js';

const SCRIPT_DIR = join(ROOT, 'tools', 'ai', 'blender');
const SPLATS = JSON.parse(readFileSync(join(SCRIPT_DIR, 'soul_baseline_splats.json'), 'utf8'));

function py(code) {
  const r = spawnSync('python3', ['-c', `import sys, json\nsys.path.insert(0, ${JSON.stringify(SCRIPT_DIR)})\nimport soul_baseline as sb\nimport numpy as np\n${code}`],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

test('script compiles without bpy', () => {
  const r = spawnSync('python3', ['-m', 'py_compile', join(SCRIPT_DIR, 'soul_baseline.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('palettes are read straight from the app renderer (parity, no drift)', () => {
  const pals = py('print(json.dumps(sb.read_palettes()))');
  assert.deepEqual(Object.keys(pals), PALETTES.map((p) => p.name));
  for (const p of PALETTES) {
    assert.deepEqual(pals[p.name], { fill: p.fill, highlight: p.highlight, outline: p.outline, glow: p.glow });
  }
});

test('Pchip interpolates the knots, stays monotone on monotone data, and is smooth between knots', () => {
  const r = py(`
p = sb.Pchip([0, 1, 2, 3], [0.0, 1.0, 1.5, 3.0])
k, _ = p(np.array([0.0, 1.0, 2.0, 3.0]))
xs = np.linspace(0, 3, 301); v, d = p(xs)
print(json.dumps({'knots': k.tolist(), 'monotone': bool(np.all(np.diff(v) >= -1e-12)), 'minDer': float(d.min()), 'jump': float(np.max(np.abs(np.diff(d))))}))`);
  r.knots.forEach((v, i) => assert.ok(Math.abs(v - [0, 1, 1.5, 3][i]) < 1e-12));
  assert.equal(r.monotone, true);
  assert.ok(r.minDer >= 0);
  assert.ok(r.jump < 0.2, `derivative jumps ${r.jump}`);
});

test('smooth union/subtraction bound the hard operations and blend only within k', () => {
  const r = py(`
a = np.array([0.0, 0.5, 1.0]); b = np.array([0.02, 0.5, 0.0]); k = 0.1
u = sb.smin(a, b, k); s = sb.smax(a, b, k)
print(json.dumps({'u': u.tolist(), 's': s.tolist(), 'far': float(sb.smin(np.array([0.0]), np.array([0.5]), k)[0])}))`);
  assert.ok(r.u[0] <= 0 && r.u[0] > -0.025);  // blends below the hard min near the seam
  assert.equal(r.far, 0);                       // no effect when the fields differ by more than k
  assert.ok(r.s[1] >= 0.5);
});

test('the body field is negative inside and positive outside at known points', () => {
  const r = py(`
ops = sb.base_ops()
P = np.array([[0.0, 0.0, 1.15], [0.0, 0.0, 0.45], [0.105, 0.065, 2.10], [0.0, -1.0, 1.0], [0.0, 0.0, 2.6]])
print(json.dumps(sb.eval_ops_points(ops, P).tolist()))`);
  assert.ok(r[0] < 0 && r[1] < 0 && r[2] < 0, 'head, belly and orb centres are inside');
  assert.ok(r[3] > 0 && r[4] > 0, 'points in front of and above the body are outside');
});

test('drip annotations are complete and inside the reference frame; camera and eye fit are recorded', () => {
  assert.equal(SPLATS.camera.length, 6);
  assert.equal(SPLATS.eye.length, 2);
  assert.ok(SPLATS.ref.length >= 20);
  const ids = new Set();
  for (const s of SPLATS.ref) {
    assert.ok(!ids.has(s.id), `duplicate ${s.id}`); ids.add(s.id);
    for (const p of [s.from, s.to ?? s.from]) {
      assert.ok(p[0] > 150 && p[0] < 620 && p[1] > 40 && p[1] < 760, `${s.id} outside the character area`);
    }
    assert.ok(s.r0 > 0 && s.r0 < 30 && (s.r1 ?? s.r0) > 0);
  }
});

test('write_glb round-trips a mesh with quantised positions, normals, mask colours and metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soulglb-'));
  const r = py(`
import struct
v = np.array([[0,0,0],[1,0,0],[0,1,0],[0,0,1]], float) * 0.5
n = np.array([[0,0,-1],[1,0,0],[0,1,0],[0,0,1]], float)
t = np.array([[0,2,1],[0,1,3],[0,3,2],[1,2,3]])
m = np.array([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]], float)
path = ${JSON.stringify(join(dir, 't.glb'))}
size = sb.write_glb(path, v, n, t, m, {'k': 'v'})
b = open(path, 'rb').read()
magic, ver, total = struct.unpack('<III', b[:12]); jl = struct.unpack('<I', b[12:16])[0]
gl = json.loads(b[20:20 + jl]); off = 20 + jl; binb = b[off + 8:]
acc, bv = gl['accessors'], gl['bufferViews']
pos = np.frombuffer(binb, np.int16, count=4 * 4, offset=bv[0]['byteOffset']).reshape(4, 4)[:, :3] / 32767.0
node = gl['nodes'][0]; P = pos * node['scale'][0] + np.array(node['translation'])
Pb = np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)
col = np.frombuffer(binb, np.uint8, count=16, offset=bv[2]['byteOffset']).reshape(4, 4)
print(json.dumps({'magic': magic, 'ver': ver, 'total_ok': total == len(b) == size, 'err': float(np.abs(P - Pb).max()),
  'ext': gl['extensionsRequired'], 'meta': gl['asset']['extras'], 'col': col.tolist(), 'idx': acc[3]['count'], 'aligned': all(x['byteOffset'] % 4 == 0 for x in bv)}))`);
  assert.equal(r.magic, 0x46546c67);
  assert.equal(r.ver, 2);
  assert.equal(r.total_ok, true);
  assert.ok(r.err < 1e-4, `dequantised error ${r.err}`);
  assert.deepEqual(r.ext, ['KHR_mesh_quantization']);
  assert.deepEqual(r.meta, { k: 'v' });
  assert.deepEqual(r.col, [[255, 0, 0, 0], [0, 255, 0, 0], [0, 0, 255, 0], [0, 0, 0, 255]]);
  assert.equal(r.idx, 12);
  assert.equal(r.aligned, true);
});
