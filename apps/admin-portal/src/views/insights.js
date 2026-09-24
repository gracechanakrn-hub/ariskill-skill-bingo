// Insights tab (A3): aggregate metrics only. Never renders per-participant data.
import { h } from '/packages/ui/dom.js';
import { formatInt, formatTime } from '/packages/ui/format.js';
import { t } from '../copy.js';
import { densityBars } from '../state.js';

function pct(rate) { return rate === null || rate === undefined ? '–' : `${Math.round(Number(rate) * 100)}%`; }

function engagementTable(rows, idKey, label, suppressed) {
  const table = rows && rows.length ? h('div', { className: 'table-scroll' }, h('table', { className: 'table' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('adminLocal.insights.name')), h('th', { scope: 'col' }, t('adminLocal.counts.joined')), h('th', { scope: 'col' }, t('adminLocal.counts.completed')), h('th', { scope: 'col' }, t('adminLocal.insights.rate')))),
    h('tbody', null, rows.map((r) => h('tr', null, h('td', null, r.name || r[idKey]), h('td', { className: 'tabular' }, formatInt(r.joined)), h('td', { className: 'tabular' }, formatInt(r.completed)), h('td', { className: 'tabular' }, pct(r.joined ? r.completed / r.joined : null)))))))
    : h('p', { className: 'muted' }, t('adminLocal.insights.empty'));
  return h('section', { className: 'card card--flat stack stack--tight', 'aria-label': label },
    h('h3', { className: 'section-title' }, label), table,
    h('p', { className: 'muted suppression-note' }, `${t('stage.suppressed')} · ${t('adminLocal.insights.suppressedCount', { count: formatInt(suppressed || 0) })}`));
}

function bar(label, value, kind) {
  return h('div', { className: 'density-row' },
    h('div', { className: 'cluster cluster--between' }, h('span', null, label), h('span', { className: 'tabular' }, `${value}%`)),
    h('div', { className: ['progress', `progress--${kind}`], role: 'img', 'aria-label': `${label} ${value}%` }, h('div', { className: 'progress__bar', style: { width: `${value}%` } })));
}

export function renderInsights(data, { error = null, loading = false } = {}) {
  if (loading && !data) return h('p', { className: 'muted' }, t('adminLocal.loading'));
  if (error && !data) return h('p', { className: 'banner banner--danger', role: 'alert' }, error);
  if (!data) return h('p', { className: 'muted' }, t('adminLocal.insights.empty'));
  const p = data.participation || {};
  const d = densityBars(data.coreCriticalDensity);
  const ma = data.matrixAlignment || {};
  return h('div', { className: 'stack insights' },
    h('p', { className: 'muted' }, `${t('adminLocal.insights.refreshing')} ${data.computedAt ? `${t('adminLocal.insights.computedAt')} ${formatTime(data.computedAt, { withSeconds: true })}.` : ''}`),
    h('section', { className: 'card card--flat stack stack--tight', 'aria-labelledby': 'ins-part' },
      h('h3', { id: 'ins-part', className: 'section-title' }, t('stage.participation')),
      h('div', { className: 'grid grid--auto counts-grid' },
        [['adminLocal.counts.joined', p.joined, null], ['adminLocal.counts.completed', p.completed, p.completedRate], ['adminLocal.counts.active', p.active, p.activeRate], ['adminLocal.counts.deferred', p.deferred, p.deferredRate]]
          .map(([k, v, r]) => h('div', { className: 'stat stat--compact' }, h('div', { className: 'stat__label' }, t(k)), h('div', { className: 'stat__value tabular' }, formatInt(v || 0)), h('div', { className: 'muted tabular' }, pct(r)))))),
    h('div', { className: 'grid grid--2' },
      h('section', { className: 'card card--flat stack stack--tight', 'aria-labelledby': 'ins-top' },
        h('h3', { id: 'ins-top', className: 'section-title' }, t('adminLocal.insights.topSkills')),
        data.topSkills && data.topSkills.length ? h('div', { className: 'table-scroll' }, h('table', { className: 'table' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col' }, t('adminLocal.insights.skill')), h('th', { scope: 'col' }, t('adminLocal.insights.kind')), h('th', { scope: 'col' }, t('adminLocal.insights.boards')))),
          h('tbody', null, data.topSkills.map((s, i) => h('tr', null, h('td', { className: 'tabular' }, String(i + 1)), h('td', null, s.name), h('td', null, s.kind || t('adminLocal.kind.optional')), h('td', { className: 'tabular' }, formatInt(s.count))))))) : h('p', { className: 'muted' }, t('adminLocal.insights.empty'))),
      h('section', { className: 'card card--flat stack stack--tight', 'aria-labelledby': 'ins-density' },
        h('h3', { id: 'ins-density', className: 'section-title' }, t('adminLocal.insights.density')),
        h('p', { className: 'muted' }, t('adminLocal.insights.selections', { count: formatInt(d.total) })),
        bar(t('adminLocal.kind.core'), d.core, 'core'), bar(t('adminLocal.kind.critical'), d.critical, 'critical'), bar(t('adminLocal.kind.optional'), d.optional, 'optional'))),
    h('div', { className: 'grid grid--2' },
      engagementTable(data.platformEngagement, 'platformId', t('adminLocal.insights.platform'), data.suppressedCohorts),
      engagementTable(data.roleEngagement, 'roleId', t('adminLocal.insights.role'), data.suppressedCohorts)),
    h('div', { className: 'grid grid--2' },
      h('section', { className: 'card card--flat stack stack--tight', 'aria-labelledby': 'ins-align' },
        h('h3', { id: 'ins-align', className: 'section-title' }, t('stage.alignment')),
        h('div', { className: 'stat' }, h('div', { className: 'stat__label' }, t('adminLocal.insights.alignmentRate')), h('div', { className: 'stat__value tabular' }, pct(ma.rate))),
        h('p', { className: 'muted' }, `${t('adminLocal.insights.participantsInRate')}: ${formatInt(ma.participants || 0)} · ${t('adminLocal.insights.matrixVersion')}: `, h('span', { className: 'mono' }, ma.matrixVersion || data.matrixVersion || '–'))),
      h('section', { className: 'card card--flat stack stack--tight', 'aria-labelledby': 'ins-beyond' },
        h('h3', { id: 'ins-beyond', className: 'section-title' }, t('stage.beyond')),
        data.skillsBeyondMatrix && data.skillsBeyondMatrix.length ? h('ol', { className: 'plain-list' }, data.skillsBeyondMatrix.map((s) => h('li', null, h('span', null, s.name), ' ', h('span', { className: 'muted tabular' }, `· ${formatInt(s.count)}`)))) : h('p', { className: 'muted' }, t('adminLocal.insights.empty')))));
}
