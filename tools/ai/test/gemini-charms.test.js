// Charm icon tooling (tools/ai/gemini-charms.js + tools/ai/lib/charm_cutout.py): prompts, request shaping, dry-run
// redaction, shipping rules, retry policy, and the cut-out + QA on synthetic stickers drawn here with python3 + PIL.
// Run: node --test tools/ai/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from '../env.js';
import { CUTOUT_PY, charmItems, charmPrompt, loadPrompts, planRequests, postWithRetry, readCatalog, reviewNote, selectItems, shipCandidate } from '../gemini-charms.js';

const prompts = loadPrompts();
const catalog = readCatalog();
const items = charmItems(catalog, prompts);
const FAKE_KEY = 'AIzaSyFAKEFAKEFAKEFAKEFAKE1234567';

test('the catalog gives exactly 100 charms to draw: 50 technical + 50 soft, unique ids, a 3 + 3 pilot', () => {
  assert.equal(items.length, 100);
  assert.equal(items.filter((c) => c.kind === 'technical').length, 50);
  assert.equal(items.filter((c) => c.kind === 'soft').length, 50);
  assert.equal(new Set(items.map((c) => c.id)).size, 100);
  for (const c of items) assert.match(c.id, c.kind === 'technical' ? /^tech-/ : /^soft-/);
  assert.equal(prompts.pilot.length, 6);
  assert.equal(prompts.pilot.filter((id) => id.startsWith('tech-')).length, 3);
  assert.ok(prompts.pilot.includes('soft-earphones'), 'the pilot carries a multi-part item');
  const plan = planRequests({ items, prompts, model: 'gemini-3.1-flash-image' });
  assert.equal(plan.length, 100);
  assert.throws(() => charmItems(catalog, { ...prompts, overrides: { 'core-classic-lemon': { detail: 'x' } } }), /not a technical or soft charm/);
});

test('every prompt carries the family style constraints, the key colour and the charm look', () => {
  for (const c of items) {
    const p = charmPrompt(c, prompts);
    assert.ok(p.includes(c.look), `${c.id} look`);
    assert.equal(p.split('\n').length, 5, `${c.id}: 5-part prompt`);
    for (const re of [/chunky, rounded, simplified/, /dark plum outline \(#2B2350\)/, /two-tone cel shading/, /one small white highlight near the upper left/,
      /3 to 4 friendly colours/, /thick, even, pure white sticker border/, /one single sticker shape/, /gaps and holes between parts are filled with white/,
      /centred in the square and fills about 75% of the frame/, /flat, uniform chroma-key green background \(#00FF00\)/, /Exactly one object/,
      /No text, letters, numbers, logos, brand marks or watermarks/, /No human faces, no hands, no people/, /No scenery/, /no drop shadow/]) {
      assert.match(p, re, `${c.id}: ${re}`);
    }
    assert.ok(!/\{(look|key|keyHex)\}/.test(p), `${c.id}: unfilled placeholder`);
    assert.ok(!/\b(level|rank|tier|score|xp)\b/i.test(p), `${c.id}: ranking language`);
  }
  assert.match(charmPrompt(items.find((c) => c.id === 'tech-keyboard'), prompts), /keys are blank/);
});

test('request shape: 1:1 image + text modalities, temperature, model in the URL, key never in the URL; references go first as inlineData', () => {
  const [step] = planRequests({ items: items.filter((c) => c.id === 'tech-hammer'), prompts, model: 'gemini-3.1-flash-image', temperature: 0.4 });
  assert.equal(step.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent');
  assert.deepEqual(step.body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], temperature: 0.4, imageConfig: { aspectRatio: '1:1' } });
  assert.equal(step.body.contents[0].parts.length, 1);
  assert.equal(step.body.contents[0].parts[0].text, step.prompt);
  assert.ok(!step.url.includes('key='));
  const refs = [{ id: 'soft-donut', attempt: 1, file: 'r.png', sha256: 'ab'.repeat(32), mimeType: 'image/png', data: 'AAAA' }];
  const [withRef] = planRequests({ items: items.filter((c) => c.id === 'tech-pen'), prompts, model: 'm', refs });
  const parts = withRef.body.contents[0].parts;
  assert.equal(parts.length, 3);
  assert.match(parts[0].text, /finished stickers from the same set/);
  assert.deepEqual(parts[1], { inlineData: { mimeType: 'image/png', data: 'AAAA' } });
  assert.match(parts[2].text, /ballpoint pen/);
  assert.match(withRef.prompt, /1 reference image\(s\): soft-donut attempt 1/);
  assert.deepEqual(withRef.references, [{ id: 'soft-donut', attempt: 1, file: 'r.png', sha256: 'ab'.repeat(32) }]);
});

test('dry run writes redacted request shapes and never the key (header masked, redact() on every line)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'charms-dry-'));
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'ai', 'gemini-charms.js'), '--dry-run', '--pilot', '--only', 'tech-hammer,soft-earphones', '--refs', '0', '--dry-run-dir', dir],
    { encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: FAKE_KEY } });
  assert.equal(r.status, 0, r.stderr);
  const files = readdirSync(dir);
  assert.equal(files.length, 1);
  const text = readFileSync(join(dir, files[0]), 'utf8');
  const rec = JSON.parse(text);
  assert.equal(rec.dryRun, true);
  assert.equal(rec.count, 2);
  assert.deepEqual(rec.requests.map((q) => q.id), ['tech-hammer', 'soft-earphones']);
  for (const q of rec.requests) assert.deepEqual(q.headers, { 'x-goog-api-key': '<redacted>' });
  for (const out of [text, r.stdout, r.stderr]) {
    assert.ok(!out.includes(FAKE_KEY), 'the key leaked');
    assert.ok(!/AIza[A-Za-z0-9_-]{8,}/.test(out), 'something key-shaped leaked');
  }
  assert.match(r.stdout, /DRY RUN - nothing is sent/);
  assert.match(rec.requests[1].body.contents[0].parts[0].text, /wireless earphones/);
});

test('shipping: pinned attempt, else the latest passing non-rejected run/pilot attempt; compare attempts never ship; review flags and the cap steer runs', () => {
  const qa = (pass) => ({ pass, checks: {} });
  const book = { attempts: [
    { id: 'tech-pen', attempt: 1, phase: 'pilot', file: 'a1', qa: qa(true) },
    { id: 'tech-pen', attempt: 2, phase: 'compare', file: 'a2', qa: qa(true) },
    { id: 'tech-pen', attempt: 3, phase: 'run', file: 'a3', qa: qa(false) },
    { id: 'tech-pen', attempt: 4, phase: 'run', error: 'HTTP 503' },
    { id: 'soft-rose', attempt: 1, phase: 'run', file: 'b1', qa: qa(false) },
    { id: 'soft-rose', attempt: 2, phase: 'run', file: 'b2', qa: qa(false) },
    { id: 'soft-rose', attempt: 3, phase: 'run', file: 'b3', qa: qa(false) },
  ] };
  const base = { ...prompts, ship: {}, reject: {} };
  assert.equal(shipCandidate('tech-pen', book, base).attempt, 1);
  assert.equal(shipCandidate('tech-pen', book, { ...base, ship: { 'tech-pen': 3 } }).attempt, 3);
  assert.equal(shipCandidate('tech-pen', book, { ...base, reject: { 'tech-pen': [1] } }).attempt, 3);
  assert.equal(shipCandidate('soft-rose', book, base).attempt, 3);
  assert.equal(shipCandidate('soft-tulip', book, base), null);
  const sel = selectItems({ items, prompts: base, book, only: 'tech-pen,soft-rose,soft-tulip', maxAttempts: 3 });
  assert.deepEqual(sel.chosen.map((c) => c.id), ['soft-tulip']);
  assert.deepEqual(sel.skipped.map((s) => s.id), ['tech-pen', 'soft-rose']);
  assert.deepEqual(selectItems({ items, prompts: base, book, only: 'tech-pen', regen: true }).chosen.map((c) => c.id), ['tech-pen']);
  assert.equal(selectItems({ items, prompts: base, book, pilot: true, phase: 'pilot' }).chosen.length, 6);
  assert.throws(() => selectItems({ items, prompts: base, book, only: 'tech-nope' }), /no technical or soft charm/);
  // a visual-review flag on the shipped attempt sends the charm back to the next run; a flag on an older attempt does not
  const flagged = { ...base, review: { 'tech-pen': { attempt: 1, note: 'reads as an X' } } };
  assert.equal(reviewNote('tech-pen', 1, flagged), 'reads as an X');
  assert.equal(reviewNote('tech-pen', 3, flagged), null);
  assert.deepEqual(selectItems({ items, prompts: flagged, book, only: 'tech-pen' }).chosen.map((c) => c.id), ['tech-pen']);
  assert.deepEqual(selectItems({ items, prompts: { ...flagged, review: { 'tech-pen': { attempt: 2, note: 'old' } } }, book, only: 'tech-pen' }).chosen, []);
});

test('retry policy: backoff on 429 / 5xx / network errors, immediate failure on other 4xx', async () => {
  const realFetch = globalThis.fetch;
  const reply = (status, body = '{}') => ({ ok: status < 300, status, text: async () => body });
  try {
    let calls = 0; const waits = [];
    const seq = [() => reply(429), () => reply(503), () => { throw new TypeError('fetch failed'); }, () => reply(200, '{"ok":1}')];
    globalThis.fetch = async () => seq[calls++]();
    const res = await postWithRetry('https://example.test/x', { body: {} }, { wait: async (ms) => waits.push(ms) });
    assert.deepEqual(res, { ok: 1 });
    assert.equal(calls, 4);
    assert.equal(waits.length, 3);
    assert.ok(waits[1] > waits[0] && waits[2] > waits[1], 'backoff grows');
    calls = 0;
    globalThis.fetch = async () => { calls++; return reply(400, '{"error":"bad"}'); };
    await assert.rejects(postWithRetry('https://example.test/x', { body: {} }, { wait: async () => {} }), /HTTP 400/);
    assert.equal(calls, 1);
    calls = 0;
    globalThis.fetch = async () => { calls++; return reply(500); };
    await assert.rejects(postWithRetry('https://example.test/x', { body: {} }, { retries: 2, wait: async () => {} }), /HTTP 500/);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = realFetch; }
});

// ---------------------------------------------------------------- cut-out + QA on synthetic stickers

const SYNTH = String.raw`
import sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
out = sys.argv[1]
N = 512
def draw(name, spots, rim=16, hole=False, rimless=False, noisy=False, bg=(0, 255, 0)):
    im = Image.new('RGB', (N, N), bg)
    d = ImageDraw.Draw(im)
    for cx, cy, r in spots:
        if not rimless:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255))
        ri = r - rim
        d.ellipse([cx - ri, cy - ri, cx + ri, cy + ri], fill=(43, 35, 80))
        d.ellipse([cx - ri + 7, cy - ri + 7, cx + ri - 7, cy + ri - 7], fill=(95, 199, 122))
        if hole:
            hr = ri // 3
            d.ellipse([cx - hr - 12, cy - hr - 12, cx + hr + 12, cy + hr + 12], fill=(43, 35, 80))
            d.ellipse([cx - hr - 6, cy - hr - 6, cx + hr + 6, cy + hr + 6], fill=(255, 255, 255))
            d.ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=bg)
    im = im.filter(ImageFilter.GaussianBlur(0.7))
    if noisy:
        a = np.asarray(im).astype(np.float32)
        a[..., 0] += np.linspace(0, 140, N)[None, :]
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    im.save(f'{out}/{name}.png')
draw('good', [(256, 256, 190)])
draw('hole', [(256, 256, 190)], hole=True)
draw('rimless', [(256, 256, 190)], rimless=True)
draw('two', [(140, 256, 100), (372, 256, 100)])
draw('noisy', [(256, 256, 190)], noisy=True)
draw('offcentre', [(200, 300, 170)])
print(json.dumps('ok'))
`;

function py(args, input) {
  const r = spawnSync('python3', args, { input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

function pngHeader(buf) {
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  assert.equal(buf.subarray(12, 16).toString(), 'IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colourType: buf[25], interlace: buf[28] };
}

test('cut-out + QA on synthetic stickers: clean pass, holes painted white, and each failure mode caught', () => {
  const dir = mkdtempSync(join(tmpdir(), 'charms-cut-'));
  py(['-c', SYNTH, dir]);
  const names = ['good', 'hole', 'rimless', 'two', 'noisy', 'offcentre'];
  const res = py([CUTOUT_PY, 'cutout'], JSON.stringify({ key: [0, 255, 0], size: 256, pad: 0.06, items: names.map((n) => ({ id: n, raw: join(dir, `${n}.png`), out: join(dir, `out-${n}.png`) })) }));
  const by = Object.fromEntries(res.items.map((it) => [it.id, it]));
  const failed = (n) => Object.entries(by[n].checks).filter(([, v]) => !v).map(([k]) => k);
  assert.deepEqual(failed('good'), []);
  assert.equal(by.good.pass, true);
  assert.equal(by.good.metrics.components, 1);
  assert.ok(by.good.metrics.rimMinPx >= 5 && by.good.metrics.rimCover >= 0.99, JSON.stringify(by.good.metrics));
  assert.ok(by.good.metrics.bboxOffsetPx <= 1 && by.good.metrics.keyInside === 0);
  assert.equal(by.hole.pass, true, JSON.stringify(by.hole.checks));
  assert.ok(by.hole.metrics.holeArea > 0.005, 'the key-coloured hole was found');
  assert.deepEqual(failed('rimless'), ['rim']);
  assert.ok(failed('two').includes('oneComponent'));
  assert.equal(by.two.metrics.components, 2);
  assert.ok(failed('noisy').includes('bgUniform'));
  assert.equal(by.offcentre.pass, true, 'an off-centre raw is re-centred');
  assert.ok(by.offcentre.metrics.rawCentreOffset > 0.1 && by.offcentre.metrics.bboxOffsetPx <= 1);
  assert.ok(res.qa.rimCover > 0 && res.cut.floodTol > 0, 'thresholds are reported');

  // the written icon: 256x256 RGBA, 8-bit, non-interlaced; transparent corners stored white; hole opaque white; 6% padding
  const head = pngHeader(readFileSync(join(dir, 'out-good.png')));
  assert.deepEqual(head, { width: 256, height: 256, bitDepth: 8, colourType: 6, interlace: 0 });
  const px = py(['-c', `
import json, numpy as np
from PIL import Image
g = np.asarray(Image.open(${JSON.stringify(join(dir, 'out-good.png'))}))
h = np.asarray(Image.open(${JSON.stringify(join(dir, 'out-hole.png'))}))
ys, xs = np.nonzero(g[..., 3] >= 128)
print(json.dumps({'corner': g[0, 0].tolist(), 'centreHole': h[128, 128].tolist(), 'x': [int(xs.min()), int(xs.max())], 'y': [int(ys.min()), int(ys.max())],
  'partialNotWhite': int(((g[..., 3] > 0) & (g[..., 3] < 255) & (g[..., :3].min(-1) < 250)).sum())}))`]);
  assert.deepEqual(px.corner, [255, 255, 255, 0]);
  assert.deepEqual(px.centreHole, [255, 255, 255, 255]);
  for (const [lo, hi] of [px.x, px.y]) {
    assert.ok(Math.abs(lo - 14) <= 2 && Math.abs(hi - 241) <= 2, `padding about 6%: ${lo}..${hi}`);
  }
  assert.equal(px.partialNotWhite, 0, 'edge pixels are decontaminated to white');
});

test('contact sheet: 10 columns with labels, failures marked, one PNG per call', () => {
  const dir = mkdtempSync(join(tmpdir(), 'charms-sheet-'));
  py(['-c', SYNTH, dir]);
  py([CUTOUT_PY, 'cutout'], JSON.stringify({ key: [0, 255, 0], items: [{ id: 'good', raw: join(dir, 'good.png'), out: join(dir, 'icon.png') }] }));
  const out = join(dir, 'sheet.png');
  const r = py([CUTOUT_PY, 'sheet'], JSON.stringify({ out, title: 't', columns: 10, items: Array.from({ length: 12 }, (_, i) => ({ id: `tech-${i}`, icon: join(dir, 'icon.png'), pass: i !== 3, failed: ['rim'] })) }));
  assert.equal(r.items, 12);
  const head = pngHeader(readFileSync(out));
  assert.equal(head.width, r.size[0]);
  assert.ok(head.width > head.height, 'two rows of ten');
});
