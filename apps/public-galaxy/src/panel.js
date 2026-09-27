// Information panel (right 35 %): renders the view-model from state.js with dom.h (never innerHTML with
// server strings; the QR is rendered by renderQr from the UI kit). Venue type scale comes from .theme-venue.
import { h, mount } from '../../../packages/ui/dom.js';
import { renderQr } from '../../../packages/ui/qr.js';
import { animateOnce, MOTION } from '../../../packages/ui/motion.js';
import { formatCountdown } from '../../../packages/ui/clock-sync.js';
import { t } from '../../../packages/contracts/index.js';
import { label } from './copy.js';

const QR_SIZE = 420;

/** Human-readable join URL for the panel: host + path without the one-time token (the QR carries the token). */
export function displayUrl(url) {
  try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return String(url).replace(/^https?:\/\//, '').split('?')[0]; }
}

/** Shrinks the font of `el` until its text fits its box (long skill names, many co-winners). */
export function fitText(el, { maxPx, minPx, maxLines = 2 } = {}) {
  if (!el || !el.isConnected) return;
  let size = maxPx;
  el.style.fontSize = size + 'px';
  const fits = () => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= size * 1.08 * maxLines + 2;
  let guard = 40;
  while (!fits() && size > minPx && guard-- > 0) { size = Math.max(minPx, Math.round(size * 0.92)); el.style.fontSize = size + 'px'; }
}

export function createPanel(root) {
  let lastKey = null;
  let countdownEl = null, countdownTarget = null;
  let els = {};

  function header(vm, eyebrow) {
    return h('header', { className: 'panel__header' },
      h('p', { className: 'panel__eyebrow panel__event', text: eyebrow || vm.eventName }),
      h('span', { className: `pill panel__conn pill--${vm.connection === 'open' ? 'live' : vm.connection === 'closed' ? 'closed' : 'reconnecting'}`, 'aria-live': 'off', hidden: vm.connection !== 'open' }, label('live')),
    );
  }

  function waiting(vm, nowMs) {
    const parts = [];
    const info = [];                                   // the round and its timer, one group (D-36)
    if (vm.scheduled) {
      info.push(h('h1', { className: 'panel__headline', text: vm.roundTitle || label('roundLabel', { number: vm.roundNumber }) }));
      if (vm.locked) info.push(h('p', { className: 'panel__body panel__muted', text: vm.lockedText }));
      else if (vm.lockAt) {
        info.push(h('p', { className: 'countdown__label panel__countdown-label', text: label('locksIn') }));
        countdownTarget = vm.lockAt;
        countdownEl = h('p', { className: `countdown tabular panel__countdown${vm.countdownUrgent ? ' is-urgent' : ''}`, text: formatCountdown(vm.lockAt, nowMs), 'aria-live': 'off' });
        info.push(countdownEl);
      }
    } else {
      info.push(h('h1', { className: 'panel__headline panel__headline--sm', text: vm.notScheduled }));
    }
    parts.push(h('div', { className: 'panel__info' }, ...info));
    if (vm.notice) parts.push(h('p', { className: `panel__notice panel__notice--${vm.notice.kind}`, role: 'status', text: vm.notice.text }));
    if (vm.joinUrl) {
      const qrHost = h('div', { className: 'qr panel__qr' });
      renderQr(qrHost, vm.joinUrl, { size: QR_SIZE, margin: 3, ariaLabel: `${vm.scan}: ${vm.joinUrl}` });
      parts.push(h('div', { className: 'panel__join' }, qrHost, h('p', { className: 'panel__scan', text: vm.scan })));
    }
    if (vm.previous.length) {
      parts.push(h('section', { className: 'panel__previous', 'aria-label': vm.previousTitle },
        h('p', { className: 'panel__eyebrow', text: vm.previousTitle }),
        h('ul', { className: 'panel__list' }, ...vm.previous.map(p => h('li', {}, h('span', { className: 'panel__muted', text: p.roundLabel + '  ' }), h('span', { text: p.labels.join(' · ') })))),
      ));
    }
    return h('section', { className: 'panel__state panel__state--waiting', 'aria-label': vm.title }, ...parts);
  }

  function playing(vm) {
    // D-36: the screen never says a skill's kind (core / critical / optional), and shows the
    // previous five draws below the current one
    const card = h('div', { className: 'draw-card panel__draw' },
      h('p', { className: 'panel__draw-number', text: vm.drawLabel }),
      h('h1', { className: 'panel__skill', text: vm.skillName || '', ref: (el) => { els.skill = el; } }),
    );
    const recent = vm.recentDraws.length ? h('section', { className: 'panel__recent-card', 'aria-label': label('previousDraws') },
      h('p', { className: 'panel__eyebrow panel__recent-title', text: label('previousDraws') }),
      h('ul', { className: 'draw-list panel__recent' },
        ...vm.recentDraws.map(d => h('li', { className: 'panel__recent-item' }, h('span', { className: 'panel__recent-num tabular', text: String(d.number) }), h('span', { className: 'panel__recent-name', text: d.skillName || '' }))))) : null;
    return h('section', { className: 'panel__state panel__state--playing', 'aria-label': vm.roundLabel },
      h('div', { className: 'panel__current' }, card, h('p', { className: 'panel__matched tabular', text: vm.matched })), recent);
  }

  function winner(vm) {
    const labels = vm.labels.length ? vm.labels : [];
    const list = h('ul', { className: `panel__winners panel__winners--${labels.length > 4 ? 'many' : 'few'}`, ref: (el) => { els.winners = el; } }, ...labels.map(l => h('li', { className: 'panel__winner', text: l })));
    return h('section', { className: 'panel__state panel__state--winner', 'aria-label': vm.title, ref: (el) => { els.burst = el; } },
      h('div', { className: 'panel__celebration' },
        h('h1', { className: 'panel__bingo-badge' }, h('img', { src: '/public/art/bingo-badge.webp', alt: vm.title, width: 1137, height: 292 })),
        list,
        labels.length > 1 ? h('p', { className: 'panel__muted panel__body panel__cowinners', text: label('coWinners', { count: labels.length }) }) : null));
  }

  /** Re-renders when the structural view-model changes; returns the state section element. */
  function render(vm, nowMs, { celebrateDraw = false, celebrateWinner = false } = {}) {
    const key = JSON.stringify({ ...vm, countdown: null, countdownUrgent: null, stale: null, connection: null });
    const changed = key !== lastKey;
    if (changed) {
      lastKey = key; els = {}; countdownEl = null; countdownTarget = null;
      const body = vm.mode === 'Playing' ? playing(vm) : vm.mode === 'Winner' ? winner(vm) : waiting(vm, nowMs);
      const eyebrow = vm.mode === 'Playing' ? vm.roundLabel : vm.mode === 'Winner' ? vm.roundLabel : vm.title;
      mount(root, [header(vm, eyebrow), body]);
      if (els.skill) fitText(els.skill, { maxPx: 64, minPx: 36, maxLines: 2 });
      if (els.winners) for (const li of els.winners.children) fitText(li, { maxPx: labels(vm) > 4 ? 36 : 48, minPx: 28, maxLines: 1 });
      if (!celebrateDraw && !celebrateWinner) animateOnce(body, 'm-fade', { durationMs: MOTION.durations.base });
    }
    const pill = root.querySelector('.panel__conn');
    if (pill) { pill.className = `pill panel__conn pill--${vm.connection === 'open' ? 'live' : vm.connection === 'closed' ? 'closed' : 'reconnecting'}`; pill.hidden = vm.connection !== 'open'; }
    if (celebrateDraw) { const card = root.querySelector('.panel__draw'); if (card) animateOnce(card, 'm-draw-arrival', { durationMs: MOTION.durations.slow }); }
    if (celebrateWinner && els.burst) animateOnce(els.burst, 'm-winner-burst', { durationMs: MOTION.durations.celebrate });
    return changed;
  }
  function labels(vm) { return vm.labels ? vm.labels.length : 0; }

  /** Cheap per-second countdown update without re-rendering the panel. */
  function tick(nowMs) {
    if (!countdownEl || !countdownTarget) return;
    const text = formatCountdown(countdownTarget, nowMs);
    if (countdownEl.textContent !== text) countdownEl.textContent = text;
    const urgent = Date.parse(countdownTarget) - nowMs < 60_000;
    countdownEl.classList.toggle('is-urgent', urgent);
    countdownEl.classList.toggle('is-zero', text === '00:00');
  }

  return { render, tick };
}
