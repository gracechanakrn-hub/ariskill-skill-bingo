// Audit tab (A4): newest-first table of audit entries with a round filter.
import { h } from '/packages/ui/dom.js';
import { formatTime } from '/packages/ui/format.js';
import { t } from '../copy.js';
import { filterAudit } from '../state.js';

export function renderAudit({ entries, rounds, roundId, loading, error, onFilter, onRefresh }) {
  const rows = filterAudit(entries, roundId);
  const select = h('select', { className: 'select', id: 'audit-round', onChange: (e) => onFilter(e.target.value || null) },
    h('option', { value: '' }, t('adminLocal.audit.allRounds')),
    (rounds || []).slice().sort((a, b) => b.number - a.number).map((r) => h('option', { value: r.roundId, selected: r.roundId === roundId }, `${t('adminLocal.round')} ${r.number} · ${r.title}`)));
  const outcomePill = (o) => h('span', { className: ['pill', o === 'accepted' ? 'pill--success' : o === 'rejected' ? 'pill--danger' : 'pill--info'] }, o || '–');
  return h('div', { className: 'stack audit' },
    h('div', { className: 'cluster cluster--between' },
      h('div', { className: 'field field--inline' }, h('label', { className: 'field__label', for: 'audit-round' }, t('adminLocal.audit.filter')), select),
      h('button', { className: 'btn btn--ghost', type: 'button', onClick: onRefresh, disabled: !!loading }, t('adminLocal.refresh'))),
    error && h('p', { className: 'banner banner--danger', role: 'alert' }, error),
    loading && !entries.length ? h('p', { className: 'muted' }, t('adminLocal.loading')) : null,
    h('p', { className: 'muted', role: 'status' }, t('adminLocal.audit.showing', { count: rows.length })),
    rows.length ? h('div', { className: 'table-scroll' }, h('table', { className: 'table audit-table' },
      h('thead', null, h('tr', null,
        h('th', { scope: 'col' }, t('adminLocal.audit.at')), h('th', { scope: 'col' }, t('adminLocal.audit.actor')), h('th', { scope: 'col' }, t('adminLocal.audit.action')),
        h('th', { scope: 'col' }, t('adminLocal.round')), h('th', { scope: 'col' }, t('adminLocal.audit.outcome')), h('th', { scope: 'col' }, t('adminLocal.audit.expected')),
        h('th', { scope: 'col' }, t('adminLocal.audit.actual')), h('th', { scope: 'col' }, t('adminLocal.audit.correlation')))),
      h('tbody', null, rows.map((e) => {
        const round = (rounds || []).find((r) => r.roundId === e.roundId);
        return h('tr', null,
          h('td', { className: 'tabular nowrap' }, formatTime(e.at, { withSeconds: true })),
          h('td', null, e.actor || '–'),
          h('td', { className: 'mono' }, e.action || '–'),
          h('td', null, round ? `${round.number}` : (e.roundId ? '–' : '')),
          h('td', null, outcomePill(e.outcome)),
          h('td', { className: 'tabular' }, e.expectedVersion === null || e.expectedVersion === undefined ? '–' : String(e.expectedVersion)),
          h('td', { className: 'tabular' }, e.actualVersion === null || e.actualVersion === undefined ? '–' : String(e.actualVersion)),
          h('td', { className: 'mono truncate', title: e.correlationId || '' }, e.correlationId || '–'));
      })))) : (!loading && h('p', { className: 'muted' }, t('adminLocal.audit.empty'))));
}
