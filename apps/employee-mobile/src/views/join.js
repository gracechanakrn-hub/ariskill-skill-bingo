// apps/employee-mobile/src/views/join.js - E1 Join, redesigned to continue the landing (D-40): the Blender AriSkill sign, the
// mascot (the landing's final pose) greeting the player, and a single card with the display name, consent and Join.
// There is no employee-ID field: the phone keeps its own random reference (deviceRef in main.js), so a player who
// re-opens the link on the same phone resumes their seat. E2 (expired / missing link) still shows above the card.
import { h, mount, setPending } from '/packages/ui/dom.js';
import { t } from '/packages/contracts/index.js';
import { tl, exceptionCopy, notice, button } from './common.js';

export function mountJoin(root, ctx) {
  let form = null, submit = null, nameInput = null, consentInput = null;

  function render(state) {
    const hasToken = !!state.joinToken;
    const errorId = state.joinError;
    const errorBox = h('div', { className: 'stack', id: 'join-error' });
    if (errorId) errorBox.appendChild(notice(exceptionCopy(errorId), { tone: 'danger', role: 'alert' }));
    else if (!hasToken) errorBox.appendChild(notice(exceptionCopy('E2'), { tone: 'danger', role: 'alert', extra: h('p', { className: 'muted' }, tl('ui.noLink')) }));

    nameInput = h('input', { className: 'input', id: 'join-name', name: 'displayName', type: 'text', autocomplete: 'nickname', required: true, maxlength: '80', 'aria-describedby': 'join-greeting' });
    consentInput = h('input', { type: 'checkbox', id: 'join-consent', name: 'consentPublicName' });
    submit = button(t('join.cta'), { variant: 'primary', className: 'join2__cta', type: 'submit', disabled: !hasToken || errorId === 'E2' });
    form = h('form', { className: 'join2__card stack', noValidate: true, 'aria-describedby': 'join-error', onSubmit },
      h('div', { className: 'field' }, h('label', { className: 'field__label', for: 'join-name' }, t('join.displayName')), nameInput),
      h('div', { className: 'field' },
        h('label', { className: 'checkbox', for: 'join-consent' }, consentInput, h('span', null, t('join.consent'))),
        h('p', { className: 'field__hint' }, t('join.consentNote'))),
      submit);

    mount(root, h('div', { className: 'join2' },
      h('img', { className: 'join2__sign', src: '/play/art/ariskill-sign.webp', alt: t('landing.title'), width: '600', height: '300', decoding: 'async' }),
      h('div', { className: 'join2__hello' },
        h('img', { className: 'join2__soul', src: '/play/art/soul-hi.webp', alt: '', width: '240', height: '300', decoding: 'async' }),
        h('p', { className: 'join2__bubble', id: 'join-greeting' }, t('join.greeting'))),
      errorBox, form));
  }

  async function onSubmit(e) {
    e.preventDefault();
    const displayName = nameInput.value.trim();
    nameInput.setAttribute('aria-invalid', displayName ? 'false' : 'true');
    if (!displayName) { nameInput.focus(); return; }
    setPending(submit, true);
    try {
      // Audio unlock must run inside the tap (autoplay policy); it resolves independently of the request.
      await ctx.actions.join({ displayName, consentPublicName: consentInput.checked });
    } finally {
      if (submit.isConnected) setPending(submit, false);
    }
  }

  return {
    update(state, prev) {
      if (!form || !prev || prev.joinError !== state.joinError || prev.joinToken !== state.joinToken) render(state);
    },
    effect() {},
    unmount() { mount(root, null); },
  };
}
