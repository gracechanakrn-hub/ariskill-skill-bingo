// Mission Control layout (A2): round list + create-round form + current round panel host.
import { h } from '/packages/ui/dom.js';
import { t } from '../copy.js';
import { statePill, localDateTimeToIso, isoToLocalDateTime, clampResultWindow, RESULT_WINDOW } from '../state.js';

export function renderRoundList(rounds, currentRoundId) {
  if (!rounds || !rounds.length) return h('p', { className: 'muted' }, t('adminLocal.noRounds'));
  return h('div', { className: 'table-scroll' }, h('table', { className: 'table round-table' },
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, t('adminLocal.number')), h('th', { scope: 'col' }, t('adminLocal.title')),
      h('th', { scope: 'col' }, t('adminLocal.state')), h('th', { scope: 'col' }, t('adminLocal.version')))),
    h('tbody', null, rounds.slice().sort((a, b) => b.number - a.number).map((r) => h('tr', { className: r.roundId === currentRoundId ? 'is-current' : null, 'aria-current': r.roundId === currentRoundId ? 'true' : undefined },
      h('td', { className: 'tabular' }, String(r.number)),
      h('td', null, r.title),
      h('td', null, h('span', { className: ['pill', statePill(r.state)] }, r.state)),
      h('td', { className: 'tabular' }, String(r.version)))))));
}

/**
 * createRoundForm({ onSubmit(values) -> Promise, defaultLockAtIso })
 * Values: { title, lockAt (ISO), resultWindowSeconds (10-15, default 12) }. Built once; not re-rendered on events.
 */
export function createRoundForm({ onSubmit, defaultLockAtIso }) {
  const refs = {};
  const form = h('form', { className: 'stack stack--tight create-round', 'aria-labelledby': 'create-round-title', novalidate: true },
    h('h3', { id: 'create-round-title', className: 'section-title' }, t('admin.createRound')),
    h('div', { className: 'field' },
      h('label', { className: 'field__label', for: 'cr-title' }, t('adminLocal.title')),
      h('input', { className: 'input', id: 'cr-title', name: 'title', type: 'text', required: true, maxlength: 80, autocomplete: 'off', ref: (el) => { refs.title = el; } })),
    h('div', { className: 'field' },
      h('label', { className: 'field__label', for: 'cr-lock' }, t('adminLocal.lockAt')),
      h('input', { className: 'input', id: 'cr-lock', name: 'lockAt', type: 'datetime-local', required: true, step: 60, value: defaultLockAtIso ? isoToLocalDateTime(defaultLockAtIso) : '', ref: (el) => { refs.lockAt = el; } })),
    h('div', { className: 'field' },
      h('label', { className: 'field__label', for: 'cr-window' }, t('adminLocal.resultWindow')),
      h('input', { className: 'input', id: 'cr-window', name: 'resultWindowSeconds', type: 'number', min: RESULT_WINDOW.min, max: RESULT_WINDOW.max, step: 1, value: String(RESULT_WINDOW.default), ref: (el) => { refs.rw = el; } })),
    h('p', { className: 'field__error', id: 'cr-error', hidden: true, ref: (el) => { refs.err = el; } }),
    h('div', { className: 'cluster' }, h('button', { className: 'btn btn--primary', type: 'submit', ref: (el) => { refs.submit = el; } }, t('adminLocal.create'))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = refs.title.value.trim();
    const lockAt = localDateTimeToIso(refs.lockAt.value);
    refs.err.hidden = true;
    if (!title || !lockAt) { refs.err.textContent = t('adminLocal.formRequired'); refs.err.hidden = false; (title ? refs.lockAt : refs.title).focus(); return; }
    refs.submit.disabled = true;
    try {
      const ok = await onSubmit({ title, lockAt, resultWindowSeconds: clampResultWindow(refs.rw.value) });
      if (ok) { refs.title.value = ''; }
    } finally { refs.submit.disabled = false; }
  });
  return form;
}

/** Layout skeleton: returns { root, listHost, panelHost, formHost } so main.js can re-render parts independently. */
export function missionControlLayout() {
  const listHost = h('div', { id: 'round-list', className: 'stack stack--tight' });
  const panelHost = h('div', { id: 'round-panel', className: 'stack', 'aria-live': 'off' });
  const formHost = h('div', { id: 'create-round', className: 'card card--flat' });
  const root = h('div', { className: 'mission-grid' },
    h('div', { className: 'mission-main stack' }, panelHost),
    h('aside', { className: 'mission-side stack', 'aria-label': t('adminLocal.rounds') },
      h('section', { className: 'card card--flat stack stack--tight', 'aria-labelledby': 'rounds-title' }, h('h3', { id: 'rounds-title', className: 'section-title' }, t('adminLocal.rounds')), listHost),
      formHost));
  return { root, listHost, panelHost, formHost };
}
