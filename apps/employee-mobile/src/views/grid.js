// apps/employee-mobile/src/views/grid.js - the 4 x 4 board grid shared by board / playing / result screens, drawn on the
// Blender tray and tiles (D-34; art in apps/employee-mobile/art). Tiles carry no Core / Critical / Optional labels (D-35).
// State first: `.is-matched` / `.is-on-line` / `.is-locked` come from server state; one-shot `.m-*` classes are
// applied only by the caller after the celebration guard allowed them (docs/motion/motion-spec.md section 1).
import { h } from '/packages/ui/dom.js';
import { applyMatch, markLine, staggerIndex, animateOnce, MOTION } from '/packages/ui/motion.js';
import { tl } from './common.js';
import { cellsByPosition, REQUIRED_SELECTIONS } from '../state.js';

export function createGrid({ label = tl('ui.yourBoard') } = {}) {
  const grid = h('ol', { className: 'bingo-grid', role: 'list', 'aria-label': label });
  const el = h('div', { className: 'tray' }, grid);
  const legend = null; // no kind legend on the 4 x 4 board (D-35)
  let cells = [];
  let boardId = null;
  let version = null;

  function build(board) {
    const byPos = cellsByPosition(board) || new Array(REQUIRED_SELECTIONS).fill(null);
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    cells = byPos.map((c, i) => {
      const longest = c ? Math.max(...c.name.split(/[\s/]+/).map((w) => w.length)) : 0;
      const size = longest > 12 ? ' bingo-cell--xs' : longest > 10 ? ' bingo-cell--sm' : '';
      return h('li', { className: `bingo-cell${c ? size : ' bingo-cell--empty'}`, dataset: { position: String(i) } },
        h('span', { className: 'bingo-cell__name' }, c ? c.name.replace(/\//g, '/\u200b') : ''),
        h('span', { className: 'visually-hidden bingo-cell__status' }, ''));
    });
    for (const cell of cells) grid.appendChild(cell);
    staggerIndex(grid);
    boardId = board ? board.boardId : null;
    version = board ? board.version : null;
  }

  /** Applies persistent state from the board (matched positions, locked). Rebuilds only when the layout changed. */
  function update(board, { locked = false, lineIds = [] } = {}) {
    if (!board) { if (cells.length) build(null); return; }
    if (board.boardId !== boardId || board.version !== version || !cells.length) build(board);
    const matched = new Set(board.matchedPositions || []);
    cells.forEach((cell, i) => {
      const on = matched.has(i);
      if (on) applyMatch(cell, { celebrate: false }); else cell.classList.remove('is-matched');
      const status = cell.querySelector('.bingo-cell__status');
      if (status) status.textContent = on ? ` (${tl('ui.matched')})` : '';
    });
    grid.classList.toggle('is-locked', !!locked);
    grid.classList.toggle('is-complete', !!(board.cells && board.cells.length === REQUIRED_SELECTIONS));
    for (const id of lineIds) markLine(cells, id);
  }

  return {
    el,
    legend,
    get cells() { return cells; },
    update,
    /** Live-only celebrations. */
    celebrateComplete() { return animateOnce(grid, 'm-board-complete', { durationMs: MOTION.interactions.boardComplete.ms }); },
    celebrateLock() { return animateOnce(grid, 'm-lock', { durationMs: MOTION.interactions.boardLock.ms }); },
    celebrateMatches(positions) {
      const delay = MOTION.interactions.drawArrival.matchDelayMs;
      const timer = setTimeout(() => { for (const p of positions) if (cells[p]) applyMatch(cells[p], { celebrate: true }); }, delay);
      return () => clearTimeout(timer);
    },
    traceLine(lineId) {
      markLine(cells, lineId);
      return animateOnce(grid, 'm-line-trace', { durationMs: MOTION.delays.lineTraceAfterMatch + 4 * MOTION.stagger.lineCell + MOTION.interactions.bingoLine.cellMs });
    },
  };
}
