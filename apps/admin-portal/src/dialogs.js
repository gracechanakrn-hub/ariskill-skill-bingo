// Toasts and modal dialogs (confirmation, reason, round form). Focus-trapped, Escape closes, focus restored.
import { h, focusTrap, announce, setPending } from '/packages/ui/dom.js';
import { t } from './copy.js';

let toastRegion = null;
export function ensureToastRegion() {
  if (toastRegion && toastRegion.isConnected) return toastRegion;
  toastRegion = document.querySelector('.toast-region') || document.body.appendChild(h('div', { className: 'toast-region', 'aria-live': 'polite' }));
  return toastRegion;
}

/** toast(text, { kind: 'info'|'success'|'warning'|'danger', timeoutMs }) - also announced to the live region. */
export function toast(text, { kind = 'info', timeoutMs = 6000, announceText = true } = {}) {
  const region = ensureToastRegion();
  const icon = { info: 'i', success: '✓', warning: '!', danger: '×' }[kind] || 'i';
  let el;
  const close = () => { if (el && el.isConnected) el.remove(); };
  el = h('div', { className: ['toast', `toast--${kind}`, 'm-fade'], role: 'status' },
    h('span', { className: 'toast__icon', 'aria-hidden': 'true' }, icon),
    h('div', { className: 'toast__body' }, text),
    h('button', { className: 'toast__close', type: 'button', onClick: close, 'aria-label': t('adminLocal.closeToast') }, '×'));
  region.appendChild(el);
  if (announceText) announce(text, { politeness: kind === 'danger' ? 'assertive' : 'polite' });
  if (timeoutMs > 0) setTimeout(close, timeoutMs);
  return close;
}

function openModal({ title, body, actions, initialFocus = null, describedBy = null }) {
  return new Promise((resolve) => {
    let release = () => {};
    const backdrop = h('div', { className: 'modal-backdrop' });
    const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
    const modal = h('div', { className: 'modal stack', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': describedBy || undefined },
      h('h2', { className: 'modal__title', id: titleId }, title));
    const opener = document.activeElement;
    const openerKey = opener && opener !== document.body ? (opener.id ? `#${opener.id}` : opener.dataset?.command ? `[data-command="${opener.dataset.command}"]` : null) : null;
    const done = (value) => {
      release(); backdrop.remove();
      // The panel may have re-rendered while the dialog was open: restore focus to the equivalent control.
      if (openerKey && (!opener.isConnected || document.activeElement === document.body)) { const el = document.querySelector(openerKey); if (el && !el.disabled) el.focus({ preventScroll: true }); }
      resolve(value);
    };
    const bodyEl = typeof body === 'function' ? body(done) : body;
    if (bodyEl) modal.appendChild(bodyEl);
    const actionRow = h('div', { className: 'modal__actions cluster' }, actions(done));
    modal.appendChild(actionRow);
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(null); });
    document.body.appendChild(backdrop);
    release = focusTrap(modal, { onEscape: () => done(null), initialFocus });
  });
}

/** confirmDialog -> Promise<boolean> */
export function confirmDialog({ title, message, confirmLabel, cancelLabel = t('adminLocal.cancelDialog'), danger = false }) {
  const descId = `modal-desc-${Math.random().toString(36).slice(2, 8)}`;
  return openModal({
    title,
    describedBy: descId,
    body: h('p', { id: descId }, message),
    initialFocus: 'button[data-role="cancel"]',
    actions: (done) => [
      h('button', { className: 'btn btn--ghost', type: 'button', dataset: { role: 'cancel' }, onClick: () => done(false) }, cancelLabel),
      h('button', { className: ['btn', danger ? 'btn--danger' : 'btn--primary'], type: 'button', dataset: { role: 'confirm' }, onClick: () => done(true) }, confirmLabel),
    ],
  }).then((v) => v === true);
}

/** reasonDialog -> Promise<string|null> (required, trimmed). */
export function reasonDialog({ title, label, confirmLabel }) {
  const inputId = `reason-${Math.random().toString(36).slice(2, 8)}`;
  const errId = `${inputId}-err`;
  let input; let err;
  return openModal({
    title,
    body: h('div', { className: 'stack stack--tight' },
      h('p', null, t('adminLocal.cancelConfirm')),
      h('div', { className: 'field' },
        h('label', { className: 'field__label', for: inputId }, label),
        h('textarea', { className: 'textarea', id: inputId, rows: 3, required: true, placeholder: t('adminLocal.reasonPlaceholder'), 'aria-describedby': errId, ref: (el) => { input = el; } }),
        h('p', { className: 'field__error', id: errId, hidden: true, ref: (el) => { err = el; } }, t('adminLocal.reasonRequired')))),
    initialFocus: `#${inputId}`,
    actions: (done) => [
      h('button', { className: 'btn btn--ghost', type: 'button', onClick: () => done(null) }, t('adminLocal.cancelDialog')),
      h('button', { className: 'btn btn--danger', type: 'button', onClick: () => {
        const v = (input.value || '').trim();
        if (!v) { err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
        done(v);
      } }, confirmLabel),
    ],
  });
}

const isFuture = (iso, now) => !!iso && Date.parse(iso) > now;

/**
 * roundDialog({ title, submitLabel, values: { title, mode: 'at'|'in', lockAtLocal, startInMinutes }, choices, now })
 * The create / edit round modal (D-53): a name and when the game starts - at a time, or N minutes after Open for players.
 * Resolves { title, lockAt } | { title, startInMinutes } | null.
 */
export function roundDialog({ title, submitLabel, values, choices, now = Date.now(), toIso }) {
  const id = Math.random().toString(36).slice(2, 8);
  const refs = { chips: [] };
  let mode = values.mode === 'at' ? 'at' : 'in';
  let minutes = values.startInMinutes || choices[1] || choices[0];
  const sync = () => {
    refs.atRadio.checked = mode === 'at'; refs.inRadio.checked = mode === 'in';
    refs.time.disabled = mode !== 'at';
    refs.atRow.classList.toggle('is-active', mode === 'at'); refs.inRow.classList.toggle('is-active', mode === 'in');
    for (const c of refs.chips) { const on = mode === 'in' && Number(c.dataset.minutes) === minutes; c.setAttribute('aria-pressed', String(on)); c.classList.toggle('is-on', on); }
  };
  const chip = (n) => h('button', { className: 'seg', type: 'button', dataset: { minutes: n }, 'aria-pressed': 'false', ref: (el) => refs.chips.push(el), onClick: () => { mode = 'in'; minutes = n; sync(); } }, t('adminLocal.mc.minutes', { n }));
  return openModal({
    title,
    body: () => {
      const body = h('div', { className: 'stack round-dialog' },
        h('div', { className: 'field' },
          h('label', { className: 'field__label', for: `name-${id}` }, t('adminLocal.mc.name')),
          h('input', { className: 'input', id: `name-${id}`, type: 'text', required: true, maxlength: 80, autocomplete: 'off', value: values.title || '', ref: (el) => { refs.name = el; } })),
        h('fieldset', { className: 'start-choice stack stack--tight' },
          h('legend', { className: 'field__label' }, t('adminLocal.mc.start')),
          h('div', { className: 'start-option', ref: (el) => { refs.inRow = el; } },
            h('label', { className: 'start-option__head' },
              h('input', { type: 'radio', name: `mode-${id}`, value: 'in', ref: (el) => { refs.inRadio = el; }, onChange: () => { mode = 'in'; sync(); } }),
              h('span', null, t('adminLocal.mc.startIn'))),
            h('div', { className: 'seg-row', role: 'group', 'aria-label': t('adminLocal.mc.startIn') }, choices.map(chip)),
            h('p', { className: 'muted start-option__hint' }, t('adminLocal.mc.startInHint'))),
          h('div', { className: 'start-option', ref: (el) => { refs.atRow = el; } },
            h('label', { className: 'start-option__head' },
              h('input', { type: 'radio', name: `mode-${id}`, value: 'at', ref: (el) => { refs.atRadio = el; }, onChange: () => { mode = 'at'; sync(); refs.time.focus(); } }),
              h('span', null, t('adminLocal.mc.startAt'))),
            h('input', { className: 'input', id: `time-${id}`, type: 'datetime-local', step: 60, value: values.lockAtLocal || '', 'aria-label': t('adminLocal.mc.startAt'), ref: (el) => { refs.time = el; } }))),
        h('p', { className: 'field__error', role: 'alert', hidden: true, ref: (el) => { refs.err = el; } }));
      sync();
      return body;
    },
    initialFocus: `#name-${id}`,
    actions: (done) => [
      h('button', { className: 'btn btn--ghost', type: 'button', onClick: () => done(null) }, t('adminLocal.cancelDialog')),
      h('button', { className: 'btn btn--primary', type: 'button', dataset: { role: 'submit' }, onClick: () => {
        const name = refs.name.value.trim();
        const fail = (key, el) => { refs.err.textContent = t(key); refs.err.hidden = false; el.focus(); };
        if (!name) return fail('adminLocal.mc.nameRequired', refs.name);
        if (mode === 'in') return done({ title: name, startInMinutes: minutes });
        const lockAt = toIso(refs.time.value);
        if (!isFuture(lockAt, now)) return fail('adminLocal.mc.timeRequired', refs.time);
        return done({ title: name, lockAt });
      } }, submitLabel),
    ],
  });
}

/** pickTimeDialog({ valueLocal, now, toIso }) -> Promise<ISO|null>: a new start time for an open round. */
export function pickTimeDialog({ valueLocal, now = Date.now(), toIso }) {
  const id = Math.random().toString(36).slice(2, 8);
  const refs = {};
  return openModal({
    title: t('adminLocal.mc.pickTimeTitle'),
    body: h('div', { className: 'stack stack--tight' },
      h('div', { className: 'field' },
        h('label', { className: 'field__label', for: `pick-${id}` }, t('adminLocal.mc.newTime')),
        h('input', { className: 'input', id: `pick-${id}`, type: 'datetime-local', step: 60, value: valueLocal || '', ref: (el) => { refs.time = el; } })),
      h('p', { className: 'field__error', role: 'alert', hidden: true, ref: (el) => { refs.err = el; } }, t('adminLocal.mc.timeRequired'))),
    initialFocus: `#pick-${id}`,
    actions: (done) => [
      h('button', { className: 'btn btn--ghost', type: 'button', onClick: () => done(null) }, t('adminLocal.cancelDialog')),
      h('button', { className: 'btn btn--primary', type: 'button', onClick: () => {
        const iso = toIso(refs.time.value);
        if (!isFuture(iso, now)) { refs.err.hidden = false; refs.time.focus(); return; }
        done(iso);
      } }, t('adminLocal.mc.save')),
    ],
  });
}

/** typeToConfirmDialog({ title, message, word, confirmLabel }) -> Promise<boolean>: the confirm button works only once `word` is typed. */
export function typeToConfirmDialog({ title, message, word, confirmLabel }) {
  const id = Math.random().toString(36).slice(2, 8);
  const refs = {};
  return openModal({
    title,
    describedBy: `type-desc-${id}`,
    body: h('div', { className: 'stack stack--tight' },
      h('p', { id: `type-desc-${id}` }, message),
      h('div', { className: 'field' },
        h('label', { className: 'field__label', for: `type-${id}` }, t('adminLocal.mc.clearType')),
        h('input', { className: 'input mono', id: `type-${id}`, type: 'text', autocomplete: 'off', spellcheck: false, ref: (el) => { refs.input = el; } })),
      h('p', { className: 'field__error', role: 'alert', hidden: true, ref: (el) => { refs.err = el; } }, t('adminLocal.mc.clearMismatch'))),
    initialFocus: `#type-${id}`,
    actions: (done) => [
      h('button', { className: 'btn btn--ghost', type: 'button', onClick: () => done(false) }, t('adminLocal.cancelDialog')),
      h('button', { className: 'btn btn--danger', type: 'button', onClick: () => {
        if (refs.input.value.trim() !== word) { refs.err.hidden = false; refs.input.focus(); return; }
        done(true);
      } }, confirmLabel),
    ],
  }).then((v) => v === true);
}

export { setPending };
