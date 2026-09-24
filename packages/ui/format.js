// @ariskill/ui format.js - display formatting helpers (pure, isomorphic).
const LOCALE = 'en';

/** plural(3, 'skill') -> '3 skills'; plural(1, 'skill') -> '1 skill'; custom plural form via third arg. */
export function plural(count, singular, pluralForm = `${singular}s`) {
  const n = Number(count) || 0;
  return `${formatInt(n)} ${n === 1 ? singular : pluralForm}`;
}

/** formatInt(12345) -> '12,345' (pair with `.tabular` class for aligned numerals). */
export function formatInt(n, { locale = LOCALE } = {}) {
  const v = Math.trunc(Number(n) || 0);
  try { return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v); } catch { return String(v); }
}

/**
 * formatTime(iso, { timeZone, withSeconds }) -> 'HH:mm' (24 h) in the device zone by default.
 * Returns '' for invalid input. Countdown display uses clock-sync formatCountdown instead.
 */
export function formatTime(iso, { timeZone, withSeconds = false, locale = LOCALE } = {}) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, hour12: false, timeZone }).format(d).replace(/^24:/, '00:');
  } catch {
    const pad = (x) => String(x).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}${withSeconds ? ':' + pad(d.getSeconds()) : ''}`;
  }
}

/**
 * relativeSeconds(targetIso, nowMs) -> 'in 12 s' | '12 s ago' | 'now'
 * Whole seconds; never claims sub-second precision. nowMs should come from clock-sync now().
 */
export function relativeSeconds(targetIso, nowMs = Date.now()) {
  const t = targetIso instanceof Date ? targetIso.getTime() : new Date(targetIso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.round((t - nowMs) / 1000);
  if (diff === 0) return 'now';
  const abs = Math.abs(diff);
  const unit = abs >= 3600 ? [Math.round(abs / 3600), 'h'] : abs >= 60 ? [Math.round(abs / 60), 'min'] : [abs, 's'];
  return diff > 0 ? `in ${unit[0]} ${unit[1]}` : `${unit[0]} ${unit[1]} ago`;
}

/**
 * pseudonymLabel(soulId) -> 'Soul 7K3Q' - deterministic, non-reversible short label for a Soul
 * whose owner did not consent to public display. The server normally supplies `label`; this is the
 * client-side fallback when `label` is null. Never derive from employeeRef or displayName.
 */
export function pseudonymLabel(soulId, { prefix = 'Soul' } = {}) {
  const s = String(soulId ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L to keep it readable on stage
  let out = '';
  for (let i = 0; i < 4; i++) { out += alphabet[h % alphabet.length]; h = Math.floor(h / alphabet.length); }
  return `${prefix} ${out}`;
}

/** padTwo(7) -> '07' */
export function padTwo(n) { return String(Math.max(0, Math.trunc(Number(n) || 0))).padStart(2, '0'); }

/** ordinal(3) -> '3rd' (draw numbers, round numbers). */
export function ordinal(n) {
  const v = Math.trunc(Number(n) || 0), mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`;
}
