// apps/employee-mobile/src/views/select.js - E3 Skill selection: three discovery tabs, active selection into the next
// slot, chips with Remove and one-level Undo, progress, autosave state, finalize retry (E18), no-round / late banners.
// There is deliberately no "accept all recommended" control (requirement 4.1, non-negotiable).
import { h, mount } from '/packages/ui/dom.js';
import { animateOnce, MOTION } from '/packages/ui/motion.js';
import { t } from '/packages/contracts/index.js';
import { tl, exceptionCopy, kindChip, kindClass, notice, button, placeholder } from './common.js';
import { selectionProgress, saveBlockedReason, REQUIRED_SELECTIONS } from '../state.js';

const TABS = [
  { id: 'recommended', key: 'select.tab.recommended' },
  { id: 'popular', key: 'select.tab.popular' },
  { id: 'search', key: 'select.tab.search' },
];
const SEARCH_DEBOUNCE_MS = 300;

export function mountSelect(root, ctx) {
  let activeTab = 'recommended';
  let query = '';
  let searchTimer = null;
  const lists = new Map();      // `${mode}|${q}` -> { skills, loading, error }
  const skillsById = new Map(); // id -> skill (for chip labels)
  const rowsById = new Map();   // id -> option button (current list)
  const chipsById = new Map();  // id -> chip element
  let els = {};
  let lastState = null;
  let lastDraft = null;

  // ---- data ------------------------------------------------------------------------------------
  function listKey(mode, q) { return `${mode}|${mode === 'search' ? q : ''}`; }
  async function ensureList(mode, q) {
    const key = listKey(mode, q);
    if (lists.has(key) && !lists.get(key).error) return;
    lists.set(key, { skills: [], loading: true, error: null });
    renderList();
    try {
      const res = await ctx.actions.discovery(mode, q);
      for (const s of res.skills) skillsById.set(s.id, s);
      lists.set(key, { skills: res.skills, loading: false, error: null });
    } catch (err) {
      lists.set(key, { skills: [], loading: false, error: (err && err.exceptionId) || 'E17' });
    }
    if (activeTab === mode && (mode !== 'search' || query === q)) renderList();
    renderChips();
  }

  // ---- tabs ------------------------------------------------------------------------------------
  function selectTab(id, { focus = false } = {}) {
    activeTab = id;
    for (const tab of TABS) {
      const el = els.tabs[tab.id];
      const on = tab.id === id;
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      el.tabIndex = on ? 0 : -1;
      if (on && focus) el.focus();
    }
    els.search.hidden = id !== 'search';
    els.panel.setAttribute('aria-labelledby', `tab-${id}`);
    ensureList(id, query);
    renderList();
  }
  function onTabKey(e) {
    const idx = TABS.findIndex((tab) => tab.id === activeTab);
    let next = null;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    selectTab(TABS[next].id, { focus: true });
  }
  function onSearchInput() {
    const value = els.searchInput.value.trim();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = value; ensureList('search', query); renderList(); }, SEARCH_DEBOUNCE_MS);
  }

  // ---- list ------------------------------------------------------------------------------------
  function renderList() {
    if (!els.list || !lastState) return;
    const entry = lists.get(listKey(activeTab, query)) || { skills: [], loading: true, error: null };
    const draft = lastState.ui.draft;
    const full = draft.length >= REQUIRED_SELECTIONS;
    rowsById.clear();
    const children = [];
    if (entry.error) children.push(h('li', null, notice(exceptionCopy(entry.error), { tone: 'danger', role: 'alert', extra: button(tl('ui.retry'), { onClick: () => { lists.delete(listKey(activeTab, query)); ensureList(activeTab, query); } }) })));
    else if (entry.loading) children.push(h('li', null, placeholder(tl('ui.loading'))));
    else if (!entry.skills.length) children.push(h('li', null, placeholder(tl('ui.noResults'))));
    for (const s of entry.skills) {
      const pressed = draft.includes(s.id);
      const row = h('button', {
        type: 'button', className: ['option', 'skill-row', kindClass('skill-row', s), pressed ? 'is-selected' : ''].filter(Boolean).join(' '),
        'aria-pressed': pressed ? 'true' : 'false', dataset: { skillId: s.id }, onClick: () => onRowTap(s),
      },
        h('span', { className: 'skill-row__main' },
          h('span', { className: 'skill-row__name' }, s.name),
          h('span', { className: 'option__meta skill-row__meta' }, s.domain || '')),
        h('span', { className: 'skill-row__side' },
          kindChip(s),
          h('span', { className: `skill-row__eligible ${s.eligible ? 'is-eligible' : 'is-not-eligible'}` }, s.eligible ? t('select.eligible') : t('select.notEligible')),
          h('span', { className: 'skill-row__state', 'aria-hidden': 'true' }, pressed ? '✓' : '+')));
      if (full && !pressed) row.setAttribute('aria-disabled', 'true');
      rowsById.set(s.id, row);
      children.push(h('li', null, row));
    }
    mount(els.list, children);
  }
  function syncRows(draft) {
    const full = draft.length >= REQUIRED_SELECTIONS;
    for (const [id, row] of rowsById) {
      const pressed = draft.includes(id);
      row.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      row.classList.toggle('is-selected', pressed);
      const mark = row.querySelector('.skill-row__state'); if (mark) mark.textContent = pressed ? '✓' : '+';
      if (full && !pressed) row.setAttribute('aria-disabled', 'true'); else row.removeAttribute('aria-disabled');
    }
  }
  function onRowTap(skill) {
    skillsById.set(skill.id, skill);
    ctx.actions.tapSkill(skill.id);
  }

  // ---- chips -----------------------------------------------------------------------------------
  function chipFor(id) {
    const s = skillsById.get(id) || lastState.cellSkill(id) || { id, name: id };
    const chip = h('li', { className: ['chip', kindClass('chip', s)].join(' '), dataset: { skillId: id } },
      h('span', { className: 'chip__label' }, s.name),
      h('button', { type: 'button', className: 'chip__remove', 'aria-label': tl('ui.remove', { name: s.name }), onClick: () => ctx.actions.removeSkill(id) }, '×'));
    return chip;
  }
  function renderChips({ animateAdded = false } = {}) {
    if (!els.chips || !lastState) return;
    const draft = lastState.ui.draft;
    const wanted = new Set(draft);
    for (const [id, chip] of chipsById) {
      if (!wanted.has(id)) {
        chipsById.delete(id);
        animateOnce(chip, 'm-remove', { durationMs: MOTION.interactions.removeSkill.ms, onEnd: () => chip.remove() });
      }
    }
    const order = [];
    for (const id of draft) {
      let chip = chipsById.get(id);
      if (!chip) { chip = chipFor(id); chipsById.set(id, chip); if (animateAdded) animateOnce(chip, 'm-add', { durationMs: MOTION.interactions.addSkill.ms }); }
      else { const label = chip.querySelector('.chip__label'); const s = skillsById.get(id); if (s && label && label.textContent !== s.name) label.textContent = s.name; }
      order.push(chip);
    }
    // Keep DOM order equal to tap order (leaving-chips stay in place until their fade ends).
    let cursor = els.chips.firstChild;
    for (const chip of order) {
      while (cursor && cursor !== chip && !chipsById.has(cursor.dataset.skillId)) cursor = cursor.nextSibling;
      if (cursor === chip) { cursor = chip.nextSibling; continue; }
      els.chips.insertBefore(chip, cursor);
    }
    els.chipsEmpty.hidden = draft.length > 0;
    els.undo.disabled = !Array.isArray(lastState.ui.undo);
  }

  // ---- status blocks ---------------------------------------------------------------------------
  function renderStatus(state) {
    const p = selectionProgress(state);
    els.progressText.textContent = t('select.progress', { count: p.count });
    els.progress.style.setProperty('--p', String(p.percent));
    els.progressValue.textContent = String(p.count);
    els.progress.setAttribute('aria-valuenow', String(p.count));
    els.progress.setAttribute('aria-valuetext', t('select.progress', { count: p.count }));
    els.progress.classList.toggle('ring--complete', p.complete);

    const blocked = saveBlockedReason(state, ctx.clockNow());
    const notices = [];
    if (state.ui.editing && state.board && state.board.state === 'READY') {
      notices.push(notice(t('board.editWarning'), { tone: 'warning', extra: button(tl('ui.backToBoard'), { onClick: ctx.actions.stopEditing, className: 'btn--sm' }) }));
    }
    if (blocked === 'E1') notices.push(notice(t('board.noRound'), { tone: 'info' }));
    else if (blocked) notices.push(notice(exceptionCopy(blocked), { tone: 'warning' }));
    else if (state.ui.saveNotice) notices.push(notice(state.ui.saveNotice, { tone: 'warning' }));
    if (state.ui.saveError) notices.push(notice(exceptionCopy(state.ui.saveError), { tone: 'danger', role: 'alert', extra: button(tl('ui.retry'), { onClick: ctx.actions.retrySave, className: 'btn--sm' }) }));
    if (state.ui.finalizeError) notices.push(notice(exceptionCopy(state.ui.finalizeError), { tone: 'danger', role: 'alert', extra: button(tl('ui.buildBoard'), { onClick: ctx.actions.retryFinalize, className: 'btn--sm btn--primary' }) }));
    mount(els.notices, notices);
  }

  // ---- shell -----------------------------------------------------------------------------------
  function renderShell(state) {
    els = { tabs: {} };
    // Radial progress ring (game experience, D-22): conic-gradient driven by --p; the catalog copy stays the label.
    els.progressValue = h('span', { className: 'ring__value tabular' }, '0');
    els.progress = h('div', { className: 'ring', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(REQUIRED_SELECTIONS), 'aria-valuenow': '0', 'aria-labelledby': 'select-progress-text', style: { '--p': '0' } },
      h('span', { className: 'ring__inner', 'aria-hidden': 'true' }, els.progressValue, h('span', { className: 'ring__total' }, `/ ${REQUIRED_SELECTIONS}`)));
    els.progressText = h('p', { className: 'select-progress', id: 'select-progress-text', 'aria-live': 'polite' });
    els.notices = h('div', { className: 'stack stack--tight' });
    const tablist = h('div', { className: 'tabs', role: 'tablist', 'aria-label': tl('ui.tabs'), onKeydown: onTabKey });
    for (const tab of TABS) {
      els.tabs[tab.id] = h('button', { type: 'button', role: 'tab', id: `tab-${tab.id}`, className: 'tab', 'aria-selected': 'false', 'aria-controls': 'select-panel', tabIndex: -1, onClick: () => selectTab(tab.id) }, t(tab.key));
      tablist.appendChild(els.tabs[tab.id]);
    }
    els.searchInput = h('input', { className: 'input', type: 'search', id: 'select-search', placeholder: t('select.search.placeholder'), 'aria-label': t('select.search.placeholder'), autocomplete: 'off', onInput: onSearchInput });
    els.search = h('div', { className: 'search', hidden: true }, els.searchInput);
    els.list = h('ul', { className: 'skill-list', role: 'list' });
    els.panel = h('div', { className: 'tabpanel', role: 'tabpanel', id: 'select-panel', tabIndex: 0 }, els.search, els.list);
    els.chips = h('ul', { className: 'chip-list', role: 'list', 'aria-label': tl('ui.selected') });
    els.chipsEmpty = h('p', { className: 'muted' }, tl('ui.noneSelected'));
    els.undo = h('button', { type: 'button', className: 'btn btn--ghost btn--sm', onClick: ctx.actions.undo, disabled: true }, t('select.undo'));
    const selected = h('section', { className: 'card selected-panel stack stack--tight', 'aria-labelledby': 'selected-title' },
      h('div', { className: 'cluster cluster--between' }, h('h2', { id: 'selected-title', className: 'section__title' }, tl('ui.selected')), els.undo),
      els.chipsEmpty, els.chips);

    mount(root, h('div', { className: 'stack' },
      h('div', { className: 'stack stack--tight' }, h('h1', { className: 'screen-title' }, t('select.title'))),
      h('div', { className: 'select-progress-block' }, els.progress, h('div', { className: 'select-progress-copy' }, els.progressText, h('p', { className: 'muted select-progress-hint' }, t('select.hint')))),
      els.notices,
      h('section', { className: 'stack stack--tight', 'aria-label': tl('ui.tabs') }, tablist, els.panel),
      selected));
    selectTab(activeTab);
    ensureList('search', ''); // primes skill names for chips restored from a saved draft
  }

  return {
    update(state, prev) {
      lastState = withCellLookup(state);
      if (!els.list) renderShell(state);
      const draftChanged = lastDraft !== state.ui.draft;
      renderStatus(state);
      if (draftChanged) {
        const added = lastDraft ? state.ui.draft.length > lastDraft.length : false;
        syncRows(state.ui.draft);
        renderChips({ animateAdded: added });
        lastDraft = state.ui.draft;
      }
      if (!prev || prev.board !== state.board) renderChips();
    },
    effect() {},
    unmount() { if (searchTimer) clearTimeout(searchTimer); mount(root, null); },
  };
}

/** Lets chips resolve names of skills that came from the server board rather than a discovery list. */
function withCellLookup(state) {
  const cells = state.board && Array.isArray(state.board.cells) ? state.board.cells : [];
  return { ...state, cellSkill: (id) => cells.find((c) => c.skillId === id) || null };
}
