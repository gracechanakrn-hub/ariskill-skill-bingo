// apps/employee-mobile/src/views/playing.js - E6 Playing: accepted draws (latest as .draw-card), automatic matches
// from server state (BR-11), draws 1-3 banner vs "Bingo is live" from draw 4 (M-09), matched count.
import { h, mount } from '/packages/ui/dom.js';
import { animateOnce, MOTION } from '/packages/ui/motion.js';
import { t } from '/packages/contracts/index.js';
import { tl, kindChip, kindClass, roundLine, placeholder } from './common.js';
import { createGrid } from './grid.js';
import { playingBannerKey } from '../state.js';

export function mountPlaying(root, ctx) {
  const grid = createGrid();
  let els = {};
  let lastDrawId = null;
  let lastState = null;

  function renderShell() {
    els = {};
    els.banner = h('p', { className: 'play-banner', role: 'status' });
    els.card = h('div', { className: 'draw-card', 'aria-live': 'off' });
    els.matched = h('p', { className: 'play-matched', role: 'status' });
    els.list = h('ol', { className: 'draw-list', role: 'list', 'aria-label': tl('ui.draws'), reversed: true });
    els.round = h('div', { className: 'round-block' });
    mount(root, h('div', { className: 'stack' },
      h('h1', { className: 'screen-title' }, t('app.title')),
      els.round,
      els.banner,
      els.card,
      h('div', { className: 'board-wrap' }, grid.el, grid.legend),
      els.matched,
      h('section', { className: 'stack stack--tight', 'aria-labelledby': 'draws-title' }, h('h2', { id: 'draws-title', className: 'section__title' }, tl('ui.draws')), els.list)));
  }

  function drawCard(draw) {
    const s = draw.skill;
    return [
      h('p', { className: 'draw-card__number' }, t('play.draw', { number: draw.number })),
      h('p', { className: 'draw-card__name' }, s.name),
      h('div', { className: 'cluster draw-card__meta' }, kindChip(s), s.domain ? h('span', { className: 'muted' }, s.domain) : null),
    ];
  }

  function render(state) {
    if (!els.card) renderShell();
    mount(els.round, roundLine(state.round));
    els.banner.textContent = t(playingBannerKey(state));
    els.banner.classList.toggle('play-banner--live', playingBannerKey(state) === 'play.evaluationActive');
    const draws = state.draws;
    const latest = draws.length ? draws[draws.length - 1] : null;
    if (latest) {
      if (latest.drawId !== lastDrawId) { mount(els.card, drawCard(latest)); els.card.className = ['draw-card', kindClass('draw-card', latest.skill)].join(' '); }
      els.card.hidden = false;
    } else { mount(els.card, placeholder(t('play.pacing'))); els.card.hidden = false; }
    lastDrawId = latest ? latest.drawId : null;
    grid.update(state.board, { locked: true });
    const count = state.board && Array.isArray(state.board.matchedPositions) ? state.board.matchedPositions.length : 0;
    els.matched.textContent = t('play.matched', { count });
    mount(els.list, draws.length ? draws.slice().reverse().map((d) => h('li', { className: ['draw-list__item', d === latest ? 'is-current' : ''].join(' ') },
      h('span', { className: 'draw-list__number tabular' }, `#${d.number}`),
      h('span', { className: 'draw-list__name' }, d.skill.name),
      kindChip(d.skill, { className: 'kind--sm' }))) : h('li', null, placeholder(tl('ui.noDraws'))));
  }

  return {
    update(state) { lastState = state; render(state); },
    effect(e) {
      if (e.type === 'draw') {
        if (e.live) {
          animateOnce(els.card, 'm-draw-arrival', { durationMs: MOTION.interactions.drawArrival.ms });
          grid.celebrateMatches(e.newPositions);
          ctx.audioMotion.cueDraw(e.draw, e.newPositions.length > 0, e.unlocksBingo);
          if (e.unlocksBingo) animateOnce(els.banner, 'm-fade', { durationMs: MOTION.interactions.fade.ms });
        }
      }
      if (e.type === 'lock' && e.live) grid.celebrateLock();
      if (e.type === 'bingo' && e.live && lastState && lastState.round) ctx.audioMotion.cueBingo(lastState.round.roundId);
    },
    unmount() { mount(root, null); },
  };
}
