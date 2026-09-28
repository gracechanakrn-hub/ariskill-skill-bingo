// Mission Control layout (A2, D-53): current round panel + a side list of every round with its plain status, and the
// "+ Create round" button (the form itself is a modal, see dialogs.roundDialog). The Test mode switch (D-56) reveals "Clear all data".
import { h } from '/packages/ui/dom.js';
import { t } from '../copy.js';
import { statusOf } from '../state.js';

const shortDate = (iso) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
};

/** renderRoundList(rounds, currentRoundId, { onDelete(round), pending }) - newest first, one Delete per row. */
export function renderRoundList(rounds, currentRoundId, { onDelete, pending = false } = {}) {
  if (!rounds || !rounds.length) return h('p', { className: 'muted' }, t('adminLocal.mc.noRound'));
  return h('ul', { className: 'round-list' },
    rounds.slice().sort((a, b) => b.number - a.number).map((r) => {
      const st = statusOf(r.state);
      const current = r.roundId === currentRoundId;
      return h('li', { className: ['round-row', current ? 'is-current' : null], 'aria-current': current ? 'true' : undefined, dataset: { roundId: r.roundId } },
        h('div', { className: 'round-row__main' },
          h('span', { className: 'round-row__title' }, r.title),
          h('span', { className: 'round-row__meta muted' }, `#${r.number}${r.createdAt ? ` · ${shortDate(r.createdAt)}` : ''}`)),
        h('span', { className: ['pill', 'pill--sm', st.pill] }, st.label),
        h('button', { className: 'btn btn--ghost btn--sm round-row__delete', type: 'button', disabled: pending, 'aria-label': `${t('adminLocal.mc.delete')}: ${r.title}`, onClick: () => onDelete && onDelete(r) }, t('adminLocal.mc.deleteShort')));
    }));
}

/** Layout skeleton: { root, listHost, panelHost, createButton, clearHost, testingBanner, setTestModeView } so main.js can re-render parts independently. */
export function missionControlLayout({ onCreate, onClearAll, onToggleTestMode }) {
  const listHost = h('div', { id: 'round-list', className: 'stack stack--tight' });
  const panelHost = h('div', { id: 'round-panel', className: 'stack', 'aria-live': 'off' });
  const createButton = h('button', { className: 'btn btn--primary create-round-btn', id: 'create-round', type: 'button', onClick: onCreate }, t('adminLocal.mc.createRound'));
  const refs = {};
  const clearHost = h('section', { className: 'test-mode card card--flat stack stack--tight', 'aria-labelledby': 'test-mode-label' },
    h('div', { className: 'cluster cluster--between' },
      h('span', { className: 'section-title', id: 'test-mode-label' }, t('adminLocal.mc.testMode')),
      h('button', { className: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-labelledby': 'test-mode-label', 'aria-describedby': 'test-mode-note', onClick: () => onToggleTestMode(refs.switchEl.getAttribute('aria-checked') !== 'true'), ref: (el) => { refs.switchEl = el; } },
        h('span', { className: 'switch__knob', 'aria-hidden': 'true' }))),
    h('p', { className: 'muted test-mode__note', id: 'test-mode-note', ref: (el) => { refs.note = el; } }, t('adminLocal.mc.testModeOff')),
    h('button', { className: 'btn btn--ghost btn--sm clear-all__btn', type: 'button', hidden: true, onClick: onClearAll, ref: (el) => { refs.clearBtn = el; } }, t('adminLocal.mc.clearAll')));
  /** Reflects the server's test mode state (D-56). */
  const setTestModeView = ({ on, locked, pending = false }) => {
    refs.switchEl.setAttribute('aria-checked', String(!!on));
    refs.switchEl.disabled = locked || pending;
    refs.note.textContent = t(locked ? 'adminLocal.mc.testModeLocked' : on ? 'adminLocal.mc.testModeOn' : 'adminLocal.mc.testModeOff');
    refs.clearBtn.hidden = !on || locked;
    clearHost.classList.toggle('is-on', !!on && !locked);
  };
  const testingBanner = h('p', { className: 'alert alert--warning testing-banner', role: 'note', hidden: true }, t('adminLocal.mc.testingMode'));
  const grid = h('div', { className: 'mission-grid' },
    h('div', { className: 'mission-main stack' }, panelHost),
    h('aside', { className: 'mission-side stack', 'aria-label': t('adminLocal.rounds') },
      h('section', { className: 'card card--flat stack stack--tight', 'aria-labelledby': 'rounds-title' },
        h('div', { className: 'cluster cluster--between' }, h('h3', { id: 'rounds-title', className: 'section-title' }, t('adminLocal.rounds')), createButton),
        listHost),
      clearHost));
  const root = h('div', { className: 'stack' }, testingBanner, grid);
  return { root, listHost, panelHost, createButton, clearHost, testingBanner, setTestModeView };
}
