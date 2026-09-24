// apps/employee-mobile/src/views/join.js - E1 Join (employee ref, display name, consent) and E2 expired-link state.
import { h, mount, setPending } from '/packages/ui/dom.js';
import { t } from '/packages/contracts/index.js';
import { tl, exceptionCopy, notice, button } from './common.js';
import { doodad } from '../doodads.js';
import { doodadPlan } from '../backdrop-params.js';
// Join-screen 3D orb (src/scene/join-scene.js, vendored Three.js, D-22) is loaded lazily after the first paint of
// this screen only; until it resolves (or when WebGL is unavailable) the CSS orb in .join-orb stays.

/** Lazy scene handle: dispose() works before, during and after the module import. */
function lazyJoinScene(host) {
  let disposed = false, inner = null;
  const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 250));
  idle(() => {
    if (disposed || !host || !host.isConnected) return;
    import('../scene/join-scene.js')
      .then((m) => { if (disposed) return; inner = m.createJoinSoulScene(host); if (disposed) inner.dispose(); })
      .catch(() => { /* CSS orb remains */ });
  });
  return { dispose() { disposed = true; if (inner) { inner.dispose(); inner = null; } } };
}

export function mountJoin(root, ctx) {
  let form = null, submit = null, errorBox = null, refInput = null, nameInput = null, consentInput = null;
  let soulScene = null;

  function render(state) {
    const hasToken = !!state.joinToken;
    const errorId = state.joinError;
    errorBox = h('div', { className: 'stack', id: 'join-error' });
    if (errorId) errorBox.appendChild(notice(exceptionCopy(errorId), { tone: 'danger', role: 'alert' }));
    else if (!hasToken) errorBox.appendChild(notice(exceptionCopy('E2'), { tone: 'danger', role: 'alert', extra: h('p', { className: 'muted' }, tl('ui.noLink')) }));

    refInput = h('input', { className: 'input', id: 'join-ref', name: 'employeeRef', type: 'text', autocomplete: 'username', required: true, maxlength: '200', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false' });
    nameInput = h('input', { className: 'input', id: 'join-name', name: 'displayName', type: 'text', autocomplete: 'nickname', required: true, maxlength: '80' });
    consentInput = h('input', { type: 'checkbox', id: 'join-consent', name: 'consentPublicName' });
    submit = button(t('join.cta'), { variant: 'primary', className: 'btn--block btn--lg', type: 'submit', disabled: !hasToken || !!(errorId === 'E2') });

    form = h('form', { className: 'card stack join-card', noValidate: true, 'aria-describedby': 'join-error', onSubmit: onSubmit },
      h('p', { className: 'join-card__eyebrow' }, tl('ui.callsign')),
      h('h2', { id: 'join-title' }, t('join.title')),
      h('div', { className: 'field' }, h('label', { className: 'field__label', for: 'join-ref' }, t('join.employeeRef')), refInput),
      h('div', { className: 'field' }, h('label', { className: 'field__label', for: 'join-name' }, t('join.displayName')), nameInput),
      h('div', { className: 'field' },
        h('label', { className: 'checkbox', for: 'join-consent' }, consentInput, h('span', null, t('join.consent'))),
        h('p', { className: 'field__hint', id: 'join-consent-note' }, t('join.consentNote'))),
      submit);

    mount(root, h('div', { className: 'stack join-screen' },
      h('section', { className: 'join-hero', 'aria-labelledby': 'join-hero-title' },
        ...doodadPlan('join', window.innerWidth).map((d) => h('span', { className: 'join-doodad', 'aria-hidden': 'true' }, doodad(d.kind, { size: d.size }))),
        h('div', { className: 'join-orb', id: 'join-soul-scene', 'aria-hidden': 'true' }, h('span', { className: 'join-orb__core' })),
        h('div', { className: 'join-hero__copy' },
          h('p', { className: 'join-hero__eyebrow' }, tl('ui.mission')),
          h('h1', { className: 'screen-title join-hero__title', id: 'join-hero-title' }, t('app.title')),
          h('p', { className: 'join-hero__lead' }, tl('ui.joinLead')),
          state.event && state.event.eventName ? h('p', { className: 'join-hero__event' }, state.event.eventName) : null)),
      errorBox, form));
    soulScene?.dispose();
    soulScene = lazyJoinScene(document.getElementById('join-soul-scene'));
  }

  async function onSubmit(e) {
    e.preventDefault();
    const employeeRef = refInput.value.trim();
    const displayName = nameInput.value.trim();
    let valid = true;
    for (const [input, ok] of [[refInput, !!employeeRef], [nameInput, !!displayName]]) {
      input.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (!ok && valid) { input.focus(); valid = false; }
    }
    if (!valid) return;
    setPending(submit, true);
    try {
      // Audio unlock must run inside the tap (autoplay policy); it resolves independently of the request.
      await ctx.actions.join({ employeeRef, displayName, consentPublicName: consentInput.checked });
    } finally {
      if (submit.isConnected) setPending(submit, false);
    }
  }

  return {
    update(state, prev) {
      if (!form || !prev || prev.joinError !== state.joinError || prev.joinToken !== state.joinToken || prev.event !== state.event) render(state);
    },
    effect() {},
    unmount() { soulScene?.dispose(); soulScene = null; mount(root, null); },
  };
}
