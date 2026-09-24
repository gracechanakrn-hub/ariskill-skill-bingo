// Structured JSON-line logger. Never receives tokens, employee references, or skill selections (requirement 15.3).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const REDACT_KEYS = new Set(['token', 'sessiontoken', 'jointoken', 'floattoken', 'employeeref', 'authorization', 'selectedskillids', 'skillids', 'secret']);

function scrub(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return obj;
  if (Array.isArray(obj)) return obj.slice(0, 20).map(v => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[redacted]' : scrub(v, depth + 1);
  return out;
}

export function createLogger(level = 'info', stream = process.stdout) {
  const min = LEVELS[level] ?? LEVELS.info;
  const emit = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    const line = { at: new Date().toISOString(), level: lvl, msg, ...scrub(fields) };
    stream.write(JSON.stringify(line) + '\n');
  };
  return {
    debug: (m, f = {}) => emit('debug', m, f),
    info: (m, f = {}) => emit('info', m, f),
    warn: (m, f = {}) => emit('warn', m, f),
    error: (m, f = {}) => emit('error', m, f),
    child: (bound) => { const l = createLogger(level, stream); const wrap = fn => (m, f = {}) => fn(m, { ...bound, ...f }); return { debug: wrap(l.debug), info: wrap(l.info), warn: wrap(l.warn), error: wrap(l.error), child: (b2) => l.child({ ...bound, ...b2 }) }; },
  };
}
