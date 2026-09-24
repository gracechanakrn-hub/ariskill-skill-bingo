// apps/employee-mobile/src/views/grid.js - the 5 x 5 board grid shared by board / playing / result screens.
// State first: `.is-matched` / `.is-on-line` / `.is-locked` come from server state; one-shot `.m-*` classes are
// applied only by the caller after the celebration guard allowed them (docs/motion/motion-spec.md section 1).
import { h } from '/packages/ui/dom.js';
import { applyMatch, markLine, staggerIndex, animateOnce, MOTION } from '/packages/ui/motion.js';
import { tl, kindClass } from './common.js';
import { cellsByPosition, kindOf } from '../state.js';

const KIND_ICON = { Core: '◆', Critical: '●', Optional: '○' };

export function createGrid({ label = tl('ui.yourBoard') } = {}) {
  const el = h('ol', { className: 'bingo-grid', role: 'list', 'aria-label': label });
  // Kind legend: icon + label once per board (cells carry icon + colour + a visually hidden label).
  const legend = h('p', { className: 'grid-legend' }, ...['Core', 'Critical', 'Optional'].map((k) => h('span', { className: `kind kind--${k.toLowerCase()}` }, h('span', { className: 'kind__icon', 'aria-hidden': 'true' }, KIND_ICON[k]), h('span', null, tl(`ui.kind.${k}`)))));
  let cells = [];
  let boardId = null;
  let version = null;

  function build(board) {
    const byPos = cellsByPosition(board) || new Array(25).fill(null);
    while (el.firstChild) el.removeChild(el.firstChild);
    cells = byPos.map((c, i) => {
      const kind = c ? kindOf(c) : null;
      const cell = h('li', {
        className: ['bingo-cell', c ? kindClass('bingo-cell', c) : 'bingo-cell--empty'].join(' '),
        dataset: { position: String(i) },
      },
        c ? h('span', { className: 'bingo-cell__kind' }, h('span', { 'aria-hidden': 'true' }, KIND_ICON[kind]), h('span', { className: 'visually-hidden' }, ` ${tl(`ui.kind.${kind}`)} `)) : null,
        h('span', { className: 'bingo-cell__name' }, c ? c.name : '—'),
        h('span', { className: 'visually-hidden bingo-cell__status' }, ''));
      return cell;
    });
    for (const cell of cells) el.appendChild(cell);
    staggerIndex(el);
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
    el.classList.toggle('is-locked', !!locked);
    el.classList.toggle('is-complete', !!(board.cells && board.cells.length === 25));
    for (const id of lineIds) markLine(cells, id);
  }

  return {
    el,
    legend,
    get cells() { return cells; },
    update,
    /** Live-only celebrations. */
    celebrateComplete() { return animateOnce(el, 'm-board-complete', { durationMs: MOTION.interactions.boardComplete.ms }); },
    celebrateLock() { return animateOnce(el, 'm-lock', { durationMs: MOTION.interactions.boardLock.ms }); },
    celebrateMatches(positions) {
      const delay = MOTION.interactions.drawArrival.matchDelayMs;
      const timer = setTimeout(() => { for (const p of positions) if (cells[p]) applyMatch(cells[p], { celebrate: true }); }, delay);
      return () => clearTimeout(timer);
    },
    traceLine(lineId) {
      markLine(cells, lineId);
      return animateOnce(el, 'm-line-trace', { durationMs: MOTION.delays.lineTraceAfterMatch + 5 * MOTION.stagger.lineCell + MOTION.interactions.bingoLine.cellMs });
    },
  };
}
