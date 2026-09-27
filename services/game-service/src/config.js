// Configuration from environment (requirement 15.2, D-10 defaults).
// In development missing secrets are replaced by clearly printed deterministic dev values;
// in production the process refuses to start without every secret.
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const DEV_DEFAULTS = {
  adminToken: 'dev-admin-token',
  stageToken: 'dev-stage-token',
  joinSecret: 'dev-join-secret',
  sessionSecret: 'dev-session-secret',
};

function int(v, d) { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

/**
 * Build a config object from an env-like map. `overrides` lets tests inject values directly.
 * Throws in production when a secret is missing.
 */
export function loadConfig(env = process.env, overrides = {}) {
  const bingoEnv = overrides.env ?? env.BINGO_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(bingoEnv)) throw new Error(`BINGO_ENV must be development|test|production (got ${bingoEnv})`);
  const port = overrides.port ?? int(env.PORT, 8080);
  const generated = [];
  const secret = (key, envName, devValue) => {
    if (overrides[key]) return overrides[key];
    if (env[envName]) return env[envName];
    if (bingoEnv === 'production') throw new Error(`Refusing to start: ${envName} is required in production`);
    generated.push(envName);
    return bingoEnv === 'test' ? `${devValue}-${randomBytes(4).toString('hex')}` : devValue;
  };
  const cfg = {
    env: bingoEnv,
    port,
    host: overrides.host ?? env.HOST ?? (bingoEnv === 'development' ? '127.0.0.1' : '0.0.0.0'),
    dbPath: overrides.dbPath ?? env.BINGO_DB_PATH ?? resolve(REPO_ROOT, 'data/bingo.sqlite'),
    adminToken: secret('adminToken', 'BINGO_ADMIN_TOKEN', DEV_DEFAULTS.adminToken),
    stageToken: secret('stageToken', 'BINGO_STAGE_TOKEN', DEV_DEFAULTS.stageToken),
    joinSecret: secret('joinSecret', 'BINGO_JOIN_SECRET', DEV_DEFAULTS.joinSecret),
    sessionSecret: secret('sessionSecret', 'BINGO_SESSION_SECRET', DEV_DEFAULTS.sessionSecret),
    publicBaseUrl: overrides.publicBaseUrl ?? env.BINGO_PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    publicBaseUrlDefaulted: !(overrides.publicBaseUrl ?? env.BINGO_PUBLIC_BASE_URL),
    resultWindowSeconds: clamp(overrides.resultWindowSeconds ?? int(env.BINGO_RESULT_WINDOW_SECONDS, 12), 10, 15),
    startGraceSeconds: overrides.startGraceSeconds ?? int(env.BINGO_START_GRACE_SECONDS, 60),
    retentionDays: overrides.retentionDays ?? int(env.BINGO_RETENTION_DAYS, 90),
    rngSeed: overrides.rngSeed ?? env.BINGO_RNG_SEED ?? null,
    // Guided draws (D-33) aim for 1-2 winners between draws 6 and 12; BINGO_DRAW_GUIDANCE=off falls back to plain random.
    drawGuidance: overrides.drawGuidance ?? !['0', 'off', 'false', 'no'].includes(String(env.BINGO_DRAW_GUIDANCE ?? 'on').toLowerCase()),
    // Float greetings (D-42) on the public screen; BINGO_GREETINGS=off hides every greeting from public / stage payloads.
    greetings: overrides.greetings ?? !['0', 'off', 'false', 'no'].includes(String(env.BINGO_GREETINGS ?? 'on').toLowerCase()),
    defaultEventId: overrides.defaultEventId ?? env.BINGO_EVENT_ID ?? 'evt_demo',
    defaultEventName: overrides.defaultEventName ?? env.BINGO_EVENT_NAME ?? 'AriSkill Skill Bingo Demo',
    logLevel: overrides.logLevel ?? env.BINGO_LOG_LEVEL ?? (bingoEnv === 'test' ? 'silent' : 'info'),
    joinTokenTtlHours: 12,
    joinTokenRotateBelowHours: 1,
    sessionTtlHours: 24,
    floatTokenTtlHours: 24,
    idempotencyTtlHours: 24,
    jsonBodyLimitBytes: 64 * 1024,
    sseHeartbeatMs: overrides.sseHeartbeatMs ?? int(env.BINGO_SSE_HEARTBEAT_MS, 15000),
    sseReplayLimit: 500,
    timerIntervalMs: overrides.timerIntervalMs ?? 250,
    insightsCacheMs: overrides.insightsCacheMs ?? 2000,
    // Contract defaults (commands 10/s per actor, session 5/min per IP, discovery 20/s per session). The session limit is per client IP:
    // a venue behind NAT shares one address, so BINGO_SESSION_RATE_PER_MIN raises it and BINGO_TRUST_PROXY=1 keys it on X-Forwarded-For.
    rateLimits: overrides.rateLimits ?? { commandsPerSec: 10, sessionPerMin: int(env.BINGO_SESSION_RATE_PER_MIN, 5), discoveryPerSec: 20 },
    trustProxy: overrides.trustProxy ?? ['1', 'true', 'yes'].includes(String(env.BINGO_TRUST_PROXY ?? '').toLowerCase()),
    generatedSecrets: generated,
    ...(overrides.extra ?? {}),
  };
  if (cfg.rngSeed && cfg.env === 'production') throw new Error('Refusing to start: BINGO_RNG_SEED is not allowed in production');
  return cfg;
}

/** Human-readable startup banner (never printed in production for generated values, which cannot exist there). */
export function describeConfig(cfg) {
  const lines = [
    `AriSkill Skill Bingo game service (${cfg.env})`,
    `  listening: http://${cfg.host}:${cfg.port}`,
    `  public base URL: ${cfg.publicBaseUrl}`,
    `  database: ${cfg.dbPath}`,
  ];
  if (cfg.env !== 'production') {
    lines.push(`  admin token: ${cfg.adminToken}${cfg.generatedSecrets.includes('BINGO_ADMIN_TOKEN') ? ' (generated dev value)' : ''}`);
    lines.push(`  stage token: ${cfg.stageToken}${cfg.generatedSecrets.includes('BINGO_STAGE_TOKEN') ? ' (generated dev value)' : ''}`);
    if (cfg.rngSeed) lines.push(`  deterministic RNG seed: ${cfg.rngSeed} (non-production only)`);
  }
  return lines.join('\n');
}
