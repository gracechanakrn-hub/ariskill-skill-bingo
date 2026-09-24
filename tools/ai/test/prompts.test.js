// Pure prompt builders + dry-run request shaping for the AI tooling. Run: node --test tools/ai/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../env.js';
import { loadCatalog, platePrompt, planRun as planVisuals } from '../gemini-visuals.js';
import { buildGenerateRequest, buildRefineRequest, buildRefinePrompt, composePrompt, dehydrateParts, extractImages, extractModelParts, geminiHeaders, geminiUrl } from '../lib/gemini.js';
import { buildResponsesRequest, extractOutputText, openaiHeaders, parseStructured } from '../lib/openai.js';
import { parseArgs, shapeDryRun, extractSection, tokenNames } from '../lib/common.js';
import { assertStrictSchema } from '../lib/schema.js';
import { redact } from '../env.js';

const catalog = loadCatalog();
const FORBIDDEN_VISUAL = /\b(level|rank|tier|score|xp)\b(?!.*\b(no|never)\b)/i;

test('visuals catalog: six required plates, each with the 5 framework parts and the hard constraints', () => {
  const names = catalog.plates.map((p) => p.name);
  for (const n of ['soul-family-sheet', 'backdrop-public-16x9', 'backdrop-phone-9x16', 'doodad-sheet', 'tile-study', 'orb-reveal-keyframes']) assert.ok(names.includes(n), n);
  for (const p of catalog.plates) {
    for (const k of ['type', 'subject', 'environment', 'technical', 'constraints']) assert.ok(p.parts[k]?.length > 20, `${p.name}.${k}`);
    const prompt = platePrompt(p, catalog.shared);
    assert.match(prompt, /No human face/i, p.name);
    assert.match(prompt, /No text/i, p.name);
    assert.match(prompt, /No level, rank, tier, score/i, p.name);
    assert.ok(!/\bLV\.\d|LEVEL \d|UNLOCKED/i.test(prompt), `${p.name} carries a level label`);
    assert.equal(prompt.split('\n').length >= 5, true);
  }
  assert.equal(catalog.plates.find((p) => p.name === 'backdrop-public-16x9').aspectRatio, '16:9');
  assert.equal(catalog.plates.find((p) => p.name === 'backdrop-phone-9x16').aspectRatio, '9:16');
  assert.match(platePrompt(catalog.plates[0], catalog.shared), /6 columns and 3 rows/);
  assert.match(platePrompt(catalog.plates.find((p) => p.name === 'doodad-sheet'), catalog.shared), /rocket.*UFO.*ringed planet.*comet.*star/is);
});

test('composePrompt keeps the 5-part order and rejects a missing part', () => {
  const p = composePrompt({ type: 'A', subject: 'B', environment: 'C', technical: 'D', constraints: 'E' });
  assert.equal(p, 'A\nB\nC\nD\nE');
  assert.throws(() => composePrompt({ type: 'A', subject: 'B', environment: 'C', technical: 'D' }), /constraints/);
});

test('Gemini request shaping: modalities, temperature, aspect ratio, key in header not URL', () => {
  const body = buildGenerateRequest({ prompt: 'hello', temperature: 0.7, aspectRatio: '16:9' });
  assert.deepEqual(body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'], temperature: 0.7, imageConfig: { aspectRatio: '16:9' } });
  assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'hello' }] }]);
  assert.throws(() => buildGenerateRequest({ prompt: 'x', aspectRatio: '5:7' }), /aspect/);
  assert.equal(geminiUrl('gemini-3.1-flash-image-preview'), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent');
  assert.ok(!geminiUrl('m').includes('key='));
  assert.deepEqual(Object.keys(geminiHeaders('AIzaSyABCDEFGHIJKLMNOP')), ['x-goog-api-key']);
});

test('Gemini multi-turn refine replays user + model turns (thought signatures intact) and lists what to keep', () => {
  const modelParts = [{ text: 'here', thoughtSignature: 'sig-1' }, { inlineData: { mimeType: 'image/png', data: 'AAAA' }, thoughtSignature: 'sig-2' }];
  const body = buildRefineRequest({ originalPrompt: 'orig', modelParts, instruction: 'make the orb warmer', keep: ['the grid', 'the navy background'], aspectRatio: '4:3' });
  assert.equal(body.contents.length, 3);
  assert.equal(body.contents[0].parts[0].text, 'orig');
  assert.equal(body.contents[1].role, 'model');
  assert.equal(body.contents[1].parts[1].thoughtSignature, 'sig-2');
  assert.equal(body.contents[2].parts[0].text, buildRefinePrompt('make the orb warmer', ['the grid', 'the navy background']));
  assert.match(body.contents[2].parts[0].text, /^Edit this image\. Keep unchanged: the grid, the navy background\. Only change: make the orb warmer\./);
  const dry = dehydrateParts(modelParts, ['plate.png']);
  assert.deepEqual(dry[1].inlineData, { mimeType: 'image/png', file: 'plate.png' });
  assert.equal(dry[1].thoughtSignature, 'sig-2');
});

test('Gemini response parsing extracts inline images and fails clearly on a blocked prompt', () => {
  const parts = extractModelParts({ candidates: [{ content: { parts: [{ text: 't' }, { inlineData: { mimeType: 'image/png', data: Buffer.from('png!').toString('base64') } }] } }] });
  const imgs = extractImages(parts);
  assert.equal(imgs.length, 1);
  assert.equal(imgs[0].bytes.toString(), 'png!');
  assert.throws(() => extractModelParts({ promptFeedback: { blockReason: 'SAFETY' } }), /SAFETY/);
});

test('visuals plan: --only filters, --refine needs exactly one plate, provenance dir under assets-src/generated/<batch>', () => {
  const plan = planVisuals({ catalog, only: 'tile-study', model: 'm', batch: 'b1' });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, 'generate');
  assert.equal(plan[0].file, 'tile-study.png');
  assert.ok(plan[0].outDir.endsWith(join('assets-src', 'generated', 'b1')));
  assert.equal(plan[0].body.generationConfig.imageConfig.aspectRatio, '4:3');
  assert.throws(() => planVisuals({ catalog, only: 'nope', model: 'm', batch: 'b' }), /no plate/);
  assert.throws(() => planVisuals({ catalog, model: 'm', batch: 'b', refine: 'x' }), /exactly one/);
  assert.equal(planVisuals({ catalog, model: 'm', batch: 'b' }).length, catalog.plates.length);
});

test('OpenAI Responses request: developer + user input, strict json_schema format, no store', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } };
  const body = buildResponsesRequest({ model: 'gpt-5.1', system: 'S', user: 'U', schemaName: 'x', schema });
  assert.equal(body.model, 'gpt-5.1');
  assert.equal(body.input[0].role, 'developer');
  assert.equal(body.input[1].content[0].text, 'U');
  assert.deepEqual(body.text.format, { type: 'json_schema', name: 'x', strict: true, schema });
  assert.equal(body.store, false);
  assert.throws(() => buildResponsesRequest({ model: 'm', system: 'S', user: 'U', schemaName: 'x', schema: { type: 'object', properties: { a: { type: 'string' } } } }), /strict/);
  assert.deepEqual(openaiHeaders('sk-abc'), { authorization: 'Bearer sk-abc' });
  assert.deepEqual(assertStrictSchema(schema), []);
});

test('OpenAI response parsing handles output_text, message content and refusals', () => {
  assert.equal(extractOutputText({ output_text: '{"a":1}' }), '{"a":1}');
  assert.deepEqual(parseStructured({ output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: '{"a":' }, { type: 'output_text', text: '2}' }] }] }), { a: 2 });
  assert.throws(() => extractOutputText({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }), /refused/);
  assert.throws(() => extractOutputText({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }), /max_output_tokens/);
});

test('dry-run record masks auth headers and never contains a key; redact() covers sk-/AIza keys', () => {
  const rec = shapeDryRun({ tool: 't', name: 'n', url: 'https://x', headers: { authorization: 'Bearer sk-1234567890abcdef', 'x-goog-api-key': 'AIzaSy1234567890abcd' }, body: { q: 1 }, outputs: ['o'] });
  assert.equal(rec.request.headers.authorization, '<redacted>');
  assert.equal(rec.request.headers['x-goog-api-key'], '<redacted>');
  assert.equal(rec.dryRun, true);
  assert.ok(!JSON.stringify(rec).includes('sk-1234567890abcdef'));
  assert.equal(redact('key sk-1234567890abcdef and AIzaSy1234567890abcd'), 'key sk-******** and AIza********');
});

test('parseArgs: values, flags, repeats and --key=value', () => {
  const a = parseArgs(['--only', 'x', '--only', 'y', '--dry-run', '--model=m', 'pos', '--seed', '12'], { booleans: ['dry-run'] });
  assert.deepEqual(a.only, ['x', 'y']);
  assert.equal(a['dry-run'], true);
  assert.equal(a.model, 'm');
  assert.equal(a.seed, '12');
  assert.deepEqual(a._, ['pos']);
});

test('extractSection pulls a requirement section up to the next heading of the same level; tokenNames flattens themes', () => {
  const req = readFileSync(join(ROOT, 'docs', 'requirements', 'ariskill-skill-bingo-requirements.md'), 'utf8');
  const s = extractSection(req, /^### 8\.3 /);
  assert.match(s, /^### 8\.3 Exception and recovery copy/);
  assert.match(s, /E23/);
  assert.ok(!s.includes('## 9. Art Direction'));
  const tokens = JSON.parse(readFileSync(join(ROOT, 'packages', 'design-tokens', 'tokens.json'), 'utf8'));
  const names = tokenNames(tokens);
  assert.ok(names.includes('--color-bg') && names.includes('--duration-base') && names.includes('--touch-min'));
});
