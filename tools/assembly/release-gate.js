#!/usr/bin/env node
// Hard QC gate runner (workflow section 15). Executes the automated checks per category,
// records manual/rehearsal items as `manual_pending`, and writes reports/qa/release-gate.json.
// Any critical or major failure blocks release.
import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const results = [];
function run(category, name, cmd, args, { severity = 'major', env = {} } = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, BINGO_ENV: 'test', ...env }, timeout: 600000 });
  const pass = r.status === 0;
  const tail = ((r.stdout || '') + (r.stderr || '')).split('\n').filter(Boolean).slice(-12).join('\n');
  results.push({ category, name, command: [cmd, ...args].join(' '), status: pass ? 'pass' : 'fail', severity: pass ? null : severity, durationMs: Date.now() - started, evidence: tail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${category}] ${name}`);
  return pass;
}
// A manual item counts as recorded only when its evidence file carries a filled sign-off line
// (e.g. "Sign-off: A. Person, 2026-10-01" or "Decision: go"). Unfilled templates stay pending.
const SIGNOFF = /^\s*(?:[-*]\s*)?(?:\*\*)?(sign-?off|approved by|decision|reviewer)(?:\*\*)?\s*:\s*(?!\s*$)(?!\s*(tbd|pending|none|n\/a|_{2,}|\[ \])\b)\S/im;
function manual(category, name, evidencePath, note) {
  const abs = evidencePath ? join(ROOT, evidencePath) : null;
  const filled = abs && existsSync(abs) && SIGNOFF.test(readFileSync(abs, 'utf8'));
  results.push({ category, name, status: filled ? 'evidence_recorded' : 'manual_pending', severity: null, evidence: evidencePath || note, note: filled ? note : `${note ? note + '; ' : ''}awaiting a filled Sign-off/Decision line in ${evidencePath || 'evidence'}` });
}
const hasDir = (p) => existsSync(join(ROOT, p));

// Functional
run('functional', 'game-rules unit + property + state-machine', 'node', ['--test', 'packages/game-rules/test']);
if (hasDir('services/game-service/test')) run('functional', 'game-service tests', 'node', ['--test', 'services/game-service/test']);
if (hasDir('packages/ui/test')) run('functional', 'ui kit tests', 'node', ['--test', 'packages/ui/test']);
for (const app of ['employee-mobile', 'admin-portal', 'public-galaxy', 'stage-dashboard']) if (hasDir(`apps/${app}/test`)) run('functional', `${app} unit tests`, 'node', ['--test', `apps/${app}/test`]);
if (hasDir('packages/design-tokens/test')) run('accessibility', 'design token contrast + CVD separability', 'node', ['--test', 'packages/design-tokens/test']);
if (hasDir('tests/contracts')) run('functional', 'contract tests', 'node', ['--test', 'tests/contracts']);
if (hasDir('tests/e2e')) run('functional', 'e2e canonical flows + seeded round', 'node', ['--test', 'tests/e2e']);
// Data
if (existsSync(join(ROOT, 'services/game-service/test/migration.test.js'))) run('data', 'schema constraints + migrations', 'node', ['--test', 'services/game-service/test/migration.test.js']);
else manual('data', 'schema constraints + migrations', null, 'covered inside game-service tests (uniqueness) ; dedicated migration test pending');
// Concurrency
if (existsSync(join(ROOT, 'services/game-service/test/draw.test.js'))) run('concurrency', 'simultaneous/duplicate/stale commands, winner atomicity', 'node', ['--test', 'services/game-service/test/draw.test.js', 'services/game-service/test/float.test.js']);
if (existsSync(join(ROOT, 'tests/e2e/reconnect.test.js'))) run('concurrency', 'reconnect / event gaps', 'node', ['--test', 'tests/e2e/reconnect.test.js']);
// Security
if (existsSync(join(ROOT, 'services/game-service/test/authz.test.js'))) run('security', 'authn/authz + replay + rate limit', 'node', ['--test', 'services/game-service/test/authz.test.js']);
run('security', 'secret + dependency scan (assembly)', 'node', ['tools/assembly/assemble.js']);
manual('security', 'threat model review + penetration findings', 'docs/security/threat-model.md');
// Privacy
if (existsSync(join(ROOT, 'tests/contracts/projection-redaction.test.js'))) run('privacy', 'public/stage payload redaction', 'node', ['--test', 'tests/contracts/projection-redaction.test.js'], { severity: 'critical' });
manual('privacy', 'consent/name policy + deletion/retention verification', 'reports/qa/privacy-review.md');
// Accessibility
if (hasDir('tests/accessibility')) run('accessibility', 'automated a11y checks', 'node', ['--test', 'tests/accessibility']);
manual('accessibility', 'keyboard/screen reader/contrast/reflow/reduced motion/silent walkthrough', 'reports/qa/accessibility-review.md');
// Performance
if (existsSync(join(ROOT, 'tests/load/reconnect-storm.js'))) run('performance', 'capacity + 50% load, p95 draw fan-out, reconnect storm', 'node', ['tests/load/reconnect-storm.js']);
manual('performance', 'frame time on venue hardware', 'reports/qa/venue-performance.md');
// Compatibility
manual('compatibility', 'phone/browser matrix + exact venue hardware', 'reports/qa/compatibility-matrix.md');
// Resilience
if (hasDir('tools/assets/test')) run('resilience', 'asset manifests, budgets, fallbacks', 'node', ['--test', 'tools/assets/test']);
manual('resilience', 'renderer/audio/realtime failure fallbacks + restart recovery', 'reports/qa/resilience-review.md');
// Operations
manual('operations', 'dashboards/alerts/audit, runbook, backup, rehearsal, rollback', 'ops/runbook.md', 'runbook exists; rehearsal pending');

const failures = results.filter(r => r.status === 'fail');
const critical = failures.filter(r => r.severity === 'critical').length;
const major = failures.filter(r => r.severity === 'major').length;
const pending = results.filter(r => r.status === 'manual_pending').length;
const report = {
  runId: readFileSync(join(ROOT, 'build/RUN_ID'), 'utf8').trim(),
  buildId: existsSync(join(ROOT, 'build/build-info.json')) ? JSON.parse(readFileSync(join(ROOT, 'build/build-info.json'), 'utf8')).buildId : null,
  generatedAt: new Date().toISOString(),
  automated: { total: results.filter(r => r.status === 'pass' || r.status === 'fail').length, passed: results.filter(r => r.status === 'pass').length, failed: failures.length, critical, major },
  manualPending: pending,
  decision: critical || major ? 'BLOCKED' : (pending ? 'AUTOMATED_GREEN_MANUAL_PENDING' : 'GREEN'),
  results,
};
mkdirSync(join(ROOT, 'reports/qa'), { recursive: true });
writeFileSync(join(ROOT, 'reports/qa/release-gate.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ decision: report.decision, ...report.automated, manualPending: pending }, null, 2));
process.exit(critical || major ? 1 : 0);
