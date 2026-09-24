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

function kindIcon(kind) {
  const k = String(kind || '').toLowerCase();
  const cls = `kind-icon kind-icon--${k}`;
  if (k === 'core') return h('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, h('path', { d: 'M12 2 22 12 12 22 2 12Z', fill: 'currentColor' }));
  if (k === 'critical') return h('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, h('circle', { cx: 12, cy: 12, r: 10, fill: 'currentColor' }));
  return h('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, h('circle', { cx: 12, cy: 12, r: 9, fill: 'none', stroke: 'currentColor', 'stroke-width': 3 }));
}

function kindChip(kind) {
  const k = String(kind || '').toLowerCase();
  return h('span', { className: `chip chip--${k} panel__kind` }, kindIcon(k), h('span', { className: 'chip__label' }, String(kind || '')));
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
    if (vm.scheduled) {
      parts.push(h('h1', { className: 'panel__headline', text: vm.roundTitle || label('roundLabel', { number: vm.roundNumber }) }));
      if (vm.locked) parts.push(h('p', { className: 'panel__body panel__muted', text: vm.lockedText }));
      else if (vm.lockAt) {
        parts.push(h('p', { className: 'countdown__label panel__countdown-label', text: label('locksIn') }));
        countdownTarget = vm.lockAt;
        countdownEl = h('p', { className: `countdown tabular panel__countdown${vm.countdownUrgent ? ' is-urgent' : ''}`, text: formatCountdown(vm.lockAt, nowMs), 'aria-live': 'off' });
        parts.push(countdownEl);
      }
    } else {
      parts.push(h('h1', { className: 'panel__headline panel__headline--sm', text: vm.notScheduled }));
    }
    if (vm.notice) parts.push(h('p', { className: `panel__notice panel__notice--${vm.notice.kind}`, role: 'status', text: vm.notice.text }));
    if (vm.joinUrl) {
      const qrHost = h('div', { className: 'qr panel__qr' });
      renderQr(qrHost, vm.joinUrl, { size: QR_SIZE, margin: 3, ariaLabel: `${vm.scan}: ${vm.joinUrl}` });
      parts.push(h('div', { className: 'panel__join' }, qrHost, h('p', { className: 'panel__scan', text: vm.scan }), h('p', { className: 'panel__url', text: displayUrl(vm.joinUrl) })));
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
    const card = h('div', { className: `draw-card panel__draw draw-card--${String(vm.kind || '').toLowerCase()}` },
      h('p', { className: 'panel__draw-number', text: vm.drawLabel }),
      vm.kind ? kindChip(vm.kind) : null,
      h('h1', { className: 'panel__skill', text: vm.skillName || '', ref: (el) => { els.skill = el; } }),
    );
    const live = h('p', { className: `panel__pacing${vm.live ? ' is-live' : ''}` }, vm.live ? h('span', { className: 'pill pill--live' }, vm.pacing) : vm.pacing);
    const recent = h('ul', { className: 'draw-list panel__recent', 'aria-label': t('public.playing.draw', { number: '' }).trim() },
      ...vm.recentDraws.map(d => h('li', { className: `panel__recent-item panel__recent-item--${String(d.kind || '').toLowerCase()}` }, kindIcon(d.kind), h('span', { className: 'panel__recent-num tabular', text: String(d.number) }), h('span', { className: 'panel__recent-name', text: d.skillName || '' }))));
    return h('section', { className: 'panel__state panel__state--playing', 'aria-label': vm.roundLabel },
      card, h('p', { className: 'panel__matched tabular', text: vm.matched }), live, recent);
  }

  function winner(vm) {
    const labels = vm.labels.length ? vm.labels : [];
    const list = h('ul', { className: `panel__winners panel__winners--${labels.length > 4 ? 'many' : 'few'}`, ref: (el) => { els.winners = el; } }, ...labels.map(l => h('li', { className: 'panel__winner', text: l })));
    return h('section', { className: 'panel__state panel__state--winner', 'aria-label': vm.title, ref: (el) => { els.burst = el; } },
      h('h1', { className: 'panel__bingo', text: vm.title }),
      h('p', { className: 'panel__round', text: vm.roundLabel }),
      list,
      labels.length > 1 ? h('p', { className: 'panel__muted panel__body', text: label('coWinners', { count: labels.length }) }) : null);
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
      if (els.skill) fitText(els.skill, { maxPx: 96, minPx: 48, maxLines: 2 });
      if (els.winners) for (const li of els.winners.children) fitText(li, { maxPx: labels(vm) > 4 ? 48 : 64, minPx: 40, maxLines: 1 });
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
