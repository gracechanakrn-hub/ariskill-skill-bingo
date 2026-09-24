import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COPY, t, exception } from '../../packages/contracts/index.js';

test('every exception E1-E23 has trigger, copy, and recovery', () => {
  for (let i = 1; i <= 23; i++) {
    const e = exception(`E${i}`);
    assert.ok(e, `E${i} missing`);
    for (const k of ['trigger', 'copy', 'recovery']) assert.ok(typeof e[k] === 'string' && e[k].length > 3, `E${i}.${k}`);
  }
});
test('exception copy matches the requirement table verbatim', () => {
  const req = readFileSync(new URL('../../docs/requirements/ariskill-skill-bingo-requirements.md', import.meta.url), 'utf8');
  for (let i = 1; i <= 23; i++) {
    const row = req.split('\n').find(l => l.startsWith(`| E${i} |`));
    assert.ok(row, `requirement row E${i}`);
    const cells = row.split('|').map(s => s.trim());
    const reqCopy = cells[3].replace(/^`|`$/g, '');
    assert.equal(exception(`E${i}`).copy, reqCopy, `E${i} copy drift`);
  }
});
test('key copy from requirement 8.2 is present', () => {
  const expected = ['Your Skill Bingo is ready!', 'Your board will lock when the countdown reaches 00:00.', 'Bingo unlocks next draw', 'Bingo detected', 'Round complete', 'Your Soul is ready to join Arise.', 'READY TO FLOAT', 'Reconnecting to the Skill Galaxy...'];
  const values = Object.values(COPY.key);
  for (const s of expected) assert.ok(values.includes(s), s);
});
test('t() interpolates and falls back to the key', () => {
  assert.equal(t('select.progress', { count: 17 }), '17 / 25 skills selected');
  assert.equal(t('nope.key'), 'nope.key');
});
test('state-copy.csv mirrors copy.json', () => {
  const csv = readFileSync(new URL('../../docs/ux/state-copy.csv', import.meta.url), 'utf8');
  const rows = csv.trim().split('\n').length - 1;
  assert.equal(rows, Object.keys(COPY.key).length + Object.keys(COPY.exceptions).length);
});
