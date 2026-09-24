// Stage dashboard - tile and insight formatters (pure, Node-testable).
// Input shapes: contracts/projections/stage.json#insights (aggregate only; never per-person data).
import { formatInt, formatTime } from '../../../packages/ui/format.js';

export const KIND_ICONS = Object.freeze({
  Core: { glyph: '◆', className: 'kind--core' },       // filled diamond
  Critical: { glyph: '●', className: 'kind--critical' }, // filled circle
  Optional: { glyph: '○', className: 'kind--optional' }, // outlined circle
});

export function kindIcon(kind) {
  const k = typeof kind === 'string' ? kind : '';
  return KIND_ICONS[k] || { glyph: '○', className: 'kind--optional' };
}

/** formatPercent(0.813) -> '81%'; clamps to 0..100; '' for non-numbers. */
export function formatPercent(rate, { digits = 0 } = {}) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return '';
  const pct = Math.min(100, Math.max(0, n * 100));
  return `${pct.toFixed(digits)}%`;
}

export function formatCount(n) { return formatInt(n); }

/** formatClock(iso) -> 'HH:mm:ss' in the device zone; '' for invalid input. */
export function formatClock(iso, opts = {}) { return iso ? formatTime(iso, { withSeconds: true, ...opts }) : ''; }

function asArray(v) { return Array.isArray(v) ? v : []; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/** Top skills with a bar relative to the largest count. Keeps server order (already descending) but re-sorts defensively. */
export function formatTopSkills(topSkills, { limit = 10 } = {}) {
  const rows = asArray(topSkills).filter(s => s && s.name).map(s => ({ skillId: s.skillId ?? null, name: String(s.name), kind: s.kind ?? null, count: num(s.count) }));
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r, icon: kindIcon(r.kind), pct: max > 0 ? Math.round((r.count / max) * 100) : 0 }));
}

/** Core / Critical / Optional density as three proportional bars (percent of totalSelections). */
export function formatDensity(d) {
  const core = num(d?.core), critical = num(d?.critical), optional = num(d?.optional);
  const total = num(d?.totalSelections) || core + critical + optional;
  const bar = (key, kind, count) => ({ key, kind, count, icon: kindIcon(kind), pct: total > 0 ? Math.round((count / total) * 100) : 0, percentLabel: total > 0 ? formatPercent(count / total) : '' });
  return { total, bars: [bar('core', 'Core', core), bar('critical', 'Critical', critical), bar('optional', 'Optional', optional)] };
}

/** Platform/Role engagement: top N by joined (ties by name), with completion rate; cohorts < 5 are already suppressed server-side. */
export function formatEngagement(list, { limit = 8 } = {}) {
  const rows = asArray(list).filter(r => r && r.name).map(r => ({ id: r.platformId ?? r.roleId ?? null, name: String(r.name), joined: num(r.joined), completed: num(r.completed) }));
  rows.sort((a, b) => b.joined - a.joined || a.name.localeCompare(b.name));
  return rows.slice(0, limit).map(r => ({ ...r, completionPct: r.joined > 0 ? Math.round((r.completed / r.joined) * 100) : 0 }));
}

/** Matrix alignment: large percentage + small version line. Returns null when no data. */
export function formatAlignment(a) {
  if (!a || a.rate === null || a.rate === undefined) return null;
  const rate = Number(a.rate);
  if (!Number.isFinite(rate)) return null;
  return { rate, percent: formatPercent(rate), matrixVersion: a.matrixVersion ? String(a.matrixVersion) : '', participants: num(a.participants) };
}

/** Skills beyond the matrix: top N with a bar relative to the largest count. */
export function formatBeyond(list, { limit = 10 } = {}) {
  const rows = asArray(list).filter(s => s && s.name).map(s => ({ skillId: s.skillId ?? null, name: String(s.name), count: num(s.count) }));
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r, pct: max > 0 ? Math.round((r.count / max) * 100) : 0 }));
}

/** ageSeconds(serverTimeIso, nowMs) -> whole seconds since the last server time (>= 0), or null when unknown. */
export function ageSeconds(serverTimeIso, nowMs) {
  const t = Date.parse(serverTimeIso || '');
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

/** Winner label: server label wins; null label -> Soul pseudonym via copy (public.winner.anonymous) resolved by the view. */
export function winnerRows(winners) {
  return asArray(winners).map(w => ({ label: w?.label ?? null, soulId: w?.soulId ?? null, winningDrawNumber: Number.isFinite(Number(w?.winningDrawNumber)) && w.winningDrawNumber !== null ? Number(w.winningDrawNumber) : null, shortId: shortSoulId(w?.soulId) }));
}

/** Winner rows for the live tile: never clipped; beyond `max` rows the list gets one type step smaller and a "+N more" line. */
export const WINNER_MAX_ROWS = 6;
export function winnerDisplayRows(winners, { max = WINNER_MAX_ROWS } = {}) {
  const all = winnerRows(winners);
  const dense = all.length > max;
  const rows = dense ? all.slice(0, max) : all;
  return { rows, more: Math.max(0, all.length - rows.length), dense, total: all.length };
}

export function shortSoulId(soulId) {
  const s = String(soulId ?? '').replace(/^soul_/, '');
  return s.slice(-4).toUpperCase();
}

/** Fits the whole insight set for one layout: full lists on the insights focus, compact on the live focus. */
export function formatInsights(insights, { layout = 'insights' } = {}) {
  const compact = layout === 'live';
  const lim = compact ? { skills: 5, engagement: 3, beyond: 5 } : { skills: 10, engagement: 8, beyond: 10 };
  const i = insights || {};
  return {
    compact,
    topSkills: formatTopSkills(i.topSkills, { limit: lim.skills }),
    density: formatDensity(i.coreCriticalDensity),
    platforms: formatEngagement(i.platformEngagement, { limit: lim.engagement }),
    roles: formatEngagement(i.roleEngagement, { limit: lim.engagement }),
    alignment: formatAlignment(i.matrixAlignment),
    beyond: formatBeyond(i.skillsBeyondMatrix, { limit: lim.beyond }),
    suppressedCohorts: num(i.suppressedCohorts),
    hasData: Boolean(insights),
  };
}
