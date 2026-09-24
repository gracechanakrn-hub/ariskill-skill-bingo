// Stage dashboard - DOM tiles. Read-only; renders from the data-only view model (state.js deriveView) and the
// insight formatters (insights.js). All text goes through textContent via dom.h (never innerHTML with server
// strings, T13). Copy comes from packages/contracts (t / exception); keys the catalog does not have yet fall back
// to FALLBACK_COPY below and are listed for the copy owner in README.md.
import { h, mount, announce } from '/packages/ui/dom.js';
import { formatCountdown } from '/packages/ui/clock-sync.js';
import { formatInt } from '/packages/ui/format.js';
import { animateOnce, MOTION } from '/packages/ui/motion.js';
import { t, exception, COPY } from '/packages/contracts/index.js';
import { formatInsights, formatClock, kindIcon, winnerRows, winnerDisplayRows, ageSeconds } from './insights.js';

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

function kindBadge(kind, { size = 'md' } = {}) {
  if (!kind) return null;
  const k = kindIcon(kind);
  return h('span', { class: `kind ${k.className} kind--${size}` }, h('span', { class: 'kind__glyph', 'aria-hidden': 'true' }, k.glyph), h('span', { class: 'kind__label' }, String(kind)));
}

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
  const shell = h('div', { class: 'stage' },
    h('header', { class: 'stage__status', 'aria-label': t('stage.status'), ref: (el) => { refs.header = el; } }),
    h('main', { id: 'main', class: 'stage__main', tabindex: '-1', ref: (el) => { refs.main = el; } }),
    h('footer', { class: 'stage__footer' },
      h('div', { class: 'footer__left' },
        h('span', { class: 'footer__event', ref: (el) => { refs.eventName = el; } }, t('app.title')),
        h('span', { class: 'pill footer__conn', ref: (el) => { refs.conn = el; } }, h('span', { class: 'footer__conn-text', ref: (el) => { refs.connText = el; } }, tx('stage.connecting')))),
      h('p', { class: 'footer__caption', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', ref: (el) => { refs.caption = el; } }),
      h('div', { class: 'footer__controls' },
        soundBtn,
        h('label', { class: 'ctl ctl--range', for: 'stage-volume' }, h('span', { class: 'ctl__label' }, tx('stage.volume')), volumeInput),
        rmBtn)));
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
// Dashboard
// ---------------------------------------------------------------------------------------------------------------
/**
 * renderDashboard(refs, vm, { changed, effects, nowMs, synced })
 *  changed: Set from state.changedTiles (tiles get .m-fade when the change came from a live event)
 *  effects: { live: bool, drawArrival: bool, winnerBurst: bool } (already gated by the celebration guard)
 */
export function renderDashboard(refs, vm, { changed = new Set(), effects = {}, nowMs = Date.now(), synced = true } = {}) {
  refs.root.dataset.layout = vm.layout;
  refs.root.dataset.roundState = vm.status.roundState || 'none';
  refs.eventName.textContent = vm.eventName || t('app.title');
  const fade = (key) => (effects.live && changed.has(key) ? 'm-fade' : null);

  mount(refs.header, renderStatus(vm, { nowMs, synced, fadeClass: fade('status') }));
  const parts = [renderParticipation(vm, { fade })];
  if (vm.layout === 'live') {
    parts.push(h('div', { class: 'live' },
      h('div', { class: 'live__left' },
        vm.status.roundState === 'WINNER' || vm.winners.list.length ? renderWinners(vm, { fadeClass: fade('winners'), burst: effects.winnerBurst }) : null,
        renderDrawTile(vm, { fadeClass: fade('draw'), arrival: effects.drawArrival })),
      renderInsights(vm, { fadeClass: fade('insights') })));
  } else {
    parts.push(renderInsights(vm, { fadeClass: fade('insights') }));
  }
  mount(refs.main, parts);
  clipPartialRows(refs.root);
  // One-shot classes were added at creation; clean them up so a later re-render can replay them.
  for (const el of refs.root.querySelectorAll('.m-fade, .m-draw-arrival, .m-winner-burst')) {
    for (const cls of ['m-fade', 'm-draw-arrival', 'm-winner-burst']) if (el.classList.contains(cls)) { el.classList.remove(cls); animateOnce(el, cls, { durationMs: cls === 'm-winner-burst' ? MOTION.durations.celebrate : cls === 'm-draw-arrival' ? MOTION.interactions.drawArrival.ms : MOTION.durations.base }); }
  }
}

function renderStatus(vm, { nowMs, synced, fadeClass }) {
  const s = vm.status;
  const rs = s.focusState;
  const meta = STATE_META[rs] || null;
  const number = s.roundNumber;
  const title = s.roundTitle || '';
  const roundLabel = number !== null ? t('public.winner.round', { number }) : '';
  const showTitle = title && title.trim().toLowerCase() !== roundLabel.toLowerCase();
  const left = h('div', { class: 'status__left' },
    h('p', { class: 'status__eyebrow' }, s.isNextRound ? t('public.waiting.title') : t('stage.status')),
    h('div', { class: 'status__row' },
      h('h1', { class: 'status__title', id: 'status-title' }, number !== null ? [h('span', { class: 'status__round tabular sk-medallion', dataset: { number } }, roundLabel), showTitle ? h('span', { class: 'status__sep', 'aria-hidden': 'true' }, ' \u00B7 ') : null, showTitle ? h('span', { class: 'status__name' }, title) : null] : t('app.title')),
      rs ? h('span', { class: ['pill', 'status__pill', meta ? meta.pill : ''] }, icon(meta ? meta.icon : 'ring', { size: 36 }), h('span', null, stateLabel(rs))) : null));
  const right = h('div', { class: ['status__hero', `status__hero--${s.hero.kind}`, fadeClass] }, ...renderHero(s.hero, { nowMs, synced }), vm.layout === 'insights' && vm.winners.list.length ? renderWinnersLine(vm) : null);
  return [left, right];
}

function renderHero(hero, { nowMs, synced }) {
  switch (hero.kind) {
    case 'countdown':
      return [h('span', { class: 'hero__label' }, t('admin.lockCountdown')), h('span', { class: 'hero__numeral countdown tabular', dataset: { countdown: hero.target }, 'aria-live': 'off' }, synced ? formatCountdown(hero.target, nowMs) : t('syncing'))];
    case 'scheduled':
      return [h('span', { class: 'hero__text' }, hero.target ? tx('stage.locksAt', { time: formatClock(hero.target).slice(0, 5) }) : t('board.noRound'))];
    case 'locked':
      return [h('span', { class: 'hero__text' }, icon('lock', { size: 44 }), t('play.waitingStart')), hero.startOverdue ? h('span', { class: 'hero__hint' }, t('admin.startOverdue')) : null];
    case 'draw':
      return [h('span', { class: 'hero__draw' }, h('span', { class: 'hero__numeral hero__numeral--draw tabular' }, t('public.playing.draw', { number: hero.number })), h('span', { class: 'hero__skill' }, hero.skillName), kindBadge(hero.skillKind, { size: 'lg' }))];
    case 'waitingDraw':
      return [h('span', { class: 'hero__text' }, tx('stage.waitingDraw'))];
    case 'result':
      return [h('span', { class: 'hero__bingo' }, icon('star', { size: 64 }), t('public.winner.title')), h('span', { class: 'hero__hint tabular' }, [t('result.bingo'), hero.winningDrawNumber !== null ? ` · ${t('public.playing.draw', { number: hero.winningDrawNumber })}` : '', hero.publishedAt ? ` · ${formatClock(hero.publishedAt)}` : ''].join(''))];
    case 'notice':
      return [h('span', { class: 'hero__text hero__text--notice' }, icon(hero.notice === 'cancelled' ? 'cross' : 'check', { size: 44 }), hero.text || (hero.notice === 'cancelled' ? t('public.cancelled') : t('public.exhausted')))];
    case 'closed':
      return [h('span', { class: 'hero__text' }, exception('E1').copy)];
    case 'none':
    default:
      return [h('span', { class: 'hero__text' }, exception('E1').copy)];
  }
}

const COUNT_KEYS = ['joined', 'completed', 'incomplete', 'active', 'deferred', 'matchedBoards'];
function renderParticipation(vm, { fade }) {
  return h('section', { class: 'tiles', 'aria-label': t('stage.participation') },
    h('h2', { class: 'visually-hidden' }, t('stage.participation')),
    ...COUNT_KEYS.map((k) => h('div', { class: ['stat', 'tile', `tile--${k}`, fade(`count.${k}`)] },
      h('span', { class: 'stat__label tile__label' }, tx(`stage.count.${k}`)),
      h('span', { class: 'stat__value tile__value tabular' }, formatInt(vm.counts[k])))));
}

function renderDrawTile(vm, { fadeClass, arrival }) {
  const cur = vm.draw.current;
  const pacing = vm.draw.pacing === 'live' ? t('public.playing.live') : t('public.playing.pacing');
  const compact = vm.status.roundState === 'WINNER'; // winners own the left column; the last draw becomes a one-line card so recent draws stay visible
  return h('section', { class: ['card', 'draw', compact ? 'draw--compact' : null, arrival ? 'm-draw-arrival' : fadeClass], 'aria-labelledby': 'draw-title' },
    cur ? h('div', { class: ['draw-card', 'draw__current', 'sk-card', cur.skill?.kind === 'Core' ? 'draw-card--core' : cur.skill?.kind === 'Critical' ? 'draw-card--critical' : null] },
      h('h2', { class: 'draw__number tabular', id: 'draw-title' }, t('public.playing.draw', { number: cur.number })),
      h('p', { class: 'draw__name' }, cur.skill?.name ?? ''),
      h('p', { class: 'draw__meta' }, kindBadge(cur.skill?.kind, { size: 'md' }), h('span', { class: ['draw__pacing', vm.draw.pacing === 'live' ? 'draw__pacing--live' : null] }, pacing)),
      h('p', { class: 'draw__matched tabular' }, t('public.playing.matched', { count: formatInt(vm.draw.matchedBoards) })))
    : h('div', { class: 'draw__current draw__current--empty' }, h('h2', { class: 'draw__number', id: 'draw-title' }, tx('stage.recentDraws')), h('p', { class: 'draw__name muted' }, tx('stage.waitingDraw'))),
    h('h3', { class: 'draw__list-title' }, tx('stage.recentDraws')),
    vm.draw.recent.length ? h('ol', { class: 'draw-list draw__list', role: 'list', reversed: true } ,
      ...vm.draw.recent.map((d) => h('li', { class: ['draw-list__item', 'draw__item', d.number === cur?.number ? 'is-current' : null] },
        h('span', { class: 'draw__item-number tabular' }, String(d.number)),
        h('span', { class: 'draw__item-name' }, d.skillName),
        kindBadge(d.kind, { size: 'sm' }))))
    : null);
}

function renderWinners(vm, { fadeClass, burst }) {
  const { rows, more, dense } = winnerDisplayRows(vm.winners.list);
  const timing = vm.winners.timing;
  return h('section', { class: ['card', 'winners', 'sk-card', dense ? 'winners--dense' : null, burst ? 'm-winner-burst' : fadeClass], 'aria-labelledby': 'winners-title' },
    h('h2', { class: 'winners__title', id: 'winners-title' }, icon('star', { size: 44 }), t('public.winner.title'), vm.winners.roundNumber !== null ? h('span', { class: 'winners__round tabular' }, ` \u00B7 ${t('public.winner.round', { number: vm.winners.roundNumber })}`) : null),
    rows.length ? h('ul', { class: 'winners__list', role: 'list' }, ...rows.map((w) => h('li', { class: 'winners__item' },
      h('span', { class: 'winners__label' }, w.label ?? t('public.winner.anonymous', { id: w.shortId })),
      w.winningDrawNumber !== null ? h('span', { class: 'winners__draw tabular' }, t('public.playing.draw', { number: w.winningDrawNumber })) : null)))
    : h('p', { class: 'winners__empty muted' }, tx('stage.noWinners')),
    more > 0 ? h('p', { class: 'winners__more tabular' }, tx('stage.moreWinners', { count: more })) : null,
    timing.publishedAt ? h('p', { class: 'winners__timing tabular' }, tx('stage.publishedAt', { time: formatClock(timing.publishedAt) })) : null);
}

function renderWinnersLine(vm) {
  const rows = winnerRows(vm.winners.list);
  const names = rows.map((w) => `${w.label ?? t('public.winner.anonymous', { id: w.shortId })}${w.winningDrawNumber !== null ? ` (${t('public.playing.draw', { number: w.winningDrawNumber })})` : ''}`).join(', ');
  return h('span', { class: 'hero__hint hero__winners' }, icon('star', { size: 30 }), h('span', { class: 'hero__winners-text' }, `${t('public.waiting.previous')}${vm.winners.roundNumber !== null ? ` \u00B7 ${t('public.winner.round', { number: vm.winners.roundNumber })}` : ''}: ${names}`));
}

function renderInsights(vm, { fadeClass }) {
  const f = formatInsights(vm.insights, { layout: vm.layout });
  const panel = (key, titleText, body, extraClass = null) => h('section', { class: ['card', 'panel', `panel--${key}`, extraClass], 'aria-labelledby': `panel-${key}` }, h('h3', { class: 'panel__title', id: `panel-${key}` }, titleText), body);
  if (!f.hasData) return h('section', { class: ['insights', 'insights--empty', fadeClass], 'aria-label': t('stage.insights') }, h('h2', { class: 'visually-hidden' }, t('stage.insights')), h('p', { class: 'insights__empty muted' }, tx('stage.noInsights')));

  const skillRow = (r, withKind) => h('li', { class: ['bar-row', r.rank <= 3 ? `bar-row--r${r.rank}` : null] },
    h('div', { class: 'bar-row__top' },
      h('span', { class: 'bar-row__rank tabular', 'aria-hidden': 'true' }, String(r.rank)),
      h('span', { class: 'bar-row__name' }, withKind && r.kind ? [h('span', { class: `kind__glyph ${kindIcon(r.kind).className}`, 'aria-hidden': 'true' }, kindIcon(r.kind).glyph), ' ', r.name] : r.name),
      withKind && r.kind ? h('span', { class: 'visually-hidden' }, String(r.kind)) : null,
      h('span', { class: 'bar-row__count tabular' }, formatInt(r.count))),
    h('span', { class: 'bar-row__bar', 'aria-hidden': 'true' }, h('span', { class: ['bar-row__fill', r.kind ? kindIcon(r.kind).className : null], style: { width: `${r.pct}%` } })));

  const topSkills = panel('top', tx('stage.topSkills'), f.topSkills.length ? h('ol', { class: 'bar-list', role: 'list' }, ...f.topSkills.map((r) => skillRow(r, true))) : h('p', { class: 'muted panel__empty' }, tx('stage.noInsights')));

  const density = panel('density', tx('stage.density'), h('div', { class: 'density' },
    ...f.density.bars.map((b) => h('div', { class: 'density__row' },
      h('span', { class: `density__label kind ${b.icon.className}` }, h('span', { class: 'kind__glyph', 'aria-hidden': 'true' }, b.icon.glyph), h('span', null, b.kind)),
      h('span', { class: 'density__bar', 'aria-hidden': 'true' }, h('span', { class: ['density__fill', b.icon.className], style: { width: `${b.pct}%` } })),
      h('span', { class: 'density__pct tabular' }, b.percentLabel || '0%'))),
    h('p', { class: 'panel__foot tabular' }, tx('stage.selections', { count: formatInt(f.density.total) }))));

  const alignment = panel('alignment', t('stage.alignment'), f.alignment
    ? h('div', { class: 'alignment' },
      h('div', { class: 'alignment__hero' }, h('span', { class: 'alignment__ring', 'aria-hidden': 'true', style: { '--pct': String(Math.min(100, Math.max(0, Math.round(f.alignment.rate * 100)))) } }), h('p', { class: 'alignment__rate tabular' }, f.alignment.percent)),
      h('p', { class: 'alignment__meta tabular' }, tx('stage.participants', { count: formatInt(f.alignment.participants) })), f.alignment.matrixVersion ? h('p', { class: 'alignment__version' }, tx('stage.matrixVersion', { version: f.alignment.matrixVersion })) : null)
    : h('p', { class: 'muted panel__empty' }, tx('stage.noInsights')));

  const engagement = (key, titleText, rows) => panel(key, titleText, [
    rows.length ? h('ol', { class: 'eng', role: 'list' }, ...rows.map((r) => h('li', { class: 'eng-row' },
      h('span', { class: 'eng-row__name' }, r.name),
      h('span', { class: 'eng-row__meta tabular' }, `${tx('stage.eng.joined', { count: formatInt(r.joined) })} \u00B7 ${tx('stage.eng.completed', { count: formatInt(r.completed) })}`))))
    : h('p', { class: 'muted panel__empty' }, tx('stage.noCohorts')),
    f.suppressedCohorts > 0 ? h('p', { class: 'panel__foot panel__foot--suppressed' }, icon('leaf', { size: 30 }), h('span', null, `${t('stage.suppressed')} \u00B7 ${tx('stage.hiddenCohorts', { count: formatInt(f.suppressedCohorts) })}`)) : null,
  ]);

  const beyond = panel('beyond', t('stage.beyond'), f.beyond.length ? h('ol', { class: 'bar-list', role: 'list' }, ...f.beyond.map((r) => skillRow(r, false))) : h('p', { class: 'muted panel__empty' }, tx('stage.noInsights')));

  return h('section', { class: ['insights', f.compact ? 'insights--compact' : 'insights--full', fadeClass], 'aria-label': t('stage.insights') },
    h('h2', { class: 'visually-hidden' }, t('stage.insights')),
    topSkills,
    h('div', { class: 'insights__stack' }, density, alignment),
    engagement('platforms', tx('stage.platforms'), f.platforms),
    engagement('roles', tx('stage.roles'), f.roles),
    beyond);
}

/** Lists that may lose trailing rows when space runs out. Winner lists are never in this set (S-03: names must not be clipped). */
export const CLIP_LIST_SELECTOR = '.draw__list, .bar-list, .eng';

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
