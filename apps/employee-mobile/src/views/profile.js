// apps/employee-mobile/src/views/profile.js - E2 Platform + Role. Both selects start on a disabled placeholder;
// nothing is ever prefilled (M-02, BR-01). The Role list is filtered by the chosen Platform.
import { h, mount, setPending } from '/packages/ui/dom.js';
import { t } from '/packages/contracts/index.js';
import { tl, exceptionCopy, notice, button, placeholder } from './common.js';

export function mountProfile(root, ctx) {
  let taxonomy = null, loadError = null, loading = false;
  let platformSelect = null, roleSelect = null, submit = null, hint = null, roleField = null;

  async function load() {
    loading = true; loadError = null; render();
    try { taxonomy = await ctx.actions.loadTaxonomy(); }
    catch (err) { loadError = err && err.exceptionId ? err.exceptionId : 'E3'; }
    loading = false; render();
    if (platformSelect) platformSelect.focus({ preventScroll: true });
  }

  function options(select, items, placeholderText) {
    while (select.firstChild) select.removeChild(select.firstChild);
    select.appendChild(h('option', { value: '', disabled: true, selected: true, hidden: true }, placeholderText));
    for (const it of items) select.appendChild(h('option', { value: it.id }, it.name));
    select.value = ''; // explicit: no preselected value
  }

  function onPlatformChange() {
    const platformId = platformSelect.value;
    const roles = taxonomy ? taxonomy.roles.filter((r) => r.platformId === platformId) : [];
    options(roleSelect, roles, t('profile.role'));
    roleSelect.disabled = !platformId;
    syncButton();
  }

  function syncButton() {
    const ready = !!platformSelect.value && !!roleSelect.value;
    submit.disabled = !ready;
    submit.setAttribute('aria-disabled', ready ? 'false' : 'true');
    hint.textContent = ready ? '' : exceptionCopy('E16');
  }

  function render() {
    if (loading) { mount(root, h('div', { className: 'stack' }, h('h1', { className: 'screen-title' }, t('profile.title')), placeholder(tl('ui.loading')))); return; }
    if (loadError || !taxonomy) {
      mount(root, h('div', { className: 'stack' }, h('h1', { className: 'screen-title' }, t('profile.title')),
        notice(exceptionCopy(loadError || 'E3'), { tone: 'danger', role: 'alert', extra: button(tl('ui.retry'), { onClick: load, variant: 'primary' }) })));
      return;
    }
    platformSelect = h('select', { className: 'select', id: 'profile-platform', name: 'platformId', required: true, onChange: onPlatformChange });
    roleSelect = h('select', { className: 'select', id: 'profile-role', name: 'roleId', required: true, disabled: true, onChange: syncButton });
    options(platformSelect, taxonomy.platforms, t('profile.platform'));
    options(roleSelect, [], t('profile.role'));
    submit = button(t('profile.cta'), { variant: 'primary', className: 'btn--block btn--lg', type: 'submit', 'aria-describedby': 'profile-hint' });
    hint = h('p', { className: 'field__hint', id: 'profile-hint', 'aria-live': 'polite' });
    roleField = h('div', { className: 'field' }, h('label', { className: 'field__label', for: 'profile-role' }, t('profile.role')), roleSelect);
    const form = h('form', { className: 'card stack', noValidate: true, onSubmit },
      h('div', { className: 'field' }, h('label', { className: 'field__label', for: 'profile-platform' }, t('profile.platform')), platformSelect),
      roleField, hint, submit);
    mount(root, h('div', { className: 'stack' }, h('h1', { className: 'screen-title' }, t('profile.title')), form));
    syncButton();
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!platformSelect.value || !roleSelect.value) { hint.textContent = exceptionCopy('E16'); ctx.actions.toast('E16'); (platformSelect.value ? roleSelect : platformSelect).focus(); return; }
    setPending(submit, true);
    try { await ctx.actions.setProfile(platformSelect.value, roleSelect.value); }
    finally { if (submit.isConnected) setPending(submit, false); }
  }

  load();
  return { update() {}, effect() {}, unmount() { mount(root, null); } };
}
