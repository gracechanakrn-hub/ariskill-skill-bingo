#!/usr/bin/env node
// tools/ai/blender-render.js - "use Blender for visual": runs tools/ai/blender/soul_turnaround.py headless in Blender.
// Renders clay Soul turnarounds (front / 3-4 / side) and a 6-body x 3-palette contact sheet into
// assets-src/generated/blender/<run-id>/ with provenance.json. Reference renders only - never shipped at runtime.
//
//   node tools/ai/blender-render.js --dry-run                 print the command, py_compile the script, print the seed -> params port
//   node tools/ai/blender-render.js --mode smoke              one body, one view, 256 px (proves the pipeline; ~seconds)
//   node tools/ai/blender-render.js --seed 1f3a9c --mode all  turnaround + contact sheet (default mode)
//   options: --mode all|turnaround|sheet|single|smoke  --seed <n>  --body <name>  --palette <name>  --palettes a,b,c
//            --view front|threequarter|side  --size <px>  --samples <n>  --no-outline  --out <dir>  --blender <path> (default env BLENDER_BIN)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, ROOT, redact } from './env.js';
import { GENERATED_DIR, LICENSE_NOTE, PROVENANCE_VERSION, ensureDir, log, warn, nowStamp, parseArgs, sha256Hex, shapeDryRun, writeDryRun, writeJson } from './lib/common.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCRIPT = join(HERE, 'blender', 'soul_turnaround.py');
export const BLENDER_OUT = join(GENERATED_DIR, 'blender');
export const MODES = ['all', 'turnaround', 'sheet', 'single', 'smoke'];

/** Script-side argument lists per mode (pure). `all` = turnaround + sheet as two Blender invocations. */
export function scriptArgs({ mode = 'all', seed = 'demo-soul', body, palette, palettes, view, size, samples, out, noOutline = false }) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}; use one of ${MODES.join(', ')}`);
  const common = ['--seed', String(seed), '--out', out];
  const opt = (flag, v) => (v !== undefined && v !== null && v !== false ? (v === true ? [flag] : [flag, String(v)]) : []);
  const flag = noOutline ? ['--no-outline'] : [];
  const single = (m, extra = []) => ['--mode', m, ...common, ...opt('--body', body), ...opt('--palette', palette), ...opt('--view', view), ...opt('--size', size), ...opt('--samples', samples), ...flag, ...extra];
  if (mode === 'smoke') return [['--mode', 'smoke', ...common, ...opt('--body', body || 'drop'), ...opt('--palette', palette || 'aurora'), ...opt('--view', view || 'threequarter'), '--size', String(size || 256), '--samples', String(samples || 16)]];
  if (mode === 'sheet') return [['--mode', 'sheet', ...common, ...opt('--palettes', palettes), ...opt('--size', size), ...opt('--samples', samples), ...flag]];
  if (mode === 'all') return [single('turnaround'), ['--mode', 'sheet', ...common, ...opt('--palettes', palettes), ...opt('--size', size), ...opt('--samples', samples), ...flag]];
  return [single(mode)];
}

export function blenderCommand(bin, args) { return [bin, ['--background', '--factory-startup', '--python', SCRIPT, '--', ...args]]; }

function pyCompile() {
  const r = spawnSync('python3', ['-m', 'py_compile', SCRIPT], { encoding: 'utf8' });
  return { ok: r.status === 0, output: (r.stdout + r.stderr).trim() };
}
function printProfiles(seed) {
  const r = spawnSync('python3', [SCRIPT, '--print-profiles', '--seed', String(seed)], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`--print-profiles failed: ${(r.stderr || '').trim()}`);
  return JSON.parse(r.stdout);
}

function provenance(outDir, { bin, version, seed, mode, runs, elapsedMs }) {
  const scriptBytes = readFileSync(SCRIPT);
  const files = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.png')).sort() : [];
  const entries = files.map((f) => { const b = readFileSync(join(outDir, f)); return { file: f, sha256: sha256Hex(b), bytes: b.length }; });
  return {
    version: PROVENANCE_VERSION, tool: 'tools/ai/blender-render.js', script: relative(ROOT, SCRIPT), scriptSha256: sha256Hex(scriptBytes),
    renderer: 'Blender (Eevee)', blender: { bin, version }, seed, mode, createdAt: new Date().toISOString(), elapsedMs, runs, license: LICENSE_NOTE, shipped: false,
    note: 'Procedural render from the repo body profiles (soul-params.js port) - reference material for the marketing sheet / Galaxy atlas decision; not a runtime asset.',
    entries,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { booleans: ['dry-run', 'help', 'no-outline'] });
  if (args.help) { log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n')); return 0; }
  const env = loadEnv();
  const bin = args.blender || env.BLENDER_BIN;
  const mode = args.mode || 'all';
  const seed = args.seed !== undefined ? String(args.seed) : 'demo-soul';
  const runId = args.run || `${nowStamp()}-${mode}`;
  const out = args.out || join(BLENDER_OUT, runId);
  const argLists = scriptArgs({ mode, seed, body: args.body, palette: args.palette, palettes: args.palettes, view: args.view, size: args.size, samples: args.samples, out, noOutline: !!args['no-outline'] });
  const commands = argLists.map((a) => blenderCommand(bin, a));

  if (args['dry-run']) {
    log(`DRY RUN - Blender is not started. Output dir would be ${out}`);
    for (const [exe, a] of commands) log(`$ "${exe}" ${a.map((x) => (x.includes(' ') ? JSON.stringify(x) : x)).join(' ')}`);
    log(`Blender binary: ${existsSync(bin) ? 'found' : 'NOT FOUND'} at ${bin} (override with BLENDER_BIN in .env or --blender)`);
    const pc = pyCompile();
    log(`python3 -m py_compile: ${pc.ok ? 'ok' : 'FAILED\n' + pc.output}`);
    if (!pc.ok) return 1;
    const port = printProfiles(seed);
    log(`seed ${seed} -> body ${port.params.body}, palette ${port.params.palette}, eyes ${port.params.eyes}, mouth ${port.params.mouth}, antenna ${port.params.antenna}, ${port.params.speckles.length} speckles, ${port.profiles[port.params.body].length} profile points (hashSeed ${port.hashSeed})`);
    const rec = shapeDryRun({ tool: 'blender-render', name: mode, method: 'spawn', url: `file://${bin}`, body: { commands: commands.map(([exe, a]) => [exe, ...a]), seedParams: { body: port.params.body, palette: port.params.palette, eyes: port.params.eyes, mouth: port.params.mouth, antenna: port.params.antenna, speckles: port.params.speckles.length } }, outputs: [join(out, '*.png'), join(out, 'provenance.json'), join(out, 'render-log.json')], notes: [`py_compile ${pc.ok ? 'ok' : 'failed'}`, `blender ${existsSync(bin) ? 'found' : 'missing'}`, LICENSE_NOTE] });
    log(`dry-run record: ${writeDryRun(rec)}`);
    return 0;
  }

  if (!existsSync(bin)) { warn(`Blender not found at ${bin}. Install Blender or set BLENDER_BIN in .env (see .env.example).`); return 1; }
  const pc = pyCompile();
  if (!pc.ok) { warn(`script does not compile:\n${pc.output}`); return 1; }
  ensureDir(out);
  const runs = [];
  let version = null;
  const t0 = Date.now();
  for (const [exe, a] of commands) {
    log(`$ "${exe}" ${a.join(' ')}`);
    const started = Date.now();
    const r = spawnSync(exe, a, { encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GEMINI_API_KEY: '', OPENAI_API_KEY: '' } });
    const outText = (r.stdout || '') + (r.stderr || '');
    version = version || (outText.match(/Blender (\d+\.\d+\.\d+[^\s]*)/) || [])[1] || null;
    const logLine = outText.split('\n').find((l) => l.startsWith('RENDER_LOG '));
    const renderLog = logLine ? JSON.parse(logLine.slice('RENDER_LOG '.length)) : null;
    const elapsedMs = Date.now() - started;
    runs.push({ args: a, status: r.status, elapsedMs, renders: renderLog?.renders || [] });
    for (const l of outText.split('\n')) if (/^rendered |Error|Traceback|Exception|RENDER_LOG/.test(l) && !l.startsWith('RENDER_LOG')) log('  ' + redact(l));
    if (r.status !== 0 || !renderLog) {
      warn(`Blender exited with status ${r.status} after ${elapsedMs} ms. Last output:\n${redact(outText.split('\n').slice(-25).join('\n'))}`);
      writeJson(join(out, 'provenance.json'), provenance(out, { bin, version, seed, mode, runs, elapsedMs: Date.now() - t0 }));
      return 1;
    }
    log(`  done in ${elapsedMs} ms (${renderLog.renders.map((x) => `${x.file} ${x.seconds}s`).join(', ')})`);
  }
  const prov = provenance(out, { bin, version, seed, mode, runs, elapsedMs: Date.now() - t0 });
  writeJson(join(out, 'provenance.json'), prov);
  log(`${prov.entries.length} PNG(s) in ${out}; provenance.json written; total ${prov.elapsedMs} ms. ${LICENSE_NOTE}.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code)).catch((e) => { warn(`error: ${redact(e.message)}`); process.exit(1); });
}
