import test from 'node:test';
import assert from 'node:assert/strict';
import { winnerDisplayRows, WINNER_MAX_ROWS, formatPercent, formatTopSkills, formatDensity, formatEngagement, formatAlignment, formatBeyond, formatInsights, formatClock, ageSeconds, kindIcon, winnerRows, shortSoulId } from '../src/insights.js';

test('formatPercent clamps and rounds', () => {
  assert.equal(formatPercent(0.813), '81%');
  assert.equal(formatPercent(1.4), '100%');
  assert.equal(formatPercent(-1), '0%');
  assert.equal(formatPercent('x'), '');
  assert.equal(formatPercent(0.4567, { digits: 1 }), '45.7%');
});

test('formatTopSkills ranks, caps at the limit and scales bars to the max count', () => {
  const rows = formatTopSkills([{ skillId: 'a', name: 'A', kind: 'Core', count: 20 }, { skillId: 'b', name: 'B', kind: 'Critical', count: 5 }, { name: 'C', count: 10 }, { name: 'bad' }, null], { limit: 2 });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => [r.rank, r.name, r.pct]), [[1, 'A', 100], [2, 'C', 50]]);
  assert.equal(rows[0].icon.glyph, '◆');
  assert.equal(rows[0].icon.className, 'kind--core');
  assert.deepEqual(formatTopSkills(undefined), []);
});

test('formatDensity yields three proportional bars', () => {
  const d = formatDensity({ core: 317, critical: 374, optional: 59, totalSelections: 750 });
  assert.equal(d.total, 750);
  assert.deepEqual(d.bars.map(b => [b.key, b.pct, b.percentLabel]), [['core', 42, '42%'], ['critical', 50, '50%'], ['optional', 8, '8%']]);
  assert.deepEqual(formatDensity(null).bars.map(b => b.pct), [0, 0, 0]);
  assert.equal(formatDensity({ core: 1, critical: 1, optional: 2 }).total, 4);
});

test('formatEngagement sorts by joined desc, caps at 8 and adds completion percent', () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ platformId: `p${i}`, name: `P${i}`, joined: 5 + i, completed: 4 + i }));
  const rows = formatEngagement(list);
  assert.equal(rows.length, 8);
  assert.equal(rows[0].name, 'P9');
  assert.equal(rows[0].completionPct, Math.round((13 / 14) * 100));
  assert.equal(formatEngagement([{ roleId: 'r', name: 'R', joined: 0, completed: 0 }])[0].completionPct, 0);
  assert.deepEqual(formatEngagement(null), []);
});

test('formatAlignment returns large percentage plus version, or null', () => {
  assert.deepEqual(formatAlignment({ rate: 0.813, matrixVersion: 'v1', participants: 30 }), { rate: 0.813, percent: '81%', matrixVersion: 'v1', participants: 30 });
  assert.equal(formatAlignment(null), null);
  assert.equal(formatAlignment({ rate: null }), null);
});

test('formatBeyond ranks and scales like top skills', () => {
  const rows = formatBeyond([{ name: 'X', count: 4 }, { name: 'Y', count: 2 }], { limit: 10 });
  assert.deepEqual(rows.map(r => [r.rank, r.name, r.pct]), [[1, 'X', 100], [2, 'Y', 50]]);
});

test('formatInsights applies full limits on the insights focus and compact limits on the live focus', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ skillId: `s${i}`, name: `S${i}`, kind: 'Core', count: 20 - i }));
  const insights = { topSkills: many(10), coreCriticalDensity: { core: 1, critical: 1, optional: 1, totalSelections: 3 }, platformEngagement: many(9).map(s => ({ platformId: s.skillId, name: s.name, joined: s.count, completed: 1 })), roleEngagement: [], matrixAlignment: { rate: 0.5, matrixVersion: 'm', participants: 2 }, skillsBeyondMatrix: many(10), suppressedCohorts: 3 };
  const full = formatInsights(insights, { layout: 'insights' });
  assert.equal(full.compact, false);
  assert.equal(full.topSkills.length, 10);
  assert.equal(full.platforms.length, 8);
  assert.equal(full.beyond.length, 10);
  assert.equal(full.suppressedCohorts, 3);
  assert.equal(full.hasData, true);
  const live = formatInsights(insights, { layout: 'live' });
  assert.equal(live.compact, true);
  assert.equal(live.topSkills.length, 5);
  assert.equal(live.platforms.length, 3);
  assert.equal(live.beyond.length, 5);
  assert.equal(formatInsights(null).hasData, false);
});

test('formatClock and ageSeconds', () => {
  assert.match(formatClock('2026-09-22T05:55:07.000Z'), /^\d{2}:\d{2}:07$/);
  assert.equal(formatClock(null), '');
  assert.equal(ageSeconds('2026-09-22T05:55:00.000Z', Date.parse('2026-09-22T05:55:12.400Z')), 12);
  assert.equal(ageSeconds('bad', Date.now()), null);
});

test('kindIcon always returns a glyph + class so kind is never colour-only', () => {
  assert.equal(kindIcon('Critical').glyph, '●');
  assert.equal(kindIcon('nope').className, 'kind--optional');
});

test('winnerRows keeps labels, null labels and the winning draw number; shortSoulId trims', () => {
  const rows = winnerRows([{ label: 'Ada', soulId: 'soul_abc123', winningDrawNumber: 7 }, { label: null, soulId: 'soul_zz9', winningDrawNumber: null }]);
  assert.deepEqual(rows[0], { label: 'Ada', soulId: 'soul_abc123', winningDrawNumber: 7, shortId: 'C123' });
  assert.equal(rows[1].label, null);
  assert.equal(rows[1].winningDrawNumber, null);
  assert.equal(shortSoulId('soul_zz9'), 'ZZ9');
});

test('winnerDisplayRows never drops names silently: up to 6 rows full size, beyond that dense + "+N more"', () => {
  const w = (n) => Array.from({ length: n }, (_, i) => ({ label: i % 2 ? null : `Winner ${i}`, soulId: `soul_${i}`, winningDrawNumber: 7 }));
  const small = winnerDisplayRows(w(2));
  assert.deepEqual([small.rows.length, small.more, small.dense], [2, 0, false]);
  assert.equal(small.rows[1].label, null);
  const big = winnerDisplayRows(w(9));
  assert.deepEqual([big.rows.length, big.more, big.dense, big.total], [WINNER_MAX_ROWS, 3, true, 9]);
});

test('clip selector excludes winner lists (winner names are never clipped) - source-level guard', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/view.js', import.meta.url), 'utf8');
  const m = src.match(/export const CLIP_LIST_SELECTOR = '([^']+)'/);
  assert.ok(m, 'CLIP_LIST_SELECTOR present');
  assert.ok(!m[1].includes('winners'), `winners list must not be clippable: ${m[1]}`);
});
