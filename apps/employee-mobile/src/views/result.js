// apps/employee-mobile/src/views/result.js - E7 Result: winner / co-winner / not-winner copy without implying capability
// (M-10), completed line traced once for the first lineId (live only), "Reveal my Soul" once the Soul exists (E22 while forming).
import { h, mount } from '/packages/ui/dom.js';
import { animateOnce, MOTION } from '/packages/ui/motion.js';
import { t } from '/packages/contracts/index.js';
import { formatTime } from '/packages/ui/format.js';
import { tl, exceptionCopy, notice, button, roundLine, nextRoundBlock } from './common.js';
import { createGrid } from './grid.js';
import { nextRoundAction } from '../state.js';

export function mountResult(root, ctx) {
  const grid = createGrid();
  let els = {};
  let lastState = null;
  let tracedFor = null;

  function renderShell() {
    els = {};
    els.title = h('h1', { className: 'screen-title m-winner-text' });
    els.body = h('div', { className: 'stack stack--tight m-winner-text' });
    els.halo = h('div', { className: 'm-winner-halo', 'aria-hidden': 'true' });
    els.card = h('section', { className: 'card result-card stack', 'aria-labelledby': 'result-title' }, els.halo, els.title, els.body);
    els.round = h('div', { className: 'round-block' });
    els.actions = h('div', { className: 'stack stack--tight' });
    mount(root, h('div', { className: 'stack' }, els.round, els.card, h('div', { className: 'board-wrap' }, grid.el, grid.legend), els.actions));
    els.title.id = 'result-title';
  }

  function render(state) {
    if (!els.card) renderShell();
    const r = state.result;
    const isWinner = !!(r && r.isWinner);
    els.title.textContent = isWinner ? t('result.bingo') : t('result.roundComplete');
    els.title.classList.toggle('bingo-pill', isWinner); // sticker "Bingo!" pill (lime label, navy text)
    const lines = [];
    if (isWinner) {
      lines.push(h('p', { className: 'lead' }, t('result.winner', { draw: r.winningDrawNumber ?? '' })));
      const others = Math.max(0, (r.coWinnerCount || 1) - 1);
      if (others > 0) lines.push(h('p', null, t('result.coWinners', { count: others })));
    } else {
      lines.push(h('p', { className: 'lead' }, t('result.notWinner')));
    }
    lines.push(h('p', { className: 'muted' }, t('result.noRankNote')));
    // EO-02: the label the public/stage screens use for this participant (consented name or Soul # pseudonym),
    // so a winner can identify themselves to the MC. Hidden while the backend does not send it.
    const label = state.participant && state.participant.publicLabel;
    if (label) lines.push(h('p', { className: 'public-label' }, tl('ui.publicLabel', { label })));
    mount(els.body, lines);
    mount(els.round, roundLine(state.round));
    grid.update(state.board, { locked: true, lineIds: r && Array.isArray(r.lineIds) ? r.lineIds : [] });
    const actions = [];
    if (state.soul) actions.push(button(tl('ui.revealSoul'), { variant: 'primary', className: 'btn--block btn--lg', onClick: ctx.actions.revealSoul }));
    else actions.push(notice(exceptionCopy('E22'), { tone: 'info' }));
    const next = nextRoundAction(state, ctx.clockNow());
    if (next) actions.push(nextRoundBlock(next, { onBuild: () => ctx.actions.startNextRound(next), formatTime })); // UX-01: not gated by Float
    mount(els.actions, actions);
  }

  return {
    update(state) { lastState = state; render(state); },
    effect(e) {
      if (e.type === 'result' && e.live) {
        const key = `${lastState.round ? lastState.round.roundId : ''}`;
        if (tracedFor !== key) {
          tracedFor = key;
          if (e.isWinner && e.lineIds && e.lineIds.length) grid.traceLine(e.lineIds[0]);
          animateOnce(els.card, 'm-winner-burst', { durationMs: MOTION.interactions.winnerView.ms });
          if (e.isWinner && lastState.round) ctx.audioMotion.cueBingo(lastState.round.roundId);
        }
      }
      if (e.type === 'bingo' && e.live && lastState && lastState.round) ctx.audioMotion.cueBingo(lastState.round.roundId);
    },
    unmount() { mount(root, null); },
  };
}
