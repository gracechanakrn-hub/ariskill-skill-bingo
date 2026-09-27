import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGreeting, cleanGreeting, GREETING_MAX_CHARS } from '../src/index.js';

test('D-42: empty or whitespace-only greetings are fine and mean "no greeting"', () => {
  for (const raw of [undefined, null, '', '   ', '\n\t', '​​']) assert.deepEqual(checkGreeting(raw), { ok: true, value: null });
});

test('D-42: cleaning collapses whitespace and newlines, strips invisible and bidi characters, trims', () => {
  assert.equal(cleanGreeting('  Hello \n\n  team!  '), 'Hello team!');
  assert.equal(cleanGreeting('Hi​there‮'), 'Hi there');
  assert.deepEqual(checkGreeting(' Good luck, everyone! '), { ok: true, value: 'Good luck, everyone!' });
  assert.deepEqual(checkGreeting('สวัสดีทุกคน ขอให้สนุกนะ'), { ok: true, value: 'สวัสดีทุกคน ขอให้สนุกนะ' }, 'Thai text is welcome');
});

test('D-42: at most 40 characters, counted as code points', () => {
  assert.equal(GREETING_MAX_CHARS, 40);
  assert.equal(checkGreeting('a'.repeat(40)).ok, true);
  assert.equal(checkGreeting('a'.repeat(41)).reason, 'too-long');
  assert.equal(checkGreeting('🚀'.repeat(40)).ok, true, 'emoji count once each');
});

test('D-42: links, contact details, @handles and blocked words are rejected with a reason', () => {
  assert.equal(checkGreeting('see https://x.io').reason, 'link');
  assert.equal(checkGreeting('visit www.site').reason, 'link');
  assert.equal(checkGreeting('find me at arise.com').reason, 'link');
  assert.equal(checkGreeting('mail me a@b.co').reason, 'contact');
  assert.equal(checkGreeting('call 081-234-5678').reason, 'contact');
  assert.equal(checkGreeting('follow @nok_tester').reason, 'handle');
  assert.equal(checkGreeting('what the FUCK').reason, 'language');
  assert.equal(checkGreeting('shiiit happens').reason, 'language', 'stretched letters do not slip through');
  assert.equal(checkGreeting('Skills unlocked: 3 of 16').ok, true, 'short numbers are fine');
  assert.equal(checkGreeting('Sussex team says hi').ok, true, 'blocked words only match whole words');
});
