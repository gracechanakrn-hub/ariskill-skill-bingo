// Copy-proposal rules/schema and UX/UI template constraints (pure). Run: node --test tools/ai/test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../env.js';
import { BATCH_SCHEMA, CANDIDATE_KEY, CANDIDATE_SCHEMA, HARD_RULES, buildBatchUserPrompt, buildCopySystemPrompt, catalogueItems, chunk, lintText, loadToneSources, placeholdersMatch, reviewBatch } from '../lib/copy-rules.js';
import { planRun as planCopy, renderMarkdown as renderCopyMd } from '../openai-copy.js';
import { SCREENS, SCREEN_SCHEMA, STICKER_TOKENS, allowedTokenNames, buildScreenUserPrompt, buildUxSystemPrompt, loadUxSources, reviewScreen } from '../lib/uxui-rules.js';
import { planRun as planUx, renderMarkdown as renderUxMd } from '../openai-uxui.js';
import { assertStrictSchema, validateSchema } from '../lib/schema.js';

const copy = JSON.parse(readFileSync(join(ROOT, 'packages', 'contracts', 'copy.json'), 'utf8'));
const copyBefore = readFileSync(join(ROOT, 'packages', 'contracts', 'copy.json'), 'utf8');
const tone = loadToneSources();

test('copy system prompt embeds every hard rule, the OD-11 proposal-only statement, requirement tone excerpts and the glossary', () => {
  const s = buildCopySystemPrompt(tone);
  for (const r of HARD_RULES) assert.ok(s.includes(r));
  assert.match(s, /PROPOSALS ONLY/);
  assert.match(s, /OD-11/);
  assert.match(s, /non-ranking/);
  assert.match(s, /English only/);
  assert.match(s, /E1-E24/);
  assert.match(s, /### 8\.2 Key copy/);
  assert.match(s, /### 9\.1 Theme/);
  assert.match(s, /\| Arise Soul \|/);
});

test('catalogue items cover every copy key and every exception with trigger/recovery context; batches keep order', () => {
  const items = catalogueItems(copy);
  assert.equal(Object.keys(copy.exceptions).length, 24, 'E1-E24 (E24 greeting rejected, D-42)');
  assert.equal(items.length, Object.keys(copy.key).length + Object.keys(copy.exceptions).length);
  const e5 = items.find((i) => i.key === 'exception.E5');
  assert.equal(e5.current, copy.exceptions.E5.copy);
  assert.match(e5.context, /Trigger: Fewer than 16 at lock\. Recovery: Mark DEFERRED\./);
  const batches = chunk(items, 24);
  assert.equal(batches.flat().length, items.length);
  const user = buildBatchUserPrompt(batches[0], 0, batches.length);
  assert.match(user, /^Batch 1 of \d+\./);
  assert.match(user, /key: app\.title\n  current: "AriSkill Skill Bingo"/);
});

test('schemas are strict-compatible and validate the expected response shapes', () => {
  assert.deepEqual(assertStrictSchema(BATCH_SCHEMA), []);
  assert.deepEqual(assertStrictSchema(CANDIDATE_SCHEMA), []);
  assert.deepEqual(assertStrictSchema(SCREEN_SCHEMA), []);
  const ok = { proposals: [{ key: 'k', current: 'c', alternatives: [{ text: 'a', rationale: 'r' }, { text: 'b', rationale: 'r' }] }] };
  assert.deepEqual(validateSchema(BATCH_SCHEMA, ok), []);
  const bad = { proposals: [{ key: 'k', current: 'c', alternatives: [{ text: 'a', rationale: 'r' }] , extra: 1 }] };
  const errs = validateSchema(BATCH_SCHEMA, bad);
  assert.ok(errs.some((e) => /fewer than 2/.test(e)));
  assert.ok(errs.some((e) => /unexpected property "extra"/.test(e)));
  assert.ok(validateSchema(CANDIDATE_SCHEMA, { key: CANDIDATE_KEY, purpose: 'p', placementNote: 'n', options: [] }).some((e) => /fewer than 3/.test(e)));
});

test('lint rejects ranking / analyst / export / Thai wording and placeholder changes; accepts clean rewrites', () => {
  assert.deepEqual(lintText('Your Soul is ready to join Arise.'), []);
  assert.ok(lintText('Level 5 unlocked').length);
  assert.ok(lintText('You rank higher than your team').length);
  assert.ok(lintText('Export your results as CSV').length);
  assert.ok(lintText('See the analytics dashboard').length);
  assert.ok(lintText('ยินดีต้อนรับ').length);
  assert.ok(lintText('Your score is 5 points').length >= 2);
  assert.equal(placeholdersMatch('{count} / 25 skills selected', '{count} of 25 picked'), true);
  assert.equal(placeholdersMatch('{count} / 25 skills selected', '25 skills picked'), false);
  const items = [{ key: 'select.progress', current: '{count} / 25 skills selected', context: null }, { key: 'x', current: 'x', context: null }];
  const rev = reviewBatch(items, { proposals: [
    { key: 'select.progress', current: '{count} / 25 skills selected', alternatives: [{ text: '{count} of 25 picked', rationale: 'r' }, { text: 'Level {count}', rationale: 'r' }] },
    { key: 'unknown.key', current: '', alternatives: [{ text: 'a', rationale: '' }, { text: 'b', rationale: '' }] },
  ] });
  assert.equal(rev.accepted[0].alternatives[0].lint, 'ok');
  assert.equal(rev.accepted[0].alternatives[1].lint, 'rejected');
  assert.match(rev.accepted[0].alternatives[1].problems[0], /forbidden wording: Level/);
  assert.deepEqual(rev.rejected, [{ key: 'unknown.key', reason: 'unknown key' }]);
  assert.deepEqual(rev.missing, ['x']);
});

test('copy plan: N batches + candidate request; every request uses the strict schema; copy.json untouched; markdown says PROPOSALS ONLY', () => {
  const plan = planCopy({ copy, tone, model: 'gpt-5.1', batchSize: 24 });
  const batches = Math.ceil((Object.keys(copy.key).length + 23) / 24);
  assert.equal(plan.requests.length, batches + 1);
  assert.equal(plan.requests.at(-1).name, 'candidate-select-encouragement');
  assert.match(plan.requests.at(-1).body.input[1].content[0].text, /select\.encouragement/);
  for (const r of plan.requests) assert.equal(r.body.text.format.strict, true);
  const only = planCopy({ copy, tone, model: 'm', only: ['soul.'] });
  assert.equal(only.items.length, Object.keys(copy.key).filter((k) => k.startsWith('soul.')).length);
  const md = renderCopyMd({ model: 'm', createdAt: 'now', summary: { keys: 1, alternatives: 2, lintRejected: 1, requests: 1 }, candidate: null, proposals: [{ key: 'k', current: 'c', context: null, alternatives: [{ text: 'a', rationale: 'r', lint: 'ok', problems: [] }, { text: 'Level up', rationale: 'r', lint: 'rejected', problems: ['forbidden wording: Level'] }] }], missing: [], errors: [] });
  assert.match(md, /PROPOSALS ONLY/);
  assert.match(md, /copy\.json is unchanged/);
  assert.match(md, /~~Level up~~/);
  assert.equal(readFileSync(join(ROOT, 'packages', 'contracts', 'copy.json'), 'utf8'), copyBefore);
});

test('UX/UI: nine screens, token names constrained to tokens.json + sticker names, unknown tokens flagged', () => {
  assert.deepEqual(SCREENS.map((s) => s.id), ['employee-join', 'employee-select', 'employee-board', 'employee-playing', 'employee-result', 'employee-soul', 'stage', 'public', 'admin']);
  for (const s of SCREENS) { assert.ok(s.current.length > 80, s.id); for (const k of s.copyKeys) { const [ns, id] = k.split('.'); assert.ok(ns === 'exception' ? copy.exceptions[id] : copy.key[k], `${s.id} references unknown copy key ${k}`); } }
  const src = loadUxSources();
  const allowed = allowedTokenNames(src);
  for (const t of STICKER_TOKENS) assert.ok(allowed.includes(t));
  assert.ok(allowed.includes('--color-core'));
  const sys = buildUxSystemPrompt(src);
  assert.match(sys, /PROPOSAL ONLY/);
  assert.match(sys, /non-ranking/);
  assert.match(sys, /No analyst \/ export UI/);
  assert.match(sys, /ALLOWED TOKEN NAMES:/);
  assert.match(sys, /sticker language/);
  assert.match(buildScreenUserPrompt(SCREENS[6]), /Screen: stage \(stage-dashboard\)/);
  const review = reviewScreen({ components: [{ tokens: ['--color-bg', '--made-up'] }], tokenUsage: [{ token: '--sticker-gold' }], motion: [{ durationToken: '--duration-fast' }] }, allowed);
  assert.deepEqual(review.unknownTokens, ['--made-up']);
  const plan = planUx({ src, model: 'm', only: ['stage', 'admin'] });
  assert.equal(plan.requests.length, 2);
  assert.equal(plan.requests[0].body.text.format.name, 'uxui_screen_template');
  const md = renderUxMd({ model: 'm', createdAt: 'now', errors: [], screens: [{ title: 'T', review: { unknownTokens: ['--x'] }, proposal: { summary: 's', layoutRegions: [{ id: 'a', role: 'r', placement: 'p', contains: ['c'] }], components: [{ name: 'n', region: 'a', variant: 'v', states: [], tokens: ['--color-bg'], copyKeys: ['app.title'], notes: '' }], tokenUsage: [], motion: [], accessibility: ['a11y'], stickerNotes: [], openQuestions: ['q'] } }] });
  assert.match(md, /PROPOSAL ONLY/);
  assert.match(md, /Unknown token names flagged.*`--x`/);
});
