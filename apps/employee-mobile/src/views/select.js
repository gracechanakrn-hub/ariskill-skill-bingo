// apps/employee-mobile/src/views/select.js - E3 Skill picker (D-35): three short questions fill a live 4 x 4 board.
//   1. Arise core skills (discovery mode 'core'), 2. skills in your role without the core ones ('role', no kind labels),
//   3. search ('search'), skipped when the board is already full. Tapping a chip adds or removes it; tapping a filled
//   tile removes it (swap). The board shows the draft in tap order; the server shuffles it on finalize (BR-04), and
//   "Review board" leaves the picker for the shuffled board. There is no "accept all" control (requirement 4.1).
import { h, mount } from '/packages/ui/dom.js';
import { animateOnce, MOTION } from '/packages/ui/motion.js';
import { t } from '/packages/contracts/index.js';
import { tl, exceptionCopy, notice, button, placeholder } from './common.js';
import { selectionProgress, saveBlockedReason, pickerSlots, nextPickStep, REQUIRED_SELECTIONS, PICK_STEPS } from '../state.js';

const STEP_MODE = { 1: 'core', 2: 'role', 3: 'search' };
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 40;

export function mountSelect(root, ctx) {
  let query = '';
  let searchTimer = null;
  const lists = new Map();      // `${mode}|${q}` -> { skills, loading, error }
  const skillsById = new Map(); // id -> skill (tile and chip labels)
  let els = {};
  let lastState = null;
  let lastDraft = null;
  let renderedStep = null;

  // ---- data ------------------------------------------------------------------------------------
  const listKey = (mode, q) => `${mode}|${mode === 'search' ? q : ''}`;
  async function ensureList(mode, q = '', { limit } = {}) {
    const key = listKey(mode, q);
    if (lists.has(key) && !lists.get(key).error) return;
    lists.set(key, { skills: [], loading: true, error: null });
    try {
      const res = await ctx.actions.discovery(mode, q, limit);
      for (const s of res.skills) skillsById.set(s.id, s);
      lists.set(key, { skills: res.skills, loading: false, error: null });
    } catch (err) {
      lists.set(key, { skills: [], loading: false, error: (err && err.exceptionId) || 'E17' });
    }
    renderChips();
    renderBoard();
  }
  function currentList() {
    const mode = STEP_MODE[step()];
    if (mode === 'search' && !query) return { skills: [], loading: false, error: null, idle: true };
    return lists.get(listKey(mode, query)) || { skills: [], loading: true, error: null };
  }
  function nameOf(id) {
    const s = skillsById.get(id) || (lastState && lastState.cellSkill(id));
    return s ? s.name : '…';
  }
  const step = () => Math.min(Math.max(lastState ? lastState.ui.pickStep || 1 : 1, 1), PICK_STEPS);
  const full = () => lastState.ui.draft.length >= REQUIRED_SELECTIONS;

  // ---- board (tap order) -----------------------------------------------------------------------
  function renderBoard({ added = null } = {}) {
    if (!els.grid || !lastState) return;
    const slots = pickerSlots(lastState.ui.draft);
    const tiles = slots.map((id, i) => {
      if (!id) return h('li', { className: 'pick-tile pick-tile--empty', dataset: { position: String(i) } }, h('span', { 'aria-hidden': 'true' }, '+'));
      const name = nameOf(id);
      const longest = Math.max(...name.split(/[\s/]+/).map((w) => w.length));
      const tile = h('li', { className: 'pick-tile-slot', dataset: { position: String(i) } },
        h('button', { type: 'button', className: `pick-tile${longest > 12 ? ' pick-tile--xs' : longest > 10 ? ' pick-tile--sm' : ''}`, 'aria-label': t('pick.removeTile', { name }), onClick: () => ctx.actions.removeSkill(id) },
          h('span', { className: 'pick-tile__name' }, name.replace(/\//g, '/\u200b'))));
      if (id === added) animateOnce(tile, 'm-add', { durationMs: MOTION.interactions.addSkill.ms });
      return tile;
    });
    mount(els.grid, tiles);
  }

  // ---- question sheet --------------------------------------------------------------------------
  function renderSteps() {
    const s = step();
    const dots = [];
    for (let i = 1; i <= PICK_STEPS; i++) {
      const done = i < s;
      const skipped = i === 3 && s < 3 && full();
      if (i > 1) dots.push(h('li', { className: 'pick-steps__line', 'aria-hidden': 'true' }));
      dots.push(h('li', { className: `pick-steps__dot${i === s ? ' is-on' : ''}${done ? ' is-done' : ''}${skipped ? ' is-skipped' : ''}`, 'aria-current': i === s ? 'step' : null }, done ? '✓' : String(i)));
    }
    mount(els.steps, dots);
    els.steps.setAttribute('aria-label', t('pick.step', { number: s }));
    const p = selectionProgress(lastState);
    els.count.textContent = `${p.count}/${REQUIRED_SELECTIONS}${p.complete ? ' ✓' : ''}`;
    els.count.classList.toggle('is-full', p.complete);
    els.count.setAttribute('aria-label', t('select.progress', { count: p.count }));
  }

  function renderQuestion({ focus = false } = {}) {
    const s = step();
    const isFull = full();
    const left = REQUIRED_SELECTIONS - lastState.ui.draft.length;
    els.title.textContent = t(`pick.q${s}.title`);
    els.fullPill.hidden = !isFull;
    els.hint.textContent = isFull ? t('pick.swapHint') : s === 3 ? t('pick.q3.hint', { count: left }) : t(`pick.q${s}.hint`);
    els.search.hidden = s !== 3;
    const actions = [];
    if (s > 1) actions.push(button(t('pick.back'), { className: 'btn--ghost pick-back', onClick: () => ctx.actions.setPickStep(s - 1) }));
    else if (lastState.ui.editing && lastState.board && lastState.board.state === 'READY') actions.push(button(tl('ui.backToBoard'), { className: 'btn--ghost pick-back', onClick: ctx.actions.stopEditing }));
    const next = nextPickStep(s, lastState.ui.draft.length);
    if (next === 'review') actions.push(button(`${t('pick.review')} →`, { variant: 'primary', className: 'pick-next', onClick: ctx.actions.reviewBoard }));
    else if (s < PICK_STEPS) actions.push(button(`${t('pick.next')} →`, { variant: 'primary', className: 'pick-next', onClick: () => ctx.actions.setPickStep(next) }));
    else actions.push(button(t('pick.addMore', { count: left }), { variant: 'primary', className: 'pick-next', disabled: true }));
    mount(els.actions, actions);
    if (renderedStep !== s) {
      renderedStep = s;
      const mode = STEP_MODE[s];
      if (mode !== 'search') ensureList(mode, '', { limit: 500 });
      if (s === 3) els.searchInput.value = query;
      if (focus) (s === 3 ? els.searchInput : els.title).focus({ preventScroll: true });
    }
    renderChips();
  }

  function renderChips() {
    if (!els.chips || !lastState) return;
    const entry = currentList();
    const draft = lastState.ui.draft;
    const isFull = draft.length >= REQUIRED_SELECTIONS;
    const children = [];
    if (entry.error) children.push(h('li', null, notice(exceptionCopy(entry.error), { tone: 'danger', role: 'alert', extra: button(tl('ui.retry'), { onClick: () => { lists.delete(listKey(STEP_MODE[step()], query)); ensureList(STEP_MODE[step()], query, { limit: STEP_MODE[step()] === 'search' ? SEARCH_LIMIT : 500 }); } }) })));
    else if (entry.loading) children.push(h('li', null, placeholder(tl('ui.loading'))));
    else if (!entry.idle && !entry.skills.length) children.push(h('li', null, placeholder(tl('ui.noResults'))));
    for (const s of entry.skills) {
      const on = draft.includes(s.id);
      const off = isFull && !on;
      children.push(h('li', null, h('button', {
        type: 'button', className: `pick-chip${on ? ' is-on' : ''}${off ? ' is-off' : ''}`, 'aria-pressed': on ? 'true' : 'false',
        'aria-disabled': off ? 'true' : null, dataset: { skillId: s.id },
        onClick: () => { if (on) ctx.actions.removeSkill(s.id); else if (!off) { skillsById.set(s.id, s); ctx.actions.tapSkill(s.id); } },
      }, s.name)));
    }
    mount(els.chips, children);
  }

  function onSearchInput() {
    const value = els.searchInput.value.trim();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = value; if (query) ensureList('search', query, { limit: SEARCH_LIMIT }); renderChips(); }, SEARCH_DEBOUNCE_MS);
  }

  // ---- status blocks ---------------------------------------------------------------------------
  function renderStatus(state) {
    const blocked = saveBlockedReason(state, ctx.clockNow());
    const notices = [];
    if (state.ui.editing && state.board && state.board.state === 'READY') notices.push(notice(t('board.editWarning'), { tone: 'warning' }));
    if (blocked === 'E1') notices.push(notice(t('board.noRound'), { tone: 'info' }));
    else if (blocked) notices.push(notice(exceptionCopy(blocked), { tone: 'warning' }));
    else if (state.ui.saveNotice) notices.push(notice(state.ui.saveNotice, { tone: 'warning' }));
    if (state.ui.saveError) notices.push(notice(exceptionCopy(state.ui.saveError), { tone: 'danger', role: 'alert', extra: button(tl('ui.retry'), { onClick: ctx.actions.retrySave, className: 'btn--sm' }) }));
    if (state.ui.finalizeError) notices.push(notice(exceptionCopy(state.ui.finalizeError), { tone: 'danger', role: 'alert', extra: button(tl('ui.buildBoard'), { onClick: ctx.actions.retryFinalize, className: 'btn--sm btn--primary' }) }));
    mount(els.notices, notices);
  }

  // ---- shell -----------------------------------------------------------------------------------
  function renderShell() {
    els = {};
    els.steps = h('ol', { className: 'pick-steps', role: 'list' });
    els.count = h('p', { className: 'pick-count tabular', role: 'status', 'aria-live': 'polite' });
    els.grid = h('ol', { className: 'pick-grid', role: 'list', 'aria-label': tl('ui.yourBoard') });
    els.notices = h('div', { className: 'stack stack--tight' });
    els.title = h('h1', { className: 'pick-title', tabIndex: -1 });
    els.fullPill = h('span', { className: 'pick-full', hidden: true }, t('pick.full'));
    els.hint = h('p', { className: 'pick-hint', 'aria-live': 'polite' });
    els.searchInput = h('input', { className: 'input pick-search__input', type: 'search', id: 'pick-search', placeholder: t('select.search.placeholder'), 'aria-label': t('select.search.placeholder'), autocomplete: 'off', onInput: onSearchInput });
    els.search = h('div', { className: 'pick-search', hidden: true }, els.searchInput);
    els.chips = h('ul', { className: 'pick-chips', role: 'list' });
    els.actions = h('div', { className: 'pick-actions' });
    mount(root, h('div', { className: 'picker' },
      h('div', { className: 'pick-top' }, els.steps, els.count),
      h('div', { className: 'pick-board' }, els.grid),
      els.notices,
      h('section', { className: 'pick-sheet', 'aria-labelledby': 'pick-title' },
        h('div', { className: 'pick-head' }, Object.assign(els.title, { id: 'pick-title' }), els.fullPill),
        els.hint, els.search, els.chips, els.actions)));
    ensureList('search', '', { limit: 500 }); // names for tiles restored from a saved draft
  }

  return {
    update(state) {
      lastState = withCellLookup(state);
      const first = !els.grid;
      if (first) renderShell();
      const draftChanged = lastDraft !== state.ui.draft;
      const added = draftChanged && lastDraft && state.ui.draft.length > lastDraft.length ? state.ui.draft[state.ui.draft.length - 1] : null;
      renderStatus(state);
      renderSteps();
      if (first || draftChanged || renderedStep !== step()) renderQuestion({ focus: !first && renderedStep !== step() });
      if (first || draftChanged) renderBoard({ added });
      lastDraft = state.ui.draft;
    },
    effect() {},
    unmount() { if (searchTimer) clearTimeout(searchTimer); mount(root, null); },
  };
}

/** Lets tiles resolve names of skills that came from the server board rather than a discovery list. */
function withCellLookup(state) {
  const cells = state.board && Array.isArray(state.board.cells) ? state.board.cells : [];
  return { ...state, cellSkill: (id) => cells.find((c) => c.skillId === id) || null };
}
