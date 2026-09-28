// Draw-guidance simulator (D-33). Builds boards the way the 4-question picker does (Q1 core skills, Q2 the role's technical
// skills, Q3 the role's soft skills, Q4 search; D-54) and compares plain random draws with guided draws.
// D-53: --unfinished 0.3 gives that share of players a partial board (1-15 skills on random cells, blank spots never
// match); a round whose pool runs out without a full line counts as a closest-line win (pctClosestFallback).
// Usage: node tools/sim/draw-sim.js [--rounds 2500] [--players 20,50,150,300] [--seed sim] [--unfinished 0.3] [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CELLS, seededRng, shuffle, randomizeBoard, randomizePartialBoard, buildDrawPool, simulateRound, DRAW_POLICY,
} from '../../packages/game-rules/src/index.js';

const master = JSON.parse(readFileSync(fileURLToPath(new URL('../../packages/skill-master/data/skill-master.json', import.meta.url)), 'utf8'));
const SKILLS = new Map(master.skills.map(s => [s.id, s]));
const ACTIVE = master.skills.filter(s => s.status === 'active').map(s => s.id);
const CORE7 = master.skills.filter(s => s.kind === 'Core Skill' && s.status === 'active').map(s => s.id);
const ROLE_SKILLS = new Map();
for (const m of master.roleSkillMap) { if (!ROLE_SKILLS.has(m.roleId)) ROLE_SKILLS.set(m.roleId, []); ROLE_SKILLS.get(m.roleId).push(m.skillId); }
const ROLES = master.roles.map(r => r.id).filter(id => ROLE_SKILLS.has(id));
const ofKind = (ids, kind) => ids.filter(id => SKILLS.get(id)?.kind === kind && SKILLS.get(id)?.status === 'active');
const ALL_SOFT = ofKind(ACTIVE, 'Soft Skill');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const ROUNDS = Number(args.rounds ?? 2500);
const PLAYERS = String(args.players ?? '20,50,150,300').split(',').map(Number);
const rng = seededRng(args.seed ?? 'sim');
const POLICY = { ...DRAW_POLICY, ...(args.policy ? JSON.parse(args.policy) : {}) };
const UNFINISHED = Number(args.unfinished ?? 0);

/** One player's 16 picks: Q1 each core skill ~55%, Q2 each role technical skill ~60%, Q3 each role soft skill ~60% (the
 *  role's own, topped up to 8 with other soft skills), Q4 search fills the rest. */
function playerPicks() {
  const picks = [];
  const add = (id) => { if (picks.length < CELLS && !picks.includes(id)) picks.push(id); };
  for (const id of CORE7) if (rng.int(100) < 55) add(id);
  const role = ROLES[rng.int(ROLES.length)];
  for (const id of shuffle(ofKind(ROLE_SKILLS.get(role), 'Hard Skill'), rng)) if (rng.int(100) < 60) add(id);
  let soft = ofKind(ROLE_SKILLS.get(role), 'Soft Skill');
  if (soft.length < 8) soft = soft.concat(ALL_SOFT.filter(id => !soft.includes(id)));
  for (const id of shuffle(soft, rng)) if (rng.int(100) < 60) add(id);
  for (const id of shuffle(ACTIVE, rng)) { if (picks.length >= CELLS) break; add(id); }
  return picks;
}

function run(players, guided) {
  const winDraws = [], winnerCounts = []; let exhausted = 0, inWindow = 0, oneOrTwo = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const boards = Array.from({ length: players }, (_, i) => {
      const picks = playerPicks();
      const cells = rng.int(1000) < UNFINISHED * 1000 ? randomizePartialBoard(picks.slice(0, 1 + rng.int(CELLS - 1)), rng) : randomizeBoard(picks, rng);
      return { boardId: `b${i}`, participantId: `p${i}`, cells };
    });
    const pool = buildDrawPool(boards, SKILLS);
    const res = simulateRound(boards, pool, rng, { guided, policy: POLICY });
    if (res.outcome !== 'WINNER') { exhausted++; continue; }
    const d = res.winningDrawNumber, w = res.winners.length;
    winDraws.push(d); winnerCounts.push(w);
    if (d >= DRAW_POLICY.winFrom && d <= DRAW_POLICY.winTo) inWindow++;
    if (w <= DRAW_POLICY.maxWinners) oneOrTwo++;
  }
  winDraws.sort((a, b) => a - b);
  const pct = (n) => Math.round((n / ROUNDS) * 1000) / 10;
  const q = (f) => winDraws.length ? winDraws[Math.min(winDraws.length - 1, Math.floor(f * winDraws.length))] : null;
  return {
    players, unfinished: UNFINISHED, mode: guided ? 'guided' : 'random', rounds: ROUNDS,
    winDrawMedian: q(0.5), winDrawP10: q(0.1), winDrawP90: q(0.9), winDrawMin: winDraws[0] ?? null, winDrawMax: winDraws.at(-1) ?? null,
    pctWinIn6to12: pct(inWindow), pct1or2Winners: pct(oneOrTwo), pctClosestFallback: pct(exhausted),
    avgWinners: winnerCounts.length ? Math.round(winnerCounts.reduce((a, b) => a + b, 0) / winnerCounts.length * 100) / 100 : null,
    maxWinners: winnerCounts.length ? Math.max(...winnerCounts) : null,
  };
}

const results = [];
for (const n of PLAYERS) for (const guided of (args.mode === 'guided' ? [true] : [false, true])) { const r = run(n, guided); results.push(r); console.log(JSON.stringify(r)); }
if (args.json) writeFileSync(args.json, JSON.stringify({ policy: POLICY, results }, null, 2));
