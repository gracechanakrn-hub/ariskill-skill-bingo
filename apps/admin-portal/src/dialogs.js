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

/** roundFormDialog({ title, values:{title,lockAtLocal,resultWindowSeconds}, submitLabel }) -> Promise<values|null> */
export function roundFormDialog({ title, values, submitLabel, lockAtOnly = false }) {
  const id = Math.random().toString(36).slice(2, 8);
  const refs = {};
  return openModal({
    title,
    body: h('div', { className: 'stack stack--tight' },
      !lockAtOnly && h('div', { className: 'field' },
        h('label', { className: 'field__label', for: `title-${id}` }, t('adminLocal.title')),
        h('input', { className: 'input', id: `title-${id}`, type: 'text', required: true, maxlength: 80, value: values.title || '', ref: (el) => { refs.title = el; } })),
      h('div', { className: 'field' },
        h('label', { className: 'field__label', for: `lock-${id}` }, t('adminLocal.lockAt')),
        h('input', { className: 'input', id: `lock-${id}`, type: 'datetime-local', required: true, step: 60, value: values.lockAtLocal || '', ref: (el) => { refs.lockAt = el; } })),
      !lockAtOnly && h('div', { className: 'field' },
        h('label', { className: 'field__label', for: `rw-${id}` }, t('adminLocal.resultWindow')),
        h('input', { className: 'input', id: `rw-${id}`, type: 'number', min: 10, max: 15, step: 1, value: String(values.resultWindowSeconds ?? 12), ref: (el) => { refs.rw = el; } })),
      h('p', { className: 'field__error', hidden: true, ref: (el) => { refs.err = el; } })),
    initialFocus: lockAtOnly ? `#lock-${id}` : `#title-${id}`,
    actions: (done) => [
      h('button', { className: 'btn btn--ghost', type: 'button', onClick: () => done(null) }, t('adminLocal.cancelDialog')),
      h('button', { className: 'btn btn--primary', type: 'button', onClick: () => {
        const out = { lockAtLocal: refs.lockAt.value };
        if (!lockAtOnly) { out.title = refs.title.value.trim(); out.resultWindowSeconds = refs.rw.value; }
        if ((!lockAtOnly && !out.title) || !out.lockAtLocal) { refs.err.hidden = false; refs.err.textContent = t('adminLocal.formRequired'); (out.title === '' ? refs.title : refs.lockAt).focus(); return; }
        done(out);
      } }, submitLabel),
    ],
  });
}

export { setPending };
