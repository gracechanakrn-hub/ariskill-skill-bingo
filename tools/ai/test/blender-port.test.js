// Python port of soul-params.js / soul.js used by the Blender script must match the JS modules (1e-6). Run: node --test tools/ai/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../env.js';
import { SCRIPT, MODES, blenderCommand, scriptArgs } from '../blender-render.js';
import { BODY_PROFILES, BODY_LEAN, BODY_BUMP, UNIT, HEM_Y, HEAD_CENTER_Y, latheProfile, hashSeed, radiusAt } from '../../../apps/employee-mobile/src/scene/soul-params.js';
import { soulConfigFromSeed, SOUL_TRAITS } from '../../../packages/game-rules/src/soul.js';
import { hashString } from '../../../packages/game-rules/src/random.js';
import { PALETTES } from '../../../packages/ui/soul-renderer.js';
import { sha256Hex } from '../lib/common.js';

const SEEDS = ['abc123', '0000000000000', 'a3f9c1e02b7d4', 'demo-soul', 'ffffffffffffff', 'AriSkill|p-01|r1'];
function port(seed) {
  const r = spawnSync('python3', [SCRIPT, '--print-profiles', '--seed', seed], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= 1e-6, `${msg}: ${a} vs ${b}`);

test('python script compiles without bpy (py_compile) and reports profiles outside Blender', () => {
  const r = spawnSync('python3', ['-m', 'py_compile', SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const d = port('abc123');
  assert.equal(d.unit, UNIT);
  assert.equal(d.hemY, HEM_Y);
  assert.equal(d.headCenterY, HEAD_CENTER_Y);
});

test('lathe profiles of all six bodies match latheProfile() point for point within 1e-6', () => {
  const d = port('abc123');
  for (const body of SOUL_TRAITS.body) {
    const js = latheProfile(body), py = d.profiles[body];
    assert.equal(py.length, js.length, `${body} point count`);
    js.forEach((p, i) => { close(py[i].r, p.r, `${body}[${i}].r`); close(py[i].y, p.y, `${body}[${i}].y`); });
    assert.equal(py[0].r, 0); assert.equal(py.at(-1).r, 0);
    assert.equal(d.lean[body], BODY_LEAN[body]);
    assert.equal(d.bump[body], BODY_BUMP[body]);
  }
  assert.deepEqual(Object.keys(d.profiles), Object.keys(BODY_PROFILES));
});

test('seed -> trait mapping (cyrb53 hashString, FNV hashSeed) is identical for varied seeds', () => {
  for (const seed of SEEDS) {
    const d = port(seed);
    const js = soulConfigFromSeed(seed);
    for (const k of ['body', 'palette', 'eyes', 'antenna', 'mouth', 'glow', 'driftPhase']) assert.equal(d.config[k], js[k], `${seed} ${k}`);
    for (const salt of ['body', 'palette', 'eyes', 'antenna', 'mouth', 'glow', 'drift']) assert.equal(d.hashString[salt], hashString(`${seed}:${salt}`), `${seed} hashString(${salt})`);
    assert.equal(d.hashSeed, hashSeed(seed), `${seed} hashSeed`);
    assert.equal(d.params.body, SOUL_TRAITS.body[js.body]);
    assert.equal(d.params.palette, SOUL_TRAITS.palette[js.palette]);
    close(d.params.headY, (HEM_Y - HEAD_CENTER_Y) * UNIT, 'headY');
    close(d.params.headR, radiusAt(latheProfile(d.params.body), (HEM_Y - HEAD_CENTER_Y) * UNIT), 'headR');
    close(d.params.bobPhase, Number(((hashSeed(seed) % 1000) / 1000 * Math.PI * 2).toFixed(4)), 'bobPhase');
    assert.ok(d.params.speckles.length >= 9 && d.params.speckles.length <= 14, 'speckle count 9..14');
    assert.deepEqual(d.params.colors, PALETTES.find((p) => p.name === d.params.palette) && { fill: PALETTES.find((p) => p.name === d.params.palette).fill, highlight: PALETTES.find((p) => p.name === d.params.palette).highlight, outline: PALETTES.find((p) => p.name === d.params.palette).outline, glow: PALETTES.find((p) => p.name === d.params.palette).glow });
  }
});

test('python palette table equals soul-renderer PALETTES', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  for (const p of PALETTES) for (const k of ['fill', 'highlight', 'outline', 'glow']) assert.ok(src.includes(`"${k}": "${p[k]}"`), `${p.name}.${k}`);
});

test('wrapper: script args per mode, blender command shape, smoke defaults, no key in the environment passed on', () => {
  const out = '/tmp/x';
  assert.deepEqual(scriptArgs({ mode: 'smoke', seed: 's', out }), [['--mode', 'smoke', '--seed', 's', '--out', out, '--body', 'drop', '--palette', 'aurora', '--view', 'threequarter', '--size', '256', '--samples', '16']]);
  const all = scriptArgs({ mode: 'all', seed: '7', out, palettes: 'aurora,sunset,orchid' });
  assert.equal(all.length, 2);
  assert.deepEqual(all[0].slice(0, 2), ['--mode', 'turnaround']);
  assert.deepEqual(all[1], ['--mode', 'sheet', '--seed', '7', '--out', out, '--palettes', 'aurora,sunset,orchid']);
  assert.throws(() => scriptArgs({ mode: 'nope', out }), /unknown mode/);
  const [exe, args] = blenderCommand('/Applications/Blender.app/Contents/MacOS/Blender', ['--mode', 'sheet']);
  assert.equal(exe, '/Applications/Blender.app/Contents/MacOS/Blender');
  assert.deepEqual(args.slice(0, 3), ['--background', '--factory-startup', '--python']);
  assert.equal(args[3], SCRIPT);
  assert.equal(args[4], '--');
  assert.deepEqual(MODES, ['all', 'turnaround', 'sheet', 'single', 'smoke']);
  const wrapper = readFileSync(join(ROOT, 'tools', 'ai', 'blender-render.js'), 'utf8');
  assert.match(wrapper, /GEMINI_API_KEY: '', OPENAI_API_KEY: ''/);
});

test('provenance hashing: sha256 of bytes is stable and matches an existing smoke render when present', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const dir = join(ROOT, 'assets-src', 'generated', 'blender', 'smoke-test');
  if (!existsSync(join(dir, 'provenance.json'))) return; // render evidence is optional (PNGs are git-ignored)
  const prov = JSON.parse(readFileSync(join(dir, 'provenance.json'), 'utf8'));
  assert.equal(prov.license, 'AI-generated reference, not shipped');
  assert.equal(prov.shipped, false);
  for (const e of prov.entries) if (existsSync(join(dir, e.file))) assert.equal(sha256Hex(readFileSync(join(dir, e.file))), e.sha256, e.file);
});
