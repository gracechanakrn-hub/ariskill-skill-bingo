// Guided draw (D-33, BR-10). The admin still only presses "Next Skill"; the server picks at random, but only among the
// skills that keep the round on target: no winner before draw `winFrom`, at most `maxWinners` co-winners, and a win
// becoming increasingly likely from draw `pushFrom` so it lands by about draw `winTo`. Boards are read only as position
// patterns (never who owns them), and any tie between eligible skills is broken by the rng.
import { LINE_MASKS } from './lines.js';

export const DRAW_POLICY = Object.freeze({ winFrom: 6, winTo: 12, maxWinners: 2, pushFrom: 8, buildFrom: 3, buildPower: 2 });

/**
 * Per remaining skill: how many boards would win if it were drawn next (`wins`), and a build-up score (`near`) that
 * sums, over every unfinished line containing it, 1 when two are still missing after it and 4 when one is.
 * activeBoards: [{ cells: [{position, skillId}] }]; drawnSet: Set of drawn skill ids.
 */
export function drawOutlook(activeBoards, drawnSet) {
  const wins = new Map();
  const near = new Map();
  for (const b of activeBoards) {
    const byPos = [];
    for (const c of b.cells) byPos[c.position] = c.skillId;
    const winsHere = new Set();
    for (const l of LINE_MASKS) {
      const missing = [];
      for (const p of l.positions) if (!drawnSet.has(byPos[p])) { missing.push(byPos[p]); if (missing.length > 3) break; }
      if (missing.length === 1) winsHere.add(missing[0]);
      else if (missing.length <= 3) { const v = missing.length === 2 ? 4 : 1; for (const s of missing) near.set(s, (near.get(s) ?? 0) + v); }
    }
    for (const s of winsHere) wins.set(s, (wins.get(s) ?? 0) + 1);
  }
  return { wins, near };
}

function weightedPick(items, weightOf, rng) {
  let total = 0;
  const w = items.map(s => { const v = weightOf(s); total += v; return v; });
  let r = rng.int(1_000_000) / 1_000_000 * total;
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r < 0) return items[i]; }
  return items[items.length - 1];
}
const chance = (p, rng) => rng.int(1_000_000) < p * 1_000_000;

/**
 * Choose the next skill. Returns { skillId, mode, winners } where mode is one of
 * 'hold' (before winFrom, no winner allowed), 'open' (a win may happen naturally), 'push' (a win was chosen on purpose),
 * 'build' (steering toward one-away lines), or 'fallback' (no skill fits the policy; the fewest-winners skill is used).
 */
export function guidedDraw(remainingPool, activeBoards, drawnSet, drawNumber, rng, policy = DRAW_POLICY) {
  if (!remainingPool.length) return { skillId: null, mode: 'empty', winners: 0 };
  const { winFrom, winTo, maxWinners, pushFrom, buildFrom, buildPower } = { ...DRAW_POLICY, ...policy };
  const { wins, near } = drawOutlook(activeBoards, drawnSet);
  const winsOf = (s) => wins.get(s) ?? 0;
  const build = drawNumber >= buildFrom ? (s) => (1 + (near.get(s) ?? 0)) ** buildPower : () => 1;
  const out = (skillId, mode) => ({ skillId, mode, winners: winsOf(skillId) });
  const fewest = () => { const min = Math.min(...remainingPool.map(winsOf)); return remainingPool.filter(s => winsOf(s) === min); };

  if (drawNumber < winFrom) {
    const safe = remainingPool.filter(s => winsOf(s) === 0);
    return safe.length ? out(weightedPick(safe, build, rng), 'hold') : out(weightedPick(fewest(), build, rng), 'fallback');
  }
  const ok = remainingPool.filter(s => winsOf(s) <= maxWinners);
  if (!ok.length) return out(weightedPick(fewest(), build, rng), 'fallback');
  const winning = ok.filter(s => winsOf(s) > 0);
  if (drawNumber < pushFrom) return out(weightedPick(ok, build, rng), 'open');
  const pushChance = drawNumber >= winTo ? 1 : (drawNumber - pushFrom + 1) / (winTo - pushFrom + 1);
  if (winning.length && chance(pushChance, rng)) return out(weightedPick(winning, () => 1, rng), 'push');
  const buildWeight = drawNumber >= winTo ? (s) => build(s) ** 2 : build;
  return out(weightedPick(ok, buildWeight, rng), 'build');
}
