// Current round panel (A2, D-53): Draft -> Registration open -> Playing -> Finished, plus Cancelled. One primary next step
// per status, Extend chips while open, the unfinished-boards alert, and Cancel / Delete. Pure render from the view-model.
import { h, setPending } from '/packages/ui/dom.js';
import { formatInt, formatTime } from '/packages/ui/format.js';
import { qrToSvg } from '/packages/ui/qr.js';
import { t } from '../copy.js';
import { STEPS, EXTEND_CHOICES } from '../state.js';

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
    ' · ', t('adminLocal.lines', { lines: (w.lineIds || []).join(', ') || '–' }),
    w.closest ? h('span', { className: 'muted' }, ` · ${t('adminLocal.mc.closest')}`) : null))) : h('p', { className: 'muted' }, t('adminLocal.loading'));
  const closest = vm.winners.some((w) => w.closest);
  const finishing = vm.phase === 'WINNER' && state.resultWindowEndsAt ? countdown(state.resultWindowEndsAt, { label: t('adminLocal.mc.finishingIn'), id: 'result-window' }) : null;
  return h('section', { className: 'card card--flat stack stack--tight winners-card', 'aria-labelledby': 'winners-title' },
    h('h3', { id: 'winners-title', className: 'section-title' }, t(closest ? 'adminLocal.mc.closestTitle' : 'adminLocal.mc.winnersTitle', { count: vm.winners.length })),
    list, finishing);
}

function progressSteps(vm) {
  const step = vm.status.step;
  return h('ol', { className: ['steps', vm.phase === 'CANCELLED' ? 'is-cancelled' : null], 'aria-label': t('adminLocal.mc.progress') },
    STEPS.map((label, i) => h('li', { className: ['steps__item', i < step ? 'is-done' : null, i === step ? 'is-current' : null], 'aria-current': i === step ? 'step' : undefined },
      h('span', { className: 'steps__dot', 'aria-hidden': 'true' }, i < step ? '✓' : String(i + 1)),
      h('span', { className: 'steps__label' }, label))));
}

function extendRow(actions, disabled, { id = 'extend', compact = false } = {}) {
  return h('div', { className: ['extend-row', compact ? 'extend-row--compact' : null], role: 'group', 'aria-label': t('adminLocal.mc.extendLabel'), id },
    h('span', { className: 'extend-row__label' }, t('adminLocal.mc.extend')),
    EXTEND_CHOICES.map((n) => h('button', { className: 'seg', type: 'button', disabled, dataset: { command: `extend-${n}-${id}` }, onClick: () => actions.extend(n) }, t('adminLocal.mc.extendBy', { n }))),
    h('button', { className: 'seg seg--link', type: 'button', disabled, dataset: { command: `pick-${id}` }, onClick: actions.pickTime }, t('adminLocal.mc.pickTime')));
}

function startLine(s) {
  if (s.state === 'DRAFT') return s.lockAt ? t('adminLocal.mc.startsAt', { time: formatTime(s.lockAt) }) : s.startInMinutes ? t('adminLocal.mc.startsIn', { n: s.startInMinutes }) : '';
  return '';
}

/**
 * renderRoundPanel(state, vm, ctx)
 * ctx: { actions: {...}, pendingCommand, drawResultText }
 */
export function renderRoundPanel(state, vm, ctx) {
  const { actions, pendingCommand } = ctx;
  if (vm.phase === 'none') {
    return h('section', { className: 'card stack empty-round', 'aria-labelledby': 'round-panel-title' },
      h('h2', { id: 'round-panel-title' }, t('adminLocal.currentRound')),
      h('p', { className: 'muted' }, t('adminLocal.mc.noRound')),
      h('div', null, h('button', { className: 'btn btn--primary btn--lg', type: 'button', onClick: actions.create }, t('adminLocal.mc.createRound'))));
  }
  const s = vm.summary; const cur = state.currentRound;
  const busy = (cmd) => pendingCommand === cmd;
  const anyPending = !!pendingCommand;
  const btn = (label, cmd, onClick, { kind = 'btn--primary', disabled = false, describedBy = null, id = null } = {}) => {
    const el = h('button', { className: ['btn', kind], type: 'button', id, onClick, disabled: disabled || (anyPending && !busy(cmd)), 'aria-describedby': describedBy || undefined, dataset: { command: cmd } }, h('span', null, label));
    if (busy(cmd)) setPending(el, true);
    return el;
  };

  const explain = vm.startBlocked ? t('adminLocal.mc.explain.blocked') : t(`adminLocal.mc.explain.${vm.phase}`, { time: s.lockAt ? formatTime(s.lockAt) : '' });
  const header = h('div', { className: 'round-head stack stack--tight' },
    h('div', { className: 'cluster cluster--between' },
      h('h2', { id: 'round-panel-title' }, s.title),
      h('span', { className: ['pill', 'pill--status', vm.status.pill], role: 'status', 'aria-label': `${t('adminLocal.mc.status')}: ${vm.status.label}` }, vm.status.label)),
    progressSteps(vm),
    h('p', { className: 'round-explain' }, explain, startLine(s) ? h('span', { className: 'muted' }, ` ${startLine(s)}.`) : null),
    vm.phase === 'CANCELLED' && s.cancellationReason && h('p', { className: 'banner banner--danger', role: 'note' }, t('adminLocal.cancelledReason', { reason: s.cancellationReason })));

  const sections = [header];
  const primary = [];
  switch (vm.phase) {
    case 'DRAFT':
      primary.push(btn(t('adminLocal.mc.openForPlayers'), 'round.registration.open', actions.openRegistration, { kind: 'btn--primary btn--lg' }));
      primary.push(btn(t('adminLocal.mc.editTitle'), 'round.update', actions.edit, { kind: 'btn--ghost' }));
      break;
    case 'REGISTRATION_OPEN': {
      if (vm.startBlocked) sections.push(h('div', { className: 'alert alert--danger stack stack--tight', role: 'alert' },
        h('p', { className: 'alert__text' }, t('adminLocal.mc.startBlocked')),
        extendRow(actions, anyPending, { id: 'extend-blocked', compact: true })));
      else if (vm.unfinishedAlert) sections.push(h('div', { className: 'alert alert--warning stack stack--tight', role: 'alert', dataset: { alert: 'unfinished' } },
        h('p', { className: 'alert__text' }, t('adminLocal.mc.unfinished', { count: formatInt(vm.unfinished) })),
        extendRow(actions, anyPending, { id: 'extend-alert', compact: true }),
        h('p', { className: 'muted alert__hint' }, t('adminLocal.mc.unfinishedHint'))));
      sections.push(h('div', { className: 'grid grid--2 open-grid' },
        h('div', { className: 'stack' },
          s.lockAt && !vm.startBlocked && h('div', { className: 'start-clock' }, countdown(s.lockAt, { label: t('adminLocal.mc.gameStartsIn'), id: 'start-countdown' })),
          h('div', { className: 'mini-stats' },
            statTile(t('adminLocal.counts.joined'), cur.counts.joined),
            statTile(t('adminLocal.counts.completed'), cur.counts.completed),
            statTile(t('adminLocal.mc.unfinishedLabel'), vm.unfinished))),
        joinPanel(state.join)));
      primary.push(btn(t('adminLocal.mc.startNow'), 'round.start_now', actions.startNow, { kind: 'btn--primary btn--lg' }));
      if (!vm.startBlocked && !vm.unfinishedAlert) primary.push(extendRow(actions, anyPending)); // the alert carries its own Extend chips
      break;
    }
    case 'PLAYING': {
      const nextBtn = btn(t('adminLocal.mc.drawNext'), 'round.draw.next', actions.nextSkill, { kind: 'btn--primary btn--lg next-skill', describedBy: 'pacing-hint', id: 'next-skill' });
      sections.push(h('section', { className: 'card next-skill-card stack', 'aria-labelledby': 'draw-title' },
        h('h3', { id: 'draw-title', className: 'visually-hidden' }, t('adminLocal.mc.drawNext')),
        h('p', { className: 'draw-summary tabular' },
          `${t('adminLocal.counts.draws')} ${formatInt(cur.draws.length)} · ${t('adminLocal.counts.poolRemaining')} ${vm.poolRemaining === null ? '–' : formatInt(vm.poolRemaining)} · ${t('adminLocal.counts.active')} ${formatInt(cur.counts.active ?? 0)}`,
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
    case 'CLOSED':
      if (vm.winners.length || vm.phase === 'WINNER') sections.push(winnersPanel(vm, state));
      if (vm.draws.length) sections.push(h('details', { className: 'draws-details' }, h('summary', null, `${t('adminLocal.draws')} · ${formatInt(vm.draws.length)}`), drawList(vm)));
      primary.push(h('button', { className: 'btn btn--primary btn--lg', type: 'button', onClick: actions.create }, t('adminLocal.mc.createRound')));
      break;
    case 'CANCELLED':
      primary.push(h('button', { className: 'btn btn--primary btn--lg', type: 'button', onClick: actions.create }, t('adminLocal.mc.createRound')));
      break;
    default:
      break;
  }

  const secondary = [];
  if (vm.controls.cancel) secondary.push(btn(t('adminLocal.mc.cancel'), 'round.cancel', actions.cancel, { kind: 'btn--ghost btn--sm' }));
  secondary.push(btn(t('adminLocal.mc.delete'), 'round.delete', () => actions.deleteRound(s), { kind: 'btn--danger btn--sm' }));
  const actionBar = h('div', { className: 'round-actions', role: 'group', 'aria-label': t('adminLocal.currentRound') },
    h('div', { className: 'round-actions__primary cluster' }, primary),
    h('div', { className: 'round-actions__secondary cluster', role: 'group', 'aria-label': t('adminLocal.mc.moreActions') }, secondary));
  // Playing: after the draw card. Open: after any alert, above the countdown + QR. Otherwise right under the header.
  const at = vm.phase === 'PLAYING' ? 2 : vm.phase === 'REGISTRATION_OPEN' ? sections.length - 1 : 1;
  sections.splice(at, 0, actionBar);

  return h('section', { className: ['card', 'stack', 'round-panel', `is-${vm.phase.toLowerCase()}`], 'aria-labelledby': 'round-panel-title', dataset: { phase: vm.phase } }, sections);
}
