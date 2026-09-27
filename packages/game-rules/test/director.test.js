// Guided draw director (D-33, BR-10): the server still picks at random, but only among skills that keep the round on
// target (no winner before draw 6, at most 2 co-winners, a win pushed from draw 8 and forced by draw 12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidedDraw, drawOutlook, DRAW_POLICY } from '../src/director.js';
import { simulateRound, evaluateDraw } from '../src/evaluate.js';
import { buildDrawPool } from '../src/pool.js';
import { randomizeBoard } from '../src/board.js';
import { CELLS, GRID } from '../src/lines.js';
import { seededRng, shuffle } from '../src/random.js';
import { SKILL_MASTER, SKILLS, ELIGIBLE_IDS, cellsFrom } from './helpers.js';
import rules from '../../../contracts/bingo-rules.json' with { type: 'json' };

const SEEDS = 60;
const A = ELIGIBLE_IDS.slice(0, CELLS), B = ELIGIBLE_IDS.slice(CELLS, 2 * CELLS), C = ELIGIBLE_IDS.slice(2 * CELLS, 3 * CELLS);
const board = (id, ids) => ({ boardId: `b-${id}`, participantId: `p-${id}`, cells: cellsFrom(ids) });
/** Boards sharing A's row 0 (positions 0-3); the rest of each board is unique. */
const rowSharers = (n) => Array.from({ length: n }, (_, i) => board(`s${i}`, [...A.slice(0, GRID), ...ELIGIBLE_IDS.slice(100 + i * CELLS, 100 + i * CELLS + CELLS - GRID)]));
const oneAwayDrawn = new Set(A.slice(0, GRID - 1)); // A[3] completes row 0 on every sharer
const FILLER = ELIGIBLE_IDS.slice(60, 80); // skills on no board: always safe

test('DRAW_POLICY matches the contract (bingo-rules.json drawPool.policy)', () => {
  assert.deepEqual({ ...DRAW_POLICY }, rules.drawPool.policy);
  assert.deepEqual(DRAW_POLICY, { winFrom: 6, winTo: 12, maxWinners: 2, pushFrom: 8, buildFrom: 3, buildPower: 2 });
  assert.ok(Object.isFrozen(DRAW_POLICY));
});

test('drawOutlook: wins counts boards completed by a skill; near scores lines two or three away', () => {
  const boards = rowSharers(2);
  const { wins, near } = drawOutlook(boards, oneAwayDrawn);
  assert.equal(wins.get(A[3]), 2);
  assert.equal(wins.size, 1);
  const none = drawOutlook(boards, new Set());
  assert.equal(none.wins.size, 0);
  assert.equal(none.near.size, 0, 'no line is within three of complete on an empty board');
  const two = drawOutlook([board('x', A)], new Set(A.slice(0, 2))); // row 0 missing A[2], A[3]
  assert.equal(two.near.get(A[2]), 4); assert.equal(two.near.get(A[3]), 4);
});

test('empty pool returns mode empty', () => {
  assert.deepEqual(guidedDraw([], rowSharers(1), new Set(), 1, seededRng(1)), { skillId: null, mode: 'empty', winners: 0 });
});

test('no winner before draw 6 when a safe skill exists (hold)', () => {
  const boards = rowSharers(1);
  const remaining = [A[3], ...FILLER.slice(0, 3)];
  for (let seed = 0; seed < SEEDS; seed++) {
    for (let n = 1; n < DRAW_POLICY.winFrom; n++) {
      const r = guidedDraw(remaining, boards, oneAwayDrawn, n, seededRng(`hold-${seed}-${n}`));
      assert.notEqual(r.skillId, A[3], `draw ${n} seed ${seed}`);
      assert.equal(r.mode, 'hold'); assert.equal(r.winners, 0);
    }
  }
});

test('fallback: when every remaining skill would create a winner early, the fewest-winners skill is drawn', () => {
  // A[3] completes row 0 on two boards; B[3] completes row 0 on one board. Nothing safe remains at draw 5.
  const boards = [...rowSharers(2), board('b', B)];
  const drawn = new Set([...oneAwayDrawn, ...B.slice(0, GRID - 1)]);
  for (let seed = 0; seed < SEEDS; seed++) {
    const r = guidedDraw([A[3], B[3]], boards, drawn, 5, seededRng(`fb-${seed}`));
    assert.deepEqual(r, { skillId: B[3], mode: 'fallback', winners: 1 });
  }
  // After winFrom, if every skill would make more than maxWinners winners, the fewest still wins.
  const crowd = rowSharers(4);
  const r = guidedDraw([A[3]], crowd, oneAwayDrawn, 9, seededRng('fb-late'));
  assert.deepEqual(r, { skillId: A[3], mode: 'fallback', winners: 4 });
});

test('never more than 2 winners when an alternative exists', () => {
  const boards = rowSharers(3); // A[3] would make 3 co-winners
  const remaining = [A[3], ...FILLER.slice(0, 4)];
  for (let seed = 0; seed < SEEDS; seed++) {
    for (let n = DRAW_POLICY.winFrom; n <= 20; n++) {
      const r = guidedDraw(remaining, boards, oneAwayDrawn, n, seededRng(`max-${seed}-${n}`));
      assert.notEqual(r.skillId, A[3], `draw ${n} seed ${seed}`);
      assert.ok(r.winners <= DRAW_POLICY.maxWinners);
    }
  }
  // Two co-winners are allowed: at draw 12 the pair is pushed.
  const pair = rowSharers(2);
  for (let seed = 0; seed < SEEDS; seed++) assert.deepEqual(guidedDraw(remaining, pair, oneAwayDrawn, 12, seededRng(`pair-${seed}`)), { skillId: A[3], mode: 'push', winners: 2 });
});

test('from draw 12 a winning skill is always chosen when one with 1-2 winners exists', () => {
  const boards = [board('a', A), ...rowSharers(0)];
  const remaining = [...FILLER, A[3]];
  for (let seed = 0; seed < SEEDS; seed++) {
    for (const n of [DRAW_POLICY.winTo, DRAW_POLICY.winTo + 1, 25]) {
      const r = guidedDraw(remaining, boards, oneAwayDrawn, n, seededRng(`push-${seed}-${n}`));
      assert.deepEqual(r, { skillId: A[3], mode: 'push', winners: 1 });
    }
  }
  // Between pushFrom and winTo the push is probabilistic: some draws push, some build, never a >2 winner.
  const modes = new Set();
  for (let seed = 0; seed < 200; seed++) modes.add(guidedDraw(remaining, boards, oneAwayDrawn, DRAW_POLICY.pushFrom, seededRng(`mid-${seed}`)).mode);
  assert.ok(modes.has('push') && modes.has('build'), [...modes].join(','));
  // Draws 6-7 are "open": a natural win may happen but is not forced.
  assert.equal(guidedDraw(remaining, boards, oneAwayDrawn, DRAW_POLICY.winFrom, seededRng('open')).mode, 'open');
});

test('deterministic with seededRng; the chosen skill is always from the remaining pool', () => {
  const boards = [board('a', A), board('b', B), board('c', C)];
  const pool = buildDrawPool(boards, SKILLS);
  const run = (seed) => {
    let remaining = pool.slice(); const drawn = new Set(); const out = [];
    for (let n = 1; remaining.length && n <= 20; n++) {
      const r = guidedDraw(remaining, boards, drawn, n, seededRng(`${seed}:draw-${n}`));
      assert.ok(remaining.includes(r.skillId));
      out.push(r); drawn.add(r.skillId); remaining = remaining.filter(s => s !== r.skillId);
    }
    return out;
  };
  assert.deepEqual(run('det-1'), run('det-1'));
  assert.notDeepEqual(run('det-1').map(r => r.skillId), run('det-2').map(r => r.skillId));
});

// Realistic boards like the 3-question picker (tools/sim/draw-sim.js): Q1 core skills ~55%, Q2 role skills ~60%, Q3 fill.
const CORE7 = SKILL_MASTER.skills.filter(s => s.kind === 'Core Skill' && s.status === 'active').map(s => s.id);
const ROLE_SKILLS = new Map();
for (const m of SKILL_MASTER.roleSkillMap) { if (!ROLE_SKILLS.has(m.roleId)) ROLE_SKILLS.set(m.roleId, []); ROLE_SKILLS.get(m.roleId).push(m.skillId); }
const ROLE_IDS = [...ROLE_SKILLS.keys()];
function playerPicks(rng) {
  const picks = [];
  const add = (id) => { if (picks.length < CELLS && !picks.includes(id)) picks.push(id); };
  for (const id of CORE7) if (rng.int(100) < 55) add(id);
  for (const id of shuffle(ROLE_SKILLS.get(ROLE_IDS[rng.int(ROLE_IDS.length)]), rng)) if (rng.int(100) < 60) add(id);
  for (const id of shuffle(ELIGIBLE_IDS, rng)) { if (picks.length >= CELLS) break; add(id); }
  return picks;
}

test('simulateRound guided: 200 seeded rounds of 30 realistic boards land 1-2 winners between draws 6 and 12 in >= 95%', () => {
  const ROUNDS = 200, PLAYERS = 30;
  let onTarget = 0, guidedWins = 0, randomEarly = 0; // randomEarly is reported for context only
  for (let r = 0; r < ROUNDS; r++) {
    const rng = seededRng(`director-sim-${r}`);
    const boards = Array.from({ length: PLAYERS }, (_, i) => ({ boardId: `b${i}`, participantId: `p${i}`, cells: randomizeBoard(playerPicks(rng), rng) }));
    const pool = buildDrawPool(boards, SKILLS);
    const res = simulateRound(boards, pool, seededRng(`director-draws-${r}`), { guided: true });
    assert.deepEqual(res, simulateRound(boards, pool, seededRng(`director-draws-${r}`), { guided: true }), 'deterministic');
    if (res.outcome === 'WINNER') {
      guidedWins++;
      // every declared winner really owns a line on the winning draw, and nobody had one on the draw before
      const drawn = new Set(res.draws.map(d => d.skillId));
      assert.equal(evaluateDraw(boards, drawn, res.winningDrawNumber).winners.length, res.winners.length);
      const w = res.winners.length, d = res.winningDrawNumber;
      if (w >= 1 && w <= DRAW_POLICY.maxWinners && d >= DRAW_POLICY.winFrom && d <= DRAW_POLICY.winTo) onTarget++;
    }
    const plain = simulateRound(boards, pool, seededRng(`director-draws-${r}`));
    if (plain.winningDrawNumber !== null && plain.winningDrawNumber < DRAW_POLICY.winFrom) randomEarly++;
  }
  assert.ok(onTarget / ROUNDS >= 0.95, `on target ${onTarget}/${ROUNDS} (wins ${guidedWins}, plain random early wins ${randomEarly})`);
});
