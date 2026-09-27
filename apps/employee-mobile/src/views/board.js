// apps/employee-mobile/src/views/board.js - E4 Your board (shuffled board, countdown, Edit / I'm ready, D-35), E4b No round,
// E5 Locked / waiting for start, E5b Deferred (incomplete / late / cancelled) with next-round info.
// The countdown is display only (formatCountdown over the synced server clock); lock and start are server events.
import { h, mount } from '/packages/ui/dom.js';
import { formatCountdown } from '/packages/ui/clock-sync.js';
import { formatTime } from '/packages/ui/format.js';
import { animateOnce, MOTION } from '/packages/ui/motion.js';
import { t } from '/packages/contracts/index.js';
import { tl, exceptionCopy, notice, button, roundLine } from './common.js';
import { createGrid } from './grid.js';
import { editableRound, deferredCopyKey } from '../state.js';
import { doodad } from '../doodads.js';
import { doodadPlan } from '../backdrop-params.js';

export function mountBoard(root, ctx, screen) {
  const grid = createGrid();
  let els = {};
  let timer = null;
  let lastState = null;

  function countdownTarget(state) {
    const r = editableRound(state) || state.round;
    return r && r.lockAt ? r : null;
  }

  function tick() {
    if (!lastState || !els.countdown) return;
    const r = screen === 'board' ? countdownTarget(lastState) : null;
    if (!r) { els.countdownBlock.hidden = true; return; }
    els.countdownBlock.hidden = false;
    const label = t('board.startsIn');
    if (els.countdownLabel.textContent !== label) els.countdownLabel.textContent = label;
    if (!ctx.clockSynced()) { els.countdown.textContent = exceptionCopy('E7'); els.countdown.classList.add('countdown--syncing'); return; }
    els.countdown.classList.remove('countdown--syncing');
    const text = formatCountdown(r.lockAt, ctx.clockNow());
    if (els.countdown.textContent !== text) els.countdown.textContent = text;
    els.countdown.classList.toggle('is-zero', text === '00:00');
    els.countdown.classList.toggle('is-urgent', text !== '00:00' && text < '01:00');
  }

  function renderShell(state) {
    els = {};
    const s = screen;
    els.title = h('h1', { className: 'screen-title' });
    els.notices = h('div', { className: 'stack stack--tight' });
    els.round = h('div', { className: 'round-block' });
    // Waiting screens park a ringed planet in a reserved strip (never over text / controls; hidden below 360 px).
    els.sky = h('div', { className: 'waiting-sky', 'aria-hidden': 'true' }, ...doodadPlan(s, window.innerWidth).map((d) => doodad(d.kind, { size: d.size })));
    els.countdown = h('p', { className: 'countdown', 'aria-live': 'off' });
    // D-42: "The game will start in 12:34 mins" (the countdown runs to the round's lock time).
    els.countdownLabel = h('span', { className: 'countdown__label' });
    els.countdownLeft = h('span', { className: 'countdown__left' }, t('board.timeLeft'));
    els.countdownBlock = h('div', { className: 'countdown-block', hidden: true }, els.countdownLabel, els.countdown, els.countdownLeft);
    els.hint = h('p', { className: 'board-hint', 'aria-live': 'polite' });
    els.lockLabel = h('p', { className: 'lock-label m-lock-label', hidden: true }, `\u{1F512}︎ ${t('board.locked')}`);
    els.shuffled = h('p', { className: 'shuffled-badge', role: 'status', hidden: true }, t('board.shuffled'));
    els.actions = h('div', { className: s === 'board' ? 'board-actions' : 'cluster' });
    const gridWrap = h('div', { className: 'board-wrap' }, grid.el, els.shuffled, els.lockLabel, grid.legend);
    if (s === 'board') {
      // D-35 layout: board first, then the countdown card and the two actions (mockup docs/ux/mockups/mobile-v2-picker.html).
      mount(root, h('div', { className: 'stack' },
        els.title, h('div', { className: 'round-row' }, els.round, els.sky), gridWrap, els.notices,
        h('div', { className: 'board-status board-status--card' }, els.countdownBlock, els.hint), els.actions));
      return;
    }
    mount(root, h('div', { className: 'stack' },
      els.title, h('div', { className: 'round-row' }, els.round, els.sky), els.notices,
      s === 'deferred' ? null : h('div', { className: 'cluster cluster--between board-status' }, els.countdownBlock, els.actions),
      s === 'deferred' ? null : gridWrap,
      s === 'deferred' ? els.actions : null));
  }

  function render(state) {
    if (!els.title) renderShell(state);
    const r = state.round;
    const notices = [];
    const actions = [];
    if (screen === 'board') {
      const editable = editableRound(state);
      els.title.textContent = t('board.title');
      if (editable) {
        els.hint.textContent = state.ui.readyAck ? t('board.readyDone') : t('board.canEdit');
        actions.push(button(t('board.edit'), { className: 'btn--ghost', onClick: ctx.actions.startEditing, 'aria-describedby': 'edit-warning' }));
        actions.push(h('span', { id: 'edit-warning', className: 'visually-hidden' }, t('board.editWarning')));
        actions.push(button(`${t('board.ready')} ✓`, { variant: 'primary', className: `board-ready${state.ui.readyAck ? ' is-done' : ''}`, onClick: ctx.actions.readyAck, disabled: state.ui.readyAck, 'aria-pressed': state.ui.readyAck ? 'true' : 'false' }));
      } else {
        notices.push(notice(t('board.noRound'), { tone: 'info' }));
      }
      mount(els.round, roundLine(editable || r)); // the deadline lives in the countdown card (D-40)
      grid.update(state.board, { locked: false });
      els.lockLabel.hidden = true;
    } else if (screen === 'locked') {
      els.title.textContent = t('board.locked');
      notices.push(h('p', { className: 'lead', role: 'status' }, t('play.waitingStart')));
      mount(els.round, roundLine(r));
      grid.update(state.board, { locked: true });
      els.lockLabel.hidden = false;
      els.countdownBlock.hidden = true;
    } else if (screen === 'deferred') {
      const reason = (state.board && state.board.deferredReason) || (r && r.state === 'CANCELLED' ? 'cancelled' : 'incomplete');
      const key = deferredCopyKey(reason);
      els.title.textContent = t('board.locked');
      notices.push(notice(key === 'board.deferred' ? t('board.deferred') : exceptionCopy(key), { tone: 'warning' }));
      if (r && r.state === 'CANCELLED' && r.cancellationReason) notices.push(h('p', { className: 'muted' }, r.cancellationReason));
      mount(els.round, roundLine(r));
      const next = state.nextRound;
      if (next) notices.push(h('div', { className: 'card card--flat stack stack--tight' }, h('h2', { className: 'section__title' }, tl('ui.nextRound')), roundLine(next, next.lockAt ? `${tl('ui.locksAt')} ${formatTime(next.lockAt)}` : null)));
      else notices.push(h('p', { className: 'muted' }, t('board.noRound')));
    }
    mount(els.notices, notices);
    mount(els.actions, actions);
    tick();
  }

  /** One-shot "Shuffled!" badge after the server randomized the board (live only). */
  function showShuffled() {
    if (!els.shuffled) return;
    els.shuffled.hidden = false;
    animateOnce(els.shuffled, 'm-add', { durationMs: MOTION.interactions.addSkill.ms });
    setTimeout(() => { if (els.shuffled) els.shuffled.hidden = true; }, 2600);
  }

  return {
    update(state) {
      lastState = state;
      render(state);
      if (!timer && screen === 'board') timer = setInterval(tick, 250);
      // Arriving from "Review board": play the shuffle moment once (cleared after this render, never inside it).
      if (screen === 'board' && state.ui.justShuffled && state.board && state.board.state === 'READY') {
        queueMicrotask(ctx.actions.consumeShuffled);
        grid.celebrateComplete();
        showShuffled();
      }
    },
    effect(e) {
      if (e.type === 'board.ready' && e.live) { grid.celebrateComplete(); ctx.audioMotion.cueBoardReady(); showShuffled(); }
      if (e.type === 'lock') { grid.update(lastState.board, { locked: true }); els.lockLabel.hidden = false; if (e.live) grid.celebrateLock(); }
    },
    unmount() { if (timer) clearInterval(timer); mount(root, null); },
  };
}
