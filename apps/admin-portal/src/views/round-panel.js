// Current round panel (A2.DRAFT ... A2.END). Pure render from the view-model; actions are injected callbacks.
import { h, setPending } from '/packages/ui/dom.js';
import { formatInt, formatTime } from '/packages/ui/format.js';
import { qrToSvg } from '/packages/ui/qr.js';
import { t, exceptionCopy } from '../copy.js';
import { statePill } from '../state.js';

function kindChip(kind) {
  const k = String(kind || '').toLowerCase();
  const cls = k === 'core' ? 'chip--core' : k === 'critical' ? 'chip--critical' : 'chip--optional';
  const icon = k === 'core' ? '◆' : k === 'critical' ? '●' : '○';
  return h('span', { className: ['chip', 'chip--static', cls] }, h('span', { 'aria-hidden': 'true' }, icon), ' ', h('span', { className: 'chip__label' }, t(`adminLocal.kind.${k || 'optional'}`)));
}

function svgFromString(svgText) {
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const el = doc.documentElement;
    return el && el.nodeName.toLowerCase() === 'svg' ? document.importNode(el, true) : null;
  } catch { return null; }
}

function countdown(targetIso, { label, id }) {
  return h('div', { className: 'countdown-block' },
    h('div', { className: 'countdown__label muted', id: `${id}-label` }, label),
    h('div', { className: 'countdown countdown--sm tabular', dataset: { countdownTarget: targetIso }, 'aria-labelledby': `${id}-label`, role: 'timer' }, '--:--'));
}

function statTile(label, value, { id } = {}) {
  return h('div', { className: 'stat stat--compact', id },
    h('div', { className: 'stat__label' }, label),
    h('div', { className: 'stat__value tabular' }, value === null || value === undefined ? '–' : formatInt(value)));
}

export function renderCounts(counts, extra = {}) {
  const c = counts || {};
  const tiles = [
    ['adminLocal.counts.joined', c.joined], ['adminLocal.counts.completed', c.completed], ['adminLocal.counts.incomplete', c.incomplete],
    ['adminLocal.counts.active', c.active], ['adminLocal.counts.deferred', c.deferred], ['adminLocal.counts.matchedBoards', c.matchedBoards],
  ];
  if (extra.draws !== undefined) tiles.push(['adminLocal.counts.draws', extra.draws]);
  if (extra.poolRemaining !== undefined) tiles.push(['adminLocal.counts.poolRemaining', extra.poolRemaining]);
  return h('div', { className: 'grid grid--auto counts-grid', role: 'list', 'aria-label': t('stage.participation') },
    tiles.map(([k, v]) => h('div', { role: 'listitem' }, statTile(t(k), v))));
}

function readinessPanel(vm) {
  const r = vm.readiness;
  const items = [
    h('li', { className: r.poolSize < r.poolMinimum ? 'is-warning' : 'is-ok' }, h('span', { 'aria-hidden': 'true' }, r.poolSize < r.poolMinimum ? '! ' : '✓ '), t('admin.readiness.pool', { count: formatInt(r.poolSize) })),
    h('li', { className: r.anyBoardCanWin ? 'is-ok' : 'is-warning' }, h('span', { 'aria-hidden': 'true' }, r.anyBoardCanWin ? '✓ ' : '! '), r.anyBoardCanWin ? t('admin.readiness.canWin', { count: formatInt(r.boardsThatCanWin) }) : t('admin.readiness.noneCanWin')),
  ];
  return h('section', { className: 'card card--flat stack stack--tight readiness', 'aria-labelledby': 'readiness-title' },
    h('h3', { id: 'readiness-title', className: 'section-title' }, t('stage.status')),
    h('ul', { className: 'readiness__list' }, items),
    vm.startBlockedException && h('p', { className: 'banner banner--warning', role: 'note' }, exceptionCopy(vm.startBlockedException)),
    vm.startOverdue && h('p', { className: 'banner banner--warning', role: 'note' }, t('admin.startOverdue')));
}

function joinPanel(join) {
  if (!join || !join.joinUrl) return null;
  const svg = svgFromString(qrToSvg(join.joinUrl, { size: 256, margin: 3, dark: '#000', light: '#fff', ariaLabel: t('adminLocal.joinLink') }));
  return h('section', { className: 'card card--flat stack stack--tight join-panel', 'aria-labelledby': 'join-title' },
    h('h3', { id: 'join-title', className: 'section-title' }, t('adminLocal.joinLink')),
    h('div', { className: 'qr' }, svg),
    h('p', { className: 'mono join-url' }, join.joinUrl),
    join.expiresAt && h('p', { className: 'muted' }, `${t('adminLocal.joinExpires')} ${new Date(join.expiresAt).toLocaleString()}`));
}

function drawList(vm) {
  if (!vm.draws.length) return h('p', { className: 'muted' }, t('adminLocal.noDraws'));
  return h('ol', { className: 'draw-list', 'aria-label': t('adminLocal.draws'), reversed: true },
    vm.draws.map((d, i) => h('li', { className: ['draw-list__item', 'draw-row', i === 0 ? 'is-latest' : null], dataset: { drawNumber: d.number } },
      h('span', { className: 'draw-row__number tabular' }, `#${d.number}`),
      h('span', { className: 'draw-row__name' }, d.skill?.name || d.skill?.id || ''),
      kindChip(d.skill?.kind),
      h('span', { className: 'draw-row__matched tabular muted' }, t('adminLocal.matchedOnDraw', { count: formatInt(d.matchedBoards ?? 0) })))));
}

function winnersPanel(vm, state) {
  const list = vm.winners.length ? h('ul', { className: 'winner-list' }, vm.winners.map((w) => h('li', null,
    h('strong', null, w.label || w.participantId),
    ' · ', t('adminLocal.winningDraw', { draw: w.winningDrawNumber }),
    ' · ', t('adminLocal.lines', { lines: (w.lineIds || []).join(', ') || '–' })))) : h('p', { className: 'muted' }, t('adminLocal.loading'));
  const window_ = vm.phase !== 'WINNER' ? null : state.resultWindowEndsAt
    ? countdown(state.resultWindowEndsAt, { label: t('adminLocal.resultWindowEnds'), id: 'result-window' })
    : h('p', { className: 'muted' }, t('adminLocal.resultWindowAuto', { seconds: vm.summary.resultWindowSeconds }));
  return h('section', { className: 'card card--flat stack stack--tight', 'aria-labelledby': 'winners-title' },
    h('h3', { id: 'winners-title', className: 'section-title' }, `${t('result.bingo')} · ${t('adminLocal.winners')} (${vm.winners.length})`),
    list, window_);
}

/**
 * renderRoundPanel(state, vm, ctx)
 * ctx: { actions: {...}, pendingCommand, drawResultText }
 */
export function renderRoundPanel(state, vm, ctx) {
  const { actions, pendingCommand } = ctx;
  if (vm.phase === 'none') {
    return h('section', { className: 'card stack', 'aria-labelledby': 'round-panel-title' },
      h('h2', { id: 'round-panel-title' }, t('adminLocal.currentRound')),
      h('p', { className: 'muted' }, t('adminLocal.noCurrentRound')));
  }
  const s = vm.summary; const cur = state.currentRound;
  const busy = (cmd) => pendingCommand === cmd;
  const anyPending = !!pendingCommand;
  const btn = (label, cmd, onClick, { kind = 'btn--primary', disabled = false, describedBy = null, id = null } = {}) => {
    const el = h('button', { className: ['btn', kind], type: 'button', id, onClick, disabled: disabled || (anyPending && !busy(cmd)), 'aria-describedby': describedBy || undefined, dataset: { command: cmd } }, h('span', null, label));
    if (busy(cmd)) setPending(el, true);
    return el;
  };

  const header = h('div', { className: 'cluster cluster--between round-head' },
    h('div', { className: 'stack stack--tight' },
      h('h2', { id: 'round-panel-title' }, `${t('adminLocal.round')} ${s.number} · ${s.title}`),
      h('div', { className: 'cluster' },
        h('span', { className: ['pill', statePill(s.state)] }, s.state),
        h('span', { className: 'muted tabular' }, `${t('adminLocal.version')} ${s.version}`),
        s.lockAt && h('span', { className: 'muted' }, `${t('adminLocal.lockAt')}: ${formatTime(s.lockAt)}`),
        cur.lastCommand && h('span', { className: 'muted' }, `${t('adminLocal.lastCommand')}: ${cur.lastCommand.command} · ${t(`adminLocal.${cur.lastCommand.outcome}`)}`))));

  const sections = [header];
  sections.push(renderCounts(cur.counts, s.state === 'WINNER' || s.state === 'EXHAUSTED' ? { draws: cur.draws.length, poolRemaining: vm.poolRemaining } : {}));

  const controls = [];
  switch (vm.phase) {
    case 'DRAFT':
      controls.push(btn(t('adminLocal.edit'), 'round.update', actions.edit, { kind: 'btn--ghost' }));
      controls.push(btn(t('admin.openRegistration'), 'round.registration.open', actions.openRegistration));
      break;
    case 'REGISTRATION_OPEN':
      sections.push(h('div', { className: 'grid grid--2 open-grid' },
        joinPanel(state.join),
        h('div', { className: 'stack' },
          vm.showLockCountdown && countdown(s.lockAt, { label: t('admin.lockCountdown'), id: 'lock-countdown' }),
          readinessPanel(vm))));
      // Safe default first and primary; the irreversible Lock now / Start now are ghost and confirmed (UX-03).
      controls.push(btn(t('adminLocal.reschedule'), 'round.reschedule', actions.reschedule));
      controls.push(btn(t('admin.lockNow'), 'round.lock', actions.lockNow, { kind: 'btn--ghost' }));
      controls.push(btn(t('admin.startNow'), 'round.start_now', actions.startNow, { kind: 'btn--ghost' }));
      break;
    case 'LOCKED':
      sections.push(readinessPanel(vm));
      controls.push(btn(t('admin.start'), 'round.start', actions.start, { disabled: !vm.controls.startEnabled, describedBy: vm.startBlockedException ? 'start-blocked-note' : null }));
      if (vm.startBlockedException) sections.push(h('p', { id: 'start-blocked-note', className: 'visually-hidden' }, exceptionCopy(vm.startBlockedException)));
      break;
    case 'PLAYING': {
      const nextBtn = btn(t('admin.nextSkill'), 'round.draw.next', actions.nextSkill, { kind: 'btn--primary btn--lg next-skill', describedBy: 'pacing-hint', id: 'next-skill' });
      sections.push(h('section', { className: 'card next-skill-card stack', 'aria-labelledby': 'draw-title' },
        h('h3', { id: 'draw-title', className: 'visually-hidden' }, t('admin.nextSkill')),
        h('p', { className: 'draw-summary tabular' },
          `${t('adminLocal.counts.draws')} ${formatInt(cur.draws.length)} · ${t('adminLocal.counts.poolRemaining')} ${vm.poolRemaining === null ? '–' : formatInt(vm.poolRemaining)} · ${t('adminLocal.counts.matchedBoards')} ${formatInt(cur.counts.matchedBoards ?? 0)}`,
          state.boardsWithFourInLine !== null && state.boardsWithFourInLine !== undefined ? ` · ${t('adminLocal.boardsFourInLine', { count: formatInt(state.boardsWithFourInLine) })}` : ''),
        h('div', { className: 'cluster next-skill-row' },
          nextBtn,
          h('div', { className: 'stack stack--tight' },
            h('p', { id: 'pacing-hint', className: 'muted' }, t('admin.pacingHint')),
            h('p', { className: 'command-status', role: 'status', dataset: { commandStatus: '' } }, busy('round.draw.next') ? t('admin.nextSkillPending') : (ctx.drawResultText || ''))))));
      sections.push(h('section', { className: 'stack stack--tight', 'aria-labelledby': 'draws-title' },
        h('h3', { id: 'draws-title', className: 'section-title' }, t('adminLocal.draws')), drawList(vm)));
      break;
    }
    case 'WINNER':
      sections.push(winnersPanel(vm, state));
      sections.push(h('section', { className: 'stack stack--tight', 'aria-labelledby': 'draws-title' },
        h('h3', { id: 'draws-title', className: 'section-title' }, t('adminLocal.draws')), drawList(vm)));
      break;
    case 'EXHAUSTED':
      sections.push(h('p', { className: 'banner banner--warning', role: 'note' }, `${exceptionCopy('E23')} ${exceptionCopy('E11')}`));
      sections.push(h('section', { className: 'stack stack--tight', 'aria-labelledby': 'draws-title' },
        h('h3', { id: 'draws-title', className: 'section-title' }, t('adminLocal.draws')), drawList(vm)));
      controls.push(btn(t('admin.close'), 'round.close', actions.close));
      break;
    case 'CLOSED':
    case 'CANCELLED':
      if (s.cancellationReason) sections.push(h('p', { className: 'banner banner--danger', role: 'note' }, t('adminLocal.cancelledReason', { reason: s.cancellationReason })));
      if (vm.winners.length) sections.push(winnersPanel(vm, state));
      controls.push(h('button', { className: 'btn btn--primary', type: 'button', onClick: actions.createNext }, t('adminLocal.createNext')));
      break;
    default:
      break;
  }
  if (vm.controls.cancel) controls.push(btn(t('admin.cancel'), 'round.cancel', actions.cancel, { kind: 'btn--danger btn--cancel' }));
  if (controls.length) {
    const row = h('div', { className: 'cluster round-actions', role: 'group', 'aria-label': t('adminLocal.currentRound') }, controls);
    if (vm.phase === 'PLAYING') sections.push(row); else sections.splice(1, 0, row);
  }

  return h('section', { className: ['card', 'stack', 'round-panel', `is-${vm.phase.toLowerCase()}`], 'aria-labelledby': 'round-panel-title', dataset: { phase: vm.phase } }, sections);
}
