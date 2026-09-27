// Stage 15 (D-36): the "say hi" speech bubble. Its words ("Hi, I'm <label>, <greeting>"), how a greeting of up to 40
// words is cleaned for the big screen, how the bubble and the visit size themselves to the message, where the bubble
// sits, and that the scene hands the visit's label and greeting to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bubbleText, cleanGreeting, cleanText, wordCount, bubbleStyle, readingSeconds, bubblePlacement, BUBBLE, READING } from '../src/greeting-bubble.js';
import { createScene, DEFAULT_RINGS, DEFAULT_SCENE_CONFIG } from '../src/renderer/scene.js';

const here = dirname(fileURLToPath(import.meta.url));
const words = (t) => t.lead + t.name + t.rest;
const ch = (code) => String.fromCharCode(code);
const ELLIPSIS = ch(0x2026);
const many = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

test('words: "Hi, I\'m <name>, <greeting>", and sensible lines without a public name or a greeting', () => {
  assert.equal(words(bubbleText({ label: 'Alex T.', greeting: "let's build something amazing!" })), "Hi, I'm Alex T., let's build something amazing!");
  assert.equal(bubbleText({ label: 'Alex T.', greeting: 'x' }).name, 'Alex T.', 'the name is its own (bold) part');
  assert.equal(words(bubbleText({ label: 'Alex T.' })), "Hi, I'm Alex T.!");
  assert.equal(words(bubbleText({ label: null, greeting: 'Go team!' })), 'Hi! Go team!', 'no public name: no name at all');
  assert.equal(words(bubbleText({})), 'Hi!');
  assert.equal(words(bubbleText({ label: '   ', greeting: '  ' })), 'Hi!');
});

test('cleaning: one line, no control or invisible characters, at most 40 words and 280 characters, never markup', () => {
  assert.equal(cleanGreeting('  hello \n\n  world\t!  '), 'hello world !');
  assert.equal(cleanGreeting(`a${ch(0)}b${ch(0x200b)}c${ch(0x202e)}d${ch(0x2028)}e`), 'a b c d e');
  assert.equal(wordCount(cleanGreeting(many(40))), 40, '40 words pass whole');
  const cut = cleanGreeting(many(55));
  assert.equal(wordCount(cut), 40); assert.ok(cut.endsWith(ELLIPSIS), 'an ellipsis marks the cut');
  const longWords = cleanGreeting(Array.from({ length: 30 }, () => 'x'.repeat(20)).join(' '));
  assert.equal([...longWords].length, BUBBLE.maxChars, '280 characters at most');
  assert.equal([...cleanText(String.fromCodePoint(0x1f600).repeat(80), 60)].length, 60, 'counts characters, not UTF-16 units');
  assert.equal(cleanGreeting(42), ''); assert.equal(cleanGreeting(null), '');
  // the bubble only ever sets textContent: markup in a greeting shows as text
  const src = readFileSync(resolve(here, '../src/greeting-bubble.js'), 'utf8');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(src, /textContent = t\.lead/);
  assert.ok([...src].every((c) => c.charCodeAt(0) < 128), 'the module source is plain ASCII (no raw invisible characters)');
});

test('dynamic: short hellos get big type in a compact bubble and 3.8 s; 40 words get smaller type, a wider bubble and ~16 s', () => {
  const short = { label: 'Alex T.', greeting: 'Go team!' }, long = { label: 'Alex T.', greeting: many(40) };
  const s = bubbleStyle(short), l = bubbleStyle(long);
  assert.equal(s.fontPx, BUBBLE.font[0]); assert.equal(s.maxWidthPx, BUBBLE.width[0]);
  assert.ok(l.fontPx < s.fontPx && l.fontPx >= BUBBLE.font[1]); assert.ok(l.maxWidthPx > s.maxWidthPx && l.maxWidthPx <= BUBBLE.width[1]);
  assert.equal(readingSeconds({}), READING.minS);
  assert.equal(readingSeconds(short), READING.minS);
  const t40 = readingSeconds(long);
  assert.ok(t40 > 14 && t40 <= READING.maxS, `40 words: ${t40} s`);
  let prev = 0;
  for (const n of [0, 5, 10, 20, 30, 40, 60]) { const t = readingSeconds({ label: 'A', greeting: many(n) }); assert.ok(t >= prev); prev = t; }
});

test('placement: above the head, right of the visitor (left when the right has no room), always inside the Galaxy', () => {
  const layout = { width: 1248, height: 1080 };
  for (const box of [{ w: 360, h: 90 }, { w: 580, h: 240 }]) {
    const mid = bubblePlacement({ x: 500, y: 700, size: 60, scale: 5.4 }, box, layout);
    assert.equal(mid.side, 'right');
    assert.ok(mid.top + box.h <= 700 - 60 * 5.4 * 0.42 + 1e-9, 'above the head');
    const edge = bubblePlacement({ x: 1100, y: 700, size: 60, scale: 5.4 }, box, layout);
    assert.equal(edge.side, 'left');
    for (const v of [{ x: 20, y: 20, size: 60, scale: 5 }, { x: 1240, y: 1070, size: 128, scale: 3.2 }, { x: 600, y: 200, size: 60, scale: 5.4 }]) {
      const p = bubblePlacement(v, box, layout);
      assert.ok(p.left >= 16 && p.left + box.w <= layout.width - 16 && p.top >= 16 && p.top + box.h <= layout.height - 16, JSON.stringify(p));
    }
  }
});

test('scene: the visit item carries the Soul\'s public label, greeting and hi length', () => {
  const souls = Array.from({ length: 12 }, (_, i) => ({ soulId: `soul_${i}`, badge: null, label: i % 2 ? `Name ${i}` : null, greeting: i % 3 ? `hello ${i}` : null,
    config: { version: 2, catalog: 1, seed: `seed-${i}`, gradient: 1, glow: 0, face: 'nerdy', charms: [], constellation: [], driftPhase: 0 } }));
  const scene = createScene({ config: DEFAULT_SCENE_CONFIG, rings: DEFAULT_RINGS, starLayers: [] });
  scene.setSouls(souls);
  let v = null;
  for (let t = 0; t < 40 && !v; t += 1 / 30) { const f = scene.frame(t, t * 1000); if (f.visits[0] && f.visits[0].phase === 'hi') v = f.visits[0]; }
  assert.ok(v);
  const src = souls.find((s) => s.soulId === v.soulId);
  assert.equal(v.label, src.label); assert.equal(v.greeting, src.greeting);
  assert.equal(v.hiS, readingSeconds(src));
  assert.ok(v.key, 'each visit has its own key (the bubble resets per visit)');
});
