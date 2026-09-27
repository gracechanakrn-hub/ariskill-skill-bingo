// Stage dashboard - DOM tiles. Read-only; renders from the data-only view model (state.js deriveView) and the
// insight formatters (insights.js). All text goes through textContent via dom.h (never innerHTML with server
// strings, T13). Copy comes from packages/contracts (t / exception); keys the catalog does not have yet fall back
// to FALLBACK_COPY below and are listed for the copy owner in README.md.
import { h, mount, announce } from '/packages/ui/dom.js';
import { formatCountdown } from '/packages/ui/clock-sync.js';
import { formatInt } from '/packages/ui/format.js';
import { animateOnce, MOTION } from '/packages/ui/motion.js';
import { t, exception, COPY } from '/packages/contracts/index.js';
import { winnerRows, ageSeconds, formatEngagement, formatPercent } from './insights.js';

export const FALLBACK_COPY = Object.freeze({
  'stage.count.joined': 'Joined', 'stage.count.completed': 'Completed', 'stage.count.incomplete': 'Incomplete',
  'stage.count.active': 'Active', 'stage.count.deferred': 'Deferred', 'stage.count.matchedBoards': 'Matched boards',
  'stage.state.DRAFT': 'Scheduled', 'stage.state.REGISTRATION_OPEN': 'Registration open', 'stage.state.LOCKED': 'Locked',
  'stage.state.PLAYING': 'Playing', 'stage.state.WINNER': 'Bingo', 'stage.state.EXHAUSTED': 'Round complete',
  'stage.state.CLOSED': 'Closed', 'stage.state.CANCELLED': 'Cancelled',
  'stage.locksAt': 'Registration locks at {time}', 'stage.waitingDraw': 'Waiting for the first skill...',
  'stage.recentDraws': 'Recent draws', 'stage.poolRemaining': '{count} skills left in the pool',
  'stage.winners': 'Winners', 'stage.noWinners': 'No Bingo yet', 'stage.publishedAt': 'Published {time}',
  'stage.topSkills': 'Top skills', 'stage.density': 'Core / Critical density', 'stage.platforms': 'Platform engagement',
  'stage.roles': 'Role engagement', 'stage.eng.joined': '{count} joined', 'stage.eng.completed': '{count} completed',
  'stage.participants': '{count} participants', 'stage.matrixVersion': 'Matrix {version}',
  'stage.noInsights': 'Insights appear once boards are ready.', 'stage.noCohorts': 'No group of 5 or more yet.',
  'stage.hiddenCohorts': '{count} groups hidden', 'stage.selections': '{count} selections',
  'stage.live': 'Live', 'stage.stale': 'Last update {seconds} s ago', 'stage.connecting': 'Connecting...',
  'stage.sound': 'Sound', 'stage.on': 'On', 'stage.off': 'Off', 'stage.volume': 'Volume', 'stage.reducedMotion': 'Reduced motion',
  'stage.token': 'Stage token', 'stage.tokenSubmit': 'Open dashboard', 'stage.skip': 'Skip to content', 'stage.retry': 'Retry',
  'stage.souls': 'Souls in the Galaxy', 'stage.nextRound': 'Next round', 'stage.moreWinners': '+{count} more',
  'stage.kpi.rounds': 'Rounds played', 'stage.kpi.participants': 'Participants', 'stage.kpi.completed': 'Completed',
  'stage.coreSkills': 'Top core skills', 'stage.matrix': 'Role Skill Matrix matched', 'stage.matrix.avg': 'average match',
  'stage.matrix.players': '{count} players', 'stage.matrix.axis': 'Players by skills in their role matrix (0-16)',
  'stage.matrix.wait': 'The breakdown appears once 5 boards are complete.', 'stage.boards': 'on {count} boards',
  'stage.eng.legend': 'joined \u00B7 completed', 'stage.seeParticipants': 'See participants',
});

/** tx(key, vars): catalog copy when the key exists, otherwise the documented fallback (still keyed, never ad hoc). */
export function tx(key, vars = {}) {
  if (COPY.key[key] !== undefined) return t(key, vars);
  const raw = FALLBACK_COPY[key];
  if (raw === undefined) return key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

// ---------------------------------------------------------------------------------------------------------------
// Icons (abstract/functional glyphs only, currentColor, 3 px stroke at venue scale - art direction 5/6)
// ---------------------------------------------------------------------------------------------------------------
const ICON_PATHS = {
  ring: [['circle', { cx: 12, cy: 12, r: 8 }]],
  lock: [['rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }], ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]],
  spark: [['path', { d: 'M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3' }]],
  star: [['path', { d: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7' }]],
  cross: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  leaf: [['path', { d: 'M5 19c0-8 5-13 14-14-1 9-6 14-14 14z' }], ['path', { d: 'M5 19l8-8' }]],
  wifiOff: [['path', { d: 'M3 3l18 18M5 9a12 12 0 0 1 5-3M9 13a7 7 0 0 1 2-1M12 17h.01M19 9a12 12 0 0 0-3-2' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 8 }], ['path', { d: 'M12 8v4l3 2' }]],
};
export function icon(name, { size = 40 } = {}) {
  const parts = ICON_PATHS[name] || ICON_PATHS.ring;
  return h('svg', { class: `icon icon--${name}`, viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    ...parts.map(([tag, attrs]) => h(tag, attrs)));
}

const STATE_META = {
  DRAFT: { icon: 'clock', pill: 'pill--info' },
  REGISTRATION_OPEN: { icon: 'ring', pill: 'pill--open' },
  LOCKED: { icon: 'lock', pill: 'pill--warning' },
  PLAYING: { icon: 'spark', pill: 'pill--live' },
  WINNER: { icon: 'star', pill: 'pill--success' },
  EXHAUSTED: { icon: 'check', pill: 'pill--info' },
  CLOSED: { icon: 'check', pill: 'pill--closed' },
  CANCELLED: { icon: 'cross', pill: 'pill--danger' },
};

function stateLabel(rs) { return rs === 'WINNER' ? t('public.winner.title') : tx(`stage.state.${rs}`); }


// ---------------------------------------------------------------------------------------------------------------
// Shell (rendered once)
// ---------------------------------------------------------------------------------------------------------------
export function renderShell(root, { onMute, onVolume, onReducedMotion, muted, volume, reducedMotion }) {
  const refs = {};
  const soundBtn = h('button', { type: 'button', class: 'ctl ctl--toggle', 'aria-pressed': muted ? 'false' : 'true', onClick: () => onMute(), ref: (el) => { refs.soundBtn = el; } },
    h('span', { class: 'ctl__label' }, tx('stage.sound')), h('span', { class: 'ctl__value', ref: (el) => { refs.soundValue = el; } }, muted ? tx('stage.off') : tx('stage.on')));
  const volumeInput = h('input', { type: 'range', id: 'stage-volume', class: 'ctl__range', min: 0, max: 1, step: 0.05, value: String(volume), 'aria-label': tx('stage.volume'), onInput: (e) => onVolume(Number(e.target.value)), ref: (el) => { refs.volume = el; } });
  const rmBtn = h('button', { type: 'button', class: 'ctl ctl--toggle', 'aria-pressed': reducedMotion ? 'true' : 'false', onClick: () => onReducedMotion(), ref: (el) => { refs.rmBtn = el; } },
    h('span', { class: 'ctl__label' }, tx('stage.reducedMotion')), h('span', { class: 'ctl__value', ref: (el) => { refs.rmValue = el; } }, reducedMotion ? tx('stage.on') : tx('stage.off')));

  const banner = h('div', { class: 'stage__banner banner banner--reconnecting', hidden: true, role: 'status', 'aria-live': 'polite', ref: (el) => { refs.banner = el; } },
    h('span', { class: 'banner__icon', 'aria-hidden': 'true' }), h('span', { class: 'banner__body', ref: (el) => { refs.bannerText = el; } }));
  // D-48: no footer (connection pill, caption and sound controls are gone from the screen); the refs stay detached so
  // the connection / caption helpers keep working, and the reconnect banner still shows a lost connection.
  h('span', { ref: (el) => { refs.eventName = el; } });
  h('span', { class: 'pill footer__conn', ref: (el) => { refs.conn = el; } }, h('span', { ref: (el) => { refs.connText = el; } }));
  h('p', { ref: (el) => { refs.caption = el; } });
  void soundBtn; void volumeInput; void rmBtn;
  const shell = h('div', { class: 'stage' },
    h('header', { class: 'stage__status', 'aria-label': t('stage.status'), ref: (el) => { refs.header = el; } }),
    h('main', { id: 'main', class: 'stage__main', tabindex: '-1', ref: (el) => { refs.main = el; } }));
  mount(root, [h('a', { class: 'skip-link', href: '#main' }, tx('stage.skip')), banner, shell]);
  refs.root = shell;
  return refs;
}

export function setControls(refs, { muted, volume, reducedMotion }) {
  if (muted !== undefined) { refs.soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true'); refs.soundValue.textContent = muted ? tx('stage.off') : tx('stage.on'); }
  if (volume !== undefined && document.activeElement !== refs.volume) refs.volume.value = String(volume);
  if (reducedMotion !== undefined) { refs.rmBtn.setAttribute('aria-pressed', reducedMotion ? 'true' : 'false'); refs.rmValue.textContent = reducedMotion ? tx('stage.on') : tx('stage.off'); }
}

export function setCaption(refs, text) { refs.caption.textContent = text || ''; }

/** Connection pill + reconnect banner. status: connecting|open|reconnecting|closed; stale + ageS from the view model. */
export function setConnection(refs, { status, stale, ageS }) {
  const pill = refs.conn;
  pill.className = 'pill footer__conn';
  pill.hidden = status === 'idle';
  let text;
  if (status === 'idle') text = '';
  else if (status === 'reconnecting' || status === 'closed') { pill.classList.add('pill--reconnecting'); text = t('reconnect'); }
  else if (status !== 'open') { pill.classList.add('pill--connecting'); text = tx('stage.connecting'); }
  else if (stale) { pill.classList.add('pill--warning'); text = tx('stage.stale', { seconds: ageS ?? '?' }); }
  else { pill.classList.add('pill--live'); text = tx('stage.live'); }
  refs.connText.textContent = text;
  const showBanner = status === 'reconnecting';
  if (showBanner && refs.banner.hidden) { refs.banner.hidden = false; refs.bannerText.textContent = t('reconnect'); animateOnce(refs.banner, 'm-fade', { durationMs: MOTION.durations.base }); }
  else if (!showBanner && !refs.banner.hidden) refs.banner.hidden = true;
}

// ---------------------------------------------------------------------------------------------------------------
// Token prompt / error screens
// ---------------------------------------------------------------------------------------------------------------
export function renderTokenPrompt(refs, { onSubmit, error = null }) {
  mount(refs.header, h('div', { class: 'status__left' }, h('p', { class: 'status__eyebrow' }, t('app.title')), h('h1', { class: 'status__title', id: 'status-title' }, t('stage.status'))));
  let input;
  const form = h('form', { class: 'gate card', onSubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) onSubmit(v); } },
    h('label', { class: 'field__label gate__label', for: 'stage-token' }, tx('stage.token')),
    h('input', { id: 'stage-token', class: 'input gate__input', type: 'password', autocomplete: 'off', required: true, 'aria-describedby': error ? 'gate-error' : undefined, ref: (el) => { input = el; } }),
    error ? h('p', { id: 'gate-error', class: 'field__error gate__error', role: 'alert' }, error) : null,
    h('button', { type: 'submit', class: 'btn btn--primary btn--lg' }, tx('stage.tokenSubmit')));
  mount(refs.main, form);
  input.focus();
}

export function renderError(refs, { text, onRetry = null }) {
  mount(refs.header, h('div', { class: 'status__left' }, h('p', { class: 'status__eyebrow' }, t('app.title')), h('h1', { class: 'status__title', id: 'status-title' }, t('stage.status'))));
  mount(refs.main, h('div', { class: 'gate card', role: 'alert' }, h('p', { class: 'gate__text' }, text), onRetry ? h('button', { type: 'button', class: 'btn btn--lg', onClick: onRetry }, tx('stage.retry')) : null));
}

export function renderLoading(refs) {
  mount(refs.header, h('div', { class: 'status__left' }, h('p', { class: 'status__eyebrow' }, t('app.title')), h('h1', { class: 'status__title', id: 'status-title' }, t('stage.status'))));
  mount(refs.main, h('div', { class: 'gate card' }, h('p', { class: 'gate__text' }, t('syncing'))));
}

// ---------------------------------------------------------------------------------------------------------------
// Dashboard (D-46): logo + live round strip, three always-on numbers, and five insight cards; tapping a card opens its
// list (or the matrix diagram) in the side panel. Aggregate data only (contracts/projections/stage.json).
// ---------------------------------------------------------------------------------------------------------------
export const PANELS = Object.freeze(['platforms', 'roles', 'topSkills', 'coreSkills', 'matrix']);
const dash = { selected: 'topSkills', refs: null, args: null };

/**
 * renderDashboard(refs, vm, { changed, effects, nowMs, synced })
 *  changed: Set from state.changedTiles (tiles get .m-fade when the change came from a live event)
 *  effects: { live: bool, drawArrival: bool, winnerBurst: bool } (already gated by the celebration guard)
 */
export function renderDashboard(refs, vm, { changed = new Set(), effects = {}, nowMs = Date.now(), synced = true } = {}) {
  dash.refs = refs; dash.args = { vm, changed, effects, nowMs, synced };
  refs.root.dataset.layout = 'dashboard';
  refs.root.dataset.roundState = vm.status.roundState || 'none';
  refs.eventName.textContent = vm.eventName || t('app.title');
  const fade = (key) => (effects.live && changed.has(key) ? 'm-fade' : null);
  mount(refs.header, renderStatus());
  const f = formatDashboard(vm.insights);
  mount(refs.main, h('div', { class: 'dash' },
    renderKpis(vm, { fade }),
    h('section', { class: 'explore', 'aria-label': t('stage.insights') },
      h('div', { class: 'explore__side' },
        h('div', { class: 'explore__cards', role: 'tablist', 'aria-label': t('stage.insights'), 'aria-orientation': 'vertical', onKeydown: onCardKey }, ...PANELS.map((key) => renderCard(key))),
        // D-48: the participants live on the big floating screen (the Galaxy); the stage itself stays aggregate-only
        h('a', { class: 'explore__galaxy', href: '/public', target: '_blank', rel: 'noopener' }, tx('stage.seeParticipants'), h('span', { 'aria-hidden': 'true' }, ' \u2197'))),
      h('div', { class: ['explore__panel', 'card', fade('insights')], role: 'tabpanel', id: 'explore-panel', 'aria-labelledby': `card-${dash.selected}` }, renderPanel(dash.selected, f)))));
  clipPartialRows(refs.root);
  for (const el of refs.root.querySelectorAll('.m-fade, .m-winner-burst')) {
    for (const cls of ['m-fade', 'm-winner-burst']) if (el.classList.contains(cls)) { el.classList.remove(cls); animateOnce(el, cls, { durationMs: cls === 'm-winner-burst' ? MOTION.durations.celebrate : MOTION.durations.base }); }
  }
}

function select(key, { focus = false } = {}) {
  if (!PANELS.includes(key) || !dash.refs || !dash.args) return;
  dash.selected = key;
  renderDashboard(dash.refs, dash.args.vm, { ...dash.args, effects: {} });
  if (focus) { const el = document.getElementById(`card-${key}`); if (el) el.focus(); }
}
function onCardKey(e) {
  const i = PANELS.indexOf(dash.selected);
  const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: PANELS.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  select(PANELS[(next + PANELS.length) % PANELS.length], { focus: true });
}

/** Everything the cards and panels need, from the stage insights block (pure reshaping). */
export function formatDashboard(insights) {
  const i = insights || {};
  const rank = (list) => { const rows = (Array.isArray(list) ? list : []).filter((r) => r && r.name).map((r) => ({ name: String(r.name), count: Number(r.count) || 0 })); rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)); const max = rows.reduce((m, r) => Math.max(m, r.count), 0); return rows.map((r, k) => ({ ...r, rank: k + 1, pct: max ? Math.round((r.count / max) * 100) : 0 })); };
  const eng = (list) => { const rows = formatEngagement(list, { limit: 50 }); const max = rows.reduce((m, r) => Math.max(m, r.joined), 0); return rows.map((r, k) => ({ ...r, rank: k + 1, pct: max ? Math.round((r.joined / max) * 100) : 0 })); };
  const a = i.matrixAlignment || null;
  const rate = a && Number.isFinite(Number(a.rate)) && a.rate !== null ? Number(a.rate) : null;
  return {
    hasData: Boolean(insights),
    platforms: eng(i.platformEngagement), roles: eng(i.roleEngagement),
    topSkills: rank(i.topSkills), coreSkills: rank(i.topCoreSkills),
    matrix: { rate, percent: rate === null ? '' : formatPercent(rate), participants: Number(a?.participants) || 0, distribution: Array.isArray(a?.distribution) ? a.distribution.map((n) => Number(n) || 0) : null, version: a?.matrixVersion || '' },
    suppressedCohorts: Number(i.suppressedCohorts) || 0,
  };
}

const CARD_TITLE = { platforms: 'stage.platforms', roles: 'stage.roles', topSkills: 'stage.topSkills', coreSkills: 'stage.coreSkills', matrix: 'stage.matrix' };
function renderCard(key) {
  const on = dash.selected === key;
  return h('button', {
    type: 'button', role: 'tab', id: `card-${key}`, class: ['insight-card', on ? 'is-on' : null], 'aria-selected': on ? 'true' : 'false',
    'aria-controls': 'explore-panel', tabindex: on ? '0' : '-1', onClick: () => select(key),
  },
    h('span', { class: 'insight-card__title' }, tx(CARD_TITLE[key])),
    h('span', { class: 'insight-card__chev', 'aria-hidden': 'true' }, '\u203A'));
}

function renderPanel(key, f) {
  const title = h('h2', { class: 'panel__title' }, tx(CARD_TITLE[key]));
  if (!f.hasData) return [title, h('p', { class: 'muted panel__empty' }, tx('stage.noInsights'))];
  if (key === 'matrix') return [title, renderMatrix(f.matrix)];
  const rows = f[key];
  if (!rows.length) return [title, h('p', { class: 'muted panel__empty' }, key === 'platforms' || key === 'roles' ? tx('stage.noCohorts') : tx('stage.noInsights'))];
  const isEng = key === 'platforms' || key === 'roles';
  return [title,
    h('ol', { class: 'bar-list', role: 'list' }, ...rows.map((r) => h('li', { class: ['bar-row', r.rank <= 3 ? `bar-row--r${r.rank}` : null] },
      h('div', { class: 'bar-row__top' },
        h('span', { class: 'bar-row__rank tabular', 'aria-hidden': 'true' }, String(r.rank)),
        h('span', { class: 'bar-row__name' }, r.name),
        h('span', { class: 'bar-row__count tabular' }, formatInt(isEng ? r.joined : r.count))),
      h('span', { class: 'bar-row__bar', 'aria-hidden': 'true' }, h('span', { class: 'bar-row__fill', style: { width: `${r.pct}%` } }))))),
  ];
}

/** Donut of the average match plus a bar chart of boards by matched count (0-16). SVG built with dom.h (no innerHTML). */
function renderMatrix(m) {
  if (m.rate === null) return h('p', { class: 'muted panel__empty' }, tx('stage.noInsights'));
  const R = 70, C = 2 * Math.PI * R, pct = Math.max(0, Math.min(1, m.rate));
  const donut = h('svg', { class: 'matrix__donut', viewBox: '0 0 180 180', role: 'img', 'aria-label': `${m.percent} ${tx('stage.matrix.avg')}` },
    h('circle', { cx: 90, cy: 90, r: R, class: 'matrix__track' }),
    h('circle', { cx: 90, cy: 90, r: R, class: 'matrix__arc', 'stroke-dasharray': `${(C * pct).toFixed(1)} ${C.toFixed(1)}`, transform: 'rotate(-90 90 90)' }),
    h('text', { x: 90, y: 88, class: 'matrix__pct', 'text-anchor': 'middle' }, m.percent),
    h('text', { x: 90, y: 116, class: 'matrix__cap', 'text-anchor': 'middle' }, tx('stage.matrix.avg')));
  const parts = [h('div', { class: 'matrix__hero' }, donut, h('p', { class: 'matrix__meta tabular' }, tx('stage.matrix.players', { count: formatInt(m.participants) })))];
  if (m.distribution) {
    const max = Math.max(1, ...m.distribution);
    const W = 17 * 34, H = 200;
    const bars = m.distribution.map((n, k) => {
      const bh = Math.round((n / max) * (H - 40));
      return h('g', null,
        h('rect', { x: k * 34 + 5, y: H - 24 - bh, width: 24, height: Math.max(bh, n ? 3 : 0), rx: 5, class: 'matrix__bar' }),
        n ? h('text', { x: k * 34 + 17, y: H - 30 - bh, class: 'matrix__n', 'text-anchor': 'middle' }, String(n)) : null,
        h('text', { x: k * 34 + 17, y: H - 4, class: 'matrix__k', 'text-anchor': 'middle' }, String(k)));
    });
    parts.push(h('figure', { class: 'matrix__hist' },
      h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': tx('stage.matrix.axis') }, ...bars),
      h('figcaption', { class: 'matrix__axis' }, tx('stage.matrix.axis'))));
  } else {
    parts.push(h('p', { class: 'muted matrix__wait' }, tx('stage.matrix.wait')));
  }
  return h('div', { class: 'matrix' }, ...parts);
}

function renderStatus() {
  // D-48: the header is the sign only; round state, hero text and hints are not shown on the stage any more.
  return [h('h1', { class: 'visually-hidden', id: 'status-title' }, t('app.title')),
    h('img', { class: 'status__logo', src: '/play/art/ariskill-sign.webp', alt: t('app.title'), width: '360', height: '180' })];
}


function renderKpis(vm, { fade }) {
  const kpi = (key, value) => h('div', { class: ['kpi', `kpi--${key}`, fade(`count.${key}`)] },
    h('span', { class: 'kpi__value tabular' }, formatInt(value)),
    h('span', { class: 'kpi__label' }, tx(`stage.kpi.${key}`)));
  return h('section', { class: 'kpis', 'aria-label': t('stage.participation') },
    kpi('rounds', vm.roundsPlayed), kpi('participants', vm.insights?.totals?.participants ?? vm.counts.joined), kpi('completed', vm.insights?.totals?.completed ?? vm.counts.completed));
}


/** Lists that may lose trailing rows when space runs out. Winner lists are never in this set (S-03: names must not be clipped). */
export const CLIP_LIST_SELECTOR = '.bar-list';

/** Lists that must never scroll (1080p, no overflow): hide rows that would be cut in half instead of clipping mid-row. */
export function clipPartialRows(root) {
  for (const list of root.querySelectorAll(CLIP_LIST_SELECTOR)) {
    const card = list.closest('.card') || list.parentElement;
    const cardBox = card.getBoundingClientRect();
    const limit = cardBox.bottom - (parseFloat(getComputedStyle(card).paddingBottom) || 0);
    const bottom = Math.min(list.getBoundingClientRect().bottom, limit);
    let visible = 0;
    for (const row of list.children) {
      row.hidden = false;
      if (row.getBoundingClientRect().bottom > bottom + 1) row.hidden = true; else visible++;
    }
    const title = list.previousElementSibling;
    if (title && title.classList.contains('draw__list-title')) title.hidden = visible === 0 || title.getBoundingClientRect().bottom > limit + 1;
  }
}

/** Cheap per-tick updates (countdown, staleness) without re-rendering tiles. */
export function tick(refs, vm, { nowMs, synced }) {
  for (const el of refs.root.querySelectorAll('[data-countdown]')) el.textContent = synced ? formatCountdown(el.dataset.countdown, nowMs) : t('syncing');
}

export function announceDraw(hero) {
  if (!hero || hero.kind !== 'draw') return;
  announce(`${t('public.playing.draw', { number: hero.number })}: ${hero.skillName}${hero.skillKind ? ` (${hero.skillKind})` : ''}`, { politeness: 'polite' });
}
export function announceWinners(vm) {
  const rows = winnerRows(vm.winners.list);
  const labels = rows.map((w) => w.label ?? t('public.winner.anonymous', { id: w.shortId })).join(', ');
  announce(`${t('public.winner.title')} ${labels}`.trim(), { politeness: 'polite' });
}
export function announceState(vm) {
  const rs = vm.status.focusState;
  if (rs) announce(`${t('public.winner.round', { number: vm.status.roundNumber ?? '' })} ${stateLabel(rs)}`.trim(), { politeness: 'polite' });
}
export { ageSeconds };
