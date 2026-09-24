import { test } from 'node:test';
import assert from 'node:assert/strict';

// A very small DOM stub - enough to check attribute mapping of h() without a browser.
function makeStubDocument() {
  class Node { constructor() { this.children = []; this.attrs = {}; this.listeners = {}; this.dataset = {}; this.style = { setProperty(k, v) { this[k] = v; } }; this.nodeType = 1; }
    appendChild(c) { this.children.push(c); return c; } setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); } get firstChild() { return this.children[0] || null; } removeChild(c) { this.children = this.children.filter((x) => x !== c); }
    get textContent() { return this.children.map((c) => c.text ?? c.textContent).join(''); } set textContent(v) { this.children = [{ nodeType: 3, text: String(v) }]; } }
  return { createElement: (tag) => Object.assign(new Node(), { tag }), createElementNS: (ns, tag) => Object.assign(new Node(), { tag, ns }), createTextNode: (t) => ({ nodeType: 3, text: t }), body: new Node(), querySelector: () => null };
}

test('escapeHtml escapes the five significant characters and tolerates null', async () => {
  const { escapeHtml } = await import('../dom.js');
  assert.equal(escapeHtml('<a href="x">Tom & \'Jerry\'</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(42), '42');
});

test('module imports in Node and guards document-dependent functions', async () => {
  const dom = await import('../dom.js');
  assert.equal(typeof dom.h, 'function');
  assert.throws(() => dom.h('div'), /document/);
  assert.equal(dom.announce('hello'), false);
  assert.equal(typeof dom.focusTrap(null), 'function');
  assert.equal(dom.qs('#x'), null);
  assert.deepEqual(dom.qsa('.x'), []);
  assert.equal(dom.prefersReducedMotion(), false);
});

test('h() maps className, dataset, aria-*, on* listeners, boolean attrs, style vars and children', async () => {
  globalThis.document = makeStubDocument();
  try {
    const { h, mount } = await import('../dom.js?stub');
    const clicks = [];
    const el = h('button', { className: ['btn', false, 'btn--primary'], type: 'button', disabled: true, hidden: false, 'aria-pressed': true, 'aria-label': 'Save', dataset: { skillId: 's1', n: 2 }, onClick: () => clicks.push(1), style: { '--x': '1px', color: 'red' } }, 'Save ', ['now', null, 3], h('span', 'x'));
    assert.equal(el.attrs.class, 'btn btn--primary');
    assert.equal(el.attrs.disabled, '');
    assert.equal(el.attrs.hidden, undefined);
    assert.equal(el.attrs['aria-pressed'], 'true');
    assert.equal(el.attrs['aria-label'], 'Save');
    assert.deepEqual(el.dataset, { skillId: 's1', n: '2' });
    assert.equal(el.listeners.click.length, 1);
    assert.equal(el.style['--x'], '1px'); assert.equal(el.style.color, 'red');
    assert.equal(el.children.length, 4);
    assert.equal(el.children[0].text, 'Save '); assert.equal(el.children[2].text, '3'); assert.equal(el.children[3].tag, 'span');
    assert.equal(h('svg', { viewBox: '0 0 1 1' }).ns, 'http://www.w3.org/2000/svg');
    const root = document.createElement('div'); root.appendChild(document.createTextNode('old'));
    mount(root, [h('p', 'a'), h('p', 'b')]);
    assert.equal(root.children.length, 2);
  } finally { delete globalThis.document; }
});
