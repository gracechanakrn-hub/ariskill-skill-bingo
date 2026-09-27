// Bingo line rules (contracts/bingo-rules.json). Positions are row-major 0..15 on a 4 x 4 board.
export const GRID = 4;
export const CELLS = GRID * GRID;
export const MIN_DRAW_FOR_BINGO = 4;

function mask(positions) { let m = 0; for (const p of positions) m |= (1 << p); return m >>> 0; }

const defs = [];
const idx = [...Array(GRID).keys()];
for (const r of idx) defs.push({ id: `row-${r}`, positions: idx.map(c => r * GRID + c) });
for (const c of idx) defs.push({ id: `col-${c}`, positions: idx.map(r => r * GRID + c) });
defs.push({ id: 'diag-main', positions: idx.map(i => i * GRID + i) });
defs.push({ id: 'diag-anti', positions: idx.map(i => i * GRID + (GRID - 1 - i)) });

/** The fixed set of 10 winning lines: 4 rows, 4 columns, 2 diagonals. */
export const LINE_MASKS = Object.freeze(defs.map(d => Object.freeze({ id: d.id, positions: Object.freeze(d.positions), mask: mask(d.positions) })));

export function maskFromPositions(positions) { return mask(positions); }
export function positionsFromMask(m) { const out = []; for (let p = 0; p < CELLS; p++) if (m & (1 << p)) out.push(p); return out; }

/** Lines fully covered by the matched-cell mask. */
export function completedLines(matchMask) { return LINE_MASKS.filter(l => (matchMask & l.mask) === l.mask); }

/** Bingo evaluation is only active from draw MIN_DRAW_FOR_BINGO (BR-12). */
export function isEvaluationActive(drawNumber) { return Number.isInteger(drawNumber) && drawNumber >= MIN_DRAW_FOR_BINGO; }

/** Returns the completed line ids if the board has Bingo at this draw number, else []. */
export function bingoLines(matchMask, drawNumber) {
  if (!isEvaluationActive(drawNumber)) return [];
  return completedLines(matchMask).map(l => l.id);
}

/** Number of matched cells in the best (most-filled) line: used for admin "one away" readiness. */
export function bestLineProgress(matchMask) {
  let best = 0;
  for (const l of LINE_MASKS) { let n = 0; for (const p of l.positions) if (matchMask & (1 << p)) n++; if (n > best) best = n; }
  return best;
}
