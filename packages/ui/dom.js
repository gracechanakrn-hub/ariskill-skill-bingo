// @ariskill/ui dom.js - tiny DOM helpers (browser only; every function guards `document`).
//  h(tag, attrs, ...children)   element builder: className, dataset, aria-*, on* listeners, boolean attrs, style objects
//  mount(root, node)            replace root's children with node(s)
//  announce(text, { politeness }) single ARIA live region (created lazily, never steals focus)
//  focusTrap(modalEl)           keyboard trap for role=dialog; returns release()
//  escapeHtml(text)

const hasDocument = () => typeof document !== 'undefined' && document && typeof document.createElement === 'function';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'g', 'line', 'polyline', 'polygon', 'text', 'defs', 'use', 'title', 'desc', 'ellipse', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask']);

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Append child values: strings/numbers -> text nodes; arrays flattened; null/false/undefined skipped. */
export function append(parent, ...children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) { append(parent, ...child); continue; }
    if (typeof child === 'string' || typeof child === 'number') { parent.appendChild(document.createTextNode(String(child))); continue; }
    if (child && typeof child.nodeType === 'number') { parent.appendChild(child); continue; }
    parent.appendChild(document.createTextNode(String(child)));
  }
  return parent;
}

export function h(tag, attrs = null, ...children) {
  if (!hasDocument()) throw new Error('dom.h requires a document');
  if (attrs && (typeof attrs !== 'object' || Array.isArray(attrs) || typeof attrs.nodeType === 'number')) { children.unshift(attrs); attrs = null; }
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (attrs) setAttrs(el, attrs);
  return append(el, ...children);
}

export function setAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    if (key === 'className' || key === 'class') { if (value) el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value)); continue; }
    if (key === 'dataset' && value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) if (v !== undefined && v !== null) el.dataset[k] = String(v); continue; }
    if (key === 'style' && value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) { if (k.startsWith('--')) el.style.setProperty(k, v); else el.style[k] = v; } continue; }
    if (key === 'ref' && typeof value === 'function') { value(el); continue; }
    if (key === 'html') { el.innerHTML = String(value); continue; } // caller is responsible for escaping
    if (key === 'text') { el.textContent = String(value); continue; }
    if (key.startsWith('on') && typeof value === 'function') { el.addEventListener(key.slice(2).toLowerCase(), value); continue; }
    if (key === 'for') { el.setAttribute('for', value); continue; }
    if (value === false || value === null) { el.removeAttribute(key); continue; }
    if (value === true) { el.setAttribute(key, key === 'disabled' || key === 'hidden' || key === 'required' || key === 'checked' || key === 'selected' || key === 'open' || key === 'inert' ? '' : 'true'); continue; }
    if (key === 'value' && 'value' in el) { el.value = value; continue; }
    el.setAttribute(key, String(value));
  }
  return el;
}

/** mount(root, node|nodes) - replaces root children; accepts a selector string for root. */
export function mount(root, node) {
  const target = typeof root === 'string' ? document.querySelector(root) : root;
  if (!target) throw new Error('dom.mount: root not found');
  while (target.firstChild) target.removeChild(target.firstChild);
  return append(target, node);
}

let liveRegions = null;
function liveRegion(politeness) {
  if (!hasDocument()) return null;
  if (!liveRegions) liveRegions = {};
  if (!liveRegions[politeness] || !liveRegions[politeness].isConnected) {
    const el = document.createElement('div');
    el.className = 'visually-hidden';
    el.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');
    el.setAttribute('aria-live', politeness);
    el.setAttribute('aria-atomic', 'true');
    el.setAttribute('data-ui-live', politeness);
    document.body.appendChild(el);
    liveRegions[politeness] = el;
  }
  return liveRegions[politeness];
}

/**
 * announce(text, { politeness = 'polite', clearAfterMs = 4000 })
 * Writes to a single shared ARIA live region per politeness (created lazily). Never moves focus, so
 * realtime updates (draws, results) are announced without focus theft (requirement 12.2).
 */
export function announce(text, { politeness = 'polite', clearAfterMs = 4000 } = {}) {
  const region = liveRegion(politeness === 'assertive' ? 'assertive' : 'polite');
  if (!region) return false;
  const msg = String(text ?? '');
  // Clear first so repeating the same message is re-announced by screen readers.
  region.textContent = '';
  setTimeout(() => { region.textContent = msg; }, 30);
  if (region._clearTimer) clearTimeout(region._clearTimer);
  if (clearAfterMs > 0) region._clearTimer = setTimeout(() => { if (region.textContent === msg) region.textContent = ''; }, clearAfterMs);
  return true;
}

const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
export function focusableIn(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true' && (el.offsetParent !== null || el === document.activeElement || el.getClientRects().length > 0));
}

/**
 * focusTrap(modalEl, { initialFocus, onEscape, restoreFocus = true })
 * Keeps Tab / Shift+Tab inside the dialog, focuses the first focusable (or initialFocus), calls onEscape
 * on Escape, and returns release() which restores focus to the previously focused element.
 */
export function focusTrap(modalEl, { initialFocus = null, onEscape = null, restoreFocus = true } = {}) {
  if (!hasDocument() || !modalEl) return () => {};
  const previous = document.activeElement;
  function onKeydown(e) {
    if (e.key === 'Escape' && typeof onEscape === 'function') { e.preventDefault(); onEscape(e); return; }
    if (e.key !== 'Tab') return;
    const items = focusableIn(modalEl);
    if (!items.length) { e.preventDefault(); modalEl.focus(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !modalEl.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !modalEl.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  function onFocusIn(e) { if (!modalEl.contains(e.target)) { const items = focusableIn(modalEl); (items[0] || modalEl).focus(); } }
  if (!modalEl.hasAttribute('tabindex')) modalEl.setAttribute('tabindex', '-1');
  modalEl.addEventListener('keydown', onKeydown);
  document.addEventListener('focusin', onFocusIn);
  const target = (typeof initialFocus === 'string' ? modalEl.querySelector(initialFocus) : initialFocus) || focusableIn(modalEl)[0] || modalEl;
  target.focus({ preventScroll: true });
  let released = false;
  return function release() {
    if (released) return; released = true;
    modalEl.removeEventListener('keydown', onKeydown);
    document.removeEventListener('focusin', onFocusIn);
    if (restoreFocus && previous && typeof previous.focus === 'function' && previous.isConnected) previous.focus({ preventScroll: true });
  };
}

/** setPending(button, pending, label?) - toggles .is-pending, aria-busy and disabled without changing width. */
export function setPending(button, pending, label = null) {
  if (!button) return;
  button.classList.toggle('is-pending', Boolean(pending));
  button.setAttribute('aria-busy', pending ? 'true' : 'false');
  button.disabled = Boolean(pending);
  if (label !== null) button.setAttribute('aria-label', label);
}

/** qs / qsa - small query helpers. */
export const qs = (sel, root = hasDocument() ? document : null) => (root ? root.querySelector(sel) : null);
export const qsa = (sel, root = hasDocument() ? document : null) => (root ? Array.from(root.querySelectorAll(sel)) : []);

/** prefersReducedMotion() - true when the user asked for reduced motion (or matchMedia is unavailable). */
export function prefersReducedMotion() {
  try { return typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false; } catch { return false; }
}
