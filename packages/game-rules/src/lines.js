// Bingo line rules (contracts/bingo-rules.json). Positions are row-major 0..24.
export const GRID = 5;
export const CELLS = 25;
export const MIN_DRAW_FOR_BINGO = 5;

function mask(positions) { let m = 0; for (const p of positions) m |= (1 << p); return m >>> 0; }

const defs = [];
for (let r = 0; r < GRID; r++) defs.push({ id: `row-${r}`, positions: [0, 1, 2, 3, 4].map(c => r * GRID + c) });
for (let c = 0; c < GRID; c++) defs.push({ id: `col-${c}`, positions: [0, 1, 2, 3, 4].map(r => r * GRID + c) });
defs.push({ id: 'diag-main', positions: [0, 6, 12, 18, 24] });
defs.push({ id: 'diag-anti', positions: [4, 8, 12, 16, 20] });

/** The fixed set of 12 winning lines: 5 rows, 5 columns, 2 diagonals. */
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

/** Number of matched cells in the best (most-filled) line: used for admin "four in a line" readiness. */
export function bestLineProgress(matchMask) {
  let best = 0;
  for (const l of LINE_MASKS) { let n = 0; for (const p of l.positions) if (matchMask & (1 << p)) n++; if (n > best) best = n; }
  return best;
}
