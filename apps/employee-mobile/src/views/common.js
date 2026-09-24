// apps/employee-mobile/src/views/common.js - shared view helpers: copy access, kind chips, toasts, small builders.
import { h, setPending } from '/packages/ui/dom.js';
import { t, exception } from '/packages/contracts/index.js';
import { kindOf } from '../state.js';

/**
 * Local UI-chrome strings that packages/contracts/copy.json (locked, v1.0.0) does not define yet.
 * `tl()` asks the shared catalogue first, so any key added to copy.json later wins automatically.
 * Reported in the stage handoff as candidate keys for the content review (OD-11).
 */
export const LOCAL_COPY = Object.freeze({
  'ui.skip': 'Skip to content',
  'ui.settings': 'Display and sound',
  'ui.reducedMotion': 'Reduced motion',
  'ui.sound': 'Sound',
  'ui.on': 'On',
  'ui.off': 'Off',
  'ui.dismiss': 'Dismiss',
  'ui.retry': 'Try again',
  'ui.loading': 'Loading...',
  'ui.round': 'Round',
  'ui.locksIn': 'Locks in',
  'ui.locksAt': 'Locks at',
  'ui.nextRound': 'Next round',
  'ui.revealSoul': 'Reveal my Soul',
  'ui.skipReveal': 'Skip reveal',
  'ui.backToBoard': 'Back to my board',
  'ui.buildNext': 'Build my board for the next round',
  'ui.selected': 'Selected skills',
  'ui.noneSelected': 'No skills selected yet.',
  'ui.noResults': 'No skills match your search.',
  'ui.draws': 'Draws so far',
  'ui.noDraws': 'No skills drawn yet.',
  'ui.buildBoard': 'Build my board',
  'ui.kind.Core': 'Core',
  'ui.kind.Critical': 'Critical',
  'ui.kind.Optional': 'Optional',
  'ui.yourBoard': 'Your board',
  'ui.remove': 'Remove {name}',
  'ui.noLink': 'Open this page from the event QR code or join link.',
  'ui.consentNoName': 'You will appear as an anonymous Soul.',
  'ui.tabs': 'Skill discovery',
  'ui.matched': 'matched',
  'ui.draw': 'Draw',
  'ui.publicLabel': 'Shown on the public screen as: {label}',
  'ui.mission': 'Live multiplayer experience',
  'ui.joinLead': 'Choose your skills. Watch the draws align. Launch your unique Soul into the Arise Galaxy.',
  'ui.callsign': 'Player check-in',
});

export function tl(key, vars = {}) {
  const shared = t(key, vars);
  if (shared !== key) return shared;
  const raw = LOCAL_COPY[key];
  if (raw === undefined) return key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

/** Copy for an exception id, falling back to the message the server sent (already the E-copy for coded errors). */
export function exceptionCopy(id, fallback = '') {
  const ex = id ? exception(id) : null;
  return ex ? ex.copy : (fallback || '');
}

const KIND_ICON = { Core: '◆', Critical: '●', Optional: '○' }; // filled diamond, filled circle, outlined circle

/** Kind chip: icon + label + colour (never colour alone). */
export function kindChip(skill, { className = '' } = {}) {
  const kind = kindOf(skill);
  return h('span', { className: ['kind', `kind--${kind.toLowerCase()}`, className].filter(Boolean).join(' ') },
    h('span', { className: 'kind__icon', 'aria-hidden': 'true' }, KIND_ICON[kind]),
    h('span', { className: 'kind__label' }, tl(`ui.kind.${kind}`)));
}

export function kindClass(prefix, skill) {
  return `${prefix}--${kindOf(skill).toLowerCase()}`;
}

/** Section heading + content card. */
export function section(title, { level = 2, className = '', id } = {}, ...children) {
  const tag = `h${Math.min(6, Math.max(1, level))}`;
  return h('section', { className: ['card', 'stack', className].filter(Boolean).join(' '), 'aria-labelledby': id },
    title ? h(tag, { id, className: 'section__title' }, title) : null, ...children);
}

export function button(label, { variant = '', onClick, disabled = false, type = 'button', className = '', ...rest } = {}) {
  return h('button', { type, className: ['btn', variant ? `btn--${variant}` : '', className].filter(Boolean).join(' '), onClick, disabled, ...rest }, label);
}

export { setPending };

/** Round summary line: round-number medallion (sticker language) + "Round 2" for assistive tech, title, optional detail. */
export function roundLine(round, detail = null) {
  if (!round) return null;
  return h('p', { className: 'round-line' },
    h('span', { className: 'round-medallion', 'aria-hidden': 'true' }, h('span', { className: 'round-medallion__label' }, tl('ui.round')), h('span', { className: 'round-medallion__num' }, String(round.number))),
    h('span', { className: 'round-line__label visually-hidden' }, `${tl('ui.round')} ${round.number}`),
    round.title ? h('span', { className: 'round-line__title' }, round.title) : null,
    detail ? h('span', { className: 'round-line__detail muted' }, ` · ${detail}`) : null);
}

/** Small "notice" block (banner-like, in-flow) with an icon and copy. */
export function notice(text, { tone = 'info', role = 'status', extra = null } = {}) {
  return h('div', { className: `notice notice--${tone}`, role },
    h('span', { className: 'notice__icon', 'aria-hidden': 'true' }, tone === 'danger' ? '!' : tone === 'warning' ? '⚠︎' : 'i'),
    h('div', { className: 'notice__body' }, h('p', null, text), extra));
}

/** Next-round card + "Build my board" action, shown whenever a newer round accepts boards (UX-01), never gated by Float. */
export function nextRoundBlock(round, { onBuild, formatTime }) {
  if (!round) return null;
  return h('div', { className: 'card card--flat stack stack--tight next-round' },
    h('h2', { className: 'section__title' }, tl('ui.nextRound')),
    roundLine(round, round.lockAt && formatTime ? `${tl('ui.locksAt')} ${formatTime(round.lockAt)}` : null),
    button(tl('ui.buildNext'), { className: 'btn--block', onClick: onBuild }));
}

/** Empty / loading placeholder row. */
export function placeholder(text) {
  return h('p', { className: 'placeholder muted', role: 'status' }, text);
}
